# Goal Acceptance Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make final goal acceptance automatically retry transient judge failures, preserve exhausted attempts as a durable acceptance-wait state, and let users either continue acceptance or record an explicitly unverified manual completion.

**Architecture:** Keep `AgentGoalAcceptance` responsible for exactly one fail-closed evaluation attempt and add a focused retry-policy module for typed infrastructure classification and delay decisions. Let `AgentGoalController` orchestrate acceptance cycles without rerunning accepted milestones, persist retry state on `Goal`, and expose distinct controller/service/IPC actions for continuing acceptance and manual completion. Extend the renderer with truthful waiting, retrying, certified, and manually completed projections.

**Tech Stack:** TypeScript, Electron IPC/preload bridge, React, Vitest, JSON/SQLite-backed goal repositories, existing Goal protocol-v2 certificate and trajectory infrastructure.

## Global Constraints

- Machine certification remains fail-closed: no unavailable-judge path may create `achieved` or an acceptance certificate.
- Automatic final-judge retry uses at most three attempts per cycle, abortable delays of 1 second then 2 seconds, and a 60-second deadline per attempt.
- Final judge requests use temperature `0`, thinking disabled, and at most 1,024 output tokens.
- Transport-only acceptance retry must not invoke `runMilestone`, change milestone attempts, increment goal tool/replan usage, or regenerate artifacts.
- Exhausted retry cycles enter durable nonterminal `waiting_for_acceptance`; application restart must not silently resume the judge.
- Manual completion uses terminal `completed_unverified` plus a durable attestation and never produces a protocol-v2 certificate.
- Preserve local-first authorization, workspace sandboxing, cancellation fencing, redaction, and historical goal compatibility.
- Do not add cloud workers, multi-judge voting, or rewrite historical terminal goal records.

---

## File Structure

- Create `src/main/agentGoalAcceptanceRetryPolicy.ts`: typed infrastructure failure classification, retryability, bounded retry-after parsing, and deterministic retry decisions.
- Create `src/main/agentGoalAcceptanceRetryPolicy.test.ts`: direct policy and error-shape tests.
- Modify `src/shared/agentGoal.ts`: statuses, phases, retry state, manual attestation, transitions, and ledger types.
- Modify `src/shared/agentGoal.test.ts`: transition and upgrade compatibility tests.
- Modify `src/shared/agentTrajectory.ts`: acceptance retry/wait/manual event types.
- Modify `src/main/agentGoalAcceptance.ts`: lean judge profile, compact final prompt, failed outcome metadata, and retry hint on `AcceptanceResult`.
- Modify `src/main/agentGoalAcceptance.test.ts`: request-profile, prompt-bound, timeout, provider, and invalid-response tests.
- Modify `src/main/agentGoalController.ts`: automatic acceptance cycle, waiting transition, continue-acceptance, manual-completion, stale-write fencing.
- Modify `src/main/agentGoalController.test.ts`: controller-level red/green scenarios.
- Modify `src/main/agentGoalStore.ts`, `src/main/storage/repositories/goalRepository.ts`, and their tests: active/terminal semantics and durable compatibility.
- Modify `src/main/goalChatService.ts`, `src/main/container.ts`, `src/main/ipc/index.ts`, `src/preload/index.ts`, `src/renderer/global.d.ts`, and tests: explicit user operations.
- Modify `src/renderer/goalProgressViewModel.ts`, `src/renderer/components/GoalDetailDrawer.tsx`, `src/renderer/components/GoalStatusStrip.tsx`, `src/renderer/components/AgentChatPanel.tsx`, renderer tests, and styles: retry/wait/manual UX.
- Modify `.zerox/feature_list.json` and `.zerox/progress.md`: feature definition and command evidence.

---

### Task 1: Shared Goal State and Trust Contracts

**Files:**
- Modify: `src/shared/agentGoal.ts`
- Modify: `src/shared/agentGoal.test.ts`
- Modify: `src/shared/agentTrajectory.ts`
- Modify: `src/shared/chat.ts`

**Interfaces:**
- Produces: `GoalAcceptanceRetryState`, `GoalManualCompletionAttestation`, statuses `waiting_for_acceptance | completed_unverified`, phases `retrying | awaiting_user`, stop reason `user_marked_complete`, directive action `wait_for_acceptance`.
- Consumes: existing protocol-v2 `Goal`, `GoalAcceptanceState`, `GoalStatus`, `StopReason`, `AcceptanceRepairDirective`, and `GoalProgressEvent`.

