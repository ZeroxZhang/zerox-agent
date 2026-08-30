# CD01 Decision: Causal Conversation Disclosure Projections

Status: Accepted for staged implementation

Date: 2026-08-18

Evidence baseline:
`.zerox/research/P104-conversation-progressive-disclosure-study.md`

## Context

Zerox already persists and renders Chat, Goal, Plan, Scheduled, AgentRun,
Trajectory, Workspace Run, Tool Invocation, Tool Audit, approval, context, and
usage state. Their contracts were built for different responsibilities:

- Chat owns the user/assistant transcript, request idempotency, live deltas,
  required continuation state, and a bounded activity projection;
- Goal owns objective, milestone, acceptance, and certificate truth;
- Plan owns Direct/Debate revisions, rounds, adoption, and failure evidence;
- Scheduled and AgentRun/Trajectory own background execution and technical run
  evidence;
- Tool Invocation and Tool Audit own execution lifecycle and sanitized
  authorization evidence;
- Workspace Run is an explicit file-backed ledger with no current production
  UI consumer;
- Kernel is capped live telemetry and settlement orchestration, not a durable
  user-history authority;
- the renderer currently repeats cross-domain arbitration, filtering, capping,
  and disclosure choices.

The P104 study confirmed that a visual-only refactor would preserve the root
inconsistency. It also rejected a physically universal new event store: Goal,
Plan, authorization, tool, and execution authorities must remain separate.

## Decision

Introduce a versioned Conversation Disclosure Projection in the main/shared
boundary. It adapts existing domain facts into stable, causally referenced,
audience-safe items for three product surfaces:

1. Narrative: goal, plan, current phase, blockers, settlement, and final result.
2. Operations: grouped tools, subagents, context work, checkpoints, tests, and
   artifacts with concise summaries.
3. Evidence: a stable target for Runs/Trajectory or a bounded authorized
   Inspector query.

The projection is rebuildable and never becomes Goal, Plan, authorization,
Tool Invocation, or execution truth. Renderer state may select, expand, pin, or
filter a projected item, but may not change its lifecycle, sensitivity,
attention, or evidence identity.

## Typed Adapter Boundary

The shared semantic contract is introduced before renderer cutover. The main
process coordinates typed adapters; it does not read arbitrary store records
through one untyped switch. Each adapter emits a discriminated envelope whose
payload and `domainStatus` are keyed by `kind`:

```ts
type ConversationFactKind =
  | "chat_activity"
  | "chat_message"
  | "goal"
  | "plan"
  | "scheduled_run"
  | "agent_run"
  | "trajectory"
  | "workspace_run"
  | "tool_invocation"
  | "approval"
  | "guided_input"
  | "context"
  | "usage"
  | "kernel";

type ConversationDisclosureFact<K extends ConversationFactKind> = {
  schemaVersion: 1;
  kind: K;
  authorityRef: string;
  scope: ConversationDisclosureScope;
  domainRevision?: string;
  domainStatus: ConversationDomainStatusMap[K];
  requiredness: "required" | "optional" | "ignorable";
  durability: "durable" | "process_recoverable" | "ephemeral";
  sensitivity: "public_summary" | "technical" | "restricted";
  occurredAt: string;
  payload: ConversationFactPayloadMap[K];
};
```

`ConversationDomainStatusMap` imports exact existing Goal, Plan, Scheduled,
AgentRun, Workspace Run, Tool Invocation, Chat activity, and Kernel aliases.
For Approval, guided input, Chat message, Trajectory, context, and usage—where
the current domain has no single lifecycle alias—the adapter emits an explicitly
named observation status without claiming a new owning-domain state machine.
`ConversationFactPayloadMap` is a discriminated map of bounded safe fields; it
is never `unknown` or an unrestricted store record. Kernel
facts may be `ephemeral` health contributors but cannot be a primary durable
settlement source. Unknown required facts degrade coverage and force a reset;
unknown optional facts become generic evidence; ignorable unknown facts may be
dropped only with a counted source-cut reason.

Field authority is explicit:

| Field | Authority |
| --- | --- |
| `authorityRef`, `domainRevision`, `domainStatus`, `occurredAt` | owning domain adapter |
| `scope`, `requiredness`, `durability`, `sensitivity` | typed adapter policy, tested per domain |
| normalized lifecycle, attention, grouping, safe summary | pure disclosure projector |
| selected/open/pinned state | renderer-local user preference |
| permission to load detail | main-process evidence resolver at query time |

## Projection and Evidence Contracts

