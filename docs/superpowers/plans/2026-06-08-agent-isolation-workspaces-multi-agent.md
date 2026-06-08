# Agent Isolation Workspaces Multi-Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add workspace-scoped run isolation, git worktree workspace management, and parent/child multi-agent session metadata on top of the existing recoverable runtime.

**Architecture:** Introduce shared run-context types first, then persist workspaces and multi-agent sessions in focused main-process stores. The runtime resolves an `AgentRunContext` before model calls, passes it through checkpoint/run/trajectory records, and gives it to authorization and tool execution so the sandbox narrows existing task permissions. UI and evals consume the same stored metadata rather than inventing a second state model.

**Tech Stack:** Electron main process, React renderer, TypeScript, Vitest, JSON local stores under Electron `userData/config`, existing agent runtime/checkpoint/trajectory/eval infrastructure.

---

## File Structure

- Create: `src/shared/agentWorkspace.ts`
  - Shared workspace, sandbox, run-context, and multi-agent session types plus helper functions.
- Modify: `src/shared/agentWorkspace.test.ts`
  - Unit tests for sandbox defaults, run-context creation, path-boundary checks, and child context inheritance.
- Modify: `src/shared/agentExecution.ts`
  - Add optional `runContext` to checkpoints.
- Modify: `src/shared/agentRuns.ts`
  - Add optional `runContext` and `childRunIds` to run records.
- Modify: `src/shared/agentTrajectory.ts`
  - Add `run_context_created`, `workspace_escape_denied`, and `child_run_scheduled` event types plus optional `runContext`.
- Create: `src/main/agentWorkspaceStore.ts`
  - JSON store for durable workspace records.
- Create: `src/main/agentWorkspaceStore.test.ts`
  - Store persistence tests.
- Create: `src/main/agentWorkspaceService.ts`
  - Resolves default, temporary, project, and git worktree workspaces into `AgentRunContext`.
- Create: `src/main/agentWorkspaceService.test.ts`
  - Context resolver and git worktree command tests.
- Create: `src/main/multiAgentSessionStore.ts`
  - JSON store for parent/child multi-agent session records.
- Create: `src/main/multiAgentSessionStore.test.ts`
  - Session persistence and child run ordering tests.
- Create: `src/main/multiAgentCoordinator.ts`
  - Small coordinator that records child-run intent and derives child contexts without creating a second runtime.
- Create: `src/main/multiAgentCoordinator.test.ts`
  - Child context inheritance and depth-limit tests.
- Modify: `src/shared/toolPermissions.ts`
  - Add sandbox-aware authorization helper.
- Modify: `src/main/toolAuthorizationService.ts`
  - Accept optional run context and deny workspace escapes before one-time approval.
- Modify: `src/main/toolAuthorizationService.test.ts`
  - Sandbox narrowing tests.
- Modify: `src/main/agentToolExecutor.ts`
  - Accept optional execution context and run shell commands with workspace `cwd`.
- Modify: `src/main/agentToolExecutor.test.ts`
  - Shell cwd and workspace path behavior tests.
- Modify: `src/main/agentRuntimeEngine.ts`
  - Resolve run context, persist it in checkpoints/runs/trajectory, and pass it to authorization/tool execution.
- Modify: `src/main/agentRuntimeEngine.test.ts`
  - Runtime context, trajectory event, escape denial, and child lineage tests.
- Modify: `src/main/agentRunnerService.ts`
  - Thread workspace dependencies into the runtime engine.
- Modify: `src/main/main.ts`
  - Wire stores/services and IPC handlers.
- Modify: `src/preload/index.ts`
  - Expose workspace/session APIs to renderer.
- Modify: `src/renderer/global.d.ts`
  - Pick up preload API type changes.
- Modify: `src/renderer/components/RunsPanel.tsx`
  - Display workspace, sandbox, role, parent, and child run context.
- Modify: `src/renderer/demoAgentData.ts`
  - Add demo run contexts and child run metadata.
- Modify: `src/renderer/demoAgentData.test.ts`
  - Assert demo run context presence.
