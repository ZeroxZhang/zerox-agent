# Agent Workspaces Architecture

Zerox workspaces provide a local execution boundary for recoverable agent runs. They are not full OS containers yet; the first implementation enforces boundaries through durable metadata, tool authorization, shell working directories, and trajectory records.

## Workspace Registry

Workspace records are stored under:

```text
userData/config/agent-workspaces.json
```

Each `AgentWorkspace` has an id, name, root path, kind, timestamps, cleanup policy, and optional git metadata. Supported kinds are:

- `default`: the normal local workspace used when a task does not choose one.
- `project`: a registered project directory.
- `temporary`: a per-run scratch workspace.
- `git_worktree`: a workspace created from `git worktree add`.

Workspace directories live under:

```text
userData/workspaces/
```

unless the user registers an existing project or worktree path.

## Sandbox Policy

Every run context includes an `AgentSandboxPolicy`:

- `mode`: `workspace_write` or `read_only`.
- `network`: `none`, `approved_domains`, or `task_policy`.
- `shell`: `disabled`, `approved_commands`, or `workspace_only`.
- `allowWorkspaceEscape`: false by default.
- `extraReadRoots` and `extraWriteRoots`: explicit roots beyond the workspace.

The sandbox narrows task permissions. A task may have broad file permissions, but a run cannot read or write outside its workspace unless the sandbox allows that root.

## Runtime Context

`AgentRuntimeEngine` resolves an `AgentRunContext` before checkpoint creation. The context is then stored in:

- `AgentExecutionCheckpoint.runContext`
- `AgentRunRecord.runContext`
- `AgentTrajectoryEvent.runContext`

The first trajectory event for a workspace-scoped run is `run_context_created`.

## Git Worktrees

`AgentWorkspaceService.createGitWorktreeWorkspace()` creates a controlled workspace with:

```bash
git worktree add <workspaceRoot>/worktrees/<id> -b <branch>
```

The workspace record stores the original repository root, branch, and worktree path. Zerox does not merge, push, or delete git worktrees automatically in this first implementation.

## Multi-Agent Sessions

Multi-agent sessions are stored under:

```text
userData/config/multi-agent-sessions.json
```

`MultiAgentCoordinator` records parent/child run lineage and emits `child_run_scheduled` trajectory events. Child contexts inherit workspace and sandbox policy from the parent and increment depth. The first implementation limits child depth to three.

## UI Surface

The Runs panel shows:

- workspace root
- sandbox summary
- agent role
- parent run id
- child run ids
- multi-agent session id

This keeps multi-agent activity inspectable without introducing a separate opaque runtime.
