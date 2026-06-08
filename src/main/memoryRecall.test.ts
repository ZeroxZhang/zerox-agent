import { describe, expect, it } from "vitest";
import {
  formatMemoryRecallContext,
  recallMemoriesWithBudget,
} from "./memoryRecall";
import type { MemoryRecord, MemorySearchResult } from "../shared/memory";

describe("memory recall runtime helper", () => {
  it("returns no memories when recall exceeds the timeout", async () => {
    const results = await recallMemoriesWithBudget({
      memoryStore: {
        search: () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve([
                  createResult({
                    id: "mem_slow",
                    title: "Slow memory",
                    content: "This result arrived too late.",
                  }),
                ]),
              20,
            ),
          ),
      },
      query: "slow",
      limit: 3,
      timeoutMs: 1,
    });

    expect(results).toEqual([]);
  });

  it("passes the query, kind, and limit through to the memory store", async () => {
    const searches: unknown[] = [];
    const results = await recallMemoriesWithBudget({
      memoryStore: {
        async search(options) {
          searches.push(options);
          return [
            createResult({
              id: "mem_procedure",
              title: "Procedure",
              content: "Use file_list before file_read.",
            }),
          ];
        },
      },
      query: "file workflow",
      kind: "procedural",
      limit: 3,
      timeoutMs: 50,
    });

    expect(searches).toEqual([
      {
        query: "file workflow",
        kind: "procedural",
        limit: 3,
      },
    ]);
    expect(results.map((result) => result.record.id)).toEqual(["mem_procedure"]);
  });

  it("truncates each memory and stops before exceeding the total prompt budget", () => {
    const context = formatMemoryRecallContext(
      [
        createResult({
          id: "mem_first",
          title: "first",
          content: "A".repeat(50),
        }),
        createResult({
          id: "mem_second",
          title: "second",
          content: "B".repeat(50),
        }),
      ],
      {
        heading: "相关记忆：",
        maxCharsPerMemory: 12,
        maxTotalRecallChars: 48,
      },
    );

    expect(context).toBe("相关记忆：\n- first：AAAAAAAAAAA…");
  });

  it("returns null when no memory line fits the total budget", () => {
    expect(
      formatMemoryRecallContext(
        [
          createResult({
            id: "mem_large",
            title: "large",
            content: "large memory",
          }),
        ],
        {
          heading: "相关记忆：",
          maxCharsPerMemory: 50,
          maxTotalRecallChars: 8,
        },
      ),
    ).toBeNull();
  });
});

function createResult(options: {
  id: string;
  title: string;
  content: string;
}): MemorySearchResult {
  return {
    record: createRecord(options),
    score: 4,
    matchedTerms: [],
  };
}

function createRecord(options: {
  id: string;
  title: string;
  content: string;
}): MemoryRecord {
  return {
    id: options.id,
    kind: "semantic",
    title: options.title,
    content: options.content,
    tags: [],
    source: { type: "manual" },
    importance: 3,
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
  };
}