```ts
type ConversationDisclosureSourceRef = {
  [K in ConversationFactKind]: {
    kind: K;
    ref: string;
    domainRevision?: string;
    domainStatus: ConversationDomainStatusMap[K];
    role: "primary" | "contributor" | "evidence";
  }
}[ConversationFactKind];

type ConversationEvidenceTarget =
  | { schemaVersion: 1; kind: "agent_run_event"; runId: string; eventId: string }
  | { schemaVersion: 1; kind: "trajectory_event"; runId: string; eventId: string }
  | { schemaVersion: 1; kind: "tool_invocation"; runId: string; invocationId: string }
  | { schemaVersion: 1; kind: "goal_record"; goalId: string; revision?: number }
  | { schemaVersion: 1; kind: "plan_record"; planId: string; revision: number }
  | { schemaVersion: 1; kind: "checkpoint"; runId: string; checkpointId: string }
  | { schemaVersion: 1; kind: "contributor_page"; scopeKey: string; itemId: string; cursor?: string }
  | { schemaVersion: 1; kind: "generic_source"; source: ConversationDisclosureSourceRef };

type ConversationDisclosureItem = {
  schemaVersion: 1;
  projectionVersion: number;
  id: string; // stable semantic-slot id, never a timestamp or array index
  primarySource: ConversationDisclosureSourceRef;
  contributors: ConversationDisclosureSourceRef[]; // bounded first page
  contributorCount: number;
  contributorsComplete: boolean;
  contributorCursor?: string;
  scope: ConversationDisclosureScope;
  requestId?: string;
  turnId?: string;
  runId?: string;
  lifecycle:
    | "queued"
    | "running"
    | "waiting_for_user"
    | "waiting_for_approval"
    | "waiting_for_review"
    | "waiting_for_acceptance"
    | "waiting_for_model"
    | "paused"
    | "blocked"
    | "succeeded"
    | "completed_unverified"
    | "failed"
    | "canceled"
    | "unknown";
  disclosureClass: "narrative" | "operation" | "gate" | "ambient" | "evidence";
  attention: "normal" | "needs_attention" | "blocking";
  sensitivity: "public_summary" | "technical" | "restricted";
  summary: string;
  detailAvailability: "none" | "inline" | "evidence";
  evidenceTarget?: ConversationEvidenceTarget;
  occurredAt: string;
};
```

An item's id derives from its stable primary authority ref plus a semantic
slot. Contributors may add Goal/Plan/Run/Tool/Kernel context without taking
authority from the primary source. A group has its own stable semantic slot,
an exact contributor count, and a bounded first page of refs. When
`contributorsComplete` is false, `contributorCursor` plus the authorized
`contributor_page` evidence target pages the remainder; the projector never
silently claims the bounded page is the complete group. The page/count limits
are frozen in CD04's performance baseline. The projector cannot invent a
source ref, and one source may feed several projections without duplicating
authority.

The evidence target only locates an existing record. It never carries a file
path, raw payload, authorization grant, or cached permission decision. The main
process resolves it against the current session/workspace/viewer, applies
redaction and byte/page limits, and returns `found`, `redacted`, `missing`,
`forbidden`, or `incompatible`. `missing` on required evidence degrades the
snapshot; optional evidence falls back to a generic unavailable row.

## Lifecycle Mapping

Every adapter preserves exact `domainStatus` and implements an exhaustive
mapping table in shared code. The Goal, Plan, and Tool mappings are frozen:

| Domain status | Normalized lifecycle |
| --- | --- |
| Goal `planning` | `queued` |
| Goal `executing` | `running` |
| Goal `waiting_for_review` / `waiting_for_acceptance` / `waiting_for_model` | matching explicit waiting state |
| Goal `achieved` | `succeeded` |
| Goal `completed_unverified` | `completed_unverified`, never `succeeded` |
| Goal `stopped_budget` / `stopped_stalled` / `stopped_blocked` | `blocked` with exact source status and recovery semantics |
| Goal `failed` / `canceled` | `failed` / `canceled` |
| Plan `drafting` / `executing` | `running` |
| Plan `paused` | `paused` |
| Plan `awaiting_input` / `awaiting_confirmation` | `waiting_for_user` |
| Plan `confirmed_pending_execution` | `queued` |
| Plan `steps_completed` | `completed_unverified` until Goal acceptance |
| Plan `completed` | `succeeded` |
| Plan `superseded` / `discarded` / `canceled` | `canceled` with exact source status |
| Plan `failed` | `failed` |
| Tool `proposed` / `visible` / `authorized` / `running` | `queued` / `queued` / `queued` / `running` |
| Tool `waiting_approval` | `waiting_for_approval` |
| Tool `completed` / `recovered` | `succeeded` with exact source status |
| Tool `error` | `failed` |
| Tool `aborted` | `canceled` |

