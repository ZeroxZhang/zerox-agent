import { describe, expect, it } from "vitest";
import {
  CONVERSATION_SOURCE_PAGE_DEFAULT_LIMIT,
  CONVERSATION_SOURCE_PAGE_MAX_LIMIT,
  createConversationSourceCursor,
  createConversationSourcePage,
  createConversationSourceQueryHash,
  createConversationSourceRevision,
  normalizeConversationSourcePageLimit,
  parseConversationSourceCursor,
} from "./conversationEvidence";

describe("conversation evidence source pages", () => {
  it("binds opaque cursors to source, query, revision, and position", () => {
    const expected = {
      source: "trajectory" as const,
      sourceId: "run_1",
      queryHash: createConversationSourceQueryHash({
        source: "trajectory",
        sourceId: "run_1",
        filters: { types: ["tool_call"] },
      }),
      sourceRevision: createConversationSourceRevision({
        source: "trajectory",
        sourceId: "run_1",
        authority: { dev: 1, ino: 2, size: 3 },
      }),
    };
    const cursor = createConversationSourceCursor({
      ...expected,
      position: 7,
    });

    expect(parseConversationSourceCursor(cursor, expected)).toEqual({
      kind: "position",
      position: 7,
      sourceRevision: expected.sourceRevision,
    });
    expect(parseConversationSourceCursor(cursor, {
      ...expected,
      sourceId: "run_other",
    })).toEqual({
      kind: "incompatible",
      reasonCode: "source_cursor_mismatch",
    });
    expect(parseConversationSourceCursor(`${cursor}x`, expected)).toEqual({
      kind: "incompatible",
      reasonCode: "source_cursor_mismatch",
    });
  });

  it("normalizes page limits to one bounded contract", () => {
    expect(normalizeConversationSourcePageLimit(undefined))
      .toBe(CONVERSATION_SOURCE_PAGE_DEFAULT_LIMIT);
    expect(normalizeConversationSourcePageLimit(0)).toBe(1);
    expect(normalizeConversationSourcePageLimit(999))
      .toBe(CONVERSATION_SOURCE_PAGE_MAX_LIMIT);
    expect(normalizeConversationSourcePageLimit(Number.NaN))
      .toBe(CONVERSATION_SOURCE_PAGE_DEFAULT_LIMIT);
  });

  it("deep-clones records and emits a continuation cursor", () => {
    const records = [{ id: "event_1", nested: { state: "running" } }];
    const page = createConversationSourcePage({
      source: "chat_activity",
      sourceId: "session_1",
      queryHash: "query:one",
      sourceRevision: "cut:one",
      status: "partial",
      reasonCode: "json_activity_tail",
      records,
      nextPosition: 1,
    });
    records[0]!.nested.state = "failed";

    expect(page.records).toEqual([
      { id: "event_1", nested: { state: "running" } },
    ]);
    expect(page.nextCursor).toBeTruthy();
    expect(parseConversationSourceCursor(page.nextCursor, {
      source: "chat_activity",
      sourceId: "session_1",
      queryHash: "query:one",
      sourceRevision: "cut:one",
    })).toEqual({
      kind: "position",
      position: 1,
      sourceRevision: "cut:one",
    });
  });

  it("requires explicit reasons for partial and degraded source states", () => {
    expect(() => createConversationSourcePage({
      source: "workspace_run",
      sourceId: "run_1",
      queryHash: "query:one",
      sourceRevision: "cut:one",
      status: "partial",
      records: [],
    })).toThrow("incomplete conversation source page requires a reason");
    expect(() => createConversationSourcePage({
      source: "workspace_run",
      sourceId: "run_1",
      queryHash: "query:one",
      sourceRevision: "cut:one",
      status: "complete",
      reasonCode: "unexpected",
      records: [],
    })).toThrow("complete conversation source page cannot have a reason");
  });
});
