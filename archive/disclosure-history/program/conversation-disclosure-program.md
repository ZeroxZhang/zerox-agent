# Zerox Agent v3.9.2 Conversation Disclosure Program

## Objective

Converge Zerox's existing Chat, Goal, Plan, Scheduled, Run/Trajectory, tool,
approval, context, and recovery facts into a coherent progressive conversation
disclosure experience without weakening local-first permissions, domain
authority, released-data compatibility, or recoverability.

The machine-readable authority is
`.zerox/conversation-disclosure-program.json`. The P104 research report and
CD01 architecture decision are its evidence and decision baselines. Completed
runtime, Kernel, storage, and release programs remain immutable history.

## Control Model

1. `.zerox/feature_list.json` is the materialized Feature authority.
2. At most one Feature may be unfinished across all programs.
3. Only this program's `nextFeatureId` may be promoted to `in_progress`.
4. Planned Features enter the Feature list only when promoted.
5. Every workstream names its source findings, dependencies, rollback,
   verification, required architecture decision, completion artifacts, and
   frozen application scenarios.
6. A production surface enters shadow mode before projected mode.
7. Each completed Feature updates `.zerox/progress.md` with files and command
   evidence, then returns the program to controlled idle or promotes exactly
   one dependency-ready Feature.
8. `npm run program:check` and `npm run harness:check` validate this program in
   addition to all completed historical programs.
9. Planned Features remain absent from the Feature list; completed workstreams
   require done Features and their declared regular-file artifacts.
10. CD09 cannot complete until every scenario has real application evidence
    paths and those artifacts exist inside the repository. A canonical
    acceptance manifest binds those paths to the app build, browser runner,
    frozen fixture, requirement results, secret scan, and independent review.

## Workstream Sequence

| Workstream | Feature | Scope |
| --- | --- | --- |
| CD01 | P105 | Research closure, architecture, program, checker, scenario freeze |
| CD02 | P106 | Shared identity/lifecycle/policy contract and fixture-driven projector |
| CD03 | P107 | Causal spine, pause settlement, retry, approval durability/recovery |
| CD04 | P108 | Typed domain adapters, snapshot/cursor replay, evidence and shadow parity |
| CD05 | P109 | Chat narrative, grouped operations, progressive inline disclosure |
| CD06 | P110 | Plan, Scheduled, and cross-surface attention projection |
| CD07 | P111 | One-step Trajectory/Inspector evidence handoff |
| CD08 | P112 | Recovery, performance, accessibility, compatibility, v3.9.2 integration |
| CD09 | P113 | Independent review, real application acceptance, local package closure |

CD08 is implementation completion. CD09 is a mandatory post-implementation
gate and cannot be collapsed into implementation self-review.

## Delivery Invariants

### Authority

- Goal decides Goal semantics and acceptance.
- Plan decides Plan revisions, rounds, adoption, and lineage.
- ToolAuthorizationService, Tool Invocation, workspace policy, and sandbox
  decide permission and execution lifecycle.
- AgentRun/Trajectory decides current production Runs evidence.
- Chat message/session storage decides the durable transcript and request
  idempotency.
- The disclosure projector adapts and summarizes; it does not replace them.

### Causality and replay

- Stable ids derive from domain source refs, never timestamps alone or list
  indexes.
- Snapshot/delta cursors are generation scoped; a gap or generation change
  causes reload.
- Source cuts and coverage state make partial or degraded evidence explicit.
- Required interactions and terminal settlement persist before publication.
- Retry partials are attempt scoped and must be reset or superseded before a
  successful final answer is accepted.
- Exact owning-domain status remains attached to every primary/contributor
  reference; unknown required status cannot be normalized as success/failure.
- Projection cursors are scope/query/version bound and delta coverage changes
  either update source cuts explicitly or require an atomic snapshot reset.

### Privacy and permissions

- Default summaries are host-authored, safe, and task-oriented.
- Raw reasoning is not a v3.9.2 product requirement.
- Technical evidence is bounded, redacted, and permission checked in the main
  process.
- Credentials must be absent from source, logs, screenshots, projection
  caches, reports, and packages.
- Disclosure controls cannot widen tool permission scope or lifetime.

### Compatibility and rollback

