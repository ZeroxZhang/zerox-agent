# Chat Session Goal Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Goal Mode as a Chat Session mode, remove the standalone Goals page from primary navigation, and move low-frequency technical surfaces under Settings.

**Architecture:** Keep the existing local-first Goal domain model, store, ledger, planner, acceptance engine, and controller. Add chat-session linkage fields and make Chat the primary goal surface through intent routing, a Goal Contract Bar, session badges, inline review gates, and a goal detail drawer. Collapse navigation so Chat, Overview, Runs, Tasks, and Settings are top-level; Settings renders Tools, Memory, Learning, and Evals as secondary sections.

**Tech Stack:** TypeScript, Electron IPC/preload, React, Vitest, local JSON stores, existing agent runtime/controller services, CSS modules in `src/renderer/styles.css`.

---

## File Structure

- Modify `src/shared/chat.ts`
  - Add `activeGoalId`, `goalIds`, `ChatSessionGoalSummary`, and goal linkage on messages/list items/results.
- Modify `src/main/chatSessionStore.ts`
  - Persist and normalize goal linkage fields.
  - Add focused methods to attach and clear active goals.
- Modify `src/main/chatSessionStore.test.ts`
  - Cover persistence, normalization, active goal summaries, and terminal clearing.
- Modify `src/shared/agentGoal.ts`
  - Add optional `chatSessionId` and `originMessageId` for backward-compatible migration.
- Modify `src/main/agentGoalStore.ts`
  - Normalize legacy goals and provide migration helpers where needed.
- Modify `src/main/agentGoalStore.test.ts`
  - Cover legacy normalization and session linkage preservation.
- Modify `src/shared/navigation.ts`
  - Remove top-level `goals`, `tools`, `memory`, `learning`, and `evals`.
  - Add secondary settings section metadata and `#goals` redirect to Chat.
- Modify `src/shared/materialNavigation.ts`
  - Keep icons only for top-level navigation sections.
- Modify `src/shared/navigation.test.ts` and `src/shared/materialNavigation.test.ts`
  - Cover new top-level order and Settings secondary sections.
- Modify `src/renderer/App.tsx`
  - Remove standalone `GoalPanel` route.
  - Route Settings secondary sections to existing panel components.
- Modify `src/renderer/components/AgentChatPanel.tsx`
  - Load session goal summaries.
  - Render `GoalContractBar`, session badges, inline review gate, and goal detail drawer trigger.
- Create `src/renderer/components/GoalContractBar.tsx`
  - Render compact active-goal status, budget, current milestone, and actions.
- Create `src/renderer/components/GoalDetailDrawer.tsx`
  - Reuse old `GoalPanel` detail concepts as an on-demand drawer.
- Modify or delete `src/renderer/components/GoalPanel.tsx`
  - Do not keep it as a standalone page.
- Modify `src/renderer/components/OverviewPanel.tsx`
  - Waiting-review items navigate to Chat instead of Goals.
- Modify `src/main/chatService.ts`
  - Add goal intent routing before task/run routing.
  - Create/update/continue/cancel/review goals in the current session.
- Modify `src/main/main.ts`
  - Wire goal operations to `AgentGoalController`.
  - Ensure controller runtime runs include `goalId`, `chatSessionId`, and `milestoneId`.
- Modify `src/preload/index.ts`
  - Expose explicit chat-goal operations used by the Chat UI while keeping existing goal methods backward compatible.
- Modify `src/renderer/materialDesign.test.ts`
  - Replace standalone GoalPanel assertions with chat-native goal UI assertions.
- Modify `src/shared/readme.test.ts`, `README.md`, and `docs/architecture/agent-goal-mode.md`
  - Document session-native Goal Mode and simplified navigation.
- Modify `.zerox/feature_list.json` and `.zerox/progress.md`
  - Record the P6 session-native Goal Mode iteration and command evidence.

## Task 1: Session Goal Linkage Model

**Files:**
- Modify: `src/shared/chat.ts`
- Modify: `src/main/chatSessionStore.ts`
- Test: `src/main/chatSessionStore.test.ts`

- [ ] **Step 1: Write failing tests for session goal persistence**

