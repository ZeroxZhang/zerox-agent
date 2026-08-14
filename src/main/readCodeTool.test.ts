import { describe, expect, it } from "vitest";
import { createDynamicToolRegistry } from "./dynamicToolRegistry";
import {
  registerReadCodeTool,
  READ_CODE_TOOL_NAME,
} from "./readCodeTool";
import { createToolRuntime } from "./toolRuntime";
import type { ToolAuthorizationService } from "./toolAuthorizationService";

describe("read_code tool", () => {
  it("runs every Worker subcall through the supplied ToolRuntime bridge", async () => {
    const registry = createDynamicToolRegistry();
    const calls: string[] = [];
    registerReadCodeTool(registry, {
      async executeSubcall(input) {
        calls.push(`${input.request.toolName}:${String(input.request.args.path)}`);
        await input.onStage({
          stage: "dispatching",
          taskId: input.taskId,
          request: input.request,
        });
        return {
          request: input.request,
          result: {
            ok: true,
            result: { path: input.request.args.path },
          },
          dispatched: true,
          diagnostics: [],
        };
      },
    });
    const runtimeEvents: unknown[] = [];

    const result = await registry.execute(
      READ_CODE_TOOL_NAME,
      {
        program: {
          steps: [
            {
              id: "a",
              tool: "file_read",
              args: { path: "/workspace/a.ts" },
            },
            {
              id: "b",
              tool: "file_read",
              args: { path: "/workspace/b.ts" },
            },
          ],
          output: ["b", "a"],
        },
      },
      {
        taskId: "task_1",
        onRuntimeEvent(event) {
          runtimeEvents.push(event);
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      result: {
        mode: "read_only_dag",
        stepsExecuted: 2,
        outputs: [
          { id: "b", tool: "file_read" },
          { id: "a", tool: "file_read" },
        ],
      },
    });
    expect(new Set(calls)).toEqual(
      new Set([
        "file_read:/workspace/a.ts",
        "file_read:/workspace/b.ts",
      ]),
    );
    expect(runtimeEvents).toEqual(
      expect.arrayContaining([
        {
          type: "read_code_subcall",
          callId: "a",
          toolName: "file_read",
          status: "started",
        },
        {
          type: "read_code_subcall",
          callId: "a",
          toolName: "file_read",
          status: "completed",
          ok: true,
        },
      ]),
    );
  });

  it("fails closed without a trusted outer ToolRuntime task id", async () => {
    const registry = createDynamicToolRegistry();
    let subcallRan = false;
    registerReadCodeTool(registry, {
      async executeSubcall() {
        subcallRan = true;
        throw new Error("unreachable");
      },
    });

    await expect(
      registry.execute(READ_CODE_TOOL_NAME, {
        program: {
          steps: [{ id: "a", tool: "file_read", args: {} }],
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/authorized ToolRuntime task id/i),
    });
    expect(subcallRan).toBe(false);
  });

  it("rejects a mutating or nested subcall before the ToolRuntime bridge", async () => {
    for (const tool of ["file_write", "shell_exec", "read_code"]) {
      const registry = createDynamicToolRegistry();
      let subcallRan = false;
      registerReadCodeTool(registry, {
        async executeSubcall() {
          subcallRan = true;
          throw new Error("unreachable");
        },
      });
      const result = await registry.execute(
        READ_CODE_TOOL_NAME,
        {
          program: {
            steps: [{ id: "unsafe", tool, args: {} }],
          },
        },
        { taskId: "task_1" },
      );
      expect(result).toMatchObject({
        ok: false,
        error: expect.stringMatching(/not read-only allowlisted/i),
      });
      expect(subcallRan).toBe(false);
    }
  });

  it("uses one outer result while authorizing every Worker subcall through ToolRuntime", async () => {
    const registry = createDynamicToolRegistry();
    registry.register(
      {
        type: "function",
        function: {
          name: "file_read",
          description: "read",
          parameters: { type: "object", properties: {} },
        },
      },
      async (args) => ({
        ok: true,
        result: { path: args.path },
      }),
      "built-in",
    );
    const authorized: string[] = [];
    const authorizationService: ToolAuthorizationService = {
      async authorize(taskId, request) {
        authorized.push(request.toolName);
        return {
          ok: true,
          decision: { allowed: true, reason: "allowed" },
          auditEvent: {
            id: `audit_${authorized.length}`,
            taskId,
            request,
            decision: { allowed: true, reason: "allowed" },
            createdAt: "2026-08-14T10:00:00.000Z",
          },
        };
      },
    };
    const executor = {
      execute(request: Parameters<typeof registry.execute>[0] extends never
        ? never
        : { toolName: string; args: Record<string, unknown> },
      options?: Parameters<typeof registry.execute>[2]) {
        return registry.execute(
          request.toolName,
          request.args,
          options,
        );
      },
      getRegistry() {
        return registry;
      },
    };
    const innerRuntime = createToolRuntime({
      authorizationService,
      toolExecutor: executor,
    });
    registerReadCodeTool(registry, {
      executeSubcall(input) {
        return innerRuntime.execute({
          taskId: input.taskId,
          request: input.request,
          executionOptions: {
            signal: input.signal,
          },
          onStage: input.onStage,
        });
      },
    });
    const outerRuntime = createToolRuntime({
      authorizationService,
      toolExecutor: executor,
    });

    const outcome = await outerRuntime.execute({
      taskId: "task_1",
      request: {
        toolName: READ_CODE_TOOL_NAME,
        args: {
          program: {
            steps: [
              {
                id: "one",
                tool: "file_read",
                args: { path: "/workspace/one.ts" },
              },
              {
                id: "two",
                tool: "file_read",
                args: { path: "/workspace/two.ts" },
              },
            ],
          },
        },
      },
    });

    expect(outcome.result).toMatchObject({
      ok: true,
      result: {
        mode: "read_only_dag",
        stepsExecuted: 2,
        outputs: [
          { id: "one", tool: "file_read" },
          { id: "two", tool: "file_read" },
        ],
      },
    });
    expect(authorized).toEqual([
      READ_CODE_TOOL_NAME,
      "file_read",
      "file_read",
    ]);
  });
});
