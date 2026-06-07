import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ChatMessageRecord,
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
};

export type AppendChatMessageResult = {
  session: ChatSessionRecord;
  message: ChatMessageRecord;
};

export type ChatSessionStore = {
  list(): Promise<ChatSessionListItem[]>;
  get(sessionId: string): Promise<ChatSessionRecord | null>;
  appendMessage(input: AppendChatMessageInput): Promise<AppendChatMessageResult>;
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
  return {
    id: session.id,
    title: session.title,
    summary: session.summary,
    messageCount: session.messages.length,
    updatedAt: session.updatedAt,
  };
}

function normalizeStoredSession(session: ChatSessionRecord): ChatSessionRecord {
  return {
    id: String(session.id ?? ""),
    title: String(session.title ?? "未命名会话"),
    summary: String(session.summary ?? ""),
    messages: Array.isArray(session.messages)
      ? session.messages.map(normalizeStoredMessage)
      : [],
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
    createdAt: String(message.createdAt ?? new Date(0).toISOString()),
  };
}

function createSessionTitle(content: string): string {
  const normalized = content.trim();
  if (!normalized) {
    return "新会话";
  }

  return normalized.length > 32 ? `${normalized.slice(0, 31)}…` : normalized;
}
