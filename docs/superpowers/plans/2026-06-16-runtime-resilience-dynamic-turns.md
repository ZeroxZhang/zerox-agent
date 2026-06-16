# Runtime Resilience And Dynamic Turns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add P8.2 retry-after-aware model retry behavior and a reusable dynamic turn-budget helper for ARK.

**Architecture:** Harden the existing `modelRetry.ts` instead of adding a parallel retry path. Add `src/main/kernel/resilience.ts` for kernel-level turn budget derivation so later runtime migration can use one policy for chat and Goal Mode.

**Tech Stack:** TypeScript, Vitest, existing `ChatClient` request contract, P8.0 kernel shared types.

---

## File Structure

- Create `src/main/modelRetry.test.ts`
  - Retry-after-ms, retry-after seconds, retry-after HTTP date, non-retryable status, and abortable custom sleep tests.
- Modify `src/main/modelRetry.ts`
  - Parse retry headers from common error shapes and race custom sleep against abort.
- Create `src/main/kernel/resilience.ts`
  - `deriveRuntimeMaxTurns` helper and exported defaults.
- Create `src/main/kernel/resilience.test.ts`
  - Chat defaults/override and Goal Mode milestone-derived/capped turn budgets.
- Modify `.zerox/feature_list.json`
  - Add the P8.2 plan and focused tests to metadata; mark P8.2 done after verification.
- Modify `.zerox/progress.md`
  - Record changed files and command evidence.

## Task 1: Retry-After Aware Model Retry

- [ ] **Step 1: Write failing tests**

Add `src/main/modelRetry.test.ts` asserting:

- status 429 plus `retry-after-ms: 500` emits and sleeps for 500ms.
- status 503 plus `retry-after: 2` emits and sleeps for 2000ms.
- status 503 plus HTTP-date `retry-after` emits a positive delay.
- status 401 is not retried.
- abort during custom sleep rejects with cancellation before another attempt.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/main/modelRetry.test.ts`

Expected: FAIL because current retry code ignores retry-after headers and custom sleep cannot be aborted.

- [ ] **Step 3: Implement retry parsing and abortable sleep**

Add retry header extraction for `retry-after-ms` and `retry-after` from `responseHeaders`, `headers`, and `response.headers`. Race custom sleep with abort.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- src/main/modelRetry.test.ts src/main/agentLoop.test.ts src/main/agentRuntimeEngine.test.ts`

Expected: PASS.

## Task 2: Dynamic Turn Budget Helper

- [ ] **Step 1: Write failing tests**

Add `src/main/kernel/resilience.test.ts` asserting:

- chat default is 8.
- user override wins for chat but is clamped to hard max.
- goal mode derives `milestoneCount * 6`.
- goal mode caps at absolute max 60.
- zero milestone goal still receives one milestone budget.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/main/kernel/resilience.test.ts`

Expected: FAIL because `resilience.ts` does not exist.

- [ ] **Step 3: Implement helper**

Create `deriveRuntimeMaxTurns` with conservative defaults and no runtime side effects.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- src/main/kernel/resilience.test.ts src/main/kernel/runtimeKernel.test.ts`

Expected: PASS.

## Task 3: Feature Evidence And Verification

- [ ] **Step 1: Update feature metadata**

Add P8.2 plan/test files to `.zerox/feature_list.json`; mark P8.2 `done` only after verification passes.

- [ ] **Step 2: Record progress**

Append changed files and command evidence to `.zerox/progress.md`.

- [ ] **Step 3: Run required checks**

Run:

```bash
npm test -- src/main/modelRetry.test.ts src/main/kernel/resilience.test.ts src/main/agentLoop.test.ts src/main/agentRuntimeEngine.test.ts
npm run build
npm run verify
npm run harness:check
git diff --check
```

Expected: all pass. `npm run smoke:prod` is not required because P8.2 changes main-process retry helpers without renderer behavior changes.