- [ ] **Step 1: Write failing shared-contract tests**

Add exact transition and upgrade assertions:

```ts
it("supports recoverable acceptance waiting and unverified completion", () => {
  expect(canTransitionGoalStatus("executing", "waiting_for_acceptance")).toBe(true);
  expect(canTransitionGoalStatus("waiting_for_acceptance", "executing")).toBe(true);
  expect(canTransitionGoalStatus("waiting_for_acceptance", "completed_unverified")).toBe(true);
  expect(canTransitionGoalStatus("waiting_for_acceptance", "canceled")).toBe(true);
  expect(canTransitionGoalStatus("completed_unverified", "executing")).toBe(false);
  expect(canTransitionGoalStatus("completed_unverified", "achieved")).toBe(false);
});

it("preserves retry state and manual attestation during protocol upgrade", () => {
  const upgraded = upgradeGoalAcceptanceProtocol(createGoal({
    status: "waiting_for_acceptance",
    acceptanceRetryState: {
      cycle: 2,
      attempt: 3,
      maxAttempts: 3,
      lastCode: "judge_timeout",
      lastDetail: "Final judge timed out.",
      evidenceFingerprint: "a".repeat(64),
      resumeFrom: "final_judge",
    },
  }));
  expect(upgraded.acceptanceRetryState?.resumeFrom).toBe("final_judge");
  expect(upgraded.acceptanceState?.phase).toBeDefined();
});
```

- [ ] **Step 2: Run the shared tests and confirm RED**

Run: `npm test -- --run src/shared/agentGoal.test.ts`

Expected: FAIL because the new statuses, transitions, and fields do not exist.

- [ ] **Step 3: Add the minimal shared types and transitions**

Implement the following exported contracts exactly:

```ts
export type GoalAcceptanceRetryState = {
  cycle: number;
  attempt: number;
  maxAttempts: number;
  lastCode: string;
  lastDetail: string;
  nextRetryAt?: string;
  evidenceFingerprint: string;
  resumeFrom: "final_judge";
};

export type GoalManualCompletionAttestation = {
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

Add optional `acceptanceRetryState` and `manualCompletionAttestation` to `Goal`. Extend `allowedTransitions` with only the transitions asserted above. Extend the trajectory and progress-event unions with retry, wait, and manual-completion event names while preserving exhaustive checks.

- [ ] **Step 4: Run shared tests and type-adjacent tests**

Run: `npm test -- --run src/shared/agentGoal.test.ts src/shared/agentTrajectory.test.ts src/shared/chat.test.ts`

Expected: PASS with no TypeScript errors or snapshots treating `completed_unverified` as certified.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/shared/agentGoal.ts src/shared/agentGoal.test.ts src/shared/agentTrajectory.ts src/shared/chat.ts
git commit -m "feat: add recoverable acceptance states"
```

---

### Task 2: Typed Acceptance Infrastructure Retry Policy

**Files:**
- Create: `src/main/agentGoalAcceptanceRetryPolicy.ts`
- Create: `src/main/agentGoalAcceptanceRetryPolicy.test.ts`
- Modify: `src/main/agentGoalAcceptance.ts`
- Modify: `src/main/agentGoalAcceptance.test.ts`

**Interfaces:**
- Consumes: `AcceptanceResult`, provider errors with optional `status`, `statusCode`, `code`, `responseHeaders`, and `headers`.
- Produces: `AcceptanceInfrastructureFailure`, `AcceptanceRetryDecision`, `classifyAcceptanceInfrastructureFailure(error)`, `decideFinalAcceptanceRetry(result, attempt, nowMs)`.

- [ ] **Step 1: Write failing retry-policy tests**

Create policy tests covering structured errors and deterministic delays:

```ts
it.each([
  [Object.assign(new Error("reset"), { code: "ECONNRESET" }), "network_reset"],
  [Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }), "judge_timeout"],
  [Object.assign(new Error("busy"), { status: 503 }), "provider_unavailable"],
  [Object.assign(new Error("limited"), { status: 429 }), "rate_limited"],
])("classifies retryable infrastructure failures", (error, code) => {
  expect(classifyAcceptanceInfrastructureFailure(error)).toMatchObject({
    code,
    retryable: true,
  });
});

it("uses bounded retry-after before exponential fallback", () => {
  const limited = Object.assign(new Error("limited"), {
    status: 429,
    responseHeaders: { "retry-after-ms": "1500" },
  });
  expect(classifyAcceptanceInfrastructureFailure(limited).retryAfterMs).toBe(1500);
  expect(decideFinalAcceptanceRetry(timeoutResult(), 1, 10_000)).toMatchObject({
    action: "retry",
    delayMs: 1000,
    nextRetryAt: new Date(11_000).toISOString(),
  });
});

it("waits for the user after the third retryable failure", () => {
  expect(decideFinalAcceptanceRetry(timeoutResult(), 3, 10_000)).toEqual({
    action: "wait_for_user",
    code: "judge_timeout",
  });
});

it("allows only one clean retry for an invalid judge response", () => {
  expect(decideFinalAcceptanceRetry(invalidJudgeResult(), 1, 10_000).action).toBe("retry");
  expect(decideFinalAcceptanceRetry(invalidJudgeResult(), 2, 10_000)).toEqual({
    action: "wait_for_user",
    code: "judge_invalid_response",
  });
});
```

- [ ] **Step 2: Run the new policy test and confirm RED**

Run: `npm test -- --run src/main/agentGoalAcceptanceRetryPolicy.test.ts`

Expected: FAIL because the module and functions do not exist.

- [ ] **Step 3: Implement the classifier and decision helper**

Export these exact types and constants:

```ts
export const FINAL_ACCEPTANCE_MAX_ATTEMPTS = 3;
export const FINAL_ACCEPTANCE_RETRY_DELAYS_MS = [1000, 2000] as const;
export const FINAL_ACCEPTANCE_MAX_RETRY_AFTER_MS = 30_000;

export type AcceptanceInfrastructureFailure = {
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

export type AcceptanceRetryDecision =
  | { action: "retry"; code: string; delayMs: number; nextRetryAt: string }
  | { action: "wait_for_user"; code: string }
  | { action: "not_applicable" };
```

Keep provider error parsing in pure helpers. Cap retry headers at 30 seconds. Return `not_applicable` for accepted, repairable semantic rejection, blocked external, and impossible verdicts.
Limit `judge_invalid_response` to two total attempts while transport/capacity failures use three total attempts.

- [ ] **Step 4: Write and run failing judge-profile tests**

Add an acceptance test that captures the real request:

```ts
it("uses a lean final judge profile and bounded prompt", async () => {
  let request: ChatCompletionRequest | undefined;
  const result = await createAgentGoalAcceptance({
    chatClient: {
      async complete(input) {
        request = input;
        return acceptedJudgeResponse("artifact:goalEvidence");
      },
    },
  }).evaluateGoal(largeFailureHistoryGoal(), createContext({
    modelProfile: {
      baseUrl: "https://example.test/v1",
      apiKey: "secret",
      model: "qwen3.7-plus",
      temperature: 0.2,
      maxTokens: 32768,
      thinking: { type: "enabled", budgetTokens: 8192 },
    },
  }));

  expect(result.accepted).toBe(true);
  expect(request?.thinking).toEqual({ type: "disabled" });
  expect(request?.maxTokens).toBe(1024);
  expect(request?.temperature).toBe(0);
  expect(JSON.stringify(request?.messages)).not.toContain("actionSignatures");
  expect(JSON.stringify(request?.messages).length).toBeLessThan(30_000);
});
```

Run: `npm test -- --run src/main/agentGoalAcceptance.test.ts -t "lean final judge"`

Expected: FAIL because the judge inherits thinking and 32,768 output tokens and includes verbose failure records.

- [ ] **Step 5: Make one acceptance attempt return typed retry metadata**

Extend `AcceptanceContext.modelProfile` so its type includes the existing optional `thinking` request property. Keep the milestone judge default at 30,000 ms and add a separate `finalJudgeTimeoutMs` option with a 60,000 ms default. Set final request overrides after spreading the model profile:

```ts
const request: ChatCompletionRequest = {
  ...modelProfile,
  temperature: 0,
  maxTokens: 1024,
  thinking: { type: "disabled" },
  messages: buildFinalJudgeMessages(compactInput),
  tool_choice: "none",
};
```

Change failed judge outcomes to retain their sanitized structured error and attach:

```ts
retry: classifyAcceptanceInfrastructureFailure(error)
```

to `AcceptanceResult`. Replace raw `recentFailures` in the final prompt with only target, failed check IDs, stable codes, evidence refs, fingerprint, and occurrence. Run:

