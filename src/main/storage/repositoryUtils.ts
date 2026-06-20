// Shared helpers for repository implementations over better-sqlite3.
//
// All domain tables store the full record as a JSON `payload` TEXT column
// (perfect parity with the legacy JSON stores) alongside denormalized indexed
// columns. These helpers centralize (de)serialization and column mapping so
// each repository stays small and the parity invariant is in one place.

import type { StorageDatabase } from "../../shared/storageContract";

export function jsonify(value: unknown): string {
  return JSON.stringify(value);
}

export function parseJson<T>(text: string | null | undefined): T | null {
  if (text === null || text === undefined || text === "") return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Format a Date or string as ISO. Accepts undefined -> now (frozen in tests). */
export function iso(value: Date | string | undefined, now: () => string): string {
  if (value === undefined) return now();
  return value instanceof Date ? value.toISOString() : value;
}

/** Run a SELECT and parse each row's `payload` column into T. */
export function selectPayloadRows<T>(
  db: StorageDatabase,
  sql: string,
  params: unknown[] = [],
): T[] {
  return db
    .prepare(sql)
    .all<{ payload: string }>(...params)
    .map((row) => parseJson<T>(row.payload) as T)
    .filter((v): v is T => v !== null);
}

/** Get a single row and parse its `payload` column into T (or null). */
export function getPayloadRow<T>(
  db: StorageDatabase,
  sql: string,
  params: unknown[] = [],
): T | null {
  const row = db.prepare(sql).get<{ payload: string }>(...params);
  if (!row) return null;
  return parseJson<T>(row.payload);
}
