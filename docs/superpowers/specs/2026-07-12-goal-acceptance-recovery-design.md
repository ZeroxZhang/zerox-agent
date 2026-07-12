# Goal Acceptance Recovery and Manual Completion Design

**Date:** 2026-07-12

**Status:** Approved in conversation; awaiting written-spec review

**Scope:** Final semantic judge reliability, retry classification, recoverable acceptance state, manual completion attestation, persistence, and renderer recovery controls

## 1. Problem statement

Zerox currently treats every final-judge timeout as if the acceptance service were permanently unavailable:

1. a completed milestone passes semantic acceptance;
2. the final cold judge starts with the normal chat model profile;
3. the fixed 30-second deadline expires;
4. `judge_timeout` is collapsed into `judge_unavailable` and then `acceptance_unavailable`;
5. the repair policy immediately transitions the goal to terminal `stopped_blocked` on the first occurrence;
6. the UI reports that the user must handle a blocker even though the task artifacts and evidence remain complete.

The incident goal produced `docs/tech_report.md` and `goalEvidence.md`, and its milestone judge accepted the result. The separate final goal judge alone timed out. This is a liveness and recovery defect, not evidence that the artifact failed its acceptance criteria.

The repair must preserve the existing trust boundary: judge unavailability can never silently become machine-certified success.

## 2. Product decisions

The approved behavior is:

- transient final-judge failures are retried automatically and visibly;
- completed task work is not re-executed merely because the judge transport failed;
- exhausted retries preserve the goal in a recoverable acceptance-wait state;
- the user sees current progress, the exact acceptance failure, retry history, and available choices;
- the user may continue acceptance or manually mark the goal complete;
- manual completion is explicitly unverified and is never equivalent to a machine acceptance certificate.

The product vocabulary is:

- **机器认证完成**: all configured checks passed and a valid protocol-v2 certificate exists;
- **等待验收**: task work is preserved, but final acceptance has not completed;
- **手动完成（未认证）**: the user closed the goal despite incomplete machine acceptance.

## 3. MiMo-Code principles adopted

The local MiMo-Code repository provides four relevant engineering patterns:

1. **One transient classifier:** provider and processor paths share a single decision for HTTP 429/5xx, network reset, pipe failure, transport timeout, and non-retryable errors.
2. **Visible retry scheduling:** retry state includes attempt, reason, and next retry time so the UI does not look frozen.
3. **Safe judge replay:** judge work has no external side effects before it completes, so a failed attempt can rebuild a fresh accumulator and retry without duplicating task actions.
4. **Orthogonal blocked state:** transport retry, context recovery, permission denial, business blockage, and true impossibility are separate outcomes rather than one generic failure.

Zerox will not copy MiMo-Code's fail-open goal verifier or advisory-judge fallback. Those are acceptable for candidate selection, but not for a certificate-bearing completion boundary.

## 4. Chosen architecture

### 4.1 Dedicated acceptance attempt

Final semantic judging becomes a bounded, side-effect-free acceptance operation with its own policy:

- temperature `0`;
- thinking explicitly disabled;
- maximum output limited to the amount needed for the strict verdict schema;
- prompt excludes full action-signature histories and duplicated goal text;
- the evidence manifest, accepted milestone summary, bounded transcript, stable failed-check history, and supplied references remain available;
- each retry builds a fresh request and discards partial output from the failed attempt.

The normal chat model remains configurable. Acceptance overrides only inference settings that are inappropriate for a small deterministic verdict; it does not change the user's selected provider or model.

### 4.2 Typed transient classification

Add one acceptance-infrastructure classifier that returns:

```ts
type AcceptanceInfrastructureFailure = {
  code:
    | "judge_timeout"
    | "rate_limited"
    | "provider_unavailable"
    | "network_reset"
    | "transport_failed"
    | "judge_invalid_response"
    | "validator_missing"
    | "validator_failed";
  retryable: boolean;
  detail: string;
  retryAfterMs?: number;
};
```

Retryable failures are limited to transport and capacity failures: timeout, 429, 5xx, `ECONNRESET`, `EPIPE`, and `ETIMEDOUT`. Invalid judge JSON receives one clean retry because a strict structured response can recover on a fresh request. Missing validator registration, invalid local configuration, authorization failure, user cancellation, and deterministic validator defects are not retried as transport failures.

The classifier consumes structured status, error code, and response headers where available. String matching is a compatibility fallback, not the primary contract.

