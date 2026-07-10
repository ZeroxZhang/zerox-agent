# P41 Task 7 Report — Controller Repair Loop, Blocking, and Certification

## Status

DONE

## Scope

- Replaced unconditional acceptance-failure replanning and the covered-check semantic fast path with one typed acceptance-decision path.
- Added durable failure fingerprints, bounded failure history, occurrence-based same-milestone repair, alternate strategy, stall, structural-only replan, and blocked stop mappings.
- Added deterministic final repair milestone creation/reuse and protocol-v2 atomic certificate-backed achievement.
- Added runtime repair directives and bounded/deduplicated/redacted action signatures for deterministic and model tool paths.
- Added the six approved acceptance ledger/trajectory/progress events with bounded redacted payloads.
- Preserved protocol-v1 final evaluation compatibility and P40 cancellation/achievement arbitration.

## TDD Evidence

RED was witnessed before production implementation:

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts
Test Files 1 failed | 1 passed
Tests 9 failed | 37 passed
```

The failures were the intended missing Task 7 behaviors: bounded repair/stall, fingerprint reset, blocked mappings, final repair reuse, mandatory final evaluation, and certificate-backed achievement.

The runtime directive/signature test was also witnessed RED independently:

```text
npm test -- --run src/main/goalRuntimeEngine.test.ts -t 'injects the exact repair directive'
Test Files 1 failed
Tests 1 failed | 13 skipped
```

GREEN after implementation and expanded race/certificate/observability coverage:

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalAcceptanceCertificate.test.ts
Test Files 3 passed (3)
Tests 120 passed (120)
```

## Fresh Verification

```text
npx tsc -p tsconfig.electron.json --noEmit
exit 0

npm run harness:check
Harness check passed.

git diff --check
exit 0
```

## Changed Files

- `src/main/agentGoalController.ts`
- `src/main/agentGoalController.test.ts`
- `src/main/goalRuntimeEngine.ts`
- `src/main/goalRuntimeEngine.test.ts`
- `src/shared/agentTrajectory.ts`
- `src/shared/agentGoal.ts` (approved ledger event kind additions only)
- `.superpowers/sdd/p41-task-7-report.md`

## Coverage Highlights

- Identical milestone failures: occurrence 1 repair, occurrence 2 alternate strategy, occurrence 3 stalled; zero replans.
- Changed fingerprint occurrence reset.
- Structural-only replan with exact single planner increment and replan-budget enforcement.
- External, impossible, and unavailable blocked mappings.
- Operational-budget precedence after durable failure recording.
- Final repair milestone reuse without an unbounded chain.
- Mandatory fresh final goal evaluation for covered semantic/provenance checks.
- Valid deterministic and semantic protocol-v2 certificates; unavailable/invalid acceptance cannot certify.
- Cancellation races at validation, repair persistence, structural replan, and certificate persistence boundaries.
- All six acceptance events typed, ordered, progress-projected, and free of raw secrets/details/artifact contents.
- Stable redacted action signatures in deterministic and model runtime paths.

## Worktree Preservation

Pre-existing `.gitignore` and unrelated untracked files were not edited or staged.

## Review Fix — Bounded Acceptance Invariants

### Status

DONE

### RED Evidence

The review regressions were added before production changes and witnessed failing:

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalFailureFingerprint.test.ts
Test Files 3 failed (3)
Tests 16 failed | 65 passed (81)
```

The failures covered:

- paused blocked/impossible/unavailable/structural results bypassing the typed decision path;
- repairable pauses lacking durable failure/directive state;
- final hard budgets still calling `evaluateGoal`;
- pending repair milestones blocked by skipped dependencies;
- cross-run action-signature and terminal-publication cache retention;
- unbounded/raw file content, commands, URLs, query credentials, and bearer tokens in action signatures.

### GREEN Evidence

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalAcceptanceCertificate.test.ts src/main/agentGoalFailureFingerprint.test.ts
Test Files 4 passed (4)
Tests 151 passed (151)

npx tsc -p tsconfig.electron.json --noEmit
exit 0

npm run harness:check
Harness check passed.

git diff --check
exit 0
```

### Fix Summary

- Every nonaccepted milestone result, including paused runs, now enters `applyAcceptanceDecision`; repairable turn-limit pauses retain review compatibility after durable policy application.
- Operational hard caps stop before both milestone acceptance validators and final goal cold judgment.
- Repair dependency readiness treats accepted and skipped predecessors as satisfied.
- Tool action signatures use stable private-value SHA-256/byte-length markers, redact secret-named fields and credential tokens, cap each signature at 2 KiB, and cap persisted arrays at 8 KiB.
- Per-goal terminal publication keys and recent action signatures are cleared on owned run cleanup and direct terminal paths without clearing replacement-run state.

### Review Fix Files

- `src/main/agentGoalController.ts`
- `src/main/agentGoalController.test.ts`
- `src/main/goalRuntimeEngine.ts`
- `src/main/goalRuntimeEngine.test.ts`
- `src/main/agentGoalFailureFingerprint.ts`
- `src/main/agentGoalFailureFingerprint.test.ts`
- `.superpowers/sdd/p41-task-7-report.md`

## Second Review Fix — Recoverability, Tail Identity, and Unique Termination

### Status

DONE

### RED Evidence

The three P1 regressions were added before production edits and witnessed failing:

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/agentGoalFailureFingerprint.test.ts
Test Files 2 failed (2)
Tests 5 failed | 71 passed (76)
```

The owned-run signature cleanup race was then isolated with a second RED probe:

```text
npm test -- --run src/main/agentGoalController.test.ts -t 'keeps replacement action signatures'
Test Files 1 failed (1)
Tests 1 failed | 54 skipped (55)
```

The failures proved:

- a successful runtime stopped at the hard cap left its milestone `running` and unschedulable after a budget raise;
- array element 33, array length, object key/value 65, and object total-key count were absent from action identity;
- a replacement run could achieve while a stale acceptance run later emitted a duplicate `goal_stopped` event.

### GREEN Evidence

```text
npm test -- --run src/main/agentGoalController.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalAcceptanceCertificate.test.ts src/main/agentGoalFailureFingerprint.test.ts
Test Files 4 passed (4)
Tests 159 passed (159)

npx tsc -p tsconfig.electron.json --noEmit
exit 0

npm run harness:check
Harness check passed.

git diff --check
exit 0
```

### Fix Summary

- A hard-cap stop after runtime completion resets a still-running milestone to `ready`; raising the budget and resuming schedules it again without running acceptance validators past the cap.
- Canonical arrays now include total length plus a bounded omitted-tail digest. Canonical objects include total key count plus a bounded digest of globally sorted omitted key/value entries.
- Tail inspection has fixed item/node limits, safely converts getters/cycles, emits no omitted raw values, and prevents repeated-failure occurrence collisions at element 33/key 65.
- Terminal dedupe uses one canonical version per goal and tracks every owning run generation. Direct terminal writes register their version, and terminal/signature state is released only after all stale/replacement owners exit.

### Second Review Files

- `src/main/agentGoalController.ts`
- `src/main/agentGoalController.test.ts`
- `src/main/agentGoalFailureFingerprint.ts`
- `src/main/agentGoalFailureFingerprint.test.ts`
- `.superpowers/sdd/p41-task-7-report.md`
