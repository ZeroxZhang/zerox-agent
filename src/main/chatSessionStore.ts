import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  sanitizeSkillUserInputRequest,
  type ChatAttachmentMetadata,
  type ChatAttachmentInput,
  type ChatMessageSearchOptions,
  type ChatMessageSearchResult,
  type ChatMessageRecord,
  type ChatSessionGoalSummary,
  type ChatSessionContextSnapshot,
  type ChatSessionActivitySnapshot,
  type ChatSessionListItem,
  type ChatSessionRecord,
  type ChatSessionTranscriptPage,
  type ChatSessionTranscriptPageOptions,
  type ChatSessionTokenUsage,
  type ChatTaskStatusEvent,
  type ChatTurnSettlementStatus,
  type ChatWorkspaceSummary,
  type SkillInputField,
  type SkillInputFieldType,
  type SkillPendingInputState,
  type SkillUserInputRequest,
} from "../shared/chat";
import type { ChatOutputPart } from "../shared/chatOutput";
import {
  createConversationSourcePage,
  createConversationSourceQueryHash,
  createConversationSourceRevision,
  normalizeConversationSourcePageLimit,
  parseConversationSourceCursor,
  type ConversationChatActivityRecord,
  type ConversationSourcePage,
  type ConversationSourcePageOptions,
} from "../shared/conversationEvidence";
import {
  deriveChatSessionWork,
  getActiveGoalSummary,
  getRecoveryGoalSummary,
  isLiveGoalStatus,
} from "../shared/chatSessionWork";
import type { Storage } from "../shared/storageContract";
import {
  createChatSessionEventRepository,
  type ChatSessionMetadata,
  type ChatSessionProjection,
} from "./storage/repositories/chatSessionEventRepository";

type StoredChatSessions = {
  schemaVersion: 1;
  sessions: ChatSessionRecord[];
};

const SESSION_SUMMARY_PREVIEW_MAX_CHARS = 160;
const LEGACY_CHAT_SOURCE_MAX_BYTES = 64 * 1024 * 1024;

export type AppendChatMessageInput = {
  sessionId?: string;
  requestId?: string;
  turnId?: string;
  causalAttempt?: number;
  causalAttemptId?: string;
  role: ChatMessageRecord["role"];
  content: string;
  outputParts?: ChatOutputPart[];
  relatedMemoryIds?: string[];
  executedRunId?: string;
  goalId?: string;
  goalEventRef?: string;
  turnSettlementStatus?: ChatTurnSettlementStatus;
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
  listMetadata(): Promise<ChatSessionMetadata[]>;
  get(sessionId: string): Promise<ChatSessionRecord | null>;
  getMetadata(sessionId: string): Promise<ChatSessionMetadata | null>;
  getTranscriptPage(
    sessionId: string,
    options?: ChatSessionTranscriptPageOptions,
  ): Promise<ChatSessionTranscriptPage | null>;
  getActivityPage?(
    sessionId: string,
    options?: ConversationSourcePageOptions,
  ): Promise<ConversationSourcePage<ConversationChatActivityRecord>>;
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
  backend?: "json" | "sqlite";
  storage?: Storage;
}): ChatSessionStore {
  if (options.backend === "sqlite" && options.storage) {
    return createSqliteChatSessionStore({
      configDir: options.configDir,
      storage: options.storage,
      ...(options.createId ? { createId: options.createId } : {}),
      ...(options.now ? { now: options.now } : {}),
    });
  }
  return createJsonChatSessionStore(options);
}