- Existing v3.9.1 data remains readable without destructive migration.
- Legacy/shadow/projected modes permit source and surface rollback.
- A rollback never deletes authoritative records or hides a required attention
  state.
- Unknown optional presentation gets a generic row; unknown required facts
  produce incompatible/degraded coverage.

## Verification Ladder

| Gate | Required evidence |
| --- | --- |
| G0 Contract | Dependencies, source findings, scoped files, ADR, rollback, scenarios |
| G1 Characterization | Existing behavior and confirmed defects have focused tests before repair |
| G2 Focused | New contracts, adapters, reducers, and surface behavior pass targeted tests |
| G3 Repository | Test types, full tests, build, evals, and compatibility pass |
| G4 Product | Production smoke and declared real/browser scenarios pass |
| G5 Safety | Authorization, sandbox, redaction, secret scan, and dependency audit pass |
| G6 Closure | Independent review, program, harness, whitespace, and durable progress evidence pass |

No Feature advances by weakening a characterization assertion, reclassifying a
required fact as optional, or hiding a failed state.

## Frozen Application Scenarios

The manifest is authoritative for setup/actions/expected details. The categories
are mandatory:

- default concise narrative;
- inline expansion and user override;
- one-step evidence handoff;
- failure/blocked attention;
- approval/reload/idempotency;
- pause/reload/continuation recovery;
- Plan stage progress;
- Scheduled streaming progress;
- long-session CPU/heap/DOM behavior;
- keyboard/screen-reader/reduced-motion behavior;
- secret and restricted-evidence safety;
- retry attempt/reset integrity;
- legacy-data coverage and rollback;
- guided input reload and single response;
- Goal review, acceptance, and unverified completion;
- Plan confirmation and blocked action gate;
- cancellation, main-process interruption, and cold-start recovery;
- context and cumulative usage accuracy/estimation;
- unknown optional fallback versus required degraded coverage.

Every manifest scenario names a `browser` or `hybrid` executor, fixture,
evidence requirements, and acceptance artifact list. The artifact list may be
empty during implementation but must contain existing repository files before
CD09 or the program can complete.

CD01 freezes the matrix. Later Features may add scenarios but may not remove or
weaken an existing expectation without a new accepted architecture decision and
independent review.

## Workstream Gates

### CD01 — Program foundation

Entry: accepted P104 research PASS.

Exit:

- CD01 decision and program cover D1-D13;
- checker tests prove rejection of cycles, uncovered findings, missing
  artifacts, missing or unreferenced scenarios, multiple active Features, and
  manifest/Feature disagreement;
- independent architecture/program review passes;
- package script, program, harness, and whitespace checks pass.

### CD02 — Shared contract and shadow projector

Entry: CD01 complete.

Required characterization:

- stable key regression;
- retry partial contamination;
- Chat event log versus 80-item projection;
- legacy session identity and coverage.

Exit:

- typed adapter envelope, primary/contributor identity, exhaustive lifecycle,
  attention, sensitivity, evidence union, scope, snapshot, cursor, source-cut,
  requiredness, attempt control, and policy models pass focused tests;
- a fixture-driven pure projector runs without claiming production parity or
  changing renderer behavior;
- gaps, duplicates, resets, attempt supersession, unknown data, and secret
  classification pass.

### CD03 — Causal lifecycle spine and recovery

Entry: CD02 complete.

Exit:

- required and ordinary Workspace Run pause/settlement defects are repaired or
  declared degraded with awaited settlement evidence;
- Chat turn, accepted assistant message, run, trajectory, Tool Invocation,
  approval, and evidence refs form one stable causal spine;
- retry begin/reset/supersede/accept and duplicate output-channel rules pass;
- approval intent persists before publication, window reload is idempotent,
  and main restart/cold start interrupts rather than replaying privilege;
- causal-spine shadow comparisons are recorded without renderer cutover.

### CD04 — Domain adapters, evidence, and shadow parity

Entry: CD03 complete.

Exit:

- Chat, Goal, Plan, Scheduled, AgentRun/Trajectory, Workspace Run, Tool,
  approval, guided input, context, usage, and Kernel adapters declare bounded
  authority, durability, requiredness, and coverage;
