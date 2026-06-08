# Agent Isolation, Workspaces, And Multi-Agent Design

## Goal

Build the next Zerox agent foundation for multi-agent, workspace, and sandbox layering. The feature set covers all three requested tracks:

1. Runtime isolation context for every agent run.
2. Workspace and worktree management for repeatable local execution boundaries.
3. Parent/child multi-agent orchestration on top of the existing recoverable runtime.

The implementation should keep Zerox's current product direction: local-first, permissioned, observable, recoverable, and user-reviewable. The first version is not a full OS container or cloud runner. It is a durable execution boundary that can later support stronger process isolation, remote sessions, and richer desktop automation.

## Product Position

This work borrows from Codex-style workspace isolation, OpenClaw-style tool/runtime layering, and desktop-agent control planes, but adapts them to Zerox's smaller local-first wedge.

Zerox should let a user answer four questions for any run:

- Which workspace did this run operate in?
- What could it read, write, fetch, and execute?
- Was it a solo run or part of a parent multi-agent session?
- Can I inspect, pause, resume, or replay what happened?

## Scope

### In Scope

- Add shared data types for `AgentWorkspace`, `AgentSandboxPolicy`, `AgentRunContext`, and parent/child run links.
- Persist workspace records under Electron `userData/config`.
- Attach run context to `AgentExecutionCheckpoint`, `AgentRunRecord`, and trajectory events.
- Enforce workspace-aware file and shell authorization before tool execution.
- Add a workspace resolver that can create a default workspace and per-run temporary workspace.
- Add git worktree workspace registration and creation for local repositories.
- Add a multi-agent session model that can schedule child runs with roles and shared parent context.
- Surface workspace, sandbox, and parent/child run information in the Runs panel.
- Add deterministic tests and eval fixtures covering workspace escape attempts and child-run lineage.

### Out Of Scope For First Implementation

- Full Docker, VM, or macOS sandbox-exec enforcement.
- Remote cloud workers.
- Real-time collaborative editing.
- Autonomous infinite agent swarms.
- Unreviewed memory writes from child agents.
- Advanced git conflict resolution or automatic merge/push workflows.

These remain compatible future extensions, but the first implementation should be local, deterministic, and easy to audit.

## Recommended Architecture

The preferred approach is a layered evolution of the existing runtime:

1. **Isolation Context Layer**
   Introduce a run context object that every checkpoint, run record, tool authorization call, and trajectory event can carry. This is the core boundary.

2. **Workspace Registry Layer**
   Add a main-process store for named workspaces, including root path, optional git metadata, allowed read/write roots, and cleanup policy.

3. **Multi-Agent Session Layer**
   Add parent/child run metadata and a small coordinator that starts child runs through the existing `AgentRuntimeEngine`, rather than creating a second runtime.

This avoids a rewrite and keeps the current recoverable runtime, trajectory store, learning loop, and eval harness useful.

## Alternatives Considered

### Alternative 1: Start With Multi-Agent Orchestration

This would quickly show a visible "multi-agent" feature, but without workspace and sandbox metadata, child runs would share unclear filesystem and permission boundaries. It is likely to create confusing audit trails.

### Alternative 2: Start With Heavy OS Sandboxing

This would provide stronger isolation, but it would force platform-specific complexity before Zerox has durable run-context semantics. It also risks breaking current file and shell tools.

### Alternative 3: Layered Runtime Context First

This is the selected approach. It creates a durable identity and boundary for every run, then lets workspace management and multi-agent orchestration build on that foundation.

## Data Model

### AgentWorkspace

`AgentWorkspace` represents a durable local execution area.

Fields:

- `id`: stable workspace id.
- `name`: user-visible name.
- `rootPath`: absolute local path.
- `kind`: `default`, `project`, `temporary`, or `git_worktree`.
- `createdAt`: ISO timestamp.
- `updatedAt`: ISO timestamp.
- `lastUsedAt`: ISO timestamp or null.
- `git`: optional metadata with repository root, branch, and worktree path.
- `cleanup`: `keep`, `delete_on_success`, or `delete_on_completion`.

