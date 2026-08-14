# Runtime Convergence Program

## Objective

Close the findings in
`docs/reviews/zerox-vs-deepseek-harness-2026-08-14.md` without weakening
Zerox Agent's local-first permissions, Goal contracts, acceptance evidence, or
reviewed learning boundary.

The machine-readable program is
`.zerox/runtime-convergence-program.json`. This document defines how a fresh
engineering session advances it.

## Control Model

1. `.zerox/feature_list.json` is the status authority for materialized work.
2. At most one Feature may be unfinished.
3. Only `nextFeatureId` from the program may be promoted to `in_progress`.
4. A Feature closes before its successor is promoted.
5. Each Feature owns a bounded file set, focused verification, rollback plan,
   and finding set.
6. A failure in a later gate invalidates completion even when focused tests
   pass.

Run this before and after every Feature:

```bash
npm run program:check
```

## Feature Entry Gate

Before editing runtime code:

1. Confirm every declared dependency is `completed`.
2. Add the Feature to `.zerox/feature_list.json` with `status: in_progress`.
3. Set `activeFeatureId` in the program manifest.
4. Inspect every file named by the Feature.
5. Capture a failing regression test or a deterministic baseline proving the
   current gap.
6. Confirm the rollback does not require deleting user data or bypassing
   `ToolAuthorizationService`.

## Verification Ladder

Every Feature advances through the gates in order:

| Gate | Required evidence |
| --- | --- |
| G0 Contract | Program check, scoped files, dependencies, rollback |
| G1 Focused | Feature-owned unit and integration tests |
| G2 Repository | Full tests and production build |
| G3 Product | `npm run verify`; production smoke for runtime/UI changes |
| G4 Closure | Harness check, diff check, progress evidence |

Do not compensate for a failed gate by weakening assertions, skipping a
backend, or changing an unrelated contract.

## Architecture Decision Gates

The following transitions require an explicit design review recorded in
`.zerox/progress.md` before implementation:

- changing the Tool Runtime public execution contract;
- enabling an OS sandbox by default;
- cutting Chat reads from JSON to SQLite or an event projection;
- making the new Kernel authoritative for a production entry point;
- exposing model-written Code Mode to mutating tools.

The review must state invariants, compatibility behavior, migration or fallback
behavior, and rollback.

## Stop Conditions

Stop the active Feature and record evidence when:

- the required change expands permissions or bypasses workspace checks;
- persisted data would require an untested destructive migration;
- cancellation cannot prove owned work reached quiescence;
- JSON, SQLite, and dual behavior disagree at a compatibility boundary;
- a regression requires an unrelated product refactor to hide it;
- full verification fails for a reason caused by the Feature.

The correct response is to keep the Feature unfinished with a precise blocker,
not to promote another Feature.

## Closure Protocol

After all required gates pass:

1. Set the Feature status to `done`.
2. Set its program state to `completed`.
3. Clear `activeFeatureId`.
4. Advance `nextFeatureId` to the first planned workstream whose dependencies
   are complete.
5. Append changed files, commands, results, residual risks, and rollback
   evidence to `.zerox/progress.md`.
6. Run `npm run program:check` once more against the closed state.

## Scope Discipline

- One workstream per Feature.
- No opportunistic UI redesign or provider rewrite.
- No cloud worker or unreviewed self-modification.
- Existing Goal Contract, Plan lineage, acceptance certificates, and audit
  evidence remain authoritative.
- Compatibility adapters may exist temporarily, but every adapter must have a
  named removal workstream or remain an explicit product boundary.
