import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Goal, GoalStatus, ProgressLedgerEvent } from "../shared/agentGoal";
import { readRecoverableJsonl } from "./jsonlRecovery";
import { verifyGoalAcceptanceCertificate } from "./agentGoalAcceptanceCertificate";

export type { ProgressLedgerEvent } from "../shared/agentGoal";

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
const irreversibleGoalStatuses = new Set<GoalStatus>(["achieved", "canceled"]);

export function createAgentGoalStore(options: {
  configDir: string;
}): AgentGoalStore {
  const goalsDir = path.join(options.configDir, "agent-goals");
  let mutationQueue = Promise.resolve();

  function goalPath(goalId: string): string {
    return path.join(goalsDir, `${goalId}.json`);
  }

  function ledgerPath(goalId: string): string {
    return path.join(goalsDir, `${goalId}.ledger.jsonl`);
  }

  async function readGoal(goalId: string): Promise<Goal | null> {
    try {
      const filePath = goalPath(goalId);
      const raw = await readFile(filePath, "utf8");
      return normalizeGoal(JSON.parse(raw) as Goal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      if (error instanceof SyntaxError) {
        await quarantineCorruptJsonFile(goalPath(goalId));
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
      return serializeMutation(mutationQueue, (nextQueue) => {
        mutationQueue = nextQueue;
      }, async () => {
        const existing = await readGoal(goal.id);
        if (existing && isCanonicalCertifiedAchievement(existing)) {
          return existing;
        }
        if (
          existing &&
          irreversibleGoalStatuses.has(existing.status) &&
          goal.status !== existing.status
        ) {
          return existing;
        }
        if (goal.acceptanceProtocolVersion === 2 && goal.status === "achieved") {
          const terminalVerification = verifyProtocolV2Achievement(goal);
          if (!terminalVerification.ok) {
            if (existing) return existing;
            throw new Error(
              `Cannot save protocol-v2 achieved goal: ${terminalVerification.reason}`,
            );
          }
        }
        await writeJsonFileAtomically(
          goalsDir,
          goalPath(goal.id),
          `${JSON.stringify(goal, null, 2)}\n`,
        );
        return goal;
      });
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
      return readRecoverableJsonl<ProgressLedgerEvent>(ledgerPath(goalId));
    },

    async delete(goalId) {
      return serializeMutation(mutationQueue, (nextQueue) => {
        mutationQueue = nextQueue;
      }, async () => {
        try {
          await unlink(goalPath(goalId));
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

function serializeMutation<T>(
  currentQueue: Promise<void>,
  setQueue: (queue: Promise<void>) => void,
  operation: () => Promise<T>,
): Promise<T> {
  const result = currentQueue.then(operation, operation);
  setQueue(result.then(
    () => undefined,
    () => undefined,
  ));
  return result;
}

async function writeJsonFileAtomically(
  directory: string,
  filePath: string,
  content: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(tempPath, content, { encoding: "utf8" });
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

async function quarantineCorruptJsonFile(filePath: string): Promise<void> {
  try {
    await rename(filePath, `${filePath}.corrupt-${Date.now()}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
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

function isCanonicalCertifiedAchievement(goal: Goal): boolean {
  return goal.status === "achieved" && verifyProtocolV2Achievement(goal).ok;
}

function verifyProtocolV2Achievement(
  goal: Goal,
): { ok: true } | { ok: false; reason: string } {
  if (goal.acceptanceProtocolVersion !== 2) {
    return { ok: false, reason: "Goal is not using acceptance protocol v2." };
  }
  if (goal.stopReason !== "goal_accepted") {
    return {
      ok: false,
      reason: "Protocol-v2 achieved goal requires stopReason goal_accepted.",
    };
  }
  if (
    goal.acceptanceState?.protocolVersion !== 2 ||
    goal.acceptanceState.phase !== "certified"
  ) {
    return {
      ok: false,
      reason: "Protocol-v2 achieved goal requires certified acceptance state.",
    };
  }
  return verifyGoalAcceptanceCertificate(goal);
}
