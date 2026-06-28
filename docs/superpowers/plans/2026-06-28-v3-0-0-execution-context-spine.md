# Zerox Agent 3.0.0 Execution Context Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first 3.0.0 runtime spine slice by recording a typed, secret-safe `AgentRuntimeContextSnapshot` for chat, goal milestone, and scheduled-task runs.

**Architecture:** Add a shared snapshot model and a main-process factory that projects existing `AgentRunContext`, `ExecutionContextPackage`, model profile, visible tools, memory scopes, skill metadata, and trajectory identity into a JSON round-trip-safe snapshot. Wire the snapshot into existing `run_context_created` trajectory payloads and chat workspace-run status evidence without changing event ordering contracts, model execution, tool authorization, workspace sandboxing, provider calls, or UI flow.

**Tech Stack:** TypeScript, Vitest, existing `AgentRunContext`, `ExecutionContextPackage`, `AgentTrajectoryStore`, `WorkspaceRunStore`, `runAgentLoop`, `GoalRuntimeEngine`, `AgentRuntimeEngine`.

## Global Constraints

- Preserve local-first trust, explicit permissions, observable trajectories, and reviewed learning.
- Do not add cloud workers or unreviewed self-modification in this iteration.
- Do not bypass `ToolAuthorizationService` or workspace sandbox checks.
- Prefer typed shared models and focused tests before runtime behavior changes.
- Pick exactly one unfinished feature from `.zerox/feature_list.json`; for this iteration add and complete `P28-v3.0.0-execution-context-spine` only.
- Scope is additive snapshot evidence; no authorization behavior, provider request format, new tool capability, actor surface, checkpoint-v2 rebuild, memory automation, or evidence UX redesign.

---

## Team And Handoff Roles

- Product Manager: freeze the first 3.0.0 scope to `AgentRuntimeContextSnapshot`; reject bundling all audit phases into one release.
- System Architect: keep the snapshot factory additive and compatible with `ExecutionContextPackage`, `AgentRunContext`, trajectory, and workspace run ledgers.
- Development Engineer: implement tests first, then the shared model, factory, and three runtime wiring points.
- Front/Back Coordination Engineer: ensure snapshot IDs appear in run/session evidence contracts without requiring new UI controls for this slice.
- Test Engineer: run focused RED/GREEN checks, full release gates, and record command evidence in `.zerox/progress.md`.
- Independent QA Engineer: review the final diff and release package for scope, trust boundaries, and regression risk before packaging.
- Independent User Acceptance: run the packaged app in smoke mode as a real end-to-end local user acceptance proxy; failures return to development.

## Durable Evidence

- Update `.superpowers/sdd/progress.md` after each completed task.
- Update `.zerox/progress.md` with changed files and command evidence.
- Keep review packages under `.superpowers/sdd/`.
- Do not use README as a process log; README is updated only with the final project description and current release.

## Task 1: Shared Runtime Context Snapshot Contract

**Files:**
- Create: `src/shared/agentRuntimeContext.ts`
- Create: `src/shared/agentRuntimeContext.test.ts`
- Modify: `src/shared/agentTrajectory.ts`
- Modify: `src/shared/workspaceRunLedger.ts`

**Interfaces:**
- Produces: `AgentRuntimeContextSnapshot`, `createAgentRuntimeContextSnapshot()`, `summarizeAgentRuntimeContextSnapshot()`, `projectSnapshotToExecutionContextPackage()`.
- Consumes: `AgentRunContext`, `ExecutionContextPackage`, and workspace ledger event types.

- [x] **Step 1: Write failing shared contract tests**

Add tests that create a snapshot with chat surface, model identity, anchored time, workspace roots, permission task IDs, visible tools, skill metadata, memory scopes, and checkpoint metadata. Assert JSON round trip, no `apiKey` string, de-duplicated roots/scopes/tools, deterministic `schemaHash`, and a summary containing `snapshotId`, `runId`, `surface`, `visibleToolCount`, and `workspaceRoot`.

