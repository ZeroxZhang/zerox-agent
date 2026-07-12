import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMemoryStore,
  MemoryValidationError,
} from "./memoryStore";

describe("memory store", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-memory-"));
  });

  afterEach(async () => {
    await rm(configDir, { force: true, recursive: true });
  });

  it("starts empty when no memory file exists", async () => {
    const store = createMemoryStore({ configDir });

    await expect(store.list()).resolves.toEqual([]);
  });

  it("creates and persists normalized memory records", async () => {
    const store = createMemoryStore({
      configDir,
      createId: () => "mem_123",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });

    const created = await store.create({
      kind: "semantic",
      title: "  Agent memory design  ",
      content: "  Long-term memory should be inspectable and deletable.  ",
      tags: [" Agent ", "memory", ""],
      importance: 4,
      source: { type: "manual" },
    });

    expect(created).toEqual({
      id: "mem_123",
      kind: "semantic",
      title: "Agent memory design",
      content: "Long-term memory should be inspectable and deletable.",
      tags: ["agent", "memory"],
      importance: 4,
      source: { type: "manual" },
      layer: "manual_required",
      createdAt: "2026-06-05T08:00:00.000Z",
      updatedAt: "2026-06-05T08:00:00.000Z",
    });

    const reloaded = createMemoryStore({ configDir });
    await expect(reloaded.list()).resolves.toEqual([created]);
  });

  it("serializes concurrent creates without losing either record", async () => {
    const store = createMemoryStore({
      configDir,
      createId: createSequentialId("mem"),
      now: createSteppedClock("2026-06-05T08:00:00.000Z"),
      embeddingService: {
        async embed(text) {
          if (text.includes("first")) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          return null;
        },
      },
    });

    await Promise.all([
      store.create({
        kind: "semantic",
        title: "first",
        content: "first memory",
      }),
      store.create({
        kind: "semantic",
        title: "second",
        content: "second memory",
      }),
    ]);

    await expect(store.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "first" }),
        expect.objectContaining({ title: "second" }),
      ]),
    );
    expect(await readdir(configDir)).toEqual(["memory-records.json"]);
  });

  it("rejects invalid memory input with structured errors", async () => {
    const store = createMemoryStore({ configDir });

    await expect(
      store.create({
        kind: "core",
        title: "",
        content: "",
      }),
    ).rejects.toEqual(
      new MemoryValidationError({
        title: "记忆标题必填。",
        content: "记忆内容必填。",
      }),
    );
  });

  it("filters and searches memory records", async () => {
    const store = createMemoryStore({
      configDir,
      createId: createSequentialId("mem"),
      now: createSteppedClock("2026-06-05T08:00:00.000Z"),
    });
    await store.create({
      kind: "core",
      title: "Agent memory design",
      content: "Keep long-term memory visible and deletable.",
      tags: ["agent", "memory"],
    });
    await store.create({
      kind: "episodic",
      title: "Run: organize downloads",
      content: "Agent generated a Markdown report.",
      tags: ["agent-run"],
      source: { type: "agent_run", refId: "run_1" },
    });
    await store.create({
      kind: "procedural",
      title: "How to handle memory",
      content: "Search memory before running a scheduled task.",
    });

    const episodic = await store.list({ kind: "episodic" });
    const searchResults = await store.search({ query: "agent memory" });

    expect(episodic).toHaveLength(1);
    expect(episodic[0].title).toBe("Run: organize downloads");
    expect(searchResults.map((result) => result.record.title)).toEqual([
      "Agent memory design",
      "How to handle memory",
      "Run: organize downloads",
    ]);
    expect(searchResults[0].score).toBeGreaterThan(searchResults[1].score);
  });

  it("stores embeddings and uses query embeddings when an embedding service is available", async () => {
    const store = createMemoryStore({
      configDir,
      createId: createSequentialId("mem"),
      now: () => new Date("2026-06-05T08:00:00.000Z"),
      embeddingService: {
        async embed(text) {
          return {
            model: "text-embedding-example",
            vector: text.toLowerCase().includes("calendar") ? [0, 1] : [1, 0],
          };
        },
      },
    });

    await store.create({
      kind: "semantic",
      title: "Calendar preference",
      content: "Morning tasks work better.",
    });
    const agentMemory = await store.create({
      kind: "semantic",
      title: "Agent memory architecture",
      content: "Use semantic recall before scheduled tasks.",
    });

    expect(agentMemory.embedding).toEqual({
      model: "text-embedding-example",
      dimensions: 2,
      vector: [1, 0],
      embeddedAt: "2026-06-05T08:00:00.000Z",
    });

    await expect(store.search({ query: "calendar" })).resolves.toMatchObject([
      {
        record: {
          title: "Calendar preference",
        },
        score: 103,
      },
    ]);
  });

  it("runs maintenance by creating consolidated memory and archiving sources", async () => {
    const store = createMemoryStore({
      configDir,
      createId: createSequentialId("mem"),
      now: createSteppedClock("2026-06-05T09:00:00.000Z"),
    });
    await store.create({
      kind: "episodic",
      title: "Run: organize downloads",
      content: "Created a downloads report for invoices.",
      tags: ["downloads", "agent-run"],
      source: { type: "agent_run", refId: "run_1" },
    });
    await store.create({
      kind: "session",
      title: "Downloads cleanup note",
      content: "User wants reports written as Markdown.",
      tags: ["downloads"],
    });
    await store.create({
      kind: "episodic",
      title: "Run: organize screenshots",
      content: "Grouped screenshots by date.",
      tags: ["downloads", "agent-run"],
      source: { type: "agent_run", refId: "run_2" },
    });

    const report = await store.runMaintenance({
      minTopicGroupSize: 3,
      createdAt: "2026-06-05T09:10:00.000Z",
    });

    expect(report).toMatchObject({
      scanned: 3,
      candidates: 3,
      consolidated: 1,
      archived: 3,
      skipped: 0,
      createdAt: "2026-06-05T09:10:00.000Z",
      createdMemories: [
        {
          id: "mem_4",
          kind: "semantic",
          title: "Consolidated memory: downloads",
          source: { type: "system" },
          consolidation: {
            strategy: "topic-rollup",
            sourceIds: ["mem_1", "mem_2", "mem_3"],
            createdAt: "2026-06-05T09:10:00.000Z",
          },
        },
      ],
    });

    await expect(store.list()).resolves.toMatchObject([
      {
        id: "mem_4",
        title: "Consolidated memory: downloads",
      },
    ]);
    await expect(store.list({ includeArchived: true })).resolves.toMatchObject([
      {
        id: "mem_1",
        archivedAt: "2026-06-05T09:10:00.000Z",
        archiveReason: "consolidated",
        consolidatedInto: "mem_4",
      },
      {
        id: "mem_2",
        archivedAt: "2026-06-05T09:10:00.000Z",
        archiveReason: "consolidated",
        consolidatedInto: "mem_4",
      },
      {
        id: "mem_3",
        archivedAt: "2026-06-05T09:10:00.000Z",
        archiveReason: "consolidated",
        consolidatedInto: "mem_4",
      },
      {
        id: "mem_4",
      },
    ]);
    await expect(store.search({ query: "screenshots" })).resolves.toHaveLength(1);
  });

  it("deletes memory records by id", async () => {
    const store = createMemoryStore({
      configDir,
      createId: createSequentialId("mem"),
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });
    const first = await store.create({
      kind: "session",
      title: "Scratch note",
      content: "Temporary context.",
    });
    const second = await store.create({
      kind: "semantic",
      title: "Durable note",
      content: "Useful later.",
    });

    await expect(store.delete(first.id)).resolves.toBe(true);
    await expect(store.delete("missing")).resolves.toBe(false);
    await expect(store.list()).resolves.toEqual([second]);
  });

  it("reviews memory governance without mutating records", async () => {
    const store = createMemoryStore({
      configDir,
      createId: createSequentialId("mem"),
      now: () => new Date("2025-01-01T00:00:00.000Z"),
    });
    await store.create({
      kind: "semantic",
      title: "Agent memory design",
      content: "Memory must be visible.",
      importance: 4,
    });
    await store.create({
      kind: "semantic",
      title: "Agent memory design",
      content: "Memory must be deletable.",
      importance: 4,
    });
    await store.create({
      kind: "session",
      title: "Old scratch note",
      content: "Temporary context.",
      importance: 1,
    });

    const report = await store.reviewGovernance({
      now: "2026-06-08T00:00:00.000Z",
      staleAfterDays: 90,
    });

    expect(report).toMatchObject({
      scanned: 3,
      duplicateGroups: [
        {
          title: "Agent memory design",
          memoryIds: ["mem_1", "mem_2"],
        },
      ],
      staleLowSignalRecords: [
        {
          memoryId: "mem_3",
          title: "Old scratch note",
          importance: 1,
        },
      ],
    });
    await expect(store.list()).resolves.toHaveLength(3);
  });

  it("exports all memory as formatted JSON", async () => {
    const store = createMemoryStore({
      configDir,
      createId: () => "mem_export",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });
    await store.create({
      kind: "core",
      title: "Local privacy",
      content: "Memory stays on this machine.",
    });

    await expect(store.export()).resolves.toBe(
      `${JSON.stringify(
        {
          schemaVersion: 1,
          exportedAt: "2026-06-05T08:00:00.000Z",
          records: [
            {
              id: "mem_export",
              kind: "core",
              title: "Local privacy",
              content: "Memory stays on this machine.",
              tags: [],
              source: { type: "manual" },
              layer: "manual_required",
              importance: 3,
              createdAt: "2026-06-05T08:00:00.000Z",
              updatedAt: "2026-06-05T08:00:00.000Z",
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
  });
});

function createSequentialId(prefix: string): () => string {
  let index = 0;
  return () => {
    index += 1;
    return `${prefix}_${index}`;
  };
}

function createSteppedClock(startIso: string): () => Date {
  let offset = 0;
  const start = new Date(startIso).getTime();

  return () => {
    const date = new Date(start + offset);
    offset += 1000;
    return date;
  };
}