Add tests to `src/main/chatSessionStore.test.ts`:

```ts
it("persists active and historical goal ids on chat sessions", async () => {
  const store = createChatSessionStore({
    configDir,
    createId: createSequentialId("chat"),
    now: createSteppedClock("2026-06-12T08:00:00.000Z"),
  });

  const first = await store.appendMessage({
    role: "user",
    content: "把这轮设为目标：发布 v1.8.0",
  });
  const linked = await store.attachGoal(first.session.id, {
    id: "goal_release",
    status: "executing",
    description: "发布 v1.8.0",
  });

  expect(linked.activeGoalId).toBe("goal_release");
  expect(linked.goalIds).toEqual(["goal_release"]);
  await expect(store.list()).resolves.toEqual([
    expect.objectContaining({
      id: first.session.id,
      activeGoal: {
        id: "goal_release",
        description: "发布 v1.8.0",
        status: "executing",
      },
    }),
  ]);
});

it("clears the active goal while preserving goal history", async () => {
  const store = createChatSessionStore({
    configDir,
    createId: createSequentialId("chat"),
    now: createSteppedClock("2026-06-12T08:00:00.000Z"),
  });
  const first = await store.appendMessage({
    role: "user",
    content: "目标：完成 release",
  });
  await store.attachGoal(first.session.id, {
    id: "goal_release",
    status: "executing",
    description: "完成 release",
  });

  const cleared = await store.clearActiveGoal(first.session.id, "goal_release");

  expect(cleared?.activeGoalId).toBeUndefined();
  expect(cleared?.goalIds).toEqual(["goal_release"]);
});
```

- [ ] **Step 2: Run the tests to verify RED**

Run:

```bash
npm test -- src/main/chatSessionStore.test.ts
```

Expected: FAIL because `attachGoal` and `clearActiveGoal` do not exist.

- [ ] **Step 3: Add shared chat types**

In `src/shared/chat.ts`, add:

```ts
import type { GoalStatus } from "./agentGoal";

export type ChatSessionGoalSummary = {
  id: string;
  description: string;
  status: GoalStatus;
};
```

Then extend:

```ts
export type ChatMessageRecord = ChatHistoryMessage & {
  id: string;
  createdAt: string;
  relatedMemoryIds?: string[];
  executedRunId?: string;
  goalId?: string;
  goalEventRef?: string;
};

export type ChatSessionRecord = {
  id: string;
  title: string;
  summary: string;
  messages: ChatMessageRecord[];
  activeGoalId?: string;
  goalIds?: string[];
  goalSummaries?: ChatSessionGoalSummary[];
  createdAt: string;
  updatedAt: string;
};

export type ChatSessionListItem = {
  id: string;
  title: string;
  summary: string;
  messageCount: number;
  activeGoal?: ChatSessionGoalSummary;
  updatedAt: string;
};
```

- [ ] **Step 4: Implement store methods**

In `src/main/chatSessionStore.ts`, extend `ChatSessionStore`:

```ts
attachGoal(
  sessionId: string,
  goal: ChatSessionGoalSummary,
): Promise<ChatSessionRecord>;
clearActiveGoal(
  sessionId: string,
  goalId: string,
): Promise<ChatSessionRecord | null>;
```

Implement by reading `chat-sessions.json`, updating the matching session, keeping `goalIds` unique, replacing the summary for the same goal id, and writing back.

- [ ] **Step 5: Normalize legacy sessions**

In `normalizeStoredSession`, preserve optional fields:

```ts
const goalSummaries = Array.isArray(session.goalSummaries)
  ? session.goalSummaries.map(normalizeGoalSummary)
  : [];
const activeGoalId = session.activeGoalId ? String(session.activeGoalId) : undefined;
```

Return `activeGoalId`, `goalIds`, and `goalSummaries` only when present/non-empty.

- [ ] **Step 6: Run GREEN verification**

Run:

```bash
npm test -- src/main/chatSessionStore.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/chat.ts src/main/chatSessionStore.ts src/main/chatSessionStore.test.ts
git commit -m "feat: link goals to chat sessions"
```

## Task 2: Goal Store Session Linkage And Legacy Normalization