- Modify: `src/main/eval/agentEvalFixtures.ts`
  - Add workspace escape and multi-agent lineage fixtures.
- Modify: `src/main/eval/agentEvalRunner.test.ts`
  - Assert fixture count and required events.
- Modify: `docs/architecture/agent-runtime.md`
  - Document run-context flow.
- Create: `docs/architecture/agent-workspaces.md`
  - Document workspace registry, sandbox policy, and multi-agent layering.
- Modify: `README.md`
  - Mention workspace-scoped runs and parent/child sessions.

## Task 1: Shared Workspace And Run Context Model

**Files:**
- Create: `src/shared/agentWorkspace.ts`
- Create: `src/shared/agentWorkspace.test.ts`
- Modify: `src/shared/agentExecution.ts`
- Modify: `src/shared/agentRuns.ts`
- Modify: `src/shared/agentTrajectory.ts`

- [ ] **Step 1: Write the failing tests**

Create tests that expect:

```ts
import { describe, expect, it } from "vitest";
import {
  buildDefaultSandboxPolicy,
  buildPrimaryRunContext,
  buildChildRunContext,
  isPathInsideRunContext,
} from "./agentWorkspace";

describe("agent workspace model", () => {
  it("builds a default workspace-write sandbox without workspace escape", () => {
    expect(buildDefaultSandboxPolicy()).toEqual({
      mode: "workspace_write",
      network: "task_policy",
      shell: "approved_commands",
      allowWorkspaceEscape: false,
      extraReadRoots: [],
      extraWriteRoots: [],
    });
  });

  it("creates a primary run context with depth zero", () => {
    const context = buildPrimaryRunContext({
      workspaceId: "workspace_default",
      workspaceRoot: "/tmp/zerox/workspace",
    });

    expect(context).toMatchObject({
      workspaceId: "workspace_default",
      workspaceRoot: "/tmp/zerox/workspace",
      agentRole: "primary",
      depth: 0,
    });
  });

  it("creates a narrowed child run context", () => {
    const parent = buildPrimaryRunContext({
      workspaceId: "workspace_default",
      workspaceRoot: "/tmp/zerox/workspace",
      sessionId: "session_1",
    });

    expect(
      buildChildRunContext(parent, {
        parentRunId: "run_parent",
        agentRole: "executor",
      }),
    ).toMatchObject({
      workspaceId: "workspace_default",
      workspaceRoot: "/tmp/zerox/workspace",
      sessionId: "session_1",
      parentRunId: "run_parent",
      agentRole: "executor",
      depth: 1,
    });
  });

  it("checks workspace path boundaries without prefix confusion", () => {
    const context = buildPrimaryRunContext({
      workspaceId: "workspace_default",
      workspaceRoot: "/tmp/work",
    });

    expect(isPathInsideRunContext("/tmp/work/report.md", context, "write")).toBe(true);
    expect(isPathInsideRunContext("/tmp/workspace/report.md", context, "write")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/shared/agentWorkspace.test.ts
```

Expected: FAIL because `src/shared/agentWorkspace.ts` does not exist.

- [ ] **Step 3: Implement the shared model**

Create `src/shared/agentWorkspace.ts` with exported `AgentWorkspace`, `AgentSandboxPolicy`, `AgentRunContext`, `MultiAgentSession`, helper builders, and path-boundary helper.

Update:

```ts
// src/shared/agentExecution.ts
import type { AgentRunContext } from "./agentWorkspace";

export type AgentExecutionCheckpoint = {
  // existing fields
  runContext?: AgentRunContext;
};

// src/shared/agentRuns.ts
import type { AgentRunContext } from "./agentWorkspace";

export type AgentRunRecord = {
  // existing fields
  runContext?: AgentRunContext;
  childRunIds?: string[];
};

// src/shared/agentTrajectory.ts
import type { AgentRunContext } from "./agentWorkspace";

export type AgentTrajectoryEventType =
  | "run_context_created"
  | "workspace_escape_denied"
  | "child_run_scheduled"
  // existing event types

export type AgentTrajectoryEvent = {
  // existing fields
  runContext?: AgentRunContext;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- src/shared/agentWorkspace.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/agentWorkspace.ts src/shared/agentWorkspace.test.ts src/shared/agentExecution.ts src/shared/agentRuns.ts src/shared/agentTrajectory.ts
git commit -m "feat: add agent workspace run context model"
```

