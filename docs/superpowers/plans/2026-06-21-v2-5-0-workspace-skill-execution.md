# v2.5.0 Workspace And Skill Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Zerox Agent v2.5.0 with first-class workspace selection, workspace-bound chat/skill execution, staged skill contracts, readable expandable process status, and replay-grade chat observability.

**Architecture:** The release turns workspace from an implicit path into an explicit `WorkspaceContract` that is selected in the UI, persisted on chat sessions, resolved into `AgentRunContext`, and enforced through `ToolAuthorizationService`. Skill invocation becomes a first-class staged execution contract layered on top of workspace-bound chat runs, while process events are written to a durable chat/workspace run ledger and rendered from projections instead of transient renderer state.

**Tech Stack:** Electron 42, React 19, TypeScript 6, Vitest 4, local JSON/SQLite-compatible stores, existing `AgentWorkspaceService`, `AgentLoop`, `ToolAuthorizationService`, `AgentTrajectoryStore`, and Electron IPC/preload APIs.

---

## Context From Subagents

- Workspace is already partially implemented in `src/shared/agentWorkspace.ts`, `src/main/agentWorkspaceService.ts`, `src/shared/toolPermissions.ts`, and goal/scheduled runtime. The gap is chat and skill execution: `SendChatMessageInput` has no workspace, `chatService` calls `runAgentLoop` without `taskId`/`runContext`, and chat tool authorization is weaker than scheduled/goal execution.
- Skill execution currently resolves `@skill` and injects `SKILL.md`, but lacks a first-class execution contract, resource map, stage state, permission policy, and `SkillManifest.execution.maxTurns` support for chat.
- The right rail currently renders from live `chat:statusEvent` plus a bounded 80-event session snapshot. It is useful but not replay-grade and can lose early events on long runs.
- MiMo-Code patterns worth adopting: skill loading returns body + base directory + sampled resources; skill permission is explicit; execution is staged, recoverable, and persisted.
- The Codex reference screenshot suggests workspace should be visible at task composition time: a project list in the shell plus a compact run-location/context strip below the composer.

## Non-Negotiable Release Invariants

- No cloud workers, hosted state, or unreviewed self-modification.
- Workspace sandbox denials must not be bypassed by manual approval.
- Chat skill/tool execution must go through the same workspace/run-context authorization path as goal/scheduled execution.
- Right rail text must wrap, clamp, and scroll without overlap across desktop and mobile.
- Chat process history must support full replay beyond the 80-event UI cache.
- v2.5.0 release metadata, README, `.zerox/feature_list.json`, `.zerox/progress.md`, package files, package artifacts, and smoke text must agree.

---

### Task 1: Workspace Contract And Chat Session Persistence

**Files:**
- Modify: `src/shared/agentWorkspace.ts`
- Modify: `src/shared/chat.ts`
- Modify: `src/main/chatSessionStore.ts`
- Modify: `src/main/chatSessionStore.test.ts`
- Modify: `src/shared/packageScripts.test.ts` only after final version bump

- [x] **Step 1: Add failing shared contract tests**

Add tests in `src/main/chatSessionStore.test.ts` proving:

```ts
it("persists workspace identity and summary on chat sessions", async () => {
  const store = createJsonChatSessionStore(tempFile);
  const created = await store.appendMessage({
    role: "user",
    content: "hello",
    createdAt: "2026-06-21T00:00:00.000Z",
    workspaceId: "workspace_building_agent",
    workspaceSummary: {
      name: "building agent",
      rootPath: "/Volumes/Out/codex_projects/building agent",
      kind: "default",
      sandboxMode: "workspace-write",
    },
  });

  const reloaded = createJsonChatSessionStore(tempFile);
  const loaded = await reloaded.get(created.session.id);
  expect(loaded?.workspaceId).toBe("workspace_building_agent");
  expect(loaded?.workspaceSummary?.rootPath).toBe(
    "/Volumes/Out/codex_projects/building agent",
  );
});
```

Expected initial result: TypeScript/test failure because `workspaceId` and `workspaceSummary` are not accepted/persisted.

