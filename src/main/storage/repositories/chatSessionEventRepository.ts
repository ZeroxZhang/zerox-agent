import type {
  ChatMessageRecord,
  ChatMessageSearchOptions,
  ChatMessageSearchResult,
  ChatSessionRecord,
  ChatSessionTranscriptPage,
  ChatSessionTranscriptPageOptions,
} from "../../../shared/chat";
import type { Storage } from "../../../shared/storageContract";
import { jsonify, parseJson } from "../repositoryUtils";

export const CHAT_SESSION_PROJECTION_VERSION = 1;
export const CHAT_SEARCH_MAX_CANDIDATES = 1_000;

export type ChatSessionMetadata = Omit<ChatSessionRecord, "messages">;

export type ChatSessionProjection = {
  session: ChatSessionMetadata;
  version: number;
  watermark: number;
  messageCount: number;
  lastAssistantMessageAt?: string;
};

export type ChatSessionEventType =
  | "session_imported"
  | "message_appended"
  | "session_renamed"
  | "session_archived"
  | "session_restored"
  | "token_usage_added"
  | "activity_appended"
  | "goal_attached"
  | "active_goal_cleared"
  | "session_deleted";

export type ChatSessionEventRecord = {
  id: string;
  sessionId: string;
  sequence: number;
  type: ChatSessionEventType;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type CommitChatSessionMutationInput = {
  eventId: string;
  sessionId: string;
  type: ChatSessionEventType;
  eventPayload: Record<string, unknown>;
  createdAt: string;
  session?: ChatSessionMetadata;
  message?: ChatMessageRecord;
  deleteSession?: boolean;
};

export type ChatSessionEventRepository = {
  isBootstrapComplete(): boolean;
  completeBootstrap(updatedAt: string): void;
  countProjections(): number;
  importSnapshots(
    snapshots: Array<{
      eventId: string;
      session: ChatSessionRecord;
    }>,
  ): void;
  getProjection(sessionId: string): ChatSessionProjection | null;
  listProjections(): ChatSessionProjection[];
  getSession(sessionId: string): ChatSessionRecord | null;
  getTranscriptPage(
    sessionId: string,
    options?: ChatSessionTranscriptPageOptions,
  ): ChatSessionTranscriptPage | null;
  getLastMessage(sessionId: string): ChatMessageRecord | null;
  commit(input: CommitChatSessionMutationInput): {
    sequence: number;
    projection: ChatSessionProjection | null;
  };
  searchMessages(
    options: ChatMessageSearchOptions,
  ): ChatMessageSearchResult[];
  listEvents(sessionId: string): ChatSessionEventRecord[];
};

type ProjectionRow = {
  session_id: string;
  version: number;
  watermark: number;
  message_count: number;
  last_assistant_at: string | null;
  payload: string;
};

type SearchRow = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  payload: string;
  created_at: string;
  session_title: string;
};

