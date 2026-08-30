# CD03 Decision: Durable Conversation Causal Spine

Status: Implemented; acceptance status is owned by the CD03 review artifact

Date: 2026-08-18

Parent decisions:

- `.zerox/decisions/CD01-conversation-disclosure-program.md`
- `.zerox/decisions/CD02-conversation-disclosure-contract.md`

## Scope

P107 repairs the lifecycle and causal persistence paths that must be true before
the broad CD04 domain adapters can project them. It does not cut over the
conversation disclosure projection. It does add two narrow lifecycle-recovery
surfaces that cannot safely wait for CD04: typed retry-attempt controls in the
existing Chat stream reducer, and a subscribe-first pending-approval snapshot.
It does not replace Chat, Goal, Plan, Tool Authorization, Tool Invocation,
Agent Run, Trajectory, or Workspace Run authority.

The causal spine records stable references and durable interaction intent. It
must not become a universal copy of raw domain payloads.

## Diagnosed Root

The current Chat status emitter has two persistence paths. Ordinary `send()`
publishes to both Chat activity and the Workspace Run recorder through
best-effort fire-and-forget writes. Required `sendRequired()` first awaits only
Chat activity, then publishes with generic persistence disabled; required
AgentLoop/provider pauses therefore omit the Workspace Run event. Separately,
Workspace Run snapshots change only through terminal `finishRun`, so an
ordinary paused event can coexist with a `running` snapshot.

Assistant messages are durable before terminal stream publication, but that
message receipt is not yet a first-class causal record shared with retry
attempts and evidence refs. Tool approval requests are process-memory entries:
publication precedes any durable intent, window reload has no authoritative
snapshot, and process restart loses the pending request.

## Frozen Authority And Data Contract

The owning stores remain distinct:

- `ChatSessionStore` owns user and assistant messages plus Chat activity.
- `WorkspaceRunStore` owns Workspace Run events and lifecycle snapshots.
- `ToolAuthorizationService` remains the only authority that can turn an
  approval result into permission to execute.
- `ToolRuntime` remains the only production boundary that combines
  authorization with tool dispatch. It replaces caller-supplied authorization
  proof with the audit receipt produced by the authorization it just performed.
- `ConversationCausalStore` owns only stable references, attempt controls,
  accepted-message receipts, approval intent state, and disclosure coverage.

The causal store must not contain raw prompts, assistant content, tool
arguments, tool results, private reasoning, credentials, or copied Goal/Plan
payloads. Its attempt key is `(requestId, turnId, attempt)`, with `sessionId`
bound as soon as Chat persistence resolves it. The record keeps distinct
optional refs for `agentRunId`, `trajectoryRunId`, `workspaceRunId`, Tool
Invocation ids, approval ids, guided-input ids, and evidence refs. A
Trajectory run id is never relabeled as an Agent Run id.

The request claim is global to `requestId` and its exact input fingerprint;
caller window/session identity is routing context, not a second execution
identity. `sessionId` and the durable user message id bind only after the user
message exists in `ChatSessionStore`. A configured causal store without that
proof cannot start model or tool execution. An exact duplicate without an
accepted message returns or waits for reconciliation and never starts another
execution. An unbound claim never reads a caller-routed session for a user or
assistant message; only the claim-owned durable session may supply replay data.

When an existing claim is returned, its durable `sessionId` is adopted before
handling either duplicate or conflict. All failure terminal publication and
Kernel activity therefore target the claim owner rather than a stale caller
routing id.

Kernel admission is fail-closed. After valid input is prepared, the request is
claimed and the new `kernel_run` ref must commit before the Production Kernel
driver may emit `run_start`. A rejected ref mutation therefore creates no
Kernel event; duplicate, conflict, and reconciliation branches all inherit the
already durable ref. A claim-owned early failure with a durable session emits
one required failed activity and one matching failed terminal before returning.

