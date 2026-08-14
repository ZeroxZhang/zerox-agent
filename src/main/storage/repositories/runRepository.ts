// RunRepository + TrajectoryRepository (contracts v1.4 §1.3, Exit Criteria §6.2).
//
// `runs` stores the full AgentRunRecord as `payload` with denormalized
// task_id/status/started_at for indexed listing. `trajectory_events` stores
// each event as `payload` with (run_id, seq) UNIQUE — `appendTrajectory` is the
// synchronous hot path (contract §1.4: no async regression).

import type { AgentRunRecord } from "../../../shared/agentRuns";
import type { AgentRunStatus } from "../../../shared/agentRuns";
import type {
  AgentTrajectoryEvent,
  AgentTrajectoryEventType,
} from "../../../shared/agentTrajectory";
import type {
  RunRepository,
  Storage,
  TrajectoryRepository,
} from "../../../shared/storageContract";
import { getPayloadRow, jsonify, parseJson, selectPayloadRows } from "../repositoryUtils";

export function createRunRepository(storage: Storage): RunRepository {
  const db = storage.db;

  return {
    create(input: Omit<AgentRunRecord, "id"> & { id: string }): AgentRunRecord {
      const record: AgentRunRecord = { ...(input as AgentRunRecord) };
      db.prepare(
        `INSERT INTO runs (id, task_id, task_name, skill_name, status, summary, payload, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           task_id=excluded.task_id, task_name=excluded.task_name, skill_name=excluded.skill_name,
           status=excluded.status, summary=excluded.summary, payload=excluded.payload,
           started_at=excluded.started_at, finished_at=excluded.finished_at`,
      ).run(
        record.id,
        record.taskId,
        record.taskName,
        record.skillName,
        record.status,
        record.summary ?? "",
        jsonify(record),
        record.startedAt,
        record.finishedAt,
      );
      return record;
    },

    get(runId: string): AgentRunRecord | null {
      return getPayloadRow<AgentRunRecord>(
        db,
        "SELECT payload FROM runs WHERE id = ?",
        [runId],
      );
    },

    list(options?: { limit?: number; taskId?: string }): AgentRunRecord[] {
      const limit = options?.limit ?? 100;
      if (options?.taskId) {
        return selectPayloadRows<AgentRunRecord>(
          db,
          "SELECT payload FROM runs WHERE task_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?",
          [options.taskId, limit],
        );
      }
      return selectPayloadRows<AgentRunRecord>(
        db,
        "SELECT payload FROM runs ORDER BY started_at DESC, rowid DESC LIMIT ?",
        [limit],
      );
    },

    updateStatus(runId: string, status: AgentRunStatus): void {
      db.prepare(
        `UPDATE runs
         SET status = ?, payload = json_set(payload, '$.status', ?)
         WHERE id = ?`,
      ).run(status, status, runId);
    },

    appendTrajectory(
      runId: string,
      event: AgentTrajectoryEvent,
    ): AgentTrajectoryEvent {
      // Synchronous hot path. Use INSERT OR IGNORE on the (run_id, seq) UNIQUE
      // constraint to mirror the legacy append-only semantics (idempotent on
      // identical id+seq; new events always advance seq).
      const result = db.prepare(
        `INSERT OR IGNORE INTO trajectory_events (id, run_id, seq, type, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        event.id,
        runId,
        event.sequence,
        event.type,
        jsonify(event),
        event.createdAt,
      );
      if (result.changes !== 1) {
        const existing = db
          .prepare("SELECT payload FROM trajectory_events WHERE id = ?")
          .get(event.id) as { payload?: string } | undefined;
        if (!existing || existing.payload !== jsonify(event)) {
          throw new Error(
            `Trajectory sequence collision for run ${runId} at ${event.sequence}.`,
          );
        }
      }
      return event;
    },

    appendTrajectoryIfAbsent(runId, event) {
      const result = db.prepare(
        `INSERT OR IGNORE INTO trajectory_events (id, run_id, seq, type, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        event.id,
        runId,
        event.sequence,
        event.type,
        jsonify(event),
        event.createdAt,
      );
      return result.changes === 1;
    },

    appendTrajectoryPublication(runId, publicationKey, event) {
      const row = db.prepare(
        `INSERT INTO trajectory_events (id, run_id, seq, type, payload, created_at)
         SELECT
           ?,
           ?,
           (SELECT COALESCE(MAX(seq), 0) + 1
              FROM trajectory_events
             WHERE run_id = ?),
           ?,
           json_set(
             ?,
             '$.sequence',
             (SELECT COALESCE(MAX(seq), 0) + 1
                FROM trajectory_events
               WHERE run_id = ?)
           ),
           ?
         WHERE NOT EXISTS (
           SELECT 1
             FROM trajectory_events
            WHERE run_id = ?
              AND json_extract(payload, '$.payload.publicationKey') = ?
         )
         RETURNING payload`,
      ).get<{ payload: string }>(
        event.id,
        runId,
        runId,
        event.type,
        jsonify(event),
        runId,
        event.createdAt,
        runId,
        publicationKey,
      );
      if (row) {
        const stored = parseJson<AgentTrajectoryEvent>(row.payload);
        if (!stored) {
          throw new Error(
            `Stored trajectory publication for run ${runId} is invalid.`,
          );
        }
        return { appended: true, event: stored };
      }

      const existing = db.prepare(
        `SELECT payload
           FROM trajectory_events
          WHERE run_id = ?
            AND json_extract(payload, '$.payload.publicationKey') = ?
          ORDER BY seq ASC
          LIMIT 1`,
      ).get<{ payload: string }>(runId, publicationKey);
      const stored = existing
        ? parseJson<AgentTrajectoryEvent>(existing.payload)
        : null;
      if (!stored) {
        throw new Error(
          `Trajectory publication ${publicationKey} for run ${runId} was not inserted or found.`,
        );
      }
      return { appended: false, event: stored };
    },

    getTrajectory(
      runId: string,
      opts?: { fromSeq?: number },
    ): AgentTrajectoryEvent[] {
      const fromSeq = opts?.fromSeq ?? 0;
      const rows = db
        .prepare(
          `SELECT payload FROM trajectory_events
           WHERE run_id = ? AND seq >= ?
           ORDER BY seq ASC`,
        )
        .all<{ payload: string }>(runId, fromSeq);
      return rows
        .map((r) => parseJson<AgentTrajectoryEvent>(r.payload))
        .filter((v): v is AgentTrajectoryEvent => v !== null);
    },
  };
}

export function createTrajectoryRepository(storage: Storage): TrajectoryRepository {
  const db = storage.db;

  function buildWhere(
    runId: string | undefined,
    types: AgentTrajectoryEventType[] | undefined,
  ): { clause: string; params: unknown[] } {
    const parts: string[] = [];
    const params: unknown[] = [];
    if (runId) {
      parts.push("run_id = ?");
      params.push(runId);
    }
    if (types && types.length) {
      const placeholders = types.map(() => "?").join(",");
      parts.push(`type IN (${placeholders})`);
      params.push(...types);
    }
    return { clause: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
  }

  return {
    getTrajectory(
      runId: string,
      opts?: { fromSeq?: number; types?: AgentTrajectoryEventType[] },
    ): AgentTrajectoryEvent[] {
      const fromSeq = opts?.fromSeq ?? 0;
      const types = opts?.types;
      if (types && types.length) {
        const placeholders = types.map(() => "?").join(",");
        return selectPayloadRows<AgentTrajectoryEvent>(
          db,
          `SELECT payload FROM trajectory_events
           WHERE run_id = ? AND seq >= ? AND type IN (${placeholders})
           ORDER BY seq ASC`,
          [runId, fromSeq, ...types],
        );
      }
      return selectPayloadRows<AgentTrajectoryEvent>(
        db,
        `SELECT payload FROM trajectory_events
         WHERE run_id = ? AND seq >= ? ORDER BY seq ASC`,
        [runId, fromSeq],
      );
    },

    scanByTypes(
      types: AgentTrajectoryEventType[],
      opts?: { runId?: string; limit?: number },
    ): AgentTrajectoryEvent[] {
      const limit = opts?.limit ?? 1000;
      const { clause, params } = buildWhere(opts?.runId, types);
      return selectPayloadRows<AgentTrajectoryEvent>(
        db,
        `SELECT payload FROM trajectory_events ${clause} ORDER BY created_at ASC LIMIT ?`,
        [...params, limit],
      );
    },
  };
}