### 4.3 Retry policy

Final judge retry uses a goal-scoped budget:

- three attempts per acceptance cycle;
- abortable exponential delays of 1 second and 2 seconds;
- provider `retry-after-ms` or `retry-after` overrides the calculated delay within a bounded maximum;
- one per-attempt judge deadline of 60 seconds;
- the existing goal wall-clock and cancellation signals remain authoritative;
- retries emit and persist `acceptance_retry_scheduled` and `acceptance_retry_started` events.

The retry budget applies only to final semantic judging. It does not increment milestone execution attempts, tool-call usage, replan count, or task action signatures. Judge usage may be recorded separately for observability.

### 4.4 Recoverable state model

Add a nonterminal goal status:

```ts
"waiting_for_acceptance"
```

Add acceptance phases:

```ts
"retrying" | "awaiting_user"
```

Persist bounded retry state:

```ts
type GoalAcceptanceRetryState = {
  cycle: number;
  attempt: number;
  maxAttempts: number;
  lastCode: string;
  lastDetail: string;
  nextRetryAt?: string;
  evidenceFingerprint: string;
  resumeFrom: "final_judge";
};
```

During automatic delay or execution, the goal remains `executing` with acceptance phase `retrying`. If the cycle exhausts its attempts, the controller transitions to `waiting_for_acceptance` and phase `awaiting_user`. This state is durable, resumable, and not treated as a terminal failure.

Allowed transitions are:

```text
executing/retrying -> achieved/certified
executing/retrying -> waiting_for_acceptance/awaiting_user
waiting_for_acceptance -> executing/retrying
waiting_for_acceptance -> completed_unverified
waiting_for_acceptance -> canceled
```

No automatic path may transition `waiting_for_acceptance` to machine-certified `achieved` without running the final judge and creating a valid certificate.

### 4.5 Continue acceptance

The user action **继续验收**:

1. loads the canonical goal and verifies it is `waiting_for_acceptance`;
2. verifies accepted milestones, evidence fingerprint, and referenced artifacts have not been invalidated;
3. starts a new acceptance cycle from `final_judge` only;
4. preserves the execution transcript, evidence manifest, artifacts, milestone attempts, and task budget usage;
5. applies a new three-attempt retry budget;
6. certifies normally if the judge accepts, otherwise returns to `waiting_for_acceptance` with updated diagnostics.

It must not call `runMilestone`, regenerate the report, re-run unrelated tools, or schedule a repair milestone solely because the judge transport timed out.

### 4.6 Manual completion

Add a distinct terminal status:

```ts
"completed_unverified"
```

and stop reason:

```ts
"user_marked_complete"
```

Manual completion creates an attestation, not an acceptance certificate:

```ts
type GoalManualCompletionAttestation = {
  version: 1;
  goalId: string;
  completedAt: string;
  reason: "user_marked_complete";
  failedCheckIds: string[];
  evidenceRefs: string[];
  evidenceFingerprint: string;
  lastFailureCode: string;
  retryCycles: number;
};
```

The action requires a confirmation surface that states:

- the task artifacts are preserved;
- machine acceptance did not finish;
- no machine acceptance certificate will be issued;
- the result will be displayed and exported as manually completed and unverified.

Protocol-v2 certificate validation remains unchanged: only `achieved` with a valid certificate is machine-certified. `completed_unverified` must never satisfy certificate checks, harness assertions that require certified completion, or UI projections for verified success.

### 4.7 Restart and cancellation

On application restart:

- `waiting_for_acceptance` stays waiting and is never auto-resumed without a visible user choice;
- a persisted retry timer is recovered as `waiting_for_acceptance` if the prior process exited before the attempt completed;
- the UI restores the latest attempt, error code, evidence fingerprint, and progress summary;
- the user can explicitly continue acceptance.

The active run `AbortSignal` covers judge transport and retry delays. Cancellation clears timers, ignores late judge responses, persists one cancellation outcome, and prevents a stale retry from certifying or changing a manually completed goal.

## 5. Controller and persistence boundaries

The controller owns acceptance-cycle orchestration. `AgentGoalAcceptance` evaluates one attempt and reports typed result data; it does not sleep or mutate goal status. A small retry-policy helper decides whether and when another attempt is safe.

Canonical store compare-and-save semantics protect these invariants:

- only the currently executing acceptance cycle may publish its result;
- an evidence fingerprint mismatch invalidates an old retry continuation;
- `completed_unverified`, `achieved`, and `canceled` reject stale nonterminal writes;
- certificate persistence remains atomic with `achieved`;
- manual attestation persistence remains atomic with `completed_unverified`.

Existing historical `stopped_blocked / acceptance_unavailable` goals remain readable. Retrying one upgrades it into the new acceptance-wait flow without rewriting the historical ledger.

## 6. Renderer design

### 6.1 Retry progress

While retrying, the goal detail and chat activity show:

- `正在重试最终验收（2/3）`;
- exact safe reason such as `最终裁判超时` or `模型服务繁忙`;
- next retry time during backoff;
- `任务产物与已完成里程碑不会重新执行`.

### 6.2 Waiting state

After exhaustion, show:

- headline: `任务产物已完成，等待最终验收`;
- progress: accepted milestones, artifact references, last successful action, and retry history;
- diagnostic: exact failure code rather than only the check ID;
- primary action: `继续验收`;
- secondary action: `手动标记完成`;
- existing cancel/terminate action where applicable.

`继续执行` is not used because it implies the task itself is incomplete.

### 6.3 Manual-completion presentation

Manual completion uses amber/neutral presentation, never the green certified-success treatment. Goal cards, details, exported episodes, and chat summaries display:

```text
手动完成 · 未经机器认证
```

The attestation details remain inspectable. The acceptance certificate section is absent.

## 7. Telemetry and diagnostics

Persist bounded, secret-safe events:

- `acceptance_retry_scheduled` with cycle, attempt, code, and next time;
- `acceptance_retry_started`;
- `acceptance_retry_exhausted`;
- `acceptance_waiting_for_user`;
- `acceptance_manual_completion_requested`;
- `acceptance_manual_completion_recorded`.

Provider error bodies, API keys, raw prompts, and full artifact contents are not persisted. Failure detail passes existing redaction and size bounds.

## 8. Test strategy

### 8.1 Acceptance and retry unit tests

- first timeout followed by acceptance certifies on attempt two;
- timeout, 429/5xx, reset, and provider retry headers classify correctly;
- invalid judge response receives one clean retry;
- missing validator and user cancellation do not enter transport retry;
- retry delays are abortable and late completions are ignored;
- judge requests disable thinking, cap output, and omit verbose action histories;
- all attempts use fresh response accumulators.

### 8.2 Controller tests

- three timeouts enter `waiting_for_acceptance` rather than `stopped_blocked`;
- no retry invokes `runMilestone` or changes tool/replan usage;
- continue acceptance starts at the final judge and may certify;
- evidence changes prevent stale certification;
- restart recovery preserves waiting state and diagnostics;
- cancellation during delay or judge remains canceled;
- stale completion cannot overwrite achieved, canceled, or manual completion;
- legacy acceptance-unavailable retry upgrades safely.

### 8.3 Manual completion tests

- confirmation action writes `completed_unverified` plus attestation atomically;
- no acceptance certificate is created;
- certificate verification rejects manual completion as certified success;
- renderer and exports label it unverified;
- automation and harness contracts that require verified success do not accept it.

### 8.4 Renderer and IPC tests

- retry attempt and next time are visible;
- exact timeout diagnostic is visible;
- waiting actions call distinct continue-acceptance and manual-completion IPC methods;
- manual confirmation copy states the trust consequence;
- certified, waiting, blocked, and manual-completion states remain visually distinct.

### 8.5 System verification

- focused acceptance, controller, store, IPC, and renderer tests;
- `npm run harness:check`;
- `npm run verify`;
- `npm run smoke:prod`;
- packaged application smoke;
- independent code review agent;
- independent test-acceptance agent;
- merge to `main` only after both agents report no blocking findings;
- rebuild macOS package and launch it for human inspection.

## 9. Non-goals

- no cloud acceptance worker or background queue;
- no multi-judge voting;
- no automatic success fallback when the judge is unavailable;
- no re-execution of accepted task milestones for transport-only failures;
- no weakening of protocol-v2 certificate integrity;
- no migration that rewrites historical terminal goals.

## 10. Definition of done

The change is complete when a reproducible final-judge timeout automatically retries without duplicating task work, exhausted retries preserve a durable `waiting_for_acceptance` state, the user can either resume final acceptance or create an explicitly unverified manual completion attestation, and no unavailable-judge path can produce a machine acceptance certificate.
