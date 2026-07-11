# Autonomous Goal Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make goal mode run continuously with default-allow authorization, a non-bypassable Policy B forced-ask boundary, resumable transcript checkpoints, abort-safe cancellation, and a standards-compliant goal UI.

**Architecture:** The main process owns a coupled goal-mode/auto-approval state and classifies every approval request with a shared Policy B risk classifier. Goal runs persist a bounded real transcript checkpoint on the `Goal`, feed it into the next milestone attempt, and treat turn limits as internal continuation boundaries rather than user review gates. The renderer consumes authoritative mode state and presents only explicit business/high-risk reviews, with the long goal description in a scrollable body.

**Tech Stack:** TypeScript 6, Electron IPC/preload bridge, React 19, CSS design tokens, Vitest 4, JSON/SQLite-compatible goal persistence.

## Global Constraints

- Goal mode must force auto approval on while it is active.
- Every validated operation is auto-approved except the approved Policy B extremely high-risk categories.
- Workspace sandbox and `ToolAuthorizationService` checks remain authoritative and must not be bypassed.
- Forced asks default to a 60-second timeout, are abortable, and return a rejected tool result so the agent can continue safely.
- No internal model-turn, checkpoint, compaction, or milestone boundary may request user review.
- Existing Goal JSON without new checkpoint fields must remain readable without manual migration.
- Only explicit user-authored business checkpoints and Policy B forced asks may wait for user confirmation.
- UI colors, typography, spacing, focus, and scrolling must use existing shared tokens and meet WCAG AA.
- Run focused tests after each task; final verification includes `npm run harness:check`, `npm run verify`, and `npm run smoke:prod`.

---

## File structure

- `src/shared/extremeRiskPolicy.ts`: pure Policy B classifier and forced-ask category contract.
- `src/shared/extremeRiskPolicy.test.ts`: table-driven positive and negative classifier coverage.
- `src/shared/toolApproval.ts`: approval payloads expose `requiresConfirmation` and the risk category.
- `src/main/toolApprovalCoordinator.ts`: authoritative mode coupling, default allow, forced-ask timeout, pending flush, and cancellation.
- `src/main/toolAuthorizationService.ts`: propagates the active run signal to approval and preserves sandbox/rule denials.
- `src/preload/index.ts`, `src/main/main.ts`: IPC for setting goal mode in the authoritative coordinator.
- `src/shared/agentGoal.ts`: backward-compatible persistent runtime checkpoint contract.
- `src/main/agentGoalController.ts`: stores and reuses transcript checkpoints and removes turn-limit review routing.
- `src/main/goalRuntimeEngine.ts`: consumes prior transcript and makes internal run boundaries non-interactive.
- `src/main/agentGoalTranslator.ts`, `src/main/goalChatService.ts`: observable planning fallback with concise display descriptions.
- `src/renderer/components/AgentChatPanel.tsx`: coupled controls, truthful authorization copy, and visible forced asks.
- `src/renderer/components/GoalDetailDrawer.tsx`: short heading, expandable full instructions, and explicit-review-only actions.
- `src/renderer/styles/chat.css`, `src/renderer/styles/legacy.css`: canonical action token and scroll-safe drawer layout.
- `.zerox/feature_list.json`, `.zerox/progress.md`: one tracked unfinished feature and final evidence.

---

### Task 1: Register the feature and implement Policy B classification

**Files:**
- Create: `src/shared/extremeRiskPolicy.ts`
- Create: `src/shared/extremeRiskPolicy.test.ts`
- Modify: `src/shared/toolApproval.ts`
- Modify: `.zerox/feature_list.json`

**Interfaces:**
- Consumes: `ToolCallRequest` from `src/shared/toolPermissions.ts`.
- Produces: `classifyExtremeRisk(request: ToolCallRequest): ExtremeRiskAssessment` where `ExtremeRiskAssessment` contains `requiresConfirmation`, `category`, `reason`, and `affectedTargets`.

- [ ] **Step 1: Add one unfinished feature entry**

Append a `P42-v3.7.0-autonomous-goal-runtime` entry with `status: "in_progress"`, the files in this plan, the approved definition of done, and the focused/final verification commands. Update the root `updatedAt` timestamp.

- [ ] **Step 2: Write the failing classifier tests**

