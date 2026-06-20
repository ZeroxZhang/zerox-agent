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
  "stopped_budget",
  "stopped_stalled",
  "failed",
  "canceled",
]);

function isActive(status: GoalStatus): boolean {
  return !TERMINAL_GOAL_STATUSES.has(status);
}

export function createGoalRepository(storage: Storage): GoalRepository {
  const db = storage.db;

  return {
    save(goal: Goal): Goal {
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

    get(goalId: string): Goal | null {
      return getPayloadRow<Goal>(db, "SELECT payload FROM goals WHERE id = ?", [goalId]);
    },

    listActive(): Goal[] {
      return selectPayloadRows<Goal>(
        db,
        `SELECT payload FROM goals
         WHERE status NOT IN ('achieved','stopped_budget','stopped_stalled','failed','canceled')
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
