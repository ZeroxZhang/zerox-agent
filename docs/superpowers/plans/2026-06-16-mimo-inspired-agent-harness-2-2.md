# MiMo-Inspired Agent Harness 2.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the useful MiMo-Code harness ideas into Zerox Agent 2.2.0 without copying implementation code or weakening local-first permission boundaries.

**Architecture:** Keep Zerox's existing Goal Mode, recoverable runtime, trajectory store, and tool authorization services as the execution boundary. Add a model-profiled system prompt builder, MiMo-style transcript-backed goal judge evidence, and an 11-section goal continuity checkpoint that is injected into goal context and asserted by evals. Avoid MiMo's hosted channels and QuickJS dynamic workflow for this release.

**Tech Stack:** TypeScript, Electron main process, shared typed models, Vitest, deterministic agent eval fixtures, local JSON stores.

---

## File Structure

- Modify `src/shared/agentProtocol.ts`
  - Add optional model/environment/profile inputs to `buildAgentSystemPrompt`.
  - Route known model IDs to concise profile guidance inspired by MiMo's prompt routing.
- Modify `src/shared/agentProtocol.test.ts`
  - Cover default prompt compatibility and model-specific prompt selection.
- Create `src/shared/agentGoalContinuity.ts`
  - Build an 11-section goal continuity checkpoint from `Goal`, milestone state, budget, and ledger events.
- Create `src/shared/agentGoalContinuity.test.ts`
  - Cover all sections, active intent, next action, accepted/open milestone summaries, and budget/live-resource fields.
- Modify `src/main/agentGoalContext.ts`
  - Inject the continuity checkpoint into never-compact goal anchors.
- Modify `src/main/agentGoalContext.test.ts`
  - Assert continuity checkpoint sections survive compaction.
- Modify `src/shared/agentTrajectory.ts`
  - Add `goal_judged` trajectory event type.
- Modify `src/main/agentGoalAcceptance.ts`
  - Add transcript-aware model review verdict parsing.
  - Emit `goal_judged` before `acceptance_checked` when model review runs.
- Modify `src/main/agentGoalAcceptance.test.ts`
  - Cover transcript-backed judge success, insufficient transcript rejection, impossible verdict handling, and trajectory evidence.
- Modify `src/main/agentGoalController.ts`
  - Pass the latest milestone runtime result to `createAcceptanceContext`.
- Modify `src/main/goalRuntimeEngine.ts`
  - Return bounded transcript messages from `runAgentLoop`.
  - Use model-profiled goal system prompt.
- Modify `src/main/goalRuntimeEngine.test.ts`
  - Cover transcript forwarding and model-profiled prompt content.
- Modify `src/main/container.ts`
  - Include runtime transcript messages in acceptance context.
- Modify `src/main/eval/agentEvalFixtures.ts`
  - Add a goal eval fixture requiring `goal_judged` before `acceptance_checked`.
- Modify `src/main/eval/agentEvalRunner.test.ts`
  - Update deterministic fixture totals and goal fixture list.
- Modify `src/main/eval/agentEvalAdversary.ts` and `.test.ts`
  - Add adversarial mutation for removing `goal_judged` from transcript-judge fixtures.
- Modify `src/shared/harnessScore.ts` and `.test.ts`
  - Surface a goal judge pass-rate summary when evals include judge fixtures.
- Modify `.zerox/feature_list.json`
  - Add one 2.2.0 feature entry and mark it done only after verification.
- Modify `README.md`, `src/shared/readme.test.ts`, `package.json`, `package-lock.json`, `.zerox/progress.md`
  - Release and verification updates after the code is complete.

## Task 1: Prompt Profile Routing

**Files:**
- Modify: `src/shared/agentProtocol.ts`
- Modify: `src/shared/agentProtocol.test.ts`
- Modify: `src/main/agentLoop.ts`
- Modify: `src/main/agentRuntimeEngine.ts`
- Modify: `src/main/goalRuntimeEngine.ts`

- [ ] **Step 1: Write failing tests**

Add tests that call:

```ts
buildAgentSystemPrompt({ modelId: "gpt-5-codex", workspaceRoot: "/repo", currentDate: "2026-06-16" });
buildAgentSystemPrompt({ modelId: "claude-sonnet-5", workspaceRoot: "/repo" });
```

