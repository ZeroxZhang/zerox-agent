# Evidence Driven Stop Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add P8.3 evidence-driven ARK stop policy primitives that reject unsupported completion claims and surface typed judge decisions to the runtime kernel.

**Architecture:** Keep existing Goal Mode acceptance intact. Add a kernel-level `EvidenceJudgePolicy` with an injected judge adapter so model-specific prompting can remain outside the policy. The policy validates that successful verdict evidence is quoted from the transcript before allowing the runtime kernel to stop as succeeded.

**Tech Stack:** TypeScript, Vitest, existing `ChatMessage` type, P8.0 `StopPolicy`/`StopDecision` kernel types.

---

## File Structure

- Create `src/main/kernel/stopPolicy.ts`
  - `createTurnLimitPolicy`, `createEvidenceJudgePolicy`, `validateEvidenceJudgeVerdict`.
- Create `src/main/kernel/stopPolicy.test.ts`
  - Evidence success, missing work, hallucinated evidence fallback, impossible stop, and max-react cap tests.
- Modify `.zerox/feature_list.json`
  - Add P8.3 plan/test files and mark P8.3 done after verification.
- Modify `.zerox/progress.md`
  - Record changed files and command evidence.

## Task 1: Evidence Judge Policy

- [ ] **Step 1: Write failing tests**

Add `src/main/kernel/stopPolicy.test.ts` asserting:

- `ok: true` with transcript-quoted evidence returns `stop: true`.
- `ok: false` with `missing` returns `stop: false`.
- `ok: true` with evidence not present in transcript returns `stop: false` and reason `insufficient evidence in transcript`.
- `ok: false, impossible: true` returns `stop: true, impossible: true`.
- attempts beyond `maxReact` return impossible without calling judge again.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/main/kernel/stopPolicy.test.ts`

Expected: FAIL because `stopPolicy.ts` does not exist.

- [ ] **Step 3: Implement policy**

Create the policy with an injected `judge(input)` function and transcript-normalized evidence matching. Add a small `createTurnLimitPolicy` helper for future runtime migration.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- src/main/kernel/stopPolicy.test.ts src/main/kernel/runtimeKernel.test.ts`

Expected: PASS.

## Task 2: Feature Evidence And Verification

- [ ] **Step 1: Update feature metadata**

Add P8.3 plan/test files to `.zerox/feature_list.json`; mark P8.3 `done` only after verification passes.

- [ ] **Step 2: Record progress**

Append changed files and command evidence to `.zerox/progress.md`.

- [ ] **Step 3: Run required checks**

Run:

```bash
npm test -- src/main/kernel/stopPolicy.test.ts src/main/kernel/runtimeKernel.test.ts src/main/agentGoalAcceptance.test.ts src/main/goalRuntimeEngine.test.ts
npm run build
npm run verify
npm run harness:check
git diff --check
```

Expected: all pass. `npm run smoke:prod` is not required because P8.3 adds kernel policy primitives without renderer changes.
