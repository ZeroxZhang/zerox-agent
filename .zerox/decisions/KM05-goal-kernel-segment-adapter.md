# KM05 Decision: Persistence-Validated Goal Kernel Segment

Status: Accepted

Date: 2026-08-14

## Decision

Introduce `runGoalKernelSegment()` over the mode-aware Production Kernel.
Goal callbacks may return only a receipt proving:

- the milestone `AgentRunRecord` is persisted;
- all queued trajectory writes are flushed;
- paused execution has a durable checkpoint;
- the returned milestone result agrees with Kernel status and summary.

Execution errors use `settleFailed`; pause/cancel use `settleAborted`. All
required Goal persistence completes before the single `run_end`.

KM05 does not inject the adapter into `goalRuntimeEngine`. KM06 owns production
integration, acceptance parity, and the `all` scope cutover.

## Rollback

Delete the adapter and tests. Goal schemas, checkpoints, certificates, run
records, trajectories, and production behavior remain unchanged.
