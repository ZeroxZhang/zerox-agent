# Task 2 Report: SQLite, Migration, And JSONL Recovery Integrity

## Status

DONE

## Changed Files

- `src/main/taskStore.ts`
- `src/main/toolAuditLog.ts`
- `src/main/jsonlRecovery.ts`
- `src/main/storage/repositories/index.ts`
- `src/main/storage/repositories/sessionRepository.ts`
- `src/main/workspaceRunStore.ts`
- `src/main/agentRunStore.ts`
- `src/main/agentTrajectoryStore.ts`
- `src/main/agentGoalStore.ts`
- `scripts/migrate-to-sqlite.mjs`
- `scripts/rollback-sqlite-to-json.mjs`
- `src/main/storage/storeProxy.test.ts`
- `src/main/toolAuditLog.test.ts`
- `src/main/storage/migrateRoundTrip.test.ts`
- `src/main/storage/repositories/repositories.test.ts`
- `src/main/workspaceRunStore.test.ts`
- `src/main/agentRunStore.test.ts`
- `src/main/agentTrajectoryStore.test.ts`
- `src/main/agentGoalStore.test.ts`
- `.zerox/progress.md`

## RED Evidence

- `npm test -- src/main/storage/storeProxy.test.ts src/main/toolAuditLog.test.ts` failed: returned audit events did not match persisted SQLite/dual events; disabled daily tasks reloaded with new timestamps and non-null `nextRunAt`.
- `npm test -- src/main/storage/repositories/repositories.test.ts src/main/chatSessionStore.test.ts` failed: SQLite chat search returned no result for `报告 markdown`.
- `npm test -- src/main/workspaceRunStore.test.ts src/main/agentRunStore.test.ts src/main/agentTrajectoryStore.test.ts src/main/agentGoalStore.test.ts` failed: malformed JSONL lines threw `SyntaxError`.
- `npm test -- src/main/storage/migrateRoundTrip.test.ts` failed: migrated learning candidates regenerated `id`, reset `status` to `pending_review`, and rewrote timestamps.

## GREEN Evidence

- `npm test -- src/main/storage/storeProxy.test.ts src/main/toolAuditLog.test.ts` -> 2 files / 21 tests passed.
- `npm test -- src/main/storage/repositories/repositories.test.ts src/main/chatSessionStore.test.ts` -> 2 files / 31 tests passed.
- `npm test -- src/main/workspaceRunStore.test.ts src/main/agentRunStore.test.ts src/main/agentTrajectoryStore.test.ts src/main/agentGoalStore.test.ts` -> 4 files / 25 tests passed.
- `npm run build` -> passed, producing fresh `dist-electron` for migration script tests.
- `npm test -- src/main/storage/migrateRoundTrip.test.ts` -> 1 file / 1 test passed.
- `npm test -- src/main/storage/storeProxy.test.ts src/main/toolAuditLog.test.ts src/main/storage/migrateRoundTrip.test.ts src/main/storage/repositories/repositories.test.ts src/main/storage/repositories/runRepository.test.ts src/main/chatSessionStore.test.ts src/main/workspaceRunStore.test.ts src/main/agentRunStore.test.ts src/main/agentTrajectoryStore.test.ts src/main/agentGoalStore.test.ts` -> 10 files / 86 tests passed.
- `npm test` -> 164 files / 1046 tests passed.
- `npm run verify` -> 164 files / 1046 tests passed; build passed; agent eval 26/26; memory eval 2/2.
- `npm run smoke:prod` -> passed; renderer rendered agent chat UI, with designed JSON fallback for the local better-sqlite3 ABI mismatch.
- `npm run harness:check` -> passed.
- `git diff --check` -> passed.

## Implementation Notes

- SQLite task creation now persists the JSON-built task record, preserving `id`, timestamps, enabled state, `lastRunAt`, and `nextRunAt`; repository `recordRun` and `setEnabled` keep disabled tasks unscheduled.
- Tool audit SQLite/dual mode now persists the exact event returned from `append()`, including caller-supplied id/timestamp generation from the store.
- Learning repository creation preserves existing reviewed-learning identity, status, timestamps, claim, evidence ids, and recommended action when migrating legacy candidates.
- Added `readRecoverableJsonl()` and reused it in append-only run, trajectory, workspace-run, and goal-ledger readers. Bad lines are skipped and written to `*.corrupt-lines-<timestamp>.jsonl` evidence files.
- SQLite chat search now tokenizes/scores like the JSON store and returns the original payload message id when present.
- Migration now skips malformed JSONL lines individually and preserves full learning candidates; rollback now exports imported workspaces, tasks, tool results, learning candidates, eval candidates, promoted fixtures, artifact provenance sidecars, and multi-agent sessions.

## Residual Risk

- Rollback reconstructs artifact provenance sidecars from `manifest.destination.path`; the migration schema does not retain the original sidecar file path separately.
- JSONL corrupt-line evidence is best-effort: evidence write failures are intentionally swallowed so recovery reads remain available.
