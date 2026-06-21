## Status

DONE

## Changed files

- `src/main/tools/toolWorker.ts`
- `src/main/container.ts`
- `src/main/smokeMode.ts`
- `package.json`
- `src/main/tools/toolWorker.test.ts`
- `src/main/container.test.ts`
- `src/main/smokeMode.test.ts`
- `src/shared/packageScripts.test.ts`
- `.zerox/progress.md`
- `.superpowers/sdd/task-6-report.md`

## RED evidence

- `npm test -- src/main/container.test.ts src/main/tools/toolWorker.test.ts` failed as expected:
  - `container.toolWorker` was `undefined`, proving production container wiring did not expose the worker path.
  - A timed-out stuck subprocess caused the next `echo` request to return `{ ok: false }`, proving the child was not recycled.
- `npm test -- src/main/smokeMode.test.ts` failed as expected because the renderer readiness script contained `const timeoutMs = 4000;` instead of the configured `2500`.
- `npm test -- src/shared/packageScripts.test.ts` failed as expected because `eval:agent:built`, `eval:memory:built`, `harness:score:built`, `episode:export:built`, and `smoke:prod:built` were absent.
- `npm test -- src/main/storage/migrateRoundTrip.test.ts` passed before Task 6 edits. Task 2 had already improved this coverage: the test creates a fresh temporary script root, compiles `tsconfig.electron.json` into that root, asserts the built `storageDb.js` exists, then runs migrate/rollback scripts from there. No migration test edit was needed for Task 6.

## GREEN evidence

- `npm test -- src/main/container.test.ts src/main/tools/toolWorker.test.ts` -> 2 files / 17 tests passed.
- `npm test -- src/main/smokeMode.test.ts` -> 1 file / 11 tests passed.
- `npm test -- src/shared/packageScripts.test.ts` -> 1 file / 8 tests passed.
- `npm test -- src/main/storage/migrateRoundTrip.test.ts` -> 1 file / 1 test passed.
- `npm test -- src/main/container.test.ts src/main/tools/toolWorker.test.ts src/main/smokeMode.test.ts src/shared/packageScripts.test.ts` -> 4 files / 36 tests passed.
- `npm run harness:check` -> passed.
- First `npm run verify` exposed a too-tight 50 ms timeout in the new worker recycling test under full-suite load. The test timeout was widened to 500 ms while preserving the stuck-child regression signal.
- Fresh `npm run verify` -> 165 files / 1077 tests passed; build passed; agent eval 26/26; memory eval 2/2.
- `npm run smoke:prod` -> passed; renderer rendered agent chat UI. The local better-sqlite3 binary had the expected Electron ABI mismatch and the app fell back to JSON storage.
- Built variant spot checks:
  - `npm run eval:agent:built` -> 26/26 passed.
  - `npm run eval:memory:built` -> 2/2 passed.
  - `npm run harness:score:built` -> score 9.26, tone `good`.
  - `npm run episode:export:built -- --help` -> passed.
  - `npm run smoke:prod:built` -> passed with expected SQLite ABI fallback.

## Implementation notes

- `ZEROX_TOOL_WORKER=subprocess` now reaches `createToolWorker({ mode: "subprocess" })` through `createAppContainer().toolWorker()`. Explicit `ZEROX_TOOL_WORKER=inproc` remains available.
- Subprocess worker timeout handling now retires the child that owned the timed-out request, clears it from the active slot, sends SIGTERM with a SIGKILL fallback, and tracks pending requests by owning child so an old child exit cannot reject new-child requests.
- The smoke renderer readiness script now embeds `SmokeModeOptions.timeoutMs`, which is already parsed from `BUILDING_AGENT_SMOKE_TIMEOUT_MS`.
- Existing safe wrappers still build first. New `:built` variants run against an already-built `dist-electron` / `dist` tree.

## Residual risk

- The subprocess worker entry still only includes the current registered worker-entry handlers; broader side-effect handler cutover remains owned by later P5/P6-style activation work.
- `episode:export:built` requires normal CLI arguments for real export work; this task verified the built script path via `--help` rather than exporting a real episode.
