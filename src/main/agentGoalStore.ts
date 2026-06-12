import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Goal, GoalStatus } from "../shared/agentGoal";

export type ProgressLedgerEvent = {
  at: string;
  kind:
    | "goal_planned"
    | "milestone_started"
    | "milestone_accepted"
    | "milestone_rejected"
    | "goal_replanned"
    | "review_requested"
    | "review_resolved"
    | "goal_stopped";
  milestoneId?: string;
  summary: string;
  evidenceRefs?: string[];
};

export type AgentGoalStore = {
  save(goal: Goal): Promise<Goal>;
  get(goalId: string): Promise<Goal | null>;
  listActive(): Promise<Goal[]>;
  listByChatSession(chatSessionId: string): Promise<Goal[]>;
  appendLedger(goalId: string, event: ProgressLedgerEvent): Promise<void>;
  readLedger(goalId: string): Promise<ProgressLedgerEvent[]>;
  delete(goalId: string): Promise<boolean>;
};

const terminalGoalStatuses = new Set<GoalStatus>([
  "achieved",
  "stopped_budget",
  "stopped_stalled",
  "failed",
  "canceled",
]);

export function createAgentGoalStore(options: {
  configDir: string;
}): AgentGoalStore {
  const goalsDir = path.join(options.configDir, "agent-goals");

  function goalPath(goalId: string): string {
    return path.join(goalsDir, `${goalId}.json`);
  }

  function ledgerPath(goalId: string): string {
    return path.join(goalsDir, `${goalId}.ledger.jsonl`);
  }

  async function readGoal(goalId: string): Promise<Goal | null> {
    try {
      const raw = await readFile(goalPath(goalId), "utf8");
      return normalizeGoal(JSON.parse(raw) as Goal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  async function readAllGoals(): Promise<Goal[]> {
    let files: string[];
    try {
      files = await readdir(goalsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }

    const goals = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map((file) => readGoal(path.basename(file, ".json"))),
    );

    return goals.filter((goal): goal is Goal => goal !== null);
  }

  return {
    async save(goal) {
      await mkdir(goalsDir, { recursive: true });
      await writeFile(goalPath(goal.id), `${JSON.stringify(goal, null, 2)}\n`, {
        encoding: "utf8",
      });
      return goal;
    },

    async get(goalId) {
      return readGoal(goalId);
    },

    async listActive() {
      return (await readAllGoals())
        .filter(isActiveGoal)
        .sort(compareGoalsByUpdatedAtDesc);
    },

    async listByChatSession(chatSessionId) {
      const goals = await readAllGoals();
      return goals
        .filter((goal) => goal.chatSessionId === chatSessionId)
        .sort(compareGoalsByUpdatedAtDesc);
    },

    async appendLedger(goalId, event) {
      await mkdir(goalsDir, { recursive: true });
      await writeFile(ledgerPath(goalId), `${JSON.stringify(event)}\n`, {
        encoding: "utf8",
        flag: "a",
      });
    },

    async readLedger(goalId) {
      try {
        const raw = await readFile(ledgerPath(goalId), "utf8");
        return raw
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as ProgressLedgerEvent);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }

        throw error;
      }
    },

    async delete(goalId) {
      try {
        await unlink(goalPath(goalId));
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

function isActiveGoal(goal: Goal | null): goal is Goal {
  return goal !== null && !terminalGoalStatuses.has(goal.status);
}

function normalizeGoal(goal: Goal): Goal {
  return {
    ...goal,
    ...(goal.chatSessionId ? { chatSessionId: String(goal.chatSessionId) } : {}),
    ...(goal.originMessageId
      ? { originMessageId: String(goal.originMessageId) }
      : {}),
  };
}

function compareGoalsByUpdatedAtDesc(left: Goal, right: Goal): number {
  return (
    new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime() ||
    right.id.localeCompare(left.id)
  );
}
