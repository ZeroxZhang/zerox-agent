import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import {
  createConversationSourcePage,
  createConversationSourceQueryHash,
  parseConversationSourceCursor,
  normalizeConversationSourcePageLimit,
  type ConversationSourcePage,
  type ConversationSourcePageOptions,
} from "../shared/conversationEvidence";
import type { StorageBackend, RunRepository, Storage } from "../shared/storageContract";
import { createRunRepository } from "./storage/repositories/runRepository";
import {
  readRecoverableJsonl,
  readRecoverableJsonlPage,
} from "./jsonlRecovery";
import { highestAgentTrajectorySequence } from "./agentTrajectorySequence";
import {
  createFailureVisibleSerialQueue,
  type PersistenceQueueDrainOptions,
} from "./failureVisibleSerialQueue";
import { assertSafeStoreEntityId } from "./storeEntityId";

export type AgentTrajectoryStore = {
  append(
    runId: string,
    event: AgentTrajectoryEvent,
    options?: { signal?: AbortSignal },
  ): Promise<AgentTrajectoryEvent>;
  appendNext?(
    runId: string,
    event: AgentTrajectoryEvent,
    options?: { signal?: AbortSignal },
  ): Promise<AgentTrajectoryEvent>;
  appendIfAbsent(
    runId: string,
    publicationKey: string,
    event: AgentTrajectoryEvent,
    options?: { signal?: AbortSignal },
  ): Promise<{ appended: boolean; event: AgentTrajectoryEvent }>;
  list(runId: string): Promise<AgentTrajectoryEvent[]>;
  getPage?(
    runId: string,
    options?: ConversationSourcePageOptions,
  ): Promise<ConversationSourcePage<AgentTrajectoryEvent>>;
  flushShadowWrites(options?: PersistenceQueueDrainOptions): Promise<void>;
};

const trajectoryMutationQueues = new Map<string, Promise<void>>();

export interface AgentTrajectoryStoreOptions {
  configDir: string;
  /** Storage backend (default "json" — legacy behavior, zero regression). */
  backend?: StorageBackend;
  /** Storage instance required when backend is sqlite/dual. */
  storage?: Storage;
}