`npm test -- --run src/main/agentGoalAcceptanceRetryPolicy.test.ts src/main/agentGoalAcceptance.test.ts`

Expected: PASS, including existing abort and fail-closed tests.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/main/agentGoalAcceptanceRetryPolicy.ts src/main/agentGoalAcceptanceRetryPolicy.test.ts src/main/agentGoalAcceptance.ts src/main/agentGoalAcceptance.test.ts
git commit -m "fix: classify and bound final judge retries"
```

---

### Task 3: Controller Acceptance Cycle Without Task Re-execution

**Files:**
- Modify: `src/main/agentGoalController.ts`
- Modify: `src/main/agentGoalController.test.ts`
- Modify: `src/main/agentGoalRepairPolicy.ts`
- Modify: `src/main/agentGoalRepairPolicy.test.ts`

**Interfaces:**
- Consumes: `decideFinalAcceptanceRetry`, `Goal.acceptanceRetryState`, one-attempt `acceptance.evaluateGoal`.
- Produces: `AgentGoalController.continueAcceptance(goalId, options?)`, `AgentGoalController.markCompletedUnverified(goalId)`, retry and waiting events.

- [ ] **Step 1: Write the failing controller retry test**

```ts
it("retries only the final judge and certifies on the second attempt", async () => {
  const runtime = createRuntime();
  const acceptance = createAcceptanceResults({
    milestones: [acceptedResult("check_done")],
    goals: [timeoutResult(), acceptedResult("criterion_goal_satisfied_review")],
  });
  const controller = createController({
    runtime,
    acceptance,
    sleep: async () => undefined,
  });

  const result = await controller.start("goal_1");

  expect(result.status).toBe("achieved");
  expect(acceptance.goalCalls).toBe(2);
  expect(runtime.runMilestoneIds).toEqual(["milestone_1"]);
  expect(result.budgetUsage.toolCalls).toBe(1);
  expect(trajectoryEvents.map((event) => event.type)).toContain("acceptance_retry_scheduled");
});
```

- [ ] **Step 2: Run the controller test and confirm RED**

Run: `npm test -- --run src/main/agentGoalController.test.ts -t "retries only the final judge"`

Expected: FAIL because the first timeout transitions to `stopped_blocked`.

- [ ] **Step 3: Implement automatic acceptance-cycle retry**

Add controller options for deterministic tests without weakening production defaults:

```ts
acceptanceRetry?: {
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  nowMs?: () => number;
};
```

Before `applyAcceptanceDecision` for a final-goal result, call `decideFinalAcceptanceRetry`. For `retry`:

1. persist phase `retrying` and retry state;
2. append retry ledger/trajectory events;
3. notify progress with `正在重试最终验收（N/3）`;
4. await an abortable delay;
5. continue the controller loop while all accepted milestones remain untouched.

Do not route transport retry through milestone repair or replan.

- [ ] **Step 4: Write the failing exhaustion test**

```ts
it("preserves a completed goal in acceptance waiting after three timeouts", async () => {
  const runtime = createRuntime();
  const controller = createController({
    runtime,
    acceptance: createAcceptanceResults({
      milestones: [acceptedResult("check_done")],
      goals: [timeoutResult(), timeoutResult(), timeoutResult()],
    }),
    sleep: async () => undefined,
  });

  const result = await controller.start("goal_1");

  expect(result.status).toBe("waiting_for_acceptance");
  expect(result.stopReason).toBeUndefined();
  expect(result.acceptanceState?.phase).toBe("awaiting_user");
  expect(result.acceptanceRetryState).toMatchObject({
    attempt: 3,
    maxAttempts: 3,
    lastCode: "judge_timeout",
    resumeFrom: "final_judge",
  });
  expect(runtime.runMilestoneIds).toEqual(["milestone_1"]);
  expect(result.acceptanceCertificate).toBeUndefined();
});
```

Run: `npm test -- --run src/main/agentGoalController.test.ts -t "acceptance waiting"`

Expected: FAIL until the waiting transition exists.

- [ ] **Step 5: Implement waiting transition and repair-policy separation**

When final acceptance has no automatic retry remaining, transition to `waiting_for_acceptance`, set `awaiting_user`, persist the evidence fingerprint and failure details, emit `acceptance_retry_exhausted` and `acceptance_waiting_for_user`, and return without calling `stopGoal`.

Retain existing milestone-level `acceptance_unavailable -> stop_blocked`. Add `wait_for_acceptance` to the shared directive only for final-goal infrastructure failure. Tests must prove semantic rejection, impossible, external block, and certificate failure retain existing behavior.

- [ ] **Step 6: Verify Task 3 and commit**

Run:

`npm test -- --run src/main/agentGoalController.test.ts src/main/agentGoalRepairPolicy.test.ts`

Expected: PASS with the existing no-false-certification and cancellation tests.

```bash
git add src/main/agentGoalController.ts src/main/agentGoalController.test.ts src/main/agentGoalRepairPolicy.ts src/main/agentGoalRepairPolicy.test.ts
git commit -m "feat: preserve goals awaiting final acceptance"
```

---

### Task 4: Durable Continue-Acceptance and Restart Recovery

**Files:**
- Modify: `src/main/agentGoalController.ts`
- Modify: `src/main/agentGoalController.test.ts`
- Modify: `src/main/agentGoalStore.ts`
- Modify: `src/main/agentGoalStore.test.ts`
- Modify: `src/main/storage/repositories/goalRepository.ts`
- Modify: `src/main/storage/repositories/repositories.test.ts`
- Modify: `src/main/container.ts`
- Modify: `src/main/container.test.ts`

**Interfaces:**
- Consumes: `waiting_for_acceptance`, `GoalAcceptanceRetryState.evidenceFingerprint`.
- Produces: durable active-state semantics and `continueAcceptance(goalId, options?)` that resumes only `final_judge`.

- [ ] **Step 1: Write failing persistence and restart tests**

```ts
it("lists waiting-for-acceptance goals as active and preserves retry state", async () => {
  await store.save(waitingForAcceptanceGoal());
  await expect(store.listActive()).resolves.toEqual([
    expect.objectContaining({
      status: "waiting_for_acceptance",
      acceptanceRetryState: expect.objectContaining({ lastCode: "judge_timeout" }),
    }),
  ]);
});

