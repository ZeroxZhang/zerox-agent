# Task 7 controller and service review fixes

## Scope

- Durable sealed final-judge replay integration in the controller and both goal stores.
- Immutable final-acceptance evidence anchors and independent continuation budget.
- Continue-click handoff across the background-run cleanup window.

## Root causes

1. The retry loop called `evaluateGoal` for every attempt, so accepted deterministic validators and command checks could execute again.
2. Retry persistence retained only an evidence fingerprint, not the sealed replay bundle returned by the acceptance engine.
3. Evidence mismatch handling replaced the original anchor with the latest attempt fingerprint, allowing a later cycle to certify a changed artifact set.
4. `applyAcceptanceDecision` applied normal task-budget exhaustion before converting an exhausted acceptance-only cycle back to `waiting_for_acceptance`.
5. `runAbortableGoalOperation` returned the canonical waiting goal after an older background run completed instead of starting/coalescing the requested continuation.

## RED evidence

`npm test -- --run src/main/agentGoalController.test.ts src/main/goalChatService.test.ts`

- 6 failures reproduced: repeated full goal evaluation, budget exhaustion becoming `stopped_budget`, mutable evidence anchor, continuation replay not entered, and the cleanup-window click returning `waiting_for_acceptance` without a controller call.

## Implementation

- `GoalAcceptanceRetryState` now carries a structurally validated, 256 KiB-capped `finalJudgeReplay` bundle.
- JSON and SQLite persistence clone valid replay bundles and strip malformed or oversized bundles at write/read boundaries.
- The first final attempt may call `evaluateGoal` once. Automatic retries, persisted restart recovery, and explicit continuation call only `replayFinalGoalJudge` with the sealed bundle.
- Missing legacy replay data fails closed in `waiting_for_acceptance` with `final_judge_replay_unavailable`; deterministic validators are never silently rerun.
- Retry scheduling and evidence-change handling preserve the original cycle fingerprint and sealed replay bundle.
- Explicit continuation bypasses only the normal task-budget gate for its bounded final-acceptance cycle; three exhausted transport attempts return to `awaiting_user`.
- A continuation waiting on background cleanup re-reads canonical state, starts/coalesces continuation only when it remains eligible, and returns terminal winners without a second controller call.

## GREEN evidence

- `npm test -- --run src/main/agentGoalController.test.ts src/main/goalChatService.test.ts src/main/agentGoalStore.test.ts src/main/storage/repositories/repositories.test.ts src/main/agentGoalAcceptance.test.ts src/shared/agentGoal.test.ts`
  - Passed: 6 files, 312 tests.
- `npx tsc -p tsconfig.electron.json --noEmit --pretty false`
  - Passed.
- `npm run harness:check`
  - Passed.
- `git diff --check`
  - Passed.

## Regression coverage

- Automatic three-attempt cycle: one full evaluation, two sealed replays.
- Persisted restart and explicit continuation: zero full evaluations, replay only.
- Missing legacy seal: visible fail-closed waiting state.
- Timeout followed by changed-evidence acceptance: no certificate and original anchor retained.
- Task budget already exhausted plus three transport failures: waiting, never `stopped_budget`.
- Continue clicked while an older background run is cleaning up: exactly one continuation; canonical terminal winner: zero continuations.
- Valid replay round-trip and oversized replay stripping in JSON and SQLite stores.

## Fresh acceptance fixture repair

- RED: `npm test -- --run src/main/container.test.ts -t "cancels a final-acceptance continuation started through the container wrapper"` timed out after the production controller correctly refused a legacy waiting fixture with no sealed replay bundle.
- The container test now creates the seal through one real initial `evaluateGoal` call, then starts continuation with that persisted replay bundle.
- Its deterministic validator records exactly one call during seal construction. Continuation blocks in the final model judge, cancellation aborts that judge signal, and both wrapper results resolve from the canonical canceled goal.
- GREEN: the isolated regression passes (`1 passed`, `41 skipped`) and the full container suite passes (`42 passed`).
- Expanded P43 focused suite: `13 passed`, `534 tests passed`.
- Electron TypeScript no-emit, `npm run harness:check`, and `git diff --check` all passed after the fixture repair.