**Files:**
- Modify: `src/shared/agentGoal.ts`
- Modify: `src/main/agentGoalStore.ts`
- Test: `src/main/agentGoalStore.test.ts`

- [ ] **Step 1: Write failing goal store tests**

Add to `src/main/agentGoalStore.test.ts`:

```ts
it("preserves chat session linkage on stored goals", async () => {
  const store = createAgentGoalStore({ configDir });
  const saved = await store.save({
    ...createGoal(),
    chatSessionId: "chat_release",
    originMessageId: "msg_goal",
  });

  await expect(store.get(saved.id)).resolves.toMatchObject({
    chatSessionId: "chat_release",
    originMessageId: "msg_goal",
  });
});

it("normalizes legacy goals without chat linkage", async () => {
  const store = createAgentGoalStore({ configDir });
  await store.save(createGoal({ id: "goal_legacy" }));

  const loaded = await store.get("goal_legacy");

  expect(loaded).toMatchObject({ id: "goal_legacy" });
  expect(loaded?.chatSessionId).toBeUndefined();
});
```

- [ ] **Step 2: Run RED verification**

```bash
npm test -- src/main/agentGoalStore.test.ts
```

Expected: FAIL until `Goal` supports linkage or normalization handles it.

- [ ] **Step 3: Add optional linkage fields**

In `src/shared/agentGoal.ts`, extend `Goal`:

```ts
chatSessionId?: string;
originMessageId?: string;
```

- [ ] **Step 4: Normalize loaded goals**

In `src/main/agentGoalStore.ts`, add `normalizeGoal` and use it in `readGoal`:

```ts
function normalizeGoal(goal: Goal): Goal {
  return {
    ...goal,
    ...(goal.chatSessionId ? { chatSessionId: String(goal.chatSessionId) } : {}),
    ...(goal.originMessageId ? { originMessageId: String(goal.originMessageId) } : {}),
  };
}
```

- [ ] **Step 5: Run GREEN verification**

```bash
npm test -- src/main/agentGoalStore.test.ts src/shared/agentGoal.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/agentGoal.ts src/main/agentGoalStore.ts src/main/agentGoalStore.test.ts
git commit -m "feat: preserve goal chat session linkage"
```

## Task 3: Simplify Top-Level Navigation And Add Settings Sections

**Files:**
- Modify: `src/shared/navigation.ts`
- Modify: `src/shared/materialNavigation.ts`
- Test: `src/shared/navigation.test.ts`
- Test: `src/shared/materialNavigation.test.ts`

- [ ] **Step 1: Write failing navigation tests**

Update `src/shared/navigation.test.ts` expectations:

```ts
expect(getNavigationSections().map((section) => section.id)).toEqual([
  "chat",
  "overview",
  "runs",
  "scheduled-tasks",
  "settings",
]);

expect(getStartupNavigationSection("#goals").id).toBe("chat");
expect(getStartupNavigationSection("#tools").id).toBe("settings");
expect(getSettingsNavigationSections().map((section) => section.id)).toEqual([
  "model-settings",
  "tools",
  "memory",
  "learning",
  "evals",
]);
expect(getDefaultSettingsNavigationSection().id).toBe("model-settings");
```

- [ ] **Step 2: Run RED verification**

```bash
npm test -- src/shared/navigation.test.ts src/shared/materialNavigation.test.ts
```

Expected: FAIL because Goals and technical sections are still top-level.

- [ ] **Step 3: Add settings section types**

In `src/shared/navigation.ts`:

```ts
export type NavigationSectionId =
  | "chat"
  | "overview"
  | "runs"
  | "scheduled-tasks"
  | "settings";

export type SettingsNavigationSectionId =
  | "model-settings"
  | "tools"
  | "memory"
  | "learning"
  | "evals";
```

Add `settingsNavigationSections` and exports:

```ts
export function getSettingsNavigationSections(): SettingsNavigationSection[] {
  return settingsNavigationSections;
}

export function getDefaultSettingsNavigationSection(): SettingsNavigationSection {
  return settingsNavigationSections[0];
}
```

- [ ] **Step 4: Redirect legacy hashes**