export function createAgentTrajectoryStore(
  options: AgentTrajectoryStoreOptions,
): AgentTrajectoryStore {
  const backend: StorageBackend = options.backend ?? "json";
  const trajectoriesDir = path.join(options.configDir, "agent-trajectories");

  function trajectoryPath(runId: string): string {
    assertSafeStoreEntityId(runId, "Agent trajectory run id");
    return path.join(trajectoriesDir, `${runId}.jsonl`);
  }

  const repo: RunRepository | null = options.storage
    ? createRunRepository(options.storage)
    : null;

  // --- legacy JSON implementation (unchanged) ---
  const jsonImpl: AgentTrajectoryStore = {
    async append(runId, event, appendOptions) {
      assertTrajectoryEventOwner(runId, event);
      throwIfAborted(appendOptions?.signal);
      await mkdir(trajectoriesDir, { recursive: true });
      throwIfAborted(appendOptions?.signal);
      await writeFile(trajectoryPath(runId), `${JSON.stringify(event)}\n`, {
        encoding: "utf8",
        flag: "a",
        signal: appendOptions?.signal,
      });
      throwIfAborted(appendOptions?.signal);
      return event;
    },
    async appendNext(runId, event, appendOptions) {
      const filePath = trajectoryPath(runId);
      return serializeTrajectoryMutation(filePath, async () => {
        throwIfAborted(appendOptions?.signal);
        const trajectory =
          await readRecoverableJsonl<AgentTrajectoryEvent>(filePath);
        const stored = {
          ...event,
          runId,
          sequence: highestAgentTrajectorySequence(trajectory) + 1,
        };
        await jsonImpl.append(runId, stored, appendOptions);
        return stored;
      });
    },
    async appendIfAbsent(runId, publicationKey, event, appendOptions) {
      const filePath = trajectoryPath(runId);
      return serializeTrajectoryMutation(filePath, async () => {
        throwIfAborted(appendOptions?.signal);
        const trajectory =
          await readRecoverableJsonl<AgentTrajectoryEvent>(filePath);
        const existing = trajectory.find(
          (candidate) =>
            candidate.payload.publicationKey === publicationKey,
        );
        if (existing) return { appended: false, event: existing };
        const stored = {
          ...createPublicationEvent(runId, publicationKey, event),
          sequence: highestAgentTrajectorySequence(trajectory) + 1,
        };
        await jsonImpl.append(runId, stored, appendOptions);
        return { appended: true, event: stored };
      });
    },
    async list(runId) {
      return readRecoverableJsonl<AgentTrajectoryEvent>(trajectoryPath(runId));
    },
    async getPage(runId, pageOptions) {
      return readJsonTrajectoryPage(trajectoryPath(runId), runId, pageOptions);
    },
    async flushShadowWrites() {
      return;
    },
  };

  function appendJsonPublicationExact(
    runId: string,
    publicationKey: string,
    event: AgentTrajectoryEvent,
  ): Promise<{ appended: boolean; event: AgentTrajectoryEvent }> {
    const filePath = trajectoryPath(runId);
    return serializeTrajectoryMutation(filePath, async () => {
      const existing = (
        await readRecoverableJsonl<AgentTrajectoryEvent>(filePath)
      ).find(
        (candidate) =>
          candidate.payload.publicationKey === publicationKey,
      );
      if (existing) return { appended: false, event: existing };
      await jsonImpl.append(runId, event);
      return { appended: true, event };
    });
  }

  function appendJsonEventExact(
    runId: string,
    event: AgentTrajectoryEvent,
  ): Promise<AgentTrajectoryEvent> {
    const filePath = trajectoryPath(runId);
    return serializeTrajectoryMutation(filePath, async () => {
      const existing = (
        await readRecoverableJsonl<AgentTrajectoryEvent>(filePath)
      ).find((candidate) => candidate.id === event.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(event)) {
          throw new Error(
            `Trajectory event id collision for run ${runId}: ${event.id}.`,
          );
        }
        return existing;
      }
      await jsonImpl.append(runId, event);
      return event;
    });
  }

  if (backend === "json" || !repo) {
    return jsonImpl;
  }

  // --- sqlite / dual (hot path stays sync) ---
  const shadowQueue = createFailureVisibleSerialQueue();

  return {
    async append(runId, event, appendOptions) {
      assertSafeStoreEntityId(runId, "Agent trajectory run id");
      assertTrajectoryEventOwner(runId, event);
      throwIfAborted(appendOptions?.signal);
      shadowQueue.assertOpen();
      repo.appendTrajectory(runId, event); // sync hot path
      if (backend === "dual") {
        void shadowQueue.enqueue(() => appendJsonEventExact(runId, event));
      }
      return event;
    },
    async appendNext(runId, event, appendOptions) {
      assertSafeStoreEntityId(runId, "Agent trajectory run id");
      assertTrajectoryEventOwner(runId, event);
      throwIfAborted(appendOptions?.signal);
      shadowQueue.assertOpen();
      const stored = repo.appendTrajectoryNext(runId, event);
      if (backend === "dual") {
        void shadowQueue.enqueue(() => appendJsonEventExact(runId, stored));
      }
      return stored;
    },
    async appendIfAbsent(runId, publicationKey, event, appendOptions) {
      assertSafeStoreEntityId(runId, "Agent trajectory run id");
      throwIfAborted(appendOptions?.signal);
      shadowQueue.assertOpen();
      const result = repo.appendTrajectoryPublication(
        runId,
        publicationKey,
        createPublicationEvent(runId, publicationKey, event),
      );
      if (backend === "dual") {
        void shadowQueue.enqueue(() =>
          appendJsonPublicationExact(
            runId,
            publicationKey,
            result.event,
          ),
        );
      }
      return result;
    },
    async list(runId) {
      assertSafeStoreEntityId(runId, "Agent trajectory run id");
      return repo.getTrajectory(runId);
    },
    async getPage(runId, pageOptions) {
      assertSafeStoreEntityId(runId, "Agent trajectory run id");
      try {
        return repo.getTrajectoryPage(runId, pageOptions);
      } catch (error) {
        if (isAbortError(error)) throw error;
        return unavailableTrajectoryPage(runId, "sqlite_query_failed");
      }
    },
    async flushShadowWrites(flushOptions) {
      await shadowQueue.drain(flushOptions);
    },
  };
}

