// Storage service (contracts v1.4 §1.3).
//
// Opens a better-sqlite3 database at `dbPath`, enables WAL + foreign_keys,
// self-checks FTS5, and runs versioned SQL migrations from `./migrations`.
// Repository implementations in `./repositories/*` consume `storage.db`.

import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  Storage,
  StorageDatabase,
} from "../../shared/storageContract";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { BUNDLED_MIGRATIONS } from "./migrationBundle";

const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS __zerox_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`;

function assertFts5Enabled(db: BetterSqlite3Database): void {
  const row = db
    .prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS ok")
    .get() as { ok: number } | undefined;
  if (!row || row.ok !== 1) {
    throw new Error(
      "zerox.db: FTS5 is not enabled in this better-sqlite3 build; memory search requires FTS5. Rebuild better-sqlite3 with FTS5 support.",
    );
  }
}

interface MigrationFile {
  name: string;
  ordinal: number;
  sql: string;
  sha256: string;
}

function loadMigrations(): MigrationFile[] {
  return BUNDLED_MIGRATIONS.map((m) => ({
    name: m.name,
    ordinal: m.ordinal,
    sql: m.sql,
    sha256: createHash("sha256").update(m.sql).digest("hex"),
  })).sort((a, b) => a.ordinal - b.ordinal);
}

export interface CreateStorageOptions {
  dbPath: string;
  /** Skip FTS5 self-check (tests with a non-FTS5 build). Defaults to false. */
  skipFts5Check?: boolean;
}

export function createStorageImpl(opts: CreateStorageOptions): Storage {
  // Ensure the parent directory exists (Electron userData/config may not yet).
  if (opts.dbPath !== ":memory:") {
    const parent = path.dirname(opts.dbPath);
    try {
      // Synchronous mkdir to keep createStorageImpl synchronous (contract §1.3
      // Storage is created before any async migrate()).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:fs").mkdirSync(parent, { recursive: true });
    } catch {
      // Ignore; better-sqlite3 will surface a clearer error if truly missing.
    }
  }
  const db = new Database(opts.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");

  if (!opts.skipFts5Check) {
    assertFts5Enabled(db);
  }

  // Ensure the migrations ledger exists before any migration runs.
  db.exec(MIGRATIONS_TABLE);

  let migrated = false;
  let pendingMigrations: MigrationFile[] | null = null;

  const runMigrations = (): void => {
    if (migrated) return;
    const list = pendingMigrations;
    if (!list) return;
    const applied = new Set(
      (db.prepare("SELECT name FROM __zerox_migrations").all() as { name: string }[]).map(
        (r) => r.name,
      ),
    );
    const apply = db.transaction(() => {
      for (const migration of list) {
        if (applied.has(migration.name)) continue;
        db.exec(migration.sql);
        db.prepare(
          "INSERT INTO __zerox_migrations (name, sha256, applied_at) VALUES (?, ?, ?)",
        ).run(migration.name, migration.sha256, new Date().toISOString());
      }
    });
    apply();
    migrated = true;
  };

  // Eagerly run migrations at construction. better-sqlite3 is synchronous, so
  // the schema is guaranteed ready before any repository write — this avoids a
  // race where a dual-write store writes before a fire-and-forget migration
  // completes. `migrate()` remains available (idempotent) for explicit callers.
  pendingMigrations = loadMigrations();
  runMigrations();

  const storage: Storage = {
    get db(): StorageDatabase {
      return db as unknown as StorageDatabase;
    },
    async migrate(): Promise<void> {
      if (!pendingMigrations) {
        pendingMigrations = loadMigrations();
      }
      runMigrations();
    },
    async backup(): Promise<string> {
      const backupPath = `${opts.dbPath}.bak`;
      // better-sqlite3 backup API returns a promise when no callback is given.
      await (db.backup(backupPath) as unknown as Promise<unknown>);
      return backupPath;
    },
    close(): void {
      db.close();
    },
  };

  return storage;
}

/**
 * Open an in-memory storage for tests. Migrations are loaded and applied
 * eagerly so each repository test starts from a known schema.
 */
export async function createInMemoryStorage(): Promise<Storage> {
  const storage = createStorageImpl({ dbPath: ":memory:", skipFts5Check: false });
  await storage.migrate();
  return storage;
}

/** Convenience: create a temp-file-backed storage with migrations applied. */
export async function createTempFileStorage(tempDir: string): Promise<Storage> {
  await mkdir(tempDir, { recursive: true });
  const dbPath = path.join(tempDir, `zerox-${randomUUID()}.db`);
  const storage = createStorageImpl({ dbPath });
  await storage.migrate();
  return storage;
}

// Re-export for callers that want the concrete factory name from the contract.
export { createStorageImpl as createStorage };
