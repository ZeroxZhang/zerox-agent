// CheckpointRepository (contracts v1.4 §1.3 / §4, Exit Criteria §6.3).
//
// Unifies the legacy `agentExecutionStore` (runtime checkpoints, one JSON per
// run) and `kernel/checkpointStore` (kernel checkpoints, sharded by run) under
// one `checkpoints` table keyed by (run_id, kind, created_at). `markdown` kind
// is reserved for P5's checkpoint-writer fork agent (and P2's transition writer).

import type {
  CheckpointKind,
  CheckpointRecord,
  CheckpointRepository,
  Storage,
} from "../../../shared/storageContract";
import { jsonify, parseJson } from "../repositoryUtils";
import { randomUUID } from "node:crypto";
import {
  isTerminalExecutionStatus,
  type AgentExecutionCheckpoint,
} from "../../../shared/agentExecution";

const TERMINAL_STATUSES = new Set([
  "done",
  "completed",
  "succeeded",
  "failed",
  "canceled",
  "stopped",
  "achieved",
]);

function isTerminalStatus(status: string | undefined | null): boolean {
  if (!status) return false;
  return TERMINAL_STATUSES.has(status);
}

export function createCheckpointRepository(storage: Storage): CheckpointRepository {
  const db = storage.db;

  function extractStatus(data: unknown): string | null {
    if (data && typeof data === "object" && "status" in data) {
      const s = (data as { status: unknown }).status;
      return typeof s === "string" ? s : null;
    }
    return null;
  }

  function writeCheckpoint(
    runId: string,
    kind: CheckpointKind,
    data: unknown,
  ): string {
    const id = randomUUID();
    const ref = `checkpoints/${runId}/${id}`;
    const createdAt = new Date().toISOString();
    const status = extractStatus(data);
    db.prepare(
      `INSERT INTO checkpoints (id, run_id, kind, ref, status, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, runId, kind, ref, status, jsonify(data), createdAt);
    return ref;
  }

  function latestRuntime(runId: string): AgentExecutionCheckpoint | null {
    const record = latestCheckpoint(runId, "runtime");
    if (!record?.payload || typeof record.payload !== "object") return null;
    const checkpoint = record.payload as AgentExecutionCheckpoint;
    return checkpoint?.runId === runId ? checkpoint : null;
  }

  function latestCheckpoint(
    runId: string,
    kind?: CheckpointKind,
  ): CheckpointRecord | null {
    const row = kind
      ? db
          .prepare(
            "SELECT id, run_id, kind, ref, payload, created_at FROM checkpoints WHERE run_id = ? AND kind = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
          )
          .get(runId, kind)
      : db
          .prepare(
            "SELECT id, run_id, kind, ref, payload, created_at FROM checkpoints WHERE run_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
          )
          .get(runId);
    if (!row) return null;
    const record = row as {
      id: string;
      run_id: string;
      kind: string;
      ref: string;
      payload: string;
      created_at: string;
    };
    return {
      id: record.id,
      runId: record.run_id,
      kind: record.kind as CheckpointKind,
      ref: record.ref,
      payload: parseJson(record.payload),
      createdAt: record.created_at,
    };
  }

  const writeRuntime = db.transaction(
    (checkpoint: AgentExecutionCheckpoint): AgentExecutionCheckpoint => {
      const existing = latestRuntime(checkpoint.runId);
      if (existing && isTerminalExecutionStatus(existing.status)) {
        return existing;
      }
      writeCheckpoint(checkpoint.runId, "runtime", checkpoint);
      return checkpoint;
    },
  );

  return {
    write(runId: string, kind: CheckpointKind, data: unknown): string {
      return writeCheckpoint(runId, kind, data);
    },

    writeRuntime,

    latestRuntime,

    listActiveRuntime() {
      return this.listActive()
        .map((record) => {
          const checkpoint = record.payload as AgentExecutionCheckpoint;
          return checkpoint.runId === record.runId ? checkpoint : null;
        })
        .filter(
          (checkpoint): checkpoint is AgentExecutionCheckpoint =>
            checkpoint !== null &&
            !isTerminalExecutionStatus(checkpoint.status),
        );
    },

    deleteRuntime(runId) {
      return this.delete(runId, "runtime");
    },

    latest(runId: string, kind?: CheckpointKind): CheckpointRecord | null {
      return latestCheckpoint(runId, kind);
    },

    list(runId: string): CheckpointRecord[] {
      const rows = db
        .prepare(
          "SELECT id, run_id, kind, ref, payload, created_at FROM checkpoints WHERE run_id = ? ORDER BY created_at ASC, rowid ASC",
        )
        .all(runId) as Array<{
        id: string;
        run_id: string;
        kind: string;
        ref: string;
        payload: string;
        created_at: string;
      }>;
      return rows.map((r) => ({
        id: r.id,
        runId: r.run_id,
        kind: r.kind as CheckpointKind,
        ref: r.ref,
        payload: parseJson(r.payload),
        createdAt: r.created_at,
      }));
    },

    read<T = unknown>(ref: string): T | null {
      const row = db
        .prepare("SELECT payload FROM checkpoints WHERE ref = ?")
        .get<{ payload: string }>(ref);
      if (!row) return null;
      return parseJson<T>(row.payload);
    },

    listActive(): CheckpointRecord[] {
      // Mirror agentExecutionStore.listActive: the LATEST runtime checkpoint per
      // run, filtered to non-terminal statuses. (The legacy store has one
      // execution per run; here we take the newest runtime row per run_id.)
      const rows = db
        .prepare(
          `SELECT c.id, c.run_id, c.kind, c.ref, c.payload, c.created_at, c.status
           FROM checkpoints c
           WHERE c.kind = 'runtime'
             AND c.rowid = (
               SELECT MAX(c2.rowid) FROM checkpoints c2
               WHERE c2.run_id = c.run_id AND c2.kind = 'runtime'
             )
           ORDER BY c.created_at DESC, c.rowid DESC`,
        )
        .all() as Array<{
        id: string;
        run_id: string;
        kind: string;
        ref: string;
        payload: string;
        created_at: string;
        status: string | null;
      }>;
      return rows
        .filter((r) => !isTerminalStatus(r.status))
        .map((r) => ({
          id: r.id,
          runId: r.run_id,
          kind: r.kind as CheckpointKind,
          ref: r.ref,
          payload: parseJson(r.payload),
          createdAt: r.created_at,
        }));
    },

    delete(runId: string, kind?: CheckpointKind): boolean {
      const res = kind
        ? db
            .prepare(
              "DELETE FROM checkpoints WHERE run_id = ? AND kind = ?",
            )
            .run(runId, kind)
        : db.prepare("DELETE FROM checkpoints WHERE run_id = ?").run(runId);
      return res.changes > 0;
    },
  };
}