export function createChatSessionEventRepository(
  storage: Storage,
): ChatSessionEventRepository {
  const db = storage.db;

  const getProjection = (
    sessionId: string,
  ): ChatSessionProjection | null => {
    const row = db
      .prepare(
        `SELECT session_id, version, watermark, message_count,
                last_assistant_at, payload
           FROM chat_session_projections
          WHERE session_id = ?`,
      )
      .get<ProjectionRow>(sessionId);
    return row ? projectionFromRow(row) : null;
  };

  const getMessages = (sessionId: string): ChatMessageRecord[] =>
    db
      .prepare(
        `SELECT payload
           FROM chat_messages
          WHERE session_id = ?
          ORDER BY COALESCE(seq, 9223372036854775807) ASC,
                   created_at ASC,
                   rowid ASC`,
      )
      .all<{ payload: string }>(sessionId)
      .map((row) => parseJson<ChatMessageRecord>(row.payload))
      .filter((message): message is ChatMessageRecord => Boolean(message));

  return {
    isBootstrapComplete() {
      return Boolean(
        db
          .prepare(
            "SELECT value FROM chat_store_metadata WHERE key = 'legacy_json_import'",
          )
          .get<{ value: string }>(),
      );
    },

    completeBootstrap(updatedAt) {
      db.prepare(
        `INSERT INTO chat_store_metadata (key, value, updated_at)
         VALUES ('legacy_json_import', 'complete', ?)
         ON CONFLICT(key) DO UPDATE SET
           value=excluded.value,
           updated_at=excluded.updated_at`,
      ).run(updatedAt);
    },

    countProjections() {
      return Number(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM chat_session_projections",
          )
          .get<{ count: number }>()?.count ?? 0,
      );
    },

    importSnapshots(snapshots) {
      inImmediateTransaction(db, () => {
        for (const snapshot of snapshots) {
          if (getProjection(snapshot.session.id)) continue;
          const { messages, ...metadata } = snapshot.session;
          upsertSessionRow(db, metadata);
          db.prepare(
            `INSERT INTO chat_session_events
              (id, session_id, seq, type, payload, created_at)
             VALUES (?, ?, 1, 'session_imported', ?, ?)`,
          ).run(
            snapshot.eventId,
            snapshot.session.id,
            jsonify({
              messageCount: messages.length,
              source: "chat-sessions.json",
              session: metadata,
            }),
            snapshot.session.createdAt,
          );
          messages.forEach((message, index) => {
            importMessageRow(
              db,
              snapshot.session.id,
              message,
              index + 1,
            );
          });
          upsertProjection(db, {
            session: metadata,
            version: CHAT_SESSION_PROJECTION_VERSION,
            watermark: 1,
            messageCount: messages.length,
            lastAssistantMessageAt: [...messages]
              .reverse()
              .find((message) => message.role === "assistant")?.createdAt,
          });
        }
      });
    },

    getProjection,

    listProjections() {
      return db
        .prepare(
          `SELECT session_id, version, watermark, message_count,
                  last_assistant_at, payload
             FROM chat_session_projections
            ORDER BY updated_at DESC, session_id ASC`,
        )
        .all<ProjectionRow>()
        .map(projectionFromRow);
    },

    getSession(sessionId) {
      const projection = getProjection(sessionId);
      if (!projection) return null;
      return {
        ...projection.session,
        messages: getMessages(sessionId),
      };
    },

    getTranscriptPage(sessionId, options) {
      const projection = getProjection(sessionId);
      if (!projection) return null;
      const limit = normalizeTranscriptPageLimit(options?.limit);
      const beforeSequence = normalizeBeforeSequence(
        options?.beforeSequence,
        projection.messageCount,
      );
      const rows = db
        .prepare(
          `SELECT seq, payload
             FROM chat_messages
            WHERE session_id = ?
              AND seq < ?
            ORDER BY seq DESC
            LIMIT ?`,
        )
        .all<{ seq: number; payload: string }>(
          sessionId,
          beforeSequence,
          limit,
        )
        .reverse();
      const messages = rows
        .map((row) => ({
          sequence: row.seq,
          message: parseJson<ChatMessageRecord>(row.payload),
        }))
        .filter(
          (
            row,
          ): row is { sequence: number; message: ChatMessageRecord } =>
            Boolean(row.message),
        );
      const startSequence =
        messages[0]?.sequence ?? Math.min(beforeSequence, 1);
      const endSequence =
        messages.at(-1)?.sequence ?? Math.max(0, startSequence - 1);
      return {
        session: {
          ...projection.session,
          messages: messages.map((row) => row.message),
        },
        page: {
          startSequence,
          endSequence,
          totalMessages: projection.messageCount,
          hasMoreBefore: startSequence > 1,
        },
      };
    },

    getLastMessage(sessionId) {
      const row = db
        .prepare(
          `SELECT payload
             FROM chat_messages
            WHERE session_id = ?
            ORDER BY COALESCE(seq, 9223372036854775807) DESC,
                     created_at DESC,
                     rowid DESC
            LIMIT 1`,
        )
        .get<{ payload: string }>(sessionId);
      return row ? parseJson<ChatMessageRecord>(row.payload) : null;
    },

    commit(input) {
      return inImmediateTransaction(db, () => {
        const current = getProjection(input.sessionId);
        const sequence = (current?.watermark ?? 0) + 1;
        db.prepare(
          `INSERT INTO chat_session_events
            (id, session_id, seq, type, payload, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          input.eventId,
          input.sessionId,
          sequence,
          input.type,
          jsonify(input.eventPayload),
          input.createdAt,
        );

        if (input.deleteSession) {
          db.prepare("DELETE FROM sessions WHERE id = ?").run(input.sessionId);
          return { sequence, projection: null };
        }
        if (!input.session) {
          throw new Error(
            `Chat mutation ${input.type} requires a projected session.`,
          );
        }

        upsertSessionRow(db, input.session);
        if (input.message) {
          const messageSequence = (current?.messageCount ?? 0) + 1;
          db.prepare(
            `INSERT INTO chat_messages
              (id, session_id, role, content, payload, created_at, seq)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            input.message.id,
            input.sessionId,
            input.message.role,
            input.message.content,
            jsonify(input.message),
            input.message.createdAt,
            messageSequence,
          );
        }
        const projection: ChatSessionProjection = {
          session: input.session,
          version: CHAT_SESSION_PROJECTION_VERSION,
          watermark: sequence,
          messageCount:
            (current?.messageCount ?? 0) + (input.message ? 1 : 0),
          lastAssistantMessageAt:
            input.message?.role === "assistant"
              ? input.message.createdAt
              : current?.lastAssistantMessageAt,
        };
        upsertProjection(db, projection);
        return { sequence, projection };
      });
    },

    searchMessages(options) {
      const terms = tokenize(options.query);
      if (!terms.length) return [];
      const requestedLimit = Math.max(
        1,
        Math.floor(options.limit ?? 20),
      );
      const candidateLimit = Math.min(
        CHAT_SEARCH_MAX_CANDIDATES,
        Math.max(100, requestedLimit * 20),
      );
      const ftsTerms = terms.filter((term) => [...term].length >= 3);
      const shortTerms = terms.filter((term) => [...term].length < 3);
      const sourceCount = (ftsTerms.length ? 2 : 0) +
        (shortTerms.length ? 1 : 0);
      const perSourceLimit = Math.ceil(candidateLimit / sourceCount);
      const candidates = new Map<string, SearchRow>();
      const addCandidates = (rows: SearchRow[]) => {
        for (const row of rows) {
          if (candidates.size >= candidateLimit) break;
          candidates.set(row.id, row);
        }
      };

      if (ftsTerms.length) {
        const match = ftsTerms.map(quoteFtsTerm).join(" OR ");
        const contentSessionClause = options.sessionId
          ? "AND m.session_id = ?"
          : "";
        const contentParams: Array<string | number> = [match];
        if (options.sessionId) contentParams.push(options.sessionId);
        contentParams.push(perSourceLimit);
        addCandidates(
          db.prepare(
            `SELECT m.id, m.session_id, m.role, m.content, m.payload,
                    m.created_at, p.title AS session_title
               FROM chat_message_fts
               JOIN chat_messages m
                 ON m.rowid = chat_message_fts.rowid
               JOIN chat_session_projections p
                 ON p.session_id = m.session_id
              WHERE chat_message_fts MATCH ?
                ${contentSessionClause}
              ORDER BY bm25(chat_message_fts) ASC,
                       m.created_at DESC, m.rowid DESC
              LIMIT ?`,
          ).all<SearchRow>(...contentParams),
        );

        const titleSessionClause = options.sessionId
          ? "AND p.session_id = ?"
          : "";
        const titleParams: Array<string | number> = [match];
        if (options.sessionId) titleParams.push(options.sessionId);
        titleParams.push(perSourceLimit);
        addCandidates(
          db.prepare(
            `SELECT m.id, m.session_id, m.role, m.content, m.payload,
                    m.created_at, p.title AS session_title
               FROM chat_session_title_fts
               JOIN chat_session_projections p
                 ON p.rowid = chat_session_title_fts.rowid
               JOIN chat_messages m
                 ON m.session_id = p.session_id
              WHERE chat_session_title_fts MATCH ?
                ${titleSessionClause}
              ORDER BY bm25(chat_session_title_fts) ASC,
                       m.created_at DESC, m.rowid DESC
              LIMIT ?`,
          ).all<SearchRow>(...titleParams),
        );
      }

      if (shortTerms.length && candidates.size < candidateLimit) {
        const params: Array<string | number> = [];
        const sessionClause = options.sessionId
          ? "WHERE m.session_id = ?"
          : "";
        if (options.sessionId) params.push(options.sessionId);
        params.push(
          Math.min(
            perSourceLimit,
            candidateLimit - candidates.size,
          ),
        );
        addCandidates(
          db.prepare(
            `SELECT m.id, m.session_id, m.role, m.content, m.payload,
                    m.created_at, p.title AS session_title
               FROM chat_messages m
               JOIN chat_session_projections p
                 ON p.session_id = m.session_id
              ${sessionClause}
              ORDER BY m.created_at DESC, m.rowid DESC
              LIMIT ?`,
          ).all<SearchRow>(...params),
        );
      }

      return [...candidates.values()]
        .map((row) => scoreMessageRow(row, terms))
        .filter((result) => result.score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            right.createdAt.localeCompare(left.createdAt),
        )
        .slice(0, requestedLimit);
    },

    listEvents(sessionId) {
      return db
        .prepare(
          `SELECT id, session_id, seq, type, payload, created_at
             FROM chat_session_events
            WHERE session_id = ?
            ORDER BY seq ASC`,
        )
        .all<{
          id: string;
          session_id: string;
          seq: number;
          type: ChatSessionEventType;
          payload: string;
          created_at: string;
        }>(sessionId)
        .map((row) => ({
          id: row.id,
          sessionId: row.session_id,
          sequence: row.seq,
          type: row.type,
          payload: parseJson<Record<string, unknown>>(row.payload) ?? {},
          createdAt: row.created_at,
        }));
    },
  };
}

