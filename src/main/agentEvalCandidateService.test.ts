import { describe, expect, it } from "vitest";
import { createAgentEvalCandidateService } from "./agentEvalCandidateService";
import type { AgentEvalCandidateStore } from "./agentEvalCandidateStore";
import type { AgentEvalFixture } from "./eval/agentEvalFixtures";
import type { AgentRunStore } from "./agentRunStore";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import type { PromotedAgentEvalFixtureStore } from "./eval/agentPromotedEvalFixtures";
import type { AgentEvalCandidate } from "../shared/agentEvalCandidate";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";

describe("agent eval candidate service", () => {
  it("generates a candidate for a terminal run and persists it", async () => {
    const run = createRun({ id: "run_1", status: "succeeded" });
    const trajectory = [
      createEvent("run_1", "tool_call"),
      createEvent("run_1", "final_summary"),
    ];
    const candidateStore = createMemoryCandidateStore();
    const service = createAgentEvalCandidateService({
      runStore: createMemoryRunStore([run]),
      trajectoryStore: createMemoryTrajectoryStore({ run_1: trajectory }),
      candidateStore,
      promotedFixtureStore: createMemoryPromotedFixtureStore(),
      now: () => new Date("2026-06-10T00:00:00.000Z"),
    });

    const result = await service.generateForRun("run_1");

    expect(result).toMatchObject({
      ok: true,
      existing: false,
      candidate: {
        id: "eval_candidate_run_1",
        sourceRunId: "run_1",
        status: "pending_review",
        createdAt: "2026-06-10T00:00:00.000Z",
        fixture: {
          id: "episode-run-1",
          events: trajectory,
          requiredEventTypes: ["tool_call", "final_summary"],
        },
      },
    });
    expect(candidateStore.candidates).toHaveLength(1);
  });

  it("reports existing true for an already-generated candidate", async () => {
    const run = createRun({ id: "run_1", status: "succeeded" });
    const trajectory = [createEvent("run_1", "final_summary")];
    const existing = createCandidate("run_1");
    const candidateStore = createMemoryCandidateStore([existing]);
    const service = createAgentEvalCandidateService({
      runStore: createMemoryRunStore([run]),
      trajectoryStore: createMemoryTrajectoryStore({ run_1: trajectory }),
      candidateStore,
      promotedFixtureStore: createMemoryPromotedFixtureStore(),
      now: () => new Date("2026-06-10T00:00:00.000Z"),
    });

    const result = await service.generateForRun("run_1");

    expect(result).toEqual({
      ok: true,
      candidate: existing,
      existing: true,
    });
    expect(candidateStore.candidates).toEqual([existing]);
  });

  it("rejects running runs", async () => {
    const service = createAgentEvalCandidateService({
      runStore: createMemoryRunStore([
        createRun({ id: "run_1", status: "running" }),
      ]),
      trajectoryStore: createMemoryTrajectoryStore({}),
      candidateStore: createMemoryCandidateStore(),
      promotedFixtureStore: createMemoryPromotedFixtureStore(),
    });

    await expect(service.generateForRun("run_1")).resolves.toEqual({
      ok: false,
      message: "只有已结束的运行可以生成 eval candidate。",
    });
  });

  it("promotes accepted candidates and marks them promoted", async () => {
    const accepted = createCandidate("run_1", "accepted");
    const candidateStore = createMemoryCandidateStore([accepted]);
    const promotedFixtureStore = createMemoryPromotedFixtureStore();
    const service = createAgentEvalCandidateService({
      runStore: createMemoryRunStore([]),
      trajectoryStore: createMemoryTrajectoryStore({}),
      candidateStore,
      promotedFixtureStore,
      now: () => new Date("2026-06-10T00:01:00.000Z"),
    });

    const result = await service.promoteAccepted(accepted.id);

    expect(result).toEqual({
      ok: true,
      candidate: {
        ...accepted,
        status: "promoted",
        updatedAt: "2026-06-10T00:01:00.000Z",
      },
      fixtureId: accepted.fixture.id,
    });
    expect(promotedFixtureStore.fixtures).toEqual([accepted.fixture]);
  });

  it("accepts only candidates that are still pending review", async () => {
    const pending = createCandidate("run_1", "pending_review");
    const promoted = createCandidate("run_2", "promoted");
    const candidateStore = createMemoryCandidateStore([pending, promoted]);
    const service = createAgentEvalCandidateService({
      runStore: createMemoryRunStore([]),
      trajectoryStore: createMemoryTrajectoryStore({}),
      candidateStore,
      promotedFixtureStore: createMemoryPromotedFixtureStore(),
    });

    await expect(service.acceptCandidate(pending.id)).resolves.toMatchObject({
      id: pending.id,
      status: "accepted",
    });
    await expect(service.acceptCandidate(promoted.id)).resolves.toBeNull();
    await expect(service.acceptCandidate("missing")).resolves.toBeNull();
    expect(candidateStore.candidates.find((candidate) => candidate.id === promoted.id))
      .toEqual(promoted);
  });

  it("rejects only candidates that are still pending review", async () => {
    const pending = createCandidate("run_1", "pending_review");
    const accepted = createCandidate("run_2", "accepted");
    const candidateStore = createMemoryCandidateStore([pending, accepted]);
    const service = createAgentEvalCandidateService({
      runStore: createMemoryRunStore([]),
      trajectoryStore: createMemoryTrajectoryStore({}),
      candidateStore,
      promotedFixtureStore: createMemoryPromotedFixtureStore(),
    });

    await expect(service.rejectCandidate(pending.id)).resolves.toMatchObject({
      id: pending.id,
      status: "rejected",
    });
    await expect(service.rejectCandidate(accepted.id)).resolves.toBeNull();
    await expect(service.rejectCandidate("missing")).resolves.toBeNull();
    expect(candidateStore.candidates.find((candidate) => candidate.id === accepted.id))
      .toEqual(accepted);
  });
});

