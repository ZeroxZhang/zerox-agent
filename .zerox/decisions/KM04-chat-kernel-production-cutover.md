# KM04 Decision: Production Chat Kernel Cutover

Status: Accepted

Date: 2026-08-14

## Decision

Wrap admitted `sendMessageInternal` executions with `runChatKernelSegment`.
The wrapper observes or synthesizes exactly one terminal stream event and
returns its settlement receipt only after `executeMessageInternal` has
completed all awaited Chat persistence, memory, token, continuation, and
workspace-run work.

Production scope becomes:

- `scheduled_chat` (default): Scheduled Tasks and Chat use Kernel;
- `scheduled`: rollback to v3.8.2 Scheduled Task-only coverage;
- `off`: disable Production Kernel.

Goal remains direct until KM06.

## Persistence Rules

- Successful and paused turns use the persisted assistant/final-message ID.
- Paused turns require the durable continuation activity written by Chat.
- Failed and canceled turns write required terminal activity before settlement.
- Requests rejected before a session exists explicitly record
  `noDomainStateCreated`; they do not claim a database write.
- A pre-aborted request that never enters same-session admission remains outside
  Kernel because no run was admitted.

## Rollback

Set `ZEROX_PRODUCTION_KERNEL=scheduled`. No Chat events, messages, continuations,
or trajectories are deleted or rewritten.
