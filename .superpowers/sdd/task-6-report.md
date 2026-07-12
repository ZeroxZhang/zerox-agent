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

---

# Goal Acceptance Recovery — Task 6 Report

## Scope

- Added truthful renderer projections for automatic final-acceptance retries, durable acceptance waiting, and manual unverified completion.
- Added distinct `继续验收`, `手动标记完成`, and termination actions for the waiting state.
- Added a local manual-completion confirmation that explicitly says `不会生成机器验收证书`.
- Wired renderer operations to `continueGoalAcceptance` and `markGoalCompletedUnverified`, with a synchronous ref fence against duplicate clicks and canonical returned-goal refresh.
- Added amber/neutral styling for `completed_unverified`; certified presentation remains exclusive to `achieved` with a valid certificate.
- Added the two new status labels to the adjacent sidebar status map required by renderer exhaustiveness.

## RED Evidence

- `npm test -- --run src/renderer/goalProgressViewModel.test.ts`
  - Failed as expected: 7 new assertions failed because retrying still rendered `执行中`, while `waiting_for_acceptance` and `completed_unverified` returned no presentation.
- `npm test -- --run src/renderer/materialDesign.test.ts`
  - Failed as expected: the waiting actions, manual confirmation copy, preload handlers, pending fence, and amber styling were absent.

## GREEN Evidence

- `npm test -- --run src/renderer/goalProgressViewModel.test.ts src/renderer/materialDesign.test.ts`
  - PASS: 2 files, 122 tests.
- `./node_modules/.bin/tsc -p tsconfig.renderer.json --noEmit`
  - PASS.
- `./node_modules/.bin/tsc -p tsconfig.electron.json --noEmit`
  - PASS.
- `npm run harness:check`
  - PASS: Harness check passed.
- `git diff --check`
  - PASS.

## Self-review

- Raw `lastDetail` is never rendered. Only four exact retry codes receive specific Chinese diagnostics; unknown codes, including inherited object keys such as `toString`, use a neutral fixed fallback.
- Retry UI has no recovery actions while automatic retry is active. Waiting UI exposes exactly `continue_acceptance`, `mark_completed_unverified`, and `terminate` in the view model.
- Manual completion forcibly omits certificate presentation even if malformed/stale input carries certificate-shaped data.
- Both acceptance operations are disabled while IPC is pending, and a ref fence prevents duplicate invocations before React state commits.
- The repository has no renderer DOM interaction-test dependency; the established `materialDesign.test.ts` source-contract suite covers wiring and copy, while view-model behavior is exercised directly.

## Files

- `src/renderer/goalProgressViewModel.ts`
- `src/renderer/goalProgressViewModel.test.ts`
- `src/renderer/components/GoalDetailDrawer.tsx`
- `src/renderer/components/GoalStatusStrip.tsx`
- `src/renderer/components/AgentChatPanel.tsx`
- `src/renderer/styles/chat.css`
- `src/renderer/materialDesign.test.ts`
- `src/renderer/App.tsx` (minimal exhaustive status-label update)

## Commit

- Pending at report creation; filled in by the task commit.

## Concerns

- The repository has no renderer DOM test dependency. Interaction safety is covered by pure behavioral state/token tests plus the existing source-contract suite; independent packaged smoke/QA remains appropriate for final click-path acceptance.

## Independent Review Fixes

Review found one Critical, three Important, and two Minor renderer issues. All were addressed test-first:

- Manual-completion confirmation now captures the exact `{ goalId, sessionId, generation }` context. Both the drawer and parent handler validate that snapshot before IPC, so a confirmation opened for one goal cannot complete another goal after navigation.
- Continue/manual operations now use unique tokens containing operation ID, operation kind, goal ID, session ID, and context generation. Result, error, and `finally` UI mutations are fenced against the current token and context. Acceptance handlers no longer call `refreshSessions`, avoiding stale navigation after a delayed operation.
- Canonical returned goals must match the operation goal ID before any renderer state is updated.
- Added explicit `chatTaskActivity` projections: `waiting_for_acceptance` is paused and awaiting a user decision; `completed_unverified` is terminal and explicitly labeled as manually completed without machine certification.
- Retry metadata is inspectable but bounded: cycle, attempt, maximum attempts, allowlisted last code, and safe timestamp. Manual attestation metadata exposes only bounded/redacted timestamp, failure code, retry cycle count, failed checks, and evidence references.
- Unknown failure codes render as `unknown`; raw provider detail is never shown. Missing/invalid attestation no longer claims that an inspectable manual record exists.
- Retry and waiting copy includes the exact reassurance `任务产物与已完成里程碑不会重新执行`.

### Review-fix RED evidence

- Expanded focused suite initially failed with 10 behavioral assertions plus the missing helper module: stale interaction fences, truthful activity states, metadata projections, and strengthened material contracts were absent.
- A follow-up self-review RED run failed two added cases: cross-goal canonical result rejection and truthful handling of a missing manual attestation.

### Review-fix GREEN evidence

- `npm test -- --run src/renderer/goalAcceptanceInteraction.test.ts src/renderer/chatTaskActivity.test.ts src/renderer/goalProgressViewModel.test.ts src/renderer/materialDesign.test.ts`
  - PASS: 4 files, 142 tests.
- `./node_modules/.bin/tsc -p tsconfig.renderer.json --noEmit`
  - PASS.
- `./node_modules/.bin/tsc -p tsconfig.electron.json --noEmit`
  - PASS.
- `npm run harness:check`
  - PASS: Harness check passed.
- `git diff --check`
  - PASS.

### Review-fix files

- Added `src/renderer/goalAcceptanceInteraction.ts`
- Added `src/renderer/goalAcceptanceInteraction.test.ts`
- Modified `src/renderer/chatTaskActivity.ts`
- Modified `src/renderer/chatTaskActivity.test.ts`
- Modified renderer Task 6 files listed above.
