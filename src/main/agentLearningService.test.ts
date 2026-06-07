import { describe, expect, it } from "vitest";
import { createAgentLearningService } from "./agentLearningService";
import type { AgentLearningCandidate } from "../shared/agentLearning";
import type { MemoryInput, MemoryRecord } from "../shared/memory";

describe("agent learning service", () => {
  it("applies accepted procedural candidates into procedural memory", async () => {
    const statusUpdates: Array<{ id: string; status: AgentLearningCandidate["status"] }> = [];
    const memoryWrites: MemoryInput[] = [];
    const candidate = createCandidate();
    const service = createAgentLearningService({
      learningStore: {
        async list(options) {
          return options?.status === "accepted" ? [candidate] : [];
        },
        async setStatus(id, status) {
          statusUpdates.push({ id, status });
          return { ...candidate, status };
        },
      },
      memoryStore: {
        async create(input) {
          memoryWrites.push(input);
          return {
            id: "memory_1",
            ...input,
            tags: input.tags ?? [],
            source: input.source ?? { type: "manual" },
            importance: input.importance ?? 3,
            createdAt: "2026-06-07T00:00:00.000Z",
            updatedAt: "2026-06-07T00:00:00.000Z",
          } as MemoryRecord;
        },
      },
    });

    await expect(service.applyAcceptedLearning()).resolves.toEqual({
      scanned: 1,
      applied: 1,
      skipped: 0,
      memoryIds: ["memory_1"],
    });
    expect(memoryWrites).toEqual([
      {
        kind: "procedural",
        title: "Procedure: List directories before reading files",
        content:
          "Claim: List directories before reading files.\nRecommended action: Use file_list before file_read when the directory shape is unknown.\nRisk: Low.",
        tags: ["agent-learning", "procedural-memory"],
        source: { type: "agent_run", refId: "run_1" },
        importance: 4,
      },
    ]);
    expect(statusUpdates).toEqual([{ id: "learn_1", status: "applied" }]);
  });
});

function createCandidate(): AgentLearningCandidate {
  return {
    id: "learn_1",
    type: "procedural_memory",
    status: "accepted",
    sourceRunId: "run_1",
    sourceTrajectoryEventIds: ["event_1"],
    claim: "List directories before reading files.",
    recommendedAction:
      "Use file_list before file_read when the directory shape is unknown.",
    risk: "Low.",
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
  };
}
