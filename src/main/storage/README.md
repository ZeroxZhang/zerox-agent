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
| `json`   | complete JSON/JSONL coverage | JSON | safe default |
| `sqlite` | SQLite only       | SQLite  | cutover target |
| `dual`   | SQLite + JSON shadow for converted stores | SQLite | explicit transition mode |

Invalid/unset values fall back to `json` with a warning because it is the only
backend covering every core domain store.

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
node scripts/rollback-sqlite-to-json.mjs --configDir <userData>/config --confirmSqliteAuthoritative
export ZEROX_STORAGE_BACKEND=json
```

The confirmation flag is intentionally required: v3.7.0 defaults to JSON, so
an unverified SQLite export could otherwise replace newer authoritative JSON.
Existing JSON files are moved to unique `.legacy*` backups before export.

Migration errors are appended to `<configDir>/migration-errors.jsonl` and do not
abort the overall run.

## Native module note

`better-sqlite3` is a native module. For the Electron runtime,
`scripts/package-mac.mjs` rebuilds it against the Electron ABI before packaging
and restores the Node ABI afterward. Under vitest/Node the restored Node binary
is used directly. The FTS5 compile option is self-checked at startup.

## Native-module ABI swap caveat

`better-sqlite3` is a native module. Two ABIs are in play:
- **Node ABI** — used by `npm test` / vitest.
- **Electron ABI** — used by `electron .` and the packaged app.

`npm run dist:mac` and `npm run pack:mac` rebuild better-sqlite3 against the
**Electron** ABI before invoking electron-builder, then run
`npm rebuild better-sqlite3` to restore the **Node** ABI for local tests. The
container's fault-tolerant `storage()` singleton falls back to the JSON backend
if the native module fails to load, so the app still starts, but the SQLite path
is the production target.
