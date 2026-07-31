import { describe, expect, it } from "vitest";
import { createActorRuntime, type ActorOutcome, type ForkContext, type SpawnInput } from "./actorRuntime";
import { buildForkContext } from "./forkContext";
import { createCheckpointWriterOrchestrator } from "./checkpointWriterOrchestrator";
import { runCheckpointWriterActor } from "./checkpointWriterActor";
import { resolveCheckpointWriterFlag } from "./checkpointWriterOptions";
import { createInMemoryStorage } from "../storage/storageDb";
import { createRunRepository } from "../storage/repositories/runRepository";
import { createCheckpointRepository } from "../storage/repositories/checkpointRepository";
import { buildChildSandboxPolicy } from "../../shared/agentWorkspace";
import { NEVER_COMPACT_MARKER } from "../../shared/compactionMarkers";
import { serializeCachePrefix } from "../providers/cachePrefix";
import type { AgentSandboxPolicy } from "../../shared/agentWorkspace";
import type { AgentTrajectoryEvent } from "../../shared/agentTrajectory";
import type { Goal } from "../../shared/agentGoal";

const parentSandbox: AgentSandboxPolicy = {
  mode: "workspace_write", network: "none", shell: "workspace_only",
  allowWorkspaceEscape: false, extraReadRoots: ["/tmp/read"], extraWriteRoots: ["/tmp/write"],
};

function baseGoal(): Goal {
  return {
    id: "goal-1", description: "Ship the feature", successCriteria: [], milestones: [],
    status: "executing",
    budget: { maxTurns: 10, maxMinutes: 60, maxCostUsd: 1 } as Goal["budget"],
    executionUsage: { turns: 0, minutes: 0, costUsd: 0 } as Goal["executionUsage"],
    reviewPolicy: { mode: "human" } as Goal["reviewPolicy"],
    planVersion: 1, createdAt: "2026-06-19T00:00:00.000Z", updatedAt: "2026-06-19T00:00:00.000Z",
  };
}

describe("buildChildSandboxPolicy", () => {
  it("narrows a child policy against the parent (no escape broadening)", () => {
    const child = buildChildSandboxPolicy(parentSandbox, { mode: "read_only" }, "/tmp");
    expect(child.mode).toBe("read_only");
    expect(child.allowWorkspaceEscape).toBe(false);
  });
  it("returns a copy of the parent when no child override is given", () => {
    const child = buildChildSandboxPolicy(parentSandbox, undefined, "/tmp");
    expect(child.mode).toBe("workspace_write");
    expect(child.extraReadRoots).toEqual(["/tmp/read"]);
  });
});