Chat input preflight is outside the Kernel execution boundary. Cancellation is
checked both before and after every asynchronous routing lookup; attachment
validation, empty-message rejection, and Plan-image restrictions also complete
before a causal request claim or Kernel event is created. The same typed
prepared input is then consumed by Kernel and non-Kernel execution, so
validation is not repeated and a rejected input cannot create an orphan
`run_end`.

The exact fingerprint uses the separately versioned
`sha256-type-tagged-v2` algorithm: a type-tagged canonical encoding and
SHA-256. `undefined`, strings, bigint, numeric edge cases, arrays, and objects
have distinct encodings; object key order is canonical. New claims always
persist the algorithm version. Unversioned 64-hex claims are inferred as v2;
older unversioned/16-hex claims are inferred as
`fnv1a64-canonical-v1` and compared only with the reproduced legacy digest.
A matching legacy claim may return or reconcile an already durable result with
degraded coverage, but it never authorizes a new execution. If no durable
assistant exists, every entry point—including guided-input recovery—returns a
conflict that requires a new request. This gate is independent of whether the
user-message append is skipped. A legacy mismatch also conflicts. The older
compact 64-bit disclosure/event fingerprint is not an acceptable identity for
any new request claim.

The input fingerprint covers every execution-affecting `SendChatMessageInput`
field: normalized message, mode, Plan mode/autonomy/model assignments, selected
skill, workspace identity/summary, ordered history, attachment metadata, and a
content fingerprint of each validated attachment payload. Attachment bytes are
hashed before the causal write and are never copied to the causal store.

Attempt control uses its own monotonic sequence. It does not reuse the mixed
Chat status/text stream sequence. `begin`, `supersede`, `reset`, and `accepted`
are emitted only after their causal mutation settles. Model-originated answer,
thinking, and tool-preview events carry an attempt. The renderer removes
superseded transient text/thinking/previews, ignores late old-attempt events,
and rejects all deltas after acceptance. A missing wire sequence or a direct
switch to a new attempt is also a conservative transient reset, so a lost
`supersede` control cannot concatenate rejected and accepted answers. Persisted
Tool Invocation and evidence parts are not deleted by this transient reset.

Approval intent is a revisioned state machine:

`pending -> approved | denied | timed_out | aborted | interrupted`

`pending` is revision 1 and a terminal decision is revision 2. A decision CAS
returns `applied`, `duplicate`, `conflict`, or `not_found`. Same decision id and
same outcome is duplicate success; a different decision or outcome conflicts.
The durable record stores a secret-safe bounded summary and causal refs, never
the raw request. Durable approval records are evidence only: no startup or
executor path may consume a stored `approved` record as a grant.

## Frozen Ordering

1. Persist the request claim and, for a Kernel invocation, its exact
   `kernel_run` ref before Kernel admission. Persist attempt begin before the
   first live answer delta. A retry durably supersedes the old attempt before
   the new begin.
2. Ensure the deterministic Workspace Run by validating its original
   session/request envelope; a matching replay reattaches and a sanitized-id
   collision fails closed.
3. Ordinary status writes enter one ordered per-turn queue. Progress may publish
   immediately, but Chat/Kernel return awaits the queue drain.
4. `waiting_for_input`, `waiting_for_approval`, and all pause states are
   required settlements: Chat activity and Workspace Run event/snapshot settle
   before publication.
5. Persist the assistant message first, including the bounded turn settlement
   status `succeeded | paused | failed`. Then create a role-checked receipt that
   binds request, turn, attempt, message id, assistant role, content fingerprint,
   and the same settlement status. Persist the accepted attempt before terminal
   publication.
6. Workspace success settlement follows the accepted assistant receipt only for
   a `succeeded` Chat turn. Paused and failed receipts preserve their matching
   lifecycle; legacy receipts without a status never upgrade Workspace success.
   A legacy replay returns explicit `unknown`, which Kernel and renderer both
   treat as paused/reconciliation-required rather than success. Kernel marks
   this as `reconciliationRequired`; it must not claim
   `continuationPersisted` when no continuation exists. Known paused routes may
   instead carry a true continuation receipt, and the two proofs are mutually
   exclusive. The terminal stream and Kernel settlement use the same durable
   status when it is known.
   `answer_delta` is the only live answer-text channel; text output parts are
   assembled and persisted for reload but are not a competing live answer.
