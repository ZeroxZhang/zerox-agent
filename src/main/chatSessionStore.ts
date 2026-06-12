import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ChatMessageSearchOptions,
  ChatMessageSearchResult,
  ChatMessageRecord,
  ChatSessionGoalSummary,
  ChatSessionListItem,
  ChatSessionRecord,
} from "../shared/chat";

type StoredChatSessions = {
  schemaVersion: 1;
  sessions: ChatSessionRecord[];
};

export type AppendChatMessageInput = {
  sessionId?: string;
  role: ChatMessageRecord["role"];
  content: string;
  relatedMemoryIds?: string[];
  executedRunId?: string;
  goalId?: string;
  goalEventRef?: string;
};

export type AppendChatMessageResult = {
  session: ChatSessionRecord;
  message: ChatMessageRecord;
};

export type ChatSessionStore = {
  list(): Promise<ChatSessionListItem[]>;
  get(sessionId: string): Promise<ChatSessionRecord | null>;
  appendMessage(input: AppendChatMessageInput): Promise<AppendChatMessageResult>;
  attachGoal(
    sessionId: string,
    goal: ChatSessionGoalSummary,
  ): Promise<ChatSessionRecord>;
  clearActiveGoal(
    sessionId: string,
    goalId: string,
  ): Promise<ChatSessionRecord | null>;
  searchMessages(
    options: ChatMessageSearchOptions,
  ): Promise<ChatMessageSearchResult[]>;
};

export function createChatSessionStore(options: {
  configDir: string;
  createId?: () => string;
  now?: () => Date;
}): ChatSessionStore {
  const sessionsPath = path.join(options.configDir, "chat-sessions.json");
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  async function readStoredSessions(): Promise<StoredChatSessions> {
    try {
      const raw = await readFile(sessionsPath, { encoding: "utf8" });
      const stored = JSON.parse(raw) as StoredChatSessions;
      return {
        schemaVersion: 1,
        sessions: Array.isArray(stored.sessions)
          ? stored.sessions.map(normalizeStoredSession)
          : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, sessions: [] };
      }

      throw error;
    }
  }

  async function writeStoredSessions(stored: StoredChatSessions) {
    await mkdir(options.configDir, { recursive: true });
    await writeFile(sessionsPath, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: "utf8",
    });
  }

  return {
    async list() {
      const stored = await readStoredSessions();
      return stored.sessions
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(toListItem);
    },

    async get(sessionId) {
      const stored = await readStoredSessions();
      return stored.sessions.find((session) => session.id === sessionId) ?? null;
    },

    async appendMessage(input) {
      const content = input.content.trim();
      const timestamp = now().toISOString();
      const stored = await readStoredSessions();
      const existingSession = input.sessionId
        ? stored.sessions.find((session) => session.id === input.sessionId)
        : null;
      const newSessionId = existingSession ? null : createId();
      const message: ChatMessageRecord = {
        id: createId(),
        role: input.role,
        content,
        ...(input.relatedMemoryIds?.length
          ? { relatedMemoryIds: input.relatedMemoryIds }
          : {}),
        ...(input.executedRunId ? { executedRunId: input.executedRunId } : {}),
        ...(input.goalId ? { goalId: input.goalId } : {}),
        ...(input.goalEventRef ? { goalEventRef: input.goalEventRef } : {}),
        createdAt: timestamp,
      };
      const session = existingSession
        ? {
            ...existingSession,
            summary: content || existingSession.summary,
            messages: [...existingSession.messages, message],
            updatedAt: timestamp,
          }
        : createSession({
            sessionId: newSessionId ?? createId(),
            content,
            message,
            timestamp,
          });
      const nextSessions = existingSession
        ? stored.sessions.map((storedSession) =>
            storedSession.id === session.id ? session : storedSession,
          )
        : [...stored.sessions, session];

      await writeStoredSessions({
        schemaVersion: 1,
        sessions: nextSessions,
      });

      return { session, message };
    },

    async attachGoal(sessionId, goal) {
      const stored = await readStoredSessions();
      const existingSession = stored.sessions.find(
        (session) => session.id === sessionId,
      );
      if (!existingSession) {
        throw new Error(`Chat session "${sessionId}" was not found.`);
      }

      const timestamp = now().toISOString();
      const nextSession = attachGoalToSession(existingSession, goal, timestamp);
      await writeStoredSessions({
        schemaVersion: 1,
        sessions: stored.sessions.map((session) =>
          session.id === sessionId ? nextSession : session,
        ),
      });

      return nextSession;
    },

    async clearActiveGoal(sessionId, goalId) {
      const stored = await readStoredSessions();
      const existingSession = stored.sessions.find(
        (session) => session.id === sessionId,
      );
      if (!existingSession) {
        return null;
      }
      if (existingSession.activeGoalId !== goalId) {
        return existingSession;
      }

      const { activeGoalId: _activeGoalId, ...sessionWithoutActiveGoal } =
        existingSession;
      const nextSession = {
        ...sessionWithoutActiveGoal,
        updatedAt: now().toISOString(),
      };
      await writeStoredSessions({
        schemaVersion: 1,
        sessions: stored.sessions.map((session) =>
          session.id === sessionId ? nextSession : session,
        ),
      });

      return nextSession;
    },

    async searchMessages(options) {
      const terms = tokenize(options.query);
      if (!terms.length) {
        return [];
      }

      const stored = await readStoredSessions();
      const sessions = options.sessionId
        ? stored.sessions.filter((session) => session.id === options.sessionId)
        : stored.sessions;

      return sessions
        .flatMap((session) =>
          session.messages.map((message) =>
            scoreMessage(session, message, terms),
          ),
        )
        .filter((result) => result.score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            right.createdAt.localeCompare(left.createdAt),
        )
        .slice(0, options.limit ?? 20);
    },
  };
}