describe("ActorRuntime v0", () => {
  it("spawn/wait lifecycle with an injected runActor", async () => {
    const runtime = createActorRuntime({
      deps: {
        runActor: async (input) => ({
          status: "done", summary: `did ${input.task}`, filesTouched: ["x"],
        }),
      },
    });
    const handle = runtime.spawn({ contextMode: "full", lifecycle: "ephemeral", task: "work", parentRunId: "run-1" });
    expect(runtime.status(handle.actorId)).toBe("running");
    const outcome = await runtime.wait(handle.actorId);
    expect(outcome.status).toBe("done");
    expect(outcome.summary).toBe("did work");
  });

  it("updates status after terminal outcomes resolve", async () => {
    const runtime = createActorRuntime({
      deps: {
        runActor: async () => ({
          status: "done",
          summary: "finished",
          filesTouched: [],
        }),
      },
    });
    const handle = runtime.spawn({
      contextMode: "state",
      lifecycle: "ephemeral",
      task: "short task",
      parentRunId: "run-parent",
    });

    await runtime.wait(handle.actorId);

    expect(runtime.status(handle.actorId)).toBe("done");
  });

  it("keeps terminal wait, status, and ownership semantics without active resources", async () => {
    const runtime = createActorRuntime({
      deps: {
        runActor: async () => ({
          status: "done",
          summary: "cached outcome",
          filesTouched: [],
        }),
      },
    });
    const handle = runtime.spawn({
      contextMode: "state",
      lifecycle: "ephemeral",
      task: "finish and release",
      parentRunId: "run-owner",
    });

    await handle.outcome;

    await expect(runtime.wait(handle.actorId)).resolves.toMatchObject({
      status: "done",
      summary: "cached outcome",
    });
    expect(runtime.status(handle.actorId)).toBe("done");
    expect(runtime.isOwnedBy(handle.actorId, "run-owner")).toBe(true);
    expect(runtime.isOwnedBy(handle.actorId, "another-run")).toBe(false);
  });

  it("bounds terminal outcomes and evicts the oldest lightweight record", async () => {
    const runtime = createActorRuntime({
      terminalOutcomeCacheLimit: 2,
      deps: {
        runActor: async (input) => ({
          status: "done",
          summary: input.task,
          filesTouched: [],
        }),
      },
    });
    const first = runtime.spawn({
      contextMode: "state",
      lifecycle: "ephemeral",
      task: "first",
      parentRunId: "run-owner",
    });
    await first.outcome;
    const second = runtime.spawn({
      contextMode: "state",
      lifecycle: "ephemeral",
      task: "second",
      parentRunId: "run-owner",
    });
    await second.outcome;
    const third = runtime.spawn({
      contextMode: "state",
      lifecycle: "ephemeral",
      task: "third",
      parentRunId: "run-owner",
    });
    await third.outcome;

    await expect(runtime.wait(first.actorId)).rejects.toThrow("unknown actor");
    await expect(runtime.wait(second.actorId)).resolves.toMatchObject({
      summary: "second",
    });
    await expect(runtime.wait(third.actorId)).resolves.toMatchObject({
      summary: "third",
    });
    expect(runtime.isOwnedBy(first.actorId, "run-owner")).toBe(false);
  });

  it("cancel aborts the actor and resolves canceled", async () => {
    let aborted = false;
    const runtime = createActorRuntime({
      deps: {
        runActor: async (_input, _ctx, cancel) => {
          return new Promise<ActorOutcome>((resolve) => {
            cancel.addEventListener("abort", () => { aborted = true; resolve({ status: "canceled", summary: "canceled", filesTouched: [] }); });
          });
        },
      },
    });
    const handle = runtime.spawn({ contextMode: "full", lifecycle: "ephemeral", task: "long" });
    runtime.cancel(handle.actorId, "too slow");
    const outcome = await runtime.wait(handle.actorId);
    expect(aborted).toBe(true);
    expect(outcome.status).toBe("canceled");
  });

  it("keeps abort rejections classified as canceled", async () => {
    const runtime = createActorRuntime({
      deps: {
        runActor: async (_input, _ctx, cancel) =>
          new Promise<ActorOutcome>((_resolve, reject) => {
            cancel.addEventListener("abort", () => {
              reject(new Error("operation aborted"));
            });
          }),
      },
    });
    const handle = runtime.spawn({
      contextMode: "state",
      lifecycle: "ephemeral",
      task: "cancel me",
    });

    runtime.cancel(handle.actorId, "user canceled");
    const outcome = await runtime.wait(handle.actorId);

    expect(outcome.status).toBe("canceled");
    expect(runtime.status(handle.actorId)).toBe("canceled");
  });

  it("keeps a late successful resolution canceled after abort", async () => {
    let resolveActor!: (outcome: ActorOutcome) => void;
    const runtime = createActorRuntime({
      deps: {
        runActor: async () =>
          new Promise<ActorOutcome>((resolve) => {
            resolveActor = resolve;
          }),
      },
    });
    const handle = runtime.spawn({
      contextMode: "state",
      lifecycle: "ephemeral",
      task: "ignore abort",
    });

    runtime.cancel(handle.actorId, "parent stopped");
    resolveActor({ status: "done", summary: "late success", filesTouched: [] });

    await expect(handle.outcome).resolves.toMatchObject({
      status: "canceled",
      summary: "Error: parent stopped",
    });
    expect(runtime.status(handle.actorId)).toBe("canceled");
  });

  it("aborts and drains every active actor during shutdown", async () => {
    let abortCount = 0;
    const runtime = createActorRuntime({
      deps: {
        runActor: async (_input, _ctx, cancel) =>
          new Promise<ActorOutcome>((resolve) => {
            cancel.addEventListener("abort", () => {
              abortCount += 1;
              resolve({
                status: "canceled",
                summary: "application shutdown",
                filesTouched: [],
              });
            }, { once: true });
          }),
      },
    });
    const first = runtime.spawn({ contextMode: "state", lifecycle: "ephemeral", task: "one" });
    const second = runtime.spawn({ contextMode: "state", lifecycle: "ephemeral", task: "two" });

    await runtime.shutdown?.();

    expect(abortCount).toBe(2);
    await expect(first.outcome).resolves.toMatchObject({ status: "canceled" });
    await expect(second.outcome).resolves.toMatchObject({ status: "canceled" });
  });

  it("closes spawn admission before taking the shutdown snapshot", async () => {
    const runtime = createActorRuntime({
      deps: {
        runActor: async (_input, _ctx, cancel) =>
          new Promise<ActorOutcome>((resolve) => {
            cancel.addEventListener("abort", () => {
              resolve({
                status: "canceled",
                summary: "application shutdown",
                filesTouched: [],
              });
            }, { once: true });
          }),
      },
    });
    const active = runtime.spawn({
      contextMode: "state",
      lifecycle: "ephemeral",
      task: "active before shutdown",
    });

    const shutdown = runtime.shutdown?.();

    expect(() => runtime.spawn({
      contextMode: "state",
      lifecycle: "ephemeral",
      task: "late actor",
    })).toThrow("Actor runtime is shutting down");
    await shutdown;
    await expect(active.outcome).resolves.toMatchObject({ status: "canceled" });
  });

  it("clears cached terminal outcomes during shutdown", async () => {
    const runtime = createActorRuntime({
      deps: {
        runActor: async () => ({
          status: "done",
          summary: "terminal",
          filesTouched: [],
        }),
      },
    });
    const handle = runtime.spawn({
      contextMode: "state",
      lifecycle: "ephemeral",
      task: "terminal before shutdown",
      parentRunId: "run-owner",
    });
    await handle.outcome;

    await runtime.shutdown?.();

    await expect(runtime.wait(handle.actorId)).rejects.toThrow("unknown actor");
    expect(runtime.isOwnedBy(handle.actorId, "run-owner")).toBe(false);
  });

  it("drains an already-canceled actor whose outcome has not settled yet", async () => {
    let releaseActor!: () => void;
    const runtime = createActorRuntime({
      deps: {
        runActor: async () =>
          new Promise<ActorOutcome>((resolve) => {
            releaseActor = () =>
              resolve({
                status: "canceled",
                summary: "released after cancellation",
                filesTouched: [],
              });
          }),
      },
    });
    const handle = runtime.spawn({
      contextMode: "state",
      lifecycle: "ephemeral",
      task: "cancel before shutdown",
    });
    runtime.cancel(handle.actorId, "cancel first");

    let shutdownSettled = false;
    const shutdown = runtime.shutdown?.().then(() => {
      shutdownSettled = true;
    });
    await Promise.resolve();
    expect(shutdownSettled).toBe(false);

    releaseActor();
    await shutdown;
    expect(shutdownSettled).toBe(true);
  });

  it("runActor errors become error outcomes (never throw to caller)", async () => {
    const runtime = createActorRuntime({
      deps: { runActor: async () => { throw new Error("boom"); } },
    });
    const handle = runtime.spawn({ contextMode: "full", lifecycle: "ephemeral", task: "x" });
    const outcome = await runtime.wait(handle.actorId);
    expect(outcome.status).toBe("error");
    expect(outcome.summary).toContain("boom");
  });

  it("records lifecycle in the actors table when storage is provided", async () => {
    const storage = await createInMemoryStorage();
    const runtime = createActorRuntime({
      storage,
      deps: { runActor: async () => ({ status: "done", summary: "ok", filesTouched: [] }) },
    });
    const handle = runtime.spawn({ contextMode: "full", lifecycle: "ephemeral", task: "x", parentRunId: "run-9" });
    await runtime.wait(handle.actorId);
    // ActorRepository is created against the same storage; verify a record exists.
    const { createActorRepository } = await import("../storage/repositories/sessionRepository");
    const actors = createActorRepository(storage).listByRun("run-9");
    expect(actors.length).toBe(1);
    storage.close();
  });
});