- [x] **Step 2: Add `WorkspaceContract` projection types**

In `src/shared/agentWorkspace.ts`, add a UI-safe contract derived from `AgentWorkspace`/`AgentRunContext`:

```ts
export type WorkspaceContract = {
  workspaceId: string;
  name: string;
  rootPath: string;
  kind: AgentWorkspaceKind;
  sandboxMode: AgentSandboxPolicy["mode"];
  writableRoots: string[];
  readableRoots: string[];
  networkAllowed: boolean;
  shellAllowed: boolean;
  git?: AgentWorkspaceGitMetadata;
};
```

Add helpers:

```ts
export function toWorkspaceContract(
  workspace: AgentWorkspace,
  runContext: AgentRunContext,
): WorkspaceContract {
  return {
    workspaceId: workspace.id,
    name: workspace.name,
    rootPath: runContext.workspaceRoot,
    kind: workspace.kind,
    sandboxMode: runContext.sandbox.mode,
    writableRoots: [...runContext.sandbox.writableRoots],
    readableRoots: [...runContext.sandbox.readableRoots],
    networkAllowed: runContext.network.allowed,
    shellAllowed: runContext.shell.allowed,
    ...(workspace.git ? { git: workspace.git } : {}),
  };
}
```

- [x] **Step 3: Extend chat shared models**

In `src/shared/chat.ts`, add:

```ts
export type ChatWorkspaceSummary = {
  name: string;
  rootPath: string;
  kind: string;
  sandboxMode: string;
  branch?: string;
};
```

Add `workspaceId?: string` and `workspaceSummary?: ChatWorkspaceSummary` to `SendChatMessageInput`, `ChatSessionRecord`, `ChatSessionListItem`, and append-message input types used by `ChatSessionStore`.

- [x] **Step 4: Persist and normalize workspace fields**

Update `src/main/chatSessionStore.ts`:

- Preserve `workspaceId` and `workspaceSummary` in `appendMessage`.
- Prefer explicit input workspace fields for a new session.
- Preserve previous session workspace fields for follow-up messages.
- Include workspace fields in `toListItem`.
- Normalize invalid persisted workspace summaries by dropping malformed values, not crashing.

- [x] **Step 5: Run focused tests**

Run:

```bash
npm test -- src/main/chatSessionStore.test.ts src/shared/packageScripts.test.ts
```

Expected: pass.

---

### Task 2: Workspace-Aware Chat Execution And Authorization

**Files:**
- Modify: `src/main/chatService.ts`
- Modify: `src/main/container.ts`
- Modify: `src/main/agentLoop.ts` only if additional context propagation is needed
- Modify: `src/main/agentToolExecutor.ts`
- Modify: `src/main/chatService.test.ts`
- Modify: `src/main/agentToolExecutor.test.ts`

- [x] **Step 1: Write failing chat workspace execution tests**

Add tests to `src/main/chatService.test.ts`:

```ts
it("resolves selected workspace and passes run context into the agent loop", async () => {
  const observed: unknown[] = [];
  const service = createChatService({
    chatClient: createSingleMessageClient("done"),
    workspaceService: {
      async resolveRunContext(input) {
        observed.push(input);
        return createRunContext("/workspace/project");
      },
    },
    runAgentLoop: async (_messages, _profile, options) => {
      expect(options.runContext?.workspaceRoot).toBe("/workspace/project");
      expect(options.taskId).toMatch(/^chat_/);
      expect(options.runtimeTask?.permissions?.filesystem).toBe("workspace_write");
      return { status: "succeeded", summary: "done", turns: 1, toolCallsExecuted: 0 };
    },
  });

  await service.sendMessage({
    sessionId: "s1",
    requestId: "r1",
    message: "inspect project",
    workspaceId: "workspace_project",
  });

  expect(observed).toContainEqual({ workspaceId: "workspace_project" });
});
```

Expected initial result: failure because `workspaceService` and workspace run context are not wired into chat.

- [x] **Step 2: Inject workspace service into chat service**

Extend `createChatService` options with:

```ts
workspaceService?: Pick<AgentWorkspaceService, "resolveRunContext">;
```

When sending a normal chat or skill chat message, resolve:

```ts
const runContext = await options.workspaceService?.resolveRunContext({
  workspaceId: input.workspaceId,
});
```

If no workspace is selected, resolve default context. Emit a status event like:

```ts
state: "workspace",
message: `工作区：${workspaceNameOrRoot}`,
```

- [x] **Step 3: Build synthetic runtime task for chat**

Create a local helper in `chatService.ts`:

```ts
function createChatRuntimeTask(input: {
  requestId: string;
  sessionId: string;
  workspaceId?: string;
  selectedSkillName?: string;
}): ScheduledTaskLike {
  return {
    id: `chat_${input.sessionId}_${input.requestId}`,
    title: input.selectedSkillName
      ? `Chat skill: ${input.selectedSkillName}`
      : "Chat task",
    permissions: {
      filesystem: "workspace_write",
      shell: true,
      network: false,
      tools: [],
    },
  };
}
```

Use the repo's real `ScheduledTask`/permission shape, matching existing tests.

- [x] **Step 4: Call `runAgentLoop` with task identity**

Pass `taskId`, `runtimeTask`, and `runContext` into `runAgentLoop`. This activates `ToolAuthorizationService` in `agentLoop.ts` because it currently checks `toolAuthorizationService && taskId`.

- [x] **Step 5: Default native code tools to active workspace**

In `src/main/agentToolExecutor.ts`, for native code tools that currently require `workspaceRoot`, use `executionOptions.runContext?.workspaceRoot` as the default when the argument is omitted. Preserve explicit override authorization.

- [x] **Step 6: Wire container**

In `src/main/container.ts`, pass `workspaceService: agentWorkspaceService()` and `trajectoryStore: agentTrajectoryStore()` into `createChatService`.

- [x] **Step 7: Run focused tests**

Run:

```bash
npm test -- src/main/chatService.test.ts src/main/agentToolExecutor.test.ts src/main/agentLoop.test.ts src/main/toolAuthorizationService.test.ts
```

Expected: pass.

---

### Task 3: Skill Execution Contract And Resource-Aware Invocation

**Files:**
- Create: `src/shared/skillExecutionContract.ts`
- Create: `src/shared/skillExecutionContract.test.ts`
- Create: `src/main/skillExecutionService.ts`
- Create: `src/main/skillExecutionService.test.ts`
- Modify: `src/main/skillRegistry.ts`
- Modify: `src/main/chatService.ts`
- Modify: `src/main/chatService.test.ts`

- [x] **Step 1: Add contract transition tests**

Create `src/shared/skillExecutionContract.test.ts` with tests for:

- Valid transitions: `resolving_skill -> loading_resources -> configuring -> planning -> executing -> validating -> finalizing -> succeeded`.
- Terminal immutability: `succeeded`, `failed`, `canceled` cannot transition.
- Snapshot includes skill provenance and budgets.

- [x] **Step 2: Implement shared skill contract**

Create `src/shared/skillExecutionContract.ts` with:

```ts
export type SkillExecutionStage =
  | "resolving_skill"
  | "loading_resources"
  | "configuring"
  | "planning"
  | "executing"
  | "validating"
  | "finalizing"
  | "succeeded"
  | "failed"
  | "canceled";
```

Include `SkillExecutionContract`, `SkillStageRecord`, `SkillExecutionSnapshot`, `canTransitionSkillStage`, and `transitionSkillExecution`.

- [ ] **Step 3: Build `SkillExecutionService`**

Create `src/main/skillExecutionService.ts` responsible for:

- Resolving selected or natural-language skill.
- Recording exact `skillFile`, `rootDir`, `bodyHash`, and `manifestHash`.
- Extracting direct relative references from `SKILL.md` (`references/`, `assets/`, `scripts/`, and direct relative paths).
- Building budgets from `SkillManifest.execution.maxTurns` with safe defaults.
- Producing a synthetic `taskId` and permission label for chat skill runs.

- [x] **Step 4: Fix skill registry cache keying**