```ts
import { describe, expect, it } from "vitest";
import { classifyExtremeRisk } from "./extremeRiskPolicy";

describe("Policy B extreme-risk classification", () => {
  it.each([
    ["rm -rf /", "irrecoverable_data_loss"],
    ["git reset --hard HEAD~1", "irrecoverable_data_loss"],
    ["git push --force origin main", "irreversible_external_action"],
    ["sudo launchctl load agent.plist", "privilege_or_security_boundary"],
    ["npm publish", "irreversible_external_action"],
    ["kubectl delete namespace production", "irreversible_external_action"],
  ] as const)("forces confirmation for %s", (command, category) => {
    expect(classifyExtremeRisk({ toolName: "shell_exec", args: { command } }))
      .toMatchObject({ requiresConfirmation: true, category });
  });

  it.each(["npm test", "npm install", "git commit -m fix", "git push origin feature", "rg goal src"])(
    "allows ordinary shell work: %s",
    (command) => {
      expect(classifyExtremeRisk({ toolName: "shell_exec", args: { command } }))
        .toMatchObject({ requiresConfirmation: false, category: "none" });
    },
  );
});
```

- [ ] **Step 3: Run the test and verify RED**

Run: `npm test -- --run src/shared/extremeRiskPolicy.test.ts`

Expected: FAIL because `./extremeRiskPolicy` does not exist.

- [ ] **Step 4: Implement the pure classifier and approval contract**

```ts
export type ExtremeRiskCategory =
  | "none"
  | "irrecoverable_data_loss"
  | "privilege_or_security_boundary"
  | "secret_exfiltration"
  | "irreversible_external_action";

export type ExtremeRiskAssessment = {
  requiresConfirmation: boolean;
  category: ExtremeRiskCategory;
  reason: string;
  affectedTargets: string[];
};

export function classifyExtremeRisk(request: ToolCallRequest): ExtremeRiskAssessment {
  if (request.toolName !== "shell_exec") return safeAssessment();
  const command = String(request.args.command ?? "").trim();
  const assessment = classifyShellCommand(command);
  return assessment ?? safeAssessment();
}
```

Implement ordered, anchored command rules for destructive deletion/Git, privilege/security mutation, recognizable secret transmission, production publication/deletion, outbound messaging/publication, and financial commands. Ordinary writes, web access, installs, pipelines, commits, and non-forced pushes return `category: "none"`.

Extend `ToolApprovalRisk` with `category: ExtremeRiskCategory` and `requiresConfirmation: boolean`; make `classifyToolApprovalRisk` delegate to `classifyExtremeRisk` and report ordinary shell/file/web work as normal.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm test -- --run src/shared/extremeRiskPolicy.test.ts src/main/toolApprovalCoordinator.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .zerox/feature_list.json src/shared/extremeRiskPolicy.ts src/shared/extremeRiskPolicy.test.ts src/shared/toolApproval.ts
git commit -m "feat: classify policy b extreme risk"
```

### Task 2: Make auto approval default-allow, forced-ask, abortable, and bounded

**Files:**
- Modify: `src/main/toolApprovalCoordinator.ts`
- Modify: `src/main/toolApprovalCoordinator.test.ts`
- Modify: `src/main/toolAuthorizationService.ts`
- Modify: `src/main/toolAuthorizationService.test.ts`
- Modify: `src/main/container.ts`
- Modify: `src/main/container.test.ts`

**Interfaces:**
- Consumes: `classifyToolApprovalRisk()` from Task 1.
- Produces: `requestUserApproval(request, { signal? }): Promise<ToolUserApprovalResult>` and `ToolAuthorizationOptions.signal?: AbortSignal`.

- [ ] **Step 1: Write failing coordinator tests**

Add tests proving that auto mode approves `file_write`, `shell_exec: npm test`, and `web_fetch`; keeps `git push --force` pending; flushes existing non-forced pending requests when auto mode turns on; rejects a forced ask after a fake 60-second timer; and removes/rejects a pending request when its signal aborts.

```ts
const controller = new AbortController();
const approval = coordinator.requestUserApproval(createRequest("npm publish"), {
  signal: controller.signal,
});
controller.abort();
await expect(approval).resolves.toMatchObject({ approved: false, automatic: true });
expect(coordinator.getPendingCount()).toBe(0);
```

- [ ] **Step 2: Run coordinator tests and verify RED**

Run: `npm test -- --run src/main/toolApprovalCoordinator.test.ts`

Expected: FAIL because normal writes/shell/network are not auto-approved and approval has no signal.

- [ ] **Step 3: Implement coordinator behavior**

Replace the read-only whitelist with risk-based logic:

```ts
const assessment = classifyToolApprovalRisk(request);
if (effectiveAutoApprovalEnabled() && !assessment.requiresConfirmation) {
  return approveAutomatically(payload, `自动授权已放行 ${toolName}。`);
}
```

Store an abort-listener cleanup function on each pending entry. Use injected `approvalTimeoutMs ?? 60_000` for forced asks. A single `settlePending(id, result)` function must clear timeout, remove the abort listener, delete the entry, send one decision event, and resolve once. `setAutoApprovalEnabled(true)` settles every pending entry whose `risk.requiresConfirmation` is false.

- [ ] **Step 4: Propagate cancellation through authorization**

```ts
export type ToolAuthorizationOptions = {
  signal?: AbortSignal;
  runContext?: AgentRunContext;
  runtimeTask?: RuntimeToolAuthorizationTask;
  onApprovalRequested?: (request: ToolUserApprovalRequest) => Promise<void>;
  onApprovalResolved?: (result: ToolUserApprovalResult) => Promise<void>;
};
```

Change the injected approval signature to accept `{ signal?: AbortSignal }`, pass `authorizeOptions?.signal`, and call `throwIfAborted` before approval lifecycle callbacks and audit append. Keep malformed requests, explicit deny rules, and workspace sandbox escapes denied without bypass.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm test -- --run src/main/toolApprovalCoordinator.test.ts src/main/toolAuthorizationService.test.ts src/main/container.test.ts`