Implement `getStartupNavigationSection` so `#goals` returns Chat and `#tools`, `#memory`, `#learning`, `#evals` return Settings.

- [ ] **Step 5: Update material icons**

Remove icons for no-longer-top-level ids from `materialNavigationIcons`.

- [ ] **Step 6: Run GREEN verification**

```bash
npm test -- src/shared/navigation.test.ts src/shared/materialNavigation.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/navigation.ts src/shared/navigation.test.ts src/shared/materialNavigation.ts src/shared/materialNavigation.test.ts
git commit -m "feat: simplify primary navigation"
```

## Task 4: Render Settings Secondary Sections

**Files:**
- Modify: `src/renderer/App.tsx`
- Test: `src/renderer/materialDesign.test.ts`

- [ ] **Step 1: Write failing renderer structure tests**

Replace tests that expect top-level Tools/Memory/Learning/Evals with:

```ts
it("renders technical surfaces as collapsed Settings secondary sections", () => {
  expect(appSource).toContain("SettingsSectionShell");
  expect(appSource).toContain("getSettingsNavigationSections");
  expect(appSource).toContain("ToolsPanel");
  expect(appSource).toContain("MemoryPanel");
  expect(appSource).toContain("LearningReviewPanel");
  expect(appSource).toContain("EvalReviewPanel");
  expect(appSource).not.toContain("activeSection.id === \"tools\"");
  expect(appSource).not.toContain("activeSection.id === \"memory\"");
  expect(appSource).not.toContain("activeSection.id === \"learning\"");
  expect(appSource).not.toContain("activeSection.id === \"evals\"");
});
```

- [ ] **Step 2: Run RED verification**

```bash
npm test -- src/renderer/materialDesign.test.ts
```

Expected: FAIL because App still renders those panels as top-level sections.

- [ ] **Step 3: Implement SettingsSectionShell**

In `src/renderer/App.tsx`, add Settings local state:

```ts
const [activeSettingsSectionId, setActiveSettingsSectionId] =
  useState<SettingsNavigationSectionId>("model-settings");
```

Render a Settings shell when `activeSection.id === "settings"` with expandable secondary buttons from `getSettingsNavigationSections()`.

- [ ] **Step 4: Move panels into Settings shell**

Inside the Settings shell, render:

```tsx
{activeSettingsSectionId === "model-settings" ? <ModelSettingsPanel /> : null}
{activeSettingsSectionId === "tools" ? <ToolsPanel /> : null}
{activeSettingsSectionId === "memory" ? <MemoryPanel /> : null}
{activeSettingsSectionId === "learning" ? <LearningReviewPanel /> : null}
{activeSettingsSectionId === "evals" ? <EvalReviewPanel /> : null}
```

- [ ] **Step 5: Run GREEN verification**

```bash
npm test -- src/renderer/materialDesign.test.ts src/shared/navigation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.tsx src/renderer/materialDesign.test.ts
git commit -m "feat: nest technical panels under settings"
```

## Task 5: Chat-Native Goal UI

**Files:**
- Create: `src/renderer/components/GoalContractBar.tsx`
- Create: `src/renderer/components/GoalDetailDrawer.tsx`
- Modify: `src/renderer/components/AgentChatPanel.tsx`
- Modify: `src/renderer/styles.css`
- Test: `src/renderer/materialDesign.test.ts`

- [ ] **Step 1: Write failing UI assertions**

Update `src/renderer/materialDesign.test.ts`:

```ts
it("surfaces session-native Goal Mode inside Chat", () => {
  expect(chatPanelSource).toContain("GoalContractBar");
  expect(chatPanelSource).toContain("activeGoal");
  expect(chatPanelSource).toContain("goal-session-badge");
  expect(chatPanelSource).toContain("goal-review-gate-card");
  expect(chatPanelSource).toContain("GoalDetailDrawer");
  expect(appSource).not.toContain("GoalPanel");
  expect(styles).toContain(".goal-contract-bar");
  expect(styles).toContain(".goal-session-badge");
  expect(styles).toContain(".goal-detail-drawer");
});
```

- [ ] **Step 2: Run RED verification**

```bash
npm test -- src/renderer/materialDesign.test.ts
```

