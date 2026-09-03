# CD02 Decision: Typed Disclosure Contract And Pure Projector

Status: Accepted for P106 implementation

Date: 2026-08-18

Parent decision: `.zerox/decisions/CD01-conversation-disclosure-program.md`

## Scope

P106 implements shared semantic contracts and a fixture-driven pure projector.
It does not read production stores, add IPC, persist projections, change Chat
streaming, or render a new surface. Production causal lineage, approval
durability, and Workspace Run settlement belong to CD03.

## Contract Shape

`src/shared/conversationDisclosure.ts` owns:

- exact fact kinds and per-kind domain status/payload maps;
- typed adapter envelopes with requiredness, durability, sensitivity, scope,
  authority ref, revision, status, and bounded safe payload;
- primary/contributor source refs and versioned evidence-target unions;
- stable item identity, normalized lifecycle, attention, disclosure class, and
  detail availability;
- scoped snapshot/delta/source-cut/coverage contracts;
- attempt begin/reset/supersede/accept and canonical live answer deltas;
- pure status mapping, disclosure policy, projection, snapshot/delta apply,
  and live-answer reducers.

The module may import existing shared type aliases. It must not import main or
renderer modules, Node-only APIs, stores, authorization services, or Electron.

## Exact Status And Unknown Rules

Goal, Plan, Tool Invocation, Chat activity, Agent/Scheduled Run, Workspace Run,
and Kernel use exact existing aliases. Approval, guided input, Chat message,
Trajectory, context, and usage expose explicitly named adapter-observation
statuses because those domains do not currently have one authoritative status
union. These observations remain attached to their source ref and cannot imply
a new persistent state machine. Exhaustive mappings use `never` checks for
closed unions.

Trajectory event types are evidence categories, not lifecycle states. Only a
validated embedded owning status may map through the corresponding Goal or Run
mapping; otherwise a standalone Trajectory item is `unknown` and a contributor
inherits no authority over its primary item.

Unknown persisted data enters through a runtime parser. Required unknown kinds
or statuses produce degraded coverage and reset; optional unknown presentation
produces a generic evidence fact; ignorable unknown data increments its source
cut and creates no item. Unknown data is never mapped to succeeded or failed.
Generic rows use an explicit typed `unknown` source ref that retains the
original kind and status; they are never relabeled as a known authority.

## Identity And Bounds

Item ids derive from schema version, primary kind/ref, and a semantic slot.
They never include list indexes or timestamps alone. Group items retain an
exact contributor count plus a bounded first page and cursor; the initial
contract constant is a safety cap for fixtures, not the final performance
budget. CD04 freezes measured production limits.

Scope keys are canonical hashes of the complete typed scope. Projection checks
the full surface/session/Goal/Run/query tuple rather than trusting a caller-
supplied key, rejects cross-scope contributors, and clones accepted scope,
evidence, item, attempt, and source-cut data before publication.

Summaries are already host-authored safe text. The shared module applies byte
and line bounds and secret-shape redaction; it never accepts raw tool args,
reasoning, file contents, or unrestricted payloads as a summary.

## Snapshot And Attempt Reducers

A delta applies only when schema, projection version, scope key, generation,
query hash, and `fromCursor` match the current snapshot. An already-applied
exact range or a fully historical valid delta is a no-op; overlap, forward gap,
or conflicting current-range delivery returns a typed reset request and the
prior snapshot object unchanged. Each delta id fingerprints its complete
canonical body, including scope, generation, cursors, cuts, attempts, items,
and removals, so it cannot be reused for a different mutation.

Every snapshot call explicitly declares expected source cuts, even for an
intentionally empty source set. Snapshot coverage is derived from the observed
and expected cuts. Within one generation, requiredness and incomplete severity
may not be weakened; recovery to a stronger completeness claim uses a new
snapshot generation. A delta that claims complete coverage over an ephemeral,
partial, unavailable, or incompatible source is rejected, and a newly required
incompatible source forces reload.
Coverage degradation, source cuts, gates, errors, terminal items, and attempt
controls cannot be silently dropped.

Live answer state is keyed by request, turn, and attempt. Sequence duplicates
are ignored; gaps request an active-attempt snapshot. Reset and supersede erase
unaccepted partial text. Accept requires a role-checked persisted assistant
message id and
reconciles to that durable content; cumulative output parts are not a second
renderer channel. Reset, supersede, and accept retain compact settlement
tombstones containing request, turn, attempt, last sequence, event fingerprint,
outcome, and accepted message id when present. A late delta or repeated accept
therefore cannot resurrect a settled attempt. Accepted tombstones also retain a
fingerprint of the persisted canonical content and an assistant-role receipt.
Snapshot deltas cannot derive acceptance from a bare control; they may only
consume a receipt produced by the canonical live reducer, whose lineage,
sequence, role, message id, event fingerprint, and content fingerprint all
match. A receipt-integrity fingerprint binds those fields so content identity
cannot be replaced independently; it is a deterministic integrity marker, not
a cryptographic authorization proof. Snapshot construction and delta
application reject accepted/active or
accepted/later-settlement conflicts. The reducer keeps exactly the
latest settlement per request/turn for the current projection generation,
without an arbitrary global count eviction that could revive an accepted
stream. Generation rotation bounds its lifetime; CD04 owns measured compaction
after a correctness-preserving floor exists.

## Disclosure Policy

Blocking/failure, guided input, approval, Goal review/acceptance, Plan
confirmation, blocked, and unverified states remain visible. Restricted detail
never becomes inline. Explicit user open/closed state controls expansion but
cannot hide the item or remove attention. Completed low-risk operations fold;
waiting-for-model stays compact only when no user action is possible.

## Characterization Gate

Focused fixtures cover:

- every exact Goal, Plan, Tool, Run, Workspace Run, and Kernel status;
- stable identity across append/reorder and bounded contributor paging;
- default, blocking, user override, restricted, and unknown policy;
- snapshot duplicate/gap/generation/scope/coverage behavior;
- attempt begin/delta/reset/supersede/accept and final reconciliation;
- legacy missing identity, unknown required/optional/ignorable data;
- secret-shaped summary redaction and no raw reasoning contract.

Results are recorded in
`.zerox/verification/conversation-disclosure/CD02-contract-characterization.json`.

## Rollback

The new module is unused by production paths in P106. Rollback removes the
module, its tests, this decision, and the characterization artifact; no Chat,
Goal, Plan, Run, Tool, approval, workspace, or user data is rewritten.
