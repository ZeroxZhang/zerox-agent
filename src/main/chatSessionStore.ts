import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ChatAttachmentMetadata,
  ChatAttachmentInput,
  ChatMessageSearchOptions,
  ChatMessageSearchResult,
  ChatMessageRecord,
  ChatSessionGoalSummary,
  ChatSessionActivitySnapshot,
  ChatSessionListItem,
  ChatSessionRecord,
  ChatSessionTokenUsage,
  ChatTaskStatusEvent,
  ChatWorkspaceSummary,
  SkillInputField,
  SkillInputFieldType,
  SkillPendingInputState,
  SkillUserInputRequest,
} from "../shared/chat";
import type { ChatOutputPart } from "../shared/chatOutput";

type StoredChatSessions = {
  schemaVersion: 1;
  sessions: ChatSessionRecord[];
};

const SESSION_SUMMARY_PREVIEW_MAX_CHARS = 160;

export type AppendChatMessageInput = {
  sessionId?: string;
  requestId?: string;
  role: ChatMessageRecord["role"];
  content: string;
  outputParts?: ChatOutputPart[];
  relatedMemoryIds?: string[];
  executedRunId?: string;
  goalId?: string;
  goalEventRef?: string;
  attachments?: ChatAttachmentMetadata[];
  workspaceId?: string;
  workspaceSummary?: ChatWorkspaceSummary;
};

export type AppendChatMessageResult = {
  session: ChatSessionRecord;
  message: ChatMessageRecord;
};

