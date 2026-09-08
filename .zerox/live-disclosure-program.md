# Live Process Disclosure Program

## Objective

Make a Zerox Agent turn disclose its process while it runs — incrementally,
truthfully, and without flooding the main conversation — and keep one fact set
driving the live view, the persisted transcript, and the evidence/learning
projections.

The machine-readable program is `.zerox/live-disclosure-program.json`. The
design source is `docs/design/zerox-agent-3-10-0-live-process-disclosure.md`.
This document defines how a fresh engineering session advances the program.

## Why this program exists

v3.9.2 shipped a deliberate disclosure policy: the main transcript keeps user
and assistant messages plus blocking decisions, while thinking, tool previews,
milestones, and approvals live in the right rail. That policy is correct and
stays. What it does not yet deliver is **liveness**:

- `answer_delta` and `thinking_delta` are buffered in the main process and
  flushed only at attempt boundaries or terminal settlement
  (`src/main/chatService/streamingStatus.ts:129,187,300`), so a turn shows
  nothing until it ends;
- reasoning is transient renderer state that no component reads
  (`src/renderer/chatStreamReducer.ts:32,304-321`);
- tool and approval facts are removed by three independent filters;
- the renderer re-allocates every projected message on every delta
  (`src/renderer/components/AgentChatPanel.tsx:290-311`).

This program closes those gaps in dependency order. **Liveness first, folding
second** — a collapsible UI over a stream that never streams is theatre.

## Inherited boundaries (do not renegotiate here)

The prior P104 study froze the DeepSeek-to-Zerox transfer boundary
(`archive/disclosure-history/research/P104-conversation-progressive-disclosure-study.md`,
sections D6–D9 and "DeepSeek-to-Zerox Transfer Boundary"). This program inherits
them unchanged:

- **No default persistence or display of complete reasoning, raw chunks, tool
  arguments, file contents, or secrets.** Safe summaries and bounded, redacted
  evidence only.
- **Actionable state overrides density policy.** Approval, guided input, Goal
  review/acceptance, Plan confirmation, failure, pause, and recovery remain
  visible and authoritative.
- **No Cordis/fiber/slot runtime rewrite.**
- **No new generic event log replacing Goal, Plan, authorization, Tool
  Invocation, or Workspace Run authority.**
- **Unknown required data fails closed; unknown optional data fails soft.**

## Control Model

1. `.zerox/feature_list.json` is the status authority for materialized work.
2. At most one Feature may be unfinished.
3. Only `nextFeatureId` from the program may be promoted to `in_progress`.
4. A Feature closes before its successor is promoted.
5. Each Feature owns a bounded file set, focused verification, rollback plan,
   and finding set.
6. A failure in a later gate invalidates completion even when focused tests
   pass.

Run this before and after every Feature:

```bash
npm run program:check
```

## Feature Entry Gate

Before editing runtime code:

1. Confirm every declared dependency is `completed`.
2. Add the Feature to `.zerox/feature_list.json` with `status: in_progress`.
3. Set `activeFeatureId` in the program manifest.
4. Inspect every file named by the Feature.
5. Capture a failing regression test or a deterministic baseline proving the
   current gap.
6. Confirm the rollback does not require deleting user data or bypassing
   `ToolAuthorizationService`.

## Verification Ladder

Every Feature advances through the gates in order:

| Gate | Required evidence |
| --- | --- |
| G0 Contract | Program check, scoped files, dependencies, rollback |
| G1 Focused | Feature-owned unit and integration tests |
| G2 Repository | Full tests and production build |
| G3 Product | `npm run verify`; production smoke for runtime/UI changes |
| G4 Closure | Harness check, diff check, progress evidence |

Do not compensate for a failed gate by weakening assertions, skipping a
backend, or changing an unrelated contract.

## Architecture Decision Gates

The following transitions require an explicit design review recorded in
`.zerox/progress.md` before implementation. Every one of them is claimed by a
workstream in this program:

- **LD01** — changing the semantic publication classes of the chat stream
  (what publishes when), because sequence, attempt lineage, and idempotency
  keys are load-bearing for settlement;
- **LD02** — persisting any reasoning content, because it crosses the
  provider/persist/deliver/authorize/display gate chain;
- **LD03** — inlining process blocks into the main conversation, because it
  changes the v3.9.2 product policy and the guard test that encodes it.

Each review must state invariants, compatibility behavior, migration or
fallback behavior, and rollback.

## Stop Conditions

Stop the active Feature and record evidence when:

- the required change exposes raw reasoning, secrets, or unbounded tool
  arguments by default;
- the change would expand permissions or bypass workspace checks;
- persisted data would require an untested destructive migration;
- stream ordering, attempt lineage, or settlement idempotency cannot be proven
  preserved;
- a regression requires an unrelated product refactor to hide it;
- full verification fails for a reason caused by the Feature.

The correct response is to keep the Feature unfinished with a precise blocker,
not to promote another Feature.

## Closure Protocol

After all required gates pass:

1. Set the Feature status to `done`.
2. Set its program state to `completed`.
3. Clear `activeFeatureId`.
4. Advance `nextFeatureId` to the first planned workstream whose dependencies
   are complete.
5. Append changed files, commands, results, residual risks, and rollback
   evidence to `.zerox/progress.md`.
6. Run `npm run program:check` once more against the closed state.

## Scope Discipline

- One workstream per Feature.
- No opportunistic UI redesign or provider rewrite.
- No cloud worker or unreviewed self-modification.
- Existing Goal Contract, Plan lineage, acceptance certificates, and audit
  evidence remain authoritative.
- Compatibility adapters may exist temporarily, but every adapter must have a
  named removal workstream or remain an explicit product boundary.