Expected: PASS with no pending approvals after abort or timeout.

- [ ] **Step 6: Commit**

```bash
git add src/main/toolApprovalCoordinator.ts src/main/toolApprovalCoordinator.test.ts src/main/toolAuthorizationService.ts src/main/toolAuthorizationService.test.ts src/main/container.ts src/main/container.test.ts
git commit -m "feat: make auto approval default allow"
```

### Task 3: Couple goal mode and auto approval in the authoritative main process

**Files:**
- Modify: `src/shared/toolApproval.ts`
- Modify: `src/main/toolApprovalCoordinator.ts`
- Modify: `src/main/main.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/components/AgentChatPanel.tsx`
- Modify: `src/main/toolApprovalCoordinator.test.ts`
- Modify: `src/renderer/materialDesign.test.ts`

**Interfaces:**
- Consumes: coordinator mode state from Task 2.
- Produces: `ToolApprovalModeState { autoApprovalEnabled, goalModeEnabled, autoApprovalLocked }` and `setToolGoalModeEnabled(enabled)` preload API.

- [ ] **Step 1: Write failing main-state and renderer-source tests**

```ts
coordinator.setGoalModeEnabled(true);
expect(coordinator.getAutoApprovalState()).toEqual({
  autoApprovalEnabled: true,
  goalModeEnabled: true,
  autoApprovalLocked: true,
});
coordinator.setAutoApprovalEnabled(false);
expect(coordinator.getAutoApprovalState().autoApprovalEnabled).toBe(true);
```

Assert the renderer calls `setToolGoalModeEnabled`, disables the standalone switch when `autoApprovalLocked`, and displays the Policy B explanation.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- --run src/main/toolApprovalCoordinator.test.ts src/renderer/materialDesign.test.ts`

Expected: FAIL because goal-mode state is renderer-local.

- [ ] **Step 3: Implement authoritative coupled state and IPC**

```ts
function getAutoApprovalState(): ToolApprovalModeState {
  return {
    autoApprovalEnabled: goalModeEnabled || standaloneAutoApprovalEnabled,
    goalModeEnabled,
    autoApprovalLocked: goalModeEnabled,
  };
}
```

Add `toolApproval:setGoalModeEnabled` in main/preload. Replace the renderer's direct `setGoalModeEnabled` toggle with an async handler that consumes returned authoritative state. Hydrate both switches from `getToolApprovalMode()` and `onToolApprovalModeChanged()`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- --run src/main/toolApprovalCoordinator.test.ts src/main/container.test.ts src/renderer/materialDesign.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/toolApproval.ts src/main/toolApprovalCoordinator.ts src/main/main.ts src/preload/index.ts src/renderer/components/AgentChatPanel.tsx src/main/toolApprovalCoordinator.test.ts src/renderer/materialDesign.test.ts
git commit -m "feat: couple goal mode with auto approval"
```