Plan `actionGate: blocked` overrides lifecycle to `blocked`; a domain status not
handled exhaustively maps to `unknown`, marks its required source cut degraded,
and can never be guessed as success or failure.

## Snapshot, Cursor, Attempt, and Publication

The main process owns projection assembly. Renderer consumers receive an atomic
scope snapshot followed by generation-scoped deltas:

```ts
type ConversationDisclosureScope = {
  key: string;
  surface: "chat" | "goal" | "scheduled" | "run";
  sessionId?: string;
  goalId?: string;
  runId?: string;
  queryHash: string;
};

type ConversationSourceCut = {
  source: ConversationFactKind;
  cursor?: string;
  status: "complete" | "partial" | "unavailable" | "ephemeral" | "incompatible";
  reasonCode?: string;
  ignoredUnknownCount?: number;
};

type ConversationCoverage = {
  state: "complete" | "partial" | "degraded";
  reasonCodes: string[];
};

type ConversationAttemptControl = {
  requestId: string;
  turnId: string;
  attempt: number;
  sequence: number;
  operation: "begin" | "reset" | "supersede" | "accept";
  supersedesAttempt?: number;
  acceptedMessageId?: string;
};

type ConversationLiveContentDelta = {
  schemaVersion: 1;
  requestId: string;
  turnId: string;
  attempt: number;
  sequence: number;
  channel: "answer"; // the sole renderer-consumed live answer channel
  text: string;
};

type ActiveConversationAttempt = {
  requestId: string;
  turnId: string;
  attempt: number;
  lastSequence: number;
  answerText: string; // process-recoverable renderer-reload snapshot
};

type ConversationDisclosureSnapshot = {
  schemaVersion: 1;
  projectionVersion: number;
  scope: ConversationDisclosureScope;
  generation: string;
  cursor: number;
  sourceCuts: ConversationSourceCut[];
  coverage: ConversationCoverage;
  activeAttempts: ActiveConversationAttempt[];
  items: ConversationDisclosureItem[];
};

type ConversationDisclosureDelta = {
  schemaVersion: 1;
  projectionVersion: number;
  scopeKey: string;
  generation: string;
  fromCursor: number;
  toCursor: number;
  sourceCutChanges: ConversationSourceCut[];
  coverage?: ConversationCoverage;
  attemptControls: ConversationAttemptControl[];
  upserts: ConversationDisclosureItem[];
  removals: string[];
  resetRequired?: true;
};
```

- Snapshot items, source cuts, active attempts, coverage, and cursor are
  captured under one per-scope materialization queue boundary. This is atomic
  projection state, not a fabricated cross-store transaction or causal clock.
- Scope key and query hash prevent a cursor from being replayed into another
  session, surface, filter, or projection version.
- Generation mismatch, cursor gap, incompatible required fact, or a coverage
  change that cannot be expressed as a typed delta sets `resetRequired`; the
  consumer atomically replaces its prior scope from a new snapshot.
- A bounded per-scope delta ring retains a characterized number/age of semantic
  updates. Ambient updates for the same item may coalesce. Gates, attempt
  controls, coverage degradation, and terminal settlement are never dropped;
  buffer pressure rotates the generation and requires reset.
- Every live answer token/output part belongs to exactly one
  `(requestId, turnId, attempt, sequence)`. Controls and live deltas share the
  attempt sequence boundary; duplicates are ignored and a gap requests the
  active-attempt snapshot. `reset` removes all unaccepted partial content for
  that attempt; `supersede` closes it before the next `begin`; `accept` is
  published only after the final assistant message persists and names that
  message. Renderer assembly consumes `ConversationLiveContentDelta` only;
  cumulative output parts are projector inputs/evidence and never appended a
  second time. Window reload may restore the process-live active-attempt
  snapshot. Main restart and final reload use the accepted durable message,
  never abandoned live partials.
- Semantic gates and terminal settlement publish after required domain
  persistence. Content summaries may batch in a microtask; visual-only updates
  may batch to an animation frame.

## Domain Adapter Rules

### Chat

- Preserve main-process message/history authority and request idempotency.
- Preserve every successfully committed Chat event; the 80-item activity view
  remains a compatibility snapshot, not forensic history.
- Add the typed attempt control stream before exposing retry partials.
- Persist a stable evidence-run reference on the assistant result or a
  first-class turn projection so reload can reach execution evidence.