7. Persist approval intent, register its waiter/timer/abort listener, and only
   then publish to the renderer. A decision is durably CAS-settled before it can
   resolve the in-process authorization promise. Renderer publication is
   best-effort after durable state and may not strand the promise.
8. Window reload uses subscribe-first recovery: the renderer registers request
   and decision listeners, then pulls a pending snapshot and merges by
   `approvalId + revision`. A revision-2 terminal tombstone dominates stale
   revision-1 push or snapshot data. Correctness does not depend on a one-shot
   `did-finish-load` push. Main-process startup interrupts prior-process pending
   intents before Goal/task recovery or scheduler startup; it never recreates
   an authorization waiter.
9. The Chat Kernel wrapper records the latest emitted status, stream terminal,
   and their resolved session identity. A persisted `waiting_for_input` status
   settles as paused; an emitted canceled/failed terminal settles with the same
   state. Result codes are only a compatibility fallback when no authority
   event exists. Required terminal activity is written to the emitted durable
   session, never a stale caller routing id. Duplicate, fingerprint-conflict,
   legacy-gate, and accepted-receipt-conflict exits share the same claim-owned
   durable failure boundary whenever the claim already owns a session. An
   existing claim without a bound durable session never adopts the caller
   routing id and cannot reconcile a caller-supplied assistant. Missing or
   failed Chat activity persistence produces a terminal whose session id is
   explicitly transport-only (`domainStateAvailable: false`), degraded causal
   coverage, and Kernel `noDomainStateCreated`. Kernel settlement receives the
   durable session through an internal proof callback rather than interpreting
   any string value as a sentinel; every string remains a valid Chat session id.
   The renderer may consume that terminal to close transient output, but must
   not adopt its routing id into active durable session state.
10. Each admitted Kernel wrapper invocation receives a collision-safe run id
    built from a fresh UUID nonce and type-tagged SHA-256, rather than lossy
    sanitized session/request concatenation. When the causal adapter is
    present, the actual `kernel_run` ref must commit before the driver starts;
    failed persistence prevents the invocation rather than degrading a
    coverage flag after `run_end`. An
    `agent_run` ref is recorded only when an owning `AgentRunRecord` actually
    exists (for example a Scheduled task launched from Chat), and is attached
    immediately when that record returns, before assistant persistence.
    Normal AgentLoop execution keeps its real Trajectory ref and is never
    relabeled as an Agent Run.

## Recovery And Compatibility

- Same event/intent/decision ids and canonical fingerprints are idempotent;
  conflicting replay fails closed and requests reconciliation.
- Window reload may merge presentation for the same pending interaction id,
  but cannot execute it. A resolve request includes expected revision and a
  stable decision id; the renderer does not optimistically hide a prompt when
  durable resolution fails.
- Cold start interrupts unresolved approval and live attempt intent. A new
  explicit attempt is required.
- A message-first/receipt-second crash is reconciled from the durable assistant
  message's role, request id, id, content, settlement status, and deterministic
  turn id; the model and tools are not rerun. A legacy message without status is
  readable but remains degraded and cannot prove success.
- If an existing accepted receipt conflicts with the durable assistant, the
  owning session receives a durable failed activity and terminal. The conflict
  never reruns execution and never changes routing identity into a fabricated
  session.
- Legacy records without causal ids stay readable and are classified partial;
  legacy request-claim digests are version-inferred and matched read-only with
  degraded coverage; no migration rewrites existing Chat or run logs.
- P107 remains shadow-only for disclosure. CD04 consumes the spine after causal
  comparison evidence passes.
- A request claim left unbound by user-message persistence failure remains
  globally non-executable. Duplicate recovery emits a transport-only failed
  terminal, preserves one Kernel ref/run-end pair, and never reads from or
  writes failure to a routing-only caller session.

## Workspace Run Settlement