### Task 4: Persist real transcript checkpoints and remove the eight-turn review gate

**Files:**
- Modify: `src/shared/agentGoal.ts`
- Modify: `src/shared/agentGoal.test.ts`
- Modify: `src/main/goalRuntimeEngine.ts`
- Modify: `src/main/goalRuntimeEngine.test.ts`
- Modify: `src/main/agentGoalController.ts`
- Modify: `src/main/agentGoalController.test.ts`
- Modify: `src/main/agentGoalContext.ts`
- Modify: `src/main/agentGoalContext.test.ts`

**Interfaces:**
- Produces: `Goal.runtimeCheckpoint?: GoalRuntimeCheckpoint` and `GoalRuntimeEngine.runMilestone(..., { resumeMessages? })`.
- Consumes: `AgentLoopResult.messages` and the existing context compactor.

- [ ] **Step 1: Write failing compatibility and continuity tests**

Add tests proving old Goal JSON validates without `runtimeCheckpoint`; a run after an acceptance rejection receives the prior bounded assistant/tool transcript; a run can execute more than eight model turns without reaching `waiting_for_review`; and a context rebuild preserves tool-call/result pairs plus the exact-resume seam instruction.

```ts
expect(loopInputs[1]?.initialMessages).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ role: "tool", content: expect.stringContaining("result") }),
  ]),
);
expect(savedGoal.status).toBe("executing");
expect(progressEvents).not.toContainEqual(expect.objectContaining({ event: "review_requested" }));
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- --run src/shared/agentGoal.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalController.test.ts src/main/agentGoalContext.test.ts`

Expected: FAIL because runtime history is assembled from `[]` and turn-limit pauses route to review.

- [ ] **Step 3: Add the backward-compatible checkpoint type**

```ts
export type GoalRuntimeCheckpoint = {
  milestoneId: string;
  transcriptMessages: ChatMessageSnapshot[];
  nextAction: string;
  updatedAt: string;
};

export type ChatMessageSnapshot = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
};
```

Add `runtimeCheckpoint?` to `Goal`; validation treats it as optional and bounds transcript count/content size when saving a new checkpoint.

- [ ] **Step 4: Resume from real transcript and make turn boundaries internal**

Pass `goal.runtimeCheckpoint?.transcriptMessages` from the controller to `runMilestone`. In `goalRuntimeEngine`, call:

```ts
const assembled = options.goalContext.assemble(
  goal,
  runOptions?.resumeMessages ?? [],
  tokenBudget,
);
```

Set the per-segment turn budget from a named configurable `goalSegmentTurns` default rather than the literal eight, and set `pauseOnTurnLimit: false`. After each run, persist `toBoundedTranscriptMessages(runResult.messages, runResult.summary)` with a next-action seam. On acceptance rejection, keep the same logical execution and automatically re-enter the ready milestone. Remove the `pauseAfterRepair` branch that transitions turn-limit pauses to `waiting_for_review`.

- [ ] **Step 5: Add exact-resume seam instructions**

Add a final system anchor in `AgentGoalContext`:

```ts
{
  role: "system",
  content: "Resume directly from the latest real message/tool result. Do not recap, restart repository discovery, or ask the user to continue.",
}
```

Preserve complete recent tool-call/result pairs and result references when compacting; drop older large result bodies before their call metadata.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `npm test -- --run src/shared/agentGoal.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalController.test.ts src/main/agentGoalContext.test.ts`

Expected: PASS, including the run beyond eight turns and restart-from-checkpoint cases.

- [ ] **Step 7: Commit**

```bash
git add src/shared/agentGoal.ts src/shared/agentGoal.test.ts src/main/goalRuntimeEngine.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalController.ts src/main/agentGoalController.test.ts src/main/agentGoalContext.ts src/main/agentGoalContext.test.ts
git commit -m "feat: persist autonomous goal continuity"
```

### Task 5: Seal cancellation and expose planning degradation