function inImmediateTransaction<T>(
  db: Storage["db"],
  operation: () => T,
): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function projectionFromRow(row: ProjectionRow): ChatSessionProjection {
  if (row.version !== CHAT_SESSION_PROJECTION_VERSION) {
    throw new Error(
      `Unsupported Chat projection version ${row.version} for ${row.session_id}.`,
    );
  }
  const session = parseJson<ChatSessionMetadata>(row.payload);
  if (!session) {
    throw new Error(
      `Chat projection ${row.session_id} contains invalid payload.`,
    );
  }
  return {
    session,
    version: row.version,
    watermark: row.watermark,
    messageCount: row.message_count,
    ...(row.last_assistant_at
      ? { lastAssistantMessageAt: row.last_assistant_at }
      : {}),
  };
}

function upsertSessionRow(
  db: Storage["db"],
  session: ChatSessionMetadata,
): void {
  const existing = db
    .prepare("SELECT kind FROM sessions WHERE id = ?")
    .get<{ kind: string }>(session.id);
  if (existing && existing.kind !== "chat") {
    throw new Error(
      `Session id ${session.id} belongs to ${existing.kind}, not chat.`,
    );
  }
  db.prepare(
    `INSERT INTO sessions
      (id, kind, title, workspace_id, payload, created_at, updated_at)
     VALUES (?, 'chat', ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       kind='chat',
       title=excluded.title,
       workspace_id=excluded.workspace_id,
       payload=excluded.payload,
       updated_at=excluded.updated_at`,
  ).run(
    session.id,
    session.title,
    session.workspaceId ?? null,
    jsonify(session),
    session.createdAt,
    session.updatedAt,
  );
}

