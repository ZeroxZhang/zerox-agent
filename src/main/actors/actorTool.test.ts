import { describe, expect, it } from "vitest";
import { createDynamicToolRegistry } from "../dynamicToolRegistry";
import { createAgentToolExecutor } from "../agentToolExecutor";
import { registerActorTool, ACTOR_TOOL_NAME } from "./actorTool";
import { registerWorkflowTool, WORKFLOW_TOOL_NAME } from "../workflow/workflowTool";
import { createActorRuntime } from "./actorRuntime";
import type { SpawnInput } from "./actorRuntime";
import type { AgentRunContext } from "../../shared/agentWorkspace";
import { createWorkflowRuntime } from "../workflow/workflowRuntime";
import { registerDeepResearchWorkflow } from "../workflow/deepResearchWorkflow";
import type { AgentToolExecutionResult } from "../dynamicToolRegistry";

describe("actor tool registration + execution (P6 activation)", () => {
  it("registers the actor tool and runs spawn+wait via op:run", async () => {
    const registry = createDynamicToolRegistry();
    const runtime = createActorRuntime({
      deps: { runActor: async (input) => ({ status: "done", summary: `did: ${input.task}`, filesTouched: [] }) },
    });
    registerActorTool(registry, { actorRuntime: runtime });
    expect(registry.has(ACTOR_TOOL_NAME)).toBe(true);
    const def = registry.getDefinitions().find((d) => d.function.name === ACTOR_TOOL_NAME);
    expect(def).toBeTruthy();

    const res = await registry.execute(
      ACTOR_TOOL_NAME,
      { op: "run", task: "research the spec", contextMode: "state" },
      { runContext: createRunContext("run_owner") },
    );
    expect(res.ok).toBe(true);
    expect(toolResult<{ summary: string }>(res).summary).toContain("did: research the spec");
  });

  it("op:spawn returns an actorId without waiting", async () => {
    const registry = createDynamicToolRegistry();
    const runtime = createActorRuntime({ deps: { runActor: async () => ({ status: "done", summary: "ok", filesTouched: [] }) } });
    registerActorTool(registry, { actorRuntime: runtime });
    const res = await registry.execute(
      ACTOR_TOOL_NAME,
      { op: "spawn", task: "bg work", background: true },
      { runContext: createRunContext("run_owner") },
    );
    expect(res.ok).toBe(true);
    expect(toolResult<{ actorId: string }>(res).actorId).toBeTruthy();
  });

  it("passes run context parentRunId into spawned actors", async () => {
    const registry = createDynamicToolRegistry();
    const receivedInputs: SpawnInput[] = [];
    const runtime = createActorRuntime({
      deps: {
        runActor: async (input) => {
          receivedInputs.push(input);
          return { status: "done", summary: "ok", filesTouched: [] };
        },
      },
    });
    registerActorTool(registry, { actorRuntime: runtime });

    const res = await registry.execute(
      ACTOR_TOOL_NAME,
      { op: "run", task: "review the final diff", contextMode: "state" },
      { runContext: createRunContext("run_parent") },
    );

    expect(res.ok).toBe(true);
    expect(receivedInputs[0]?.parentRunId).toBe("run_parent");
  });

  it("emits a runtime event as soon as an actor is spawned", async () => {
    const registry = createDynamicToolRegistry();
    const runtimeEvents: unknown[] = [];
    const runtime = createActorRuntime({
      deps: {
        runActor: async () => ({
          status: "done",
          summary: "ok",
          filesTouched: [],
        }),
      },
    });
    registerActorTool(registry, { actorRuntime: runtime });

    const res = await registry.execute(
      ACTOR_TOOL_NAME,
      { op: "run", task: "review the launch", contextMode: "state" },
      {
        runContext: createRunContext("run_parent"),
        onRuntimeEvent(event) {
          runtimeEvents.push(event);
        },
      },
    );

    expect(res.ok).toBe(true);
    expect(runtimeEvents).toEqual([
      expect.objectContaining({
        type: "actor_spawned",
        actorId: expect.any(String),
        task: "review the launch",
        status: "running",
      }),
    ]);
  });

  it("returns a tool failure when the actor outcome is error", async () => {
    const registry = createDynamicToolRegistry();
    const runtime = createActorRuntime({
      deps: {
        runActor: async () => ({
          status: "error",
          summary: "no parentRunId",
          filesTouched: [],
        }),
      },
    });
    registerActorTool(registry, { actorRuntime: runtime });

    const res = await registry.execute(
      ACTOR_TOOL_NAME,
      {
        op: "run",
        task: "launch subagent without context",
        contextMode: "state",
      },
      { runContext: createRunContext("run_owner") },
    );

    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toContain("no parentRunId");
  });

  it("returns a tool failure when the actor outcome is canceled", async () => {
    const registry = createDynamicToolRegistry();
    const runtime = createActorRuntime({
      deps: {
        runActor: async () => ({
          status: "canceled",
          summary: "user canceled",
          filesTouched: [],
        }),
      },
    });
    registerActorTool(registry, { actorRuntime: runtime });

    const res = await registry.execute(
      ACTOR_TOOL_NAME,
      {
        op: "run",
        task: "review then cancel",
        contextMode: "state",
      },
      { runContext: createRunContext("run_owner") },
    );

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("Expected actor cancellation to fail.");
    expect(res.error).toContain("user canceled");
    expect(res.errorDetails?.status).toBe("canceled");
  });

  it("rejects unknown op", async () => {
    const registry = createDynamicToolRegistry();
    registerActorTool(registry, { actorRuntime: createActorRuntime({ deps: { runActor: async () => ({ status: "done", summary: "", filesTouched: [] }) } }) });
    const res = await registry.execute(ACTOR_TOOL_NAME, { op: "frobnicate" });
    expect(res.ok).toBe(false);
  });

  it("rejects cross-run access to an actor handle", async () => {
    const registry = createDynamicToolRegistry();
    const runtime = createActorRuntime({
      deps: {
        runActor: async (_input, _context, signal) =>
          new Promise((resolve) => {
            signal.addEventListener("abort", () => {
              resolve({ status: "canceled", summary: "canceled", filesTouched: [] });
            }, { once: true });
          }),
      },
    });
    registerActorTool(registry, { actorRuntime: runtime });
    const spawned = await registry.execute(
      ACTOR_TOOL_NAME,
      { op: "spawn", task: "owned work", background: true },
      { runContext: createRunContext("run_a") },
    );
    const actorId = toolResult<{ actorId: string }>(spawned).actorId;

    const result = await registry.execute(
      ACTOR_TOOL_NAME,
      { op: "cancel", actorId },
      { runContext: createRunContext("run_b") },
    );

    expect(result).toEqual({
      ok: false,
      error: "actor handle is unknown or not owned by the current run",
    });
    expect(runtime.status(actorId)).toBe("running");
    runtime.cancel(actorId, "test cleanup");
    await runtime.wait(actorId);
  });

  it("cancels a background actor when its parent tool signal aborts", async () => {
    const registry = createDynamicToolRegistry();
    const executor = createAgentToolExecutor({ registry });
    let lateSideEffect = false;
    const runtime = createActorRuntime({
      deps: {
        runActor: async (_input, _context, signal) =>
          new Promise((resolve) => {
            const timer = setTimeout(() => {
              lateSideEffect = true;
              resolve({ status: "done", summary: "late", filesTouched: [] });
            }, 100);
            signal.addEventListener("abort", () => {
              clearTimeout(timer);
              resolve({ status: "canceled", summary: "canceled", filesTouched: [] });
            }, { once: true });
          }),
      },
    });
    registerActorTool(registry, { actorRuntime: runtime });
    const controller = new AbortController();
    const spawned = await executor.execute(
      {
        toolName: ACTOR_TOOL_NAME,
        args: { op: "spawn", task: "background", background: true },
      },
      {
        runContext: createRunContext("run_parent"),
        signal: controller.signal,
      },
    );
    const actorId = toolResult<{ actorId: string }>(spawned).actorId;

    controller.abort();
    await expect(runtime.wait(actorId)).resolves.toMatchObject({ status: "canceled" });
    await new Promise((resolve) => setTimeout(resolve, 125));
    expect(lateSideEffect).toBe(false);
  });

  it.each(["run", "spawn"] as const)(
    "does not enter runActor when actor.%s is already aborted",
    async (op) => {
      const registry = createDynamicToolRegistry();
      const executor = createAgentToolExecutor({ registry });
      let runActorCalls = 0;
      const runtime = createActorRuntime({
        deps: {
          runActor: async () => {
            runActorCalls += 1;
            return { status: "done", summary: "unexpected", filesTouched: [] };
          },
        },
      });
      registerActorTool(registry, { actorRuntime: runtime });
      const parent = new AbortController();
      parent.abort(new Error("already stopped"));

      await expect(executor.execute(
        {
          toolName: ACTOR_TOOL_NAME,
          args: { op, task: "must not start", background: op === "spawn" },
        },
        {
          runContext: createRunContext("run_parent"),
          signal: parent.signal,
        },
      )).resolves.toEqual({
        ok: false,
        error: "actor operation aborted before spawn",
      });
      expect(runActorCalls).toBe(0);
    },
  );

  it("cancels foreground actor.run on the combined tool timeout signal", async () => {
    const registry = createDynamicToolRegistry();
    const executor = createAgentToolExecutor({ registry, toolTimeoutMs: 5 });
    let lateSideEffect = false;
    let sawAbort = false;
    const runtime = createActorRuntime({
      deps: {
        runActor: async (_input, _context, signal) =>
          new Promise((resolve) => {
            const timer = setTimeout(() => {
              lateSideEffect = true;
              resolve({ status: "done", summary: "late", filesTouched: [] });
            }, 40);
            signal.addEventListener("abort", () => {
              sawAbort = true;
              clearTimeout(timer);
              resolve({ status: "canceled", summary: "timed out", filesTouched: [] });
            }, { once: true });
          }),
      },
    });
    registerActorTool(registry, { actorRuntime: runtime });
    const parent = new AbortController();

    await expect(executor.execute(
      {
        toolName: ACTOR_TOOL_NAME,
        args: { op: "run", task: "foreground" },
      },
      {
        runContext: createRunContext("run_parent"),
        signal: parent.signal,
      },
    )).rejects.toThrow("timed out after 5ms");

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sawAbort).toBe(true);
    expect(lateSideEffect).toBe(false);
    expect(parent.signal.aborted).toBe(false);
  });

  it("cancels actor.wait on the combined tool timeout signal", async () => {
    const registry = createDynamicToolRegistry();
    const executor = createAgentToolExecutor({ registry, toolTimeoutMs: 5 });
    let lateSideEffect = false;
    let sawAbort = false;
    const runtime = createActorRuntime({
      deps: {
        runActor: async (_input, _context, signal) =>
          new Promise((resolve) => {
            const timer = setTimeout(() => {
              lateSideEffect = true;
              resolve({ status: "done", summary: "late", filesTouched: [] });
            }, 40);
            signal.addEventListener("abort", () => {
              sawAbort = true;
              clearTimeout(timer);
              resolve({ status: "canceled", summary: "timed out", filesTouched: [] });
            }, { once: true });
          }),
      },
    });
    registerActorTool(registry, { actorRuntime: runtime });
    const parent = new AbortController();
    const spawned = await executor.execute(
      {
        toolName: ACTOR_TOOL_NAME,
        args: { op: "spawn", task: "background", background: true },
      },
      {
        runContext: createRunContext("run_parent"),
        signal: parent.signal,
      },
    );
    const actorId = toolResult<{ actorId: string }>(spawned).actorId;

    await expect(executor.execute(
      {
        toolName: ACTOR_TOOL_NAME,
        args: { op: "wait", actorId },
      },
      {
        runContext: createRunContext("run_parent"),
        signal: parent.signal,
      },
    )).rejects.toThrow("timed out after 5ms");

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sawAbort).toBe(true);
    expect(lateSideEffect).toBe(false);
    expect(parent.signal.aborted).toBe(false);
  });
});