Run: `npm test -- src/shared/agentRuntimeContext.test.ts`
Expected: FAIL because `src/shared/agentRuntimeContext.ts` does not exist.

- [x] **Step 2: Implement the shared model**

Create the shared model with exact surfaces `"chat" | "goal" | "scheduled_task" | "actor" | "workflow"`, permission fields `taskId`, `runtimeTaskId`, and `approvalMode`, and a `tools.schemaHash` derived from stable JSON of visible tool names and sources. Reject or omit secret-bearing model fields by accepting only `providerId`, `modelId`, `profile`, and `capabilities`.

- [x] **Step 3: Keep evidence on existing event contracts**

Do not add a new trajectory event type in this slice. Runtime snapshot evidence is attached as `runtimeContextSnapshot` and `runtimeContextSnapshotSummary` on existing `run_context_created` trajectory events. Chat workspace-run ledger evidence uses an existing `status` event with `payload.runtimeContextSnapshotSummary`.

- [x] **Step 4: Verify shared contract**

Run: `npm test -- src/shared/agentRuntimeContext.test.ts`
Expected: PASS.

## Task 2: Runtime Snapshot Factory

**Files:**
- Create: `src/main/runtimeContextFactory.ts`
- Create: `src/main/runtimeContextFactory.test.ts`
- Modify: `src/main/chatAgentEvidence.ts`

**Interfaces:**
- Consumes: model profile objects from chat/goal/scheduled runtimes, tool definitions, optional `SkillRecord`, `AgentRunContext`, task identifiers, and trajectory identity.
- Produces: `createRuntimeContextSnapshotForRun()` plus helpers to append trajectory/workspace evidence.

- [x] **Step 1: Write failing factory tests**

Add tests for chat, goal, and scheduled inputs. Assert profile model becomes `model.modelId`, API keys are not copied, visible tools include registry source labels when available, schema hash is stable when input order changes, memory scopes include session/workspace/skill/goal when present, and missing `runContext` still produces a JSON-safe snapshot with no workspace block.

Run: `npm test -- src/main/runtimeContextFactory.test.ts`
Expected: FAIL because the factory does not exist.

- [x] **Step 2: Implement the factory**

Implement a pure factory with `now`, `createId`, and `systemTimeZone` injection for deterministic tests. Keep all fields derived from existing runtime inputs; do not read from disk or call model/tool services.

- [x] **Step 3: Extend chat evidence recorder**

Allow `createChatAgentEvidenceRecorder` to accept an optional `runContext` and append event redaction overrides so chat `runtime_context_snapshot` evidence can include `runContext` and `containsUserText: false`.

- [x] **Step 4: Verify factory**

Run: `npm test -- src/main/runtimeContextFactory.test.ts src/main/chatAgentEvidence.test.ts`
Expected: PASS.

## Task 3: Wire Chat, Goal, And Scheduled Runtime Evidence

**Files:**
- Modify: `src/main/chatService.ts`
- Modify: `src/main/goalRuntimeEngine.ts`
- Modify: `src/main/agentRuntimeEngine.ts`
- Modify: `src/main/chatService.test.ts`
- Modify: `src/main/goalRuntimeEngine.test.ts`
- Modify: `src/main/agentRuntimeEngine.test.ts`

**Interfaces:**
- Consumes: factory from Task 2.
- Produces: trajectory/workspace evidence with `snapshotId` for chat agent-loop runs, goal milestone runs, deterministic goal pipeline runs, and recoverable scheduled-task runs.

- [x] **Step 1: Write failing runtime wiring tests**

Add one focused assertion per path:
- `chatService.test.ts`: tool-enabled chat appends `run_context_created` with `runtimeContextSnapshot` before model/tool evidence and workspace run ledger receives the snapshot summary.
- `goalRuntimeEngine.test.ts`: goal milestone `run_context_created` trajectory contains snapshot payload with `surface: "goal"`, `goalId`, and `milestoneId`.
- `agentRuntimeEngine.test.ts`: scheduled task `run_context_created` trajectory contains snapshot payload with `surface: "scheduled_task"` and permission task id.