Update `src/main/skillRegistry.ts` cache to key by `skillsDir`, `extraDirs`, `skipSystemDirs`, and relevant roots. Add tests proving two discovery contexts do not share stale results.

- [ ] **Step 5: Use service from chat**

Replace inline skill prompt assembly in `chatService.ts` with `SkillExecutionService`. Inject a structured preamble:

```text
<selected-skill>
name: ...
file: ...
root: ...
stage: executing
resources:
- ...
</selected-skill>
```

Keep full `SKILL.md` body injection, but add explicit guidance that relative paths are relative to `rootDir`.

- [ ] **Step 6: Persist snapshot in activity**

Extend chat activity event payloads to include `skillExecution` snapshot updates. The right rail can show current stage before full UI changes land.

- [x] **Step 7: Run focused tests**

Run:

```bash
npm test -- src/shared/skillExecutionContract.test.ts src/main/skillExecutionService.test.ts src/main/chatService.test.ts src/shared/skillMentions.test.ts
```

Expected: pass.

---

### Task 4: Replay-Grade Chat Workspace Run Ledger

**Files:**
- Create: `src/shared/workspaceRunLedger.ts`
- Create: `src/shared/workspaceRunLedger.test.ts`
- Create: `src/main/workspaceRunStore.ts`
- Create: `src/main/workspaceRunStore.test.ts`
- Modify: `src/main/chatService.ts`
- Modify: `src/main/chatSessionStore.ts`
- Modify: `src/main/toolResultOffloadStore.ts`
- Modify: `src/main/container.ts`

- [x] **Step 1: Add ledger model tests**

Create tests proving:

- A `WorkspaceRun` has `workspaceRunId`, `sessionId`, `requestId`, `workspaceId`, status, timestamps.
- `WorkspaceRunEvent` sequence numbers are stable and monotonic.
- `ChatTrajectoryEvent` can project from run events and contains `toolCallId`, `resultRef`, and `sourceEventId`.

- [x] **Step 2: Implement shared ledger types**

Create `src/shared/workspaceRunLedger.ts` with:

```ts
export type WorkspaceRunStatus =
  | "queued"
  | "running"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "paused"
  | "succeeded"
  | "failed"
  | "canceled";
```

Include event types for `model_request`, `reasoning`, `tool_call`, `tool_result`, `tool_denied`, `skill_stage`, `status`, and `summary`.

- [x] **Step 3: Implement JSON-backed store first**

Create `src/main/workspaceRunStore.ts` as an append-only JSONL store under `config/workspace-runs/`, with methods:

```ts
createRun(input): Promise<WorkspaceRun>;
appendEvent(workspaceRunId, event): Promise<WorkspaceRunEvent>;
listEvents(workspaceRunId): Promise<WorkspaceRunEvent[]>;
listChatTrajectory(sessionId): Promise<ChatTrajectoryEvent[]>;
finishRun(workspaceRunId, status, summary): Promise<WorkspaceRun>;
```

Keep SQLite migration as a follow-up after JSON behavior is stable.

- [x] **Step 4: Wire chatService event callbacks**

When `chatService` starts a model-backed run, create a `WorkspaceRun`. For each status event and tool callback, append a ledger event with session/request linkage. Keep the existing 80-event `ChatSessionRecord.activity` as UI cache, but right rail can fetch the ledger later.

- [ ] **Step 5: Include session/request IDs in result refs**

Update offload call sites so chat result refs include `workspaceRunId`, `sessionId`, `requestId`, and `toolCallId` where available. Preserve old filenames for backward compatibility when fields are missing.

- [x] **Step 6: Run focused tests**

Run:

```bash
npm test -- src/shared/workspaceRunLedger.test.ts src/main/workspaceRunStore.test.ts src/main/chatService.test.ts src/main/chatSessionStore.test.ts
```

Expected: pass.

---

### Task 5: Workspace Selector And Expandable Right Rail UI