**Files:**
- Modify: `src/main/goalChatService.ts`
- Modify: `src/main/goalChatService.test.ts`
- Modify: `src/main/agentGoalTranslator.ts`
- Modify: `src/main/agentGoalTranslator.test.ts`
- Modify: `src/main/goalRuntimeEngine.ts`
- Modify: `src/main/agentGoalController.ts`

**Interfaces:**
- Consumes: abortable approval from Task 2 and runtime checkpoint from Task 4.
- Produces: typed translator diagnostics and terminal-write fencing by signal/status.

- [ ] **Step 1: Write failing cancellation and planning tests**

Prove that cancellation during a pending forced ask settles the approval, records exactly one `goal_stopped`, emits no later `checkpoint_written`, and leaves the canonical goal canceled. Prove translator provider failure adds a warning and produces a concise normalized description/milestone instead of the full source prompt as a heading.

```ts
expect(events.filter((event) => event.type === "goal_stopped")).toHaveLength(1);
expect(events.findIndex((event) => event.type === "checkpoint_written"))
  .toBeLessThan(events.findIndex((event) => event.type === "goal_stopped"));
expect(draft.warnings).toContain("目标规划模型暂时不可用，已使用本地结构化降级方案。");
expect(draft.normalizedDescription.length).toBeLessThanOrEqual(96);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- --run src/main/goalChatService.test.ts src/main/agentGoalTranslator.test.ts src/main/agentGoalController.test.ts`

Expected: FAIL because translator errors are swallowed and approval cancellation is not fully fenced.

- [ ] **Step 3: Return typed translation outcomes**

Change `translateWithModel` to return `{ parsed, warning? }`; rethrow abort errors; log non-abort provider/parse failures through an injected optional diagnostic callback; derive a maximum-96-character title from the first meaningful instruction line; and use a concise fallback milestone such as `执行目标并产出可验收结果` while retaining `sourceMessage` as the full goal body.

- [ ] **Step 4: Fence post-terminal writes**

Pass the run signal into every trajectory append in `goalRuntimeEngine`. Before controller checkpoint/ledger/progress writes, check both `signal.aborted` and the canonical persisted status. Centralize this in the existing nonterminal publication path so a canceled execution generation cannot append later events.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm test -- --run src/main/toolApprovalCoordinator.test.ts src/main/goalChatService.test.ts src/main/agentGoalTranslator.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalController.test.ts`

Expected: PASS with no post-cancel events.

- [ ] **Step 6: Commit**

```bash
git add src/main/goalChatService.ts src/main/goalChatService.test.ts src/main/agentGoalTranslator.ts src/main/agentGoalTranslator.test.ts src/main/goalRuntimeEngine.ts src/main/agentGoalController.ts
git commit -m "fix: seal goal cancellation and planning fallback"
```

### Task 6: Strictly repair the goal-mode UI

**Files:**
- Modify: `src/renderer/components/AgentChatPanel.tsx`
- Modify: `src/renderer/components/GoalDetailDrawer.tsx`
- Modify: `src/renderer/components/GoalStatusStrip.tsx`
- Modify: `src/renderer/goalProgressViewModel.ts`
- Modify: `src/renderer/goalProgressViewModel.test.ts`
- Modify: `src/renderer/styles/chat.css`
- Modify: `src/renderer/styles/legacy.css`
- Modify: `src/renderer/materialDesign.test.ts`

**Interfaces:**
- Consumes: authoritative `autoApprovalLocked`, approval `requiresConfirmation`, and explicit review reasons from prior tasks.
- Produces: short display title utility, scroll-safe drawer, truthful states, and token-correct buttons.

- [ ] **Step 1: Write failing UI contract tests**

Assert that pending forced asks render even when auto approval is on; normal auto-approved actions do not render a prompt; the drawer heading uses a bounded derived title; the full description is inside the scrollable body; the auto-approval switch is disabled while locked; the copy says normal actions are auto-approved but Policy B actions still confirm; and CSS contains `var(--color-on-accent)` but not `--color-action-primary-text`.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- --run src/renderer/goalProgressViewModel.test.ts src/renderer/materialDesign.test.ts`

Expected: FAIL on hidden approval, full-prompt heading, unlocked switch, and invalid color token.

- [ ] **Step 3: Implement explicit review rendering**