Run: `npm test -- src/main/chatService.test.ts -t "runtime context snapshot" src/main/goalRuntimeEngine.test.ts -t "runtime context snapshot" src/main/agentRuntimeEngine.test.ts -t "runtime context snapshot"`
Expected: FAIL because runtime wiring is absent.

- [x] **Step 2: Wire chat**

After `profile`, `agentRunContext`, visible tools, selected skill, and `workspaceRunRecorder` are known but before `runAgentLoop()`, create a snapshot and append it as a chat `run_context_created` trajectory event plus a workspace-run status evidence event. Include `snapshotId` only through evidence payloads, not answer text.

- [x] **Step 3: Wire goal**

For both deterministic and model-loop goal paths, create a snapshot after `runContext` and model/tool visibility are known. The deterministic path can mark model profile as `"deterministic"` and capability `"native_pipeline"` without calling the model.

- [x] **Step 4: Wire scheduled runtime**

In `AgentRuntimeEngine.startTask()`, create and append a snapshot after task, skill, `runContext`, initial model profile, and filtered tool definitions are known, before the first model request.

- [x] **Step 5: Verify runtime wiring**

Run the same focused tests from Step 1.
Expected: PASS.

## Task 4: 3.0.0 Release Metadata, README, And Feature Tracking

**Files:**
- Modify: `.zerox/feature_list.json`
- Modify: `.zerox/progress.md`
- Modify: `.superpowers/sdd/progress.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `src/shared/packageScripts.test.ts`
- Modify: `src/shared/readme.test.ts`

**Interfaces:**
- Consumes: completed code evidence from Tasks 1-3.
- Produces: package metadata and documentation describing Zerox Agent 3.0.0 as a local-first runtime context spine release.

- [x] **Step 1: Write failing release tests**

Update package/readme tests to expect version `3.0.0`, feature `P28-v3.0.0-execution-context-spine`, and README mentions of `AgentRuntimeContextSnapshot`.

Run: `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts`
Expected: FAIL until metadata and README are updated.

- [x] **Step 2: Update metadata and docs**

Bump package metadata to `3.0.0`, keep `P28-v3.0.0-execution-context-spine` open until Task 5 release acceptance completes, and update README current release/project description without turning README into a process log.

- [x] **Step 3: Verify docs and metadata**

Run: `npm test -- src/shared/packageScripts.test.ts src/shared/readme.test.ts`
Expected: PASS.

## Task 5: Independent Review, Full Gates, Packaging, Acceptance, Release

**Files:**
- Modify only evidence files if review or packaging evidence needs recording.

**Interfaces:**
- Consumes: final diff and packaged app.
- Produces: review acceptance, packaged test evidence, git tag/release.

- [ ] **Step 1: Independent code review**

Dispatch an independent reviewer with the final diff package. Critical/Important findings must be fixed and re-reviewed before packaging.

- [ ] **Step 2: Full verification gates**

Run:
- `npm test`
- `npm run verify`
- `npm run harness:check`
- `npm run smoke:prod`
- `git diff --check`

Expected: all PASS.

- [ ] **Step 3: Package and test package**

Run:
- `npm run dist:mac`
- `BUILDING_AGENT_SMOKE=1 BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='v3.0.0' "release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent"`

Expected: all PASS.

- [ ] **Step 4: Independent user acceptance**

Use the available computer-use/desktop acceptance path or packaged smoke proxy to execute a real local task flow with temporary user data. Any execution, interaction, or experience issue returns to development.

- [ ] **Step 5: Push and publish release**

Create tag `v3.0.0`, push branch/tag, and publish GitHub Release `v3.0.0` with macOS DMG/ZIP/blockmap/latest artifacts.
