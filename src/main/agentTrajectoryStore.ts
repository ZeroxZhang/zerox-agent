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
  ): Promise<AgentTrajectoryEvent>;
  list(runId: string): Promise<AgentTrajectoryEvent[]>;
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
    async append(runId, event) {
      await mkdir(trajectoriesDir, { recursive: true });
      await writeFile(trajectoryPath(runId), `${JSON.stringify(event)}\n`, {
        encoding: "utf8",
        flag: "a",
      });
      return event;
    },
    async list(runId) {
      return readRecoverableJsonl<AgentTrajectoryEvent>(trajectoryPath(runId));
    },
  };

  if (backend === "json" || !repo) {
    return jsonImpl;
  }

  // --- sqlite / dual (hot path stays sync) ---
  return {
    async append(runId, event) {
      repo.appendTrajectory(runId, event); // sync hot path
      if (backend === "dual") void jsonImpl.append(runId, event).catch(shadowWriteError);
      return event;
    },
    async list(runId) {
      return repo.getTrajectory(runId);
    },
  };
}