it("does not auto-resume a waiting acceptance on app startup", async () => {
  await store.save(waitingForAcceptanceGoal());
  expect(await container.resumePersistedGoals()).toBe(0);
  expect(await store.get("goal_1")).toMatchObject({ status: "waiting_for_acceptance" });
});
```

- [ ] **Step 2: Run persistence tests and confirm RED**

Run: `npm test -- --run src/main/agentGoalStore.test.ts src/main/storage/repositories/repositories.test.ts src/main/container.test.ts -t "waiting-for-acceptance|waiting acceptance"`

Expected: FAIL because repository active-state logic and startup recovery do not know the new status.

- [ ] **Step 3: Implement durable active-state semantics**

Treat `waiting_for_acceptance` as active/readable but not auto-runnable. Treat `completed_unverified` as terminal and irreversible alongside `achieved` and `canceled`. Preserve canonical manual attestation and reject stale writes that attempt to move it back to a nonterminal state.

Normalize missing optional retry/attestation fields without modifying stored historical JSON. Keep existing `stopped_blocked / acceptance_unavailable` records unchanged on read.

- [ ] **Step 4: Write failing continue-acceptance tests**

```ts
it("continues from the final judge without rerunning accepted milestones", async () => {
  await store.save(waitingForAcceptanceGoal());
  const result = await controller.continueAcceptance("goal_1");
  expect(result.status).toBe("achieved");
  expect(runtime.runMilestoneIds).toEqual([]);
  expect(acceptance.goalCalls).toBe(1);
});