describe("forkContext", () => {
  it("builds a byte-stable ForkContext from parent messages", () => {
    const messages = [{ role: "system" as const, content: "s" }, { role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }];
    const a = buildForkContext({ parentRunId: "r1", parentMessages: messages, system: "s", frozenAt: 5 });
    const b = buildForkContext({ parentRunId: "r1", parentMessages: messages, system: "s", frozenAt: 5 });
    expect(serializeCachePrefix(a.cachePrefix)).toBe(serializeCachePrefix(b.cachePrefix));
    expect(a.frozenAt).toBe(5);
    expect(a.parentRunId).toBe("r1");
  });
});

describe("checkpointWriterActor (rule-based fallback)", () => {
  it("cold-reads trajectory and writes a markdown-v1 checkpoint via the repository", async () => {
    const storage = await createInMemoryStorage();
    const runs = createRunRepository(storage);
    const ck = createCheckpointRepository(storage);
    runs.create({ id: "run-1", taskId: "task-1", taskName: "T", skillName: "s", status: "executing", summary: "", events: [], startedAt: "2026-06-19T00:00:00.000Z", finishedAt: "" });
    const ev = (seq: number, type: AgentTrajectoryEvent["type"]): AgentTrajectoryEvent => ({
      id: `e-${seq}`, runId: "run-1", type, sequence: seq, payload: {},
      redaction: { containsApiKey: false, containsFileContent: false, containsUserText: false },
      createdAt: `2026-06-19T00:00:0${seq}.000Z`,
    });
    runs.appendTrajectory("run-1", ev(1, "goal_planned"));
    runs.appendTrajectory("run-1", ev(2, "milestone_started"));

    const forkContext: ForkContext = buildForkContext({ parentRunId: "run-1", parentMessages: [], system: "s", frozenAt: 0 });
    const outcome = await runCheckpointWriterActor(
      { contextMode: "full", lifecycle: "ephemeral", task: "write checkpoint", parentRunId: "run-1", forkContext },
      forkContext,
      new AbortController().signal,
      { runRepository: runs, checkpointRepository: ck, resolveGoal: () => ({ goal: baseGoal(), ledgerEvents: [] }), now: () => "2026-06-19T00:00:00.000Z" },
    );
    expect(outcome.status).toBe("done");
    expect(outcome.filesTouched.length).toBe(1);
    const latest = ck.latest("run-1", "markdown");
    expect(latest).not.toBeNull();
    const data = latest!.payload as { format: string; content: string; source: string };
    expect(data.format).toBe("markdown-v1");
    expect(data.source).toBe("p5-fork");
    expect(data.content).toContain("# Checkpoint — run-1");
    expect(data.content).toContain(NEVER_COMPACT_MARKER);
    storage.close();
  });

  it("returns error outcome when parentRunId is missing", async () => {
    const storage = await createInMemoryStorage();
    const outcome = await runCheckpointWriterActor(
      { contextMode: "full", lifecycle: "ephemeral", task: "x" },
      undefined,
      new AbortController().signal,
      { runRepository: createRunRepository(storage), checkpointRepository: createCheckpointRepository(storage) },
    );
    expect(outcome.status).toBe("error");
    storage.close();
  });

  it("does not write a checkpoint after cancellation", async () => {
    const storage = await createInMemoryStorage();
    const runs = createRunRepository(storage);
    const checkpoints = createCheckpointRepository(storage);
    const controller = new AbortController();
    controller.abort(new Error("stop checkpoint actor"));

    const outcome = await runCheckpointWriterActor(
      {
        contextMode: "state",
        lifecycle: "ephemeral",
        task: "write checkpoint",
        parentRunId: "run-canceled",
      },
      undefined,
      controller.signal,
      { runRepository: runs, checkpointRepository: checkpoints },
    );

    expect(outcome.status).toBe("canceled");
    expect(checkpoints.latest("run-canceled", "markdown")).toBeNull();
    storage.close();
  });
});