## Task 2: Workspace And Multi-Agent Stores

**Files:**
- Create: `src/main/agentWorkspaceStore.ts`
- Create: `src/main/agentWorkspaceStore.test.ts`
- Create: `src/main/multiAgentSessionStore.ts`
- Create: `src/main/multiAgentSessionStore.test.ts`

- [ ] **Step 1: Write the failing store tests**

Test that workspace store creates a default workspace, registers a project workspace, lists by recent use, and updates last-used timestamp. Test that session store creates a session, appends child ids in order, and returns null for missing ids.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/main/agentWorkspaceStore.test.ts src/main/multiAgentSessionStore.test.ts
```

Expected: FAIL because the store modules do not exist.

- [ ] **Step 3: Implement stores**

Use the existing JSON-store style from `agentExecutionStore.ts` and `agentLearningStore.ts`. Store files:

- `agent-workspaces.json`
- `multi-agent-sessions.json`

Export:

```ts
export type AgentWorkspaceStore = {
  get(id: string): Promise<AgentWorkspace | null>;
  list(): Promise<AgentWorkspace[]>;
  save(workspace: AgentWorkspace): Promise<AgentWorkspace>;
  create(input: AgentWorkspaceInput): Promise<AgentWorkspace>;
  touch(id: string): Promise<AgentWorkspace | null>;
  delete(id: string): Promise<boolean>;
};

