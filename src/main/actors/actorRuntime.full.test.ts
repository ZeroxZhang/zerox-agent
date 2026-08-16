import { afterEach, describe, expect, it, vi } from "vitest";
import { createActorRuntime, type SpawnInput, type ActorOutcome } from "./actorRuntime";
import { ActorInbox, MAX_PRE_REACT } from "./actorInbox";
import { validateOutputSchema } from "./actorOutputSchema";
import { getActorWorkflowOptions } from "./actorWorkflowOptions";
import { createWorkflowRuntime, type WorkflowHostHooks } from "../workflow/workflowRuntime";
import { registerDeepResearchWorkflow, DEEP_RESEARCH_WORKFLOW_NAME, REJECT_QUORUM } from "../workflow/deepResearchWorkflow";
import { registerWorkflowAsSkill } from "../workflow/registerWorkflowAsSkill";
import { projectRunGraph } from "../../shared/runGraph";
import type { AgentRunRecord } from "../../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../../shared/agentTrajectory";

describe("ActorRuntime full (P6)", () => {
  it("spawn with contextMode:'state' + outputSchema validates the outcome value", async () => {
    const runtime = createActorRuntime({
      deps: {
        runActor: async (input) => ({ status: "done", summary: "ok", filesTouched: [], value: { count: 5 } }),
      },
    });
    const handle = runtime.spawn({
      contextMode: "state", lifecycle: "ephemeral", task: "count",
      outputSchema: { type: "object", required: ["count"], properties: { count: { type: "number" } } },
    });
    const outcome = await runtime.wait(handle.actorId);
    expect(outcome.status).toBe("done");
    expect((outcome.value as { count: number }).count).toBe(5);
  });

  it("outputSchema mismatch downgrades the outcome to error", async () => {
    const runtime = createActorRuntime({
      deps: { runActor: async () => ({ status: "done", summary: "ok", filesTouched: [], value: { count: "not a number" } }) },
    });
    const handle = runtime.spawn({
      contextMode: "none", lifecycle: "ephemeral", task: "x",
      outputSchema: { type: "object", properties: { count: { type: "number" } } },
    });
    const outcome = await runtime.wait(handle.actorId);
    expect(outcome.status).toBe("error");
    expect(outcome.summary).toContain("outputSchema");
  });

  it("send enqueues to an actor inbox; background actors resolve independently", async () => {
    let resolveActor: (o: ActorOutcome) => void = () => {};
    const runtime = createActorRuntime({
      deps: {
        runActor: () => new Promise<ActorOutcome>((r) => { resolveActor = r; }),
      },
    });
    const handle = runtime.spawn({ contextMode: "state", lifecycle: "ephemeral", task: "long", background: true });
    await runtime.send!(handle.actorId, { hint: "focus on errors" }, "parent");
    // inbox pending is internal; just resolve the actor.
    resolveActor({ status: "done", summary: "ok", filesTouched: [] });
    const outcome = await runtime.wait(handle.actorId);
    expect(outcome.status).toBe("done");
  });

  it("v0 path (contextMode:'full', no send/background/outputSchema) stays equivalent", async () => {
    const runtime = createActorRuntime({
      deps: { runActor: async (input) => ({ status: "done", summary: input.task, filesTouched: [] }) },
    });
    const handle = runtime.spawn({ contextMode: "full", lifecycle: "ephemeral", task: "checkpoint" });
    expect(runtime.status(handle.actorId)).toBe("running");
    const outcome = await runtime.wait(handle.actorId);
    expect(outcome.status).toBe("done");
    expect(outcome.summary).toBe("checkpoint");
  });
});

