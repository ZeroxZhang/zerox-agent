// GoalRepository (contracts v1.4 §8, Exit Criteria §6.5).
//
// `goals` stores the full Goal as `payload` with denormalized chat_session_id /
// status for indexed listing. `goal_ledger` is an append-only table mirroring
// the legacy `<id>.ledger.jsonl`, with (goal_id, seq) ordering.

import type { Goal, GoalStatus } from "../../../shared/agentGoal";
import type { ProgressLedgerEvent } from "../../../shared/agentGoal";
import type { GoalRepository, Storage } from "../../../shared/storageContract";
import { getPayloadRow, jsonify, parseJson, selectPayloadRows } from "../repositoryUtils";

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

export function createGoalRepository(storage: Storage): GoalRepository {
  const db = storage.db;

  return {
    save(goal: Goal): Goal {
      const existing = getPayloadRow<Goal>(
        db,
        "SELECT payload FROM goals WHERE id = ?",
        [goal.id],
      );
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
      db.prepare(
        `INSERT INTO goals (id, chat_session_id, status, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           chat_session_id=excluded.chat_session_id, status=excluded.status,
           payload=excluded.payload, updated_at=excluded.updated_at`,
      ).run(
        goal.id,
        goal.chatSessionId ?? null,
        goal.status,
        jsonify(goal),
        goal.createdAt,
        goal.updatedAt,
      );
      return goal;
    },

    saveIfStatus(goal: Goal, expectedStatus: GoalStatus) {
      const candidate = clearManualCompletionCertificate(goal);
      const result = db.prepare(
        `UPDATE goals
         SET chat_session_id = ?, status = ?, payload = ?, updated_at = ?
         WHERE id = ? AND status = ?`,
      ).run(
        candidate.chatSessionId ?? null,
        candidate.status,
        jsonify(candidate),
        candidate.updatedAt,
        candidate.id,
        expectedStatus,
      );
      if (result.changes === 1) {
        return { saved: true, goal: candidate };
      }
      return {
        saved: false,
        goal: getPayloadRow<Goal>(
          db,
          "SELECT payload FROM goals WHERE id = ?",
          [goal.id],
        ),
      };
    },

    get(goalId: string): Goal | null {
      return getPayloadRow<Goal>(db, "SELECT payload FROM goals WHERE id = ?", [goalId]);
    },

    listActive(): Goal[] {
      return selectPayloadRows<Goal>(
        db,
        `SELECT payload FROM goals
         WHERE status NOT IN ('achieved','completed_unverified','stopped_budget','stopped_stalled','stopped_blocked','failed','canceled')
         ORDER BY updated_at DESC`,
      ).filter((g) => isActive(g.status));
    },

    listByChatSession(chatSessionId: string): Goal[] {
      return selectPayloadRows<Goal>(
        db,
        "SELECT payload FROM goals WHERE chat_session_id = ? ORDER BY updated_at DESC",
        [chatSessionId],
      );
    },

    delete(goalId: string): boolean {
      const res = db.prepare("DELETE FROM goals WHERE id = ?").run(goalId);
      return res.changes > 0;
    },

    appendLedger(goalId: string, event: ProgressLedgerEvent): void {
      const seqRow = db
        .prepare("SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM goal_ledger WHERE goal_id = ?")
        .get(goalId) as { maxSeq: number };
      const seq = seqRow.maxSeq + 1;
      db.prepare(
        `INSERT INTO goal_ledger (goal_id, seq, payload, created_at) VALUES (?, ?, ?, ?)`,
      ).run(goalId, seq, jsonify(event), event.at);
    },

    appendLedgerIfAbsent(goalId, publicationKey, event) {
      const storedEvent = { ...event, publicationKey };
      const result = db.prepare(
        `INSERT INTO goal_ledger (goal_id, seq, payload, created_at)
         SELECT ?,
           COALESCE((SELECT MAX(seq) FROM goal_ledger WHERE goal_id = ?), 0) + 1,
           ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM goal_ledger
           WHERE goal_id = ?
             AND json_extract(payload, '$.publicationKey') = ?
         )`,
      ).run(
        goalId,
        goalId,
        jsonify(storedEvent),
        event.at,
        goalId,
        publicationKey,
      );
      return result.changes === 1;
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

function clearManualCompletionCertificate(goal: Goal): Goal {
  if (
    goal.status !== "completed_unverified" ||
    goal.stopReason !== "user_marked_complete" ||
    !goal.manualCompletionAttestation
  ) {
    return goal;
  }
  return { ...goal, acceptanceCertificate: undefined };
}