it("refuses stale certification when the evidence fingerprint changes", async () => {
  await store.save(waitingForAcceptanceGoal({ evidenceFingerprint: "a".repeat(64) }));
  acceptanceContextFingerprint = "b".repeat(64);
  const result = await controller.continueAcceptance("goal_1");
  expect(result.status).toBe("waiting_for_acceptance");
  expect(result.acceptanceCertificate).toBeUndefined();
});
```

- [ ] **Step 5: Implement continue-acceptance and legacy upgrade**

`continueAcceptance` must:

```ts
assertGoalTransition(goal.status, "executing");
const candidate: Goal = {
  ...goal,
  status: "executing",
  acceptanceState: { ...goal.acceptanceState!, phase: "retrying" },
  acceptanceRetryState: {
    ...goal.acceptanceRetryState!,
    cycle: goal.acceptanceRetryState!.cycle + 1,
    attempt: 0,
    nextRetryAt: undefined,
  },
};
```

Then enter the controller loop. Because every milestone is already accepted, the first operation is `evaluateGoal`. A legacy `stopped_blocked / acceptance_unavailable` retry is converted to the same final-judge cycle only when all milestones are accepted; otherwise existing execution retry behavior remains.

- [ ] **Step 6: Verify Task 4 and commit**

Run:

`npm test -- --run src/main/agentGoalController.test.ts src/main/agentGoalStore.test.ts src/main/storage/repositories/repositories.test.ts src/main/container.test.ts`

Expected: PASS.

```bash
git add src/main/agentGoalController.ts src/main/agentGoalController.test.ts src/main/agentGoalStore.ts src/main/agentGoalStore.test.ts src/main/storage/repositories/goalRepository.ts src/main/storage/repositories/repositories.test.ts src/main/container.ts src/main/container.test.ts
git commit -m "feat: resume final acceptance after restart"
```

---

### Task 5: Manual Completion Attestation and User Operations

**Files:**
- Modify: `src/main/agentGoalController.ts`
- Modify: `src/main/agentGoalController.test.ts`
- Modify: `src/main/goalChatService.ts`
- Modify: `src/main/goalChatService.test.ts`
- Modify: `src/main/container.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/ipc/index.test.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.test.ts`
- Modify: `src/renderer/global.d.ts`
- Modify: `src/main/agentGoalAcceptanceCertificate.test.ts`

**Interfaces:**
- Produces: `continueGoalAcceptance(goalId)`, `markGoalCompletedUnverified(goalId)`, IPC `goal:continueAcceptance`, IPC `goal:markCompletedUnverified`.
- Consumes: controller `continueAcceptance` and `markCompletedUnverified`.

- [ ] **Step 1: Write failing manual-completion state tests**

```ts
it("records manual completion without creating a certificate", async () => {
  await store.save(waitingForAcceptanceGoal());

  const result = await controller.markCompletedUnverified("goal_1");

  expect(result).toMatchObject({
    status: "completed_unverified",
    stopReason: "user_marked_complete",
    manualCompletionAttestation: {
      version: 1,
      goalId: "goal_1",
      reason: "user_marked_complete",
      lastFailureCode: "judge_timeout",
    },
  });
  expect(result.acceptanceCertificate).toBeUndefined();
  expect(verifyGoalAcceptanceCertificate(result)).not.toEqual({ ok: true });
});

it("rejects manual completion from a running or certified goal", async () => {
  await store.save(executingGoal());
  await expect(controller.markCompletedUnverified("goal_1")).rejects.toThrow(
    'Cannot manually complete goal from "executing".',
  );
});
```

- [ ] **Step 2: Run the manual-completion tests and confirm RED**

Run: `npm test -- --run src/main/agentGoalController.test.ts src/main/agentGoalAcceptanceCertificate.test.ts -t "manual completion"`

Expected: FAIL because the controller method and attestation do not exist.

- [ ] **Step 3: Implement atomic manual completion**

Allow the action only from `waiting_for_acceptance`. Build the attestation from the canonical retry state and latest failure record, pass all strings through the existing redaction/bounds, clear any next retry timestamp, save `completed_unverified` and the attestation in one canonical store mutation, then append manual completion ledger/trajectory events. Never call `createGoalAcceptanceCertificate`.

- [ ] **Step 4: Write failing service, IPC, and preload tests**

Assert the exact new surface:

```ts
expect(windowApi.continueGoalAcceptance).toBeTypeOf("function");
expect(windowApi.markGoalCompletedUnverified).toBeTypeOf("function");
expect(ipcInvoke).toHaveBeenCalledWith("goal:continueAcceptance", "goal_1");
expect(ipcInvoke).toHaveBeenCalledWith("goal:markCompletedUnverified", "goal_1");
```

Run: `npm test -- --run src/main/goalChatService.test.ts src/main/ipc/index.test.ts src/preload/index.test.ts`

Expected: FAIL because the operations are absent.

- [ ] **Step 5: Wire explicit operations end to end**

Extend `GoalChatService` and its controller `Pick`:

```ts
continueAcceptance(
  goalId: string,
  options?: { signal?: AbortSignal },
): Promise<ChatSessionGoalSummary>;
markCompletedUnverified(goalId: string): Promise<ChatSessionGoalSummary>;
```

Add container wrappers through `runGoalOperation`, IPC handlers, preload functions, and renderer global typing. Do not overload generic `retryGoal`: the UI must distinguish task retry from final-acceptance retry.

- [ ] **Step 6: Verify Task 5 and commit**

Run:

`npm test -- --run src/main/agentGoalController.test.ts src/main/goalChatService.test.ts src/main/ipc/index.test.ts src/preload/index.test.ts src/main/agentGoalAcceptanceCertificate.test.ts`

Expected: PASS.

```bash
git add src/main/agentGoalController.ts src/main/agentGoalController.test.ts src/main/goalChatService.ts src/main/goalChatService.test.ts src/main/container.ts src/main/ipc/index.ts src/main/ipc/index.test.ts src/preload/index.ts src/preload/index.test.ts src/renderer/global.d.ts src/main/agentGoalAcceptanceCertificate.test.ts
git commit -m "feat: add audited manual goal completion"
```

---

### Task 6: Renderer Retry, Waiting, and Manual Completion UX

**Files:**
- Modify: `src/renderer/goalProgressViewModel.ts`
- Modify: `src/renderer/goalProgressViewModel.test.ts`
- Modify: `src/renderer/components/GoalDetailDrawer.tsx`
- Modify: `src/renderer/components/GoalStatusStrip.tsx`
- Modify: `src/renderer/components/AgentChatPanel.tsx`
- Modify: `src/renderer/styles/chat.css`
- Modify: `src/renderer/materialDesign.test.ts`

**Interfaces:**
- Consumes: new Goal statuses, retry state, manual attestation, preload operations.
- Produces: recovery actions `continue_acceptance | mark_completed_unverified | terminate`, confirmation dialog, and truthful status copy.

- [ ] **Step 1: Write failing view-model tests**

```ts
it("projects exhausted judge retries as acceptance waiting", () => {
  const presentation = buildGoalStatusPresentation(
    "waiting_for_acceptance",
    waitingForAcceptanceGoal(),
  );
  expect(presentation).toMatchObject({
    statusLabel: "任务产物已完成，等待最终验收",
    recoveryActions: ["continue_acceptance", "mark_completed_unverified", "terminate"],
  });
  expect(presentation.statusDetail).toContain("最终裁判超时");
});