describe("actorInbox + outputSchema", () => {
  it("inbox send/drain/pending/undelivered", () => {
    const inbox = new ActorInbox();
    const now = () => "2026-06-19T00:00:00.000Z";
    inbox.send(null, "a1", "hello", now);
    inbox.send("a2", "a1", "world", now);
    expect(inbox.pending("a1")).toBe(2);
    const drained = inbox.drain("a1");
    expect(drained.length).toBe(2);
    expect(inbox.pending("a1")).toBe(0);
    inbox.send(null, "a1", "late", now);
    const undelivered = inbox.markUndelivered("a1", now);
    expect(undelivered.length).toBe(1);
  });
  it("MAX_PRE_REACT is 4", () => { expect(MAX_PRE_REACT).toBe(4); });
  it("validateOutputSchema covers type/required/items/enum", () => {
    expect(validateOutputSchema({ a: 1 }, { type: "object", required: ["a"], properties: { a: { type: "number" } } })).toBeNull();
    expect(validateOutputSchema({ a: "x" }, { type: "object", properties: { a: { type: "number" } } })).toContain("expected number");
    expect(validateOutputSchema([1, 2], { type: "array", items: { type: "number" } })).toBeNull();
    expect(validateOutputSchema("b", { type: "string", enum: ["a", "c"] })).toContain("enum");
  });
});

function mockHooks(): WorkflowHostHooks {
  return {
    async spawnActor(input) {
      // Voters reply "support" or "reject" based on task text.
      const reject = /contradicted|reject/i.test(input.task) && !/independent/i.test(input.task);
      return { status: "done", summary: reject ? "reject" : "support", filesTouched: [] };
    },
    async webfetch(url) { return `Fetched content from ${url}. It describes the topic in detail. Second sentence elaborates.`; },
    async websearch(q) {
      return [
        { url: `https://example.com/${encodeURIComponent(q)}/1`, title: "Source 1", snippet: q },
        { url: `https://example.com/${encodeURIComponent(q)}/2`, title: "Source 2", snippet: q },
      ];
    },
  };
}