function createSession(options: {
  sessionId: string;
  content: string;
  message: ChatMessageRecord;
  timestamp: string;
}): ChatSessionRecord {
  const title = createSessionTitle(options.content);
  return {
    id: options.sessionId,
    title,
    summary: title,
    messages: [options.message],
    createdAt: options.timestamp,
    updatedAt: options.timestamp,
  };
}

function toListItem(session: ChatSessionRecord): ChatSessionListItem {
  const activeGoal = session.goalSummaries?.find(
    (goal) => goal.id === session.activeGoalId,
  );
  return {
    id: session.id,
    title: session.title,
    summary: session.summary,
    messageCount: session.messages.length,
    ...(activeGoal ? { activeGoal } : {}),
    updatedAt: session.updatedAt,
  };
}

function normalizeStoredSession(session: ChatSessionRecord): ChatSessionRecord {
  const activeGoalId = session.activeGoalId
    ? String(session.activeGoalId)
    : undefined;
  const goalIds = Array.isArray(session.goalIds)
    ? uniqueStrings(session.goalIds)
    : [];
  const goalSummaries = Array.isArray(session.goalSummaries)
    ? session.goalSummaries.map(normalizeGoalSummary)
    : [];
  return {
    id: String(session.id ?? ""),
    title: String(session.title ?? "未命名会话"),
    summary: String(session.summary ?? ""),
    messages: Array.isArray(session.messages)
      ? session.messages.map(normalizeStoredMessage)
      : [],
    ...(activeGoalId ? { activeGoalId } : {}),
    ...(goalIds.length ? { goalIds } : {}),
    ...(goalSummaries.length ? { goalSummaries } : {}),
    createdAt: String(session.createdAt ?? new Date(0).toISOString()),
    updatedAt: String(session.updatedAt ?? session.createdAt ?? new Date(0).toISOString()),
  };
}

function normalizeStoredMessage(message: ChatMessageRecord): ChatMessageRecord {
  const role = message.role === "user" ? "user" : "assistant";
  return {
    id: String(message.id ?? ""),
    role,
    content: String(message.content ?? ""),
    ...(message.relatedMemoryIds?.length
      ? { relatedMemoryIds: message.relatedMemoryIds.map(String) }
      : {}),
    ...(message.executedRunId ? { executedRunId: String(message.executedRunId) } : {}),
    ...(message.goalId ? { goalId: String(message.goalId) } : {}),
    ...(message.goalEventRef ? { goalEventRef: String(message.goalEventRef) } : {}),
    createdAt: String(message.createdAt ?? new Date(0).toISOString()),
  };
}

function normalizeGoalSummary(goal: ChatSessionGoalSummary): ChatSessionGoalSummary {
  return {
    id: String(goal.id ?? ""),
    description: String(goal.description ?? ""),
    status: goal.status,
  };
}

function attachGoalToSession(
  session: ChatSessionRecord,
  goal: ChatSessionGoalSummary,
  updatedAt: string,
): ChatSessionRecord {
  const normalizedGoal = normalizeGoalSummary(goal);
  const goalIds = uniqueStrings([...(session.goalIds ?? []), normalizedGoal.id]);
  const existingSummaries = session.goalSummaries ?? [];
  const goalSummaries = [
    ...existingSummaries.filter((candidate) => candidate.id !== normalizedGoal.id),
    normalizedGoal,
  ];

  return {
    ...session,
    activeGoalId: normalizedGoal.id,
    goalIds,
    goalSummaries,
    updatedAt,
  };
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(values.map((value) => String(value)).filter(Boolean)),
  );
}

function createSessionTitle(content: string): string {
  const normalized = content.trim();
  if (!normalized) {
    return "新会话";
  }

  return normalized.length > 32 ? `${normalized.slice(0, 31)}…` : normalized;
}

function scoreMessage(
  session: ChatSessionRecord,
  message: ChatMessageRecord,
  terms: string[],
): ChatMessageSearchResult {
  const content = message.content.toLowerCase();
  const title = session.title.toLowerCase();
  const matchedTerms: string[] = [];
  let score = 0;

  for (const term of terms) {
    const normalizedTerm = term.toLowerCase();
    const contentMatch = content.includes(normalizedTerm);
    const titleMatch = title.includes(normalizedTerm);

    if (!contentMatch && !titleMatch) {
      continue;
    }

    matchedTerms.push(term);
    score += contentMatch ? 2 : 0;
    score += titleMatch ? 1 : 0;
  }

  return {
    sessionId: session.id,
    sessionTitle: session.title,
    messageId: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    score,
    matchedTerms,
  };
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}