Expected: FAIL because chat-native goal UI components do not exist.

- [ ] **Step 3: Create `GoalContractBar`**

Render props:

```ts
type GoalContractBarProps = {
  goal: Goal;
  onViewProgress: () => void;
  onModify: () => void;
  onPause: () => void;
  onEnd: () => void;
};
```

Use compact text and stable classes: `goal-contract-bar`, `goal-contract-budget`, `goal-contract-actions`.

- [ ] **Step 4: Create `GoalDetailDrawer`**

Render goal description, status, success criteria, budget usage, milestone tree, stop reason, and close button. Keep it hidden unless opened by Chat.

- [ ] **Step 5: Wire ChatPanel display**

In `AgentChatPanel`, load active goal from the selected session list item summary and `window.buildingAgent.getGoal(activeGoal.id)` when desktop APIs exist. Render `GoalContractBar` above the message list and goal badges in session rail items.

- [ ] **Step 6: Render inline review gate**

When active goal status is `waiting_for_review`, render `goal-review-gate-card` inside the composer activity area or just above the composer with Continue, Modify plan, and Terminate buttons.

- [ ] **Step 7: Run GREEN verification**

```bash
npm test -- src/renderer/materialDesign.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/GoalContractBar.tsx src/renderer/components/GoalDetailDrawer.tsx src/renderer/components/AgentChatPanel.tsx src/renderer/styles.css src/renderer/materialDesign.test.ts
git commit -m "feat: show goals inside chat sessions"
```

## Task 6: Chat Goal Intent Routing

**Files:**
- Modify: `src/shared/chat.ts`
- Modify: `src/main/chatService.ts`
- Test: `src/main/chatService.test.ts`

- [ ] **Step 1: Write failing chat service tests**

Add tests:

```ts
it("creates a session goal from an explicit goal-setting message", async () => {
  const chatMessages: AppendChatMessageInput[] = [];
  const goalCreates: unknown[] = [];
  const service = createChatService({
    chatClient: createNoopChatClient(),
    getModelProfile: createCompleteProfile,
    memoryStore: createMemoryStore(),
    chatSessionStore: createChatSessionStore(chatMessages),
    goalService: createGoalService({ goalCreates }),
    createId: () => "chat_goal",
    now: () => new Date("2026-06-12T08:00:00.000Z"),
  });

  const result = await service.sendMessage({
    message: "把这轮设为目标：发布 v1.8.0，直到 GitHub Release 完成才算结束",
  });

  expect(result).toMatchObject({
    ok: true,
    activeGoal: {
      id: "goal_release",
      description: "发布 v1.8.0，直到 GitHub Release 完成才算结束",
      status: "planning",
    },
  });
  expect(goalCreates).toHaveLength(1);
});

it("continues the active session goal before ordinary chat continuation", async () => {
  const resumes: string[] = [];
  const service = createChatService({
    chatClient: createNoopChatClient(),
    getModelProfile: createCompleteProfile,
    memoryStore: createMemoryStore(),
    chatSessionStore: createChatSessionStore([], {
      activeGoal: { id: "goal_release", description: "发布", status: "executing" },
    }),
    goalService: createGoalService({ resumes }),
    createId: () => "chat_goal",
    now: () => new Date("2026-06-12T08:00:00.000Z"),
  });

  await service.sendMessage({ sessionId: "persisted_session", message: "继续" });

  expect(resumes).toEqual(["goal_release"]);
});
```

- [ ] **Step 2: Run RED verification**

```bash
npm test -- src/main/chatService.test.ts
```

Expected: FAIL because `goalService` and `activeGoal` result support do not exist.

- [ ] **Step 3: Add chat goal service dependency**

In `createChatService` options:

```ts
goalService?: {
  createFromChat(input: {
    sessionId: string;
    originMessageId: string | null;
    description: string;
  }): Promise<ChatSessionGoalSummary>;
  resume(goalId: string, options?: { signal?: AbortSignal }): Promise<ChatSessionGoalSummary>;
  cancel(goalId: string): Promise<ChatSessionGoalSummary>;
  resolveReview(goalId: string, decision: GoalReviewDecision): Promise<ChatSessionGoalSummary>;
};
```

