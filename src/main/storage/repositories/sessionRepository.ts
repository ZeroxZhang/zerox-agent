// SessionRepository + ActorRepository (contracts v1.4 §1.3, Exit Criteria §6.6).
//
// `sessions` is a kind-discriminated table (chat | goal | scheduled | multi_agent)
// storing the full record as `payload`. `chat_messages` is a child table for
// indexed message search (Patch 26). `actors` records actor lineage for P6.

import type {
  ActorInput,
  ActorRecord,
  ActorRepository,
  ActorStatus,
  AppendChatMessageInput,
  AppendChatMessageResult,
  SessionInput,
  SessionKind,
  SessionRecord,
  SessionRepository,
  Storage,
} from "../../../shared/storageContract";
import type {
  ChatMessageSearchOptions,
  ChatMessageSearchResult,
} from "../../../shared/chat";
import { randomUUID } from "node:crypto";
import { jsonify, parseJson } from "../repositoryUtils";

type SessionRow = {
  id: string;
  kind: string;
  parent_session_id: string | null;
  agent_role: string | null;
  title: string | null;
  root_run_id: string | null;
  status: string | null;
  workspace_id: string | null;
  payload: string;
  created_at: string;
  updated_at: string;
};

function rowToSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    kind: row.kind as SessionKind,
    parentSessionId: row.parent_session_id ?? undefined,
    agentRole: (row.agent_role ?? undefined) as SessionRecord["agentRole"],
    title: row.title ?? undefined,
    rootRunId: row.root_run_id ?? undefined,
    status: (row.status ?? undefined) as SessionRecord["status"],
    workspaceId: row.workspace_id ?? undefined,
    payload: parseJson(row.payload),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SESSION_COLUMNS =
  "id, kind, parent_session_id, agent_role, title, root_run_id, status, workspace_id, payload, created_at, updated_at";

