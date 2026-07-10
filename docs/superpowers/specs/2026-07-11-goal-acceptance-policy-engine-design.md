# Goal Acceptance Policy Engine Design

**Date:** 2026-07-11
**Feature:** P41-v3.4.0-goal-acceptance-policy-engine
**Status:** Approved direction; implementation requires a separate reviewed plan

## 1. Objective

Upgrade Zerox Agent Goal Mode from a collection of acceptance checks plus automatic replanning into a bounded, explainable acceptance policy engine.

The upgraded system must:

1. keep deterministic checks and local-first evidence as the source of truth;
2. prevent identical acceptance failures from causing unbounded replanning;
3. repair a failed milestone in place before considering a structural replan;
4. generate bounded structural evidence for large artifacts;
5. require a final cold judge for semantic goals;
6. distinguish repairable rejection, structural plan failure, external blocking, impossibility, and judge unavailability;
7. persist a completion certificate whenever a protocol-v2 goal becomes `achieved`;
8. keep all historical Goal JSON readable without manual migration;
9. expose enough evidence and decision history for the user to understand why a goal stopped or completed;
10. preserve `ToolAuthorizationService`, workspace path boundaries, cancellation monotonicity, and local-first storage.

## 2. Context and Current Failure Modes

P40 added hard iteration, tool, wall-clock, token, and replan budgets; safe absolute artifact paths; paused turn-limit behavior; and monotonic `achieved`/`canceled` storage.

Those changes bound the previously observed loop, but the acceptance architecture still has four structural weaknesses:

- a rejected non-paused milestone normally calls the Planner immediately, even when the plan is sound and only one artifact or test needs repair;
- there is no stable identity for “the same failure happened again,” so a plan rewrite can hide a logically unchanged failure;
- artifact-backed model review receives a fixed prefix preview rather than a criterion-aware structural representation of a large artifact;
- accepted milestone checks can cover the final goal without a fresh integration-level semantic judgment.

MiMo-Code demonstrates useful control-loop patterns: cheap task-state gates before semantic judgment, bounded stop-gate re-entry, typed partial/blocked outcomes, stable repeated-action signatures, and plugin-generated targeted repair messages. Zerox will adopt those patterns without adopting MiMo-Code’s fail-open judge behavior, ephemeral goal state, or “clear unmet goal at cap” semantics.

## 3. Design Choice

### 3.1 Selected approach

Build a modular policy engine around the existing durable Goal state machine.

The Controller remains the owner of execution order and status transitions. It delegates five focused responsibilities:

- validator dispatch;
- evidence manifest construction;
- failure fingerprinting;
- repair/replan/stop policy;
- completion certificate generation.

### 3.2 Rejected alternatives

**Continue adding branches to `agentGoalController.ts`.** This would minimize file count but keep policy, evidence, execution, and persistence coupled. It would make race testing and future validator extension harder.

**Rewrite Goal Mode as an event-sourced runtime.** Event sourcing could eventually simplify replay, but replacing the current Goal JSON, ledger, chat integration, and renderer projection is not required to solve this problem and would put existing v3.4.0 reliability at unnecessary risk.

## 4. Acceptance Protocol and Data Model

### 4.1 Protocol version

Add an optional protocol marker to `Goal`:

```ts
type GoalAcceptanceProtocolVersion = 1 | 2;

type Goal = {
  // existing fields
  acceptanceProtocolVersion?: GoalAcceptanceProtocolVersion;
  acceptanceState?: GoalAcceptanceState;
  acceptanceCertificate?: GoalAcceptanceCertificate;
};
```

Interpret an absent marker as protocol v1. New goals and any nonterminal legacy goal explicitly resumed after the upgrade use protocol v2.

Reading a legacy goal does not rewrite it. The next authorized save after resume adds v2 fields. Existing terminal v1 goals remain valid and are never retroactively required to have a certificate.

### 4.2 Acceptance verdict taxonomy

```ts
type AcceptanceVerdict =
  | "accepted"
  | "rejected_repairable"
  | "replan_required"
  | "blocked_external"
  | "impossible"
  | "acceptance_unavailable";

type AcceptanceFailureClass =
  | "artifact_missing"
  | "artifact_invalid"
  | "artifact_outside_boundary"
  | "command_failed"
  | "test_failed"
  | "assertion_failed"
  | "semantic_evidence_insufficient"
  | "plan_structure_invalid"
  | "external_dependency_missing"
  | "goal_impossible"
  | "validator_unavailable"
  | "judge_unavailable"
  | "unknown";
```