- [ ] **Step 4: Add conservative goal intent helpers**

Create local helpers in `chatService.ts`:

```ts
function detectGoalIntent(message: string): GoalIntentRoute {
  const compact = message.trim();
  if (/^(把这轮设为目标|这轮目标是|接下来目标是|目标[:：])/i.test(compact)) {
    return { kind: "set_goal", description: extractGoalDescription(compact) };
  }
  if (/^(继续|接着|继续这个目标|接着这个目标)/.test(compact)) {
    return { kind: "continue_goal" };
  }
  if (/^(取消这个目标|结束目标|终止目标)/.test(compact)) {
    return { kind: "cancel_goal" };
  }
  return { kind: "none" };
}
```

- [ ] **Step 5: Route goal intents before normal task handling**

After appending the user message and before `classifyAgentIntent`, check active session goal and explicit goal intent. Return an assistant reply documenting the goal action and include `activeGoal` in `SendChatMessageResult`.

- [ ] **Step 6: Run GREEN verification**

```bash
npm test -- src/main/chatService.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/chat.ts src/main/chatService.ts src/main/chatService.test.ts
git commit -m "feat: route goal intents through chat"
```

## Task 7: Main IPC And Controller Integration

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/preload/index.ts`
- Create: `src/main/goalChatService.ts`
- Test: `src/main/goalChatService.test.ts`

- [ ] **Step 1: Write failing controller-bridge test**

Add a focused test around a new factory helper in `src/main/goalChatService.ts`:

```ts
it("uses the goal controller when resuming a chat goal", async () => {
  const resumed: string[] = [];
  const service = createGoalChatService({
    controller: {
      async resume(goalId) {
        resumed.push(goalId);
        return createGoal({ id: goalId, status: "achieved" });
      },
      async start(goalId) {
        return createGoal({ id: goalId, status: "executing" });
      },
      async resolveReview(goalId) {
        return createGoal({ id: goalId, status: "executing" });
      },
    },
    goalStore,
    chatSessionStore,
  });

  await service.resume("goal_release");

  expect(resumed).toEqual(["goal_release"]);
});
```

- [ ] **Step 2: Run RED verification**

```bash
npm test -- src/main/goalChatService.test.ts src/main/agentGoalController.test.ts
```

Expected: FAIL because `goalChatService` does not exist.

- [ ] **Step 3: Create goal chat service**

Create `src/main/goalChatService.ts` to bridge chat goal operations to `AgentGoalController`, `AgentGoalStore`, and `ChatSessionStore`.

- [ ] **Step 4: Wire `main.ts`**

Replace status-only IPC:

```ts
ipcMain.handle("goal:start", async (_event, goalId: string) =>
  getGoalChatService().start(goalId),
);
ipcMain.handle("goal:resume", async (_event, goalId: string) =>
  getGoalChatService().resume(goalId),
);
ipcMain.handle("goal:resolveReview", async (_event, goalId, decision) =>
  getGoalChatService().resolveReview(goalId, decision),
);
```

- [ ] **Step 5: Implement controller runtime engine wiring**

Provide a `GoalRuntimeEngine` implementation that dispatches milestones through existing recoverable runtime/task execution path and includes goal/session/milestone metadata.

- [ ] **Step 6: Run GREEN verification**

```bash
npm test -- src/main/goalChatService.test.ts src/main/agentGoalController.test.ts src/main/chatService.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/main.ts src/main/goalChatService.ts src/main/goalChatService.test.ts src/preload/index.ts src/main/chatService.test.ts
git commit -m "feat: run goals through chat controller service"
```

## Task 8: Remove Standalone Goal Page And Update Overview

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/OverviewPanel.tsx`
- Modify: `src/renderer/components/GoalPanel.tsx` or delete after drawer replacement
- Test: `src/renderer/materialDesign.test.ts`

- [ ] **Step 1: Write failing tests**

Update material tests:

```ts
expect(appSource).not.toContain("activeSection.id === \"goals\"");
expect(appSource).not.toContain("<GoalPanel");
expect(overviewPanelSource).toContain("target: \"chat\"");
expect(overviewPanelSource).not.toContain("target: \"goals\"");
```