it("never presents manual completion as certified success", () => {
  const presentation = buildGoalStatusPresentation(
    "completed_unverified",
    manuallyCompletedGoal(),
  );
  expect(presentation.statusLabel).toBe("手动完成 · 未经机器认证");
  expect(presentation.certificate).toBeUndefined();
  expect(presentation.recoveryActions).toEqual([]);
});
```

- [ ] **Step 2: Run view-model tests and confirm RED**

Run: `npm test -- --run src/renderer/goalProgressViewModel.test.ts`

Expected: FAIL because the switch is not exhaustive for the new statuses.

- [ ] **Step 3: Implement truthful projections**

Add retrying projection before the status switch:

```ts
if (status === "executing" && acceptance?.phase === "retrying") {
  const retry = goal?.acceptanceRetryState;
  return withAcceptance({
    statusLabel: `正在重试最终验收（${retry?.attempt ?? 1}/${retry?.maxAttempts ?? 3}）`,
    statusDetail: safeAcceptanceRetryDetail(retry),
    nextActionLabel: "最终验收",
    nextActionDetail: retry?.nextRetryAt
      ? `下次重试：${formatRetryTime(retry.nextRetryAt)}`
      : "正在请求独立裁判。",
    recoveryActions: [],
  }, acceptance, certificate);
}
```

Add switch cases for waiting and manual completion. Map the exact safe codes `judge_timeout`, `rate_limited`, `provider_unavailable`, and `network_reset` to Chinese diagnostics; unknown codes use a bounded neutral message.

- [ ] **Step 4: Write failing interaction and material tests**

Assert that waiting details render two distinct actions, that manual completion opens confirmation copy containing `不会生成机器验收证书`, and that confirming invokes `markGoalCompletedUnverified`. Assert the new amber class exists and the green certified class is not used for manual completion.

Run: `npm test -- --run src/renderer/materialDesign.test.ts`

Expected: FAIL because the buttons, handler, confirmation, and styling are absent.

- [ ] **Step 5: Implement renderer interactions**

Add props:

```ts
onContinueAcceptance?: () => void;
onMarkCompletedUnverified?: () => void;
```

Wire `AgentChatPanel` handlers to the new preload methods. Use a local confirmation surface with cancel and confirm buttons; disable both operations while IPC is pending. Refresh canonical goal state from the returned operation result. Ensure `GoalStatusStrip` uses `继续验收`, not `继续执行`, for the waiting state.

- [ ] **Step 6: Verify Task 6 and commit**

Run:

`npm test -- --run src/renderer/goalProgressViewModel.test.ts src/renderer/materialDesign.test.ts`

Expected: PASS.

```bash
git add src/renderer/goalProgressViewModel.ts src/renderer/goalProgressViewModel.test.ts src/renderer/components/GoalDetailDrawer.tsx src/renderer/components/GoalStatusStrip.tsx src/renderer/components/AgentChatPanel.tsx src/renderer/styles/chat.css src/renderer/materialDesign.test.ts
git commit -m "feat: show recoverable final acceptance state"
```

---

### Task 7: Feature Closure, Independent Review, Merge, and Packaged Handoff

**Files:**
- Modify: `.zerox/feature_list.json`
- Modify: `.zerox/progress.md`
- Modify if required by review: only files already listed in Tasks 1-6

**Interfaces:**
- Consumes: complete implementation and all focused tests.
- Produces: review evidence, verification evidence, `main` merge, packaged macOS app, and a running app for human inspection.

- [ ] **Step 1: Add the feature record and focused verification list**

Add one feature entry with status `in_progress`, exact changed files, the design/plan paths, and these definition-of-done statements:

```json
[
  "Transient final-judge failures retry visibly without rerunning accepted task work",
  "Exhausted retries preserve a durable waiting_for_acceptance state",
  "Users can continue final acceptance from persisted evidence",
  "Manual completion is terminal, audited, unverified, and never certificate-backed",
  "Restart, cancellation, stale writes, renderer copy, and historical goals remain safe"
]
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
npm test -- --run \
  src/shared/agentGoal.test.ts \
  src/main/agentGoalAcceptanceRetryPolicy.test.ts \
  src/main/agentGoalAcceptance.test.ts \
  src/main/agentGoalRepairPolicy.test.ts \
  src/main/agentGoalController.test.ts \
  src/main/agentGoalStore.test.ts \
  src/main/storage/repositories/repositories.test.ts \
  src/main/goalChatService.test.ts \
  src/main/container.test.ts \
  src/main/ipc/index.test.ts \
  src/preload/index.test.ts \
  src/renderer/goalProgressViewModel.test.ts \
  src/renderer/materialDesign.test.ts