`WorkspaceRunStore.ensureRun` is idempotent for the exact original envelope.
`settleLifecycle` owns a single serialized mutation that appends one stable-id
event and updates the projected snapshot for `running`, `waiting_for_user`,
`waiting_for_approval`, `paused`, or a terminal state. Same id/same canonical
event is a no-op; same id/different event conflicts. A terminal run never
returns to a nonterminal state or changes to another terminal state.

The JSONL event and snapshot files are not described as transactionally atomic.
Each newly settled event carries a store-owned canonical `lifecycleStatus` that
binds the event id to its snapshot target. The event is the repair witness:
after a crash between writes, the next read or settlement repairs the snapshot
from the latest lifecycle witness, including specialized approval/tool events.
`finishRun` is also a settlement and must repair before attempting its terminal
transition; it cannot overwrite a durable success witness with a competing
failure. Legacy generic status events remain a compatibility fallback.

Exact event identity is checked before lifecycle transition legality. A replay
of an older, byte-equivalent event remains a duplicate after a later terminal
event and leaves the repaired latest snapshot unchanged. The same id with a
different canonical event still conflicts, and a new late event still cannot
regress a terminal snapshot.

## Required Failure And Review Closure

`domainStateAvailable: false` is event-package provenance, not a terminal-only
hint. It may appear on status and any stream event. One request-local,
monotonic publication authority owns the proof for Main and Kernel together:
`route_only -> durable(sessionId,userMessageId) -> invalidated`. A session id
alone is legacy/routing metadata. Only the exact pair naming a persisted user
message establishes durable authority, and invalidation cannot be reversed.
If a failure occurs before proof or after invalidation, its direct status,
status stream envelope, diagnostic output part, and terminal all carry the
negative provenance. Renderer consumers may reduce those events to close
transient UI, but no channel in that packet may update durable session identity.

A required Chat/Workspace settlement is a fail-closed saga. Ordinary progress
remains best-effort. For required pause, waiting, approval, or checkpoint state,
both owning stores must settle before publication. If either write rejects, the
original state is not published, a secret-safe failed settlement is attempted
in Chat and Workspace, the live continuation is removed, the active causal
attempt is interrupted, and the operation returns failed. The Kernel must not
claim `continuationPersisted` for this path. The thrown settlement error has a
fixed public message and typed reason code; it never retains or projects the
raw storage exception. Store-specific failure detail is represented only by
bounded causal coverage reason codes.

The first real Tool Invocation identity is awaited before ToolRuntime may
authorize or dispatch. A configured causal store must return `applied` or
`duplicate`; any other disposition or rejection fails the Agent loop before
execution. A Chat-launched Scheduled AgentRun exposes its allocated identity
through an awaited runner admission hook. The causal `agent_run` ref must be
`applied` or an exact `duplicate` before workspace resolution, model profile,
checkpoint, Kernel, Agent loop, or tool work begins. The returned run id must
match the admitted id; a runner that skips or changes the handshake cannot
produce an accepted assistant. Optional causal-adapter absence remains legacy
partial coverage.

CD03 completion is governed by its declarative `completionContract`. The
checker recomputes canonical-JSON SHA-256 for every immutable P107 Feature
file, the Feature allowlist, artifact claims, and the contract. Frozen paths
must be ordinary non-symlink files, including every parent segment. The exact
executable closure (`package.json`, the harness entrypoint, and this program
checker) is immutable, the shared review-contract module is frozen in the same
Feature file set, and the disclosure checker executes first in the harness.
Contract, runtime, and governance review lanes must each produce a unique
challenge-bound collaboration receipt for the same digest with zero Critical
or Major findings. The closure manifest binds those receipts, the external
snapshot, and executable hashes. Final closure must run from a digest-pinned
verifier whose realpath is outside the candidate repository; candidate-local
copies are rejected. The resulting attestation is an external execution
anchor, not a cryptographic signature by the reviewer subjects. An artifact
that is missing, `review_pending`, stale, locally self-asserted, or reviewed
against a different digest cannot unlock CD04.

## Round 13 Closure Invariants