async function readJsonTrajectoryPage(
  filePath: string,
  runId: string,
  options?: ConversationSourcePageOptions,
): Promise<ConversationSourcePage<AgentTrajectoryEvent>> {
  const queryHash = createConversationSourceQueryHash({
    source: "trajectory",
    sourceId: runId,
    filters: null,
  });
  const cursor = parseConversationSourceCursor(options?.cursor, {
    source: "trajectory",
    sourceId: runId,
    queryHash,
  });
  if (cursor.kind === "incompatible") {
    return createConversationSourcePage({
      source: "trajectory",
      sourceId: runId,
      queryHash,
      sourceRevision: "jsonl:unknown",
      status: "incompatible",
      reasonCode: cursor.reasonCode,
      records: [],
    });
  }
  const pinned = cursor.kind === "position"
    ? parseJsonlRevision(cursor.sourceRevision)
    : undefined;
  if (cursor.kind === "position" && !pinned) {
    return createConversationSourcePage({
      source: "trajectory",
      sourceId: runId,
      queryHash,
      sourceRevision: "jsonl:unknown",
      status: "incompatible",
      reasonCode: "source_cursor_mismatch",
      records: [],
    });
  }
  try {
    const page = await readRecoverableJsonlPage<AgentTrajectoryEvent>(
      filePath,
      {
        offset: cursor.position,
        limit: normalizeConversationSourcePageLimit(options?.limit),
        ...(pinned
          ? {
              endOffset: pinned.endOffset,
              expectedIdentity: {
                dev: pinned.dev,
                ino: pinned.ino,
              },
            }
          : {}),
        signal: options?.signal,
      },
    );
    if (
      cursor.kind === "position"
      && page.sourceRevision !== cursor.sourceRevision
    ) {
      return createConversationSourcePage({
        source: "trajectory",
        sourceId: runId,
        queryHash,
        sourceRevision: page.sourceRevision,
        status: "incompatible",
        reasonCode: "source_cursor_mismatch",
        records: [],
      });
    }
    return createConversationSourcePage({
      source: "trajectory",
      sourceId: runId,
      queryHash,
      sourceRevision: page.sourceRevision,
      status: page.status,
      ...(page.reasonCode ? { reasonCode: page.reasonCode } : {}),
      records: page.records,
      ...(page.nextOffset !== undefined
        ? { nextPosition: page.nextOffset }
        : {}),
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    return unavailableTrajectoryPage(runId, "jsonl_read_failed");
  }
}

function unavailableTrajectoryPage(
  runId: string,
  reasonCode: string,
): ConversationSourcePage<AgentTrajectoryEvent> {
  return createConversationSourcePage({
    source: "trajectory",
    sourceId: runId,
    queryHash: createConversationSourceQueryHash({
      source: "trajectory",
      sourceId: runId,
      filters: null,
    }),
    sourceRevision: "unavailable",
    status: "unavailable",
    reasonCode,
    records: [],
  });
}

function parseJsonlRevision(value: string) {
  const match = /^jsonl:(\d+):(\d+):(\d+):\d+:\d+$/.exec(value);
  return match
    ? {
        dev: match[1]!,
        ino: match[2]!,
        endOffset: Number(match[3]),
      }
    : null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function assertTrajectoryEventOwner(
  runId: string,
  event: AgentTrajectoryEvent,
): void {
  if (event.runId !== runId) {
    throw new Error("Agent trajectory event does not belong to the target run.");
  }
}

function createPublicationEvent(
  runId: string,
  publicationKey: string,
  event: AgentTrajectoryEvent,
): AgentTrajectoryEvent {
  return {
    ...event,
    id: `publication_${createHash("sha256")
      .update(`${runId}\0${publicationKey}`)
      .digest("hex")}`,
    runId,
    payload: { ...event.payload, publicationKey },
  };
}

function serializeTrajectoryMutation<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const current = trajectoryMutationQueues.get(key) ?? Promise.resolve();
  const result = current.then(operation, operation);
  const next = result.then(
    () => undefined,
    () => undefined,
  );
  trajectoryMutationQueues.set(key, next);
  void next.finally(() => {
    if (trajectoryMutationQueues.get(key) === next) {
      trajectoryMutationQueues.delete(key);
    }
  });
  return result;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error && signal.reason.name === "AbortError") {
    throw signal.reason;
  }
  throw new DOMException("Trajectory append was canceled.", "AbortError");
}
