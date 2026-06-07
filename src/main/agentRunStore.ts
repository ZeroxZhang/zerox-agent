import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentRunRecord } from "../shared/agentRuns";

export type AgentRunStore = {
  append(run: AgentRunRecord): Promise<AgentRunRecord>;
  get(runId: string): Promise<AgentRunRecord | null>;
  list(options?: { limit?: number; taskId?: string }): Promise<AgentRunRecord[]>;
};

export function createAgentRunStore(options: { configDir: string }): AgentRunStore {
  const runsPath = path.join(options.configDir, "agent-runs.jsonl");

  return {
    async append(run) {
      await mkdir(options.configDir, { recursive: true });
      await writeFile(runsPath, `${JSON.stringify(run)}\n`, {
        encoding: "utf8",
        flag: "a",
      });
      return run;
    },

    async get(runId) {
      const runs = await this.list({ limit: Number.MAX_SAFE_INTEGER });
      return runs.find((run) => run.id === runId) ?? null;
    },

    async list(listOptions) {
      const limit = listOptions?.limit ?? 50;

      try {
        const raw = await readFile(runsPath, "utf8");
        return raw
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as AgentRunRecord)
          .filter((run) =>
            listOptions?.taskId ? run.taskId === listOptions.taskId : true,
          )
          .reverse()
          .slice(0, limit);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }

        throw error;
      }
    },
  };
}
