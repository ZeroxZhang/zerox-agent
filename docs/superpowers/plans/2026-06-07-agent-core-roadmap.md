# Agent Core Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Zerox Agent from a local-first desktop agent prototype into a recoverable, measurable, self-improving local agent platform with a sharper product position.

**Architecture:** Build four independent but ordered workstreams: product positioning, recoverable runtime, trajectory/eval infrastructure, and learning loop. Runtime creates reliable execution state; trajectory/eval measures it; learning uses completed trajectories and eval failures to produce reviewed memories, procedures, and skill improvements.

**Tech Stack:** Electron main process, React renderer, TypeScript, Vitest, JSON/JSONL local stores under Electron `userData/config`, OpenAI-compatible chat and embedding clients, existing skill/MCP/tool permission system.

---

## Executive Priority

Recommended execution order:

1. **Positioning Contract:** Decide and encode the product boundary: Zerox is a local-first desktop agent control plane, not a general chat app and not only a coding CLI.
2. **Recoverable Runtime:** Replace one-shot run execution with checkpointed state so tasks can pause, resume, inspect, and recover after app restart.
3. **Trajectory And Eval:** Record every meaningful agent decision and create a repeatable quality harness before adding self-improvement.
4. **Learning Loop:** Convert run outcomes into reviewed procedural memories and skill improvement proposals.

This order matters because learning without recoverable trajectories produces noisy memories, and eval without a clear product boundary measures the wrong thing.

## Program Milestones

### Milestone 0: Product Positioning Contract

**Outcome:** Everyone building the project can answer what Zerox is, what it is not, and which user jobs define success.

**Definition of done:**

- README and onboarding describe the same product boundary.
- New capabilities are evaluated against a written product decision matrix.
- The first-run guide pushes users toward real desktop tasks, not generic chat.

**Target duration:** 1 day.

### Milestone 1: Recoverable Runtime

**Outcome:** Agent runs are stateful executions with checkpoints, resumable steps, artifacts, and clear failure reasons.

**Definition of done:**

- A run can be interrupted after a tool call and resumed from the latest checkpoint.
- App restart does not lose an in-progress run's plan, messages, tool observations, artifacts, or failure context.
- Runs expose structured statuses: `queued`, `running`, `waiting_for_approval`, `paused`, `succeeded`, `failed`, `canceled`.
- Existing scheduled tasks and chat-driven task execution continue to work.

**Target duration:** 5 to 7 engineering days.

### Milestone 2: Trajectory And Eval

**Outcome:** Every run can be replayed and scored against a small local benchmark suite.

**Definition of done:**

- Every agent run writes a trajectory containing prompts, model responses, tool calls, tool observations, state transitions, and final artifacts.
- A CLI script runs a local eval suite and outputs pass rate, tool success rate, recoverability score, and regression diffs.
- CI or `npm run verify` can run a fast deterministic subset without real model calls.

**Target duration:** 4 to 6 engineering days.

### Milestone 3: Learning Loop

**Outcome:** Zerox can turn successful and failed runs into reviewed long-term memory and skill improvement proposals.

**Definition of done:**

- Successful runs generate candidate procedural memories.
- Failed runs generate failure lessons with evidence from trajectory data.
- Skill improvement proposals are reviewable before being written.
- The next relevant run retrieves procedural memory and changes its plan or tool use.

**Target duration:** 6 to 9 engineering days.

---

## File Structure Plan

### Shared Types

- Modify: `src/shared/agentRuns.ts`
  - Expand run statuses, step states, artifact references, checkpoint references, and failure classifications.
- Create: `src/shared/agentExecution.ts`
  - Defines durable runtime state: execution graph, checkpoints, resumable turns, state transitions.
- Create: `src/shared/agentTrajectory.ts`
  - Defines trajectory events, replay records, score records, and redaction fields.
- Create: `src/shared/agentLearning.ts`
  - Defines learning candidates, procedural memory drafts, failure lessons, and skill improvement proposals.
- Modify: `src/shared/memory.ts`
  - Add fields needed to trace procedural memories back to runs and eval failures.
