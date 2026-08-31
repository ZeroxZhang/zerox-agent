// GoalRepository (contracts v1.4 §8, Exit Criteria §6.5).
//
// `goals` stores the full Goal as `payload` with denormalized chat_session_id /
// status for indexed listing. `goal_ledger` is an append-only table mirroring
// the legacy `<id>.ledger.jsonl`, with (goal_id, seq) ordering.

import {
  sanitizeFinalGoalJudgeReplayEvidence,
  type Goal,
  type GoalStatus,
  type ProgressLedgerEvent,
} from "../../../shared/agentGoal";
import type { GoalRepository, Storage } from "../../../shared/storageContract";
import { jsonify, parseJson } from "../repositoryUtils";

const TERMINAL_GOAL_STATUSES = new Set<GoalStatus>([
  "achieved",
  "completed_unverified",
  "stopped_budget",
  "stopped_stalled",
  "stopped_blocked",
  "failed",
  "canceled",
]);
const IRREVERSIBLE_GOAL_STATUSES = new Set<GoalStatus>([
  "achieved",
  "completed_unverified",
  "canceled",
]);

function isActive(status: GoalStatus): boolean {
  return !TERMINAL_GOAL_STATUSES.has(status);
}

function normalizedPlanVersion(goal: Goal): number {
  return Math.max(1, Number(goal.planVersion ?? 1));
}

