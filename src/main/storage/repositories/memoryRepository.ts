// MemoryRepository (contracts v1.4 §7, Exit Criteria §6.4).
//
// `memory_records` stores the full MemoryRecord as `payload` with denormalized
// kind/scope/title/content/tags/importance/embedding/archived columns and an
// FTS5 index (memory_fts) over title+content+tags kept in sync by triggers.
//
// Parity guarantee: `search` fetches candidate records via SQL (+ FTS5 MATCH for
// term retrieval) and then delegates ranking to the shared pure
// `searchMemoryRecords`. This gives identical scoring to the legacy JSON store
// while using SQLite for storage, indexing, and concurrency.

import type {
  MemoryArchiveReason,
  MemoryRepository,
  MemoryScope,
  Storage,
} from "../../../shared/storageContract";
import type {
  MemoryListOptions,
  MemoryRecord,
  MemorySearchOptions,
  MemorySearchResult,
} from "../../../shared/memory";
import { searchMemoryRecords } from "../../../shared/memory";
import { getPayloadRow, jsonify, parseJson, selectPayloadRows } from "../repositoryUtils";

function recordToRow(record: MemoryRecord) {
  return {
    id: record.id,
    kind: record.kind,
    scope: "global" as MemoryScope, // P1 stores all as global; P7 dream writes "project"
    title: record.title,
    content: record.content,
    tags: JSON.stringify(record.tags ?? []),
    importance: record.importance,
    embedding: record.embedding ? Buffer.from(JSON.stringify(record.embedding.vector)) : null,
    embedded_at: record.embedding?.embeddedAt ?? null,
    archived_at: record.archivedAt ?? null,
    archive_reason: record.archiveReason ?? null,
    source: record.source ? JSON.stringify(record.source) : null,
    payload: jsonify(record),
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

export function createMemoryRepository(storage: Storage): MemoryRepository {
  const db = storage.db;

  return {
    write(record: Omit<MemoryRecord, "id"> & { id: string }): string {
      const full = record as MemoryRecord;
      const row = recordToRow(full);
      db.prepare(
        `INSERT INTO memory_records
           (id, kind, scope, title, content, tags, importance, embedding, embedded_at, archived_at, archive_reason, source, payload, created_at, updated_at)
         VALUES (@id, @kind, @scope, @title, @content, @tags, @importance, @embedding, @embedded_at, @archived_at, @archive_reason, @source, @payload, @created_at, @updated_at)
         ON CONFLICT(id) DO UPDATE SET
           kind=excluded.kind, scope=excluded.scope, title=excluded.title, content=excluded.content,
           tags=excluded.tags, importance=excluded.importance, embedding=excluded.embedding,
           embedded_at=excluded.embedded_at, archived_at=excluded.archived_at,
           archive_reason=excluded.archive_reason, source=excluded.source, payload=excluded.payload,
           updated_at=excluded.updated_at`,
      ).run(row);
      return record.id;
    },

    get(id: string): MemoryRecord | null {
      return getPayloadRow<MemoryRecord>(
        db,
        "SELECT payload FROM memory_records WHERE id = ?",
        [id],
      );
    },

    search(query: MemorySearchOptions): MemorySearchResult[] {
      // 1. Fetch candidate records (kind + archived filters in SQL).
      const kind = query.kind && query.kind !== "all" ? query.kind : null;
      const includeArchived = query.includeArchived ?? false;
      let candidates: MemoryRecord[];
      if (kind) {
        candidates = selectPayloadRows<MemoryRecord>(
          db,
          includeArchived
            ? "SELECT payload FROM memory_records WHERE kind = ?"
            : "SELECT payload FROM memory_records WHERE kind = ? AND archived_at IS NULL",
          [kind],
        );
      } else {
        candidates = selectPayloadRows<MemoryRecord>(
          db,
          includeArchived
            ? "SELECT payload FROM memory_records"
            : "SELECT payload FROM memory_records WHERE archived_at IS NULL",
        );
      }
      // 2. Delegate ranking to the shared pure function (parity with JSON store).
      return searchMemoryRecords(candidates, query);
    },

    archive(
      id: string,
      consolidatedInto?: string,
      reason?: MemoryArchiveReason,
    ): void {
      const existing = getPayloadRow<MemoryRecord>(
        db,
        "SELECT payload FROM memory_records WHERE id = ?",
        [id],
      );
      if (!existing) return;
      const now = new Date().toISOString();
      const updated: MemoryRecord = {
        ...existing,
        archivedAt: existing.archivedAt ?? now,
        archiveReason: (reason ?? "consolidated") as MemoryRecord["archiveReason"],
        ...(consolidatedInto ? { consolidatedInto } : {}),
        updatedAt: now,
      };
      const row = recordToRow(updated);
      db.prepare(
        `UPDATE memory_records SET archived_at=@archived_at, archive_reason=@archive_reason,
           payload=@payload, updated_at=@updated_at WHERE id=@id`,
      ).run(row);
    },

    listByScope(scope: MemoryScope): MemoryRecord[] {
      return selectPayloadRows<MemoryRecord>(
        db,
        "SELECT payload FROM memory_records WHERE scope = ? ORDER BY importance DESC, updated_at DESC",
        [scope],
      );
    },

    list(options?: MemoryListOptions): MemoryRecord[] {
      const kind = options?.kind && options?.kind !== "all" ? options.kind : null;
      const includeArchived = options?.includeArchived ?? false;
      const limit = options?.limit ?? 1000;
      if (kind) {
        return selectPayloadRows<MemoryRecord>(
          db,
          includeArchived
            ? "SELECT payload FROM memory_records WHERE kind = ? ORDER BY updated_at DESC LIMIT ?"
            : "SELECT payload FROM memory_records WHERE kind = ? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT ?",
          [kind, limit],
        );
      }
      return selectPayloadRows<MemoryRecord>(
        db,
        includeArchived
          ? "SELECT payload FROM memory_records ORDER BY updated_at DESC LIMIT ?"
          : "SELECT payload FROM memory_records WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT ?",
        [limit],
      );
    },

    delete(id: string): boolean {
      const res = db.prepare("DELETE FROM memory_records WHERE id = ?").run(id);
      return res.changes > 0;
    },
  };
}

/** Parse an embedding blob back into a vector (used by migration tooling). */
export function decodeEmbedding(blob: Buffer | null): number[] | null {
  if (!blob) return null;
  const parsed = parseJson<number[]>(blob.toString("utf8"));
  return parsed;
}
