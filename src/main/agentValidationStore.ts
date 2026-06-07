import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentBootstrapValidationSnapshot } from "../shared/agentBootstrap";

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

export function createAgentValidationStore(options: {
  configDir: string;
}): AgentValidationStore {
  const validationPath = path.join(options.configDir, "agent-validation.json");

  async function readStored(): Promise<StoredAgentValidation> {
    try {
      const raw = await readFile(validationPath, { encoding: "utf8" });
      const stored = JSON.parse(raw) as StoredAgentValidation;
      return {
        schemaVersion: 1,
        latest: stored.latest ?? null,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, latest: null };
      }

      throw error;
    }
  }

  async function writeStored(stored: StoredAgentValidation) {
    await mkdir(options.configDir, { recursive: true });
    await writeFile(validationPath, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: "utf8",
    });
  }

  return {
    async load() {
      const stored = await readStored();
      return stored.latest;
    },

    async save(snapshot) {
      await writeStored({
        schemaVersion: 1,
        latest: snapshot,
      });
      return snapshot;
    },
  };
}