function importMessageRow(
  db: Storage["db"],
  sessionId: string,
  message: ChatMessageRecord,
  sequence: number,
): void {
  const existing = db
    .prepare(
      "SELECT session_id, payload FROM chat_messages WHERE id = ?",
    )
    .get<{ session_id: string; payload: string }>(message.id);
  if (existing) {
    const stored = parseJson<ChatMessageRecord>(existing.payload);
    if (
      existing.session_id !== sessionId ||
      !stored ||
      jsonify(stored) !== jsonify(message)
    ) {
      throw new Error(
        `Legacy Chat message id collision for ${message.id}.`,
      );
    }
    db.prepare(
      "UPDATE chat_messages SET seq = ? WHERE id = ?",
    ).run(sequence, message.id);
    return;
  }
  db.prepare(
    `INSERT INTO chat_messages
      (id, session_id, role, content, payload, created_at, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    message.id,
    sessionId,
    message.role,
    message.content,
    jsonify(message),
    message.createdAt,
    sequence,
  );
}

function upsertProjection(
  db: Storage["db"],
  projection: ChatSessionProjection,
): void {
  db.prepare(
    `INSERT INTO chat_session_projections
      (session_id, version, watermark, title, summary, workspace_id,
       archived_at, message_count, last_assistant_at, payload,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       version=excluded.version,
       watermark=excluded.watermark,
       title=excluded.title,
       summary=excluded.summary,
       workspace_id=excluded.workspace_id,
       archived_at=excluded.archived_at,
       message_count=excluded.message_count,
       last_assistant_at=excluded.last_assistant_at,
       payload=excluded.payload,
       updated_at=excluded.updated_at`,
  ).run(
    projection.session.id,
    projection.version,
    projection.watermark,
    projection.session.title,
    projection.session.summary,
    projection.session.workspaceId ?? null,
    projection.session.archivedAt ?? null,
    projection.messageCount,
    projection.lastAssistantMessageAt ?? null,
    jsonify(projection.session),
    projection.session.createdAt,
    projection.session.updatedAt,
  );
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function quoteFtsTerm(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizeTranscriptPageLimit(value: number | undefined): number {
  const parsed = Math.floor(Number(value ?? 80));
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 200)) : 80;
}

function normalizeBeforeSequence(
  value: number | undefined,
  messageCount: number,
): number {
  const fallback = messageCount + 1;
  const parsed = Math.floor(Number(value ?? fallback));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(parsed, fallback));
}

function scoreMessageRow(
  row: {
    id: string;
    session_id: string;
    role: string;
    content: string;
    payload: string;
    created_at: string;
    session_title: string;
  },
  terms: string[],
): ChatMessageSearchResult {
  const content = row.content.toLowerCase();
  const title = row.session_title.toLowerCase();
  const matchedTerms: string[] = [];
  let score = 0;
  for (const term of terms) {
    const contentMatch = content.includes(term);
    const titleMatch = title.includes(term);
    if (!contentMatch && !titleMatch) continue;
    matchedTerms.push(term);
    score += contentMatch ? 2 : 0;
    score += titleMatch ? 1 : 0;
  }
  const payload = parseJson<{ id?: unknown }>(row.payload);
  return {
    sessionId: row.session_id,
    sessionTitle: row.session_title,
    messageId:
      typeof payload?.id === "string" ? payload.id : row.id,
    role: row.role as ChatMessageSearchResult["role"],
    content: row.content,
    createdAt: row.created_at,
    score,
    matchedTerms,
  };
}