- Modify: `src/shared/navigation.ts`
  - Add entries only after UI panels exist; keep initial runtime work headless.

### Main Process Runtime

- Create: `src/main/agentExecutionStore.ts`
  - Persists mutable execution checkpoints under `userData/config/agent-executions/`.
- Create: `src/main/agentRuntimeEngine.ts`
  - Owns state machine transitions, turn execution, tool call handling, checkpoint creation, and resume.
- Create: `src/main/agentFailureClassifier.ts`
  - Converts model, tool, permission, parsing, timeout, cancellation, and user approval failures into structured categories.
- Modify: `src/main/agentRunnerService.ts`
  - Delegate execution to `agentRuntimeEngine`; preserve public `runTask` and `runTaskStreaming` API.
- Modify: `src/main/agentLoop.ts`
  - Either remove after migration or keep only as a thin chat-run adapter.
- Modify: `src/main/main.ts`
  - Wire execution store, resume APIs, cancel APIs, and IPC handlers.
- Modify: `src/main/toolAuthorizationService.ts`
  - Surface `waiting_for_approval` state when a blocked tool call asks the user.

### Main Process Trajectory And Eval

- Create: `src/main/agentTrajectoryStore.ts`
  - Persists append-only trajectories under `userData/config/agent-trajectories/`.
- Create: `src/main/eval/agentEvalFixtures.ts`
  - Defines deterministic local tasks using fake chat clients and fake tool executors.
- Create: `src/main/eval/agentEvalRunner.ts`
  - Runs fixtures and scores trajectories.
- Create: `scripts/run-agent-evals.mjs`
  - CLI entrypoint for local eval runs.
- Modify: `package.json`
  - Add `eval:agent` script and include the fast eval subset in `verify` only after deterministic fixtures are stable.

### Main Process Learning

- Create: `src/main/agentLearningExtractor.ts`
  - Extracts memory candidates and skill improvement proposals from trajectories.
- Create: `src/main/agentLearningStore.ts`
  - Persists reviewable learning candidates under `userData/config/agent-learning-candidates.json`.
- Create: `src/main/agentLearningService.ts`
  - Coordinates extraction, review decisions, memory writes, and skill proposal writes.
- Modify: `src/main/memoryStore.ts`
  - Support richer procedural memory search filters and provenance.
- Modify: `src/main/chatService.ts`
  - Inject relevant procedural memories into chat and task planning.
- Modify: `src/main/agentRunnerService.ts`
  - Inject procedural memories into planning prompts after runtime migration.

### Renderer

- Modify: `src/renderer/components/RunsPanel.tsx`
  - Show execution graph, checkpoints, artifacts, failure classification, and resume controls.
- Create: `src/renderer/components/RunTrajectoryPanel.tsx`
  - Inspect trajectory events, model turns, tool calls, and redacted prompt context.
- Create: `src/renderer/components/LearningReviewPanel.tsx`
  - Review, accept, reject, and inspect learning candidates.
- Modify: `src/renderer/components/OverviewPanel.tsx`
  - Add quality signals: latest eval pass rate, failed run classes, learning candidates waiting for review.
- Modify: `src/renderer/App.tsx`
  - Wire new panels after the corresponding main-process APIs exist.

### Documentation

- Create: `docs/product/zerox-positioning.md`
  - Product boundary, target user, non-goals, decision matrix.
- Create: `docs/architecture/agent-runtime.md`
  - Runtime state machine, checkpoint format, resume guarantees.
- Create: `docs/architecture/agent-learning-loop.md`
  - How trajectories become memory and skill proposals.
- Modify: `README.md`
  - Align overview, roadmap, and architecture with the positioning contract.

---

## Workstream A: Product Positioning Contract

### Task A1: Write The Product Boundary

**Files:**

- Create: `docs/product/zerox-positioning.md`
- Modify: `README.md`
- Modify: `src/shared/firstRunGuide.ts`

- [ ] **Step 1: Define target user and wedge**

Write `docs/product/zerox-positioning.md` with these decisions:

