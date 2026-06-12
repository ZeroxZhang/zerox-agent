# Chat Session Goal Mode Design

Date: 2026-06-12

## Context

Zerox Agent v1.7.0 introduced the Goal Mode foundation: bounded goal state, budgets, milestones, local ledgers, deterministic-first acceptance, review gates, goal-aware compaction, eval fixtures, and a first Goals UI.

The foundation is useful, but the current interaction model is wrong. Goal Mode is exposed as a parallel top-level module where the user creates and manages a goal in a standalone page. That does not match how goals naturally appear in an agent product. A goal should emerge inside a long-running conversation as a commitment, constraint, and progress contract for that session.

This spec redesigns Goal Mode as a Chat Session mode and also simplifies the main navigation so technical control surfaces are available without dominating the primary workflow.

## Problem

The current Goals page creates three product problems:

1. Goal creation is detached from the conversation that produced the intent.
2. Goal progress and review gates are not experienced as part of the ongoing agent dialogue.
3. The main navigation has too many peer-level modules, making low-frequency technical surfaces feel as important as the core work loop.

There is also an implementation gap: the current Goal IPC can create and update stored goal records, but start/resume operations are not yet wired to the real `AgentGoalController` execution loop.

## Design Position

Goal Mode becomes a session-native mode:

- A chat session may have one active goal at a time.
- A chat session may retain completed, canceled, or failed historical goals.
- User messages, assistant messages, runtime runs, goal ledger events, and review decisions all attach to the same session context.
- The user can set, modify, continue, pause, review, or end the goal from the conversation.
- Detailed evidence remains inspectable through Runs and goal trajectory records, but the primary interaction stays in Chat.

Goal is not a destination. Goal is the contract that governs a long conversation.

## Main Navigation

The main navigation should be reduced to the primary user workflow:

1. Chat
2. Overview
3. Runs
4. Tasks
5. Settings

The following surfaces move under Settings as default-collapsed secondary menu items:

- Tools
- Memory
- Learning
- Evals

Implementation should model these as secondary settings sections, not as unrelated new pages. Existing panels can be reused and rendered from Settings after the user expands the corresponding menu item.

Rationale:

- Chat is the primary workbench.
- Overview is the command center.
- Runs is the observability timeline.
- Tasks is a user-facing automation surface.
- Settings owns configuration, permissions, memory governance, learning review, and eval promotion.

Technical surfaces are still available, but they no longer compete with the user's main work loop.

The old `#goals` route should redirect to `#chat`. If there is an active or waiting goal, Chat opens with that goal selected.

## Data Model

Extend `ChatSessionRecord`:

```ts
type ChatSessionRecord = {
  id: string;
  title: string;
  summary: string;
  messages: ChatMessageRecord[];
  activeGoalId?: string;
  goalIds?: string[];
  createdAt: string;
  updatedAt: string;
};
```

Extend `ChatSessionListItem`:

```ts
type ChatSessionListItem = {
  id: string;
  title: string;
  summary: string;
  messageCount: number;
  activeGoal?: ChatSessionGoalSummary;
  updatedAt: string;
};
```

Add goal linkage fields:

```ts
type Goal = {
  id: string;
  chatSessionId: string;
  originMessageId?: string;
  description: string;
  successCriteria: SuccessCriterion[];
  milestones: Milestone[];
  status: GoalStatus;
  stopReason?: StopReason;
  budget: GoalBudget;
  budgetUsage: GoalBudgetUsage;
  reviewPolicy: GoalReviewPolicy;
  planVersion: number;
  workspaceId?: string;
  createdAt: string;
  updatedAt: string;
};
```

Extend `ChatMessageRecord`:

```ts
type ChatMessageRecord = {
  id: string;
  role: "assistant" | "user";
  content: string;
  createdAt: string;
  relatedMemoryIds?: string[];
  executedRunId?: string;
  goalId?: string;
  goalEventRef?: string;
};
```

Rules:

- `activeGoalId` points only to a non-terminal goal.
- Terminal goals remain in `goalIds`.
- A session can create a new goal only after the previous active goal reaches a terminal state, unless the user explicitly replaces it.
- Goal ledger and trajectory storage remain local-first under the existing goal store and trajectory store.