export type MultiAgentSessionStore = {
  get(id: string): Promise<MultiAgentSession | null>;
  list(): Promise<MultiAgentSession[]>;
  create(input: MultiAgentSessionInput): Promise<MultiAgentSession>;
  appendChildRun(sessionId: string, runId: string, role: AgentRole): Promise<MultiAgentSession | null>;
  setStatus(sessionId: string, status: MultiAgentSession["status"]): Promise<MultiAgentSession | null>;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- src/main/agentWorkspaceStore.test.ts src/main/multiAgentSessionStore.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agentWorkspaceStore.ts src/main/agentWorkspaceStore.test.ts src/main/multiAgentSessionStore.ts src/main/multiAgentSessionStore.test.ts
git commit -m "feat: persist agent workspaces and multi-agent sessions"
```

## Task 3: Workspace Resolver And Git Worktree Creation

**Files:**
- Create: `src/main/agentWorkspaceService.ts`
- Create: `src/main/agentWorkspaceService.test.ts`

- [ ] **Step 1: Write the failing service tests**

Test:

- `resolveRunContext()` creates and reuses a default workspace under the configured workspace root.
- `createTemporaryWorkspace()` creates a temporary workspace record with cleanup policy.
- `createGitWorktreeWorkspace()` runs `git worktree add <path> -b <branch>` and stores `kind: "git_worktree"` metadata.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/main/agentWorkspaceService.test.ts
```

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement service**

Export:

```ts
export type AgentWorkspaceService = {
  resolveRunContext(input?: ResolveRunContextInput): Promise<AgentRunContext>;
  createTemporaryWorkspace(input?: CreateTemporaryWorkspaceInput): Promise<AgentWorkspace>;
  createGitWorktreeWorkspace(input: CreateGitWorktreeWorkspaceInput): Promise<AgentWorkspace>;
  listWorkspaces(): Promise<AgentWorkspace[]>;
};
```

The service uses `mkdir`, `execFile`, and the workspace store. It does not delete directories in this task.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- src/main/agentWorkspaceService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agentWorkspaceService.ts src/main/agentWorkspaceService.test.ts
git commit -m "feat: resolve agent workspaces and git worktrees"
```

## Task 4: Sandbox-Aware Authorization And Tool Execution

**Files:**
- Modify: `src/shared/toolPermissions.ts`
- Modify: `src/shared/toolPermissions.test.ts`
- Modify: `src/main/toolAuthorizationService.ts`
- Modify: `src/main/toolAuthorizationService.test.ts`
- Modify: `src/main/agentToolExecutor.ts`
- Modify: `src/main/agentToolExecutor.test.ts`

- [ ] **Step 1: Write failing authorization and executor tests**

Add tests that assert:

- Broad task write permission cannot authorize a path outside `runContext.workspaceRoot` when `allowWorkspaceEscape` is false.
- `workspace_escape_denied` reason is returned before one-time approval is requested.
- `shell_exec` runs with `cwd` set to `runContext.workspaceRoot`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/shared/toolPermissions.test.ts src/main/toolAuthorizationService.test.ts src/main/agentToolExecutor.test.ts
```

Expected: FAIL because authorization and executor do not accept run context yet.

- [ ] **Step 3: Implement sandbox narrowing**

Add:

```ts
export function authorizeToolCallWithinRunContext(
  policy: TaskPermissionPolicy,
  request: ToolCallRequest,
  runContext?: AgentRunContext,
): ToolAuthorizationDecision;
```

Update `ToolAuthorizationService.authorize(taskId, request, options?)` to accept `{ runContext?: AgentRunContext }`, call the sandbox-aware helper, and skip approval dialogs for workspace escape denials.

Update `AgentToolExecutor.execute(request, options?)` to accept `{ runContext?: AgentRunContext }` and pass `cwd` to shell execution.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- src/shared/toolPermissions.test.ts src/main/toolAuthorizationService.test.ts src/main/agentToolExecutor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/toolPermissions.ts src/shared/toolPermissions.test.ts src/main/toolAuthorizationService.ts src/main/toolAuthorizationService.test.ts src/main/agentToolExecutor.ts src/main/agentToolExecutor.test.ts
git commit -m "feat: enforce workspace sandbox for agent tools"
```

## Task 5: Runtime Context Propagation

**Files:**
- Modify: `src/main/agentRuntimeEngine.ts`
- Modify: `src/main/agentRuntimeEngine.test.ts`
- Modify: `src/main/agentRunnerService.ts`

- [ ] **Step 1: Write failing runtime tests**

Add tests that assert:

- `startTask()` stores `runContext` in the initial checkpoint and final run record.
- The first trajectory events include `run_context_created`.
- A denied workspace escape produces a failed run with `failureClass: "permission_denied"`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/main/agentRuntimeEngine.test.ts
```

Expected: FAIL because runtime does not resolve or pass run context.

- [ ] **Step 3: Implement runtime propagation**

Add optional `workspaceService` and `parentRunContext` inputs to `createAgentRuntimeEngine`. Resolve `runContext` before checkpoint creation. Save it into checkpoints, run records, and trajectory events. Pass it to authorization and tool executor.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- src/main/agentRuntimeEngine.test.ts src/main/agentRunnerService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agentRuntimeEngine.ts src/main/agentRuntimeEngine.test.ts src/main/agentRunnerService.ts src/main/agentRunnerService.test.ts
git commit -m "feat: propagate workspace context through agent runtime"
```

## Task 6: Multi-Agent Coordinator

**Files:**
- Create: `src/main/multiAgentCoordinator.ts`
- Create: `src/main/multiAgentCoordinator.test.ts`
- Modify: `src/main/agentRuntimeEngine.ts`
- Modify: `src/main/agentRuntimeEngine.test.ts`

- [ ] **Step 1: Write failing coordinator tests**

Test that the coordinator creates a session, schedules child metadata with inherited workspace, increments depth, enforces max depth 3, and appends `child_run_scheduled` trajectory events.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/main/multiAgentCoordinator.test.ts src/main/agentRuntimeEngine.test.ts
```

Expected: FAIL because coordinator does not exist.

- [ ] **Step 3: Implement coordinator**

Export:

```ts
export type MultiAgentCoordinator = {
  createSession(input: CreateMultiAgentSessionInput): Promise<MultiAgentSession>;
  buildChildContext(parent: AgentRunContext, input: BuildChildContextInput): AgentRunContext;
  recordChildRun(input: RecordChildRunInput): Promise<MultiAgentSession>;
};
```

First implementation records lineage and context. It does not expose a model-call tool for spawning child agents yet; the runtime and UI can consume the lineage metadata.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- src/main/multiAgentCoordinator.test.ts src/main/agentRuntimeEngine.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/multiAgentCoordinator.ts src/main/multiAgentCoordinator.test.ts src/main/agentRuntimeEngine.ts src/main/agentRuntimeEngine.test.ts
git commit -m "feat: add multi-agent session coordinator"
```

## Task 7: IPC Wiring And Runs UI

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/global.d.ts`
- Modify: `src/renderer/components/RunsPanel.tsx`
- Modify: `src/renderer/demoAgentData.ts`
- Modify: `src/renderer/demoAgentData.test.ts`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Write failing UI/demo tests**

Add tests that assert demo run data contains workspace context and child run ids. Add a renderer-level pure helper if needed to format sandbox summaries without mounting React.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/renderer/demoAgentData.test.ts src/renderer/agentWorkStatus.test.ts
```

Expected: FAIL because demo data and UI helper do not include run context.

- [ ] **Step 3: Implement wiring and UI**

Wire:

- `agentWorkspaces:list`
- `agentWorkspaces:createTemporary`
- `agentWorkspaces:createGitWorktree`
- `multiAgentSessions:list`

Show in Runs panel:

- Workspace root.
- Sandbox mode, network, shell.
- Agent role.
- Parent run id.
- Child run ids.
- Active execution workspace and role.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- src/renderer/demoAgentData.test.ts src/renderer/agentWorkStatus.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/main.ts src/preload/index.ts src/renderer/global.d.ts src/renderer/components/RunsPanel.tsx src/renderer/demoAgentData.ts src/renderer/demoAgentData.test.ts src/renderer/styles.css
git commit -m "feat: surface workspace and multi-agent run context"
```

## Task 8: Eval And Documentation

**Files:**
- Modify: `src/main/eval/agentEvalFixtures.ts`
- Modify: `src/main/eval/agentEvalRunner.test.ts`
- Modify: `docs/architecture/agent-runtime.md`
- Create: `docs/architecture/agent-workspaces.md`
- Modify: `README.md`

- [ ] **Step 1: Write failing eval/doc tests**

Add eval assertions for:

- Fixture `workspace-escape-denied`.
- Fixture `multi-agent-lineage`.
- Both include required context events.

If README tests assert positioning text, extend them to include workspace-scoped runs.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/main/eval/agentEvalRunner.test.ts src/shared/readme.test.ts
```

Expected: FAIL because eval fixtures and README do not mention the new capability.

- [ ] **Step 3: Implement eval fixtures and docs**

Add required events:

- `run_context_created`
- `workspace_escape_denied`
- `child_run_scheduled`

Document the runtime flow and workspace registry.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- src/main/eval/agentEvalRunner.test.ts src/shared/readme.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/eval/agentEvalFixtures.ts src/main/eval/agentEvalRunner.test.ts docs/architecture/agent-runtime.md docs/architecture/agent-workspaces.md README.md src/shared/readme.test.ts
git commit -m "docs: document agent workspace isolation"
```

## Task 9: Full Verification

**Files:**
- No planned source edits.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run verify
```

Expected: all Vitest suites pass, build succeeds, deterministic eval passes.

- [ ] **Step 2: Inspect git status**

Run:

```bash
git status --short
```

Expected: only known unrelated untracked files remain: `_knowledge_base/` and `zerox-agent-onepage.html`.

- [ ] **Step 3: Commit any verification-only documentation updates**

If no files changed, skip. If docs were adjusted during verification, commit them with:

```bash
git add <changed-doc-files>
git commit -m "docs: finalize agent workspace isolation notes"
```

## Self-Review

- Spec coverage: Tasks cover runtime isolation context, workspace/worktree management, multi-agent lineage, UI, evals, and docs.
- Gap scan: No task uses vague implementation gaps; every task has concrete files, tests, commands, and acceptance.
- Type consistency: The plan consistently uses `AgentWorkspace`, `AgentSandboxPolicy`, `AgentRunContext`, `MultiAgentSession`, `runContext`, and `childRunIds`.