```markdown
# Zerox Agent Product Positioning

## One-line Position

Zerox Agent is a local-first desktop control plane for personal AI agents that need safe access to local files, tools, memory, scheduled work, and user-reviewed learning.

## Primary User

Independent builders and power users on macOS who want an agent that can work on local tasks without sending local state to a hosted agent platform.

## Primary Job

Turn recurring or messy local workflows into observable, permissioned, resumable agent runs.

## Non-goals

- Zerox is not a generic chat companion.
- Zerox is not a cloud agent hosting service.
- Zerox is not primarily a coding CLI.
- Zerox does not execute unreviewed self-modifications.

## Product Bet

The durable advantage is trust: local data, explicit permissions, observable trajectories, and user-reviewed learning.

## Decision Matrix

| Proposal | Accept When | Reject When |
| --- | --- | --- |
| New tool integration | It improves real local workflows and can be permissioned, audited, and replayed. | It requires broad opaque access or cannot explain risk to the user. |
| New UI panel | It helps inspect, resume, evaluate, or review agent work. | It only markets capability without improving control or trust. |
| New memory behavior | It changes future behavior in a traceable and reversible way. | It silently rewrites user preference or skill behavior. |
| New automation | It has clear schedule, permissions, failure reporting, and cancel path. | It runs indefinitely without inspection or recovery. |
```

- [ ] **Step 2: Update README language**

Revise README sections that describe Zerox as "general-purpose" so they also mention the narrower wedge: local-first desktop control plane, permissioned tools, recoverable runs, and reviewed learning.

- [ ] **Step 3: Align first-run guide**

Update `src/shared/firstRunGuide.ts` so onboarding asks the user to configure a model, choose a local workflow, review permissions, and run a resumable demo task.

- [ ] **Step 4: Test product copy**

Run:

```bash
npm test -- src/shared/firstRunGuide.test.ts src/shared/readme.test.ts
```

Expected: tests pass or fail only on assertions intentionally updated for the new positioning.

- [ ] **Step 5: Commit**

```bash
git add docs/product/zerox-positioning.md README.md src/shared/firstRunGuide.ts src/shared/firstRunGuide.test.ts src/shared/readme.test.ts
git commit -m "docs: define Zerox product positioning"
```

---

## Workstream B: Recoverable Runtime

### Task B1: Add Durable Execution Types

**Files:**

- Create: `src/shared/agentExecution.ts`
- Modify: `src/shared/agentRuns.ts`
- Test: `src/shared/agentExecution.test.ts`

- [ ] **Step 1: Write type-level tests for valid transitions**

Create tests for these transitions:

- `queued -> running`
- `running -> waiting_for_approval`
- `waiting_for_approval -> running`
- `running -> paused`
- `paused -> running`
- `running -> succeeded`
- `running -> failed`
- `running -> canceled`

Invalid transition example: `succeeded -> running` must be rejected.

- [ ] **Step 2: Add shared execution model**

Create these types in `src/shared/agentExecution.ts`:

```ts
export type AgentExecutionStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "paused"
  | "succeeded"
  | "failed"
  | "canceled";

export type AgentFailureClass =
  | "model_error"
  | "tool_error"
  | "permission_denied"
  | "invalid_model_output"
  | "timeout"
  | "canceled"
  | "unknown";

export type AgentExecutionStepState =
  | "pending"
  | "running"
  | "waiting_for_tool"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "skipped";

export type AgentExecutionStep = {
  id: string;
  description: string;
  expectedTool?: string;
  expectedOutcome: string;
  state: AgentExecutionStepState;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  failureClass?: AgentFailureClass;
  failureMessage?: string;
};

export type AgentExecutionCheckpoint = {
  id: string;
  runId: string;
  taskId: string;
  status: AgentExecutionStatus;
  currentStepId?: string;
  steps: AgentExecutionStep[];
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    tool_call_id?: string;
    tool_calls?: unknown[];
  }>;
  toolCallCount: number;
  createdAt: string;
  updatedAt: string;
};
```

- [ ] **Step 3: Add transition helper**

Implement `canTransitionExecutionStatus(from, to)` and `assertExecutionTransition(from, to)`.

- [ ] **Step 4: Run tests**

