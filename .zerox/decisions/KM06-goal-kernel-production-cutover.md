# KM06 Decision: Production Goal Kernel Cutover

Status: Accepted

Date: 2026-08-14

## Decision

When a Production Kernel driver is supplied, `createGoalRuntimeEngine` returns
a Kernel wrapper around an unchanged direct delegate. The wrapper reserves the
milestone run ID, passes it to the delegate, observes durable checkpoint
completion, and returns a Goal receipt only after the delegate has persisted
the run record and flushed trajectories.

Production scope becomes `all` by default. `scheduled_chat` rolls Goal back,
`scheduled` rolls Chat and Goal back, and `off` disables the Production Kernel.

Acceptance certificates and Goal terminal publication remain in
`AgentGoalController`; KM06 changes milestone execution lifecycle only.

## Rollback

Set `ZEROX_PRODUCTION_KERNEL=scheduled_chat`. No Goal, plan, certificate,
checkpoint, run, or trajectory data is modified.
