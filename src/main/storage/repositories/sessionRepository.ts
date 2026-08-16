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

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function buildSessionPayload(input: SessionInput): unknown {
  if (input.kind !== "multi_agent") {
    return input.payload ?? null;
  }

  const payload = asRecord(input.payload);
  const childRunIds = input.childRunIds ??
    (Array.isArray(payload.childRunIds)
      ? payload.childRunIds.filter(
          (runId): runId is string => typeof runId === "string",
        )
      : []);
  const roles = input.roles ??
    (asRecord(payload.roles) as SessionRecord["roles"]);
  return {
    ...payload,
    childRunIds: [...childRunIds],
    roles: { ...roles },
  };
}

function rowToSession(row: SessionRow): SessionRecord {
  const payload = parseJson<unknown>(row.payload);
  const payloadRecord = asRecord(payload);
  const childRunIds = Array.isArray(payloadRecord.childRunIds)
    ? payloadRecord.childRunIds.filter(
        (runId): runId is string => typeof runId === "string",
      )
    : [];
  const roles = asRecord(payloadRecord.roles) as SessionRecord["roles"];
  return {
    id: row.id,
    kind: row.kind as SessionKind,
    parentSessionId: row.parent_session_id ?? undefined,
    agentRole: (row.agent_role ?? undefined) as SessionRecord["agentRole"],
    title: row.title ?? undefined,
    rootRunId: row.root_run_id ?? undefined,
    status: (row.status ?? undefined) as SessionRecord["status"],
    workspaceId: row.workspace_id ?? undefined,
    ...(row.kind === "multi_agent" ? { childRunIds, roles } : {}),
    payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SESSION_COLUMNS =
  "id, kind, parent_session_id, agent_role, title, root_run_id, status, workspace_id, payload, created_at, updated_at";

export function createSessionRepository(
  storage: Storage,
  options: { now?: () => string } = {},
): SessionRepository {
  const db = storage.db;
  const now = options.now ?? (() => new Date().toISOString());

  function getSession(id: string): SessionRecord | null {
    const row = db
      .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`)
      .get(id) as SessionRow | undefined;
    return row ? rowToSession(row) : null;
  }

  function upsert(input: SessionInput): SessionRecord {
    const updatedAt = input.updatedAt ?? now();
    const createdAt = input.createdAt ?? updatedAt;
    const payload = buildSessionPayload(input);
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
      jsonify(payload),
      createdAt,
      updatedAt,
    );
    return getSession(input.id)!;
  }

  const appendChildRunTransaction = db.transaction(
    (
      sessionId: string,
      runId: string,
      role: Parameters<SessionRepository["appendChildRun"]>[2],
    ): SessionRecord | null => {
      const existing = getSession(sessionId);
      if (!existing || existing.kind !== "multi_agent") return null;

      const childRunIds = existing.childRunIds ?? [];
      const roles = existing.roles ?? {};
      if (childRunIds.includes(runId) && roles[runId] === role) {
        return existing;
      }

      const nextChildRunIds = childRunIds.includes(runId)
        ? childRunIds
        : [...childRunIds, runId];
      const nextRoles = { ...roles, [runId]: role };
      return upsert({
        ...existing,
        id: sessionId,
        kind: existing.kind,
        childRunIds: nextChildRunIds,
        roles: nextRoles,
        payload: {
          ...asRecord(existing.payload),
          childRunIds: nextChildRunIds,
          roles: nextRoles,
        },
        updatedAt: now(),
      });
    },
  );

  const setSessionStatusTransaction = db.transaction(
    (
      sessionId: string,
      status: Parameters<SessionRepository["setSessionStatus"]>[1],
    ): SessionRecord | null => {
      const existing = getSession(sessionId);
      if (!existing || existing.kind !== "multi_agent") return null;
      if (existing.status === status) {
        return existing;
      }
      return upsert({
        ...existing,
        id: sessionId,
        kind: existing.kind,
        status,
        payload: { ...asRecord(existing.payload), status },
        updatedAt: now(),
      });
    },
  );

  return {
    createSession(input: SessionInput): SessionRecord {
      return upsert(input);
    },

    getSession,

    listSessions(options?: { kind?: SessionKind }): SessionRecord[] {
      const rows = options?.kind
        ? (db
            .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE kind = ? ORDER BY updated_at DESC, id DESC`)
            .all(options.kind) as SessionRow[])
        : (db
            .prepare(`SELECT ${SESSION_COLUMNS} FROM sessions ORDER BY updated_at DESC, id DESC`)
            .all() as SessionRow[]);
      return rows.map(rowToSession);
    },

    appendChildRun(
      sessionId: string,
      runId: string,
      role: Parameters<SessionRepository["appendChildRun"]>[2],
    ): SessionRecord | null {
      return appendChildRunTransaction(sessionId, runId, role);
    },

    setSessionStatus(
      sessionId: string,
      status: Parameters<SessionRepository["setSessionStatus"]>[1],
    ): SessionRecord | null {
      return setSessionStatusTransaction(sessionId, status);
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
      const terms = tokenizeSearchQuery(options.query);
      if (!terms.length) return [];
      const rows = options.sessionId
        ? (db
            .prepare(
              `SELECT m.id, m.session_id, m.role, m.content, m.payload, m.created_at, s.title AS session_title
               FROM chat_messages m JOIN sessions s ON s.id = m.session_id
               WHERE m.session_id = ?
               ORDER BY m.created_at DESC`,
            )
            .all(options.sessionId) as Array<{
            id: string;
            session_id: string;
            role: string;
            content: string;
            payload: string;
            created_at: string;
            session_title: string | null;
          }>)
        : (db
            .prepare(
              `SELECT m.id, m.session_id, m.role, m.content, m.payload, m.created_at, s.title AS session_title
               FROM chat_messages m JOIN sessions s ON s.id = m.session_id
               ORDER BY m.created_at DESC`,
            )
            .all() as Array<{
            id: string;
            session_id: string;
            role: string;
            content: string;
            payload: string;
            created_at: string;
            session_title: string | null;
          }>);
      return rows
        .map((r) => scoreMessageRow(r, terms))
        .filter((result) => result.score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            right.createdAt.localeCompare(left.createdAt),
        )
        .slice(0, limit);
    },
  };
}

function tokenizeSearchQuery(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function scoreMessageRow(
  row: {
    id: string;
    session_id: string;
    role: string;
    content: string;
    payload: string;
    created_at: string;
    session_title: string | null;
  },
  terms: string[],
): ChatMessageSearchResult {
  const content = row.content.toLowerCase();
  const title = (row.session_title ?? "").toLowerCase();
  const matchedTerms: string[] = [];
  let score = 0;

  for (const term of terms) {
    const contentMatch = content.includes(term);
    const titleMatch = title.includes(term);
    if (!contentMatch && !titleMatch) {
      continue;
    }

    matchedTerms.push(term);
    score += contentMatch ? 2 : 0;
    score += titleMatch ? 1 : 0;
  }

  const payload = parseJson<{ id?: unknown }>(row.payload);
  return {
    sessionId: row.session_id,
    sessionTitle: row.session_title ?? "",
    messageId: typeof payload?.id === "string" ? payload.id : row.id,
    role: row.role as ChatMessageSearchResult["role"],
    content: row.content,
    createdAt: row.created_at,
    score,
    matchedTerms,
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