```bash
npm test -- src/shared/agentExecution.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/agentExecution.ts src/shared/agentExecution.test.ts src/shared/agentRuns.ts
git commit -m "feat: add durable agent execution model"
```

### Task B2: Add Checkpoint Store

**Files:**

- Create: `src/main/agentExecutionStore.ts`
- Test: `src/main/agentExecutionStore.test.ts`

- [ ] **Step 1: Write persistence tests**

Cover:

- Create checkpoint file under `agent-executions/{runId}.json`.
- Update existing checkpoint.
- List active checkpoints excluding terminal statuses.
- Delete checkpoint after final run archival.
- Tolerate missing directory by returning empty list.

- [ ] **Step 2: Implement store**

Expose:

```ts
export type AgentExecutionStore = {
  save(checkpoint: AgentExecutionCheckpoint): Promise<AgentExecutionCheckpoint>;
  get(runId: string): Promise<AgentExecutionCheckpoint | null>;
  listActive(): Promise<AgentExecutionCheckpoint[]>;
  delete(runId: string): Promise<boolean>;
};
```

- [ ] **Step 3: Run tests**

```bash
npm test -- src/main/agentExecutionStore.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/agentExecutionStore.ts src/main/agentExecutionStore.test.ts
git commit -m "feat: persist agent execution checkpoints"
```

### Task B3: Extract Runtime Engine

**Files:**

- Create: `src/main/agentRuntimeEngine.ts`
- Create: `src/main/agentFailureClassifier.ts`
- Modify: `src/main/agentRunnerService.ts`
- Test: `src/main/agentRuntimeEngine.test.ts`
- Test: `src/main/agentRunnerService.test.ts`

- [ ] **Step 1: Write runtime tests with fake model and fake tools**

Cover:

- Successful two-step plan writes checkpoints after planning, after tool result, and after final summary.
- Tool permission denial moves run to `waiting_for_approval` when approval is available.
- Canceled signal writes terminal checkpoint with status `canceled`.
- Invalid model JSON maps to `invalid_model_output`.
- Resume starts from latest checkpoint and does not repeat completed tool calls.

- [ ] **Step 2: Implement failure classifier**

Map current string errors into `AgentFailureClass`:

```ts
export function classifyAgentFailure(error: unknown): AgentFailureClass {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/permission|未授权|拒绝授权/i.test(message)) return "permission_denied";
  if (/json|parse|解析/i.test(message)) return "invalid_model_output";
  if (/timeout|timed out/i.test(message)) return "timeout";
  if (/abort|cancel|取消/i.test(message)) return "canceled";
  if (/tool|工具/i.test(message)) return "tool_error";
  if (/model|llm|api/i.test(message)) return "model_error";
  return "unknown";
}
```

- [ ] **Step 3: Implement runtime engine API**

Expose:

```ts
export type AgentRuntimeEngine = {
  startTask(taskId: string, options?: { signal?: AbortSignal }): Promise<RunScheduledTaskResult>;
  resumeRun(runId: string, options?: { signal?: AbortSignal }): Promise<RunScheduledTaskResult>;
};
```

- [ ] **Step 4: Keep AgentRunnerService stable**

Update `createAgentRunnerService` to instantiate and delegate to the runtime engine without changing existing IPC callers.

- [ ] **Step 5: Run focused tests**

```bash
npm test -- src/main/agentRuntimeEngine.test.ts src/main/agentRunnerService.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/agentRuntimeEngine.ts src/main/agentFailureClassifier.ts src/main/agentRuntimeEngine.test.ts src/main/agentRunnerService.ts src/main/agentRunnerService.test.ts
git commit -m "feat: add recoverable agent runtime engine"
```

### Task B4: Add Resume UI And IPC

**Files:**

- Modify: `src/main/main.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/global.d.ts`
- Modify: `src/renderer/components/RunsPanel.tsx`
- Test: `src/main/desktopAgentValidator.test.ts`
- Test: `src/renderer/agentWorkStatus.test.ts`

- [ ] **Step 1: Add IPC handlers**

Add handlers:

- `agentRuns:listActiveExecutions`
- `agentRuns:resume`
- `agentRuns:pause`
- `agentRuns:cancel`

