import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ChatMessageSearchOptions,
  ChatMessageSearchResult,
  ChatMessageRecord,
  ChatSessionGoalSummary,
  ChatSessionListItem,
  ChatSessionRecord,
  ChatSessionTokenUsage,
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
  archive(sessionId: string): Promise<ChatSessionRecord | null>;
  restore(sessionId: string): Promise<ChatSessionRecord | null>;
  delete(sessionId: string): Promise<boolean>;
  addTokenUsage(
    sessionId: string,
    usage: ChatSessionTokenUsage,
  ): Promise<ChatSessionRecord | null>;
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
  let mutationQueue = Promise.resolve();

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
      if (error instanceof SyntaxError) {
        await quarantineCorruptJsonFile(sessionsPath);
        return { schemaVersion: 1, sessions: [] };
      }

      throw error;
    }
  }

  async function writeStoredSessions(stored: StoredChatSessions) {
    await writeJsonFileAtomically(
      options.configDir,
      sessionsPath,
      `${JSON.stringify(stored, null, 2)}\n`,
    );
  }

  async function updateSessionById(
    sessionId: string,
    update: (session: ChatSessionRecord) => ChatSessionRecord,
  ): Promise<ChatSessionRecord | null> {
    return serializeMutation(mutationQueue, (nextQueue) => {
      mutationQueue = nextQueue;
    }, async () => {
      const stored = await readStoredSessions();
      const existingSession = stored.sessions.find(
        (session) => session.id === sessionId,
      );
      if (!existingSession) {
        return null;
      }

      const nextSession = update(existingSession);
      await writeStoredSessions({
        schemaVersion: 1,
        sessions: stored.sessions.map((session) =>
          session.id === sessionId ? nextSession : session,
        ),
      });

      return nextSession;
    });
  }

  return {
    async list() {
      const stored = await readStoredSessions();
      return stored.sessions
        .slice()
        .sort(compareSessionsForList)
        .map(toListItem);
    },

    async get(sessionId) {
      const stored = await readStoredSessions();
      return stored.sessions.find((session) => session.id === sessionId) ?? null;
    },

    async appendMessage(input) {
      return serializeMutation(mutationQueue, (nextQueue) => {
        mutationQueue = nextQueue;
      }, async () => {
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
      });
    },

    async archive(sessionId) {
      return updateSessionById(sessionId, (session) => ({
        ...session,
        archivedAt: now().toISOString(),
      }));
    },

    async restore(sessionId) {
      return updateSessionById(sessionId, (session) => {
        const { archivedAt: _archivedAt, ...rest } = session;
        return rest;
      });
    },

    async delete(sessionId) {
      return serializeMutation(mutationQueue, (nextQueue) => {
        mutationQueue = nextQueue;
      }, async () => {
        const stored = await readStoredSessions();
        const nextSessions = stored.sessions.filter(
          (session) => session.id !== sessionId,
        );
        if (nextSessions.length === stored.sessions.length) {
          return false;
        }

        await writeStoredSessions({
          schemaVersion: 1,
          sessions: nextSessions,
        });

        return true;
      });
    },

    async addTokenUsage(sessionId, usage) {
      const normalizedUsage = normalizeTokenUsage(usage);
      return updateSessionById(sessionId, (session) => ({
        ...session,
        tokenUsage: mergeTokenUsage(session.tokenUsage, normalizedUsage),
      }));
    },

    async attachGoal(sessionId, goal) {
      return serializeMutation(mutationQueue, (nextQueue) => {
        mutationQueue = nextQueue;
      }, async () => {
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
      });
    },

    async clearActiveGoal(sessionId, goalId) {
      return serializeMutation(mutationQueue, (nextQueue) => {
        mutationQueue = nextQueue;
      }, async () => {
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
      });
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

function serializeMutation<T>(
  currentQueue: Promise<void>,
  setQueue: (queue: Promise<void>) => void,
  operation: () => Promise<T>,
): Promise<T> {
  const result = currentQueue.then(operation, operation);
  setQueue(result.then(
    () => undefined,
    () => undefined,
  ));
  return result;
}

async function writeJsonFileAtomically(
  directory: string,
  filePath: string,
  content: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(tempPath, content, { encoding: "utf8" });
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
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
    ...(session.archivedAt ? { archivedAt: session.archivedAt } : {}),
    lastAssistantMessageAt: getLastAssistantMessageAt(session),
    ...(session.tokenUsage ? { tokenUsage: session.tokenUsage } : {}),
    updatedAt: session.updatedAt,
  };
}

async function quarantineCorruptJsonFile(filePath: string): Promise<void> {
  try {
    await rename(filePath, `${filePath}.corrupt-${Date.now()}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
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
    ...(session.archivedAt ? { archivedAt: String(session.archivedAt) } : {}),
    ...(session.tokenUsage
      ? { tokenUsage: normalizeTokenUsage(session.tokenUsage) }
      : {}),
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

function compareSessionsForList(
  left: ChatSessionRecord,
  right: ChatSessionRecord,
): number {
  const leftArchived = Boolean(left.archivedAt);
  const rightArchived = Boolean(right.archivedAt);
  if (leftArchived !== rightArchived) {
    return leftArchived ? 1 : -1;
  }
  if (leftArchived && rightArchived) {
    return (
      (right.archivedAt ?? "").localeCompare(left.archivedAt ?? "") ||
      right.updatedAt.localeCompare(left.updatedAt)
    );
  }
  return right.updatedAt.localeCompare(left.updatedAt);
}

function getLastAssistantMessageAt(session: ChatSessionRecord): string {
  const assistantMessage = session.messages
    .slice()
    .reverse()
    .find((message) => message.role === "assistant");
  return assistantMessage?.createdAt ?? session.updatedAt;
}

function normalizeTokenUsage(
  usage: ChatSessionTokenUsage,
): ChatSessionTokenUsage {
  const promptTokens = normalizeOptionalTokenCount(usage.promptTokens);
  const completionTokens = normalizeOptionalTokenCount(usage.completionTokens);
  const totalTokens = Math.max(0, Math.floor(Number(usage.totalTokens) || 0));

  return {
    totalTokens,
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    estimated: Boolean(usage.estimated),
  };
}

function normalizeOptionalTokenCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}

function mergeTokenUsage(
  current: ChatSessionTokenUsage | undefined,
  next: ChatSessionTokenUsage,
): ChatSessionTokenUsage {
  return {
    totalTokens: (current?.totalTokens ?? 0) + next.totalTokens,
    ...(current?.promptTokens !== undefined || next.promptTokens !== undefined
      ? { promptTokens: (current?.promptTokens ?? 0) + (next.promptTokens ?? 0) }
      : {}),
    ...(current?.completionTokens !== undefined ||
    next.completionTokens !== undefined
      ? {
          completionTokens:
            (current?.completionTokens ?? 0) + (next.completionTokens ?? 0),
        }
      : {}),
    estimated: Boolean(current?.estimated || next.estimated),
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
  const normalized = normalizeSessionTitleText(content);
  if (!normalized) {
    return "新会话";
  }

  if (
    /项目|仓库|代码|repo/i.test(normalized) &&
    /review|复盘|审查|检查/i.test(normalized) &&
    /优化|迭代|改进|方案|建议/i.test(normalized)
  ) {
    return "项目 Review 优化";
  }

  if (/整理/.test(normalized) && /下载/.test(normalized) && /报告/.test(normalized)) {
    return "整理下载报告";
  }

  if (/整理/.test(normalized) && /下载/.test(normalized)) {
    return "整理下载文件夹";
  }

  if (/调研|研究/.test(normalized) && /投资/.test(normalized)) {
    return "投资方法调研";
  }

  return normalized.length > 16 ? `${normalized.slice(0, 15)}…` : normalized;
}

function normalizeSessionTitleText(content: string): string {
  return content
    .trim()
    .replace(/^\/(?:目标|goal)\s*/i, "")
    .replace(/(["'`])\/.*?\1/g, "")
    .replace(/\/[^\s，。；;,]+(?:\s+[^\s，。；;,]+)*/g, "")
    .replace(/项目位置是[:：]?/g, "")
    .replace(/(?:请|麻烦)?帮我/g, "")
    .replace(/你自己这个/g, "")
    .replace(/自己这个/g, "")
    .replace(/这个/g, "")
    .replace(/[，。；;:：、"'`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