`AcceptanceResult.accepted` remains for source compatibility and is derived from `verdict === "accepted"`. Protocol-v2 callers use `verdict`, `failureClass`, `fingerprint`, `evidenceManifest`, and `repairDirective`.

Each validator returns a common result shape:

```ts
type AcceptanceCheckResult = {
  checkId: string;
  kind: AcceptanceCheckKind;
  passed: boolean;
  code: string;
  failureClass?: AcceptanceFailureClass;
  evidenceRefs: string[];
  detail: string;
};
```

`code` is stable machine-readable data such as `file_not_found`, `test_exit_nonzero`, or `judge_timeout`; free-form `detail` is never used as the sole fingerprint input.

When multiple checks fail, aggregate the overall verdict using this precedence: `acceptance_unavailable`, `impossible`, `blocked_external`, `replan_required`, then `rejected_repairable`. `accepted` requires every configured check to pass.

### 4.3 Repair directive

```ts
type AcceptanceRepairDirective = {
  action:
    | "repair_same_milestone"
    | "retry_alternate_strategy"
    | "replan"
    | "stop_stalled"
    | "stop_blocked";
  summary: string;
  failedCheckIds: string[];
  fingerprint: string;
  occurrence: number;
  instructions: string[];
};
```

Instructions are constructed from validator results, not free-form Planner output. They name exact failed checks, authorized artifact paths, expected facts, and previous failed approaches. They never contain secrets or raw API errors.

### 4.4 Acceptance state

```ts
type GoalAcceptanceState = {
  protocolVersion: 2;
  phase: "idle" | "validating" | "repairing" | "judging" | "blocked" | "certified";
  attempt: number;
  recentFailures: GoalAcceptanceFailureRecord[];
  lastDecision?: AcceptanceRepairDirective;
};

type GoalAcceptanceFailureRecord = {
  at: string;
  targetKind: "milestone" | "goal";
  targetId: string;
  fingerprint: string;
  occurrence: number;
  verdict: Exclude<AcceptanceVerdict, "accepted">;
  failureClass: AcceptanceFailureClass;
  failedCheckIds: string[];
  evidenceRefs: string[];
  actionSignatures: string[];
};
```

Keep only the latest 20 failure records in the Goal JSON. The append-only ledger and trajectory retain the full history.

### 4.5 Blocked status

Add `stopped_blocked` to `GoalStatus` and these stop reasons:

```ts
type StopReason =
  | ExistingStopReason
  | "external_blocked"
  | "goal_impossible"
  | "acceptance_unavailable";
```

`stopped_blocked` is recoverable to `executing` after the user adjusts the plan, restores an external dependency, or retries acceptance. It can also transition to `canceled`. It is never displayed as completed.

## 5. Validator Registry

### 5.1 Interface

```ts
type AcceptanceValidator = {
  kind: AcceptanceCheckKind;
  evaluate(input: AcceptanceValidatorInput): Promise<AcceptanceCheckResult>;
};

type AgentGoalValidatorRegistry = {
  register(validator: AcceptanceValidator): void;
  evaluate(check: AcceptanceCheck, context: AcceptanceContext): Promise<AcceptanceCheckResult>;
  listKinds(): AcceptanceCheckKind[];
};
```

Built-in validators implement the existing `file_exists`, `command_exit_code`, `test_passes`, `assertion`, and `model_review` behavior.

Custom kinds use the namespace `validator:<provider>/<name>`. The shared type becomes the existing built-in union plus this template-literal form.

### 5.2 Extension and trust model

- The application container creates the registry and registers built-ins.
- Trusted local plugins may inject validators through an explicit container construction option.
- Project and Skill metadata may declare validator descriptors, but descriptors compile to registered validator kinds; they do not load arbitrary project JavaScript.
- Every validator receives the existing governed `toolExecutor` and normalized authorized roots.
- A validator cannot receive raw secret settings or bypass `ToolAuthorizationService`.
- File evidence must pass the symlink-aware location boundary validator before read access.
- Validator execution has a 30-second timeout. Timeout, missing registration, or thrown infrastructure errors produce `acceptance_unavailable`, never `accepted`.

