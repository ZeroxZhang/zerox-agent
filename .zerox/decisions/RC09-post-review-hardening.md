# RC09 Decision: Post-Review Runtime And Recovery Hardening

Status: Accepted

Date: 2026-08-14

## Context

The independent code and security review of commit `4daf812` confirmed thirteen
correctness and recovery defects. No exploitable security vulnerability
survived source-to-sink validation, but the confirmed defects can still:

- dispatch a tool after cancellation;
- split Kernel, checkpoint, and persisted run terminal states;
- lose or resurrect data during migration, rollback, or dual writes;
- ignore pre-canceled read-only Code Mode;
- create ineffective context replacements;
- reset scheduled-run token telemetry after resume.

## Decision

Fix all thirteen findings in one bounded hardening Feature, P80.

### Runtime And Kernel

- ToolRuntime rechecks cancellation after authorization and after lifecycle
  observers, immediately before dispatch.
- RuntimeKernel classifies a signal whose reason is exactly `pause` as paused.
- ProductionKernelDriver observes terminal events through a per-invocation
  subscription, not bounded global history.
- Scheduled Kernel execution includes final checkpoint, trajectory, run-store,
  and task-store persistence inside the Kernel segment. `run_end` is published
  only after authoritative persistence succeeds.

### Context And Code Mode

- Pre-aborted read Code Mode fails before Worker construction; the post-listener
  race is closed by an immediate recheck.
- Read Code Mode injects the run workspace root for native workspace tools
  before each nested ToolRuntime authorization.
- Compaction is successful only when estimated tokens decrease. An overflow
  strategy that makes no progress fails explicitly and does not append a
  replacement event.
- Scheduled checkpoints persist cumulative token usage and its estimated flag;
  resume restores both.

### Migration And Recovery

- A corrupt legacy Chat JSON file cannot mark bootstrap complete.
- SQLite-to-JSON rollback always writes the authoritative Chat set, including
  an empty set.
- Rollback merges projected Chat sessions with unprojected generic Chat rows.
- Rollback exports trajectory groups independently of run rows.
- A committed SQLite dual write owns its JSON shadow write independently of
  request cancellation. Shadow failures propagate and are repairable by an
  idempotent retry.

## Invariants

1. No ToolRuntime dispatch begins after its signal is aborted.
2. One scheduled segment has one terminal status across Kernel, checkpoint,
   trajectory, and run record.
3. Bounded event history cannot affect terminal parity validation.
4. No pre-aborted Code Mode Worker is constructed.
5. Model-documented optional workspace roots remain optional in Code Mode.
6. A context replacement must reduce the active estimate.
7. Resume token telemetry is monotonic across segments.
8. Corrupt migration input never advances its completion marker.
9. Empty and mixed-generation SQLite states round-trip without resurrection or
   omission.
10. Every SQLite trajectory group is rollback-exportable.
11. Dual-store append success means both authoritative and shadow writes
    completed; cancellation after SQLite commit cannot suppress the shadow.

## Rollback

The fixes change no SQLite schema. Rollback can disable the production Kernel
and read Code Mode with existing flags, select JSON storage, and retain the new
tests. Token fields are optional and legacy checkpoints remain readable.

## Verification

- focused tests for each of the thirteen review reproductions;
- full serial tests and production build;
- Agent and Memory evaluations;
- JSON fallback and Electron SQLite production smoke;
- program, harness, and whitespace checks.