- Keep the transcript narrative safe; technical output is loaded by stable
  reference instead of destructively erased from all product access.

### Goal and Plan

- Goal acceptance/certificate state always outranks model-authored text.
- Plan and Goal retain their stores, revisions, and lineage.
- Plan stage/round events gain a read projection or adapter; they are not
  converted to per-turn Todo.
- Their adapters preserve exact domain status and apply the exhaustive mapping
  above. Renderer projection may summarize but never recompute terminal,
  acceptance, action-gate, or adoption truth.

### Scheduled and AgentRun/Trajectory

- Adapt the existing streaming Scheduled path; do not create a second runner.
- AgentRun/Trajectory remains the production Runs evidence authority.
- Live changes must be cursor/snapshot based to avoid refetch storms.
- Scheduled is a first-class typed fact kind. It may contribute to a Chat group
  but keeps its own run id and surface scope.

### Workspace Run

- It remains a file-backed evidence boundary, not the universal fact store.
- Required pause propagation and nonterminal snapshot transition must be
  characterized and repaired before it contributes complete coverage.
- Workspace Run writes that participate in settlement must be awaited or the
  projection must declare degraded coverage.

### Approval and Tool Invocation

- ToolAuthorizationService, workspace guards, and the sandbox remain
  authoritative and mandatory.
- A pending approval must share a stable causal reference with Tool Invocation.
- CD03 persists approval intent before renderer publication, records a
  monotonic decision revision, and exposes an idempotent main-process snapshot.
- Renderer/window reload while the main process remains alive restores the same
  pending request and can settle it once. Main-process restart or application
  cold start never resumes the privileged Promise or executes a previously
  approved action: persisted unresolved intent is reconciled to interrupted,
  its Tool Invocation is aborted, and Chat offers an explicit safe retry.
- Disclosure density never changes authorization scope or lifetime.

### Kernel

- Kernel may contribute live lifecycle/health signals.
- Its in-memory history, heuristic surface mapping, and timestamp-based UI
  dedupe cannot satisfy durable evidence or replay requirements.
- It is always an `ephemeral` contributor. Loss across main-process restart is
  represented in source cuts and never downgrades a durable domain settlement.

## Durability and Recovery Tiers

| Tier | Examples | Renderer reload | Main restart / cold start |
| --- | --- | --- | --- |
| durable authority | Chat events/messages, Goal/Plan, AgentRun/Trajectory, Tool Invocation, approval intent/decision | rebuild from store | rebuild; unresolved approval becomes interrupted and never auto-runs |
| process-recoverable live | active attempt assembly, live approval resolver, current scheduled stream | query main snapshot | discard partials, reconcile durable state, show retry/recovery |
| ephemeral telemetry | Kernel health and optional sampling | replay only within retained process buffer | declare ephemeral/unavailable; never fabricate history |

Guided input, Goal review/acceptance, Plan confirmation, failure, cancellation,
and terminal settlement must have a durable owning-domain fact before they are
published as settled. Context/usage adapters declare whether each measure is a
durable cumulative value or an ephemeral estimate; the UI must label partial or
estimated coverage instead of merging them silently.

## Disclosure Policy

One pure shared policy decides default presentation from lifecycle, attention,
sensitivity, volume, error, and explicit user state:

| Input state | Default projection behavior |
| --- | --- |
| Running, low risk | compact current summary; group completed operations |
| Succeeded, low risk | collapsed result summary with safe count/duration |
| Waiting for input/approval | prominent and open with exact action/scope |
| Waiting for review/acceptance | prominent and open with owning Goal/Plan state and the exact review/accept action |
| Waiting for model | visible with exact provider/domain state; compact only while no user action is possible, blocking if configuration or retry is required |
| Failed/blocked | prominent and open through first useful error/recovery action |
| Completed but unverified | visible as awaiting verification; never styled as success |
| Paused/canceled | visible settlement and available continue/retry action |
| Restricted | redacted summary; detail only through authorized evidence query |
| User-open/pinned | remains open until the user closes it |
| Unknown optional presentation | generic evidence row with stable source ref |
| Unknown required fact | incompatible/degraded coverage; never silently hidden |

User choice outranks automatic folding. Blocking, failure, and needs-attention
states outrank density. The default summary is host-authored and must answer:
status, safe action/object/source, first useful result/error, and count/duration
when known.

## Reasoning and Sensitive Evidence

Reasoning passes five separate gates:

```text
provider available
  -> host persistence allowed
  -> client delivery allowed
  -> viewer authorized
  -> UI display allowed
```

