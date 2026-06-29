# Zerox Agent 3.1.0 Goal Acceptance And Subagent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v3.1.0 so long chat goals keep durable requirement progress, selected skills stay mandatory, subagents actually run with parent context, and the right context rail shows subtask and subagent status instead of vague run activity.

**Architecture:** Keep the fix local-first and evidence-driven: model user requirements as structured activity/status events, repair the actor tool/runtime contract, and let the renderer project those events into a compact right-rail view. Do not bypass `ToolAuthorizationService`, workspace sandbox checks, or existing Goal persistence.

**Tech Stack:** TypeScript, Vitest, existing Chat/Goal services, `DynamicToolRegistry`, `ActorRuntime`, `ChatTaskStatusEvent`, `AgentChatPanel`, Electron smoke/package scripts.

## Global Constraints

- Preserve local-first trust, explicit permissions, observable trajectories, and reviewed learning.
- Do not add cloud workers or unreviewed self-modification in this iteration.
- Do not bypass `ToolAuthorizationService` or workspace sandbox checks.
- Prefer typed shared models and focused tests before runtime behavior changes.
- Complete exactly one feature in this iteration: `P29-v3.1.0-goal-acceptance-subagent-runtime`.
- Fix the actor/subagent path; do not hide the `actor` tool as the solution.
- The right context rail must show decomposed subtask progress and replace default context cards with active subagent status while subagents are running.

---

## Task 1: Actor Runtime And Tool Contract

**Files:**
- Modify: `src/main/actors/actorRuntime.ts`
- Modify: `src/main/actors/actorRuntime.test.ts`
- Modify: `src/main/actors/actorTool.ts`
- Modify: `src/main/actors/actorTool.test.ts`

**Interfaces:**
- Consumes: `ToolExecutionOptions.runContext`, `SpawnInput.parentRunId`.
- Produces: actor tool runs that pass parent run context into `ActorRuntime.spawn()` and return `ok:false` for terminal actor `status:"error"`.

- [ ] **Step 1: Write failing actor runtime status test**

Add a test named `updates status after terminal outcomes resolve` that spawns an actor, waits for completion, and expects `runtime.status(actorId)` to be `"done"`.

Run: `npm test -- src/main/actors/actorRuntime.test.ts -t "updates status after terminal outcomes resolve"`
Expected: FAIL because `status()` still returns the stale in-memory `"running"` record.

- [ ] **Step 2: Write failing actor tool parent-context test**

Add a test named `passes run context parentRunId into spawned actors` that executes the actor tool with `options.runContext.runId = "run_parent"` and expects the injected `runActor` to receive `input.parentRunId === "run_parent"`.

Run: `npm test -- src/main/actors/actorTool.test.ts -t "passes run context parentRunId"`
Expected: FAIL because `actorTool.ts` does not currently read `ToolExecutionOptions`.

- [ ] **Step 3: Write failing actor tool error-outcome test**

Add a test named `returns a tool failure when the actor outcome is error` that makes `runActor` return `{ status:"error", summary:"no parentRunId", filesTouched: [] }` and expects `registry.execute("actor", ...)` to return `ok:false` with error text containing `no parentRunId`.

Run: `npm test -- src/main/actors/actorTool.test.ts -t "returns a tool failure when the actor outcome is error"`
Expected: FAIL because `op:run` currently wraps actor error outcomes in `ok:true`.

- [ ] **Step 4: Implement minimal actor fixes**

Update `ActorRuntime` to update the in-memory actor record to terminal status inside the outcome chain and on cancel. Update `createActorToolHandler()` to accept execution options, derive `parentRunId` from `options.runContext?.runId`, include it in spawn input, and map terminal actor `error` outcomes to `ok:false`.

- [ ] **Step 5: Verify actor contract**

Run: `npm test -- src/main/actors/actorRuntime.test.ts src/main/actors/actorTool.test.ts`
Expected: PASS.

## Task 2: Goal Skill Routing And Acceptance Regression

**Files:**
- Modify: `src/main/chatService.test.ts`
- Modify: `src/main/chatService.ts`

**Interfaces:**
- Consumes: slash-goal input, selected skill record, chat session goal summary persistence.
- Produces: durable Goal records with active summaries and selected skill snapshots for `/目标 ... @skill` requests.

- [ ] **Step 1: Add regression for the captured failure shape**

Add a test using the real pattern `/目标 ... 最后调用 @huashu-design ...` with `selectedSkillName:"huashu-design"`. Assert `goalService.createFromChat()` receives `selectedSkill.manifest.name === "huashu-design"`, the result contains `activeGoal`, and the mock chat session store has an attached active goal summary.

Run: `npm test -- src/main/chatService.test.ts -t "huashu-design slash goal"`
Expected: FAIL only if the current route still falls back to ordinary chat. If it already passes, keep it as a regression guard.

- [ ] **Step 2: Patch routing only if the regression fails**

If the test fails, update `tryRouteGoalIntent()` and the selected-skill resolution path so slash-goal routing happens before ordinary selected-skill chat execution and passes the skill snapshot into `goalService.createFromChat()`.

- [ ] **Step 3: Verify route guard**

Run: `npm test -- src/main/chatService.test.ts -t "slash goal"`
Expected: PASS.

## Task 3: Structured Task And Subagent Status Events