function createRunContext(runId: string): AgentRunContext {
  return {
    workspaceId: "workspace_1",
    workspaceRoot: "/tmp/workspace",
    runId,
    agentRole: "primary",
    depth: 0,
    sandbox: {
      mode: "workspace_write",
      network: "none",
      shell: "workspace_only",
      allowWorkspaceEscape: false,
      extraReadRoots: [],
      extraWriteRoots: [],
    },
  };
}

describe("workflow tool registration + execution (P6 activation)", () => {
  it("registers the workflow tool; op:list returns registered workflows incl deep-research", async () => {
    const registry = createDynamicToolRegistry();
    const wf = createWorkflowRuntime({ async spawnActor() { return { status: "done", summary: "", filesTouched: [] }; }, async webfetch() { return ""; }, async websearch() { return []; } });
    registerDeepResearchWorkflow(wf.register.bind(wf));
    registerWorkflowTool(registry, { workflowRuntime: wf });
    expect(registry.has(WORKFLOW_TOOL_NAME)).toBe(true);
    const res = await registry.execute(WORKFLOW_TOOL_NAME, { op: "list" });
    expect(res.ok).toBe(true);
    expect(toolResult<{ workflows: string[] }>(res).workflows).toContain("deep-research");
  });
});

function toolResult<T extends Record<string, unknown>>(
  result: AgentToolExecutionResult,
): T {
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.result as T;
}