export function createGoalRepository(storage: Storage): GoalRepository {
  const db = storage.db;
  const readStoredGoal = (goalId: string): Goal | null => {
    const row = db.prepare(
      "SELECT id, payload FROM goals WHERE id = ?",
    ).get<{ id: string; payload: string }>(goalId);
    return row ? parseOwnedGoalRow(row) : null;
  };
  const writeGoal = (candidate: Goal): void => {
    db.prepare(
      `INSERT INTO goals (
         id, chat_session_id, status, plan_version, active_plan_id,
         payload, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         chat_session_id = excluded.chat_session_id,
         status = excluded.status,
         plan_version = excluded.plan_version,
         active_plan_id = excluded.active_plan_id,
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
    ).run(
      candidate.id,
      candidate.chatSessionId ?? null,
      candidate.status,
      normalizedPlanVersion(candidate),
      candidate.activePlanRef?.planId ?? null,
      jsonify(candidate),
      candidate.createdAt,
      candidate.updatedAt,
    );
  };
  const saveTransaction = db.transaction((goal: Goal): Goal => {
    const existing = readStoredGoal(goal.id);
    if (existing?.status === "completed_unverified") {
      return existing;
    }
    if (
      existing &&
      IRREVERSIBLE_GOAL_STATUSES.has(existing.status) &&
      goal.status !== existing.status
    ) {
      return existing;
    }
    const candidate = sanitizeFinalJudgeReplay(
      stripUnverifiedCompletionCertificate(goal),
    );
    writeGoal(candidate);
    return candidate;
  });
  const ensureLedgerSequence = db.prepare(
    `INSERT INTO goal_ledger_sequences (goal_id, next_seq)
     VALUES (?, 1)
     ON CONFLICT(goal_id) DO NOTHING`,
  );
  const allocateLedgerSequence = db.prepare(
    `UPDATE goal_ledger_sequences
     SET next_seq = next_seq + 1
     WHERE goal_id = ?
     RETURNING next_seq - 1 AS seq`,
  );
  const appendLedgerTransaction = db.transaction(
    (
      goalId: string,
      event: ProgressLedgerEvent,
      publicationKey?: string,
    ): boolean => {
      // This is deliberately the first statement in the transaction. It takes
      // SQLite's writer lock before publication lookup or sequence allocation.
      ensureLedgerSequence.run(goalId);
      if (publicationKey !== undefined) {
        const existing = db
          .prepare(
            `SELECT 1 FROM goal_ledger
             WHERE goal_id = ? AND publication_key = ?`,
          )
          .get(goalId, publicationKey);
        if (existing) return false;
      }
      const sequence = allocateLedgerSequence.get<{ seq: number }>(goalId);
      if (!sequence) {
        throw new Error(
          `Unable to allocate Goal ledger sequence for "${goalId}".`,
        );
      }
      db.prepare(
        `INSERT INTO goal_ledger (
           goal_id, seq, publication_key, payload, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      ).run(
        goalId,
        sequence.seq,
        publicationKey ?? null,
        jsonify(event),
        event.at,
      );
      return true;
    },
  );

  return {
    save(goal: Goal): Goal {
      return saveTransaction(goal);
    },

    saveIfStatus(goal: Goal, expectedStatus: GoalStatus) {
      const candidate = sanitizeFinalJudgeReplay(
        stripUnverifiedCompletionCertificate(goal),
      );
      const result = db.prepare(
        `UPDATE goals
         SET chat_session_id = ?, status = ?, payload = ?, updated_at = ?
             , plan_version = ?, active_plan_id = ?
         WHERE id = ? AND status = ?`,
      ).run(
        candidate.chatSessionId ?? null,
        candidate.status,
        jsonify(candidate),
        candidate.updatedAt,
        normalizedPlanVersion(candidate),
        candidate.activePlanRef?.planId ?? null,
        candidate.id,
        expectedStatus,
      );
      if (result.changes === 1) {
        return { saved: true, goal: candidate };
      }
      return {
        saved: false,
        goal: readStoredGoal(goal.id),
      };
    },

    saveIfPlanVersion(
      goal: Goal,
      expectedPlanVersion: number,
      expectedActivePlanId?: string,
    ) {
      const candidate = sanitizeFinalJudgeReplay(
        stripUnverifiedCompletionCertificate(goal),
      );
      const result = db.prepare(
        `UPDATE goals
         SET chat_session_id = ?,
             status = ?,
             plan_version = ?,
             active_plan_id = ?,
             payload = ?,
             updated_at = ?
         WHERE id = ?
           AND COALESCE(
             plan_version,
             CAST(json_extract(payload, '$.planVersion') AS INTEGER),
             1
           ) = ?
           AND status NOT IN ('achieved', 'completed_unverified', 'canceled')
           AND (
             ? IS NULL
             OR COALESCE(
               active_plan_id,
               json_extract(payload, '$.activePlanRef.planId')
             ) = ?
           )`,
      ).run(
        candidate.chatSessionId ?? null,
        candidate.status,
        normalizedPlanVersion(candidate),
        candidate.activePlanRef?.planId ?? null,
        jsonify(candidate),
        candidate.updatedAt,
        candidate.id,
        expectedPlanVersion,
        expectedActivePlanId ?? null,
        expectedActivePlanId ?? null,
      );
      return result.changes === 1
        ? { saved: true, goal: candidate }
        : { saved: false, goal: readStoredGoal(goal.id) };
    },

    get(goalId: string): Goal | null {
      return readStoredGoal(goalId);
    },

    getMany(goalIds: readonly string[]): Goal[] {
      const uniqueGoalIds = [...new Set(goalIds)];
      if (uniqueGoalIds.length === 0) return [];
      const placeholders = uniqueGoalIds.map(() => "?").join(", ");
      const rows = db
        .prepare(
          `SELECT id, payload FROM goals WHERE id IN (${placeholders})`,
        )
        .all<{ id: string; payload: string }>(...uniqueGoalIds);
      const goalsById = new Map(
        rows
          .map((row) => [
            row.id,
            parseOwnedGoalRow(row),
          ] as const)
          .filter(
            (entry): entry is readonly [string, Goal] => entry[1] !== null,
          ),
      );
      return uniqueGoalIds.flatMap((goalId) => {
        const goal = goalsById.get(goalId);
        return goal ? [goal] : [];
      });
    },

    listActive(): Goal[] {
      return db.prepare(
        `SELECT id, payload FROM goals
         WHERE status NOT IN ('achieved','completed_unverified','stopped_budget','stopped_stalled','stopped_blocked','failed','canceled')
         ORDER BY updated_at DESC`,
      )
        .all<{ id: string; payload: string }>()
        .map(parseOwnedGoalRow)
        .filter((goal): goal is Goal => goal !== null && isActive(goal.status));
    },

    listByChatSession(chatSessionId: string): Goal[] {
      return db.prepare(
        "SELECT id, payload FROM goals WHERE chat_session_id = ? ORDER BY updated_at DESC",
      )
        .all<{ id: string; payload: string }>(chatSessionId)
        .map(parseOwnedGoalRow)
        .filter((goal): goal is Goal => goal !== null);
    },

    delete(goalId: string): boolean {
      const res = db.prepare("DELETE FROM goals WHERE id = ?").run(goalId);
      return res.changes > 0;
    },

    appendLedger(goalId: string, event: ProgressLedgerEvent): void {
      appendLedgerTransaction(goalId, event);
    },

    appendLedgerIfAbsent(goalId, publicationKey, event) {
      const storedEvent = { ...event, publicationKey };
      return appendLedgerTransaction(goalId, storedEvent, publicationKey);
    },

    readLedger(goalId: string): ProgressLedgerEvent[] {
      const rows = db
        .prepare("SELECT payload FROM goal_ledger WHERE goal_id = ? ORDER BY seq ASC")
        .all<{ payload: string }>(goalId);
      return rows
        .map((r) => parseJson<ProgressLedgerEvent>(r.payload))
        .filter((v): v is ProgressLedgerEvent => v !== null);
    },
  };
}