function createJsonChatSessionStore(options: {
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

    async listMetadata() {
      await mutationQueue;
      const stored = await readStoredSessions();
      return stored.sessions.map(toSessionMetadata);
    },

    async get(sessionId) {
      await mutationQueue;
      const stored = await readStoredSessions();
      return stored.sessions.find((session) => session.id === sessionId) ?? null;
    },

    async getMetadata(sessionId) {
      const session = await this.get(sessionId);
      return session ? toSessionMetadata(session) : null;
    },

    async getTranscriptPage(sessionId, pageOptions) {
      const session = await this.get(sessionId);
      if (!session) return null;
      return pageJsonTranscript(session, pageOptions);
    },

    async getActivityPage(sessionId, pageOptions) {
      await mutationQueue;
      throwIfPageAborted(pageOptions?.signal);
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(
          sessionsPath,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        const sourceStat = await handle.stat();
        if (
          !sourceStat.isFile()
          || sourceStat.nlink !== 1
          || sourceStat.size > LEGACY_CHAT_SOURCE_MAX_BYTES
        ) {
          return unavailableChatActivityPage(
            sessionId,
            "legacy_json_source_unavailable",
          );
        }
        const raw = await handle.readFile({ encoding: "utf8" });
        const [afterRead, currentPath] = await Promise.all([
          handle.stat(),
          lstat(sessionsPath),
        ]);
        if (
          !afterRead.isFile()
          || afterRead.nlink !== 1
          || afterRead.dev !== sourceStat.dev
          || afterRead.ino !== sourceStat.ino
          || afterRead.size !== sourceStat.size
          || afterRead.mtimeMs !== sourceStat.mtimeMs
          || !currentPath.isFile()
          || currentPath.isSymbolicLink()
          || currentPath.nlink !== 1
          || currentPath.dev !== sourceStat.dev
          || currentPath.ino !== sourceStat.ino
          || currentPath.size !== sourceStat.size
        ) {
          return unavailableChatActivityPage(
            sessionId,
            "legacy_json_source_unavailable",
          );
        }
        const stored = JSON.parse(raw) as
          StoredChatSessions;
        throwIfPageAborted(pageOptions?.signal);
        const session = Array.isArray(stored.sessions)
          ? stored.sessions
            .map(normalizeStoredSession)
            .find((candidate) => candidate.id === sessionId)
          : undefined;
        if (!session) {
          return unavailableChatActivityPage(sessionId, "session_not_found");
        }
        return pageJsonActivity(session, pageOptions);
      } catch (error) {
        if (isAbortError(error)) throw error;
        return unavailableChatActivityPage(
          sessionId,
          "legacy_json_source_unavailable",
        );
      } finally {
        await handle?.close();
      }
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
        const turnId = normalizeOptionalString(input.turnId);
        const causalAttempt = normalizeCausalAttempt(input.causalAttempt);
        const causalAttemptId = normalizeOptionalString(input.causalAttemptId);
        const message: ChatMessageRecord = {
          id: createId(),
          ...(input.requestId ? { requestId: input.requestId } : {}),
          ...(turnId ? { turnId } : {}),
          ...(causalAttempt !== undefined ? { causalAttempt } : {}),
          ...(causalAttemptId ? { causalAttemptId } : {}),
          role: input.role,
          content,
          ...(input.outputParts?.length ? { outputParts: input.outputParts } : {}),
          ...(input.relatedMemoryIds?.length
            ? { relatedMemoryIds: input.relatedMemoryIds }
            : {}),
          ...(input.executedRunId ? { executedRunId: input.executedRunId } : {}),
          ...(input.goalId ? { goalId: input.goalId } : {}),
          ...(input.goalEventRef ? { goalEventRef: input.goalEventRef } : {}),
          ...(input.turnSettlementStatus
            ? { turnSettlementStatus: input.turnSettlementStatus }
            : {}),
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
        const normalizedEvent = normalizeChatTaskStatusEventForPersistence(event);
        const previousEvents = session.activity?.statusEvents ?? [];
        const priorSettlement = normalizedEvent.settlementId
          ? previousEvents.find(
              (candidate) => candidate.settlementId === normalizedEvent.settlementId,
            )
          : undefined;
        if (priorSettlement) {
          if (JSON.stringify(priorSettlement) !== JSON.stringify(normalizedEvent)) {
            throw new Error("Chat required settlement id conflicts with persisted activity.");
          }
          return session;
        }
        const statusEvents = [...previousEvents, normalizedEvent].slice(-80);
        const selectedSkillName =
          eventOptions?.selectedSkillName ??
          normalizedEvent.selectedSkillName ??
          session.activity?.selectedSkillName;
        return {
          ...session,
          ...(normalizedEvent.context
            ? { context: normalizedEvent.context }
            : {}),
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

function createSqliteChatSessionStore(options: {
  configDir: string;
  createId?: () => string;
  now?: () => Date;
  storage: Storage;
}): ChatSessionStore {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const repository = createChatSessionEventRepository(options.storage);
  const legacyStore = createJsonChatSessionStore({
    configDir: options.configDir,
    createId,
    now,
  });
  let mutationQueue = Promise.resolve();
  let readyPromise: Promise<void> | null = null;

  function ensureReady(): Promise<void> {
    if (repository.isBootstrapComplete()) return Promise.resolve();
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      const legacyItems = await legacyStore.list();
      const legacySessions = (
        await Promise.all(
          legacyItems.map((item) => legacyStore.get(item.id)),
        )
      ).filter((session): session is ChatSessionRecord => Boolean(session));
      if (repository.countProjections() === 0 && legacySessions.length > 0) {
        repository.importSnapshots(
          legacySessions.map((session) => ({
            eventId: `chat_import_${session.id}`,
            session,
          })),
        );
      }
      for (const legacySession of legacySessions) {
        const imported = repository.getSession(legacySession.id);
        if (!imported || !areCanonicalSessionsEqual(imported, legacySession)) {
          throw new Error(
            `Chat legacy import parity failed for session ${legacySession.id}.`,
          );
        }
      }
      repository.completeBootstrap(new Date().toISOString());
    })().catch((error) => {
      readyPromise = null;
      throw error;
    });
    return readyPromise;
  }

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    return serializeMutation(
      mutationQueue,
      (nextQueue) => {
        mutationQueue = nextQueue;
      },
      async () => {
        await ensureReady();
        return operation();
      },
    );
  }

  function commitMetadata(
    session: ChatSessionMetadata,
    type: Parameters<typeof repository.commit>[0]["type"],
    eventPayload: Record<string, unknown>,
    createdAt: string,
  ): ChatSessionRecord {
    repository.commit({
      eventId: `chat_event_${randomUUID()}`,
      sessionId: session.id,
      type,
      eventPayload,
      createdAt,
      session,
    });
    const stored = repository.getSession(session.id);
    if (!stored) {
      throw new Error(`Chat projection ${session.id} disappeared after ${type}.`);
    }
    return stored;
  }

  return {
    async flush() {
      await mutationQueue;
      await ensureReady();
    },

    async list() {
      await mutationQueue;
      await ensureReady();
      return repository
        .listProjections()
        .sort((left, right) =>
          compareSessionsForList(
            { ...left.session, messages: [] },
            { ...right.session, messages: [] },
          ),
        )
        .map(toListItemFromProjection);
    },

    async listMetadata() {
      await mutationQueue;
      await ensureReady();
      return repository
        .listProjections()
        .map((projection) => projection.session);
    },

    async get(sessionId) {
      await mutationQueue;
      await ensureReady();
      return repository.getSession(sessionId);
    },

    async getMetadata(sessionId) {
      await mutationQueue;
      await ensureReady();
      return repository.getProjection(sessionId)?.session ?? null;
    },

    async getTranscriptPage(sessionId, pageOptions) {
      await mutationQueue;
      await ensureReady();
      return repository.getTranscriptPage(sessionId, pageOptions);
    },

    async getActivityPage(sessionId, pageOptions) {
      await mutationQueue;
      await ensureReady();
      throwIfPageAborted(pageOptions?.signal);
      try {
        if (!repository.getProjection(sessionId)) {
          return unavailableChatActivityPage(sessionId, "session_not_found");
        }
        return repository.getActivityPage(sessionId, pageOptions);
      } catch (error) {
        if (isAbortError(error)) throw error;
        return unavailableChatActivityPage(sessionId, "sqlite_query_failed");
      }
    },

    async appendMessage(input) {
      return serialize(async () => {
        const existingProjection = input.sessionId
          ? repository.getProjection(input.sessionId)
          : null;
        if (existingProjection) {
          const lastMessage = repository.getLastMessage(
            existingProjection.session.id,
          );
          if (
            lastMessage &&
            isRetriedAttachmentMessage(input, lastMessage)
          ) {
            return {
              session: repository.getSession(existingProjection.session.id)!,
              message: lastMessage,
            };
          }
        }

        const content = input.content;
        const summaryContent = summarizeSessionContent(content);
        const timestamp = now().toISOString();
        const sessionId =
          existingProjection?.session.id ?? createId();
        const workspaceId =
          normalizeOptionalString(input.workspaceId) ??
          existingProjection?.session.workspaceId;
        const workspaceSummary =
          normalizeChatWorkspaceSummary(input.workspaceSummary) ??
          existingProjection?.session.workspaceSummary;
        const turnId = normalizeOptionalString(input.turnId);
        const causalAttempt = normalizeCausalAttempt(input.causalAttempt);
        const causalAttemptId = normalizeOptionalString(input.causalAttemptId);
        const message: ChatMessageRecord = {
          id: createId(),
          ...(input.requestId ? { requestId: input.requestId } : {}),
          ...(turnId ? { turnId } : {}),
          ...(causalAttempt !== undefined ? { causalAttempt } : {}),
          ...(causalAttemptId ? { causalAttemptId } : {}),
          role: input.role,
          content,
          ...(input.outputParts?.length
            ? { outputParts: input.outputParts }
            : {}),
          ...(input.relatedMemoryIds?.length
            ? { relatedMemoryIds: input.relatedMemoryIds }
            : {}),
          ...(input.executedRunId
            ? { executedRunId: input.executedRunId }
            : {}),
          ...(input.goalId ? { goalId: input.goalId } : {}),
          ...(input.goalEventRef
            ? { goalEventRef: input.goalEventRef }
            : {}),
          ...(input.turnSettlementStatus
            ? { turnSettlementStatus: input.turnSettlementStatus }
            : {}),
          ...(input.attachments?.length
            ? { attachments: input.attachments }
            : {}),
          createdAt: timestamp,
        };
        const metadata: ChatSessionMetadata = existingProjection
          ? {
              ...existingProjection.session,
              summary:
                summaryContent || existingProjection.session.summary,
              ...(workspaceId ? { workspaceId } : {}),
              ...(workspaceSummary ? { workspaceSummary } : {}),
              updatedAt: timestamp,
            }
          : toSessionMetadata(
              createSession({
                sessionId,
                content: summaryContent,
                message,
                timestamp,
                ...(workspaceId ? { workspaceId } : {}),
                ...(workspaceSummary ? { workspaceSummary } : {}),
              }),
            );
        repository.commit({
          eventId: `chat_event_${randomUUID()}`,
          sessionId,
          type: "message_appended",
          eventPayload: {
            messageId: message.id,
            role: message.role,
            ...(message.requestId ? { requestId: message.requestId } : {}),
            sessionPatch: {
              summary: metadata.summary,
              ...(metadata.workspaceId
                ? { workspaceId: metadata.workspaceId }
                : {}),
              ...(metadata.workspaceSummary
                ? { workspaceSummary: metadata.workspaceSummary }
                : {}),
              updatedAt: metadata.updatedAt,
            },
          },
          createdAt: timestamp,
          session: metadata,
          message,
        });
        return {
          session: repository.getSession(sessionId)!,
          message,
        };
      });
    },

    async rename(sessionId, title) {
      const normalizedTitle = normalizeSessionTitle(title);
      if (!normalizedTitle) {
        throw new Error("Session title is required.");
      }
      return serialize(async () => {
        const projection = repository.getProjection(sessionId);
        if (!projection) return null;
        return commitMetadata(
          { ...projection.session, title: normalizedTitle },
          "session_renamed",
          { title: normalizedTitle },
          projection.session.updatedAt,
        );
      });
    },

    async archive(sessionId) {
      return serialize(async () => {
        const projection = repository.getProjection(sessionId);
        if (!projection) return null;
        const archivedAt = now().toISOString();
        return commitMetadata(
          { ...projection.session, archivedAt },
          "session_archived",
          { archivedAt },
          archivedAt,
        );
      });
    },

    async restore(sessionId) {
      return serialize(async () => {
        const projection = repository.getProjection(sessionId);
        if (!projection) return null;
        const { archivedAt, ...rest } = projection.session;
        return commitMetadata(
          rest,
          "session_restored",
          archivedAt ? { previousArchivedAt: archivedAt } : {},
          projection.session.updatedAt,
        );
      });
    },

    async delete(sessionId) {
      return serialize(async () => {
        const projection = repository.getProjection(sessionId);
        if (!projection) return false;
        repository.commit({
          eventId: `chat_event_${randomUUID()}`,
          sessionId,
          type: "session_deleted",
          eventPayload: {
            title: projection.session.title,
            messageCount: projection.messageCount,
          },
          createdAt: projection.session.updatedAt,
          deleteSession: true,
        });
        return true;
      });
    },

    async addTokenUsage(sessionId, usage) {
      return serialize(async () => {
        const projection = repository.getProjection(sessionId);
        if (!projection) return null;
        const normalizedUsage = normalizeTokenUsage(usage);
        return commitMetadata(
          {
            ...projection.session,
            tokenUsage: mergeTokenUsage(
              projection.session.tokenUsage,
              normalizedUsage,
            ),
          },
          "token_usage_added",
          normalizedUsage,
          projection.session.updatedAt,
        );
      });
    },

    async appendActivityEvent(sessionId, event, eventOptions) {
      return serialize(async () => {
        const projection = repository.getProjection(sessionId);
        if (!projection) return null;
        const normalizedEvent = normalizeChatTaskStatusEventForPersistence(event);
        const previousEvents =
          projection.session.activity?.statusEvents ?? [];
        const priorSettlement = normalizedEvent.settlementId
          ? previousEvents.find(
              (candidate) => candidate.settlementId === normalizedEvent.settlementId,
            )
          : undefined;
        if (priorSettlement) {
          if (JSON.stringify(priorSettlement) !== JSON.stringify(normalizedEvent)) {
            throw new Error("Chat required settlement id conflicts with persisted activity.");
          }
          return repository.getSession(sessionId);
        }
        const statusEvents = [...previousEvents, normalizedEvent].slice(-80);
        const selectedSkillName =
          eventOptions?.selectedSkillName ??
          normalizedEvent.selectedSkillName ??
          projection.session.activity?.selectedSkillName;
        const session: ChatSessionMetadata = {
          ...projection.session,
          ...(normalizedEvent.context
            ? { context: normalizedEvent.context }
            : {}),
          activity: {
            updatedAt: normalizedEvent.createdAt,
            statusEvents,
            ...(selectedSkillName ? { selectedSkillName } : {}),
          },
          updatedAt: normalizedEvent.createdAt,
        };
        return commitMetadata(
          session,
          "activity_appended",
          {
            event: normalizedEvent,
            ...(selectedSkillName ? { selectedSkillName } : {}),
          },
          normalizedEvent.createdAt,
        );
      });
    },

    async attachGoal(sessionId, goal) {
      return serialize(async () => {
        const projection = repository.getProjection(sessionId);
        if (!projection) {
          throw new Error(`Chat session "${sessionId}" was not found.`);
        }
        const timestamp = now().toISOString();
        const nextSession = attachGoalToSession(
          { ...projection.session, messages: [] },
          goal,
          timestamp,
        );
        return commitMetadata(
          toSessionMetadata(nextSession),
          "goal_attached",
          { goal },
          timestamp,
        );
      });
    },

    async clearActiveGoal(sessionId, goalId) {
      return serialize(async () => {
        const projection = repository.getProjection(sessionId);
        if (!projection) return null;
        if (projection.session.activeGoalId !== goalId) {
          return repository.getSession(sessionId);
        }
        const {
          activeGoalId: _activeGoalId,
          ...sessionWithoutActiveGoal
        } = projection.session;
        const updatedAt = now().toISOString();
        return commitMetadata(
          { ...sessionWithoutActiveGoal, updatedAt },
          "active_goal_cleared",
          { goalId },
          updatedAt,
        );
      });
    },

    async searchMessages(searchOptions) {
      await mutationQueue;
      await ensureReady();
      return repository.searchMessages(searchOptions);
    },
  };
}

function toSessionMetadata(
  session: ChatSessionRecord,
): ChatSessionMetadata {
  const { messages: _messages, ...metadata } = session;
  return metadata;
}

function pageJsonTranscript(
  session: ChatSessionRecord,
  options?: ChatSessionTranscriptPageOptions,
): ChatSessionTranscriptPage {
  const totalMessages = session.messages.length;
  const limit = Math.max(
    1,
    Math.min(200, Math.floor(Number(options?.limit ?? 80)) || 80),
  );
  const beforeSequence = Math.max(
    1,
    Math.min(
      totalMessages + 1,
      Math.floor(Number(options?.beforeSequence ?? totalMessages + 1)) ||
        totalMessages + 1,
    ),
  );
  const endIndex = beforeSequence - 1;
  const startIndex = Math.max(0, endIndex - limit);
  return {
    session: {
      ...session,
      messages: session.messages.slice(startIndex, endIndex),
    },
    page: {
      startSequence: startIndex + 1,
      endSequence: endIndex,
      totalMessages,
      hasMoreBefore: startIndex > 0,
    },
  };
}

function pageJsonActivity(
  session: ChatSessionRecord,
  options?: ConversationSourcePageOptions,
): ConversationSourcePage<ConversationChatActivityRecord> {
  const sourceId = session.id;
  const queryHash = createConversationSourceQueryHash({
    source: "chat_activity",
    sourceId,
    filters: { source: "legacy_tail" },
  });
  const events = session.activity?.statusEvents ?? [];
  const sourceRevision = createConversationSourceRevision({
    source: "chat_activity",
    sourceId,
    authority: {
      source: "legacy_json_tail",
      updatedAt: session.activity?.updatedAt ?? session.updatedAt,
      events,
    },
  });
  const cursor = parseConversationSourceCursor(options?.cursor, {
    source: "chat_activity",
    sourceId,
    queryHash,
  });
  if (
    cursor.kind === "incompatible"
    || (
      cursor.kind === "position"
      && (
        cursor.sourceRevision !== sourceRevision
        || cursor.position > events.length
      )
    )
  ) {
    return createConversationSourcePage({
      source: "chat_activity",
      sourceId,
      queryHash,
      sourceRevision,
      status: "incompatible",
      reasonCode: "source_cursor_mismatch",
      records: [],
    });
  }
  const limit = normalizeConversationSourcePageLimit(options?.limit);
  const start = cursor.position;
  const selected = events.slice(start, start + limit);
  const records = selected.map((event, index) => ({
    eventId: `legacy:${createConversationSourceRevision({
      source: "chat_activity",
      sourceId,
      authority: {
        index: start + index,
        requestId: event.requestId ?? null,
        sequence: event.sequence ?? null,
        state: event.state,
        createdAt: event.createdAt,
        message: event.message,
      },
    })}`,
    sequence: event.sequence ?? start + index + 1,
    event,
    legacy: true,
  }));
  const nextPosition = start + selected.length;
  return createConversationSourcePage({
    source: "chat_activity",
    sourceId,
    queryHash,
    sourceRevision,
    status: "partial",
    reasonCode: "legacy_chat_activity_tail",
    records,
    ...(nextPosition < events.length ? { nextPosition } : {}),
  });
}

function unavailableChatActivityPage(
  sessionId: string,
  reasonCode: string,
): ConversationSourcePage<ConversationChatActivityRecord> {
  return createConversationSourcePage({
    source: "chat_activity",
    sourceId: sessionId,
    queryHash: createConversationSourceQueryHash({
      source: "chat_activity",
      sourceId: sessionId,
      filters: null,
    }),
    sourceRevision: "unavailable",
    status: "unavailable",
    reasonCode,
    records: [],
  });
}

function throwIfPageAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("Chat activity page query was canceled.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function toListItemFromProjection(
  projection: ChatSessionProjection,
): ChatSessionListItem {
  return {
    ...toListItem({ ...projection.session, messages: [] }),
    messageCount: projection.messageCount,
    ...(projection.lastAssistantMessageAt
      ? { lastAssistantMessageAt: projection.lastAssistantMessageAt }
      : {}),
  };
}

function isRetriedAttachmentMessage(
  input: AppendChatMessageInput,
  lastMessage: ChatMessageRecord,
): boolean {
  return Boolean(
    input.role === "user" &&
      input.attachments?.length &&
      lastMessage.role === "user" &&
      lastMessage.content === input.content &&
      areAttachmentMetadataListsEqual(
        lastMessage.attachments,
        input.attachments,
      ),
  );
}

function areCanonicalSessionsEqual(
  left: ChatSessionRecord,
  right: ChatSessionRecord,
): boolean {
  return isDeepStrictEqual(left, right);
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
  const activeGoal = getActiveGoalSummary(session);
  const recoveryGoal = getRecoveryGoalSummary(session);
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
    ...(recoveryGoal ? { recoveryGoal } : {}),
    work: deriveChatSessionWork(session),
    ...(session.archivedAt ? { archivedAt: session.archivedAt } : {}),
    lastAssistantMessageAt: getLastAssistantMessageAt(session),
    ...(session.tokenUsage ? { tokenUsage: session.tokenUsage } : {}),
    ...(session.context ? { context: session.context } : {}),
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
  const requestedActiveGoalId = session.activeGoalId
    ? String(session.activeGoalId)
    : undefined;
  const goalIds = Array.isArray(session.goalIds)
    ? uniqueStrings(session.goalIds)
    : [];
  const goalSummaries = Array.isArray(session.goalSummaries)
    ? session.goalSummaries.map(normalizeGoalSummary)
    : [];
  const activeGoalId = goalSummaries.some(
    (summary) =>
      summary.id === requestedActiveGoalId && isLiveGoalStatus(summary.status),
  )
    ? requestedActiveGoalId
    : undefined;
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
    ...(normalizeContextSnapshot(session.context)
      ? { context: normalizeContextSnapshot(session.context) }
      : {}),
    ...(session.archivedAt ? { archivedAt: String(session.archivedAt) } : {}),
    ...(session.tokenUsage
      ? { tokenUsage: normalizeTokenUsage(session.tokenUsage) }
      : {}),
    createdAt: String(session.createdAt ?? new Date(0).toISOString()),
    updatedAt: String(session.updatedAt ?? session.createdAt ?? new Date(0).toISOString()),
  };
}

export function normalizeChatSessionRecord(
  session: ChatSessionRecord,
): ChatSessionRecord {
  return normalizeStoredSession(session);
}

function normalizeActivitySnapshot(
  snapshot: ChatSessionActivitySnapshot,
): ChatSessionActivitySnapshot {
  const statusEvents = Array.isArray(snapshot.statusEvents)
    ? snapshot.statusEvents
        .map(normalizeChatTaskStatusEventForPersistence)
        .filter(Boolean)
    : [];
  return {
    updatedAt: String(snapshot.updatedAt ?? new Date(0).toISOString()),
    statusEvents,
    ...(snapshot.selectedSkillName
      ? { selectedSkillName: String(snapshot.selectedSkillName) }
      : {}),
  };
}

export function normalizeChatTaskStatusEventForPersistence(
  event: ChatTaskStatusEvent,
): ChatTaskStatusEvent {
  const state = normalizeStatusEventState(event.state);
  const inputRequest = normalizeSkillUserInputRequest(event.inputRequest);
  const pendingSkillInput = normalizeSkillPendingInputState(
    event.pendingSkillInput,
  );
  return {
    sessionId: String(event.sessionId ?? ""),
    ...(normalizeOptionalString(event.settlementId)
      ? { settlementId: normalizeOptionalString(event.settlementId) }
      : {}),
    ...(typeof event.domainStateAvailable === "boolean"
      ? { domainStateAvailable: event.domainStateAvailable }
      : {}),
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
    ...(event.approvalId ? { approvalId: String(event.approvalId) } : {}),
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
    ...(normalizeContextSnapshot(event.context)
      ? { context: normalizeContextSnapshot(event.context) }
      : {}),
  };
}

function normalizeContextSnapshot(
  value: unknown,
): ChatSessionContextSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const snapshot = value as Partial<ChatSessionContextSnapshot>;
  if (snapshot.isolation !== "session_plus_global_memory") {
    return undefined;
  }
  const lastCompaction = snapshot.lastCompaction;
  const normalizedCompaction =
    lastCompaction &&
    (lastCompaction.strategy === "summarize" ||
      lastCompaction.strategy === "rebuild" ||
      lastCompaction.strategy === "summarize-degraded")
      ? {
          strategy: lastCompaction.strategy,
          beforeMessages: normalizeCount(lastCompaction.beforeMessages),
          afterMessages: normalizeCount(lastCompaction.afterMessages),
          beforeTokens: normalizeCount(lastCompaction.beforeTokens),
          afterTokens: normalizeCount(lastCompaction.afterTokens),
          compactedAt: String(lastCompaction.compactedAt ?? new Date(0).toISOString()),
        }
      : undefined;
  const tokenBudget = Math.max(1, normalizeCount(snapshot.tokenBudget));
  const estimatedTokens = normalizeCount(snapshot.estimatedTokens);
  const contextWindow = normalizeOptionalPositiveCount(snapshot.contextWindow);
  return {
    isolation: "session_plus_global_memory",
    estimatedTokens,
    tokenBudget,
    occupancyRatio: Math.min(1, estimatedTokens / tokenBudget),
    messageCount: normalizeCount(snapshot.messageCount),
    compactionCount: normalizeCount(snapshot.compactionCount),
    ...(contextWindow ? { contextWindow } : {}),
    ...(normalizedCompaction ? { lastCompaction: normalizedCompaction } : {}),
    sessionMessageCount: normalizeCount(snapshot.sessionMessageCount),
    historyMessageCount: normalizeCount(snapshot.historyMessageCount),
    recalledSessionMemories: normalizeCount(snapshot.recalledSessionMemories),
    recalledGlobalMemories: normalizeCount(snapshot.recalledGlobalMemories),
    updatedAt: String(snapshot.updatedAt ?? new Date(0).toISOString()),
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
    state === "context" ||
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

  return sanitizeSkillUserInputRequest({
    id: String(request.id ?? ""),
    executionId: String(request.executionId ?? ""),
    sessionId: String(request.sessionId ?? ""),
    requestId: String(request.requestId ?? ""),
    skillName: String(request.skillName ?? ""),
    reason: String(request.reason ?? ""),
    fields,
    createdAt: String(request.createdAt ?? new Date(0).toISOString()),
  });
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
  const inputRequest = normalizeSkillUserInputRequest(
    pending.inputRequest,
  );
  const attachments = normalizeChatAttachmentMetadataList(pending.attachments);
  const attachmentPayloads = normalizeChatAttachmentInputList(
    pending.attachmentPayloads,
  );
  if (!inputRequestId || !sessionId || !requestId || !userMessage || !selectedSkillName) {
    return undefined;
  }

  return {
    inputRequestId,
    status:
      pending.status === "processing"
      || pending.status === "completed"
      || pending.status === "failed"
      || pending.status === "canceled"
      || pending.status === "superseded"
        ? pending.status
        : "pending",
    ...(normalizeOptionalString(pending.settlementId)
      ? { settlementId: normalizeOptionalString(pending.settlementId) }
      : {}),
    ...(inputRequest ? { inputRequest } : {}),
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
    ...(normalizeOptionalString(message.turnId)
      ? { turnId: normalizeOptionalString(message.turnId) }
      : {}),
    ...(normalizeCausalAttempt(message.causalAttempt) !== undefined
      ? { causalAttempt: normalizeCausalAttempt(message.causalAttempt) }
      : {}),
    ...(normalizeOptionalString(message.causalAttemptId)
      ? { causalAttemptId: normalizeOptionalString(message.causalAttemptId) }
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
    ...(isChatTurnSettlementStatus(message.turnSettlementStatus)
      ? { turnSettlementStatus: message.turnSettlementStatus }
      : {}),
    ...(attachments.length ? { attachments } : {}),
    createdAt: String(message.createdAt ?? new Date(0).toISOString()),
  };
}

function isChatTurnSettlementStatus(
  value: unknown,
): value is ChatTurnSettlementStatus {
  return (
    value === "succeeded"
    || value === "paused"
    || value === "failed"
    || value === "canceled"
  );
}

function normalizeCausalAttempt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : undefined;
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
    ...(goal.updatedAt ? { updatedAt: String(goal.updatedAt) } : {}),
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

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function normalizeOptionalPositiveCount(value: unknown): number | undefined {
  const normalized = normalizeCount(value);
  return normalized > 0 ? normalized : undefined;
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
  const breakdown = usage.breakdown
    ? {
        chatTokens: normalizeCount(usage.breakdown.chatTokens),
        planTokens: normalizeCount(usage.breakdown.planTokens),
        goalTokens: normalizeCount(usage.breakdown.goalTokens),
      }
    : undefined;

  return {
    totalTokens,
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    estimated: Boolean(usage.estimated),
    ...(breakdown ? { breakdown } : {}),
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
    ...(isLiveGoalStatus(normalizedGoal.status)
      ? { activeGoalId: normalizedGoal.id }
      : session.activeGoalId === normalizedGoal.id
        ? { activeGoalId: undefined }
        : {}),
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
