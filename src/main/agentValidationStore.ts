import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentBootstrapValidationSnapshot } from "../shared/agentBootstrap";
import type { StorageBackend, Storage, ValidationRepository } from "../shared/storageContract";
import { createValidationRepository } from "./storage/repositories/index";

type StoredAgentValidation = {
  schemaVersion: 1;
  latest: AgentBootstrapValidationSnapshot | null;
};

export type AgentValidationStore = {
  load(): Promise<AgentBootstrapValidationSnapshot | null>;
  save(
    snapshot: AgentBootstrapValidationSnapshot,
  ): Promise<AgentBootstrapValidationSnapshot>;
};

export interface AgentValidationStoreOptions {
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
  };

  if (backend === "json" || !options.storage) {
    return jsonImpl;
  }

  // --- sqlite / dual ---
  const repo: ValidationRepository = createValidationRepository(options.storage);
  return {
    async load() {
      return repo.load();
    },
    async save(snapshot) {
      repo.save(snapshot);
      if (backend === "dual") void jsonImpl.save(snapshot).catch(shadowWriteError);
      return snapshot;
    },
  };
}

export { shadowWriteError };
