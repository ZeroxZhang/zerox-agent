import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";

export type AgentTrajectoryStore = {
  append(
    runId: string,
    event: AgentTrajectoryEvent,
  ): Promise<AgentTrajectoryEvent>;
  list(runId: string): Promise<AgentTrajectoryEvent[]>;
};

export function createAgentTrajectoryStore(options: {
  configDir: string;
}): AgentTrajectoryStore {
  const trajectoriesDir = path.join(options.configDir, "agent-trajectories");

  function trajectoryPath(runId: string): string {
    return path.join(trajectoriesDir, `${runId}.jsonl`);
  }

  return {
    async append(runId, event) {
      await mkdir(trajectoriesDir, { recursive: true });
      await writeFile(trajectoryPath(runId), `${JSON.stringify(event)}\n`, {
        encoding: "utf8",
        flag: "a",
      });
      return event;
    },

    async list(runId) {
      try {
        const raw = await readFile(trajectoryPath(runId), "utf8");
        return raw
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as AgentTrajectoryEvent);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }

        throw error;
      }
    },
  };
}