describe("checkpointWriterOrchestrator", () => {
  it("maybeWriteCheckpoint spawns the fork actor and returns its outcome (p5-fork default)", async () => {
    const storage = await createInMemoryStorage();
    const runs = createRunRepository(storage);
    const ck = createCheckpointRepository(storage);
    runs.create({ id: "run-1", taskId: "t", taskName: "T", skillName: "s", status: "executing", summary: "", events: [], startedAt: "2026-06-19T00:00:00.000Z", finishedAt: "" });
    const orchestrator = createCheckpointWriterOrchestrator({
      runRepository: runs, checkpointRepository: ck,
      resolveGoal: () => ({ goal: baseGoal(), ledgerEvents: [] }),
    });
    const outcome = await orchestrator.maybeWriteCheckpoint({ parentRunId: "run-1", parentMessages: [] });
    expect(outcome?.status).toBe("done");
    expect(ck.latest("run-1", "markdown")).not.toBeNull();
    storage.close();
  });

  it("returns null when flag is off", async () => {
    const storage = await createInMemoryStorage();
    const runs = createRunRepository(storage);
    const ck = createCheckpointRepository(storage);
    const orig = process.env.ZEROX_CHECKPOINT_WRITER;
    process.env.ZEROX_CHECKPOINT_WRITER = "off";
    const orchestrator = createCheckpointWriterOrchestrator({ runRepository: runs, checkpointRepository: ck });
    const outcome = await orchestrator.maybeWriteCheckpoint({ parentRunId: "run-1", parentMessages: [] });
    expect(outcome).toBeNull();
    process.env.ZEROX_CHECKPOINT_WRITER = orig;
    storage.close();
  });
});

describe("checkpointWriterOptions", () => {
  it("defaults to p5-fork", () => {
    expect(resolveCheckpointWriterFlag({})).toBe("p5-fork");
    expect(resolveCheckpointWriterFlag({ ZEROX_CHECKPOINT_WRITER: "p2-transition" })).toBe("p2-transition");
    expect(resolveCheckpointWriterFlag({ ZEROX_CHECKPOINT_WRITER: "off" })).toBe("off");
  });
});