For `git_worktree` workspaces, `rootPath` is the worktree path and `git.repositoryRoot` points to the original repository. Zerox should create worktree paths under a controlled workspace parent directory unless the user registers an existing worktree.

### AgentSandboxPolicy

`AgentSandboxPolicy` describes the execution boundary attached to a run.

Fields:

- `mode`: `workspace_write` or `read_only`.
- `network`: `none`, `approved_domains`, or `task_policy`.
- `shell`: `disabled`, `approved_commands`, or `workspace_only`.
- `allowWorkspaceEscape`: boolean, default false.
- `extraReadRoots`: absolute paths allowed in addition to the workspace.
- `extraWriteRoots`: absolute paths allowed in addition to the workspace.

The first implementation enforces this policy at the Zerox tool authorization layer. The policy is intentionally shaped so stronger process-level enforcement can be added later.

### AgentRunContext

`AgentRunContext` is attached to checkpoints, run records, and trajectory events.

Fields:

- `workspaceId`: workspace id.
- `workspaceRoot`: absolute path at run start.
- `sandbox`: `AgentSandboxPolicy`.
- `parentRunId`: optional parent run id.
- `sessionId`: optional multi-agent session id.
- `agentRole`: `primary`, `planner`, `executor`, `reviewer`, or `critic`.
- `depth`: zero for root runs, incremented for child runs.

### MultiAgentSession

`MultiAgentSession` groups related runs.

Fields:

- `id`: stable session id.
- `title`: user-visible session title.
- `rootRunId`: root run id when available.
- `status`: `running`, `paused`, `succeeded`, `failed`, or `canceled`.
- `workspaceId`: shared workspace id.
- `createdAt`: ISO timestamp.
- `updatedAt`: ISO timestamp.
- `childRunIds`: ordered run ids.
- `roles`: map of run id to agent role.

## Runtime Flow

### Solo Run

1. User or scheduler starts a task.
2. `AgentRuntimeEngine.startTask` resolves task, skill, and model profile.
3. Runtime asks `AgentWorkspaceService` for a run context.
4. Checkpoint is created with `runContext`.
5. Trajectory receives an initial `run_context_created` event.
6. Tool authorization receives task id, tool call request, and run context.
7. File and shell tools are allowed only inside approved roots unless explicit task policy allows more.
8. Final run record stores the same `runContext`.

### Child Run

1. Root run requests a child agent through a coordinator API.
2. Coordinator creates or reuses a `MultiAgentSession`.
3. Child run inherits workspace id and sandbox policy from parent unless the parent explicitly narrows the policy.
4. Child checkpoint stores `parentRunId`, `sessionId`, role, and incremented depth.
5. Runs panel shows parent and child runs together.
6. Learning extraction treats child runs as evidence but does not automatically promote cross-run memories without review.

## Authorization Rules

The existing `TaskPermissionPolicy` remains the user-facing permission input. `AgentSandboxPolicy` narrows what that policy can do.

Rules:

- A file read is allowed only when it is inside the workspace root or one of `extraReadRoots`, and it is also allowed by task permissions.
- A file write is allowed only when it is inside the workspace root or one of `extraWriteRoots`, and it is also allowed by task permissions.
- If `allowWorkspaceEscape` is false, task permissions cannot authorize writes outside the run workspace.
- Shell commands run with `cwd` set to the workspace root when shell execution is enabled.
- Shell commands that include explicit absolute paths outside approved roots are denied in the first implementation.
- Network access follows the stricter result of task permission and sandbox network mode.

These rules preserve existing task permissions while making the run boundary visible and enforceable.

## UI Design

### Runs Panel

Add a compact context section to the selected run inspector:

- Workspace name and root path.
- Sandbox mode and network/shell summary.
- Parent run link when present.
- Child runs list when present.
- Session id when part of a multi-agent session.

Active executions should show workspace name and agent role. This keeps multi-agent activity understandable without creating a separate control center yet.

### Future Workspace Panel

