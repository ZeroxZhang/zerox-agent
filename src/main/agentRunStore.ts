import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { StorageBackend, RunRepository, Storage } from "../shared/storageContract";
import { createRunRepository } from "./storage/repositories/runRepository";
import { readRecoverableJsonl } from "./jsonlRecovery";
import {
  createFailureVisibleSerialQueue,
  type PersistenceQueueDrainOptions,
} from "./failureVisibleSerialQueue";

export type AgentRunStore = {
  append(run: AgentRunRecord): Promise<AgentRunRecord>;
  get(runId: string): Promise<AgentRunRecord | null>;
  list(options?: { limit?: number; taskId?: string }): Promise<AgentRunRecord[]>;
  flushShadowWrites(options?: PersistenceQueueDrainOptions): Promise<void>;
};

export interface AgentRunStoreOptions {
  configDir: string;
  /** Storage backend (default "json" — legacy behavior, zero regression). */
  backend?: StorageBackend;
  /** Storage instance required when backend is sqlite/dual. */
  storage?: Storage;
}

export function createAgentRunStore(options: AgentRunStoreOptions): AgentRunStore {
  const backend: StorageBackend = options.backend ?? "json";
  const runsPath = path.join(options.configDir, "agent-runs.jsonl");
  const repo: RunRepository | null = options.storage
    ? createRunRepository(options.storage)
    : null;

  // --- legacy JSON implementation (unchanged) ---
  const jsonImpl = {
    async append(run: AgentRunRecord): Promise<AgentRunRecord> {
      await mkdir(options.configDir, { recursive: true });
      await writeFile(runsPath, `${JSON.stringify(run)}\n`, {
        encoding: "utf8",
        flag: "a",
      });
      return run;
    },
    async list(listOptions?: { limit?: number; taskId?: string }): Promise<AgentRunRecord[]> {
      const limit = listOptions?.limit ?? 50;
      return (await readRecoverableJsonl<AgentRunRecord>(runsPath))
        .filter((run) => (listOptions?.taskId ? run.taskId === listOptions.taskId : true))
        .reverse()
        .slice(0, limit);
    },
    async get(runId: string): Promise<AgentRunRecord | null> {
      const runs = await jsonImpl.list({ limit: Number.MAX_SAFE_INTEGER });
      return runs.find((run) => run.id === runId) ?? null;
    },
    async flushShadowWrites(): Promise<void> {
      return;
    },
  };

  if (backend === "json" || !repo) {
    return jsonImpl;
  }

  // --- sqlite / dual ---
  const shadowQueue = createFailureVisibleSerialQueue();

  return {
    async append(run) {
      shadowQueue.assertOpen();
      repo.create(run); // sync, hot path
      if (backend === "dual") {
        void shadowQueue.enqueue(() => jsonImpl.append(run));
      }
      return run;
    },
    async get(runId) {
      return repo.get(runId);
    },
    async list(listOptions) {
      const limit = listOptions?.limit ?? 50;
      return repo.list({ limit, taskId: listOptions?.taskId });
    },
    async flushShadowWrites(flushOptions) {
      await shadowQueue.drain(flushOptions);
    },
  };
}