- Zerox makes no promise to persist or display private raw chain of thought.
- Safe host-authored process summaries are the default.
- Raw tool arguments/output and file excerpts stay behind existing permissions,
  bounded loading, truncation/offload, and secret masking.
- Credentials are never intentional disclosure facts and must fail final secret
  scans if present.
- Tool Audit stays sanitized authorization evidence, not execution truth.

## Evidence Access

`ConversationEvidenceTarget` references an existing domain record by stable id.
The main process resolves it through a bounded, redacted query. A target may:

- navigate to an AgentRun/Trajectory record;
- select a tool invocation/call/result;
- open a Goal/Plan/checkpoint record;
- show an authorized generic evidence payload when no specialized presenter is
  available.

The renderer never parses Chat text or DOM to find evidence. Missing or removed
specialized presentation fails soft to a generic item. An unknown required
persistent fact fails closed with an incompatible/degraded coverage signal.

Every resolver response includes target schema version, outcome, sensitivity,
redaction/truncation metadata, and the current authority revision. Navigation
does not itself grant detail access; the main process reauthorizes each load.

## Compatibility and Cutover

Delivery uses three modes:

1. `legacy`: current UI and persistence behavior;
2. `shadow`: build and compare the new projection without changing the UI;
3. `projected`: renderer consumes the accepted projection.

Each domain adapter enters shadow mode before a surface cutover. Existing
released data is read without destructive migration. Legacy sessions with
missing identity receive deterministic compatibility refs and partial coverage.
No rollback deletes Chat events, messages, Goal/Plan records, runs,
trajectories, tool records, checkpoints, or artifacts.

CD02 builds a fixture-driven pure projector and does not claim production
parity. CD03 connects the causal Chat/Tool/approval/Workspace Run spine and
starts shadow comparisons. CD04 connects the bounded remaining adapters and
must produce accepted shadow-parity and performance-baseline artifacts before
CD05 starts. Parity requires zero missing required facts, lifecycle mismatches,
restricted-data leaks, or duplicate stable identities; every optional
difference is classified and allowlisted with source-cut evidence.

CD05 renders projected Chat only behind a local default-off kill switch. CD06
and CD07 have independent default-off surface switches. No projected surface
becomes the release default before CD08 performance/compatibility gates and
CD09 independent real-application acceptance. Each switch returns to legacy
without rewriting authoritative or projection data.

P105 creates governance only and changes no production cutover mode.

## Performance and Accessibility

- Characterization establishes a reproducible Zerox baseline before numeric
  budgets are frozen; attachment percentages are not accepted.
- CD04 freezes CPU/heap/DOM, snapshot-size, delta-buffer, publication-latency,
  and reset-rate budgets in a machine-readable baseline before any renderer
  projected mode can be enabled, even for acceptance.
- Tests measure projection CPU/heap separately from rendered DOM.
- Deltas update stable target rows; long evidence uses paging/virtualization and
  bounded raw payloads.
- Backpressure may coalesce ambient updates but never gates, attempt controls,
  coverage degradation, errors, or terminal settlement.
- Streaming tests include duplicates, gaps, out-of-order delivery, reload,
  attempt supersession, and a final-message reconciliation check.
- Buttons, disclosure state, selected evidence, and blocking attention are
  keyboard and screen-reader discoverable.
- Reduced-motion mode removes nonessential transition motion without hiding
  lifecycle changes.

## Rejected Alternatives

- Add more `<details>` blocks inside `AgentChatPanel`.
- Promote Workspace Run, Kernel, Chat activity, or Tool Audit into a universal
  physical fact store.
- Copy DeepSeek's WebSocket/Host/plugin topology or pre-release disk policy.
- Persist/display complete reasoning because a provider exposes it.
- Treat virtualized DOM as the entire long-session performance solution.
- Replace Goal/Plan with turn-local Todo.
- Infer evidence identity from text, timestamps alone, or current array order.

## Consequences

Positive:

- one testable disclosure policy and stable evidence identity;
- renderer no longer arbitrates domain truth;
- default Chat stays concise while evidence becomes reachable;
- partial/degraded history is honest;
- existing authorities, permissions, and released data remain intact.

Costs:

- each domain needs an explicit adapter and compatibility tests;
- Plan/Scheduled/approval require new read/replay projections;
- shadow comparisons and dual paths temporarily increase implementation size;
- long-session and real-app acceptance become mandatory release work.

## Program Gate

Implementation follows `.zerox/conversation-disclosure-program.json`. Exactly
one Feature may be unfinished. Runtime changes cannot start until P105 passes
independent architecture review, program/harness checks, and freezes the real
application scenario matrix.