### 5.3 Deterministic-first order

All non-model validators run before `model_review`. A failed deterministic result skips semantic review. This preserves the existing rule that a model cannot explain away a missing file, failed test, or false assertion.

## 6. Evidence Manifest

### 6.1 Purpose

Replace fixed-prefix artifact evidence with a bounded, structured manifest that is useful for both deterministic checks and model review.

```ts
type GoalEvidenceManifest = {
  version: 1;
  generatedAt: string;
  artifacts: GoalEvidenceArtifact[];
  totalRenderedChars: number;
  truncated: boolean;
};

type GoalEvidenceArtifact = {
  ref: string;
  path?: string;
  mediaType: string;
  sizeBytes?: number;
  modifiedAt?: string;
  sha256?: string;
  lineCount?: number;
  headings?: Array<{ depth: number; text: string; line: number }>;
  jsonKeys?: string[];
  tableShape?: { rows: number; columns: number; headers: string[] };
  imageSize?: { width: number; height: number };
  excerpts: Array<{ label: string; startLine?: number; endLine?: number; text: string }>;
};
```

### 6.2 Built-in adapters

- Markdown: SHA256, bytes, line count, full heading tree, head/tail excerpts, and excerpts around criterion keywords.
- JSON: parse validity, top-level keys, bounded structural summary, and relevant scalar excerpts.
- CSV/TSV: row count, column count, headers, and bounded head/tail rows.
- Plain text and source code: SHA256, bytes, line count, head/tail, and criterion-relevant line windows.
- PNG/JPEG: SHA256, bytes, MIME type, and dimensions parsed from file headers.
- Other binary: SHA256, bytes, MIME type, and no raw content.

The rendered manifest passed to a judge is capped at 12,000 characters. Structural metadata is retained before excerpts. Excerpts are dropped from lowest relevance first when the cap is reached.

### 6.3 Provenance

When a check requires provenance, the manifest includes an artifact only after the existing provenance verifier passes. The certificate stores the evidence hash and provenance reference, not a second copy of file contents.

## 7. Failure Fingerprint and Loop Detection

### 7.1 Fingerprint input

Generate SHA256 over stable JSON containing:

- target kind and stable target ID;
- sorted failed check IDs and kinds;
- normalized failure classes and machine-readable result codes;
- sorted evidence references and artifact SHA256 values;
- sorted recent action signatures;
- acceptance protocol and validator versions.

Exclude timestamps, free-form wording, plan version, retry counters, and model prose so cosmetic variation cannot hide the same logical failure.

### 7.2 Action signatures

Derive action signatures from the completed run’s tool calls:

```text
<tool-name>:<stable-json-input>
```

Object keys are sorted recursively. Secret-valued arguments are represented by their redacted marker, never hashed from the secret itself.

### 7.3 Occurrence counting

Count consecutive matching fingerprints for the same target. A different fingerprint resets the occurrence count for that target.

## 8. Repair Policy

The policy decision is deterministic:

| Verdict | Occurrence | Decision |
|---|---:|---|
| `accepted` | any | certify or accept milestone |
| `rejected_repairable` | 1 | repair the same milestone |
| `rejected_repairable` | 2 | retry the same milestone with an alternate-strategy directive |
| `rejected_repairable` | 3+ | `stopped_stalled` |
| `replan_required` | any | replan once budget permits |
| `blocked_external` | any | `stopped_blocked / external_blocked` |
| `impossible` | any | `stopped_blocked / goal_impossible` |
| `acceptance_unavailable` | any | `stopped_blocked / acceptance_unavailable` |

Every branch checks operational budgets before another model or tool run. Replan budget is consumed only by `replan_required`; same-milestone repair does not increment `planVersion` or `budgetUsage.replans`.

### 8.1 Milestone repair

On a repair decision:

- set the rejected milestone back to `ready`;
- persist the repair directive on `acceptanceState.lastDecision`;
- append `acceptance_repair_scheduled` to the ledger and trajectory;
- pass the directive to `GoalRuntimeEngine` so the next prompt names the exact failed checks and requires a different action when occurrence is 2;
- preserve prior run IDs and acceptance details for comparison.

### 8.2 Final-goal repair