- [ ] **Step 2: Expose preload API**

Expose strongly typed methods under the existing desktop bridge.

- [ ] **Step 3: Update Runs panel**

Show active runs with:

- Current status.
- Current step.
- Last checkpoint time.
- Failure class when failed.
- Resume and cancel actions when valid.

- [ ] **Step 4: Run UI and main tests**

```bash
npm test -- src/main/desktopAgentValidator.test.ts src/renderer/agentWorkStatus.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/main.ts src/preload/index.ts src/renderer/global.d.ts src/renderer/components/RunsPanel.tsx src/main/desktopAgentValidator.test.ts src/renderer/agentWorkStatus.test.ts
git commit -m "feat: expose resumable agent runs"
```

---

## Workstream C: Trajectory And Eval

### Task C1: Add Trajectory Model And Store

**Files:**

- Create: `src/shared/agentTrajectory.ts`
- Create: `src/main/agentTrajectoryStore.ts`
- Test: `src/main/agentTrajectoryStore.test.ts`

- [ ] **Step 1: Define trajectory events**

Events must include:

- `state_transition`
- `model_request`
- `model_response`
- `tool_call`
- `tool_result`
- `checkpoint_written`
- `artifact_created`
- `failure_classified`
- `final_summary`

- [ ] **Step 2: Add redaction fields**

Each event supports:

```ts
redaction: {
  containsApiKey: false;
  containsFileContent: boolean;
  containsUserText: boolean;
}
```

The initial implementation stores local-only data. Redaction fields exist so export features can be added without changing the data model.

- [ ] **Step 3: Implement append-only store**

Store one JSONL file per run under `userData/config/agent-trajectories/{runId}.jsonl`.

- [ ] **Step 4: Run store tests**

```bash
npm test -- src/main/agentTrajectoryStore.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/agentTrajectory.ts src/main/agentTrajectoryStore.ts src/main/agentTrajectoryStore.test.ts
git commit -m "feat: persist agent run trajectories"
```

### Task C2: Emit Trajectory From Runtime

**Files:**

- Modify: `src/main/agentRuntimeEngine.ts`
- Modify: `src/main/agentRunnerService.ts`
- Test: `src/main/agentRuntimeEngine.test.ts`

- [ ] **Step 1: Add trajectory writer dependency**

Runtime engine receives optional `trajectoryStore`. Tests use a fake store to assert event order.

- [ ] **Step 2: Emit events at every boundary**

Emit before and after:

- Planning call.
- Step execution.
- Tool authorization.
- Tool execution.
- Reflection call.
- Checkpoint save.
- Final summary creation.

- [ ] **Step 3: Verify no silent tool calls**

Add test asserting every executed tool call has exactly one matching `tool_call` and one matching `tool_result`.

- [ ] **Step 4: Run tests**

```bash
npm test -- src/main/agentRuntimeEngine.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agentRuntimeEngine.ts src/main/agentRunnerService.ts src/main/agentRuntimeEngine.test.ts
git commit -m "feat: record runtime trajectory events"
```

### Task C3: Add Deterministic Eval Harness

**Files:**

- Create: `src/main/eval/agentEvalFixtures.ts`
- Create: `src/main/eval/agentEvalRunner.ts`
- Create: `src/main/eval/agentEvalRunner.test.ts`
- Create: `scripts/run-agent-evals.mjs`
- Modify: `package.json`

- [ ] **Step 1: Define first five eval fixtures**

Fixtures:

1. `file-report-happy-path`: model lists directory, reads one file, writes report.
2. `permission-denied-recovery`: model attempts blocked path, then asks for allowed path.
3. `invalid-plan-json`: model returns bad planning JSON, runtime falls back safely.
4. `tool-error-reflection`: tool fails once, reflection retries with corrected args.
5. `resume-after-tool-call`: run stops after tool result and resumes without duplicate execution.

- [ ] **Step 2: Implement score output**

Return:

```ts
export type AgentEvalReport = {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  toolSuccessRate: number;
  recoverabilityRate: number;
  failures: Array<{ fixtureId: string; reason: string }>;
};
```