function parseOwnedGoalRow(row: { id: string; payload: string }): Goal | null {
  const goal = sanitizeStoredGoal(parseJson<Goal>(row.payload));
  // SQLite row ids are ownership, not an index hint. A payload that claims a
  // different id is corrupt or foreign and must never cross the authority
  // boundary under the queried owner's name.
  return goal?.id === row.id ? goal : null;
}

function stripUnverifiedCompletionCertificate(goal: Goal): Goal {
  if (goal.status !== "completed_unverified") {
    return goal;
  }
  const { acceptanceCertificate: _certificate, ...safeGoal } = goal;
  return safeGoal;
}

function sanitizeStoredGoal(goal: Goal | null): Goal | null {
  if (!goal) return null;
  const {
    budgetUsage: legacyUsage,
    ...goalWithoutLegacyUsage
  } = (
    goal as Goal & {
      budgetUsage?: Goal["executionUsage"];
    }
  );
  return sanitizeFinalJudgeReplay(
    stripUnverifiedCompletionCertificate({
      ...goalWithoutLegacyUsage,
      executionUsage: {
        iterations: Math.max(
          0,
          Number((goal.executionUsage ?? legacyUsage)?.iterations ?? 0),
        ),
        toolCalls: Math.max(
          0,
          Number((goal.executionUsage ?? legacyUsage)?.toolCalls ?? 0),
        ),
        wallClockMs: Math.max(
          0,
          Number((goal.executionUsage ?? legacyUsage)?.wallClockMs ?? 0),
        ),
        tokens: Math.max(
          0,
          Number((goal.executionUsage ?? legacyUsage)?.tokens ?? 0),
        ),
        ...((goal.executionUsage ?? legacyUsage)?.tokensEstimated !== undefined
          ? {
              tokensEstimated: Boolean(
                (goal.executionUsage ?? legacyUsage)?.tokensEstimated,
              ),
            }
          : Number((goal.executionUsage ?? legacyUsage)?.tokens ?? 0) > 0
            ? { tokensEstimated: true }
          : {}),
        replans: Math.max(
          0,
          Number((goal.executionUsage ?? legacyUsage)?.replans ?? 0),
        ),
      },
    }),
  );
}

function sanitizeFinalJudgeReplay(goal: Goal): Goal {
  const retryState = goal.acceptanceRetryState;
  if (!retryState?.finalJudgeReplay) return goal;
  const finalJudgeReplay = sanitizeFinalGoalJudgeReplayEvidence(
    retryState.finalJudgeReplay,
  );
  if (finalJudgeReplay) {
    return {
      ...goal,
      acceptanceRetryState: { ...retryState, finalJudgeReplay },
    };
  }
  const { finalJudgeReplay: _invalidReplay, ...safeRetryState } = retryState;
  return { ...goal, acceptanceRetryState: safeRetryState };
}
