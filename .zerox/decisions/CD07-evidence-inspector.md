# CD07 Evidence Inspector

## Decision

The existing Runs detail area is the Evidence Inspector. It receives an exact
persisted run id and trajectory events from the owning Runs query. Selecting an
event is a presentation action only.

- Selection is persisted under a run-scoped local key and restored only when
  the same event remains present.
- The event list renders in pages of 50.
- Unknown event types use a generic visible label instead of being dropped.
- Payload previews pass through the shared credential redactor and are capped
  at 16 KiB.
- Offloaded Tool results remain behind `readToolResultRef`, which rechecks run,
  session, workspace, current authority, and sensitivity in the main process.
- Missing, forbidden, redacted, expired, and incompatible outcomes remain
  explicit; the renderer does not retry under broader authority.

## Rollback

Removing the Inspector selection and paging presentation returns Runs to its
existing summary and trajectory list. No trajectory, evidence, or Tool result
record is changed or deleted.