- scoped snapshots/deltas handle gaps, generation changes, unknown facts,
  source-cut changes, backpressure, and atomic resets;
- evidence queries are main-process authorized, redacted, bounded, paged, or
  offloaded;
- cross-page call/result association, generic fallback, and legacy degradation
  pass;
- machine-readable shadow parity proves zero missing required facts, lifecycle
  mismatches, sensitive leaks, or duplicate stable ids; optional diffs are
  classified and an independent reviewer signs the artifact;
- CPU/heap/DOM, snapshot size, delta-buffer, publication latency, and reset-rate
  baselines are frozen before any projected renderer mode.

### CD05 — Chat surface

Entry: CD04 complete with accepted shadow parity and performance baseline.

Exit:

- narrative, grouped operations, failure/blocking, context, and final result
  preserve existing Goal/Plan/approval truth;
- user expansion survives streaming updates;
- stable rows update without duplication or focus loss;
- projected Chat remains behind a local default-off kill switch and legacy
  rollback remains verified.

### CD06 — Cross-surface projection

Entry: CD05 complete.

Exit:

- Plan progress is derived from durable Plan stages, not invented Todo state;
- Scheduled progress uses the existing streaming execution path;
- approval survives reload and shares Tool Invocation identity;
- cross-surface run identity and bounded updates pass;
- projected Plan/Scheduled modes use independent default-off kill switches.

### CD07 — Evidence handoff

Entry: CD06 complete.

Exit:

- one action navigates from a Chat operation to the exact Runs/Trajectory or
  generic evidence record;
- paging/reload keeps a pending target until it is found or declared absent;
- missing presenters fail soft without data loss;
- restricted payloads stay redacted and permission checked.

### CD08 — Hardening and v3.9.2 integration

Entry: CD07 complete.

Exit:

- reproducible CPU/heap/DOM characterization freezes and passes budgets;
- gap/reload/restart/legacy/unknown/rollback matrices pass;
- accessibility and reduced motion pass;
- package identity is v3.9.2 and full verify, smoke, audit, program, harness, and
  whitespace gates pass;
- projected mode remains revertible until CD09;
- no projected surface becomes release default before these gates pass.

### CD09 — Independent acceptance and closure

Entry: CD08 complete, no self-declared acceptance.

Exit:

- independent architecture, code, security, and test reviewers find no
  unresolved Critical or Major issue;
- every frozen scenario runs in the real application;
- the approved test credential is injected ephemerally and absent from source,
  logs, screenshots, persistence, exports, and packages;
- local macOS v3.9.2 package identity, signature, launch, cold reload, and
  evidence inspection pass;
- full closure gates pass;
- no commit, push, tag, or publication occurs without separate user authority.

The canonical
`.zerox/verification/conversation-disclosure/CD09-real-app-acceptance.json`
has schema version 1 and must contain:

- the disclosure `programId`, canonical manifest path, v3.9.2 Git build commit,
  dirty-overlay source-tree SHA-256, `darwin-arm64` platform, and a separate
  package identity JSON included in identity evidence;
- the browser automation runtime name/version;
- passed secret-scan and independent-review records with evidence refs;
- exactly one passed result for each of the 19 frozen scenario ids, matching
  its executor and fixture;
- one passed result for every frozen evidence requirement;
- existing in-repository evidence refs equal to each scenario's
  `acceptanceEvidence`, including at least one artifact unique to that scenario.

The checker parses this manifest at CD09 completion. Plain-text placeholders,
shared dummy evidence, missing/extra scenarios, changed fixtures, failed or
missing requirements, wrong app version/build/source digest, mismatched package
identity, and absent artifacts fail closure. The package identity records the
same version/build/source/platform plus package SHA-256, signature pass, and
launch pass, so an uncommitted local overlay is identified without requiring a
Git commit.

## Deferrals

The manifest keeps four capabilities explicitly deferred:

- private raw reasoning disclosure;
- one universal physical event store;
- DeepSeek runtime/topology port;
- remote/external execution.

This program may collect evidence but may not implement them.

## Completion

The program completes only after CD09. “The UI looks folded” is not completion.
Completion requires causal identity, truthful coverage, permissions, reload,
recovery, performance, accessibility, independent review, and real application
evidence.