If all milestones are accepted but final acceptance is repairable, create one deterministic repair milestone with ID derived from the failed fingerprint. It depends on all accepted milestones and uses the failed goal checks as its success criteria. Repeated evaluation of the same fingerprint reuses this milestone; it does not append an unbounded chain of repair milestones.

### 8.3 Structural replan

Only `plan_structure_invalid` or an explicit validator result of `replan_required` calls `AgentGoalPlanner.replan`. The failure reason and evidence manifest are provided to the Planner. If the new plan leaves the failure fingerprint unchanged, subsequent policy still counts it as the same logical failure.

## 9. Final Cold Judge

Remove the semantic fast path that treats covered milestone model-review checks as sufficient final acceptance.

- Pure deterministic goal checks are evaluated again at final acceptance and can be certified without a model call.
- Any goal containing `model_review` receives a new temperature-zero judge call after all deterministic checks pass.
- The judge receives the goal condition, structured evidence manifest, relevant transcript slice, accepted milestone summaries, failed/dead-end history, and explicit instruction to use evidence only.
- The response schema contains `verdict: accepted | rejected | impossible` and a reason tied to evidence references.
- Invalid JSON, timeout, or provider failure maps to `acceptance_unavailable`. Missing required task evidence maps to `rejected_repairable`. Neither path can map to success.
- The judge profile, model ID, prompt version, and evaluated message/run IDs are captured for the certificate.

This is a cold call, not necessarily a different provider. The architecture permits a dedicated judge profile later, but this iteration does not require multi-judge voting.

## 10. Completion Certificate

```ts
type GoalAcceptanceCertificate = {
  version: 1;
  goalId: string;
  acceptedAt: string;
  protocolVersion: 2;
  criteriaHash: string;
  planVersion: number;
  runIds: string[];
  checkResults: AcceptanceCheckResult[];
  evidence: Array<{
    ref: string;
    path?: string;
    sha256?: string;
    sizeBytes?: number;
    provenanceRefs: string[];
  }>;
  judge?: {
    providerId?: string;
    model: string;
    promptVersion: string;
    evaluatedMessageIds: string[];
  };
  certificateHash: string;
};
```

The certificate hash is SHA256 of stable JSON excluding `certificateHash`.

For a protocol-v2 Goal, the store rejects a transition to `achieved` unless:

- the certificate goal ID matches;
- the certificate protocol is v2;
- every certificate check passed;
- the criteria hash matches the goal’s current success criteria;
- the plan version matches;
- the certificate hash verifies.

The Goal JSON is already written via atomic temporary-file rename. Saving `status: achieved`, `stopReason: goal_accepted`, and the certificate in one Goal object makes the terminal state and certificate atomic.

## 11. Controller Flow

The Controller follows this sequence:

```text
load canonical goal
  → enforce operational budget
  → run ready milestone
  → validate milestone through registry
  → accepted: persist milestone acceptance
  → rejected: fingerprint + repair policy
  → repair/replan/block/stop according to policy
  → when all milestones accepted: evaluate final goal
  → accepted: build certificate and atomically save achieved
  → otherwise: apply the same bounded policy
```

Every persistence call continues from the returned canonical Goal, preserving P40’s cancellation/achievement race protection.

## 12. Observability

Add ledger and trajectory events:

- `acceptance_manifest_created`
- `acceptance_failure_classified`
- `acceptance_repair_scheduled`
- `acceptance_strategy_changed`
- `acceptance_blocked`
- `acceptance_certified`

Each event carries goal ID, target ID, fingerprint, occurrence, failed check IDs, action, and redacted evidence references. Certificate events carry the certificate hash, not artifact contents.

Progress events and chat-session projections continue to reconcile against persisted irreversible state before renderer notification.

## 13. User Interface

### 13.1 Running and repair states

The Goal status surface shows:

- `正在验收` while validators run;
- `正在修复验收问题（1/2）` for first repair;
- `已切换策略（2/2）` for alternate strategy;
- exact failed check summary and evidence reference;
- whether the next action is repair, replan, or user intervention.

### 13.2 Blocked state

`stopped_blocked` renders as `目标受阻` with a reason-specific explanation:

- external dependency missing;
- condition determined impossible;
- validator or judge unavailable.

Actions are `重试验收`, `调整计划`, and `终止目标`. The UI never labels this state completed.

