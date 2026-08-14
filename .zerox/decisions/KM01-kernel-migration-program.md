# KM01 Decision: Independent Chat And Goal Kernel Migration

Status: Accepted

Date: 2026-08-14

## Context

The v3.8.2 runtime convergence release made the Production Kernel
authoritative for Scheduled Tasks. Chat and Goal still invoke the shared
AgentLoop directly:

- Chat owns request serialization, stream events, assistant persistence,
  continuation state, workspace-run recording, and terminal mapping inside
  `chatService`;
- Goal owns milestone checkpoints, run and trajectory persistence, progress,
  cancellation, and bounded transcript recovery inside `goalRuntimeEngine`.

Wrapping either direct call without defining surface-owned settlement would let
Kernel `run_end` race required persistence or duplicate existing terminal
signals. This migration therefore needs a new program rather than another
workstream appended to the completed runtime convergence release.

## Decision

Create a nine-workstream migration program with one active Feature:

1. freeze program and surface invariants;
2. make the Production Kernel driver mode-aware without changing Scheduled
   Task behavior;
3. add and verify a Chat segment adapter;
4. cut Chat production execution over behind a rollback switch;
5. add and verify a Goal milestone adapter;
6. cut Goal production execution over behind a rollback switch;
7. converge all production surfaces and remove only proven-obsolete paths;
8. repeat independent code and security review;
9. repeat stress validation and decide every deferred capability.

Kernel owns invocation lifecycle and terminal publication. Each surface adapter
continues to own domain persistence and must return a settled segment only after
its required writes and started work are complete.

## Terminal Settlement Contract

For every Chat or Goal invocation:

```text
stop admission
  -> drain started model/tool/publication work
  -> persist surface checkpoint and terminal domain state
  -> flush trajectory and required activity writes
  -> return settled segment
  -> Kernel publishes exactly one run_end
```

An observer, stream callback, or ring-buffer history entry cannot satisfy a
durability requirement.

## Compatibility And Rollback

- Scheduled Tasks remain the compatibility baseline during KM02.
- Chat and Goal adapters are introduced before their production flags change.
- Chat rollback returns to `scheduled` Kernel coverage.
- Goal rollback returns to `scheduled+chat` Kernel coverage.
- No schema migration is required for adapter introduction or rollback.
- Existing direct paths may be removed only in KM07 after both cutovers,
  parity tests, full verification, and dual smoke succeed.

## Deferred Decisions

- Context event compaction remains deferred because RC11 did not demonstrate
  pressure requiring it.
- External subagent providers remain deferred pending explicit product value
  and trust-boundary approval.
- Arbitrary Code Mode remains blocked until a separate process isolation design
  proves stronger syscall, filesystem, network, credential, kill, and audit
  boundaries.

## Verification

Each cutover requires focused terminal-order tests, full serial tests, build,
verify/evals, audit, and relevant JSON/SQLite smoke. After KM07, KM08 and KM09
repeat the earlier review and stress phases before the program can close.
