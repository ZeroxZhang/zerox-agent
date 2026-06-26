# Zerox Agent Bug Hardening Iteration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the highest-risk bugs found in the June 21, 2026 deep audit of `zerox-agent`, preserving local-first trust, explicit permissions, observable trajectories, recoverable runs, and reviewed learning.

**Architecture:** This iteration is split into independently testable lanes. First, consolidate workspace and permission enforcement into shared primitives used by both authorization and execution. Second, make SQLite/dual persistence behavior byte-for-byte compatible with JSON for safety-critical records. Third, harden runtime hang handling and observability durability. Finally, repair UI/runtime lifecycle gaps and trim repeated verification cost without weakening existing safe wrappers.

**Tech Stack:** Electron 42, React 19, TypeScript 6, Vitest 4, local JSONL stores, better-sqlite3 repository layer, existing `ToolAuthorizationService`, `AgentToolExecutor`, `AgentRunContext`, `WorkspaceRunStore`, and Electron IPC/preload APIs.

## Global Constraints

- Preserve local-first trust, explicit permissions, observable trajectories, and reviewed learning.
- Do not add cloud workers or unreviewed self-modification in this iteration.
- Do not bypass `ToolAuthorizationService` or workspace sandbox checks.
- Prefer typed shared models and focused tests before runtime behavior changes.
- After each task, run its focused tests plus `npm run harness:check`.
- Before closing the whole iteration, run `npm run verify` and `npm run smoke:prod`.

---

## Audit Summary

Commands already run during audit:

- `./init.sh` -> passed; includes `npm run harness:check` and `npm test -- src/shared/packageScripts.test.ts`.
- `npm run verify` -> 164 files / 1019 tests passed; build passed; agent eval 26/26; memory eval 2/2.
- `npm run smoke:prod` -> passed; renderer rendered agent chat UI; better-sqlite3 ABI mismatch fell back to JSON as designed.
- `npm run harness:check` -> passed.

Subagent lanes used:

- Runtime/tool governance explorer.
- Renderer/preload/main connectivity explorer.
- Persistence/recovery/migration explorer.
- Performance/flakiness/harness explorer.

No P0 was found. P1 risk is concentrated in permission boundaries, SQLite/dual persistence parity, provider request hangs, and observability durability.

---

### Task 1: Workspace Sandbox And Tool Permission Hardening

**Files:**
- Modify: `src/shared/locationResource.ts`
- Modify: `src/shared/agentWorkspace.ts`
- Modify: `src/shared/toolPermissions.ts`
- Modify: `src/main/agentToolExecutor.ts`
- Modify: `src/main/localFileOrganizer.ts`
- Modify: `src/main/nativeResearchTools.ts`
- Test: `src/shared/agentWorkspace.test.ts`
- Test: `src/shared/toolPermissions.test.ts`
- Test: `src/main/agentToolExecutor.test.ts`
- Test: `src/main/localFileOrganizer.test.ts`
- Test: `src/main/nativeResearchTools.test.ts`

**Interfaces:**
- Produces: a shared path-boundary primitive for realpath/no-symlink enforcement.
- Produces: per-tool execution validation that matches authorization decisions.
- Consumes: `AgentRunContext`, `AgentSandboxPolicy`, existing `ToolCallRequest`.

- [ ] **Step 1: Add failing symlink escape tests**

Cover `file_read`, `file_write`, `file_stat`, `file_list`, `file_search`, `code_search`, and `markdown_report_write` when a path lexically inside the workspace points through a symlink outside the workspace.

Run:

```bash
npm test -- src/main/agentToolExecutor.test.ts src/shared/toolPermissions.test.ts src/main/nativeResearchTools.test.ts
```

Expected before fix: at least one symlink read/write path is allowed or executed outside the workspace.

- [ ] **Step 2: Add failing crafted move preview tests**

Create a preview/transaction with `root` inside the workspace and `moves[].from` or `moves[].to` outside the workspace. Assert `file_apply_moves` and `file_rollback_moves` reject it before `rename()`.

Run:

```bash
npm test -- src/main/agentToolExecutor.test.ts src/main/localFileOrganizer.test.ts src/shared/toolPermissions.test.ts
```