### 13.3 Certificate view

An achieved Goal exposes `查看验收证书`. The detail drawer renders:

- accepted time and plan version;
- deterministic versus inferential checks;
- each check result;
- artifact path, size, and short SHA256;
- judge model and prompt version when used;
- certificate hash.

Raw secrets, full artifacts, and unrestricted filesystem links are not rendered.

## 14. Error Handling and Safety

- Validator infrastructure errors become `acceptance_unavailable`.
- Deterministic check failures remain normal rejection data, not thrown exceptions.
- Judge parse/provider/timeout failures never produce `achieved`.
- Missing custom validator registration produces a blocked acceptance state with the missing kind named.
- Artifact reads use symlink-aware authorized-root validation before `stat`, hash, or content reads.
- Tool-backed validators continue through `AgentToolExecutor` and `ToolAuthorizationService`.
- Cancellation and achievement remain irreversible against stale nonterminal saves.
- No cloud worker, remote mutation service, or unreviewed self-modification is added.

## 15. Backward Compatibility

Compatibility cases are explicit:

1. Legacy `planning`, `executing`, or review goals load as protocol v1 and upgrade to v2 on resume/start save.
2. Legacy `stopped_budget`, `stopped_stalled`, or `failed` goals upgrade to v2 when the user retries them.
3. Legacy `achieved` goals remain achieved without a certificate and are labeled `历史验收记录` in details.
4. Legacy `canceled` goals remain canceled.
5. Unknown optional v2 fields are ignored by old projections where structurally safe.
6. The store normalizer supplies bounded empty acceptance state only during an upgrade transition, not on read.

No one-time destructive migration is performed.

## 16. Test Strategy

### 16.1 Unit tests

- validator registry dispatch, duplicate registration, missing kind, timeout, and governed context;
- Markdown, JSON, CSV, text, image, and generic evidence adapters;
- evidence character budget and relevance ordering;
- stable fingerprints across object-key ordering and wording/timestamp changes;
- different fingerprints for different failed checks, artifact hashes, or actions;
- repair policy decision table;
- certificate stable hashing and validation;
- protocol-v1 normalization and v2 upgrade helpers.

### 16.2 Controller tests

- first identical failure repairs the same milestone without replan;
- second identical failure injects alternate strategy;
- third identical failure stops stalled;
- changed failure resets occurrence;
- structural failure alone calls Planner;
- final semantic goal always invokes the cold judge;
- judge unavailable stops blocked and never achieves;
- final repair reuses one deterministic repair milestone;
- budget exhaustion wins before another repair or replan;
- cancellation during manifest, judge, repair bookkeeping, or certificate save remains canceled;
- protocol-v2 achieved state always has a valid certificate.

### 16.3 Store and compatibility tests

- real legacy Goal fixtures load without mutation;
- legacy terminal goals retain their status;
- resumed legacy goals gain v2 state;
- v2 achieved without certificate is rejected;
- certificate and terminal status are observed together;
- stale saves cannot remove a certificate or regress achieved/canceled.

### 16.4 Renderer tests

- validation, repair, alternate-strategy, blocked, and certified copy;
- blocked recovery actions call the correct IPC paths;
- certificate details are visible and secrets/full contents are absent;
- legacy achieved goals display historical-record copy.

### 16.5 System verification

- focused P41 tests;
- complete `npm test` and `npm run verify`;
- `npm run smoke:prod` and `npm run harness:check`;
- macOS packaging and packaged-app smoke;
- a deterministic regression scenario reproducing repeated missing-evidence failure and proving no automatic replan loop;
- final `.zerox/progress.md` evidence and zero unfinished features.

## 17. Implementation Boundaries

This feature includes the policy engine, registry, built-in evidence adapters, completion certificate, durable protocol migration, blocked state, controller integration, UI explanation, tests, and local package verification.

It does not introduce arbitrary executable project validators, cloud validation workers, multi-judge voting, or a new event-sourced Goal store. The registry and container injection point make those future changes possible without weakening the current local security boundary.

## 18. Completion Criteria

P41 is complete only when every definition-of-done entry in `.zerox/feature_list.json` is backed by a focused regression test or direct runtime evidence, the full verification and package commands pass, the app is relaunched from the rebuilt package, and `.zerox/progress.md` records the commands and outcomes.
