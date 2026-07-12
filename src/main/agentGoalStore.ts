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
  saveIfStatus(
    goal: Goal,
    expectedStatus: GoalStatus,
  ): Promise<GoalConditionalSaveResult>;
  get(goalId: string): Promise<Goal | null>;
  listActive(): Promise<Goal[]>;
  listByChatSession(chatSessionId: string): Promise<Goal[]>;
  appendLedger(goalId: string, event: ProgressLedgerEvent): Promise<void>;
  appendLedgerIfAbsent(
    goalId: string,
    publicationKey: string,
    event: ProgressLedgerEvent,
  ): Promise<boolean>;
  readLedger(goalId: string): Promise<ProgressLedgerEvent[]>;
  delete(goalId: string): Promise<boolean>;
};

export type GoalConditionalSaveResult = {
  saved: boolean;
  goal: Goal | null;
};

const terminalGoalStatuses = new Set<GoalStatus>([
  "achieved",
  "completed_unverified",
  "stopped_budget",
  "stopped_stalled",
  "stopped_blocked",
  "failed",
  "canceled",
]);
const irreversibleGoalStatuses = new Set<GoalStatus>([
  "achieved",
  "completed_unverified",
  "canceled",
]);
const goalMutationQueues = new Map<string, Promise<void>>();

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

  async function readRawGoal(goalId: string): Promise<Goal | null> {
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

  async function readGoal(goalId: string): Promise<Goal | null> {
    const goal = await readRawGoal(goalId);
    return goal ? sanitizeGoalForRead(goal) : null;
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

  async function persistGoal(
    goal: Goal,
    expectedStatus?: GoalStatus,
  ): Promise<GoalConditionalSaveResult> {
    return serializeMutation(goalsDir, async () => {
      const existing = await readRawGoal(goal.id);
      if (expectedStatus !== undefined && existing?.status !== expectedStatus) {
        return {
          saved: false,
          goal: existing ? sanitizeGoalForRead(existing) : null,
        };
      }
      if (existing && hasInvalidProtocolV2Achievement(existing)) {
        return { saved: false, goal: sanitizeGoalForRead(existing) };
      }
      if (existing && isCanonicalCertifiedAchievement(existing)) {
        return { saved: false, goal: existing };
      }
      if (existing?.status === "completed_unverified") {
        return { saved: false, goal: sanitizeGoalForRead(existing) };
      }
      const candidate = stripUnverifiedCompletionCertificate(
        preserveCanonicalAcceptance(existing, goal),
      );
      if (
        existing &&
        irreversibleGoalStatuses.has(existing.status) &&
        candidate.status !== existing.status
      ) {
        return { saved: false, goal: existing };
      }
      if (
        candidate.acceptanceProtocolVersion === 2 &&
        candidate.status === "achieved"
      ) {
        const terminalVerification = verifyProtocolV2Achievement(candidate);
        if (!terminalVerification.ok) {
          if (existing) return { saved: false, goal: existing };
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
      return { saved: true, goal: candidate };
    });
  }

  return {
    async save(goal) {
      const result = await persistGoal(goal);
      if (!result.goal) {
        throw new Error(`Goal "${goal.id}" could not be saved.`);
      }
      return result.goal;
    },

    async saveIfStatus(goal, expectedStatus) {
      return persistGoal(goal, expectedStatus);
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

    async appendLedgerIfAbsent(goalId, publicationKey, event) {
      return serializeMutation(goalsDir, async () => {
        const ledger = await readRecoverableJsonl<ProgressLedgerEvent>(
          ledgerPath(goalId),
        );
        if (
          ledger.some(
            (candidate) => candidate.publicationKey === publicationKey,
          )
        ) {
          return false;
        }
        await mkdir(goalsDir, { recursive: true });
        await writeFile(
          ledgerPath(goalId),
          `${JSON.stringify({ ...event, publicationKey })}\n`,
          { encoding: "utf8", flag: "a" },
        );
        return true;
      });
    },

    async readLedger(goalId) {
      return readRecoverableJsonl<ProgressLedgerEvent>(ledgerPath(goalId));
    },

    async delete(goalId) {
      return serializeMutation(goalsDir, async () => {
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
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const currentQueue = goalMutationQueues.get(key) ?? Promise.resolve();
  const result = currentQueue.then(operation, operation);
  const nextQueue = result.then(
    () => undefined,
    () => undefined,
  );
  goalMutationQueues.set(key, nextQueue);
  void nextQueue.finally(() => {
    if (goalMutationQueues.get(key) === nextQueue) {
      goalMutationQueues.delete(key);
    }
  });
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
  const sanitized = stripUnverifiedCompletionCertificate(goal);
  if (!hasInvalidProtocolV2Achievement(sanitized)) {
    return sanitized;
  }

  const { acceptanceCertificate: _invalidCertificate, ...safeGoal } = sanitized;
  return {
    ...safeGoal,
    status: "stopped_blocked",
    stopReason: "acceptance_integrity_failed",
    acceptanceState: {
      protocolVersion: 2,
      phase: "blocked",
      attempt: sanitized.acceptanceState?.attempt ?? 0,
      recentFailures: sanitized.acceptanceState?.recentFailures ?? [],
      ...(sanitized.acceptanceState?.lastDecision
        ? { lastDecision: sanitized.acceptanceState.lastDecision }
        : {}),
    },
  };
}

function hasInvalidProtocolV2Achievement(goal: Goal): boolean {
  return (
    goal.status === "achieved" &&
    goal.acceptanceProtocolVersion === 2 &&
    !verifyProtocolV2Achievement(goal).ok
  );
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

  const candidate: Goal = {
    ...incoming,
    acceptanceProtocolVersion: 2,
    ...(acceptanceState ? { acceptanceState } : {}),
    ...(incoming.acceptanceCertificate
      ? { acceptanceCertificate: incoming.acceptanceCertificate }
      : existing.acceptanceCertificate
        ? { acceptanceCertificate: existing.acceptanceCertificate }
        : {}),
  };
  return candidate;
}

function stripUnverifiedCompletionCertificate(goal: Goal): Goal {
  if (goal.status !== "completed_unverified") {
    return goal;
  }
  const { acceptanceCertificate: _certificate, ...safeGoal } = goal;
  return safeGoal;
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