Expected before fix: authorization checks only `root`, and shallow executor validation accepts crafted move objects.

- [ ] **Step 3: Add failing read-only and shell boundary tests**

Assert:

- `read_only` run context has no writable workspace root.
- `shell_exec` under `approved_commands` still applies `allowWorkspaceEscape === false`.
- `cat /etc/passwd`, `python /outside/script.py`, and `node /outside/script.js` are denied even if they match broad chat templates.
- `chrome_bookmarks_read` is denied or made non-writing in read-only runs.

Run:

```bash
npm test -- src/shared/agentWorkspace.test.ts src/shared/toolPermissions.test.ts src/main/chatService.test.ts src/main/agentToolExecutor.test.ts
```

Expected before fix: default `approved_commands` can pass outside paths, and `chrome_bookmarks_read` is modeled as read-only while writing artifacts.

- [ ] **Step 4: Implement one enforcement primitive**

Add a shared helper that normalizes the requested path, rejects symlinked parent segments unless explicitly allowed, resolves real targets when the path exists, and verifies the final target remains inside the requested access set: `readableRoots` for read tools and `writableRoots` for write tools.

Use that helper from authorization and from executor-side guard points so model-controlled tool args cannot diverge from authorization.

- [ ] **Step 5: Treat generated move plans as capabilities**

Either persist generated move previews by id and require apply/rollback to reference that id, or validate every `move.from`, `move.to`, transaction log path, and rollback target against the active run context immediately before rename.

- [ ] **Step 6: Re-run focused trust-boundary tests**

Run:

```bash
npm test -- src/shared/agentWorkspace.test.ts src/shared/toolPermissions.test.ts src/main/agentToolExecutor.test.ts src/main/localFileOrganizer.test.ts src/main/nativeResearchTools.test.ts src/main/chatService.test.ts
npm run harness:check
```

Expected: all pass.

---

### Task 2: SQLite, Migration, And JSONL Recovery Integrity

**Files:**
- Modify: `src/main/taskStore.ts`
- Modify: `src/main/toolAuditLog.ts`
- Modify: `src/main/storage/repositories/index.ts`
- Modify: `src/main/storage/repositories/sessionRepository.ts`
- Modify: `src/main/storage/repositories/runRepository.ts`
- Modify: `src/main/workspaceRunStore.ts`
- Modify: `src/main/agentRunStore.ts`
- Modify: `src/main/agentTrajectoryStore.ts`
- Modify: `src/main/agentGoalStore.ts`
- Modify: `scripts/migrate-to-sqlite.mjs`
- Modify: `scripts/rollback-sqlite-to-json.mjs`
- Test: `src/main/storage/storeProxy.test.ts`
- Test: `src/main/storage/migrateRoundTrip.test.ts`
- Test: `src/main/storage/repositories/repositories.test.ts`
- Test: `src/main/storage/repositories/runRepository.test.ts`
- Test: `src/main/chatSessionStore.test.ts`
- Test: `src/main/workspaceRunStore.test.ts`
- Test: `src/main/agentGoalStore.test.ts`

**Interfaces:**
- Produces: repository upsert APIs that preserve ids, timestamps, enabled status, reviewed-learning status, and JSON payloads.
- Produces: tolerant JSONL read helper reused by append-only stores.
- Consumes: existing JSON store contracts and SQLite repository contracts.

- [ ] **Step 1: Add disabled scheduled task dual-mode regression**

Assert a disabled daily task round-trips through dual mode with `enabled: false`, original timestamps, and `nextRunAt: null`.

Run:

```bash
npm test -- src/main/storage/storeProxy.test.ts
```

- [ ] **Step 2: Add tool audit identity parity regression**

Assert `await toolAuditLog.append(input)` returns exactly the event later returned by `toolAuditLog.list()`, including id and timestamp, under SQLite and dual backends.

Run:

```bash
npm test -- src/main/storage/storeProxy.test.ts src/main/toolAuditLog.test.ts
```

- [ ] **Step 3: Add reviewed learning migration regression**

Seed an accepted and a rejected learning candidate in JSON. Run migration. Assert SQLite preserves `id`, `status`, `createdAt`, `updatedAt`, claim, evidence, and suggested action.

