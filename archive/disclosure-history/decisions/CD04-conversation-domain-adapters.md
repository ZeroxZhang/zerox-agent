# CD04 Decision: Bounded Domain Adapters, Replay, And Evidence

Status: Accepted for staged P108 implementation (shadow-only)

Date: 2026-08-24

Parent decisions:

- `.zerox/decisions/CD01-conversation-disclosure-program.md`
- `.zerox/decisions/CD02-conversation-disclosure-contract.md`
- `.zerox/decisions/CD03-conversation-causal-spine.md`

## Scope

P108 connects the accepted causal spine and existing owning stores to the pure
conversation-disclosure projector. It implements bounded domain reads, typed
facts and source cuts, a per-scope materializer with replay/reset semantics, a
main-process evidence resolver, shadow-parity auditing, and a reproducible
performance baseline.

P108 remains shadow-only. It does not change an owning domain's write path,
enable a renderer projection, add a default UI switch, or expose evidence over
IPC. Chat surface cutover belongs to CD05 and the evidence handoff UI/IPC
belongs to CD07.

## Architectural Shape

```text
trusted main-process scope query
              |
              v
      causal spine lineage join
              |
              v
   bounded reads from owning stores
              |
              v
 typed facts + explicit source cuts
              |
              v
   accepted pure disclosure projector
              |
              v
 per-scope snapshot / delta / replay ring
              |
              +----> shadow parity audit
              |
              +----> reauthorized evidence resolver
```

The causal store only joins identities, attempts, required settlements,
admissions, approvals, guided input, and accepted messages. It never becomes a
copy of Goal, Plan, Chat, Run, Tool, Context, or Usage payloads.

## Authority And Precedence

| Domain | Owning read authority | Adapter rule |
| --- | --- | --- |
| Chat message | `ChatSessionStore.getTranscriptPage` | Message role, content identity, and turn settlement come only from Chat persistence. |
| Chat activity | bounded Chat event page | SQLite history can be complete for the queried cut; the JSON 80-event compatibility tail is explicitly partial. |
| Goal | `AgentGoalStore.get/listByChatSession/readLedger` | Exact Goal status and acceptance state outrank Chat summaries or model text. |
| Plan | `PlanStore.get/listBySession` | Exact revision, status, and action gate are preserved. No historical revision is fabricated. |
| Scheduled | `ScheduledTaskStore` plus selected execution/run owner | Task timestamps do not prove run success. |
| Agent Run | terminal `AgentRunStore` owner, then active `AgentExecutionStore` checkpoint | A settled admission without its owner is degraded, never successful. |
| Trajectory | bounded `AgentTrajectoryStore` sequence page | Event type is evidence, not lifecycle; an owner status may be attached only after exact validation. |
| Workspace Run | `WorkspaceRunStore.getRun` plus bounded event page | Snapshot status owns lifecycle; required settlement witnesses are required facts. |
| Tool Invocation | exact trajectory/workspace observations joined by invocation id | Tool Audit is authorization evidence, not execution truth. |
| Approval | causal approval intent and decision | A historical approval is never a restart grant. |
| Guided input | Chat required event plus causal settlement | Missing or incomplete required settlement cannot replay execution. |
| Context | Chat/Goal/execution context statistics | Only counts, tokens, compaction metadata, and safe provenance are adapted. |
| Usage | existing Chat/Plan/Goal usage projection | Duplicate run ids are deduplicated; any estimated component keeps estimated provenance. |
| Kernel | process-local `KernelEventBus` history | Always ephemeral and contributor-only; restart loss cannot weaken durable owner truth. |

Owning stores determine domain state. Causal lineage selects related facts but
cannot override them. Trajectory, Kernel, and ordinary Chat progress are
contributors unless a declared contract makes one exact record required.

## Bounded Read Contract

Chat activity, Trajectory, and Workspace event readers gain store-level pages.
They must not load an unbounded result and slice it after the fact. Each page
returns:

- records in deterministic authority order;
- an opaque next cursor bound to source identity, query, and cut;
- whether the requested cut is complete;
- a current source revision or cut witness;
- an explicit partial/incompatible reason when legacy data or drift prevents a
  complete claim.

Goal, Plan, Scheduled, AgentRun, and active checkpoint reads already expose
bounded identity-based APIs and remain unchanged unless characterization finds
a concrete missing bound.

## Snapshot, Delta, And Replay

The main process owns one serial materialization queue per canonical scope.
Each state contains `generation`, publication `cursor`, current snapshot, a
bounded delta ring, and source-cut witnesses. Publication cursors are not store
cursors.

Generation rotates after main-process restart, schema/projection/query-policy
change, source-cut recovery, inconsistent double-read, or replay-ring pressure.
Consumers eventually use subscribe-first: subscribe, fetch one atomic snapshot,
then apply only continuous deltas. P108 provides replay/reset behavior without
adding a renderer consumer.

The materializer:

- treats exact and historical duplicate deltas as no-ops;
- resets on conflicting duplicates, overlap, forward gaps without ring cover,
  generation/scope/query mismatch, or incompatible required sources;
- never compares opaque source cursors lexicographically;
- never weakens requiredness or improves coverage within a generation;
- rotates generation before partial/degraded coverage can recover to complete;
- may coalesce ambient updates before cursor assignment;
- never coalesces or drops gates, attempt controls, coverage degradation,
  errors, blocked state, or terminal settlement;
