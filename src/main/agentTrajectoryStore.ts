import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import type { StorageBackend, RunRepository, Storage } from "../shared/storageContract";
import { createRunRepository } from "./storage/repositories/runRepository";
import { readRecoverableJsonl } from "./jsonlRecovery";

export type AgentTrajectoryStore = {
  append(
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
  flushShadowWrites(): Promise<void>;
};

const trajectoryMutationQueues = new Map<string, Promise<void>>();

export interface AgentTrajectoryStoreOptions {
  configDir: string;
  /** Storage backend (default "json" — legacy behavior, zero regression). */
  backend?: StorageBackend;
  /** Storage instance required when backend is sqlite/dual. */
  storage?: Storage;
}

function shadowWriteError(error: unknown): void {
  // eslint-disable-next-line no-console
  console.warn("[storage] dual-write JSON shadow write failed:", String(error));
}

export function createAgentTrajectoryStore(
  options: AgentTrajectoryStoreOptions,
): AgentTrajectoryStore {
  const backend: StorageBackend = options.backend ?? "json";
  const trajectoriesDir = path.join(options.configDir, "agent-trajectories");

  function trajectoryPath(runId: string): string {
    return path.join(trajectoriesDir, `${runId}.jsonl`);
  }

  const repo: RunRepository | null = options.storage
    ? createRunRepository(options.storage)
    : null;

  // --- legacy JSON implementation (unchanged) ---
  const jsonImpl: AgentTrajectoryStore = {
    async append(runId, event, appendOptions) {
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
          sequence:
            Math.max(0, ...trajectory.map((candidate) => candidate.sequence)) + 1,
        };
        await jsonImpl.append(runId, stored, appendOptions);
        return { appended: true, event: stored };
      });
    },
    async list(runId) {
      return readRecoverableJsonl<AgentTrajectoryEvent>(trajectoryPath(runId));
    },
    async flushShadowWrites() {
      return;
    },
  };

  function appendJsonPublicationExact(
    runId: string,
    publicationKey: string,
    event: AgentTrajectoryEvent,
    appendOptions?: { signal?: AbortSignal },
  ): Promise<{ appended: boolean; event: AgentTrajectoryEvent }> {
    const filePath = trajectoryPath(runId);
    return serializeTrajectoryMutation(filePath, async () => {
      throwIfAborted(appendOptions?.signal);
      const existing = (
        await readRecoverableJsonl<AgentTrajectoryEvent>(filePath)
      ).find(
        (candidate) =>
          candidate.payload.publicationKey === publicationKey,
      );
      if (existing) return { appended: false, event: existing };
      await jsonImpl.append(runId, event, appendOptions);
      return { appended: true, event };
    });
  }

  if (backend === "json" || !repo) {
    return jsonImpl;
  }

  // --- sqlite / dual (hot path stays sync) ---
  const shadowWrites = new Set<Promise<void>>();
  let shadowTail: Promise<void> = Promise.resolve();
  function enqueueShadowWrite(operation: () => Promise<unknown>): void {
    let tracked: Promise<void>;
    const write = shadowTail.then(operation, operation);
    tracked = write
      .catch(shadowWriteError)
      .then(() => undefined)
      .finally(() => {
        shadowWrites.delete(tracked);
      });
    shadowWrites.add(tracked);
    shadowTail = tracked;
  }

  return {
    async append(runId, event, appendOptions) {
      throwIfAborted(appendOptions?.signal);
      repo.appendTrajectory(runId, event); // sync hot path
      if (backend === "dual") {
        enqueueShadowWrite(() => jsonImpl.append(runId, event, appendOptions));
      }
      return event;
    },
    async appendIfAbsent(runId, publicationKey, event, appendOptions) {
      throwIfAborted(appendOptions?.signal);
      const result = repo.appendTrajectoryPublication(
        runId,
        publicationKey,
        createPublicationEvent(runId, publicationKey, event),
      );
      if (backend === "dual") {
        enqueueShadowWrite(() =>
          appendJsonPublicationExact(
            runId,
            publicationKey,
            result.event,
            appendOptions,
          ),
        );
      }
      return result;
    },
    async list(runId) {
      return repo.getTrajectory(runId);
    },
    async flushShadowWrites() {
      await Promise.all([...shadowWrites]);
    },
  };
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
