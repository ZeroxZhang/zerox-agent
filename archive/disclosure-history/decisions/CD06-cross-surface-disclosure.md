# CD06 Cross-Surface Disclosure

## Decision

Plan, Scheduled Tasks, and approval remain separate owning surfaces. CD06 adds
only presentation metadata and bounded projections:

- Plan uses its persisted plan id, revision, action gate, planning stages, and
  rounds. Required confirmation and failed stages stay prominent.
- Scheduled Tasks shows at most the latest persisted `AgentRunRecord` for each
  task, selected by `startedAt` and stable run id. Running UI is temporary and
  never overwrites the persisted run.
- Approval uses the existing request id and revision projected by
  `toolApprovalProjection`; its alert dialog remains the only decision surface.

No surface infers another domain's terminal state or persists a replacement
record.

## Identity And Attention

- Plan disclosure identity is `plan.id`; revision is rendered separately.
- Scheduled disclosure identity is `run.id`, grouped under `task.id`.
- Approval disclosure identity is `request.id`; caller decisions remain bound
  to the expected revision.
- Failed, canceled, paused, approval-required, and confirmation-required states
  use explicit attention semantics. Successful history stays compact.
- Scheduled history is bounded to one latest row per task. Full history remains
  in Runs.

## Rollback

The additional metadata can be hidden independently:

- Plan falls back to its existing confirmation and technical-detail cards.
- Scheduled Tasks falls back to enabled state, next-run time, and Runs link.
- Approval falls back to the existing blocking alert dialog.

Rollback does not change Plan, Run, Schedule, Tool Invocation, or approval
records.