## Intent Routing

Chat intent routing adds goal-specific routes before normal task/run/tool handling:

- `set_goal`: "把这轮设为目标...", "直到 release 完成才算结束", "接下来目标是..."
- `update_goal`: "目标改一下...", "成功标准加上...", "预算放宽..."
- `continue_goal`: "继续", "接着", "继续这个目标"
- `pause_goal`: "暂停这个目标", "先停一下"
- `cancel_goal`: "结束目标", "取消这个目标"
- `review_goal`: responses to an inline review gate such as continue, modify plan, terminate

Routing must be conservative. If a message can be interpreted as ordinary chat and there is no active goal, do not silently create a goal. The assistant should propose a goal contract and ask for confirmation when intent is ambiguous.

## Chat UI

### Goal Contract Bar

When a session has an active goal, Chat displays a compact bar above the message list:

```text
Goal: Publish v1.8.0
Status: Executing
Current milestone: Build and verify release artifacts
Budget: 3/8 iterations, 12/40 tools, 18/60 minutes
Actions: View progress, Modify, Pause, End
```

The bar should stay visible during scrolling. It is a contract, not a dashboard card.

### Session Rail

Session list items show a small goal badge:

- `Goal running`
- `Waiting review`
- `Goal achieved`
- `Goal stopped`

This helps users return to long-running goal sessions without opening a separate module.

### Inline Goal Events

Important goal lifecycle events render as conversation items:

- goal created
- plan generated
- milestone started
- milestone accepted
- goal replanned
- review requested
- review resolved
- goal achieved
- goal stopped

These should appear as compact structured messages, not verbose logs.

### Inline Review Gate

Review gates render inside the chat flow:

```text
Review required: Milestone accepted

Evidence:
- npm run verify passed
- dist:mac generated DMG and ZIP
- release assets prepared

Remaining:
- push tag
- publish GitHub Release

Actions:
Continue / Modify plan / Terminate goal
```

Clicking an action calls goal review resolution APIs and appends a chat message documenting the user's decision.

### Goal Detail Drawer

The full milestone tree and ledger live in a lightweight drawer opened from the Goal Contract Bar.

The drawer includes:

- goal description
- success criteria
- budget and budget usage
- milestone tree
- latest ledger entries
- linked runs
- linked evidence refs
- terminal stop reason if present

The drawer is not a primary page.

## Backend Flow

### Create Goal From Chat

1. User sends a goal-setting message.
2. Chat service appends the user message.
3. Intent router detects `set_goal`.
4. If unambiguous, create a goal draft linked to `chatSessionId` and `originMessageId`.
5. Planner decomposes the goal into milestones.
6. Store the goal and update `ChatSessionRecord.activeGoalId`.
7. Append a compact assistant message with the proposed contract.
8. If the user requested immediate execution, call `AgentGoalController.start`.

### Continue Goal

1. User sends "continue" or clicks Continue.
2. Chat service detects active goal.
3. If the goal is waiting for review, require a review decision first.
4. Otherwise call `AgentGoalController.resume`.
5. Stream goal milestone status events to the chat UI.
6. Append assistant summary and structured goal event messages.

### Modify Goal

1. User describes changes in chat.
2. Chat service appends the message with `goalId`.
3. Store a ledger event explaining the requested modification.
4. Update success criteria, budget, or review policy when deterministic.
5. For plan changes, call planner replan on non-terminal milestones.
6. Increment `planVersion` and append an assistant confirmation.

### Review Gate

1. Controller reaches a review condition.
2. Goal status becomes `waiting_for_review`.
3. Chat status becomes paused.
4. UI renders an inline review gate card.
5. User chooses Continue, Modify plan, or Terminate.
6. Chat appends the decision and calls `AgentGoalController.resolveReview`.

### Terminal Goal

When a goal reaches `achieved`, `failed`, `stopped_budget`, `stopped_stalled`, or `canceled`:

- clear `ChatSessionRecord.activeGoalId`
- keep the goal id in `goalIds`
- append a terminal structured message
- keep Runs and trajectory evidence linked

## Runtime Integration

`goal:start`, `goal:resume`, and `goal:resolveReview` must use `AgentGoalController`, not status-only updates.