- [ ] **Step 3: Add CLI script**

`npm run eval:agent` runs the deterministic suite and prints JSON.

- [ ] **Step 4: Run eval tests**

```bash
npm test -- src/main/eval/agentEvalRunner.test.ts
npm run eval:agent
```

Expected: tests pass, CLI prints a report with `total: 5`.

- [ ] **Step 5: Commit**

```bash
git add src/main/eval/agentEvalFixtures.ts src/main/eval/agentEvalRunner.ts src/main/eval/agentEvalRunner.test.ts scripts/run-agent-evals.mjs package.json
git commit -m "feat: add deterministic agent eval harness"
```

---

## Workstream D: Learning Loop

### Task D1: Add Learning Candidate Types And Store

**Files:**

- Create: `src/shared/agentLearning.ts`
- Create: `src/main/agentLearningStore.ts`
- Test: `src/main/agentLearningStore.test.ts`

- [ ] **Step 1: Define candidate model**

Candidate types:

- `procedural_memory`
- `failure_lesson`
- `skill_improvement`

Candidate statuses:

- `pending_review`
- `accepted`
- `rejected`
- `applied`

- [ ] **Step 2: Require evidence**

Every candidate includes:

- `sourceRunId`
- `sourceTrajectoryEventIds`
- `claim`
- `recommendedAction`
- `risk`
- `createdAt`

- [ ] **Step 3: Implement store**

Persist candidates in `userData/config/agent-learning-candidates.json`.

- [ ] **Step 4: Run store tests**

```bash
npm test -- src/main/agentLearningStore.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/agentLearning.ts src/main/agentLearningStore.ts src/main/agentLearningStore.test.ts
git commit -m "feat: store reviewed learning candidates"
```

### Task D2: Extract Lessons From Trajectories

**Files:**

- Create: `src/main/agentLearningExtractor.ts`
- Test: `src/main/agentLearningExtractor.test.ts`

- [ ] **Step 1: Add extraction rules**

Rules:

- Successful run with repeated tool sequence creates a procedural memory candidate.
- Failed run with `permission_denied` creates a failure lesson candidate.
- Reflection retry that succeeds creates a procedural memory candidate with before/after evidence.
- Invalid model output creates a skill improvement candidate for stronger output constraints.

- [ ] **Step 2: Keep extraction deterministic first**

Use rule-based extraction before LLM extraction. Add LLM extraction only after eval data shows rule-based candidates are too sparse.

- [ ] **Step 3: Run tests**

```bash
npm test -- src/main/agentLearningExtractor.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/agentLearningExtractor.ts src/main/agentLearningExtractor.test.ts
git commit -m "feat: extract learning candidates from trajectories"
```

### Task D3: Apply Accepted Procedural Memories

**Files:**

- Create: `src/main/agentLearningService.ts`
- Modify: `src/main/memoryStore.ts`
- Modify: `src/main/chatService.ts`
- Modify: `src/main/agentRunnerService.ts`
- Test: `src/main/agentLearningService.test.ts`
- Test: `src/main/chatService.test.ts`

- [ ] **Step 1: Apply accepted candidates to memory**

Accepted `procedural_memory` candidates write `kind: "procedural"` memory with:

- Tags from source skill and tool names.
- Source `{ type: "agent_run", refId: sourceRunId }`.
- Importance based on success frequency and failure prevention value.

- [ ] **Step 2: Inject procedural memory into planning**

When planning a task, search procedural memories with task name, skill name, and available tools. Inject top 3 as a separate system or user context block:

```text
Relevant procedural memories:
- When organizing a local directory, list files before reading individual files.
- If a file path is denied, ask for approval or choose a path inside the allowed directory.
```

- [ ] **Step 3: Prove behavior changes**

Add test where a procedural memory causes the fake model prompt to include the prior lesson before the model call.

- [ ] **Step 4: Run tests**

```bash
npm test -- src/main/agentLearningService.test.ts src/main/chatService.test.ts src/main/agentRunnerService.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/agentLearningService.ts src/main/memoryStore.ts src/main/chatService.ts src/main/agentRunnerService.ts src/main/agentLearningService.test.ts src/main/chatService.test.ts src/main/agentRunnerService.test.ts
git commit -m "feat: apply reviewed procedural learning"
```