```

Expected: all listed files pass with zero failures.

- [ ] **Step 3: Dispatch independent code review**

Record `IMPLEMENTATION_BASE_SHA` immediately before Task 1 changes and `IMPLEMENTATION_HEAD_SHA` after Task 6. Give the reviewer the approved design, this plan, both SHAs, and explicit questions about fail-closed certification, duplicated work, retry budgets, stale writes, manual-attestation trust, IPC safety, and renderer truthfulness. Fix every Critical or Important finding with a new failing test first, then rerun the focused suite.

- [ ] **Step 4: Dispatch independent test acceptance**

Give a different agent no implementation history. Require it to run the focused suite, `npm run harness:check`, `npm run verify`, `npm run smoke:prod`, inspect the original incident path via tests, and report pass/fail with command evidence. Do not accept a summary without fresh command output.

- [ ] **Step 5: Record evidence and close the feature**

Update `.zerox/progress.md` with exact test counts, review findings and fixes, build/smoke output, changed files, and known limitations. Change the feature status to `done` only after both independent agents have no blocking findings.

- [ ] **Step 6: Commit the reviewed implementation**

```bash
git add .zerox/feature_list.json .zerox/progress.md
git commit -m "chore: close goal acceptance recovery"
```

- [ ] **Step 7: Verify and merge to main**

Run before merge:

```bash
npm run harness:check
npm run verify
npm run smoke:prod
git diff --check
```

Then switch to `main`, merge the reviewed feature branch without force, and rerun the same four commands on the merge result. Do not delete the branch or continue packaging if any command fails.

- [ ] **Step 8: Package and launch for human inspection**

Stop the previously packaged Zerox Agent process gracefully, run `npm run dist:mac`, verify the packaged app version and artifacts, launch:

```bash
open "/Volumes/Out/codex_projects/building agent/release/mac-arm64/Zerox Agent.app"
```

Confirm a new packaged process is running from that exact path. Report the merge SHA, package paths and hashes, process evidence, and the manual inspection scenarios: automatic retry, waiting state, continue acceptance, and manual unverified completion.
