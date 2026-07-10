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
  "stopped_blocked",
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
      return sanitizeGoalForRead(normalizeGoal(JSON.parse(raw) as Goal));
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
        const candidate = preserveCanonicalAcceptance(existing, goal);
        if (
          existing &&
          irreversibleGoalStatuses.has(existing.status) &&
          candidate.status !== existing.status
        ) {
          return existing;
        }
        if (
          candidate.acceptanceProtocolVersion === 2 &&
          candidate.status === "achieved"
        ) {
          const terminalVerification = verifyProtocolV2Achievement(candidate);
          if (!terminalVerification.ok) {
            if (existing) return existing;
            throw new Error(
              `Cannot save protocol-v2 achieved goal: ${terminalVerification.reason}`,
            );
          }
        }
        await writeJsonFileAtomically(
          goalsDir,
          goalPath(candidate.id),
          `${JSON.stringify(candidate, null, 2)}\n`,
        );
        return candidate;
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

function sanitizeGoalForRead(goal: Goal): Goal {
  if (
    goal.status !== "achieved" ||
    goal.acceptanceProtocolVersion !== 2 ||
    verifyProtocolV2Achievement(goal).ok
  ) {
    return goal;
  }

  const { acceptanceCertificate: _invalidCertificate, ...safeGoal } = goal;
  return safeGoal;
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

function preserveCanonicalAcceptance(
  existing: Goal | null,
  incoming: Goal,
): Goal {
  if (existing?.acceptanceProtocolVersion !== 2) {
    return incoming;
  }

  const acceptanceState = mergeAcceptanceState(
    existing.acceptanceState,
    incoming.acceptanceState,
  );

  return {
    ...incoming,
    acceptanceProtocolVersion: 2,
    ...(acceptanceState ? { acceptanceState } : {}),
    ...(incoming.acceptanceCertificate
      ? { acceptanceCertificate: incoming.acceptanceCertificate }
      : existing.acceptanceCertificate
        ? { acceptanceCertificate: existing.acceptanceCertificate }
        : {}),
  };
}

function mergeAcceptanceState(
  existing: Goal["acceptanceState"],
  incoming: Goal["acceptanceState"],
): Goal["acceptanceState"] {
  if (!incoming) return existing;
  if (!existing) return incoming;

  const recentFailures = mergeAcceptanceFailures(
    existing.recentFailures,
    incoming.recentFailures,
  );
  const lastDecision =
    incoming.phase === "certified"
      ? undefined
      : chooseCanonicalLastDecision(
          existing.lastDecision,
          incoming.lastDecision,
          recentFailures,
        );

  return {
    ...incoming,
    attempt: Math.max(existing.attempt, incoming.attempt),
    recentFailures,
    ...(lastDecision ? { lastDecision } : {}),
  };
}

type GoalAcceptanceFailure = NonNullable<
  Goal["acceptanceState"]
>["recentFailures"][number];
type GoalAcceptanceDecision = NonNullable<
  NonNullable<Goal["acceptanceState"]>["lastDecision"]
>;

function mergeAcceptanceFailures(
  existing: GoalAcceptanceFailure[],
  incoming: GoalAcceptanceFailure[],
): GoalAcceptanceFailure[] {
  const records = new Map<
    string,
    {
      record: GoalAcceptanceFailure;
      existingOrder?: number;
      incomingOrder?: number;
    }
  >();

  incoming.forEach((record, order) => {
    records.set(acceptanceFailureIdentity(record), {
      record,
      incomingOrder: order,
    });
  });
  existing.forEach((record, order) => {
    const identity = acceptanceFailureIdentity(record);
    const duplicate = records.get(identity);
    records.set(identity, {
      record,
      existingOrder: order,
      ...(duplicate?.incomingOrder !== undefined
        ? { incomingOrder: duplicate.incomingOrder }
        : {}),
    });
  });

  return [...records.values()]
    .sort((left, right) => {
      const byTime = left.record.at.localeCompare(right.record.at);
      if (byTime !== 0) return byTime;
      if (
        left.record.targetKind === right.record.targetKind &&
        left.record.targetId === right.record.targetId &&
        left.record.fingerprint === right.record.fingerprint &&
        left.record.occurrence !== right.record.occurrence
      ) {
        return left.record.occurrence - right.record.occurrence;
      }
      if (
        left.incomingOrder !== undefined &&
        right.incomingOrder !== undefined
      ) {
        return left.incomingOrder - right.incomingOrder;
      }
      if (
        left.existingOrder !== undefined &&
        right.existingOrder !== undefined
      ) {
        return left.existingOrder - right.existingOrder;
      }
      return (
        acceptanceFailureIdentity(left.record).localeCompare(
          acceptanceFailureIdentity(right.record),
        )
      );
    })
    .slice(-20)
    .map(({ record }) => record);
}

function acceptanceFailureIdentity(record: GoalAcceptanceFailure): string {
  return [
    record.at,
    record.targetKind,
    record.targetId,
    record.fingerprint,
    String(record.occurrence),
  ].join("\u0000");
}

function chooseCanonicalLastDecision(
  existing: GoalAcceptanceDecision | undefined,
  incoming: GoalAcceptanceDecision | undefined,
  failures: GoalAcceptanceFailure[],
): GoalAcceptanceDecision | undefined {
  if (!existing) return incoming;
  if (!incoming) return existing;

  const existingIndex = newestMatchingFailureIndex(existing, failures);
  const incomingIndex = newestMatchingFailureIndex(incoming, failures);
  return incomingIndex > existingIndex ? incoming : existing;
}

function newestMatchingFailureIndex(
  decision: GoalAcceptanceDecision,
  failures: GoalAcceptanceFailure[],
): number {
  const failedCheckIds = [...decision.failedCheckIds].sort().join("\u0000");
  for (let index = failures.length - 1; index >= 0; index -= 1) {
    const failure = failures[index]!;
    if (
      failure.fingerprint === decision.fingerprint &&
      failure.occurrence === decision.occurrence &&
      [...failure.failedCheckIds].sort().join("\u0000") === failedCheckIds
    ) {
      return index;
    }
  }
  return -1;
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
