# Chat And Goal Kernel Migration Program

## Objective

Move the production Chat and Goal execution surfaces onto the same observable,
recoverable Runtime Kernel already used by Scheduled Tasks, without changing
permission authority, user data schemas, or the immutable v3.8.2 release.

The machine-readable authority is
`.zerox/kernel-migration-program.json`. The completed
`.zerox/runtime-convergence-program.json` remains historical evidence and must
not be reopened for this work.

## Control Model

1. `.zerox/feature_list.json` remains the materialized Feature authority.
2. At most one Feature may be unfinished across all programs.
3. Only this program's `nextFeatureId` may become `in_progress`.
4. Planned Features are added to the Feature list only when promoted.
5. Each runtime cutover requires its own ADR, rollback switch, focused tests,
   and terminal-persistence ordering evidence.
6. `npm run program:check` validates both the completed convergence program and
   this migration program.

## Migration Sequence

| Workstream | Scope |
| --- | --- |
| KM01 | Program, invariants, checker, and deferral gates |
| KM02 | Mode-aware Production Kernel segment contract |
| KM03 | Chat segment adapter and durable terminal parity |
| KM04 | Chat production cutover and restart recovery |
| KM05 | Goal milestone adapter and checkpoint parity |
| KM06 | Goal controller cutover and acceptance parity |
| KM07 | All-surface convergence and legacy path cleanup |
| KM08 | Repeat independent code and security review |
| KM09 | Repeat runtime stress and decide every deferral |

KM08 and KM09 are mandatory post-migration gates, not optional cleanup.

## Surface Invariants

### Chat

- Same-session requests remain serialized.
- Duplicate request IDs return persisted replies without rerunning a model.
- Required activity and continuation state is durable before returning.
- The assistant message and final output parts are persisted before Kernel
  `run_end`.
- Exactly one stream terminal event agrees with the Kernel terminal status.
- Cancellation stops admission, drains started tools, persists cancellation
  state, and only then publishes `run_end`.

### Goal

- Milestone run records and trajectory writes finish before Kernel `run_end`.
- Pause and cancel preserve bounded transcripts, token telemetry, action
  signatures, checkpoints, and resumability.
- Acceptance certificates, plan lineage, repair state, and canonical terminal
  publication remain authoritative.
- A stale progress delivery cannot overwrite an irreversible persisted Goal
  status.

### Shared

- ToolRuntime and ToolAuthorizationService remain mandatory.
- Workspace and macOS sandbox checks are never bypassed.
- Kernel emits one invocation-local terminal event with exact segment parity.
- Observers cannot become persistence authorities.

## Verification Ladder

Every Feature advances through:

| Gate | Required evidence |
| --- | --- |
| G0 Contract | Dependencies, scoped files, ADR where required, rollback |
| G1 Focused | Surface-owned unit and integration tests |
| G2 Repository | Full serial tests and production build |
| G3 Product | Verify, evals, audit, and relevant dual smoke |
| G4 Closure | Program, harness, diff, and progress evidence |

For runtime Features, a focused test must subscribe to Kernel events and prove
that required persistence completes before the single `run_end`.

## Rollback Discipline

- KM02 must leave the scheduled path behaviorally unchanged.
- KM03 and KM05 add adapters before production cutover.
- KM04 and KM06 require explicit surface rollback flags.
- No rollback may delete SQLite events, Goal certificates, Chat messages,
  trajectory rows, or checkpoints.
- A failed parity assertion keeps the Feature open; it is not resolved by
  weakening the assertion or emitting a second terminal event.

## Deferred Capabilities

The manifest is authoritative for the three deferrals:

- Context event compaction requires pressure evidence.
- External subagent providers require a product and trust-boundary decision.
- Arbitrary Code Mode requires a separate, stronger process-isolation design.

Kernel migration may collect evidence for these decisions but may not implement
them. KM09 must explicitly record `keep deferred` or open a new independent
program after all stated gates are met.

## Completion

Migration implementation is complete at KM07. The program itself completes only
after KM08 repeats code/security review and KM09 repeats long-session,
parallelism, cancellation, Worker timeout, and SQLite volume stress.