### Task D4: Add Learning Review UI

**Files:**

- Modify: `src/main/main.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/global.d.ts`
- Create: `src/renderer/components/LearningReviewPanel.tsx`
- Modify: `src/renderer/components/OverviewPanel.tsx`
- Test: `src/renderer/agentWorkStatus.test.ts`

- [ ] **Step 1: Add IPC methods**

Expose:

- `learning:listCandidates`
- `learning:acceptCandidate`
- `learning:rejectCandidate`
- `learning:applyAccepted`

- [ ] **Step 2: Add review panel**

Panel shows:

- Candidate claim.
- Evidence run ID.
- Evidence event IDs.
- Risk.
- Recommended action.
- Accept and reject controls.

- [ ] **Step 3: Add overview signal**

Overview displays number of pending candidates and latest applied learning.

- [ ] **Step 4: Run tests**

```bash
npm test -- src/renderer/agentWorkStatus.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/main.ts src/preload/index.ts src/renderer/global.d.ts src/renderer/components/LearningReviewPanel.tsx src/renderer/components/OverviewPanel.tsx src/renderer/agentWorkStatus.test.ts
git commit -m "feat: review agent learning candidates"
```

---

## Cross-cutting Acceptance Metrics

Track these metrics after Milestone 2:

| Metric | First Target | Why It Matters |
| --- | ---: | --- |
| Deterministic eval pass rate | 80% | Prevents runtime regressions. |
| Tool call trace completeness | 100% | No tool action should be invisible. |
| Resume duplication rate | 0% | Resume must not repeat completed side effects. |
| Permission denial classification | 100% | Safety failures must be explainable. |
| Accepted learning usefulness | 60% accepted after review | Extractor should produce useful candidates, not noise. |
| Procedural memory retrieval hit rate | 70% on matching tasks | Learning must affect future planning. |

## First Golden Slice

The first end-to-end demo after implementing Workstreams A, B, and C:

1. User creates a local file organization task.
2. Agent starts, plans, lists a directory, and writes checkpoint.
3. App is restarted or run is paused.
4. User resumes the run.
5. Agent continues without repeating completed tool calls.
6. Final report is written.
7. Trajectory replay shows every model turn and tool call.
8. Eval harness scores the run as recoverable.

This golden slice proves Zerox is no longer a chat wrapper with tools; it is a local agent runtime.

## Risk Controls

- **Risk: Runtime rewrite breaks existing tasks.** Keep `AgentRunnerService` public API stable until all IPC and renderer tests pass.
- **Risk: Learning writes bad behavior.** Require review before applying candidates; never auto-modify skills in the first version.
- **Risk: Trajectory logs leak sensitive content on export.** Store local-only first and add redaction metadata before any export feature.
- **Risk: Eval suite becomes too slow.** Keep deterministic fake-client evals separate from real-model smoke tests.
- **Risk: Product scope expands again.** Use `docs/product/zerox-positioning.md` decision matrix before accepting new surface area.

## Recommended Execution Mode

Use subagent-driven development by workstream:

1. One subagent implements Workstream A.
2. One subagent implements Tasks B1 and B2.
3. One subagent implements Tasks B3 and B4 after B1/B2 land.
4. One subagent implements Workstream C after the runtime engine has trajectory hooks.
5. One subagent implements Workstream D after deterministic eval data exists.

Each task should land with focused tests and a commit. Do not merge Workstream D before Workstream C can show whether a learning candidate improved or degraded behavior.

## Plan Self-review

- **Spec coverage:** Covers the user's selected priorities: recoverable runtime, learning loop, eval/trajectory, and product positioning.
- **Scope control:** Splits the program into four independently testable workstreams.
- **Type consistency:** Runtime status, trajectory event, and learning candidate names are consistent across tasks.
- **Testing coverage:** Every workstream includes focused tests and expected commands.
- **Known intentional omission:** Full cloud sync, mobile control surface, and marketplace features are excluded because they do not serve the four selected high-priority gaps.
