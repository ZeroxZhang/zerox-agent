import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentBootstrapValidationSnapshot } from "../shared/agentBootstrap";
import type { StorageBackend, Storage, ValidationRepository } from "../shared/storageContract";
import { createValidationRepository } from "./storage/repositories/index";
import {
  createFailureVisibleSerialQueue,
  type PersistenceQueueDrainOptions,
} from "./failureVisibleSerialQueue";

type StoredAgentValidation = {
  schemaVersion: 1;
  latest: AgentBootstrapValidationSnapshot | null;
};

export type AgentValidationStore = {
  load(): Promise<AgentBootstrapValidationSnapshot | null>;
  save(
    snapshot: AgentBootstrapValidationSnapshot,
  ): Promise<AgentBootstrapValidationSnapshot>;
  flushShadowWrites(options?: PersistenceQueueDrainOptions): Promise<void>;
};

export interface AgentValidationStoreOptions {
  configDir: string;
  /** Storage backend (default "json" — legacy behavior, zero regression). */
  backend?: StorageBackend;
  /** Storage instance required when backend is sqlite/dual. */
  storage?: Storage;
}

export function createAgentValidationStore(options: AgentValidationStoreOptions): AgentValidationStore {
  const backend: StorageBackend = options.backend ?? "json";
  const validationPath = path.join(options.configDir, "agent-validation.json");

  async function readStored(): Promise<StoredAgentValidation> {
    try {
      const raw = await readFile(validationPath, { encoding: "utf8" });
      const stored = JSON.parse(raw) as StoredAgentValidation;
      return { schemaVersion: 1, latest: stored.latest ?? null };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, latest: null };
      }
      throw error;
    }
  }

  async function writeStored(stored: StoredAgentValidation) {
    await mkdir(options.configDir, { recursive: true });
    await writeFile(validationPath, `${JSON.stringify(stored, null, 2)}\n`, { encoding: "utf8" });
  }

  const jsonImpl: AgentValidationStore = {
    async load() {
      const stored = await readStored();
      return stored.latest;
    },
    async save(snapshot) {
      await writeStored({ schemaVersion: 1, latest: snapshot });
      return snapshot;
    },
    async flushShadowWrites() {
      return;
    },
  };

  if (backend === "json" || !options.storage) {
    return jsonImpl;
  }

  // --- sqlite / dual ---
  const repo: ValidationRepository = createValidationRepository(options.storage);
  const shadowQueue = createFailureVisibleSerialQueue();
  return {
    async load() {
      return repo.load();
    },
    async save(snapshot) {
      shadowQueue.assertOpen();
      repo.save(snapshot);
      if (backend === "dual") {
        void shadowQueue.enqueue(() => jsonImpl.save(snapshot));
      }
      return snapshot;
    },
    async flushShadowWrites(flushOptions) {
      await shadowQueue.drain(flushOptions);
    },
  };
}