The twelfth frozen review exposed one remaining systemic defect: ownership,
publication, and settlement were individually typed but could still be entered
through separate lifecycle paths. Round 13 closes that gap with one admission
and settlement protocol rather than path-specific repairs.

- A legacy record containing only `sessionId` is permanently route-only. It can
  never be upgraded by a later user-message id. Exact request binding requires
  the persisted `(sessionId, userMessageId)` pair at creation.
- Persisted assistant replay reads its own `turnId`, `causalAttempt`, and
  `causalAttemptId` witness before any new attempt, Workspace Run, or Kernel
  fact. An exact witness reconciles only the original active/interrupted
  attempt. A legacy assistant without a receipt-owned attempt is read-only and
  cannot mutate the causal record.
- Every successful durable status, stream event, and successful result carries
  explicit `domainStateAvailable: true`; every route-only or invalidated packet
  carries `false`. Absence is never interpreted as positive proof.
- `waiting_for_input`, `waiting_for_approval`, checkpoint, paused, failed, and
  canceled states use one required-settlement coordinator. Prepare freezes the
  attempt, source sequence, target, guided-input id, canonical required domains,
  and the complete normalized Chat event after its deterministic `settlementId`
  is attached. Attachment payloads contribute content digests rather than raw
  bytes. Chat and Workspace sinks are idempotent by `settlementId`; commit
  requires that exact Chat fingerprint and every declared Workspace receipt.
  Duplicate committed rows do not rewrite sinks, while exact preparing rows
  perform bounded receipt reconciliation.
- A partial required write becomes a failed journal row that preserves any Chat
  receipt already written. Guided input also receives a terminal tombstone with
  the original settlement id. Cold-start recovery accepts only an exact
  committed waiting settlement; preparing rows are failed with
  `RECOVERY_INCOMPLETE`, tombstoned, and never executed. A persisted
  `processing` lease is never replayed after restart.
- Configured Workspace initialization failure is a fail-closed execution gate.
  It emits only a bounded secret-safe failure and starts no model, tool, or
  AgentRun work. Missing optional adapters remain explicitly partial.
- A Scheduled AgentRun receives one stable id and one owning admission lease.
  The `agent_run` ref and admission fact are atomic and precede any run event,
  workspace resolution, checkpoint, model, Kernel, or tool work. The lease must
  settle exactly once as `succeeded`, `paused`, `failed`, or `canceled`; Chat
  result, assistant input, required status, and causal admission retain that
  same terminal state rather than collapsing it to success. One shared terminal
  commit boundary persists the owning `AgentRunRecord` before settling the
  lease; task timestamp and learning projections run afterward as best-effort
  derivatives. They cannot leave a durable owner at `started`, settle without
  an owner, or trigger a second conflicting terminal record. If causal lease
  settlement itself rejects after owner persistence, a typed secret-safe
  post-commit error crosses Kernel. Kernel emits one sanitized failed
  `run_end` and explicitly bypasses `settleFailed`, because re-entering that
  callback would attempt to append a second terminal AgentRun.
- Duplicate request and conflict exits occur before Kernel construction and
  before owner lifecycle publication. Concurrent duplicates therefore cannot
  create a second status stream, terminal, Workspace Run, AgentRun, or Kernel
  run.
- Kernel fallback failures use the same required-settlement journal as normal
  required states. The Kernel may claim `requiredStatePersisted` only after all
  declared receipts commit. Raw exception messages are replaced with the
  bounded `SecretSafeFailure` contract before persistence, stream publication,
  result construction, or `run_end`.

These invariants remain shadow infrastructure for P107. They repair lifecycle
truth consumed by the existing renderer, but do not enable the CD04 disclosure
projection or the CD09 browser acceptance surface.

## Round 14 Transaction And Recovery Boundary

The independent Round 13 review rejected the frozen implementation even though
all local gates and byte hashes passed. The remaining defects share one cause:
an owning fact, its causal identity, required domain receipts, recovery, public
projection, and review acceptance still had different commit authorities.
Round 14 therefore replaces inferred completion with typed proofs and startup
reconciliation.