The controller runtime engine should dispatch each milestone through the existing recoverable runtime or agent loop so these guarantees remain intact:

- workspace sandbox checks
- `ToolAuthorizationService`
- tool audit events
- runtime checkpoints
- trajectory events
- model retry and failure-loop handling
- tool-result offload refs

Every milestone run should include `goalId`, `chatSessionId`, and `milestoneId` in checkpoint and trajectory metadata.

## Migration

Existing standalone goal records from v1.7.0 should be migrated lazily:

1. If a goal already has `chatSessionId`, leave it unchanged.
2. If a non-terminal goal has no `chatSessionId`, create or reuse a session titled from the goal description.
3. Attach the goal to that session and set `activeGoalId`.
4. Append an assistant message explaining that the goal was restored into a conversation.
5. If a terminal goal has no session, attach it to an archival session without making it active.

Old `#goals` links redirect to Chat. If the linked goal can be found, Chat opens the owning session and goal drawer.

## Error Handling

- If goal creation fails, the user message remains in chat and the assistant explains the failure.
- If the controller cannot resume a goal, keep the goal active and append a recoverable error message.
- If review resolution fails, keep the review gate visible.
- If migration fails for one goal, log the error and continue migrating other goals.
- If a session points to a missing active goal, clear `activeGoalId` and append a repair ledger event if possible.

## Testing

Focused test coverage:

- `chatSessionStore.test.ts`: persists `activeGoalId`, `goalIds`, and goal summaries.
- `agentGoalStore.test.ts`: normalizes `chatSessionId` and migration behavior.
- `chatService.test.ts`: routes set/update/continue/cancel/review goal intents.
- `agentGoalController.test.ts`: remains the source of truth for bounded execution.
- `main.test` or focused IPC tests: goal IPC calls the controller instead of status-only updates.
- `navigation.test.ts`: removes `goals` from top-level navigation and redirects `#goals` to `chat`.
- `materialDesign.test.ts`: Chat exposes Goal Contract Bar, session goal badge, and inline review gate.
- `readme.test.ts`: README documents session-native Goal Mode rather than a standalone Goals page.
- Agent eval fixtures: add session-native goal fixtures for set-goal, review-gate resume, and goal migration.

Verification commands:

```bash
npm test -- src/main/chatService.test.ts src/main/chatSessionStore.test.ts src/main/agentGoalController.test.ts src/shared/navigation.test.ts src/renderer/materialDesign.test.ts src/shared/readme.test.ts
npm run verify
npm run harness:check
npm run smoke:prod
```

## Rollout Plan

1. Add data model fields and backward-compatible normalization.
2. Add goal intent routing in chat without removing the old Goals page.
3. Add Goal Contract Bar, session rail badges, and inline review gate cards.
4. Wire goal IPC and chat goal operations to `AgentGoalController`.
5. Migrate Overview waiting-review actions to open Chat sessions.
6. Remove top-level Goals navigation and redirect `#goals`.
7. Move Tools, Memory, Learning, and Evals under Settings as collapsed secondary items.
8. Delete or repurpose the old `GoalPanel` as `GoalDetailDrawer`.
9. Update architecture docs, README, feature list, and progress evidence.

## Non-goals

- Do not add cloud workers.
- Do not bypass `ToolAuthorizationService`.
- Do not allow unreviewed self-modification.
- Do not make Goal Mode a separate project manager.
- Do not create multiple simultaneous active goals in one session for this iteration.

## Acceptance Criteria

- A user can create a goal from a chat message without leaving Chat.
- A session visibly carries its active goal contract.
- "Continue" in a goal session resumes the goal loop, not a standalone page action.
- Review gates appear inline in the conversation and block execution until resolved.
- Runs and trajectory evidence remain inspectable and linked to goal/session/milestone ids.
- The main navigation no longer includes Goals, Tools, Memory, Learning, or Evals as peer-level items.
- Settings exposes Tools, Memory, Learning, and Evals as collapsed secondary menu options.
- Existing v1.7.0 standalone goals are recoverable through migrated chat sessions.
- Focused tests, `npm run verify`, `npm run harness:check`, and `npm run smoke:prod` pass before shipping.