Run:

```bash
npm test -- src/main/storage/migrateRoundTrip.test.ts
```

- [ ] **Step 4: Add tolerant JSONL recovery tests**

Seed files with one valid JSONL line, one malformed partial trailing line, and one later valid line where the format permits it. Assert readers return valid records and expose/quarantine corrupt line evidence instead of throwing.

Run:

```bash
npm test -- src/main/workspaceRunStore.test.ts src/main/agentRunStore.test.ts src/main/agentTrajectoryStore.test.ts src/main/agentGoalStore.test.ts
```

- [ ] **Step 5: Fix SQLite chat search parity**

Make `SessionRepository.searchMessages()` match JSON behavior for tokenized multi-term queries such as `报告 markdown`, and return the original message payload id rather than a generated row id.

Run:

```bash
npm test -- src/main/storage/repositories/repositories.test.ts src/main/chatSessionStore.test.ts
```

- [ ] **Step 6: Make rollback an actual inverse**

Extend rollback to export every table imported by migration: workspaces, tasks, tool results, learning candidates, eval candidates, promoted fixtures, artifacts, and any sidecar data currently imported by `migrate-to-sqlite.mjs`.

Run:

```bash
npm test -- src/main/storage/migrateRoundTrip.test.ts
npm run harness:check
```

Expected: all storage parity tests pass without relying on stale `dist-electron`.

---

### Task 3: Provider Timeout And Observability Durability

**Files:**
- Modify: `src/main/openAiCompatibleClient.ts`
- Modify: `src/main/providers/providerFactory.ts`
- Modify: `src/main/providers/anthropicProvider.ts`
- Modify: `src/main/providers/geminiProvider.ts`
- Modify: `src/main/agentRunStore.ts`
- Modify: `src/main/agentTrajectoryStore.ts`
- Modify: `src/main/storage/storeProxy.test.ts`
- Test: `src/main/providers/providers.test.ts`
- Test: `src/main/modelRetry.test.ts`

**Interfaces:**
- Produces: shared abortable timeout wrapper usable by all providers.
- Produces: explicit dual-write drain or synchronous durability guarantee for observability sidecars.

- [ ] **Step 1: Add native provider timeout tests**

Use a never-resolving fetch with a small timeout. Assert Anthropic and Gemini return timeout errors that flow through model retry/failure classification.

Run:

```bash
npm test -- src/main/providers/providers.test.ts src/main/modelRetry.test.ts
```

- [ ] **Step 2: Share the fetch timeout implementation**

Move or expose the existing timeout wrapper so OpenAI-compatible, Anthropic, and Gemini providers all use the same local timer plus external signal handling.

- [ ] **Step 3: Add dual-write durability tests**

Remove the arbitrary sleep pattern by asserting `await append()` either durably writes JSON shadow files or exposes a `flushShadowWrites()` method that the caller/test can await.

Run:

```bash
npm test -- src/main/storage/storeProxy.test.ts src/main/agentTrajectoryStore.test.ts src/main/agentRunStore.test.ts
npm run harness:check
```

---

### Task 4: Runtime Protocol, Workflow, And Replay-Grade Observability

**Files:**
- Modify: `src/main/agentLoop.ts`
- Modify: `src/main/chatService.ts`
- Modify: `src/main/toolObservationOffload.ts`
- Modify: `src/main/toolResultOffloadStore.ts`
- Modify: `src/main/workflow/workflowRuntime.ts`
- Modify: `src/main/skillExecutionService.ts`
- Modify: `src/main/agentEpisodeExporter.ts`
- Modify: `src/shared/workspaceRunLedger.ts`
- Modify: `src/shared/runGraph.ts`
- Test: `src/main/agentLoop.test.ts`
- Test: `src/main/chatService.test.ts`
- Test: `src/main/toolObservationOffload.test.ts`
- Test: `src/main/toolResultOffloadStore.test.ts`
- Test: `src/main/actors/actorRuntime.full.test.ts`
- Test: `src/main/agentEpisodeExporter.test.ts`
- Test: `src/shared/workspaceRunLedger.test.ts`
- Test: `src/shared/runGraph.test.ts`