Expected assertions: the Codex profile mentions concise tool-first execution, the Claude profile mentions independent review and avoiding unnecessary files, and both include environment metadata without exposing secrets.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/shared/agentProtocol.test.ts`

Expected: FAIL because `buildAgentSystemPrompt` does not accept profile options yet.

- [ ] **Step 3: Implement prompt options**

Add `AgentSystemPromptOptions`, `selectAgentPromptProfile`, and append a short profile block to the existing prompt. Keep existing no-argument behavior intact.

- [ ] **Step 4: Wire prompt callers**

Use `buildAgentSystemPrompt({ modelId: modelProfile.model })` in active loops. For goal runtime, keep the goal-specific rules but prepend the profiled core prompt.

- [ ] **Step 5: Run GREEN**

Run: `npm test -- src/shared/agentProtocol.test.ts src/main/goalRuntimeEngine.test.ts`

Expected: PASS.

## Task 2: Goal Continuity Checkpoint

**Files:**
- Create: `src/shared/agentGoalContinuity.ts`
- Create: `src/shared/agentGoalContinuity.test.ts`
- Modify: `src/main/agentGoalContext.ts`
- Modify: `src/main/agentGoalContext.test.ts`

- [ ] **Step 1: Write failing tests**

Tests should assert an 11-section checkpoint containing:

```text
§1 Active intent
§2 Next concrete action
§3 Directives
§4 Task tree
§5 Current work
§6 Files and evidence
§7 Discovered knowledge
§8 Errors and fixes
§9 Live resources
§10 Design decisions
§11 Open notes
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/shared/agentGoalContinuity.test.ts src/main/agentGoalContext.test.ts`

Expected: FAIL because the module and injected checkpoint do not exist.

- [ ] **Step 3: Implement checkpoint builder**

Build a deterministic, local-only text snapshot from goal state, accepted/open milestones, budget usage, and recent ledger events. Do not call models or write files.

- [ ] **Step 4: Inject into context anchors**

Add `[Goal continuity checkpoint - never compact]` to goal context anchors, and preserve it during compaction.

- [ ] **Step 5: Run GREEN**

Run: `npm test -- src/shared/agentGoalContinuity.test.ts src/main/agentGoalContext.test.ts`

Expected: PASS.

## Task 3: Transcript-Backed Goal Judge

**Files:**
- Modify: `src/shared/agentTrajectory.ts`
- Modify: `src/main/agentGoalAcceptance.ts`
- Modify: `src/main/agentGoalAcceptance.test.ts`
- Modify: `src/main/agentGoalController.ts`
- Modify: `src/main/goalRuntimeEngine.ts`
- Modify: `src/main/goalRuntimeEngine.test.ts`
- Modify: `src/main/container.ts`

- [ ] **Step 1: Write failing tests**

Add acceptance tests where `model_review` receives `transcriptMessages` and the fake model returns:

```json
{"ok":true,"reason":"Transcript shows npm run verify passed."}
```

Also test:

```json
{"ok":false,"reason":"insufficient evidence in transcript"}
{"ok":false,"impossible":true,"reason":"required external service is unavailable"}
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/main/agentGoalAcceptance.test.ts src/main/goalRuntimeEngine.test.ts`

Expected: FAIL because `goal_judged` and transcript context are missing.

- [ ] **Step 3: Implement judge request**

When `transcriptMessages` exist, send system judge instructions plus transcript plus final condition question with `temperature: 0` and `tool_choice: "none"`. Parse either `{ok, reason, impossible}` or legacy `{accepted, detail}`.

- [ ] **Step 4: Emit judge trajectory**

Emit `goal_judged` with `goalId`, `milestoneId`, `checkId`, `ok`, `impossible`, `reason`, and transcript message count before `acceptance_checked`.

- [ ] **Step 5: Forward runtime transcript**

Return bounded `transcriptMessages` from `GoalRuntimeRunResult`, pass it through the controller into `createAcceptanceContext`, and attach it in the container.

- [ ] **Step 6: Run GREEN**

Run: `npm test -- src/main/agentGoalAcceptance.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalController.test.ts`

Expected: PASS.

## Task 4: Evals, Adversary, Feature Entry

**Files:**
- Modify: `src/main/eval/agentEvalFixtures.ts`
- Modify: `src/main/eval/agentEvalRunner.test.ts`
- Modify: `src/main/eval/agentEvalAdversary.ts`
- Modify: `src/main/eval/agentEvalAdversary.test.ts`
- Modify: `src/shared/harnessScore.ts`
- Modify: `src/shared/harnessScore.test.ts`
- Modify: `.zerox/feature_list.json`

- [ ] **Step 1: Write failing eval tests**

Add fixture `goal-transcript-judge-before-acceptance` requiring:

```text
milestone_started -> final_summary -> goal_judged -> acceptance_checked -> goal_stopped
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/main/eval/agentEvalRunner.test.ts src/main/eval/agentEvalAdversary.test.ts src/shared/harnessScore.test.ts`

Expected: FAIL because fixture totals and adversary mutation are not updated.

- [ ] **Step 3: Implement eval fixture and adversary mutation**

Add `remove_goal_judge` mutation for fixtures requiring `goal_judged`.

- [ ] **Step 4: Add feature entry**

Add `P7-mimo-inspired-agent-harness` with status `done` only after focused tests pass.

- [ ] **Step 5: Run GREEN**

Run: `npm test -- src/main/eval/agentEvalRunner.test.ts src/main/eval/agentEvalAdversary.test.ts src/shared/harnessScore.test.ts`

Expected: PASS.

## Task 5: Release Docs And Verification

**Files:**
- Modify: `README.md`
- Modify: `src/shared/readme.test.ts`
- Modify: `src/shared/packageScripts.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.zerox/progress.md`

- [ ] **Step 1: Write release metadata tests**

Update tests to expect `2.2.0`, the new release asset names, and the new deterministic eval/test counts.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/shared/readme.test.ts src/shared/packageScripts.test.ts`

Expected: FAIL until metadata and README are updated.

- [ ] **Step 3: Update docs and package metadata**

Run `npm version 2.2.0 --no-git-tag-version`, then update README release copy and `.zerox/progress.md`.

- [ ] **Step 4: Final verification**

Run:

```bash
npm test
npm run verify
npm run harness:check
npm run harness:score
npm run smoke:prod
git diff --check
```

- [ ] **Step 5: Package and release**

Run `npm run dist:mac`, push branch/tag, and publish GitHub release `v2.2.0` with macOS assets.

