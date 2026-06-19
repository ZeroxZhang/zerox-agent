# Zerox Storage Layer (P1 — SQLite unified storage)

This module implements the `contracts v1.4 §1` Storage contract: a SQLite
(better-sqlite3, synchronous) backend with versioned migrations, repository
interfaces, and a dual-write migration path off the legacy JSON/JSONL stores.

## Layout

- `storageDb.ts` — `Storage` service: opens `zerox.db`, WAL + foreign_keys,
  FTS5 self-check, eager idempotent migrations, `backup()`.
- `migrationBundle.ts` — embedded migration SQL (regenerated from
  `migrations/*.sql` via `node scripts/sync-migration-bundle.mjs`).
- `migrations/0000_initial.sql` — canonical initial schema (all contract §1.2
  tables + v1.1 patch tables + FTS5 + triggers + indexes).
- `repositories/` — one repository per table, implementing the frozen interfaces
  in `src/shared/storageContract.ts` (synchronous API). Downstream phases
  (P2/P5/P6/P7) consume these directly.
- `backendResolver.ts` — reads `ZEROX_STORAGE_BACKEND` (`json` | `sqlite` | `dual`).
- `repositoryUtils.ts` — JSON payload (de)serialization helpers (parity invariant).

## Backend flag

`ZEROX_STORAGE_BACKEND` (env only, never `modelSettingsStore`):

| value    | writes            | reads   | use |
|----------|-------------------|---------|-----|
| `json`   | legacy JSON only  | JSON    | rollback / safe default |
| `sqlite` | SQLite only       | SQLite  | cutover target |
| `dual`   | SQLite + JSON shadow (fire-and-forget) | SQLite | transition (default) |

Invalid/unset values fall back to `dual` with a warning.

The container's `storage()` singleton is fault-tolerant: if better-sqlite3
fails to load (e.g. an Electron ABI mismatch before `@electron/rebuild` runs),
the container falls back to `json` and the app still starts.

## Parity invariant

Every domain table stores the full record as a JSON `payload` TEXT column
alongside denormalized indexed columns. This guarantees byte-for-byte round-trip
parity with the legacy JSON stores (no data loss) while gaining indexes,
transactions, WAL concurrency, and FTS5. `MemoryRepository.search` fetches
candidates via SQL and delegates ranking to the shared pure
`searchMemoryRecords`, so search scoring is identical to the JSON store.

The observability hard constraint (contract §1.5) is enforced by
`src/main/storage/runGraphParity.test.ts`: a golden run covering all 11
node/gate-producing trajectory types produces deep-equal `projectRunGraph`
output whether events come from the JSON store or the SQLite repository.

## Schema evolution

- Edit `migrations/0000_initial.sql` (or add `0001_*.sql`).
- Run `node scripts/sync-migration-bundle.mjs` to regenerate `migrationBundle.ts`.
- The `migrationBundle` parity test fails if the bundle drifts from the `.sql` files.
- Never hand-edit `migrationBundle.ts`. Never edit a shipped migration in place;
  add a new numbered migration instead.

## Migration / rollback runbook

```sh
# 1. migrate existing JSON data into zerox.db (idempotent, upserts)
node scripts/migrate-to-sqlite.mjs --configDir <userData>/config --verify

# 2. switch the runtime backend
export ZEROX_STORAGE_BACKEND=sqlite   # or 'dual' for the transition period

# 3. roll back to JSON if needed (freezes existing JSON as *.legacy.json)
node scripts/rollback-sqlite-to-json.mjs --configDir <userData>/config
export ZEROX_STORAGE_BACKEND=json
```

Migration errors are appended to `<configDir>/migration-errors.jsonl` and do not
abort the overall run.

## Native module note

`better-sqlite3` is a native module. For the Electron runtime, rebuild against
the Electron ABI (`@electron/rebuild`) and set `electron-builder.yml:
npmRebuild: true` before packaging (`dist:mac`). Under vitest/Node the prebuilt
binary is used directly. The FTS5 compile option is self-checked at startup.
