# Zerox Storage Layer (P97 - SQLite authority)

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
- `migrations/0004_*.sql` through `0006_*.sql` — Goal/checkpoint CAS,
  reviewed learning/eval identity, and durable per-domain authority markers.
- `repositories/` — one repository per table, implementing the frozen interfaces
  in `src/shared/storageContract.ts` (synchronous API). Downstream phases
  (P2/P5/P6/P7) consume these directly.
- `backendResolver.ts` — reads `ZEROX_STORAGE_BACKEND` (`json` | `sqlite` | `dual`).
- `domainAuthorityBootstrap.ts` — atomically imports each legacy JSON domain
  once, then records its durable authority marker.
- `repositoryUtils.ts` — JSON payload (de)serialization helpers (parity invariant).

## Backend flag

`ZEROX_STORAGE_BACKEND` (env only, never `modelSettingsStore`):

| value    | writes            | reads   | use |
|----------|-------------------|---------|-----|
| `json`   | JSON/JSONL in backend-switched domains | JSON/JSONL | explicit rollback and diagnosis |
| `sqlite` | SQLite | SQLite | release default |
| `dual`   | SQLite, then tracked JSON shadow | SQLite | explicit compatibility mode |

Invalid or unset values resolve to `sqlite`. If the native SQLite module cannot
open, `sqlite` and `dual` fail startup instead of writing a divergent JSON
authority. JSON writes require the explicit `json` backend.

Chat remains on its independently completed SQLite event/projection cutover
when native SQLite is available; P97 does not regress that boundary.

Chat, Run, Trajectory, Task, Validation, MemoryProfile, ToolAudit, Goal,
execution checkpoints, Memory, Workspace, Multi-Agent Session, reviewed
Learning, Eval Candidate, and promoted eval fixtures are SQLite-authoritative
under the release default. Plan is SQLite-authoritative in SQLite mode.

Encrypted model settings, scoped tool-result blobs, workspace-run ledgers, raw
history, and artifact payloads remain explicit file-backed boundaries. Their
presence does not make a structured runtime domain JSON-authoritative.

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
# Normal startup imports each legacy JSON domain once and records a marker.
# Use the CLI for offline verification or an explicit maintenance migration.
node scripts/migrate-to-sqlite.mjs --configDir <userData>/config --verify

# SQLite is the default. This override is optional.
export ZEROX_STORAGE_BACKEND=sqlite

# Roll back to JSON if needed (freezes existing JSON as *.legacy.json).
node scripts/rollback-sqlite-to-json.mjs --configDir <userData>/config --confirmSqliteAuthoritative --planBackend sqlite
export ZEROX_STORAGE_BACKEND=json
```

The confirmation flag is intentionally required. `--planBackend sqlite` is
required only when Plan actually used SQLite. Rollback stages every exported
domain before commit and restores prior files if any publish step fails. Import
rejects a conflicting SQLite generation that is at least as new as its JSON
source.

Migration errors are appended to `<configDir>/migration-errors.jsonl`;
`--verify` exits nonzero on parse, write, conflict, or canonical mismatch.

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
`npm rebuild better-sqlite3` to restore the **Node** ABI for local tests. A
native-module load failure is fatal in `sqlite` or `dual` mode so the
application cannot fork authority into stale JSON files.