export type ChatSessionStore = {
  flush(): Promise<void>;
  list(): Promise<ChatSessionListItem[]>;
  get(sessionId: string): Promise<ChatSessionRecord | null>;
  appendMessage(input: AppendChatMessageInput): Promise<AppendChatMessageResult>;
  rename(sessionId: string, title: string): Promise<ChatSessionRecord | null>;
  archive(sessionId: string): Promise<ChatSessionRecord | null>;
  restore(sessionId: string): Promise<ChatSessionRecord | null>;
  delete(sessionId: string): Promise<boolean>;
  addTokenUsage(
    sessionId: string,
    usage: ChatSessionTokenUsage,
  ): Promise<ChatSessionRecord | null>;
  appendActivityEvent(
    sessionId: string,
    event: ChatTaskStatusEvent,
    options?: { selectedSkillName?: string },
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
  let storedSessionsCache: StoredChatSessions | null = null;

  async function readStoredSessions(): Promise<StoredChatSessions> {
    if (storedSessionsCache) {
      return storedSessionsCache;
    }

    try {
      const raw = await readFile(sessionsPath, { encoding: "utf8" });
      const stored = JSON.parse(raw) as StoredChatSessions;
      storedSessionsCache = {
        schemaVersion: 1,
        sessions: Array.isArray(stored.sessions)
          ? stored.sessions.map(normalizeStoredSession)
          : [],
      };
      return storedSessionsCache;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        storedSessionsCache = { schemaVersion: 1, sessions: [] };
        return storedSessionsCache;
      }
      if (error instanceof SyntaxError) {
        const quarantinedPath = await quarantineCorruptJsonFile(sessionsPath);
        const timestamp = now().toISOString();
        const warningMessage = [
          "检测到会话存储损坏，原文件已隔离，应用没有把它静默当作空历史。",
          quarantinedPath ? `隔离文件：${quarantinedPath}` : "原文件已被其他恢复流程隔离。",
          "你可以继续新会话；如需恢复旧内容，请从隔离文件备份中处理。",
        ].join("\n");
        storedSessionsCache = {
          schemaVersion: 1,
          sessions: [
            createSession({
              sessionId: `recovery_corrupt_${Date.now()}`,
              content: "会话存储恢复通知",
              message: {
                id: `recovery_message_${Date.now()}`,
                role: "assistant",
                content: warningMessage,
                createdAt: timestamp,
              },
              timestamp,
            }),
          ],
        };
        return storedSessionsCache;
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
    storedSessionsCache = stored;
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
    async flush() {
      await mutationQueue;
    },
    async list() {
      await mutationQueue;
      const stored = await readStoredSessions();
      return stored.sessions
        .slice()
        .sort(compareSessionsForList)
        .map(toListItem);
    },

    async get(sessionId) {
      await mutationQueue;
      const stored = await readStoredSessions();
      return stored.sessions.find((session) => session.id === sessionId) ?? null;
    },

    async appendMessage(input) {
      return serializeMutation(mutationQueue, (nextQueue) => {
        mutationQueue = nextQueue;
      }, async () => {
        const content = input.content;
        const summaryContent = summarizeSessionContent(content);
        const stored = await readStoredSessions();
        const existingSession = input.sessionId
          ? stored.sessions.find((session) => session.id === input.sessionId)
          : null;
        const retriedAttachmentMessage = existingSession
          ? findRetriedAttachmentMessage(input, existingSession)
          : null;
        if (retriedAttachmentMessage && existingSession) {
          return {
            session: existingSession,
            message: retriedAttachmentMessage,
          };
        }
        const timestamp = now().toISOString();
        const newSessionId = existingSession ? null : createId();
        const workspaceId =
          normalizeOptionalString(input.workspaceId) ?? existingSession?.workspaceId;
        const workspaceSummary =
          normalizeChatWorkspaceSummary(input.workspaceSummary) ??
          existingSession?.workspaceSummary;
        const message: ChatMessageRecord = {
          id: createId(),
          ...(input.requestId ? { requestId: input.requestId } : {}),
          role: input.role,
          content,
          ...(input.outputParts?.length ? { outputParts: input.outputParts } : {}),
          ...(input.relatedMemoryIds?.length
            ? { relatedMemoryIds: input.relatedMemoryIds }
            : {}),
          ...(input.executedRunId ? { executedRunId: input.executedRunId } : {}),
          ...(input.goalId ? { goalId: input.goalId } : {}),
          ...(input.goalEventRef ? { goalEventRef: input.goalEventRef } : {}),
          ...(input.attachments?.length ? { attachments: input.attachments } : {}),
          createdAt: timestamp,
        };
        const session = existingSession
          ? {
              ...existingSession,
              summary: summaryContent || existingSession.summary,
              messages: [...existingSession.messages, message],
              ...(workspaceId ? { workspaceId } : {}),
              ...(workspaceSummary ? { workspaceSummary } : {}),
              updatedAt: timestamp,
            }
          : createSession({
              sessionId: newSessionId ?? createId(),
              content: summaryContent,
              message,
              timestamp,
              ...(workspaceId ? { workspaceId } : {}),
              ...(workspaceSummary ? { workspaceSummary } : {}),
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

    async rename(sessionId, title) {
      const normalizedTitle = normalizeSessionTitle(title);
      if (!normalizedTitle) {
        throw new Error("Session title is required.");
      }

      return updateSessionById(sessionId, (session) => ({
        ...session,
        title: normalizedTitle,
      }));
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

    async appendActivityEvent(sessionId, event, eventOptions) {
      return updateSessionById(sessionId, (session) => {
        const normalizedEvent = normalizeStatusEvent(event);
        const previousEvents = session.activity?.statusEvents ?? [];
        const statusEvents = [...previousEvents, normalizedEvent].slice(-80);
        const selectedSkillName =
          eventOptions?.selectedSkillName ??
          normalizedEvent.selectedSkillName ??
          session.activity?.selectedSkillName;
        return {
          ...session,
          activity: {
            updatedAt: normalizedEvent.createdAt,
            statusEvents,
            ...(selectedSkillName ? { selectedSkillName } : {}),
          },
          updatedAt: normalizedEvent.createdAt,
        };
      });
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

function findRetriedAttachmentMessage(
  input: AppendChatMessageInput,
  session: ChatSessionRecord,
): ChatMessageRecord | null {
  if (input.role !== "user" || !input.attachments?.length) {
    return null;
  }
  const lastMessage = session.messages.at(-1);
  if (
    !lastMessage ||
    lastMessage.role !== "user" ||
    lastMessage.content !== input.content ||
    !areAttachmentMetadataListsEqual(
      lastMessage.attachments,
      input.attachments,
    )
  ) {
    return null;
  }
  return lastMessage;
}

function areAttachmentMetadataListsEqual(
  left: ChatAttachmentMetadata[] | undefined,
  right: ChatAttachmentMetadata[],
): boolean {
  return (
    left?.length === right.length &&
    right.every((attachment, index) => {
      const candidate = left[index];
      return (
        candidate?.id === attachment.id &&
        candidate.name === attachment.name &&
        candidate.mediaType === attachment.mediaType &&
        candidate.size === attachment.size &&
        candidate.kind === attachment.kind
      );
    })
  );
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
  workspaceId?: string;
  workspaceSummary?: ChatWorkspaceSummary;
}): ChatSessionRecord {
  const title = createSessionTitle(options.content);
  return {
    id: options.sessionId,
    title,
    summary: title,
    messages: [options.message],
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    ...(options.workspaceSummary
      ? { workspaceSummary: options.workspaceSummary }
      : {}),
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
    summary: summarizeSessionContent(session.summary),
    messageCount: session.messages.length,
    ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
    ...(session.workspaceSummary
      ? { workspaceSummary: session.workspaceSummary }
      : {}),
    ...(activeGoal ? { activeGoal } : {}),
    ...(session.archivedAt ? { archivedAt: session.archivedAt } : {}),
    lastAssistantMessageAt: getLastAssistantMessageAt(session),
    ...(session.tokenUsage ? { tokenUsage: session.tokenUsage } : {}),
    updatedAt: session.updatedAt,
  };
}

function summarizeSessionContent(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= SESSION_SUMMARY_PREVIEW_MAX_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, SESSION_SUMMARY_PREVIEW_MAX_CHARS - 3)}...`;
}

async function quarantineCorruptJsonFile(filePath: string): Promise<string | null> {
  const quarantinedPath = `${filePath}.corrupt-${Date.now()}`;
  try {
    await rename(filePath, quarantinedPath);
    return quarantinedPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    return null;
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
  const workspaceId = normalizeOptionalString(session.workspaceId);
  const workspaceSummary = normalizeChatWorkspaceSummary(session.workspaceSummary);
  return {
    id: String(session.id ?? ""),
    title: String(session.title ?? "未命名会话"),
    summary: String(session.summary ?? ""),
    messages: Array.isArray(session.messages)
      ? session.messages.map(normalizeStoredMessage)
      : [],
    ...(workspaceId ? { workspaceId } : {}),
    ...(workspaceSummary ? { workspaceSummary } : {}),
    ...(activeGoalId ? { activeGoalId } : {}),
    ...(goalIds.length ? { goalIds } : {}),
    ...(goalSummaries.length ? { goalSummaries } : {}),
    ...(session.activity
      ? { activity: normalizeActivitySnapshot(session.activity) }
      : {}),
    ...(session.archivedAt ? { archivedAt: String(session.archivedAt) } : {}),
    ...(session.tokenUsage
      ? { tokenUsage: normalizeTokenUsage(session.tokenUsage) }
      : {}),
    createdAt: String(session.createdAt ?? new Date(0).toISOString()),
    updatedAt: String(session.updatedAt ?? session.createdAt ?? new Date(0).toISOString()),
  };
}

function normalizeActivitySnapshot(
  snapshot: ChatSessionActivitySnapshot,
): ChatSessionActivitySnapshot {
  const statusEvents = Array.isArray(snapshot.statusEvents)
    ? snapshot.statusEvents.map(normalizeStatusEvent).filter(Boolean)
    : [];
  return {
    updatedAt: String(snapshot.updatedAt ?? new Date(0).toISOString()),
    statusEvents,
    ...(snapshot.selectedSkillName
      ? { selectedSkillName: String(snapshot.selectedSkillName) }
      : {}),
  };
}

function normalizeStatusEvent(event: ChatTaskStatusEvent): ChatTaskStatusEvent {
  const state = normalizeStatusEventState(event.state);
  const inputRequest = normalizeSkillUserInputRequest(event.inputRequest);
  const pendingSkillInput = normalizeSkillPendingInputState(
    event.pendingSkillInput,
  );
  return {
    sessionId: String(event.sessionId ?? ""),
    ...(normalizeOptionalString(event.requestId)
      ? { requestId: normalizeOptionalString(event.requestId) }
      : {}),
    ...(typeof event.sequence === "number" && Number.isFinite(event.sequence)
      ? { sequence: Math.max(0, Math.floor(event.sequence)) }
      : {}),
    ...(normalizeOptionalString(event.turnId)
      ? { turnId: normalizeOptionalString(event.turnId) }
      : {}),
    state,
    message: String(event.message ?? ""),
    createdAt: String(event.createdAt ?? new Date(0).toISOString()),
    elapsedMs:
      typeof event.elapsedMs === "number" && Number.isFinite(event.elapsedMs)
        ? event.elapsedMs
        : 0,
    ...(typeof event.turn === "number" ? { turn: event.turn } : {}),
    ...(event.toolCallId ? { toolCallId: String(event.toolCallId) } : {}),
    ...(event.toolInvocationId
      ? { toolInvocationId: String(event.toolInvocationId) }
      : {}),
    ...(event.toolName ? { toolName: String(event.toolName) } : {}),
    ...(event.toolSource ? { toolSource: String(event.toolSource) } : {}),
    ...(event.resultRef ? { resultRef: String(event.resultRef) } : {}),
    ...(typeof event.resultBytes === "number" && Number.isFinite(event.resultBytes)
      ? { resultBytes: Math.max(0, Math.floor(event.resultBytes)) }
      : {}),
    ...(event.invocationStatus
      ? { invocationStatus: String(event.invocationStatus) }
      : {}),
    ...(event.checkpointId ? { checkpointId: String(event.checkpointId) } : {}),
    ...(Array.isArray(event.memoryScopes)
      ? { memoryScopes: event.memoryScopes.slice(0, 32).map(String) }
      : {}),
    ...(event.historyOperation
      ? { historyOperation: String(event.historyOperation) }
      : {}),
    ...(event.selectedSkillName
      ? { selectedSkillName: String(event.selectedSkillName) }
      : {}),
    ...(event.workspaceId ? { workspaceId: String(event.workspaceId) } : {}),
    ...(normalizeChatWorkspaceSummary(event.workspaceSummary)
      ? { workspaceSummary: normalizeChatWorkspaceSummary(event.workspaceSummary) }
      : {}),
    ...(typeof event.toolCallsExecuted === "number"
      ? { toolCallsExecuted: event.toolCallsExecuted }
      : {}),
    ...(typeof event.maxTurns === "number" ? { maxTurns: event.maxTurns } : {}),
    ...(inputRequest ? { inputRequest } : {}),
    ...(pendingSkillInput ? { pendingSkillInput } : {}),
    ...(typeof event.ok === "boolean" ? { ok: event.ok } : {}),
    ...(normalizeStatusPayload(event.payload)
      ? { payload: normalizeStatusPayload(event.payload) }
      : {}),
  };
}

function normalizeStatusPayload(
  value: unknown,
  depth = 0,
): Record<string, unknown> | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    depth > 6
  ) {
    return undefined;
  }
  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 100)) {
    if (
      key === "dataBase64" ||
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype"
    ) {
      continue;
    }
    const normalizedEntry = normalizeStatusPayloadValue(entry, depth + 1);
    if (normalizedEntry !== undefined) {
      normalized[key] = normalizedEntry;
    }
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeStatusPayloadValue(
  value: unknown,
  depth: number,
): unknown {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.slice(0, 32_000);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    if (depth > 6) {
      return undefined;
    }
    return value
      .slice(0, 100)
      .map((entry) => normalizeStatusPayloadValue(entry, depth + 1))
      .filter((entry) => entry !== undefined);
  }
  return normalizeStatusPayload(value, depth);
}

function normalizeStatusEventState(
  state: ChatTaskStatusEvent["state"],
): ChatTaskStatusEvent["state"] {
  if (
    state === "started" ||
    state === "workspace" ||
    state === "skill" ||
    state === "skill_load" ||
    state === "memory" ||
    state === "memory_scope" ||
    state === "history" ||
    state === "model" ||
    state === "reasoning" ||
    state === "streaming" ||
    state === "requirement" ||
    state === "actor_spawned" ||
    state === "actor_done" ||
    state === "tool_invocation" ||
    state === "tool_call" ||
    state === "tool_result" ||
    state === "checkpoint_boundary" ||
    state === "waiting_for_input" ||
    state === "paused" ||
    state === "canceled" ||
    state === "completed" ||
    state === "failed"
  ) {
    return state;
  }
  return "failed";
}

function normalizeSkillUserInputRequest(
  value: unknown,
): SkillUserInputRequest | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const request = value as Partial<Record<keyof SkillUserInputRequest, unknown>>;
  const fields = Array.isArray(request.fields)
    ? request.fields
        .map(normalizeSkillInputField)
        .filter((field): field is SkillInputField => Boolean(field))
    : [];

  return {
    id: String(request.id ?? ""),
    executionId: String(request.executionId ?? ""),
    sessionId: String(request.sessionId ?? ""),
    requestId: String(request.requestId ?? ""),
    skillName: String(request.skillName ?? ""),
    reason: String(request.reason ?? ""),
    fields,
    createdAt: String(request.createdAt ?? new Date(0).toISOString()),
  };
}

function normalizeSkillPendingInputState(
  value: unknown,
): SkillPendingInputState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const pending = value as Partial<
    Record<keyof SkillPendingInputState, unknown>
  >;
  const inputRequestId = normalizeOptionalString(pending.inputRequestId);
  const sessionId = normalizeOptionalString(pending.sessionId);
  const requestId = normalizeOptionalString(pending.requestId);
  const userMessage = normalizeOptionalString(pending.userMessage);
  const selectedSkillName = normalizeOptionalString(pending.selectedSkillName);
  const attachments = normalizeChatAttachmentMetadataList(pending.attachments);
  const attachmentPayloads = normalizeChatAttachmentInputList(
    pending.attachmentPayloads,
  );
  if (!inputRequestId || !sessionId || !requestId || !userMessage || !selectedSkillName) {
    return undefined;
  }

  return {
    inputRequestId,
    status: pending.status === "completed" ? "completed" : "pending",
    sessionId,
    requestId,
    userMessage,
    ...(normalizeOptionalString(pending.userMessageId)
      ? { userMessageId: normalizeOptionalString(pending.userMessageId) }
      : {}),
    selectedSkillName,
    ...(normalizeOptionalString(pending.workspaceId)
      ? { workspaceId: normalizeOptionalString(pending.workspaceId) }
      : {}),
    ...(normalizeChatWorkspaceSummary(pending.workspaceSummary)
      ? { workspaceSummary: normalizeChatWorkspaceSummary(pending.workspaceSummary) }
      : {}),
    partialValues: normalizeSkillInputValueRecord(pending.partialValues),
    ...(attachments.length ? { attachments } : {}),
    ...(attachmentPayloads.length ? { attachmentPayloads } : {}),
  };
}

function normalizeChatAttachmentInputList(value: unknown): ChatAttachmentInput[] {
  if (!Array.isArray(value)) {
    return [];
  }
  let totalBytes = 0;
  return value.slice(0, 6).flatMap((entry): ChatAttachmentInput[] => {
    const metadata = normalizeChatAttachmentMetadataList([entry])[0];
    if (!metadata || !entry || typeof entry !== "object") {
      return [];
    }
    const dataBase64 = normalizeOptionalString(
      (entry as Record<string, unknown>).dataBase64,
    );
    if (!dataBase64 || totalBytes + metadata.size > 40 * 1024 * 1024) {
      return [];
    }
    totalBytes += metadata.size;
    return [{ ...metadata, dataBase64 }];
  });
}

function normalizeChatAttachmentMetadataList(
  value: unknown,
): ChatAttachmentMetadata[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, 6).flatMap((entry): ChatAttachmentMetadata[] => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const id = normalizeOptionalString(record.id);
    const name = normalizeOptionalString(record.name);
    const mediaType = normalizeOptionalString(record.mediaType);
    const kind = record.kind === "image" || record.kind === "text" ? record.kind : null;
    const size =
      typeof record.size === "number" && Number.isFinite(record.size)
        ? Math.max(0, Math.floor(record.size))
        : null;
    return id && name && mediaType && kind && size !== null
      ? [{ id, name, mediaType, size, kind }]
      : [];
  });
}

function normalizeSkillInputValueRecord(
  value: unknown,
): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string | number | boolean> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const normalizedValue = normalizeSkillInputValue(rawValue);
    if (normalizedValue !== undefined) {
      normalized[key] = normalizedValue;
    }
  }
  return normalized;
}

function normalizeSkillInputField(value: unknown): SkillInputField | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const field = value as Partial<Record<keyof SkillInputField, unknown>>;
  const defaultValue = normalizeSkillInputValue(field.defaultValue);
  const choices = Array.isArray(field.choices)
    ? field.choices.map(String)
    : [];

  return {
    name: String(field.name ?? ""),
    label: String(field.label ?? ""),
    type: normalizeSkillInputFieldType(field.type),
    required: Boolean(field.required),
    ...(field.description ? { description: String(field.description) } : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    ...(choices.length ? { choices } : {}),
  };
}

function normalizeSkillInputFieldType(
  type: unknown,
): SkillInputFieldType {
  if (
    type === "string" ||
    type === "number" ||
    type === "boolean" ||
    type === "path" ||
    type === "choice"
  ) {
    return type;
  }

  return "string";
}

function normalizeSkillInputValue(
  value: unknown,
): string | number | boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return String(value);
}

function normalizeStoredMessage(message: ChatMessageRecord): ChatMessageRecord {
  const role = message.role === "user" ? "user" : "assistant";
  const outputParts = normalizeOutputParts(message.outputParts);
  const attachments = normalizeChatAttachmentMetadataList(message.attachments);
  return {
    id: String(message.id ?? ""),
    ...(normalizeOptionalString(message.requestId)
      ? { requestId: normalizeOptionalString(message.requestId) }
      : {}),
    role,
    content: String(message.content ?? ""),
    ...(outputParts?.length ? { outputParts } : {}),
    ...(message.relatedMemoryIds?.length
      ? { relatedMemoryIds: message.relatedMemoryIds.map(String) }
      : {}),
    ...(message.executedRunId ? { executedRunId: String(message.executedRunId) } : {}),
    ...(message.goalId ? { goalId: String(message.goalId) } : {}),
    ...(message.goalEventRef ? { goalEventRef: String(message.goalEventRef) } : {}),
    ...(attachments.length ? { attachments } : {}),
    createdAt: String(message.createdAt ?? new Date(0).toISOString()),
  };
}

function normalizeOutputParts(
  value: unknown,
): ChatOutputPart[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value as ChatOutputPart[];
}

function normalizeGoalSummary(goal: ChatSessionGoalSummary): ChatSessionGoalSummary {
  return {
    id: String(goal.id ?? ""),
    description: String(goal.description ?? ""),
    status: goal.status,
  };
}

function normalizeChatWorkspaceSummary(
  value: unknown,
): ChatWorkspaceSummary | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const summary = value as Partial<Record<keyof ChatWorkspaceSummary, unknown>>;
  const name = normalizeOptionalString(summary.name);
  const rootPath = normalizeOptionalString(summary.rootPath);
  const kind = normalizeOptionalString(summary.kind);
  const sandboxMode = normalizeOptionalString(summary.sandboxMode);
  const branch = normalizeOptionalString(summary.branch);

  if (!name || !rootPath || !kind || !sandboxMode) {
    return undefined;
  }

  return {
    name,
    rootPath,
    kind,
    sandboxMode,
    ...(branch ? { branch } : {}),
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : undefined;
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

function normalizeSessionTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").slice(0, 80);
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