**Interfaces:**
- Produces: provider-valid continuation histories for multi-tool assistant turns.
- Produces: run/session-scoped tool-result refs.
- Produces: closed workflow phases and cleared deadline timers.
- Produces: v2.5.0 follow-up completion for skill execution service and workspace-run export.

- [ ] **Step 1: Add multi-tool pause/resume regression**

Create a model response with two tool calls. Force a pause after the first result. Assert the saved/resumed message history either includes tool results for every assistant tool call or splits the batch so provider history stays valid.

Run:

```bash
npm test -- src/main/agentLoop.test.ts src/main/chatService.test.ts
```

- [ ] **Step 2: Scope tool-result refs**

Bind tool-result refs to run/session/workspace-run identity, and deny cross-run reads unless an explicit capability is present.

Run:

```bash
npm test -- src/main/toolResultOffloadStore.test.ts src/main/toolObservationOffload.test.ts src/shared/toolPermissions.test.ts src/main/agentToolExecutor.test.ts
```

- [ ] **Step 3: Preserve real tool call ids in workspace ledger**

Stop fabricating `toolCallId` from status event timestamps for ledger correlation. Carry the actual provider `toolCall.id` through `onToolCall`, `onToolResult`, status events, offload refs, and workspace-run events.

Run:

```bash
npm test -- src/main/chatService.test.ts src/shared/workspaceRunLedger.test.ts
```

- [ ] **Step 4: Fix workflow phase lifecycle and timer cleanup**

Mark previous phases done when a new phase starts, preserve phase metadata on creation, mark the last running phase terminal on completion/error, and clear deadline timers when the workflow finishes.

Run:

```bash
npm test -- src/main/actors/actorRuntime.full.test.ts
```

- [ ] **Step 5: Complete v2.5.0 observability follow-ups**

Implement `SkillExecutionService`, include session/request/tool-call ids in offloaded result refs, and export chat/workspace run ledgers in episode packages.

Run:

```bash
npm test -- src/shared/skillExecutionContract.test.ts src/main/chatService.test.ts src/main/agentEpisodeExporter.test.ts src/shared/runGraph.test.ts
npm run harness:check
```

---

