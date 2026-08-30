import { describe, expect, it, vi } from "vitest";
import { buildPrimaryRunContext } from "../shared/agentWorkspace";
import {
  getDefaultTaskPermissionPolicy,
  type ToolCallRequest,
} from "../shared/toolPermissions";
import type {
  AgentToolExecutionOptions,
  AgentToolExecutionResult,
  AgentToolExecutor,
} from "./agentToolExecutor";
import { createDynamicToolRegistry } from "./dynamicToolRegistry";
import {
  createToolRuntime,
  type ToolRuntimeGuard,
} from "./toolRuntime";
import type { ToolAuthorizationService } from "./toolAuthorizationService";

describe("ToolRuntime", () => {
  it("authorizes and dispatches the exact canonical request and context", async () => {
    const observed: {
      authorizedRequest?: ToolCallRequest;
      dispatchedRequest?: ToolCallRequest;
      authorizedContext?: unknown;
      dispatchedContext?: unknown;
    } = {};
    const authorizationService = allowAuthorization((request, options) => {
      observed.authorizedRequest = request;
      observed.authorizedContext = options?.runContext;
    });
    const toolExecutor = executor(async (request, options) => {
      observed.dispatchedRequest = request;
      observed.dispatchedContext = options?.runContext;
      return { ok: true, result: { path: request.args.path } };
    }, "builtin:file");
    const runtime = createToolRuntime({
      authorizationService,
      toolExecutor,
    });
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot: "/tmp/workspace",
    });
    const request = {
      toolName: "file_read",
      source: "spoofed",
      args: { path: "/tmp/workspace/a.txt" },
    };

    const outcome = await runtime.execute({
      taskId: "task_1",
      request,
      executionOptions: { runContext },
    });

    expect(outcome.dispatched).toBe(true);
    expect(outcome.result).toEqual({
      ok: true,
      result: { path: "/tmp/workspace/a.txt" },
    });
    expect(observed.authorizedRequest).toBe(observed.dispatchedRequest);
    expect(observed.authorizedRequest?.source).toBe("builtin:file");
    expect(observed.authorizedContext).toBe(observed.dispatchedContext);
    expect(observed.authorizedContext).toBe(runContext);
  });

  it("fails closed without authorization and never dispatches", async () => {
    const dispatch = vi.fn();
    const runtime = createToolRuntime({
      toolExecutor: executor(dispatch),
    });

    const outcome = await runtime.execute({
      taskId: "task_1",
      request: { toolName: "file_read", args: { path: "a.txt" } },
    });

    expect(outcome).toMatchObject({
      dispatched: false,
      deniedBy: "authorization",
      result: {
        ok: false,
        errorDetails: { kind: "authorization_unavailable" },
      },
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("stops monotonically at the first denied guard", async () => {
    const order: string[] = [];
    const guards: ToolRuntimeGuard[] = [
      {
        name: "workspace",
        evaluate() {
          order.push("workspace");
          return { allowed: false, reason: "outside workspace" };
        },
      },
      {
        name: "later",
        evaluate() {
          order.push("later");
          return { allowed: true };
        },
      },
    ];
    const authorizationService = allowAuthorization(() => {
      order.push("authorize");
    });
    const dispatch = vi.fn();
    const runtime = createToolRuntime({
      authorizationService,
      toolExecutor: executor(dispatch),
      guards,
    });

    const outcome = await runtime.execute({
      taskId: "task_1",
      request: { toolName: "file_read", args: { path: "../escape" } },
    });

    expect(order).toEqual(["workspace"]);
    expect(outcome).toMatchObject({
      dispatched: false,
      deniedBy: "workspace",
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("runs pre, guard, authorization, dispatch, and post serially", async () => {
    const order: string[] = [];
    const runtime = createToolRuntime({
      authorizationService: allowAuthorization(() => {
        order.push("authorization");
      }),
      toolExecutor: executor(async () => {
        order.push("dispatch");
        return { ok: true, result: { value: 1 } };
      }),
      preHooks: [
        async () => {
          order.push("pre:start");
          await Promise.resolve();
          order.push("pre:end");
        },
      ],
      guards: [
        {
          name: "policy",
          async evaluate() {
            order.push("guard:start");
            await Promise.resolve();
            order.push("guard:end");
            return { allowed: true };
          },
        },
      ],
      postHooks: [
        async () => {
          order.push("post:start");
          await Promise.resolve();
          order.push("post:end");
        },
      ],
    });

    await runtime.execute({
      taskId: "task_1",
      request: { toolName: "fixture", args: {} },
    });

    expect(order).toEqual([
      "pre:start",
      "pre:end",
      "guard:start",
      "guard:end",
      "authorization",
      "dispatch",
      "post:start",
      "post:end",
    ]);
  });

  it("derives command proof from the authorized canonical command", async () => {
    let dispatchOptions: AgentToolExecutionOptions | undefined;
    const runtime = createToolRuntime({
      authorizationService: allowAuthorization(),
      toolExecutor: executor(async (_request, options) => {
        dispatchOptions = options;
        return { ok: true, result: { exitCode: 0 } };
      }),
    });

    await runtime.execute({
      taskId: "task_1",
      request: {
        toolName: "test_run",
        args: { command: "npm test" },
      },
      executionOptions: {
        authorizedShellCommand: "rm -rf /",
      },
    });

    expect(dispatchOptions?.authorizedShellCommand).toBe("npm test");
  });

  it("replaces caller-forged authorization receipts with the audit receipt it owns", async () => {
    let dispatchOptions: AgentToolExecutionOptions | undefined;
    const runtime = createToolRuntime({
      authorizationService: allowAuthorization(),
      toolExecutor: executor(async (_request, options) => {
        dispatchOptions = options;
        return { ok: true, result: {} };
      }),
    });

    await runtime.execute({
      taskId: "task_receipt",
      request: { toolName: "fixture", args: {} },
      executionOptions: {
        authorizationReceipt: { auditEventId: "forged" },
      },
    });

    expect(dispatchOptions?.authorizationReceipt).toEqual({
      auditEventId: "audit_task_receipt",
    });
  });

  it("preserves the live AbortSignal across authorization and dispatch", async () => {
    const controller = new AbortController();
    let authorizationSignal: AbortSignal | undefined;
    let dispatchSignal: AbortSignal | undefined;
    const runtime = createToolRuntime({
      authorizationService: {
        async authorize(taskId, request, options) {
          authorizationSignal = options?.signal;
          return {
            ok: true,
            decision: { allowed: true, reason: "allowed" },
            auditEvent: {
              id: "audit_signal",
              taskId,
              request,
              decision: { allowed: true, reason: "allowed" },
              createdAt: "2026-08-14T00:00:00.000Z",
            },
          };
        },
      },
      toolExecutor: executor(async (_request, options) => {
        dispatchSignal = options?.signal;
        return { ok: true, result: {} };
      }),
      preHooks: [
        (context) => {
          expect(context.signal).toBe(controller.signal);
          expect(Object.isFrozen(context.signal)).toBe(false);
        },
      ],
    });

    await runtime.execute({
      taskId: "task_1",
      request: { toolName: "fixture", args: {} },
      executionOptions: { signal: controller.signal },
    });
    controller.abort(new Error("stopped"));

    expect(authorizationSignal).toBe(controller.signal);
    expect(dispatchSignal).toBe(controller.signal);
    expect(dispatchSignal?.aborted).toBe(true);
  });

  it("injects trusted task and runtime policy identity into dispatch options", async () => {
    let dispatchOptions: AgentToolExecutionOptions | undefined;
    const runtimeTask = {
      name: "Read Code subcalls",
      policyLabel: "read-code",
      permissions: getDefaultTaskPermissionPolicy(),
    };
    const runtime = createToolRuntime({
      authorizationService: allowAuthorization(),
      toolExecutor: executor(async (_request, options) => {
        dispatchOptions = options;
        return { ok: true, result: {} };
      }),
    });

    await runtime.execute({
      taskId: "task_trusted",
      request: { toolName: "read_code", args: {} },
      authorizationOptions: { runtimeTask },
      executionOptions: {
        taskId: "spoofed",
        runtimeTask: {
          ...runtimeTask,
          name: "spoofed",
        },
      },
    });

    expect(dispatchOptions?.taskId).toBe("task_trusted");
    expect(dispatchOptions?.runtimeTask).toEqual(runtimeTask);
  });

  it("does not dispatch when authorization aborts the run before returning", async () => {
    const controller = new AbortController();
    const reason = new Error("canceled during authorization");
    let dispatches = 0;
    const runtime = createToolRuntime({
      authorizationService: {
        async authorize(taskId, request) {
          controller.abort(reason);
          return {
            ok: true,
            decision: { allowed: true, reason: "allowed" },
            auditEvent: {
              id: "audit_abort",
              taskId,
              request,
              decision: { allowed: true, reason: "allowed" },
              createdAt: "2026-08-14T00:00:00.000Z",
            },
          };
        },
      },
      toolExecutor: executor(async () => {
        dispatches += 1;
        return { ok: true, result: {} };
      }),
    });

    await expect(
      runtime.execute({
        taskId: "task_abort",
        request: { toolName: "file_write", args: {} },
        executionOptions: { signal: controller.signal },
      }),
    ).rejects.toBe(reason);
    expect(dispatches).toBe(0);
  });

  it("rechecks cancellation after dispatch lifecycle observers", async () => {
    const controller = new AbortController();
    const reason = new Error("canceled by dispatch observer");
    let dispatches = 0;
    const runtime = createToolRuntime({
      authorizationService: allowAuthorization(),
      toolExecutor: executor(async () => {
        dispatches += 1;
        return { ok: true, result: {} };
      }),
    });

    await expect(
      runtime.execute({
        taskId: "task_observer_abort",
        request: { toolName: "file_write", args: {} },
        executionOptions: { signal: controller.signal },
        onStage(event) {
          if (event.stage === "dispatching") {
            controller.abort(reason);
          }
        },
      }),
    ).rejects.toBe(reason);
    expect(dispatches).toBe(0);
  });

  it("normalizes invalid output and deep-freezes detached outcomes", async () => {
    const mutableResult = {
      ok: true as const,
      result: { nested: { value: 1 } },
    } satisfies AgentToolExecutionResult;
    const runtime = createToolRuntime({
      authorizationService: allowAuthorization(),
      toolExecutor: executor(async () => mutableResult),
    });
    const request = {
      toolName: "fixture",
      args: { nested: { input: 1 } },
    };

    const outcome = await runtime.execute({
      taskId: "task_1",
      request,
    });
    mutableResult.result.nested.value = 2;
    (request.args.nested as { input: number }).input = 2;

    expect(outcome.result).toEqual({
      ok: true,
      result: { nested: { value: 1 } },
    });
    expect(outcome.request.args).toEqual({ nested: { input: 1 } });
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(Object.isFrozen(outcome.result)).toBe(true);
    if (!outcome.result.ok) throw new Error(outcome.result.error);
    const nestedResult = outcome.result.result.nested;
    if (typeof nestedResult !== "object" || nestedResult === null) {
      throw new Error("Expected nested object result.");
    }
    expect(Object.isFrozen(nestedResult)).toBe(true);
  });

  it("turns an invalid success payload into a canonical failure", async () => {
    const runtime = createToolRuntime({
      authorizationService: allowAuthorization(),
      toolExecutor: executor(async () =>
        ({
          ok: true,
          result: ["not", "an", "object"],
        }) as unknown as AgentToolExecutionResult,
      ),
    });

    const outcome = await runtime.execute({
      taskId: "task_1",
      request: { toolName: "fixture", args: {} },
    });

    expect(outcome).toMatchObject({
      dispatched: true,
      result: {
        ok: false,
        errorDetails: { kind: "invalid_tool_output" },
      },
    });
  });

  it("turns non-cloneable output into a canonical failure", async () => {
    const runtime = createToolRuntime({
      authorizationService: allowAuthorization(),
      toolExecutor: executor(async () =>
        ({
          ok: true,
          result: { callback: () => "not cloneable" },
        }) as AgentToolExecutionResult,
      ),
    });

    await expect(
      runtime.execute({
        taskId: "task_1",
        request: { toolName: "fixture", args: {} },
      }),
    ).resolves.toMatchObject({
      dispatched: true,
      result: {
        ok: false,
        errorDetails: { kind: "invalid_tool_output" },
      },
    });
  });

  it("records post-hook failures without replacing an executed result", async () => {
    const runtime = createToolRuntime({
      authorizationService: allowAuthorization(),
      toolExecutor: executor(async () => ({
        ok: true,
        result: { value: 1 },
      })),
      postHooks: [
        () => {
          throw new Error("observer failed");
        },
      ],
    });

    const outcome = await runtime.execute({
      taskId: "task_1",
      request: { toolName: "fixture", args: {} },
    });

    expect(outcome.result).toEqual({ ok: true, result: { value: 1 } });
    expect(outcome.diagnostics).toContain("post:observer failed");
  });

  it("fails closed when a pre-dispatch lifecycle hook fails", async () => {
    const dispatch = vi.fn();
    const runtime = createToolRuntime({
      authorizationService: allowAuthorization(),
      toolExecutor: executor(dispatch),
    });

    await expect(
      runtime.execute({
        taskId: "task_1",
        request: { toolName: "fixture", args: {} },
        onStage(event) {
          if (event.stage === "dispatching") {
            throw new Error("trajectory unavailable");
          }
        },
      }),
    ).rejects.toThrow("trajectory unavailable");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("preserves dispatch exceptions such as timeouts", async () => {
    const runtime = createToolRuntime({
      authorizationService: allowAuthorization(),
      toolExecutor: executor(async () => {
        throw new Error("fixture timed out after 10ms.");
      }),
    });

    await expect(
      runtime.execute({
        taskId: "task_1",
        request: { toolName: "fixture", args: {} },
      }),
    ).rejects.toThrow("fixture timed out after 10ms.");
  });
});

function allowAuthorization(
  observe?: (
    request: ToolCallRequest,
    options: Parameters<ToolAuthorizationService["authorize"]>[2],
  ) => void,
): ToolAuthorizationService {
  return {
    async authorize(taskId, request, options) {
      observe?.(request, options);
      return {
        ok: true,
        decision: { allowed: true, reason: "allowed" },
        auditEvent: {
          id: `audit_${taskId}`,
          taskId,
          request,
          decision: { allowed: true, reason: "allowed" },
          createdAt: "2026-08-14T00:00:00.000Z",
        },
      };
    },
  };
}

function executor(
  execute: (
    request: ToolCallRequest,
    options?: AgentToolExecutionOptions,
  ) => Promise<AgentToolExecutionResult>,
  source: string | null = null,
): Pick<AgentToolExecutor, "execute" | "getRegistry"> {
  return {
    execute,
    getRegistry() {
      return {
        ...createDynamicToolRegistry(),
        getSource: () => source,
      };
    },
  };
}