Render `ToolApprovalCard` whenever `pendingToolApproval?.risk.requiresConfirmation` is true, independent of auto mode. Remove the `!autoApprovalEnabled` visibility guard. Disable the auto switch when `autoApprovalLocked` and replace the footer copy with:

```tsx
<span>
  目标模式已自动放行普通操作；数据破坏、提权、密钥外传、生产发布和对外发送仍需确认。
</span>
```

- [ ] **Step 4: Implement the scroll-safe detail drawer**

Derive a title by stripping Markdown headings/whitespace and clamping to 80 visible characters. Put only label/title/close in the header. Move the full `summary.description` into:

```tsx
<details className="goal-original-instructions">
  <summary>查看完整目标说明</summary>
  <div className="goal-original-instructions-content">{props.summary.description}</div>
</details>
```

Place this section inside `.goal-detail-drawer-body`. Show Continue/Adjust only for explicit business review metadata; internal checkpoint activity has no actions.

- [ ] **Step 5: Fix layout, tokens, and accessibility**

Use `grid-template-rows: auto minmax(0, 1fr)`, `min-height: 0`, `overflow-y: auto`, `overflow-wrap: anywhere`, and code-block horizontal scrolling. Replace the primary-action foreground with `var(--color-on-accent)`. Add visible `:focus-visible`, sticky/reachable close behavior, and a mobile/narrow-width rule that keeps the drawer within the viewport.

- [ ] **Step 6: Run focused UI tests and build**

Run: `npm test -- --run src/renderer/goalProgressViewModel.test.ts src/renderer/materialDesign.test.ts && npm run build`

Expected: PASS with no missing CSS token or TypeScript error.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/AgentChatPanel.tsx src/renderer/components/GoalDetailDrawer.tsx src/renderer/components/GoalStatusStrip.tsx src/renderer/goalProgressViewModel.ts src/renderer/goalProgressViewModel.test.ts src/renderer/styles/chat.css src/renderer/styles/legacy.css src/renderer/materialDesign.test.ts
git commit -m "fix: make goal mode ui explicit and scrollable"
```

### Task 7: Full verification, feature closure, and evidence

**Files:**
- Modify: `.zerox/feature_list.json`
- Modify: `.zerox/progress.md`

**Interfaces:**
- Consumes: all tasks above.
- Produces: completed feature metadata and reproducible verification evidence.

- [ ] **Step 1: Run the complete focused suite**

Run:

```bash
npm test -- --run src/shared/extremeRiskPolicy.test.ts src/main/toolApprovalCoordinator.test.ts src/main/toolAuthorizationService.test.ts src/shared/agentGoal.test.ts src/main/goalRuntimeEngine.test.ts src/main/agentGoalController.test.ts src/main/agentGoalContext.test.ts src/main/goalChatService.test.ts src/main/agentGoalTranslator.test.ts src/main/container.test.ts src/renderer/goalProgressViewModel.test.ts src/renderer/materialDesign.test.ts
```

Expected: all tests PASS.

- [ ] **Step 2: Run required project verification**

Run:

```bash
npm run harness:check
npm run verify
npm run smoke:prod
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Record evidence and close the feature**

Append a dated `.zerox/progress.md` entry listing changed files, Policy B behavior, continuous-run evidence, cancellation evidence, UI fixes, and exact command results. Change only `P42-v3.7.0-autonomous-goal-runtime` from `in_progress` to `done` and update the feature-list timestamp.

- [ ] **Step 4: Re-run harness after metadata update**

Run: `npm run harness:check`

Expected: PASS with the feature marked done and progress evidence present.

- [ ] **Step 5: Commit final evidence**

```bash
git add .zerox/feature_list.json .zerox/progress.md
git commit -m "chore: record autonomous goal runtime evidence"
```

---

## Self-review

- Spec coverage: Policy B authorization, main-owned mode coupling, continuous execution, persisted transcript continuity, cancellation fencing, planning fallback, strict drawer/status UI, observability evidence, migration compatibility, and required verification are each mapped to a task.
- Placeholder scan: the plan contains no deferred implementation markers; every code-changing task names exact files, signatures, commands, and expected outcomes.
- Type consistency: `ExtremeRiskAssessment`, `ToolApprovalModeState`, `ToolAuthorizationOptions.signal`, `GoalRuntimeCheckpoint`, and `resumeMessages` are introduced before downstream consumption and retain the same names in every task.