- A decisive Chat state is staged until its owning Chat/Workspace/causal facts
  are durable. Kernel adapters buffer completed/failed/canceled status and
  terminal projection until settlement returns an exact proof. If only a
  partial fact exists, the Kernel records `settlementRecoveryRequired`; it does
  not claim either `requiredStatePersisted` or `noDomainStateCreated`.
- Required settlement identity contains the complete normalized Chat fact and
  deterministic Workspace identity. `approvalId` is part of both persistence
  and fingerprint identity. A failed protocol row requires a typed failure
  code; a committed row forbids one.
- Startup runs storage convergence, required-settlement reconciliation,
  AgentRun admission reconciliation, approval interruption, and active causal
  attempt recovery in that exact order before IPC is registered. Required
  settlement recovery probes deterministic Chat and Workspace ids,
  read-after-error reconciles exact writes, commits only matching receipts, and
  otherwise writes safe recovery-required truth with
  `domainStateAvailable:false`; causal-authority read/write failure aborts
  startup. Guided input is no longer a special recovery authority.
- Assistant acceptance is monotonic. Only the latest attempt may be accepted,
  and a committed failed/canceled settlement prevents a late assistant from
  reviving that attempt. Older durable messages remain historical evidence.
- AgentRun ownership is divided into `executionRevision`s under one stable run
  id. Initial execution is revision 1; only the latest settled paused owner may
  acquire revision +1. One shared CAS classifier rejects stale, gapped,
  changed-duplicate, nonterminal, and competing terminal writes at JSON,
  SQLite, dual-shadow, repository, migration, and episode-export boundaries.
  Startup reconciles owner-before-settle and aborts admission-without-owner.
  Observer, task, learning, and memory callbacks are non-authoritative and
  secret-safe.
- Approval intent and its causal ref are written by one causal-store mutation.
  Historical orphan pairs are interrupted or degraded during startup and can
  never recreate an executable permission.
- Local program and harness checks are consistency gates, not self-authenticating
  proof. Closure uses exact digest-bound review receipts plus a verifier invoked
  from outside the candidate repository with operator/platform-visible expected
  hashes. Without that out-of-band anchor, CD03 remains `review_pending`.

These changes remain within P107 shadow/lifecycle scope. They do not enable the
CD04 renderer projection or use the credential-backed browser acceptance path.

## Failure Policy

An absent optional Workspace/causal adapter preserves safe legacy Chat but
records partial coverage. A configured adapter that rejects produces degraded
coverage and must not be reported as complete settlement. A configured causal
adapter's Kernel-ref mutation is an admission gate: failure prevents Kernel
startup because a post-hoc degraded flag cannot restore run/ref parity.
Missing required Chat continuation or request-user persistence fails the
operation because recovery would be unsafe.

Approval persistence is a privilege boundary, not optional observability:
intent persistence failure prevents prompt publication, and approved-decision
persistence failure resolves as denied/failure. An ambiguous commit is read
back for audit but still resolves the in-process waiter fail-closed; a durable
`approved` record is not itself a capability. No approval path, including Git
worktree creation, is allowed to bypass `ToolAuthorizationService`/`ToolRuntime`
or fall back to memory-only permission. Worktree dispatch receives only the
store-owned ToolRuntime audit receipt, never a caller-forged marker. The
Workspace service verifies the receipt against the durable audit event, allowed
decision, fixed task/tool names, and a SHA-256 fingerprint of the exact
canonical name/repository/branch request, then atomically consumes it before
invoking Git. A receipt is a linear capability: only one dispatch may claim it
across concurrent callers, restart, and supported JSON/SQLite/dual backend
switches. Every backend first competes for the same exclusive cross-instance
filesystem claim marker. SQLite/dual additionally records a unique repository
claim, and dual mirrors it to JSONL; a pre-marker dual JSONL claim is also
recognized during downgrade. A crash after either claim but before Git is
fail-closed rather than replayable. A typed Workspace envelope collision also
fails closed; an unrelated configured Workspace storage failure preserves safe
Chat only with degraded causal coverage.

