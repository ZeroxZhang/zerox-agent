# CD05 Chat Progressive Disclosure Surface

## Decision

Chat keeps its existing durable messages and required decision surfaces as the
owning UI. A projected disclosure layer groups the already sanitized
`ChatTaskStatusEvent` stream into five presentation classes:

1. attention
2. narrative
3. operations
4. context
5. result

The projection never replaces Goal, Plan, approval, guided-input, or final
message authority. Those controls continue to render from their owning domain.

## Identity And Updates

- Tool rows use `toolInvocationId`, then `toolCallId`, as stable identity.
- Gate and terminal rows use settlement, turn, or request identity.
- A later sequence updates the existing row instead of appending a duplicate.
- Group and row expansion are keyed by stable ids. Explicit user state wins
  over automatic attention policy while streaming updates arrive.
- Failure, pause, and required-input rows are blocking and open by default.
  Narrative and final-result groups remain readable by default; routine
  operations and context stay compact.

## Safety

- Only the existing sanitized status message and safe tool name are rendered.
- Raw tool arguments, raw model reasoning, credentials, and restricted
  evidence are never projected.
- Existing approval, Goal, Plan, and guided-input components remain prominent
  and retain their current idempotency and recovery behavior.
- Accessibility uses native buttons, stable `aria-expanded` /
  `aria-controls`, live status semantics, visible focus, and reduced-motion
  compatible styling.

## Rollback

The desktop mode is local and defaults to `legacy`. Projected mode requires the
explicit process argument `--zerox-chat-disclosure=projected`; browser preview
acceptance may use `?chatDisclosure=projected`. Removing the switch immediately
restores the previous `ConversationProgressDisclosure` without deleting or
rewriting persisted source facts or user messages.

