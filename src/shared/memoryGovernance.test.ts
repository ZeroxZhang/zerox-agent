import { describe, expect, it } from "vitest";
import { createMemoryGovernanceReport } from "./memoryGovernance";
import type { MemoryRecord } from "./memory";

describe("memory governance", () => {
  it("reports duplicate title groups", () => {
    const report = createMemoryGovernanceReport([
      createMemory({ id: "mem_1", title: "Agent memory design" }),
      createMemory({ id: "mem_2", title: "Agent Memory Design" }),
    ]);

    expect(report.duplicateGroups).toEqual([
      {
        key: "agent-memory-design",
        title: "Agent memory design",
        memoryIds: ["mem_1", "mem_2"],
      },
    ]);
    expect(report.recommendations).toContain(
      "合并 1 组重复标题记忆，保留来源最清晰的一条。",
    );
  });

  it("reports conflicting preference groups", () => {
    const report = createMemoryGovernanceReport([
      createMemory({
        id: "mem_markdown",
        title: "用户偏好：报告格式",
        content: "以后默认保存为 Markdown",
        tags: ["preference"],
      }),
      createMemory({
        id: "mem_pdf",
        title: "用户偏好：报告格式",
        content: "以后默认保存为 PDF",
        tags: ["preference"],
      }),
    ]);

    expect(report.conflictGroups).toEqual([
      {
        subject: "报告格式",
        memoryIds: ["mem_markdown", "mem_pdf"],
        contents: ["以后默认保存为 Markdown", "以后默认保存为 PDF"],
      },
    ]);
  });

  it("reports stale low-importance records", () => {
    const report = createMemoryGovernanceReport(
      [
        createMemory({
          id: "mem_stale",
          title: "Old transient note",
          importance: 1,
          updatedAt: "2025-01-01T00:00:00.000Z",
        }),
        createMemory({
          id: "mem_important",
          title: "Important old note",
          importance: 5,
          updatedAt: "2025-01-01T00:00:00.000Z",
        }),
      ],
      {
        now: "2026-06-08T00:00:00.000Z",
        staleAfterDays: 90,
      },
    );

    expect(report.staleLowSignalRecords).toEqual([
      {
        memoryId: "mem_stale",
        title: "Old transient note",
        ageDays: 523,
        importance: 1,
      },
    ]);
  });
});

function createMemory(partial: Partial<MemoryRecord> & { id: string }): MemoryRecord {
  return {
    kind: "semantic",
    title: "Memory",
    content: "Memory content",
    tags: [],
    source: { type: "manual" },
    importance: 3,
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    ...partial,
  };
}
