# RC06 Decision: Replay-Safe Context Surface And Incremental Token Meter

Status: Accepted

Date: 2026-08-14

## Context

The shared production Agent loop keeps one mutable `ChatMessage[]`. Context
compression and integrity repair replace that array in place. Checkpoints can
retain or rebuild historical text, but the active model surface does not state:

- which immutable messages produced the current surface;
- which visible nodes a summary or checkpoint rebuild shadowed;
- whether a later replacement still reaches every original source node;
- whether an assistant tool call and its result were replaced as one unit.

The same loop also estimates the complete message list before reminders,
compaction, usage reporting, fallback completion accounting, and checkpoints.
Steady-state token accounting is therefore O(current context size) per model
turn even when only one assistant or tool message was appended.

RC05 Chat events remain the durable user-conversation source. They are not the
same domain as the model-facing runtime surface: one Chat message may start
multiple Goal, planner, or scheduled-task runs with different system prompts,
memory injections, checkpoints, and tool observations.

## Decision

Add a versioned `ContextSurfaceState` for each Agent run. Its event log is
append-only and has two event kinds:

1. `source`
   - one immutable runtime message;
   - stable node id and monotonic event sequence;
   - insertion anchor for synthetic reminders that must appear inside the
     current surface;
   - token estimate computed once.
2. `replace`
   - references every currently visible node that becomes shadowed;
   - records the transitive immutable source-node lineage;
   - contains the generated replacement nodes, their token estimates, reason,
     timestamp, strategy, and optional checkpoint reference.

Replaying the events is the only way to project the model-visible messages.
Replacement never deletes source events or older replacement events.

The shared production `runAgentLoop` owns the surface. Its existing mutable
array remains a compatibility view during RC06, but every append, insertion,
integrity repair, compaction, model request, checkpoint, and result is
synchronized through the surface. Model requests are built from the projected
surface, not from an independently authoritative array.

## Invariants

1. Event sequences and node ids are unique and monotonic within one run.
2. Source messages are immutable after append.
3. A replacement cites the complete ordered visible node set it shadows.
4. Replacement lineage resolves transitively to every immutable source node.
5. Projection replay is deterministic and rejects missing, duplicate, stale,
   or out-of-order node references.
6. A replacement projection cannot contain an orphan tool result or split a
   completed assistant tool-call/result batch.
7. Microcompaction resolves the exact tool name from the assistant tool call.
   Only explicitly listed regenerable tools may be replaced.
8. Checkpoint and run result snapshots contain the versioned surface state.
9. Resuming with a surface requires exact parity between its projection and
   the compatibility message checkpoint.
10. The active token total is the sum of projected node deltas. Appending one
    message estimates only that message; steady-state reads are O(1).
11. Provider-reported usage remains authoritative for consumed-token
    telemetry. The incremental meter only replaces local context estimates.

## Persistence And Replay

`AgentLoopCheckpoint` and `AgentLoopResult` expose `ContextSurfaceState`.
`AgentExecutionCheckpoint` stores it as an optional field:

- old checkpoints without a surface bootstrap source events from their current
  normalized message list;
- new checkpoints persist both the compatibility messages and surface state;
- resume replays the state and verifies exact message parity before executing;
- corrupt or mismatched surface state fails closed instead of silently
  discarding provenance.

Goal and planner callers may continue consuming bounded transcript messages.
Their production model requests still use the surface because they execute
through the shared Agent loop. General production-loop convergence remains
RC08.

## Token Meter

Each source or generated replacement node stores the same deterministic token
estimate used by `ContextManager`. The surface projection maintains:

- active message count;
- active estimated token total;
- source count;
- replacement count.

Normal message append and usage reads are O(1). A replacement estimates each
new generated node once. Compaction strategies receive the already-known
pre-compaction total, avoiding another full preflight scan.

## Compatibility

- Provider `ChatMessage` payloads and ordering remain unchanged.
- Existing compaction summaries, checkpoint refs, callbacks, and trajectory
  event types remain valid; optional surface replacement metadata is additive.
- Existing checkpoints without `contextSurface` remain readable.
- Existing `ContextManager` callers continue to accept arrays.
- RC05 Chat events, Goal contracts, acceptance evidence, memory recall, tool
  authorization, and process sandbox behavior are unchanged.

## Rollback

The compatibility message array remains persisted beside the optional surface.
Rollback removes surface ownership from `runAgentLoop` and ignores
`contextSurface` in checkpoints. No user data migration, event deletion, or
SQLite rollback is required.

## Verification

1. Deterministic source/replacement replay and transitive lineage.
2. Corrupt sequence, stale reference, and checkpoint parity rejection.
3. Completed tool-call/result pairs survive replacement as one valid surface.
4. Non-regenerable tool results are never microcompacted.
5. Incremental meter delta tests prove one estimator call per append and no
   full scan for repeated usage reads.
6. Agent-loop compaction emits complete replacement provenance and model
   requests equal the replayed projection.
7. Scheduled-run checkpoint/resume preserves and verifies the surface.
8. Full repository verification and production smoke.

## Deferred Work

- Safe ordered parallel tool scheduling: RC07.
- Kernel ownership of every production loop: RC08.
- Read-only Code Mode: RC08.
- Cross-run context-surface deduplication or compressed event segments.
