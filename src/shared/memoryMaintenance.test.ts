import { describe, expect, it } from "vitest";
import {
  createMemoryMaintenancePlan,
  type MemoryMaintenancePlan,
} from "./memoryMaintenance";
import type { MemoryRecord } from "./memory";

describe("memory maintenance planner", () => {
  it("creates topic rollup drafts for repeated active session and episodic memories", () => {
    const plan = createMemoryMaintenancePlan(
      [
        createRecord({
          id: "mem_1",
          kind: "episodic",
          title: "Run: organize downloads",
          content: "Created a downloads report for invoices.",
          tags: ["downloads", "agent-run"],
          source: { type: "agent_run", refId: "run_1" },
        }),
        createRecord({
          id: "mem_2",
          kind: "session",
          title: "Downloads cleanup note",
          content: "User wants reports written as Markdown.",
          tags: ["downloads"],
        }),
        createRecord({
          id: "mem_3",
          kind: "episodic",
          title: "Run: organize screenshots",
          content: "Grouped screenshots by date.",
          tags: ["downloads", "agent-run"],
          source: { type: "agent_run", refId: "run_2" },
        }),
      ],
      {
        createdAt: "2026-06-05T09:00:00.000Z",
        minTopicGroupSize: 3,
      },
    );

    expectPlan(plan, {
      scanned: 3,
      candidates: 3,
      drafts: [
        {
          strategy: "topic-rollup",
          sourceIds: ["mem_1", "mem_2", "mem_3"],
          kind: "semantic",
          title: "Consolidated memory: downloads",
          tags: ["downloads", "agent-run", "consolidated"],
          source: { type: "system" },
          importance: 3,
          consolidation: {
            strategy: "topic-rollup",
            sourceIds: ["mem_1", "mem_2", "mem_3"],
            createdAt: "2026-06-05T09:00:00.000Z",
          },
        },
      ],
    });
    expect(plan.drafts[0].content).toContain(
      "Consolidated 3 memories about downloads.",
    );
    expect(plan.drafts[0].content).toContain(
      "- Run: organize downloads: Created a downloads report for invoices.",
    );
  });

  it("prefers duplicate-title merge drafts before topic rollups", () => {
    const plan = createMemoryMaintenancePlan(
      [
        createRecord({
          id: "mem_1",
          kind: "semantic",
          title: "Agent memory design",
          content: "Memory must be visible.",
          tags: ["memory"],
        }),
        createRecord({
          id: "mem_2",
          kind: "semantic",
          title: "Agent memory design",
          content: "Memory must be deletable.",
          tags: ["memory"],
        }),
        createRecord({
          id: "mem_3",
          kind: "semantic",
          title: "Agent memory design",
          content: "Memory should support export.",
          tags: ["memory"],
        }),
      ],
      {
        createdAt: "2026-06-05T09:00:00.000Z",
        minDuplicateGroupSize: 2,
        minTopicGroupSize: 3,
      },
    );

    expect(plan.drafts).toHaveLength(1);
    expect(plan.drafts[0]).toMatchObject({
      strategy: "duplicate-title",
      sourceIds: ["mem_1", "mem_2", "mem_3"],
      title: "Merged memory: Agent memory design",
      consolidation: {
        strategy: "duplicate-title",
        sourceIds: ["mem_1", "mem_2", "mem_3"],
      },
    });
  });

  it("skips archived records and existing consolidated memories", () => {
    const plan = createMemoryMaintenancePlan(
      [
        createRecord({
          id: "mem_archived",
          kind: "semantic",
          title: "Agent memory design",
          content: "Old source.",
          tags: ["memory"],
          archivedAt: "2026-06-05T08:30:00.000Z",
        }),
        createRecord({
          id: "mem_consolidated",
          kind: "semantic",
          title: "Consolidated memory: memory",
          content: "Already summarized.",
          tags: ["memory", "consolidated"],
          consolidation: {
            strategy: "topic-rollup",
            sourceIds: ["mem_1", "mem_2"],
            createdAt: "2026-06-05T08:30:00.000Z",
          },
        }),
      ],
      { createdAt: "2026-06-05T09:00:00.000Z" },
    );

    expect(plan).toMatchObject({
      scanned: 2,
      candidates: 0,
      drafts: [],
    });
  });
});

function expectPlan(
  plan: MemoryMaintenancePlan,
  expected: object,
) {
  expect(plan).toMatchObject(expected);
}

function createRecord(
  partial: Pick<
    MemoryRecord,
    "content" | "id" | "kind" | "tags" | "title"
  > &
    Partial<
      Pick<
        MemoryRecord,
        | "archiveReason"
        | "archivedAt"
        | "consolidatedInto"
        | "consolidation"
        | "source"
      >
    >,
): MemoryRecord {
  return {
    source: { type: "manual" },
    importance: 3,
    createdAt: "2026-06-05T08:00:00.000Z",
    updatedAt: "2026-06-05T08:00:00.000Z",
    ...partial,
  };
}
