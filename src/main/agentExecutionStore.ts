import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isTerminalExecutionStatus,
  type AgentExecutionCheckpoint,
} from "../shared/agentExecution";

export type AgentExecutionStore = {
  save(
    checkpoint: AgentExecutionCheckpoint,
  ): Promise<AgentExecutionCheckpoint>;
  get(runId: string): Promise<AgentExecutionCheckpoint | null>;
  listActive(): Promise<AgentExecutionCheckpoint[]>;
  delete(runId: string): Promise<boolean>;
};

export function createAgentExecutionStore(options: {
  configDir: string;
}): AgentExecutionStore {
  const executionsDir = path.join(options.configDir, "agent-executions");

  function checkpointPath(runId: string): string {
    return path.join(executionsDir, `${runId}.json`);
  }

  async function readCheckpoint(
    runId: string,
  ): Promise<AgentExecutionCheckpoint | null> {
    try {
      const raw = await readFile(checkpointPath(runId), "utf8");
      return JSON.parse(raw) as AgentExecutionCheckpoint;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  return {
    async save(checkpoint) {
      await mkdir(executionsDir, { recursive: true });
      await writeFile(checkpointPath(checkpoint.runId), `${JSON.stringify(checkpoint, null, 2)}\n`, {
        encoding: "utf8",
      });
      return checkpoint;
    },

    async get(runId) {
      return readCheckpoint(runId);
    },

    async listActive() {
      let files: string[];
      try {
        files = await readdir(executionsDir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }

        throw error;
      }

      const checkpoints = await Promise.all(
        files
          .filter((file) => file.endsWith(".json"))
          .map((file) => readCheckpoint(path.basename(file, ".json"))),
      );

      return checkpoints
        .filter(isActiveCheckpoint)
        .sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() -
              new Date(left.updatedAt).getTime() ||
            right.runId.localeCompare(left.runId),
        );
    },

    async delete(runId) {
      try {
        await unlink(checkpointPath(runId));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return false;
        }

        throw error;
      }
    },
  };
}

function isActiveCheckpoint(
  checkpoint: AgentExecutionCheckpoint | null,
): checkpoint is AgentExecutionCheckpoint {
  return checkpoint !== null && !isTerminalExecutionStatus(checkpoint.status);
}