function createMemoryRunStore(runs: AgentRunRecord[]): AgentRunStore {
  return {
    async append(run) {
      runs.push(run);
      return run;
    },
    async get(runId) {
      return runs.find((run) => run.id === runId) ?? null;
    },
    async list() {
      return runs;
    },
  };
}

function createMemoryTrajectoryStore(
  trajectories: Record<string, AgentTrajectoryEvent[]>,
): AgentTrajectoryStore {
  return {
    async append(runId, event) {
      trajectories[runId] = [...(trajectories[runId] ?? []), event];
      return event;
    },
    async list(runId) {
      return trajectories[runId] ?? [];
    },
  };
}

function createMemoryCandidateStore(initial: AgentEvalCandidate[] = []) {
  const store: AgentEvalCandidateStore & { candidates: AgentEvalCandidate[] } = {
    candidates: [...initial],
    async create(candidate) {
      const existing = store.candidates.find(
        (item) =>
          item.id === candidate.id ||
          (item.sourceRunId === candidate.sourceRunId &&
            item.fixture.id === candidate.fixture.id),
      );
      if (existing) {
        return existing;
      }

      store.candidates.push(candidate);
      return candidate;
    },
    async list(options) {
      return store.candidates.filter((candidate) =>
        options?.status ? candidate.status === options.status : true,
      );
    },
    async setStatus(candidateId, status) {
      const candidateIndex = store.candidates.findIndex(
        (candidate) => candidate.id === candidateId,
      );
      if (candidateIndex === -1) {
        return null;
      }

      const updated = {
        ...store.candidates[candidateIndex],
        status,
        updatedAt: "2026-06-10T00:01:00.000Z",
      };
      store.candidates[candidateIndex] = updated;
      return updated;
    },
    async transitionStatus(candidateId, expectedStatus, nextStatus) {
      const candidateIndex = store.candidates.findIndex(
        (candidate) => candidate.id === candidateId,
      );
      if (
        candidateIndex === -1 ||
        store.candidates[candidateIndex].status !== expectedStatus
      ) {
        return null;
      }

      const updated = {
        ...store.candidates[candidateIndex],
        status: nextStatus,
        updatedAt: "2026-06-10T00:01:00.000Z",
      };
      store.candidates[candidateIndex] = updated;
      return updated;
    },
  };
  return store;
}

function createMemoryPromotedFixtureStore() {
  const store: PromotedAgentEvalFixtureStore & { fixtures: AgentEvalFixture[] } = {
    fixtures: [],
    async list() {
      return store.fixtures;
    },
    async upsert(fixture) {
      const existingIndex = store.fixtures.findIndex(
        (item) => item.id === fixture.id,
      );
      if (existingIndex === -1) {
        store.fixtures.push(fixture);
      } else {
        store.fixtures[existingIndex] = fixture;
      }
      return fixture;
    },
  };
  return store;
}

function createRun(input: {
  id: string;
  status: AgentRunRecord["status"];
}): AgentRunRecord {
  return {
    id: input.id,
    taskId: `task_${input.id}`,
    taskName: `Task ${input.id}`,
    skillName: "test-skill",
    status: input.status,
    summary: "Finished.",
    events: [],
    startedAt: "2026-06-10T00:00:00.000Z",
    finishedAt: "2026-06-10T00:00:01.000Z",
  };
}

function createEvent(
  runId: string,
  type: AgentTrajectoryEvent["type"],
): AgentTrajectoryEvent {
  return {
    id: `${runId}_${type}`,
    runId,
    type,
    sequence: type === "tool_call" ? 1 : 2,
    payload: {},
    redaction: {
      containsApiKey: false,
      containsFileContent: false,
      containsUserText: false,
    },
    createdAt: "2026-06-10T00:00:00.000Z",
  };
}

function createCandidate(
  runId: string,
  status: AgentEvalCandidate["status"] = "pending_review",
): AgentEvalCandidate {
  return {
    id: `eval_candidate_${runId}`,
    sourceRunId: runId,
    status,
    rationale: "Generated from test evidence.",
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    fixture: {
      id: `episode-${runId.replace(/_/g, "-")}`,
      description: `Episode candidate from ${runId}`,
      events: [createEvent(runId, "final_summary")],
      requiredEventTypes: ["final_summary"],
    },
  };
}