## Round 17 Exact Revision And Assistant Success Commit

Startup AgentRun reconciliation is an exact-revision comparison, not a replay
authority. A latest owner snapshot may settle only an `admitted` or `started`
causal lease with the same execution revision. An owner ahead of the causal
lease proves a missing admission chain, so reconciliation aborts the unchanged
causal revision with `AGENT_RUN_REVISION_GAP`; it never copies the owner
revision forward. The next revision remains legal only when
`beginAgentRunResume` already durably advanced the causal lease by exactly one.

Successful assistant acceptance uses one recoverable three-boundary protocol:

1. After the assistant message is durable, causal prepare freezes the exact
   accepted-message receipt, required domains, Workspace owner, and a
   deterministic Workspace success event id while the attempt remains active.
2. Workspace settles that exact event idempotently. A thrown write is retried
   and read back from both the lifecycle witness and repaired run snapshot;
   ambiguous authority remains `recovery_required`, never failed success.
3. Causal commit atomically publishes the attempt as `accepted` and attaches
   the exact Workspace run/event refs. A thrown commit is retried and read
   back. If it remains unresolved after Workspace success, Chat withholds the
   accepted control and decisive success status, while Kernel settles paused
   with explicit reconciliation required. Exact duplicate replay, including
   after restart, completes the prepared commit without model or tool replay.

A prepare conflict or failure occurs before Workspace success and follows the
normal failed-settlement path. Once Workspace success may be durable, no
compensation path is allowed to publish causal or Kernel failure; only exact
commit or reconciliation-required is legal. Startup active-attempt interruption
therefore leaves an exact prepared assistant acceptance intact: it represents
commit recovery, not executable model intent.

## Round 21 Governance Publication Boundary

Review closure is a recoverable publication protocol, not a sequence of
best-effort path writes. The canonical freezer and the repository-external
closure runner use the same root-owned OS bridge. Every governance leaf must be
a regular, unique-link file owned by the effective user with mode `0600`.
Crash-created deterministic temporary bytes may resume only when those metadata
hold and the bytes are a strict prefix of the exact canonical payload; exact
bytes with weaker metadata and unrelated or aliased bytes fail closed.

Publication commits relative to an already opened directory descriptor and
uses only atomic exchange or no-replace primitives. A replaced or retired leaf
moves through `active -> tombstone -> immutable completed marker`; no verified
leaf is later removed by a blind basename unlink. The completed marker retains
the original transaction inode, and its name binds canonical byte digest plus
device and inode. Leaf or parent swaps must preserve both the recorded inode and
the substituted inode before the enclosing transaction rejects or retries.
Platforms or filesystems without the required atomic primitive fail closed.

Closure requires exactly one private completed marker for each applicable
freeze or external-publication transaction. The checker validates the complete
prepared-v1 transaction schema, its canonical digest, and every binding that is
still independently re-provable from the accepted snapshot or published
outputs. The external runner first validates the live freeze marker with one
file-descriptor capture, then reconstructs an equivalent inode-bound marker in
each isolated checker/harness control tree and revalidates both live and staged
identity after candidate execution. Missing, duplicate, minimal, stale, or
identity-swapped markers cannot authorize completion.

## Round 22 Temporary Durability Boundary

A deterministic publication temp exists as soon as exclusive creation
succeeds. A private regular, single-link, effective-user-owned, mode-`0600`
temp whose bytes are empty or a strict prefix of the canonical payload is
therefore a recoverable state, not an irrecoverable conflict. Recovery reopens
that exact leaf with `O_NOFOLLOW`, validates identity and metadata on one file
descriptor, appends only the missing suffix, fsyncs it, and recaptures the same
descriptor before publication.

Complete bytes are not proof that the creating process reached its first file
fsync. Every pre-existing exact temp follows the same reopen path, receives a
fresh `fsync`, and is then identity/metadata/digest revalidated on the same file
descriptor before any atomic move. Freezer and external-runner fault injection
covers a crash immediately after temp creation, after the final write but before
fsync, and after recovered-exact fsync; recovery must preserve device/inode and
converge idempotently.

