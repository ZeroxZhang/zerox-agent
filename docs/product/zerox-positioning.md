# Zerox Agent Product Positioning

## One-line Position

Zerox Agent is a local-first desktop control plane for personal AI agents that need safe access to local files, tools, memory, scheduled work, and user-reviewed learning.

## Primary User

Independent builders and power users on macOS who want an agent that can work on local tasks without sending local state to a hosted agent platform.

## Primary Job

Turn recurring or messy local workflows into observable, permissioned, recoverable agent runs.

## Non-goals

- Zerox is not a generic chat companion.
- Zerox is not a cloud agent hosting service.
- Zerox is not primarily a coding CLI.
- Zerox does not execute unreviewed self-modifications.
- Zerox does not run unbounded autonomous loops; every autonomous goal run has explicit termination conditions and review gates.

## Product Bet

The durable advantage is trust: local data, explicit permissions, observable trajectories, recoverable agent runs, and user-reviewed learning.

## Decision Matrix

| Proposal | Accept When | Reject When |
| --- | --- | --- |
| New tool integration | It improves real local workflows and can be permissioned, audited, and replayed. | It requires broad opaque access or cannot explain risk to the user. |
| New UI panel | It helps inspect, resume, evaluate, or review agent work. | It only markets capability without improving control or trust. |
| New memory behavior | It changes future behavior in a traceable and reversible way. | It silently rewrites user preference or skill behavior. |
| New automation | It has clear schedule, permissions, failure reporting, and cancel path. | It runs indefinitely without inspection or recovery. |
| Autonomous goal run | It is bounded by budget, has deterministic or evidence-backed acceptance, is interruptible, recoverable, and respects review gates. | It runs without a budget, cannot be inspected or interrupted, or accepts its own work with no evidence. |