The first implementation can expose workspace management inside Runs or Settings. A dedicated Workspace panel becomes useful when there are multiple project workspaces, cleanup actions, and git worktree creation controls.

## Error Handling

- Missing workspace record: fail run before model call with `tool_error` and a clear message.
- Workspace root missing on disk: fail run before tool execution unless workspace cleanup policy says it can be recreated.
- Workspace escape attempt: deny tool call with `permission_denied` and record the denied path in trajectory metadata without dumping file content.
- Child depth too high: deny child run creation with a coordinator error.
- Parent run canceled: child runs should be canceled or left paused according to coordinator policy; first implementation cancels queued child runs and pauses running child runs.
- Temporary workspace cleanup failure: keep the workspace and emit a warning event so the user can inspect it.

## Testing Strategy

### Unit Tests

- Shared type helpers validate workspace ids, sandbox defaults, and parent/child context.
- Workspace store persists, lists, updates, and deletes records.
- Authorization denies file writes outside workspace even when task permissions are broad.
- Shell execution receives workspace `cwd`.
- Runtime checkpoints include run context.
- Trajectory includes initial context event.
- Multi-agent coordinator creates child runs with inherited workspace and narrowed policy.

### Integration Tests

- A deterministic eval fixture attempts to write outside the workspace and must fail with `permission_denied`.
- A deterministic eval fixture creates planner and executor child runs, then checks lineage and trajectory ordering.
- Existing recoverable runtime tests continue to pass for runs without explicit workspace input by using a default workspace.

### UI Tests

- Runs panel renders workspace name, sandbox summary, role, parent run link, and child run list from demo data.
- Empty workspace state renders without crashing.

## Documentation Updates

- Update `docs/architecture/agent-runtime.md` with run context, workspace, and sandbox flow.
- Add `docs/architecture/agent-workspaces.md` describing workspace registry and cleanup policy.
- Update README positioning to mention workspace-scoped runs and parent/child multi-agent sessions.

## Milestones

### Milestone 1: Runtime Isolation Context

Deliver run context types, checkpoint/run-record persistence, trajectory context event, and workspace-aware authorization tests.

Acceptance:

- Every new run has a visible run context.
- Existing tasks still run through a default workspace.
- Workspace escape attempts are denied before tool execution.

### Milestone 2: Workspace Registry

Deliver workspace store, default workspace resolver, temporary workspace creation, git worktree workspace creation, cleanup policy, and basic UI visibility.

Acceptance:

- User can see which workspace a run used.
- Runtime can create a temporary run workspace.
- User can register an existing project workspace.
- Runtime can create a git worktree workspace for a selected local repository and branch name.
- Cleanup failures are visible and non-destructive.

### Milestone 3: Multi-Agent Session Layer

Deliver parent/child run metadata, coordinator service, child role assignment, and Runs panel lineage display.

Acceptance:

- A parent run can schedule child runs through the existing runtime.
- Child runs inherit workspace and sandbox context.
- Runs panel shows the session tree clearly.

## Risks And Mitigations

- **Risk: Scope grows into a full container platform.** Keep first implementation at tool-authorization enforcement and durable metadata. Add process sandboxing only after boundaries are proven.
- **Risk: Existing tasks break because they expect broad file paths.** Default workspace should be compatible with existing configured task permissions, while writes outside the workspace require explicit sandbox escape.
- **Risk: Multi-agent runs create confusing learning signals.** Store lineage in trajectory and require reviewed learning candidates before memory promotion.
- **Risk: Temporary workspace cleanup deletes useful artifacts.** Default cleanup is `keep`; destructive cleanup requires explicit workspace policy.
- **Risk: UI becomes too busy.** Show workspace and role as compact metadata in the current Runs panel before creating a new Workspace section.

## Success Criteria

- Runtime, permission, trajectory, and UI surfaces consistently display the same workspace and sandbox context.
- Deterministic eval includes at least one blocked workspace escape and one parent/child session.
- Existing `npm run verify` remains green.
- The design supports future git worktrees, stronger OS sandboxing, and remote workers without changing existing run records.