**Files:**
- Modify: `src/renderer/components/AgentChatPanel.tsx`
- Modify: `src/renderer/chatTaskActivity.ts`
- Modify: `src/renderer/chatTaskActivityRestore.test.ts`
- Modify: `src/renderer/materialDesign.test.ts`
- Modify: `src/renderer/styles/composer.css`
- Modify: `src/renderer/styles/chat.css`
- Modify: `src/renderer/styles/responsive.css`

- [x] **Step 1: Add UI contract tests**

Extend `src/renderer/materialDesign.test.ts` to assert:

- Composer contains workspace context controls: `工作区`, `本地模式`, and branch/worktree text when available.
- Right rail contains collapsed latest-thought copy and an `展开全部` control.
- CSS contains explicit wrapping/scrolling rules for process text.

- [x] **Step 2: Load workspaces in AgentChatPanel**

Use existing preload API:

```ts
window.buildingAgent.listAgentWorkspaces()
```

Store `availableWorkspaces`, `selectedWorkspaceId`, and `workspaceMenuOpen`. Default to existing session workspace, then first default workspace, then undefined.

- [x] **Step 3: Add composer workspace strip**

Add a compact row below the input area:

```tsx
<div className="workspace-strip" aria-label="运行位置">
  <button className="workspace-chip" type="button">工作区 · {name}</button>
  <span className="workspace-chip workspace-chip-muted">本地模式</span>
  <span className="workspace-chip workspace-chip-muted">{branch}</span>
</div>
```

On send, include `workspaceId` in `SendChatMessageInput`.

- [x] **Step 4: Add workspace menu**

Menu requirements:

- Searchable list of workspaces.
- Shows `name`, `rootPath`, `kind`, branch when present.
- Actions for default/temp/worktree can be displayed disabled if creation flow is not in this release.
- Menu must fit inside composer width and viewport.

- [x] **Step 5: Collapse/expand right rail history**

Default `ContextActivityCard` to latest thought only with a 2-line clamp. Add `展开全部` / `收起` toggle. Expanded mode shows all process items in a scroll container with long-item internal collapse preserved.

- [ ] **Step 6: Mobile fallback**

When right rail is hidden below `1180px`, show latest status in the chat header or composer workspace strip without duplicating the full process list.

- [x] **Step 7: Run focused UI tests**

Run:

```bash
npm test -- src/renderer/materialDesign.test.ts src/renderer/chatTaskActivityRestore.test.ts
```

Expected: pass.

---

### Task 6: Run Graph, Episode Export, And Observability Surfacing

**Files:**
- Modify: `src/shared/agentTrajectory.ts`
- Modify: `src/shared/runGraph.ts`
- Modify: `src/shared/runGraph.test.ts`
- Modify: `src/main/agentEpisodeExporter.ts`
- Modify: `src/main/agentEpisodeExporter.test.ts`
- Modify: `src/renderer/components/RunsPanel.tsx`

- [ ] **Step 1: Add graph/export failing tests**

Add tests proving:

- `skill_invoked` becomes a visible graph node or status node.
- Workspace contract/run context appears in run graph.
- Episode export includes `chat-trajectory.jsonl`, `workspace-run.json`, `workspace-run-events.jsonl`, and a `tool-results-manifest.json`.

- [ ] **Step 2: Extend trajectory/run graph types**

Add workspace/skill node kinds without breaking existing projections. Preserve edge safety for existing node kinds.

- [ ] **Step 3: Export chat/workspace run ledgers**

Update `agentEpisodeExporter` to include workspace run files when a `workspaceRunId` or chat session export is available.

- [ ] **Step 4: Add UI surfacing**

Runs panel should show workspace root/sandbox and skill stage summary when those events exist.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- src/shared/runGraph.test.ts src/main/agentEpisodeExporter.test.ts src/renderer/materialDesign.test.ts
```

Expected: pass.

---

### Task 7: Release Metadata, Documentation, Packaging, And Push

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.zerox/feature_list.json`
- Modify: `.zerox/progress.md`
- Modify: `README.md`
- Modify: `src/shared/packageScripts.test.ts`
- Modify: `src/shared/readme.test.ts`

- [x] **Step 1: Bump version to 2.5.0**

