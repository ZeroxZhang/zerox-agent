# Task 4 Report: Durable Persistence and Restart Recovery

## Status

DONE — Task 4A persistence/restart recovery and Task 4B controller
continue-acceptance/legacy upgrade are complete.

Task 4A covers store/repository active-terminal semantics and startup recovery.
Task 4B adds the final-judge-only continuation cycle, evidence-staleness guard,
and safe legacy acceptance-unavailable upgrade without changing manual
completion, service routing, IPC, preload, or renderer behavior.

## Scope Implemented

- `waiting_for_acceptance` remains visible through both JSON and SQLite
  `listActive()` queries, including its optional retry state.
- `completed_unverified` is terminal and irreversible alongside `achieved` and
  `canceled`.
- A canonical `completed_unverified` record cannot be replaced by a stale
  nonterminal write or a same-status write that drops its manual attestation.
- SQLite repository save semantics now enforce the same irreversible boundary
  as the JSON store.
- Optional acceptance retry state and manual completion attestation round-trip
  without being fabricated for historical JSON that lacks those fields.
- Startup leaves an already persisted `waiting_for_acceptance` goal untouched.
- An interrupted `executing` goal in `retrying/final_judge` backoff is recovered
  as `waiting_for_acceptance/awaiting_user`, with its stale `nextRetryAt`
  removed; no milestone or judge execution is started.
- Stale progress delivery is reconciled against canonical
  `completed_unverified`, preventing chat/session projections from regressing
  to a nonterminal status after manual completion.

## Changed Files

- `src/main/agentGoalStore.ts`
- `src/main/agentGoalStore.test.ts`
- `src/main/storage/repositories/goalRepository.ts`
- `src/main/storage/repositories/repositories.test.ts`
- `src/main/container.ts`
- `src/main/container.test.ts`
- `.zerox/progress.md`
- `.superpowers/sdd/task-4-report.md`

## TDD Evidence

RED command:

`npm test -- --run src/main/agentGoalStore.test.ts src/main/storage/repositories/repositories.test.ts src/main/container.test.ts -t "completed-unverified|waiting-for-acceptance|waiting acceptance|final-acceptance retry|acceptance-unavailable JSON"`

Observed expected failures:

1. JSON store returned `completed_unverified` from `listActive()`.
2. SQLite repository returned `completed_unverified` from `listActive()` and
   had no irreversible save fence.
3. Restart preparation converted interrupted final acceptance into
   `stopped_blocked/external_blocked` instead of durable acceptance waiting.

GREEN command: the same focused command passed 6 tests across 3 files.

Independent review found that progress-event reconciliation still fenced only
`achieved` and `canceled`. A second RED run,
`npm test -- --run src/main/container.test.ts -t "completed_unverified"`,
returned stale `executing/checkpoint` instead of canonical manual completion.
The GREEN run passed both the stale-event and current-terminal cases after
adding `completed_unverified` to the reconciliation boundary.

## Final Verification

- `npm test -- --run src/main/agentGoalStore.test.ts src/main/storage/repositories/repositories.test.ts src/main/container.test.ts` — PASS, 90/90 tests.
- `npx tsc -p tsconfig.electron.json --noEmit` — PASS.
- `npm run harness:check` — PASS.
- `git diff --check` — PASS.

## Self-Review

- The restart branch is deliberately narrow: it requires canonical
  `executing + retrying + resumeFrom: final_judge` state and does not alter the
  established interrupted-milestone recovery path.
- The canonical manual-completion fence returns the stored record wholesale,
  so neither status regression nor attestation removal can partially persist.
- The SQLite query and in-memory status filter both classify
  `completed_unverified` as terminal, preventing SQL/filter drift.
- Canonical progress-event reconciliation now applies the same irreversible
  boundary to persisted chat/session projections.
- No controller, IPC, preload, renderer, manual-completion action, or
  certification behavior was changed.

## Concerns / External State

- `./init.sh` performed initialization and passed `harness:check`, then exposed
  a pre-existing unrelated failure in `src/shared/packageScripts.test.ts`: its
  release-gate assertion expects P42 to remain an open feature, while the
  current feature list correctly has P43 as the single in-progress feature.
- Full renderer build/verify was intentionally not run because renderer
  exhaustiveness belongs to later tasks; Electron/main TypeScript is clean.
- Task 1–3 report files were already modified by sibling agents and were not
  edited or staged by Task 4A.

## Task 4B: Continue Final Acceptance and Legacy Upgrade

### Scope Implemented

- Added `AgentGoalController.continueAcceptance(goalId, options?)`.
- Canonical `waiting_for_acceptance` goals continue only when their persisted
  retry state resumes from `final_judge` and every milestone is already
  accepted or skipped.
- Eligible historical `stopped_blocked / acceptance_unavailable` goals upgrade
  to protocol v2 and a final-only acceptance cycle only when all milestones are
  complete. Incomplete historical goals remain unchanged for the existing
  generic retry path.
- Each explicit continuation increments `cycle`, resets cycle-local `attempt`
  to zero, clears `nextRetryAt`, preserves task work/budget usage, and invokes
  `evaluateGoal` without calling `runMilestone`, replanning, or regenerating
  artifacts.
- Final-acceptance evidence fingerprints now represent evidence refs and
  manifest artifact hashes, excluding transient judge outcome fields. An
  accepted judge result must match the persisted fingerprint before a
  protocol-v2 certificate can be created.
- Changed evidence returns to `waiting_for_acceptance` with a bounded
  `evidence_fingerprint_mismatch` diagnostic and the current fingerprint; it
  never creates a certificate.
- Continued final acceptance uses its separate bounded retry cycle even when
  the preserved task execution budget is exhausted.
- Parent abort reaches the resumed judge/delay, while canonical `canceled`,
  `achieved`, and `completed_unverified` outcomes remain irreversible against
  late continuation work.

### TDD Evidence

Initial RED command:

`npm test -- --run src/main/agentGoalController.test.ts --testNamePattern='continues from the final judge|increments the acceptance cycle|refuses stale certification|upgrades an eligible legacy|leaves an incomplete legacy|starts a fresh final-only|late continued judge'`

Observed 7/7 expected failures because `continueAcceptance` did not exist.
Two additional RED tests for missing `final_judge` resume state and parent
cancellation failed for the same missing entry point.

A separate RED test for an exhausted preserved task budget reached
`stopped_budget` instead of the final judge. The minimal fix exempts only an
existing `final_judge` acceptance retry cycle from task-execution budget gates;
ordinary first-time final acceptance retains the established hard-budget
check.

GREEN evidence:

- New Task 4B behavior tests: 10/10 passed.
- Full controller suite: 87/87 passed.
- Focused Task 4 verification: 3 files / 161 tests passed.

### Final Verification

- `npm test -- --run src/main/agentGoalController.test.ts src/main/agentGoalStore.test.ts src/main/container.test.ts` — PASS, 161/161 tests.
- `npx tsc -p tsconfig.electron.json --noEmit` — PASS.
- `npm run harness:check` — PASS.
- `git diff --check` — PASS.

### Concerns / External State

- `./init.sh` still exposes the unrelated pre-existing
  `src/shared/packageScripts.test.ts` release-gate assertion that expects P42
  to remain open even though P43 is the single current in-progress feature.
  The standalone harness check passes.
- Task 4B intentionally does not route chat-service retry actions to the new
  method; IPC/preload/UI/service integration belongs to the later scoped task.
- Task 1–3 report modifications were pre-existing sibling-agent work and were
  not edited or staged by Task 4B.
