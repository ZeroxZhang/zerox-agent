# KM03 Decision: Receipt-Validated Chat Kernel Segment

Status: Accepted

Date: 2026-08-14

## Context

Chat has two terminal systems:

- domain state: assistant messages, required activity, continuation state,
  memory/token side effects, and workspace-run settlement;
- transport state: one completed, failed, or canceled stream event.

Kernel must not publish `run_end` until the domain and transport state required
for that Chat turn is settled. Wrapping only `runAgentLoop` would publish too
early because current assistant persistence happens after the loop returns.

## Decision

Introduce a Chat-specific adapter over `ProductionKernelDriver`. The adapter
accepts callbacks that return a `ChatKernelSettlement` only after their writes
and stream terminal emission complete.

Every receipt contains:

- Kernel status and summary;
- the user-facing result;
- proof that required domain state was persisted;
- exactly one stream terminal description;
- optional persisted assistant message ID;
- durable continuation proof for paused turns;
- durable terminal activity proof for failed or canceled turns.

The adapter validates the receipt before returning the segment to Kernel.

## Parity Matrix

| Kernel status | Chat stream terminal | Required durable proof |
| --- | --- | --- |
| succeeded | completed | assistant or terminal activity |
| paused | completed | continuation and assistant or terminal activity |
| failed | failed | terminal activity; assistant optional |
| canceled | canceled | terminal activity |

When an assistant message ID exists, the stream terminal must carry the same
final message ID.

## Failure And Abort

- Execution errors use KM02 `settleFailed`; persistence and failed stream
  emission happen before `run_end`, then the original error is rethrown.
- Pre-abort and cancellation use `settleAborted`; canceled or paused state is
  persisted and the compatible stream terminal is emitted before `run_end`.
- Invalid receipts fail closed and cannot be presented as a successful Chat
  segment.

## Compatibility And Rollback

KM03 does not inject the adapter into `chatService` or change feature flags.
Rollback deletes the adapter and tests. KM04 will wire the adapter behind an
explicit rollback flag after actual Chat persistence ordering tests pass.

No Chat storage, trajectory, memory, or workspace-run schema changes are
introduced.