Set `package.json`, `package-lock.json`, and package script/readme tests to `2.5.0`.

- [x] **Step 2: Add feature-list entry**

Append a `.zerox/feature_list.json` item:

```json
{
  "id": "P13-v2.5.0-workspace-skill-execution",
  "priority": 13,
  "status": "done",
  "title": "Workspace-first chat and staged skill execution",
  "definitionOfDone": [
    "Chat and skill runs carry an explicit workspace contract from UI to runtime",
    "Chat tool execution is authorized through workspace run context",
    "Skill invocation records provenance, resources, stages, budgets, and status",
    "Right rail defaults to latest thought and can expand full process history",
    "Chat process observability supports full run replay beyond activity cache",
    "README/progress/release metadata and packaged app report v2.5.0"
  ],
  "verification": [
    "npm run verify",
    "npm run harness:check",
    "npm run harness:score",
    "npm run smoke:prod",
    "npm run dist:mac"
  ]
}
```

- [x] **Step 3: Update README**

Document:

- Current release v2.5.0.
- Workspace selector and WorkspaceContract.
- SkillExecutionContract and staged skills.
- Right rail collapsed/expanded process history.
- Replay-grade chat/workspace run observability.
- Test count after full suite.
- DMG quarantine filename `Zerox Agent-2.5.0-arm64.dmg`.

- [x] **Step 4: Run full verification**

Run:

```bash
npm run harness:check
npm test
npm run build
npm run verify
npm run harness:score
npm run smoke:prod
git diff --check
```

Expected: all pass.

- [x] **Step 5: Package and smoke packaged app**

Run:

```bash
npm run dist:mac
BUILDING_AGENT_SMOKE=1 "release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent"
BUILDING_AGENT_SMOKE=1 BUILDING_AGENT_SMOKE_REQUIRED_TEXTS='v2.5.0' "release/mac-arm64/Zerox Agent.app/Contents/MacOS/Zerox Agent"
plutil -p "release/mac-arm64/Zerox Agent.app/Contents/Info.plist" | rg "CFBundleShortVersionString|CFBundleVersion|CFBundleName"
shasum -a 256 "release/Zerox Agent-2.5.0-arm64.dmg" "release/Zerox Agent-2.5.0-arm64-mac.zip"
```

Expected: packaged app launches, visible UI contains v2.5.0, Info.plist reports 2.5.0, checksums printed.

- [x] **Step 6: Update progress only with real evidence**

Add a top entry to `.zerox/progress.md` after commands have actually run. Include focused tests, full verification, package paths, packaged app smoke, and known residual risks.

- [ ] **Step 7: Stage, commit, tag, push**

Do not stage generated onepager test artifacts unless deliberately kept. Stage source/docs/tests/package metadata only:

```bash
git add .zerox README.md package.json package-lock.json src docs
git commit -m "feat: ship v2.5.0 workspace skill execution"
git tag v2.5.0
git push origin codex/v2.5.0-workspace-skill-execution
git push origin v2.5.0
```

If the remote branch or tag push fails because credentials/remotes are missing, record the exact blocker in `.zerox/progress.md` and final response.

---

## Implementation Order

1. Task 1: Shared workspace/chat persistence.
2. Task 2: Runtime workspace authorization for chat.
3. Task 3: Skill execution contract and service.
4. Task 4: Replay-grade ledger.
5. Task 5: Workspace UI and right rail.
6. Task 6: Graph/export observability.
7. Task 7: Release and packaging.

This order keeps the data contract stable before UI, and makes observability available before release QA.

## Self-Review

- Spec coverage: all four user requirements are mapped to tasks, tests, and release gates.
- Placeholder scan: no task uses TBD/TODO placeholders; every task has files and commands.
- Type consistency: `WorkspaceContract`, `SkillExecutionContract`, `WorkspaceRun`, and `ChatTrajectoryEvent` names are consistent across tasks.
- Dirty worktree risk: v2.4.6/v2.4.7 changes are present and should be folded into the v2.5.0 branch unless the maintainer asks for separate commits/tags.