export function createSessionRepository(storage: Storage): SessionRepository {
  const db = storage.db;

  function getSession(id: string): SessionRecord | null {
    const row = db
      .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`)
      .get(id) as SessionRow | undefined;
    return row ? rowToSession(row) : null;
  }

  function upsert(input: SessionInput): SessionRecord {
    const now = input.updatedAt ?? new Date().toISOString();
    const createdAt = input.createdAt ?? now;
    db.prepare(
      `INSERT INTO sessions (id, kind, parent_session_id, agent_role, title, root_run_id, status, workspace_id, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind=excluded.kind, parent_session_id=excluded.parent_session_id, agent_role=excluded.agent_role,
         title=excluded.title, root_run_id=excluded.root_run_id, status=excluded.status,
         workspace_id=excluded.workspace_id, payload=excluded.payload, updated_at=excluded.updated_at`,
    ).run(
      input.id,
      input.kind,
      input.parentSessionId ?? null,
      input.agentRole ?? null,
      input.title ?? null,
      input.rootRunId ?? null,
      input.status ?? null,
      input.workspaceId ?? null,
      jsonify(input.payload ?? null),
      createdAt,
      now,
    );
    return getSession(input.id)!;
  }

  return {
    createSession(input: SessionInput): SessionRecord {
      return upsert(input);
    },

    getSession,

    listSessions(options?: { kind?: SessionKind }): SessionRecord[] {
      const rows = options?.kind
        ? (db
            .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE kind = ? ORDER BY updated_at DESC`)
            .all(options.kind) as SessionRow[])
        : (db
            .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions ORDER BY updated_at DESC`)
            .all() as SessionRow[]);
      return rows.map(rowToSession);
    },

    appendChildRun(
      sessionId: string,
      runId: string,
      role: SessionRecord["agentRole"],
    ): SessionRecord | null {
      const existing = getSession(sessionId);
      if (!existing) return null;
      const payload = (existing.payload ?? {}) as {
        childRunIds?: string[];
        roles?: Record<string, string>;
      };
      const childRunIds = [...(payload.childRunIds ?? []), runId];
      const roles = { ...(payload.roles ?? {}), [runId]: role };
      return upsert({
        ...existing,
        id: sessionId,
        kind: existing.kind,
        childRunIds,
        roles: roles as SessionRecord["roles"],
        payload: { ...payload, childRunIds, roles },
        updatedAt: new Date().toISOString(),
      });
    },

    setSessionStatus(
      sessionId: string,
      status: SessionRecord["status"],
    ): SessionRecord | null {
      const existing = getSession(sessionId);
      if (!existing) return null;
      return upsert({
        ...existing,
        id: sessionId,
        kind: existing.kind,
        status,
        payload: { ...(existing.payload as object), status },
        updatedAt: new Date().toISOString(),
      });
    },

    appendMessage(input: AppendChatMessageInput): AppendChatMessageResult {
      const messageId = randomUUID();
      const createdAt = input.createdAt ?? new Date().toISOString();
      db.prepare(
        `INSERT INTO chat_messages (id, session_id, role, content, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        messageId,
        input.sessionId,
        input.role,
        typeof input.content === "string" ? input.content : jsonify(input.content),
        jsonify(input.message ?? input.content),
        createdAt,
      );
      return { messageId, sessionId: input.sessionId, createdAt };
    },

    searchMessages(
      options: ChatMessageSearchOptions,
    ): ChatMessageSearchResult[] {
      const limit = options.limit ?? 50;
      const terms = options.query
        .toLowerCase()
        .split(/[^a-z0-9一-龥]+/i)
        .filter(Boolean);
      if (!terms.length) return [];
      const like = `%${options.query.toLowerCase()}%`;
      const rows = options.sessionId
        ? (db
            .prepare(
              `SELECT m.id, m.session_id, m.role, m.content, m.created_at, s.title AS session_title
               FROM chat_messages m JOIN sessions s ON s.id = m.session_id
               WHERE m.session_id = ? AND LOWER(m.content) LIKE ?
               ORDER BY m.created_at DESC LIMIT ?`,
            )
            .all(options.sessionId, like, limit) as Array<{
            id: string;
            session_id: string;
            role: string;
            content: string;
            created_at: string;
            session_title: string | null;
          }>)
        : (db
            .prepare(
              `SELECT m.id, m.session_id, m.role, m.content, m.created_at, s.title AS session_title
               FROM chat_messages m JOIN sessions s ON s.id = m.session_id
               WHERE LOWER(m.content) LIKE ?
               ORDER BY m.created_at DESC LIMIT ?`,
            )
            .all(like, limit) as Array<{
            id: string;
            session_id: string;
            role: string;
            content: string;
            created_at: string;
            session_title: string | null;
          }>);
      return rows.map((r) => ({
        sessionId: r.session_id,
        sessionTitle: r.session_title ?? "",
        messageId: r.id,
        role: r.role as ChatMessageSearchResult["role"],
        content: r.content,
        createdAt: r.created_at,
        score: terms.length,
        matchedTerms: terms,
      }));
    },
  };
}

export function createActorRepository(storage: Storage): ActorRepository {
  const db = storage.db;

  return {
    create(input: Omit<ActorRecord, "id"> & { id: string }): string {
      const now = input.updatedAt ?? new Date().toISOString();
      const createdAt = input.createdAt ?? now;
      db.prepare(
        `INSERT INTO actors (id, run_id, parent_actor_id, context_mode, status, task, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status=excluded.status, task=excluded.task, payload=excluded.payload, updated_at=excluded.updated_at`,
      ).run(
        input.id,
        input.runId,
        input.parentActorId ?? null,
        input.contextMode,
        input.status,
        input.task ?? null,
        jsonify(input),
        createdAt,
        now,
      );
      return input.id;
    },

    get(actorId: string): ActorRecord | null {
      const row = db
        .prepare(
          "SELECT payload FROM actors WHERE id = ?",
        )
        .get<{ payload: string }>(actorId);
      if (!row) return null;
      return parseJson<ActorRecord>(row.payload);
    },

    listByRun(runId: string): ActorRecord[] {
      const rows = db
        .prepare("SELECT payload FROM actors WHERE run_id = ? ORDER BY created_at ASC")
        .all<{ payload: string }>(runId);
      return rows
        .map((r) => parseJson<ActorRecord>(r.payload))
        .filter((v): v is ActorRecord => v !== null);
    },

    updateStatus(actorId: string, status: ActorStatus): void {
      const existing = this.get(actorId);
      if (!existing) return;
      const updated: ActorRecord = {
        ...existing,
        status,
        updatedAt: new Date().toISOString(),
      };
      db.prepare(
        "UPDATE actors SET status = ?, payload = ?, updated_at = ? WHERE id = ?",
      ).run(status, jsonify(updated), updated.updatedAt, actorId);
    },
  };
}