**Files:**
- Modify: `src/shared/chat.ts`
- Modify: `src/main/chatService.ts`
- Modify: `src/main/chatService.test.ts`
- Modify: `src/renderer/chatTaskActivity.ts`
- Modify: `src/renderer/chatTaskActivity.test.ts`

**Interfaces:**
- Produces: `ChatTaskStatusEvent.state` values for `requirement`, `actor_spawned`, and `actor_done`, with `payload.actorId`, `payload.actorStatus`, and requirement labels.
- Consumes: actor tool call/result observations and Goal milestone summaries.

- [ ] **Step 1: Write failing view-model tests for requirement progress**

Add a renderer test that passes `requirement` status events for three subtasks and expects `buildTaskProcessItems()` to return labels `子任务` with active/done/error statuses projected by newest event.

Run: `npm test -- src/renderer/chatTaskActivity.test.ts -t "requirement progress"`
Expected: FAIL because the event state is not modeled.

- [ ] **Step 2: Write failing view-model tests for subagent status**

Add a renderer test that passes `actor_spawned` and `actor_done` events and expects a helper such as `buildSubagentProcessItems()` to return actor rows with id, running/done/error status, and summary.

Run: `npm test -- src/renderer/chatTaskActivity.test.ts -t "subagent status"`
Expected: FAIL because no subagent projection exists.

- [ ] **Step 3: Write failing chat-service status test**

Add a main-process test where a model calls `actor` and assert `onStatusEvent` receives `actor_spawned` and `actor_done` events with actor id and terminal status.

Run: `npm test -- src/main/chatService.test.ts -t "actor status events"`
Expected: FAIL because chat service currently emits only generic tool status.

- [ ] **Step 4: Implement typed event projection**

Extend `ChatTaskStatusEvent.state`, add renderer helpers for requirement/subagent rows, and emit actor-specific status events from chat tool call/result hooks by inspecting `toolName === "actor"` and the actor tool result payload.

- [ ] **Step 5: Verify status projection**

Run: `npm test -- src/main/chatService.test.ts src/renderer/chatTaskActivity.test.ts`
Expected: PASS.

## Task 4: Right Context Rail Rendering

**Files:**
- Modify: `src/renderer/components/AgentChatPanel.tsx`
- Modify: `src/renderer/materialDesign.test.ts`
- Modify: `src/renderer/styles/chat.css`

**Interfaces:**
- Consumes: task process items and subagent process items from `chatTaskActivity.ts`.
- Produces: context rail that shows subtask progress by default and replaces default context cards with active subagent rows when any subagent is running.

- [ ] **Step 1: Write failing material design test**

Add assertions that `AgentChatPanel.tsx` renders `subagentStatusItems`, uses an accessible label `子代理执行状态`, and conditionally prefers subagent status over default context cards.

Run: `npm test -- src/renderer/materialDesign.test.ts -t "subagent status"`
Expected: FAIL because the UI has no subagent-specific rail.

- [ ] **Step 2: Implement context rail rendering**

Update `AgentChatPanel` to compute subagent status items from process events, pass them to `ContextActivityCard`, and render a compact list with running/done/error visual states. Keep existing cards when no subagent is active.

- [ ] **Step 3: Verify renderer**

Run: `npm test -- src/renderer/chatTaskActivity.test.ts src/renderer/materialDesign.test.ts`
Expected: PASS.

## Task 5: Release Metadata, Documentation, Review, Packaging

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `src/shared/packageScripts.test.ts`
- Modify: `src/shared/readme.test.ts`
- Modify: `.zerox/feature_list.json`
- Modify: `.zerox/progress.md`

**Interfaces:**
- Produces: v3.1.0 release metadata, docs, evidence log, packaged app, pushed branch/tag/release.

- [ ] **Step 1: Write failing metadata/docs tests**

Update package/readme tests to expect version `3.1.0`, feature `P29-v3.1.0-goal-acceptance-subagent-runtime`, and README mentions of Goal acceptance status plus subagent context rail fidelity.

Run: `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts`
Expected: FAIL until metadata/docs are updated.

- [ ] **Step 2: Update metadata/docs**

Bump package metadata to `3.1.0`, update README current-release text, and keep process evidence in `.zerox/progress.md`.

- [ ] **Step 3: Full verification gates**

Run:
- `npm test`
- `npm run verify`
- `npm run harness:check`
- `npm run smoke:prod`
- `git diff --check`

Expected: all PASS.

- [ ] **Step 4: Independent adversarial review subagent**

Dispatch an independent adversarial reviewer against the final diff and verification evidence. Critical or important findings must be fixed and re-reviewed. Acceptance evidence must explicitly say `ACCEPTED`.

- [ ] **Step 5: Package, release, push**

Run:
- `npm run dist:mac`
- `BUILDING_AGENT_SMOKE=1 BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='v3.1.0' "release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent"`

Then create/push the release branch/tag and publish release assets only after all prior gates pass.

## Self-Review

- Spec coverage: user requirements map to Tasks 1-5: actor repair, status rail subtasks, subagent rail replacement, phased execution, adversarial review, package/release/push.
- Placeholder scan: no `TBD`, `TODO`, or deferred implementation placeholders.
- Type consistency: event states and helper names are introduced before renderer usage; actor parent context uses existing `ToolExecutionOptions.runContext`.