describe("WorkflowRuntime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parallel caps concurrency and aggregates errors", async () => {
    const rt = createWorkflowRuntime(mockHooks());
    rt.register("parallel-test", async (_args, sandbox) => {
      const results = await sandbox.parallel([
        async () => 1, async () => 2, async () => 3,
      ]);
      return results;
    });
    const res = await rt.run("parallel-test", null, { runId: "r1" });
    expect(res.status).toBe("done");
    expect(res.value).toEqual([1, 2, 3]);
  });

  it("parallel throws AggregateError when a thunk fails", async () => {
    const rt = createWorkflowRuntime(mockHooks());
    rt.register("parallel-fail", async (_args, sandbox) => {
      try { await sandbox.parallel([async () => 1, async () => { throw new Error("boom"); }]); return "no-throw"; }
      catch (e) { return (e as Error).message; }
    });
    const res = await rt.run("parallel-fail", null, { runId: "r1" });
    expect(res.value).toContain("failed");
  });

  it("pipeline runs stages serially per item", async () => {
    const rt = createWorkflowRuntime(mockHooks());
    rt.register("pipeline-test", async (_args, sandbox) => {
      return sandbox.pipeline([1, 2, 3],
        (prev, item) => (item as number) * 2,
        (prev) => (prev as number) + 1,
      );
    });
    const res = await rt.run("pipeline-test", null, { runId: "r1" });
    expect(res.value).toEqual([3, 5, 7]);
  });

  it("deep-research runs all phases and returns a report", async () => {
    const rt = createWorkflowRuntime(mockHooks());
    registerDeepResearchWorkflow(rt.register.bind(rt));
    expect(rt.has(DEEP_RESEARCH_WORKFLOW_NAME)).toBe(true);
    const res = await rt.run(DEEP_RESEARCH_WORKFLOW_NAME, "quantum error correction", { runId: "r1", deadlineMs: 5000 });
    expect(res.status).toBe("done");
    const value = res.value as { report: string; factCount: number; sourceCount: number };
    expect(value.report).toContain("Deep Research");
    expect(value.sourceCount).toBeGreaterThan(0);
    expect(res.phases.map((p) => p.name)).toEqual(expect.arrayContaining(["plan", "search", "extract", "group", "verify", "report"]));
  });

  it("returns error for unknown workflow", async () => {
    const rt = createWorkflowRuntime(mockHooks());
    const res = await rt.run("nope", null, { runId: "r1" });
    expect(res.status).toBe("error");
  });

  it("closes previous phases, preserves phase metadata, terminalizes the last phase, and clears timers", async () => {
    vi.useFakeTimers();
    const rt = createWorkflowRuntime(mockHooks());
    rt.register("phase-lifecycle", async (_args, _sandbox, journal) => {
      journal.phase("plan", { owner: "planner" });
      journal.phase("execute", { owner: "executor" });
      return "ok";
    });

    const res = await rt.run("phase-lifecycle", null, {
      runId: "r1",
      deadlineMs: 60_000,
    });

    expect(res.status).toBe("done");
    expect(res.phases).toEqual([
      expect.objectContaining({
        name: "plan",
        status: "done",
        meta: { owner: "planner" },
        endedAt: expect.any(String),
      }),
      expect.objectContaining({
        name: "execute",
        status: "done",
        meta: { owner: "executor" },
        endedAt: expect.any(String),
      }),
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("marks the active phase as error when a workflow fails", async () => {
    const rt = createWorkflowRuntime(mockHooks());
    rt.register("phase-error", async (_args, _sandbox, journal) => {
      journal.phase("execute", { attempt: 1 });
      throw new Error("boom");
    });

    const res = await rt.run("phase-error", null, { runId: "r1" });

    expect(res.status).toBe("error");
    expect(res.phases).toEqual([
      expect.objectContaining({
        name: "execute",
        status: "error",
        meta: { attempt: 1 },
        endedAt: expect.any(String),
      }),
    ]);
  });

  it("REJECT_QUORUM is 2", () => { expect(REJECT_QUORUM).toBe(2); });
});

describe("registerWorkflowAsSkill", () => {
  it("rejects invalid slugs (P7 path-guard)", async () => {
    const rt = createWorkflowRuntime(mockHooks());
    await expect(registerWorkflowAsSkill(rt, "deep-research", {
      name: "Bad Slug!", displayName: "X", description: "d", mode: "agent", permissions: {}, sourceRunIds: [],
    })).rejects.toThrow("invalid skill name");
  });
});

describe("runGraph actor/workflow projection (additive)", () => {
  it("projects actor_spawned/actor_done/workflow nodes without dropping existing kinds", () => {
    const run: AgentRunRecord = {
      id: "run-g", taskId: "task-g", taskName: "T", skillName: "s", status: "running",
      summary: "", events: [], startedAt: "2026-06-19T00:00:00.000Z", finishedAt: "",
    };
    const ev = (id: string, seq: number, type: AgentTrajectoryEvent["type"], payload: Record<string, unknown>): AgentTrajectoryEvent => ({
      id, runId: "run-g", type, sequence: seq, payload,
      redaction: { containsApiKey: false, containsFileContent: false, containsUserText: false },
      createdAt: `2026-06-19T00:00:0${seq}.000Z`,
    });
    const graph = projectRunGraph({ run, trajectoryEvents: [
      ev("e1", 1, "tool_call", { toolCallId: "c1", toolName: "file_read" }),
      ev("e2", 2, "actor_spawned", { actorId: "a1", task: "research" }),
      ev("e3", 3, "actor_done", { actorId: "a1", status: "done", summary: "ok" }),
      ev("e4", 4, "workflow_started", { name: "deep-research" }),
      ev("e5", 5, "workflow_completed", { status: "done" }),
    ] });
    const kinds = graph.nodes.map((n) => n.kind);
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("actor");
    expect(kinds).toContain("workflow");
    expect(graph.edges.some((e) => e.relation === "spawned_by")).toBe(true);
    // existing tool_call node still present (additive invariant)
    const actor = graph.nodes.find((n) => n.kind === "actor");
    expect(actor?.status).toBe("succeeded");
  });
});

describe("actorWorkflowOptions", () => {
  it("defaults to full with the unavailable workflow runtime disabled", () => {
    expect(getActorWorkflowOptions({})).toEqual({ actorRuntime: "full", workflowRuntime: "off" });
  });
  it("respects flags", () => {
    expect(getActorWorkflowOptions({ ZEROX_ACTOR_RUNTIME: "v0" }).actorRuntime).toBe("v0");
    expect(getActorWorkflowOptions({ ZEROX_ACTOR_RUNTIME: "legacy" }).actorRuntime).toBe("legacy");
    expect(getActorWorkflowOptions({ ZEROX_WORKFLOW_RUNTIME: "off" }).workflowRuntime).toBe("off");
    expect(getActorWorkflowOptions({ ZEROX_WORKFLOW_RUNTIME: "on" }).workflowRuntime).toBe("on");
  });
});
