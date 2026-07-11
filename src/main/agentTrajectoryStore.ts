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
  list(runId: string): Promise<AgentTrajectoryEvent[]>;
  flushShadowWrites(): Promise<void>;
};

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
    async list(runId) {
      return readRecoverableJsonl<AgentTrajectoryEvent>(trajectoryPath(runId));
    },
    async flushShadowWrites() {
      return;
    },
  };

  if (backend === "json" || !repo) {
    return jsonImpl;
  }

  // --- sqlite / dual (hot path stays sync) ---
  const shadowWrites = new Set<Promise<void>>();
  function enqueueShadowWrite(promise: Promise<unknown>): void {
    let tracked: Promise<void>;
    tracked = promise
      .catch(shadowWriteError)
      .then(() => undefined)
      .finally(() => {
        shadowWrites.delete(tracked);
      });
    shadowWrites.add(tracked);
  }

  return {
    async append(runId, event, appendOptions) {
      throwIfAborted(appendOptions?.signal);
      repo.appendTrajectory(runId, event); // sync hot path
      if (backend === "dual") {
        enqueueShadowWrite(jsonImpl.append(runId, event, appendOptions));
      }
      return event;
    },
    async list(runId) {
      return repo.getTrajectory(runId);
    },
    async flushShadowWrites() {
      await Promise.all([...shadowWrites]);
    },
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error && signal.reason.name === "AbortError") {
    throw signal.reason;
  }
  throw new DOMException("Trajectory append was canceled.", "AbortError");
}
