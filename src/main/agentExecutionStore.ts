import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
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
  const mutationQueues = new Map<string, Promise<void>>();

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

      if (error instanceof SyntaxError) {
        await quarantineCorruptCheckpoint(runId);
        return null;
      }

      throw error;
    }
  }

  async function quarantineCorruptCheckpoint(runId: string): Promise<void> {
    const source = checkpointPath(runId);
    const destination = path.join(
      executionsDir,
      `${runId}.corrupt-${Date.now()}-${randomUUID()}.json`,
    );
    try {
      await rename(source, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async function withRunMutation<T>(
    runId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = mutationQueues.get(runId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const settled = current.then(
      () => undefined,
      () => undefined,
    );
    mutationQueues.set(runId, settled);

    try {
      return await current;
    } finally {
      if (mutationQueues.get(runId) === settled) {
        mutationQueues.delete(runId);
      }
    }
  }

  return {
    async save(checkpoint) {
      return withRunMutation(checkpoint.runId, async () => {
        await mkdir(executionsDir, { recursive: true });
        const destination = checkpointPath(checkpoint.runId);
        const temporary = `${destination}.${process.pid}-${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, {
            encoding: "utf8",
          });
          await rename(temporary, destination);
        } catch (error) {
          await unlink(temporary).catch(() => undefined);
          throw error;
        }
        return checkpoint;
      });
    },

    async get(runId) {
      return withRunMutation(runId, () => readCheckpoint(runId));
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
          .filter(
            (file) => file.endsWith(".json") && !file.includes(".corrupt-"),
          )
          .map((file) => {
            const runId = path.basename(file, ".json");
            return withRunMutation(runId, () => readCheckpoint(runId));
          }),
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
      return withRunMutation(runId, async () => {
        try {
          await unlink(checkpointPath(runId));
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return false;
          }

          throw error;
        }
      });
    },
  };
}

function isActiveCheckpoint(
  checkpoint: AgentExecutionCheckpoint | null,
): checkpoint is AgentExecutionCheckpoint {
  return checkpoint !== null && !isTerminalExecutionStatus(checkpoint.status);
}