## Round 23 AgentRun Owner-Before-Derivative Boundary

Episodic memory, its post-terminal live notice, task timestamps, and learning
candidates are derivatives of a terminal AgentRun; none is the owner. Both recoverable and
legacy paths must first pass the shared `commitAdmittedAgentRun` boundary, which
persists the exact secret-safe `AgentRunRecord` and settles its matching
executionRevision lease. Only after both operations succeed may any derivative
callback begin.

A pending derivative may delay the caller result but cannot leave admission at
`started`, and a failed owner append or lease settlement starts no derivative.
Derivative success or failure cannot rewrite the already persisted owner or
change its lease status. Secret-safe live notices remain projections after the
commit; they are not appended back into the authoritative terminal record.
Both implementations are covered by a held-open memory promise that observes a
durable terminal owner and settled exact lease before release, plus append- and
settle-failure cases that permit no memory call.

## Security And Privacy

The spine stores no raw tool arguments, file content, provider credentials, or
private reasoning. Approval arguments and task labels are credential-redacted,
single-line, and UTF-8-byte bounded in both the coordinator and store write
boundary. The causal store re-sanitizes both `taskName` and `safeArgsSummary`
instead of trusting its caller; the raw human label exists only in the live
renderer request.
Execution still goes exclusively through `ToolAuthorizationService` and
workspace guards.

## Verification And Rollback

Focused tests must cover required/ordinary pause settlement, queue drain,
Workspace event/snapshot repair, duplicate/conflicting event ids, terminal
non-regression, guided-input reattachment, assistant receipt ordering,
message-first crash reconciliation for success/pause/failure, Goal request
lineage, cross-layer retry supersede/reset/accept, subscribe-first approval
reload, decision ambiguity, cold-start interruption, distinct run identities,
safe task/argument summaries, type-confusion request collisions, missing retry
controls, finish-first crash repair, forged/mismatched/replayed audit receipts,
cross-backend receipt consumption, request-fingerprint version compatibility,
guided-input legacy gating, authoritative waiting/cancel/session Kernel
settlement, collision-safe concurrent Kernel identity, real Kernel/Agent refs,
receipt-conflict terminal ownership, AgentRun ref survival across assistant
persistence failure, synchronous and asynchronous-abort preflight rejection
without Kernel/causal facts, fail-closed Kernel-ref admission, unbound claim
recovery with missing/existing caller sessions, foreign caller assistants,
missing/failing Chat storage, valid session ids that resemble old sentinels,
renderer rejection of route-only session adoption, and honest legacy
Kernel/renderer degradation. It must also cover session-only legacy claims,
direct status provenance, total Chat settlement failure with a private canary,
pre-execution AgentRun admission in recoverable and legacy runners, exact real
artifact completion dry-run, same-byte symlink mutation, and executable harness
closure mutation.
Round 13 additionally requires table-driven Scheduled AgentRun terminal parity,
zero-side-effect duplicate admission, exact assistant attempt reconciliation,
configured Workspace initialization failure, positive and negative publication
proof, Chat/Workspace Kernel fallback journaling, guided partial-write
tombstones, and preparing-journal cold-start compensation with zero execution.
Round 14 additionally requires terminal buffering until exact required-domain
commit, monotonic/terminal-aware assistant acceptance, mandatory failed-row
codes, approval intent/ref atomicity and approval-id fingerprint coverage,
startup recovery-order and causal-failure tests, AgentRun execution-revision CAS
matrices across both storage authorities and dual-shadow repair, secret-safe
observer failures, exact external receipt/manifest schemas, and rejection of a
candidate-local closure runner.
`.zerox/verification/conversation-disclosure/CD03-causal-shadow.json` records
the no-disclosure-projection-cutover comparison and the narrow lifecycle
recovery fixes.

Rollback disables causal adapters and approval recovery while preserving safe
lineage metadata already appended. Existing Chat, Workspace Run, Tool
Invocation, and authorization data remain readable and are never rewritten.