### Task 5: Renderer, IPC, And User-Visible State Coherence

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/agentWorkspaceService.ts`
- Modify: `src/main/container.ts`
- Modify: `src/main/chatService.ts`
- Modify: `src/renderer/components/AgentChatPanel.tsx`
- Modify: `src/renderer/components/GoalStatusStrip.tsx`
- Modify: `src/renderer/components/RunsPanel.tsx`
- Test: `src/preload/index.test.ts`
- Test: `src/main/agentWorkspaceService.test.ts`
- Test: `src/main/chatService.test.ts`
- Test: `src/main/goalChatService.test.ts`
- Test: `src/renderer/materialDesign.test.ts`
- Test: `src/renderer/chatTaskActivity.test.ts`

**Interfaces:**
- Produces: explicit approval or trusted policy for git worktree creation.
- Produces: one terminal-goal cleanup path for progress sync, chat commands, and direct IPC.
- Produces: live Runs panel updates and correct empty session lists.

- [ ] **Step 1: Gate git worktree creation**

Require explicit user approval or a trusted repository policy before `createGitWorktreeAgentWorkspace` runs `git worktree add` on renderer-provided paths.

Run:

```bash
npm test -- src/main/agentWorkspaceService.test.ts src/preload/index.test.ts
```

- [ ] **Step 2: Normalize terminal goal clearing**

When goals enter `achieved`, `failed`, or `canceled`, clear active chat goal links through one shared main-process path. Remove conflicting re-attach behavior from progress sync.

Run:

```bash
npm test -- src/main/chatService.test.ts src/main/goalChatService.test.ts src/renderer/chatTaskActivity.test.ts
```

- [ ] **Step 3: Make Runs panel live**

Subscribe Runs panel to the event source that indicates new runs, active execution changes, and terminal status updates. Keep kernel events as graph detail input, not the only live-refresh source.

Run:

```bash
npm test -- src/renderer/materialDesign.test.ts
```

- [ ] **Step 4: Accept empty session lists**

Update chat session refresh logic so desktop `listChatSessions()` returning `[]` clears stale local state instead of preserving demo/fallback sessions.

Run:

```bash
npm test -- src/renderer/materialDesign.test.ts src/renderer/chatTaskActivityRestore.test.ts
npm run harness:check
```

---

### Task 6: Worker Isolation And Verification Efficiency

**Files:**
- Modify: `src/main/tools/toolWorkerOptions.ts`
- Modify: `src/main/tools/toolWorker.ts`
- Modify: `src/main/container.ts`
- Modify: `src/main/smokeMode.ts`
- Modify: `src/main/storage/migrateRoundTrip.test.ts`
- Modify: `package.json`
- Test: `src/main/tools/toolWorker.test.ts`
- Test: `src/main/container.test.ts`
- Test: `src/main/smokeMode.test.ts`
- Test: `src/shared/packageScripts.test.ts`

**Interfaces:**
- Produces: reachable subprocess worker mode with timeout health management.
- Produces: smoke readiness timeout that respects `BUILDING_AGENT_SMOKE_TIMEOUT_MS`.
- Produces: built-artifact scripts that avoid repeated clean builds while preserving safe existing wrappers.

- [ ] **Step 1: Wire subprocess worker mode through container**

Make `ZEROX_TOOL_WORKER=subprocess` produce a subprocess worker path in production container wiring. Keep in-process mode available for development and tests.

Run:

```bash
npm test -- src/main/container.test.ts src/main/tools/toolWorker.test.ts
```

- [ ] **Step 2: Kill or recycle timed-out worker children**

On request timeout, terminate the stuck subprocess or quarantine it and spawn a clean child for later requests.

Run:

```bash
npm test -- src/main/tools/toolWorker.test.ts
```

- [ ] **Step 3: Respect configured smoke timeout in renderer readiness**

Pass `BUILDING_AGENT_SMOKE_TIMEOUT_MS` through the injected renderer readiness poll instead of hard-coding 4000 ms.

Run:

```bash
npm test -- src/main/smokeMode.test.ts
```

- [ ] **Step 4: Fix clean-checkout migration coverage**

Refactor migration/rollback script logic behind TS-callable functions or build only the needed script artifacts inside the test so `npm test` does not silently skip migration coverage before `npm run build`.

Run:

```bash
npm test -- src/main/storage/migrateRoundTrip.test.ts
```

- [ ] **Step 5: Add built-artifact command variants**

Keep existing safe wrappers. Add explicit `eval:agent:built`, `eval:memory:built`, `harness:score:built`, `episode:export:built`, and optionally `smoke:prod:built` for post-build workflows.

Run:

```bash
npm test -- src/shared/packageScripts.test.ts
npm run verify
npm run smoke:prod
npm run harness:check
```

---

## Final Acceptance

- `npm test -- src/shared/agentWorkspace.test.ts src/shared/toolPermissions.test.ts src/main/agentToolExecutor.test.ts src/main/localFileOrganizer.test.ts src/main/nativeResearchTools.test.ts`
- `npm test -- src/main/storage/storeProxy.test.ts src/main/storage/migrateRoundTrip.test.ts src/main/storage/repositories/repositories.test.ts src/main/workspaceRunStore.test.ts src/main/agentGoalStore.test.ts`
- `npm test -- src/main/providers/providers.test.ts src/main/modelRetry.test.ts`
- `npm test -- src/main/agentLoop.test.ts src/main/chatService.test.ts src/main/toolObservationOffload.test.ts src/main/toolResultOffloadStore.test.ts src/main/actors/actorRuntime.full.test.ts`
- `npm test -- src/preload/index.test.ts src/main/agentWorkspaceService.test.ts src/renderer/materialDesign.test.ts src/renderer/chatTaskActivity.test.ts`
- `npm test -- src/main/container.test.ts src/main/tools/toolWorker.test.ts src/main/smokeMode.test.ts src/shared/packageScripts.test.ts`
- `npm run verify`
- `npm run smoke:prod`
- `npm run harness:check`

Update `.zerox/progress.md` after implementation with changed files and command evidence. If the implementation changes runtime/UI behavior, include production smoke evidence and note the expected better-sqlite3 JSON fallback when local ABI differs.