- [ ] **Step 2: Run RED verification**

```bash
npm test -- src/renderer/materialDesign.test.ts
```

Expected: FAIL because old goal route still exists.

- [ ] **Step 3: Remove standalone route**

Delete `GoalPanel` import and route branch from `App.tsx`. Keep reusable detail code only in `GoalDetailDrawer`.

- [ ] **Step 4: Update Overview attention targets**

Change waiting-review attention target from `goals` to `chat`.

- [ ] **Step 5: Run GREEN verification**

```bash
npm test -- src/renderer/materialDesign.test.ts src/shared/navigation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.tsx src/renderer/components/OverviewPanel.tsx src/renderer/components/GoalPanel.tsx src/renderer/materialDesign.test.ts
git commit -m "feat: remove standalone goals page"
```

## Task 9: Docs, Feature List, Progress, And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/agent-goal-mode.md`
- Modify: `src/shared/readme.test.ts`
- Modify: `.zerox/feature_list.json`
- Modify: `.zerox/progress.md`

- [ ] **Step 1: Write failing README/docs tests**

Update `src/shared/readme.test.ts` so it expects:

```ts
expect(readme).toContain("session-native Goal Mode");
expect(readme).toContain("Chat Session mode");
expect(readme).not.toContain("Goals UI");
expect(architecture).toContain("Chat Session Goal Mode");
```

- [ ] **Step 2: Run RED verification**

```bash
npm test -- src/shared/readme.test.ts
```

Expected: FAIL because docs still describe standalone Goals UI.

- [ ] **Step 3: Update README and architecture docs**

Replace standalone Goals UI language with session-native Goal Mode language. Document Settings secondary sections and old `#goals` redirect behavior.

- [ ] **Step 4: Add P6 feature entry**

Add one new `.zerox/feature_list.json` item:

```json
{
  "id": "P6-chat-session-goal-mode",
  "priority": 26,
  "status": "done",
  "title": "Chat Session native Goal Mode",
  "definitionOfDone": [
    "Goal Mode is created and resumed from chat sessions",
    "Top-level navigation removes standalone Goals and nests technical surfaces under Settings",
    "Review gates render inline in Chat and call the goal controller",
    "Existing standalone goals are recoverable through migrated chat sessions"
  ],
  "verification": [
    "npm test -- src/main/chatService.test.ts src/main/chatSessionStore.test.ts src/main/agentGoalController.test.ts src/shared/navigation.test.ts src/renderer/materialDesign.test.ts src/shared/readme.test.ts",
    "npm run verify",
    "npm run harness:check",
    "npm run smoke:prod"
  ]
}
```

- [ ] **Step 5: Record progress evidence**

Append a `.zerox/progress.md` section listing changed files and command evidence.

- [ ] **Step 6: Run focused verification**

```bash
npm test -- src/main/chatService.test.ts src/main/chatSessionStore.test.ts src/main/agentGoalController.test.ts src/shared/navigation.test.ts src/renderer/materialDesign.test.ts src/shared/readme.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run full verification**

```bash
npm run verify
npm run harness:check
npm run smoke:prod
git diff --check
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add README.md docs/architecture/agent-goal-mode.md src/shared/readme.test.ts .zerox/feature_list.json .zerox/progress.md
git commit -m "docs: document session-native goal mode"
```

## Plan Self-Review

- Spec coverage:
  - Session-native data model: Tasks 1 and 2.
  - Goal intent routing: Task 6.
  - Chat UI, contract bar, session badges, review gate, drawer: Task 5.
  - Controller integration: Task 7.
  - Navigation simplification and Settings secondary sections: Tasks 3 and 4.
  - Remove standalone Goals page and Overview redirect: Task 8.
  - Migration/recovery and documentation: Tasks 2, 7, and 9.
  - Verification gates and progress evidence: Task 9.
- Placeholder scan:
  - This plan uses concrete file paths, function names, command lines, and expected outcomes for each task.
- Type consistency:
  - Shared names are `ChatSessionGoalSummary`, `activeGoalId`, `goalIds`, `goalSummaries`, `chatSessionId`, `originMessageId`, and `activeGoal`.
