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
