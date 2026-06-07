import { describe, expect, it } from "vitest";
import {
  exportMemoryRecords,
  getMemoryKindLabel,
  normalizeMemoryInput,
  searchMemoryRecords,
  validateMemoryInput,
  type MemoryRecord,
} from "./memory";

describe("memory model", () => {
  it("normalizes memory input with safe defaults", () => {
    expect(
      normalizeMemoryInput({
        kind: "semantic",
        title: "  Agent memory design  ",
        content: "  Store durable facts.  ",
        tags: [" agent ", "", "memory", "agent"],
      }),
    ).toEqual({
      kind: "semantic",
      title: "Agent memory design",
      content: "Store durable facts.",
      tags: ["agent", "memory"],
      source: { type: "manual" },
      importance: 3,
    });
  });

  it("validates required title, content, kind, and importance", () => {
    expect(
      validateMemoryInput({
        kind: "unknown",
        title: "",
        content: "",
        tags: [],
        source: { type: "manual" },
        importance: 9,
      }),
    ).toEqual({
      valid: false,
      errors: {
        kind: "记忆类型无效。",
        title: "记忆标题必填。",
        content: "记忆内容必填。",
        importance: "重要度必须在 1 到 5 之间。",
      },
    });
  });

  it("labels every MVP memory kind", () => {
    expect(getMemoryKindLabel("core")).toBe("核心记忆");
    expect(getMemoryKindLabel("session")).toBe("会话记忆");
    expect(getMemoryKindLabel("semantic")).toBe("语义记忆");
    expect(getMemoryKindLabel("episodic")).toBe("情景记忆");
    expect(getMemoryKindLabel("procedural")).toBe("流程记忆");
  });
});

describe("memory retrieval and export", () => {
  const records: MemoryRecord[] = [
    createRecord({
      id: "mem_1",
      kind: "semantic",
      title: "Agent memory design",
      content: "Use semantic memory for durable facts about user preferences.",
      tags: ["agent", "memory"],
      importance: 4,
    }),
    createRecord({
      id: "mem_2",
      kind: "procedural",
      title: "Run local organizer",
      content: "Use the local-file-organizer skill for download cleanup.",
      tags: ["skill"],
      importance: 3,
    }),
    createRecord({
      id: "mem_3",
      kind: "episodic",
      title: "Yesterday run",
      content: "The agent produced a report about invoices.",
      tags: ["run"],
      importance: 2,
    }),
  ];

  it("searches memories with lexical fallback when embeddings are unavailable", () => {
    expect(searchMemoryRecords(records, { query: "agent memory" })).toEqual([
      {
        record: records[0],
        score: 12,
        matchedTerms: ["agent", "memory"],
      },
      {
        record: records[2],
        score: 1,
        matchedTerms: ["agent"],
      },
    ]);
  });

  it("filters search by kind", () => {
    expect(
      searchMemoryRecords(records, { query: "agent", kind: "episodic" }),
    ).toEqual([
      {
        record: records[2],
        score: 1,
        matchedTerms: ["agent"],
      },
    ]);
  });

  it("exports records as deterministic JSON", () => {
    expect(exportMemoryRecords(records.slice(0, 1))).toBe(
      `${JSON.stringify(
        {
          schemaVersion: 1,
          exportedAt: "2026-06-05T08:00:00.000Z",
          records: [records[0]],
        },
        null,
        2,
      )}\n`,
    );
  });

  it("uses vector similarity when query embeddings are available", () => {
    const embeddedRecords: MemoryRecord[] = [
      createRecord({
        id: "mem_vector_1",
        kind: "semantic",
        title: "Calendar preference",
        content: "Morning tasks are easier to schedule.",
        tags: [],
        importance: 3,
        embedding: {
          model: "text-embedding-example",
          dimensions: 2,
          vector: [0, 1],
          embeddedAt: "2026-06-05T08:00:00.000Z",
        },
      }),
      createRecord({
        id: "mem_vector_2",
        kind: "semantic",
        title: "Agent memory architecture",
        content: "Use semantic recall before scheduled tasks.",
        tags: [],
        importance: 3,
        embedding: {
          model: "text-embedding-example",
          dimensions: 2,
          vector: [1, 0],
          embeddedAt: "2026-06-05T08:00:00.000Z",
        },
      }),
    ];

    expect(
      searchMemoryRecords(embeddedRecords, {
        query: "unrelated words",
        queryEmbedding: [1, 0],
      }).map((result) => ({
        id: result.record.id,
        score: result.score,
      })),
    ).toEqual([
      { id: "mem_vector_2", score: 100 },
    ]);
  });

  it("hides archived records from retrieval unless explicitly requested", () => {
    const active = createRecord({
      id: "mem_active",
      kind: "semantic",
      title: "Agent memory design",
      content: "Active memory stays searchable.",
      tags: ["agent"],
      importance: 3,
    });
    const archived = createRecord({
      id: "mem_archived",
      kind: "semantic",
      title: "Agent memory design",
      content: "Archived memory is retained for export.",
      tags: ["agent"],
      importance: 3,
      archivedAt: "2026-06-05T09:00:00.000Z",
      archiveReason: "consolidated",
      consolidatedInto: "mem_active",
    });

    expect(
      searchMemoryRecords([archived, active], { query: "agent memory" }).map(
        (result) => result.record.id,
      ),
    ).toEqual(["mem_active"]);
    expect(
      searchMemoryRecords([archived, active], {
        query: "agent memory",
        includeArchived: true,
      }).map((result) => result.record.id),
    ).toEqual(["mem_active", "mem_archived"]);
  });
});

function createRecord(
  partial: Pick<
    MemoryRecord,
    "id" | "kind" | "title" | "content" | "tags" | "importance"
  > &
    Partial<
      Pick<
        MemoryRecord,
        "archiveReason" | "archivedAt" | "consolidatedInto" | "embedding"
      >
    >,
): MemoryRecord {
  return {
    ...partial,
    source: { type: "manual" },
    createdAt: "2026-06-05T08:00:00.000Z",
    updatedAt: "2026-06-05T08:00:00.000Z",
  };
}
