import { describe, expect, it } from "vitest";
import {
  createDefaultMemoryEvalCases,
  createMemoryEvalFixtures,
  runMemoryEvals,
} from "./memoryEval";
import type { MemoryRecord } from "./memory";

describe("memory eval", () => {
  it("passes when expected memories appear in top retrieval results", () => {
    const report = runMemoryEvals(
      [
        createMemory({
          id: "mem_markdown",
          title: "Markdown report preference",
          content: "User prefers Markdown reports.",
          tags: ["preference", "report"],
        }),
        createMemory({
          id: "mem_downloads",
          title: "Downloads workflow",
          content: "Inspect downloads before organizing files.",
          tags: ["downloads"],
        }),
      ],
      [
        {
          id: "markdown-preference",
          query: "Markdown report",
          expectedMemoryIds: ["mem_markdown"],
          topK: 3,
        },
      ],
    );

    expect(report).toEqual({
      total: 1,
      passed: 1,
      failed: 0,
      passRate: 1,
      failures: [],
      cases: [
        expect.objectContaining({
          id: "markdown-preference",
          passed: true,
          retrievedMemoryIds: expect.arrayContaining(["mem_markdown"]),
        }),
      ],
    });
  });

  it("fails when rejected memories are retrieved", () => {
    const report = runMemoryEvals(
      [
        createMemory({
          id: "mem_current",
          title: "Current report format",
          content: "Use Markdown for reports.",
          tags: ["report"],
        }),
        createMemory({
          id: "mem_old",
          title: "Old report format",
          content: "Use PDF for reports.",
          tags: ["report"],
        }),
      ],
      [
        {
          id: "avoid-old-format",
          query: "report format",
          expectedMemoryIds: ["mem_current"],
          rejectedMemoryIds: ["mem_old"],
          topK: 5,
        },
      ],
    );

    expect(report).toMatchObject({
      total: 1,
      passed: 0,
      failed: 1,
      passRate: 0,
      failures: [
        {
          caseId: "avoid-old-format",
          reason: 'Rejected memory "mem_old" was retrieved.',
        },
      ],
    });
  });

  it("creates deterministic default eval cases from active important memories", () => {
    const cases = createDefaultMemoryEvalCases([
      createMemory({
        id: "mem_active",
        title: "Agent memory design",
        content: "Keep memory visible.",
        importance: 5,
      }),
      createMemory({
        id: "mem_archived",
        title: "Archived memory",
        content: "old",
        archivedAt: "2026-06-08T00:00:00.000Z",
      }),
    ]);

    expect(cases).toEqual([
      {
        id: "default-mem_active",
        query: "Agent memory design",
        expectedMemoryIds: ["mem_active"],
        topK: 5,
      },
    ]);
  });

  it("ships deterministic fixtures for the CLI", () => {
    const report = runMemoryEvals(...createMemoryEvalFixtures());

    expect(report.failed).toBe(0);
    expect(report.passRate).toBe(1);
  });
});

function createMemory(
  partial: Partial<MemoryRecord> & Pick<MemoryRecord, "id" | "title" | "content">,
): MemoryRecord {
  return {
    kind: "semantic",
    tags: [],
    source: { type: "manual" },
    importance: 3,
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    ...partial,
  };
}