- returns deep-cloned snapshots, deltas, and replay results.

The ring is bounded independently by entry count, bytes, and age. Falling
outside any bound returns a fresh snapshot reset rather than silently omitting
events.

## Evidence Resolver

`src/shared/conversationEvidence.ts` owns a versioned, safe response contract.
The wire request binds the target to the server-issued projection anchor:
scope, query hash, generation, projection version, item id, and target. Viewer,
role, capability, runtime scope, and permission claims never come from the
request; the main process injects them from trusted caller context.

Every page is reauthorized. Its opaque cursor binds scope, query, item, target,
authority revision, page position, and limit. Permission revocation, authority
revision change, cross-target replay, or cross-scope replay yields forbidden or
incompatible/reset; pages from two authority generations are never joined.

The response preserves the five CD01 outcomes:

- `found`
- `redacted`
- `missing`
- `forbidden`
- `incompatible`

Storage, authorization-audit, or resolver infrastructure failure is an outer
`resolver_unavailable` error and is never mislabeled as missing or forbidden.
Forbidden responses withhold existence, count, and authority revision.

Payloads are discriminated, host-authored, scalar-safe views. They never expose
unbounded `Record<string, unknown>`, raw reasoning, full user text, file
content, tool arguments, result payloads, paths, authorization grants, or a
cached permission decision. Structured allowlisting runs before credential
redaction and UTF-8 byte/line/item truncation.

Special rules:

- Tool Invocation detail is reconstructed from its owning trajectory records;
  Tool Audit cannot supply execution state.
- Offloaded tool results require current authorization and server-derived
  run/session/request/workspace scope. Legacy unscoped result refs are rejected.
- Goal `revision` is only a current `planVersion` guard; no historical Goal
  revision is invented.
- Plan evidence requires an exact current revision until a historical store
  exists.
- Existing AgentRun events without stable ids cannot back an
  `agent_run_event` target; they remain incompatible or generic unavailable.
- Contributor pages resolve from server-owned materialization state, never
  renderer-supplied contributor refs.

## Requiredness, Legacy, And Unknown Data

Required facts include the scope owner, exact causal required-settlement
witnesses, and any causal terminal owner ref. Missing, unknown, conflicting, or
unavailable required facts produce degraded coverage and reset.

Ordinary progress, technical Trajectory/Kernel evidence, context, usage, and
Goal ledger facts are optional unless a scenario declares otherwise. Optional
loss is explicit partial coverage or a generic unavailable row.

Legacy facts retain deterministic compatibility refs and never receive more
authority than their storage proves. A Chat row without turn/attempt/settlement
can remain transcript evidence but cannot prove success. JSON Chat activity is
partial. Missing AgentRun revision is revision 1 compatibility. Route-only
session identity never becomes a durable binding.

Required unknown data is incompatible and not rendered as a normal item.
Optional unknown data is an explicit generic evidence item. Ignorable unknown
data only increments its source cut. No unknown value maps to success or
failure.

## Shadow Parity

Shadow comparison is read-only and runs after owning commits. It must report:

- zero missing required facts;
- zero lifecycle mismatches;
- zero duplicate stable identities with different canonical bodies;
- zero restricted-data or credential leaks;
- exact source cuts and requiredness;
- every optional difference with a bounded reason code and source-cut witness.

`CD04-shadow-parity.json` is machine-readable. An independent reviewer records
acceptance in `.zerox/reviews/CD04-shadow-parity-review.md`; implementation
authors do not self-accept it.

## Performance Baseline

The baseline runner uses fixed deterministic fixtures and separate process
repetitions. It records environment and source/fixture/runner digests, warmups,
sample counts, p50/p95/max/MAD, explicit-GC retained heap, snapshot bytes,
delta-ring bytes, protected and ambient publication latency, reset rate, and
correctness counters.

Fixture classes cover bounded 80/160/500-item projections, 10k Chat history,
25k Trajectory history, ambient bursts interleaved with protected gates and
terminals, replay inside/outside the ring, 2KB summaries, and contributor pages.
Budgets are absolute values derived from the worst independent p95 plus measured
noise, then rounded to readable hard limits. Percent-only claims are rejected.

DOM and render metrics require a real deterministic renderer fixture. Since
P108 has no projected renderer consumer, the artifact records the current
legacy performance smoke as its DOM control and marks projected DOM as deferred
to CD05/CD08 rather than fabricating a DOM estimate from JSON or HTML bytes.

## Acceptance Stages

1. Bounded read APIs: JSON/SQLite parity, complete/partial cuts, cursor replay,
   corruption and abort behavior.
2. Typed adapters: exact authority precedence, requiredness, legacy/unknown,
   safe payloads, and every closed status union.
3. Materializer: atomic snapshot, generation/cursor/ring replay, source drift,
   backpressure, protected event retention, cloning, and restart semantics.
4. Evidence and governance: current authorization, redaction, shadow parity,
   reproducible baseline, independent review, full verification, smoke, program,
   harness, and whitespace gates.

No later stage may compensate for a failed earlier stage. CD04 completes only
when every completion artifact exists and the independent parity review passes.

## Rollback

Disable construction/use of the bounded adapter, materializer, shadow audit,
and evidence resolver. Existing Chat, Goal, Plan, Scheduled, AgentRun,
Trajectory, Workspace, Tool, approval, context, and usage stores continue
unchanged. No projected UI exists to migrate or revert, and no source facts or
user data are deleted.
