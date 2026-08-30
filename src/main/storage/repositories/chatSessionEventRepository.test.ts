import { describe, expect, it } from "vitest";
import type {
  ChatMessageRecord,
  ChatSessionRecord,
} from "../../../shared/chat";
import { createInMemoryStorage } from "../storageDb";
import {
  CHAT_SEARCH_MAX_CANDIDATES,
  CHAT_SESSION_PROJECTION_VERSION,
  createChatSessionEventRepository,
} from "./chatSessionEventRepository";

describe("ChatSessionEventRepository", () => {
  it("imports snapshots into events, messages, and message-free projections", async () => {
    const storage = await createInMemoryStorage();
    const repository = createChatSessionEventRepository(storage);
    const session = makeSession("session_1", [
      makeMessage("message_1", "user", "hello", 1),
      makeMessage("message_2", "assistant", "world", 2),
    ]);

    repository.importSnapshots([
      { eventId: "import_1", session },
    ]);

    expect(repository.getSession("session_1")).toEqual(session);
    expect(repository.getProjection("session_1")).toMatchObject({
      version: CHAT_SESSION_PROJECTION_VERSION,
      watermark: 1,
      messageCount: 2,
      lastAssistantMessageAt: messageTime(2),
    });
    const projectionPayload = storage.db
      .prepare(
        "SELECT payload FROM chat_session_projections WHERE session_id = ?",
      )
      .get<{ payload: string }>("session_1")!.payload;
    expect(JSON.parse(projectionPayload)).not.toHaveProperty("messages");
    expect(repository.listEvents("session_1")).toEqual([
      expect.objectContaining({
        id: "import_1",
        sequence: 1,
        type: "session_imported",
        payload: expect.objectContaining({
          messageCount: 2,
          source: "chat-sessions.json",
          session: expect.objectContaining({ id: "session_1" }),
        }),
      }),
    ]);
    storage.close();
  });

  it("atomically appends one message event and advances the projection watermark", async () => {
    const storage = await createInMemoryStorage();
    const repository = createChatSessionEventRepository(storage);
    const original = makeSession("session_1", [
      makeMessage("message_1", "user", "hello", 1),
    ]);
    repository.importSnapshots([
      { eventId: "import_1", session: original },
    ]);
    const message = makeMessage(
      "message_2",
      "assistant",
      "done",
      2,
    );
    const { messages: _messages, ...metadata } = original;

    repository.commit({
      eventId: "event_2",
      sessionId: original.id,
      type: "message_appended",
      eventPayload: { messageId: message.id, role: message.role },
      createdAt: message.createdAt,
      session: {
        ...metadata,
        summary: "done",
        updatedAt: message.createdAt,
      },
      message,
    });

    expect(repository.getProjection(original.id)).toMatchObject({
      watermark: 2,
      messageCount: 2,
      lastAssistantMessageAt: message.createdAt,
    });
    expect(
      repository.getSession(original.id)?.messages.map((item) => item.id),
    ).toEqual(["message_1", "message_2"]);
    expect(
      repository.listEvents(original.id).map((event) => [
        event.sequence,
        event.type,
      ]),
    ).toEqual([
      [1, "session_imported"],
      [2, "message_appended"],
    ]);
    storage.close();
  });

  it("queries native Chat activity pages with an indexed sequence bound", async () => {
    const storage = await createInMemoryStorage();
    const repository = createChatSessionEventRepository(storage);
    const { messages: _messages, ...session } = makeSession("session_1", []);
    for (const sequence of [1, 2, 3]) {
      repository.commit({
        eventId: `activity_${sequence}`,
        sessionId: session.id,
        type: "activity_appended",
        eventPayload: {
          event: {
            sessionId: session.id,
            sequence,
            state: sequence === 3 ? "completed" : "model",
            message: `event ${sequence}`,
            createdAt: messageTime(sequence),
            elapsedMs: sequence,
          },
        },
        createdAt: messageTime(sequence),
        session: {
          ...session,
          updatedAt: messageTime(sequence),
        },
      });
    }

    const first = repository.getActivityPage("session_1", { limit: 2 });
    expect(first).toMatchObject({
      status: "complete",
      records: [
        { eventId: "activity_1", sequence: 1, legacy: false },
        { eventId: "activity_2", sequence: 2, legacy: false },
      ],
    });
    expect(first.nextCursor).toBeTruthy();
    expect(repository.getActivityPage("session_1", {
      cursor: first.nextCursor,
      limit: 2,
    })).toMatchObject({
      status: "complete",
      records: [{ eventId: "activity_3", sequence: 3, legacy: false }],
    });
    storage.close();
  });

  it("reports imported legacy and corrupt Chat activity explicitly", async () => {
    const storage = await createInMemoryStorage();
    const repository = createChatSessionEventRepository(storage);
    const session = makeSession("session_1", []);
    repository.importSnapshots([{ eventId: "import_1", session }]);
    const { messages: _messages, ...metadata } = session;
    repository.commit({
      eventId: "activity_2",
      sessionId: session.id,
      type: "activity_appended",
      eventPayload: {
        event: {
          sessionId: session.id,
          state: "model",
          message: "model",
          createdAt: messageTime(2),
          elapsedMs: 2,
        },
      },
      createdAt: messageTime(2),
      session: { ...metadata, updatedAt: messageTime(2) },
    });
    expect(repository.getActivityPage(session.id)).toMatchObject({
      status: "partial",
      reasonCode: "legacy_chat_activity_tail_unavailable",
      records: [{ eventId: "activity_2" }],
    });

    storage.db.prepare(
      "UPDATE chat_session_events SET payload = ? WHERE id = ?",
    ).run("{bad", "activity_2");
    expect(repository.getActivityPage(session.id)).toMatchObject({
      status: "partial",
      reasonCode: "corrupt_record",
      records: [],
    });
    storage.close();
  });

  it("keeps the deletion tombstone after removing live projection and messages", async () => {
    const storage = await createInMemoryStorage();
    const repository = createChatSessionEventRepository(storage);
    const session = makeSession("session_1", [
      makeMessage("message_1", "user", "hello", 1),
    ]);
    repository.importSnapshots([
      { eventId: "import_1", session },
    ]);

    repository.commit({
      eventId: "delete_2",
      sessionId: session.id,
      type: "session_deleted",
      eventPayload: { messageCount: 1 },
      createdAt: messageTime(2),
      deleteSession: true,
    });

    expect(repository.getSession(session.id)).toBeNull();
    expect(repository.getProjection(session.id)).toBeNull();
    expect(repository.listEvents(session.id)).toEqual([
      expect.objectContaining({ type: "session_imported", sequence: 1 }),
      expect.objectContaining({ type: "session_deleted", sequence: 2 }),
    ]);
    expect(
      storage.db
        .prepare(
          "SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ?",
        )
        .get<{ count: number }>(session.id)?.count,
    ).toBe(0);
    storage.close();
  });

  it("searches indexed rows without reading projection payloads", async () => {
    const storage = await createInMemoryStorage();
    const repository = createChatSessionEventRepository(storage);
    repository.importSnapshots([
      {
        eventId: "import_1",
        session: makeSession("session_1", [
          makeMessage(
            "message_1",
            "assistant",
            "报告已保存为 Markdown。",
            1,
          ),
        ]),
      },
      {
        eventId: "import_2",
        session: {
          ...makeSession("session_2", [
            makeMessage("message_2", "user", "发票提醒", 2),
          ]),
          title: "发票任务",
        },
      },
    ]);

    expect(
      repository.searchMessages({
        query: "报告 markdown",
        limit: 5,
      }),
    ).toEqual([
      expect.objectContaining({
        sessionId: "session_1",
        messageId: "message_1",
        score: 4,
        matchedTerms: ["报告", "markdown"],
      }),
    ]);
    storage.close();
  });

  it("uses FTS virtual indexes and keeps large-history search bounded", async () => {
    const storage = await createInMemoryStorage();
    const repository = createChatSessionEventRepository(storage);
    const session = makeSession("session_1", []);
    repository.importSnapshots([{ eventId: "import_1", session }]);
    const insert = storage.db.prepare(
      `INSERT INTO chat_messages
        (id, session_id, role, content, payload, created_at, seq)
       VALUES (?, ?, 'assistant', ?, ?, ?, ?)`,
    );
    storage.db.exec("BEGIN");
    try {
      for (let index = 1; index <= 10_000; index += 1) {
        const message = makeMessage(
          `bulk_${index}`,
          "assistant",
          `bounded-search-marker 计划 result ${index}`,
          index,
        );
        insert.run(
          message.id,
          session.id,
          message.content,
          JSON.stringify(message),
          message.createdAt,
          index,
        );
      }
      storage.db.exec("COMMIT");
    } catch (error) {
      storage.db.exec("ROLLBACK");
      throw error;
    }

    const plan = storage.db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT rowid FROM chat_message_fts WHERE chat_message_fts MATCH ? LIMIT ?",
      )
      .all<{ detail: string }>("bounded-search-marker", 100);
    expect(plan.some((row) => row.detail.includes("VIRTUAL TABLE INDEX"))).toBe(
      true,
    );
    const startedAt = performance.now();
    const results = repository.searchMessages({
      query: "bounded-search-marker",
      limit: 25,
    });
    expect(results).toHaveLength(25);
    const shortTermPlan = storage.db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT m.id
           FROM chat_messages m
           JOIN chat_session_projections p ON p.session_id = m.session_id
          ORDER BY m.created_at DESC, m.rowid DESC
          LIMIT ?`,
      )
      .all<{ detail: string }>(100);
    expect(
      shortTermPlan.some((row) =>
        row.detail.includes("idx_chat_messages_created"),
      ),
    ).toBe(true);
    expect(
      repository.searchMessages({ query: "计划", limit: 25 }),
    ).toHaveLength(25);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
    expect(CHAT_SEARCH_MAX_CANDIDATES).toBe(1_000);
    storage.close();
  });

  it("keeps projection payload bounded as history grows", async () => {
    const storage = await createInMemoryStorage();
    const repository = createChatSessionEventRepository(storage);
    const first = makeMessage("message_1", "user", "start", 1);
    const session = makeSession("session_1", [first]);
    repository.importSnapshots([
      { eventId: "import_1", session },
    ]);
    let metadata = repository.getProjection(session.id)!.session;

    for (let index = 2; index <= 500; index += 1) {
      const message = makeMessage(
        `message_${index}`,
        index % 2 ? "user" : "assistant",
        `message ${index} ${"x".repeat(200)}`,
        index,
      );
      metadata = {
        ...metadata,
        summary: `message ${index}`,
        updatedAt: message.createdAt,
      };
      repository.commit({
        eventId: `event_${index}`,
        sessionId: session.id,
        type: "message_appended",
        eventPayload: { messageId: message.id, role: message.role },
        createdAt: message.createdAt,
        session: metadata,
        message,
      });
    }

    const row = storage.db
      .prepare(
        `SELECT length(payload) AS bytes, message_count
           FROM chat_session_projections
          WHERE session_id = ?`,
      )
      .get<{ bytes: number; message_count: number }>(session.id)!;
    expect(row.message_count).toBe(500);
    expect(row.bytes).toBeLessThan(2_000);
    expect(repository.listProjections()[0]).toMatchObject({
      messageCount: 500,
      watermark: 500,
    });
    storage.close();
  });

  it("adopts matching legacy generic message rows during import", async () => {
    const storage = await createInMemoryStorage();
    const repository = createChatSessionEventRepository(storage);
    const message = makeMessage("message_1", "user", "legacy", 1);
    const session = makeSession("session_1", [message]);
    storage.db.prepare(
      `INSERT INTO sessions
        (id, kind, title, payload, created_at, updated_at)
       VALUES (?, 'chat', ?, ?, ?, ?)`,
    ).run(
      session.id,
      session.title,
      JSON.stringify(session),
      session.createdAt,
      session.updatedAt,
    );
    storage.db.prepare(
      `INSERT INTO chat_messages
        (id, session_id, role, content, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      message.id,
      session.id,
      message.role,
      message.content,
      JSON.stringify(message),
      message.createdAt,
    );

    repository.importSnapshots([
      { eventId: "import_1", session },
    ]);

    expect(repository.getSession(session.id)).toEqual(session);
    expect(
      storage.db
        .prepare(
          "SELECT seq FROM chat_messages WHERE id = ?",
        )
        .get<{ seq: number }>(message.id)?.seq,
    ).toBe(1);
    storage.close();
  });

  it("fails explicitly on an unsupported projection version", async () => {
    const storage = await createInMemoryStorage();
    const repository = createChatSessionEventRepository(storage);
    const session = makeSession("session_1", []);
    repository.importSnapshots([
      { eventId: "import_1", session },
    ]);
    storage.db.prepare(
      "UPDATE chat_session_projections SET version = 999 WHERE session_id = ?",
    ).run(session.id);

    expect(() => repository.getProjection(session.id)).toThrow(
      "Unsupported Chat projection version 999",
    );
    storage.close();
  });
});

function makeSession(
  id: string,
  messages: ChatMessageRecord[],
): ChatSessionRecord {
  return {
    id,
    title: id === "session_1" ? "整理下载文件夹" : "Session",
    summary: messages.at(-1)?.content ?? "",
    messages,
    createdAt: messages[0]?.createdAt ?? messageTime(1),
    updatedAt: messages.at(-1)?.createdAt ?? messageTime(1),
  };
}

function makeMessage(
  id: string,
  role: ChatMessageRecord["role"],
  content: string,
  minute: number,
): ChatMessageRecord {
  return { id, role, content, createdAt: messageTime(minute) };
}

function messageTime(minute: number): string {
  return new Date(
    Date.parse("2026-08-14T00:00:00.000Z") + minute * 60_000,
  ).toISOString();
}
