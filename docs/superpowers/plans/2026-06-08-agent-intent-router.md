# Agent Intent Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, structured intent router so chat messages produce explicit create-task, run-task, clarification, or chat routes before `ChatService` acts.

**Architecture:** Create a pure shared module, `src/shared/agentIntent.ts`, that owns classification, slot extraction, task input construction, and task matching helpers. Refactor `src/main/chatService.ts` to call the router once and preserve existing model, memory, task creation, and task run flows.

**Tech Stack:** TypeScript, Vitest, Electron main/shared modules, existing scheduled task and permission helpers.

---

## File Structure

- Create: `src/shared/agentIntent.ts`
  - Owns `AgentIntentRoute` types, deterministic classification, target directory detection, task name derivation, scheduled task input construction, run-request detection, and task matching.
- Create: `src/shared/agentIntent.test.ts`
  - Covers router behavior without stores or model calls.
- Modify: `src/main/chatService.ts`
  - Replaces private intent helpers with `agentIntent` imports.
  - Adds create-task clarification handling before task creation.
- Modify: `src/main/chatService.test.ts`
  - Keeps existing create/run/chat regressions.
  - Adds missing-target clarification coverage.

## Task 1: Add Shared Intent Router Tests And Module

**Files:**
- Create: `src/shared/agentIntent.test.ts`
- Create: `src/shared/agentIntent.ts`

- [ ] **Step 1: Write the failing router tests**

Create `src/shared/agentIntent.test.ts` with these tests:

```ts
import { describe, expect, it } from "vitest";
import {
  buildScheduledTaskInputFromIntent,
  classifyAgentIntent,
  matchTaskFromMessage,
} from "./agentIntent";
import type { ScheduledTask } from "./scheduledTasks";
import { getDefaultTaskPermissionPolicy } from "./toolPermissions";

describe("agent intent router", () => {
  it("routes a Chinese scheduled downloads request to create_task", () => {
    const route = classifyAgentIntent("每天 9 点整理下载文件夹");

    expect(route).toEqual({
      kind: "create_task",
      confidence: 0.95,
      slots: {
        schedule: { kind: "daily", time: "09:00" },
        targetDir: "~/Downloads",
        taskName: "整理下载文件夹",
      },
      missingSlots: [],
      reason: "scheduled_file_task_with_target",
    });
  });

  it("routes an English scheduled desktop request to create_task", () => {
    const route = classifyAgentIntent("daily at 18:45 organize desktop folder");

    expect(route).toMatchObject({
      kind: "create_task",
      confidence: 0.95,
      slots: {
        schedule: { kind: "daily", time: "18:45" },
        targetDir: "~/Desktop",
        taskName: "整理桌面文件夹",
      },
      missingSlots: [],
    });
  });

  it("asks for targetDir when a scheduled file task omits the folder", () => {
    const route = classifyAgentIntent("每天 9 点整理文件");

    expect(route).toMatchObject({
      kind: "create_task",
      confidence: 0.72,
      slots: {
        schedule: { kind: "daily", time: "09:00" },
      },
      missingSlots: ["targetDir"],
      clarification:
        "我可以创建这个定时任务。你想让我整理哪个文件夹？例如：下载、桌面、文档或项目。",
    });
  });

  it("routes an explicit task execution command to run_task", () => {
    const route = classifyAgentIntent("请运行整理下载文件夹任务");

    expect(route).toMatchObject({
      kind: "run_task",
      confidence: 0.9,
      slots: {
        targetDir: "~/Downloads",
        taskName: "整理下载文件夹",
      },
      missingSlots: [],
    });
  });

  it("keeps ordinary chat as chat", () => {
    expect(classifyAgentIntent("你觉得当前项目还有哪些优化空间？")).toEqual({
      kind: "chat",
      confidence: 0.4,
      slots: {},
      missingSlots: [],
      reason: "no_action_intent_detected",
    });
  });

  it("does not treat casual run wording as a task execution command", () => {
    expect(classifyAgentIntent("I went for a run this morning")).toMatchObject({
      kind: "chat",
      reason: "no_action_intent_detected",
    });
  });

  it("builds the scheduled task input from a complete create_task route", () => {
    const input = buildScheduledTaskInputFromIntent(
      classifyAgentIntent("每天 9 点整理桌面文件夹"),
    );

    expect(input).toEqual({
      name: "整理桌面文件夹",
      skillName: "local-file-organizer",
      enabled: true,
      schedule: { kind: "daily", time: "09:00" },
      input: { targetDir: "~/Desktop", reportName: "agent-report.md" },
      permissions: {
        ...getDefaultTaskPermissionPolicy(),
        files: { read: ["~/Desktop"], write: ["~/Desktop"] },
      },
    });
  });

  it("matches explicit task names and falls back to the only task", () => {
    const tasks = [
      createTask({ id: "task_downloads", name: "整理下载文件夹" }),
      createTask({ id: "task_desktop", name: "整理桌面文件夹" }),
    ];

    expect(matchTaskFromMessage("请运行整理桌面文件夹任务", tasks)?.id).toBe(
      "task_desktop",
    );
    expect(
      matchTaskFromMessage("请运行任务", [createTask({ id: "only_task" })])?.id,
    ).toBe("only_task");
  });
});

function createTask(partial: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task_1",
    name: "Task",
    skillName: "local-file-organizer",
    enabled: true,
    schedule: { kind: "manual" },
    input: {},
    permissions: getDefaultTaskPermissionPolicy(),
    createdAt: "2026-06-06T08:00:00.000Z",
    updatedAt: "2026-06-06T08:00:00.000Z",
    lastRunAt: null,
    nextRunAt: null,
    ...partial,
  };
}
```

- [ ] **Step 2: Run the router test to verify it fails**

Run:

```bash
npm test -- src/shared/agentIntent.test.ts
```

Expected: FAIL because `src/shared/agentIntent.ts` does not exist.

- [ ] **Step 3: Implement the shared intent router**

Create `src/shared/agentIntent.ts` with:

```ts
import {
  draftScheduleFromText,
  type ScheduledTask,
  type ScheduledTaskInput,
  type TaskSchedule,
} from "./scheduledTasks";
import { getDefaultTaskPermissionPolicy } from "./toolPermissions";

export type AgentIntentKind = "create_task" | "run_task" | "chat";
export type AgentIntentSlotName = "schedule" | "targetDir" | "taskName";

export type AgentIntentSlots = {
  schedule?: TaskSchedule;
  targetDir?: string;
  taskName?: string;
};

export type AgentIntentRoute = {
  kind: AgentIntentKind;
  confidence: number;
  slots: AgentIntentSlots;
  missingSlots: AgentIntentSlotName[];
  reason: string;
  clarification?: string;
};

export const missingTargetDirectoryClarification =
  "我可以创建这个定时任务。你想让我整理哪个文件夹？例如：下载、桌面、文档或项目。";

export function classifyAgentIntent(message: string): AgentIntentRoute {
  const schedule = draftScheduleFromText(message);
  const targetDir = detectTargetDirectory(message);
  const taskName = targetDir ? detectTaskName(message, targetDir) : undefined;

  if (schedule && hasFileTaskCreationCue(message)) {
    if (!targetDir) {
      return {
        kind: "create_task",
        confidence: 0.72,
        slots: { schedule },
        missingSlots: ["targetDir"],
        reason: "scheduled_file_task_missing_target",
        clarification: missingTargetDirectoryClarification,
      };
    }

    return {
      kind: "create_task",
      confidence: 0.95,
      slots: { schedule, targetDir, taskName },
      missingSlots: [],
      reason: "scheduled_file_task_with_target",
    };
  }

  if (isTaskRunRequest(message)) {
    return {
      kind: "run_task",
      confidence: 0.9,
      slots: {
        ...(targetDir ? { targetDir } : {}),
        ...(taskName ? { taskName } : {}),
      },
      missingSlots: [],
      reason: "explicit_task_run_request",
    };
  }

  return {
    kind: "chat",
    confidence: 0.4,
    slots: {},
    missingSlots: [],
    reason: "no_action_intent_detected",
  };
}

export function buildScheduledTaskInputFromIntent(
  route: AgentIntentRoute,
): ScheduledTaskInput | null {
  const { schedule, targetDir, taskName } = route.slots;
  if (route.kind !== "create_task" || !schedule || !targetDir) {
    return null;
  }

  return {
    name: taskName ?? detectTaskName("", targetDir),
    skillName: "local-file-organizer",
    enabled: true,
    schedule,
    input: { targetDir, reportName: "agent-report.md" },
    permissions: {
      ...getDefaultTaskPermissionPolicy(),
      files: {
        read: [targetDir],
        write: [targetDir],
      },
    },
  };
}

export function detectTargetDirectory(message: string): string | null {
  const normalized = normalizeMatchText(message);

  if (normalized.includes("下载") || normalized.includes("downloads")) {
    return "~/Downloads";
  }
  if (normalized.includes("桌面") || normalized.includes("desktop")) {
    return "~/Desktop";
  }
  if (normalized.includes("文档") || normalized.includes("documents")) {
    return "~/Documents";
  }
  if (normalized.includes("项目") || normalized.includes("projects")) {
    return "~/Projects";
  }

  return null;
}

export function detectTaskName(message: string, targetDir: string | null): string {
  const normalized = normalizeMatchText(message);

  if (targetDir === "~/Desktop") return "整理桌面文件夹";
  if (targetDir === "~/Documents") return "整理文档文件夹";
  if (targetDir === "~/Projects") return "整理项目文件夹";

  if (normalized.includes("桌面")) return "整理桌面文件夹";
  if (normalized.includes("文档")) return "整理文档文件夹";
  if (normalized.includes("项目")) return "整理项目文件夹";

  return "整理下载文件夹";
}

export function isTaskRunRequest(message: string): boolean {
  return /(运行|执行|跑一下|跑一次|启动).{0,10}(任务|skill|技能|整理|抓取|调度)/i.test(message);
}

export function matchTaskFromMessage(
  message: string,
  tasks: ScheduledTask[],
): ScheduledTask | null {
  if (!tasks.length) {
    return null;
  }

  const normalizedMessage = normalizeMatchText(message);
  const exactMatch = tasks.find((task) =>
    normalizedMessage.includes(normalizeMatchText(task.name)),
  );

  if (exactMatch) {
    return exactMatch;
  }

  if (tasks.length === 1) {
    return tasks[0];
  }

  return null;
}

function hasFileTaskCreationCue(message: string): boolean {
  const normalized = normalizeMatchText(message);
  return /整理|组织|清理|归档|organize|clean|sort|archive/.test(normalized) ||
    detectTargetDirectory(message) !== null;
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}
```

- [ ] **Step 4: Run the router test to verify it passes**

Run:

```bash
npm test -- src/shared/agentIntent.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/shared/agentIntent.ts src/shared/agentIntent.test.ts
git commit -m "feat: add structured agent intent router"
```

Expected: commit succeeds.

## Task 2: Integrate Router Into ChatService

**Files:**
- Modify: `src/main/chatService.ts`
- Modify: `src/main/chatService.test.ts`

- [ ] **Step 1: Write the failing ChatService regression test**

In `src/main/chatService.test.ts`, add this test after the existing Chinese create-task test:

```ts
  it("asks for a target directory before creating a scheduled file task", async () => {
    let completeCalled = false;
    const createdInputs: ScheduledTaskInput[] = [];
    const chatMessages: AppendChatMessageInput[] = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          completeCalled = true;
          return chatReply("unused");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore(chatMessages),
      taskStore: createTaskStore([], createdInputs),
      createId: () => "chat_create_task_missing_target",
      now: () => new Date("2026-06-06T08:00:00.000Z"),
    });

    const result = await service.sendMessage({
      message: "每天 9 点整理文件",
    });

    expect(result).toMatchObject({
      ok: true,
      reply:
        "我可以创建这个定时任务。你想让我整理哪个文件夹？例如：下载、桌面、文档或项目。",
      sessionId: "persisted_session",
    });
    expect(createdInputs).toEqual([]);
    expect(completeCalled).toBe(false);
    expect(chatMessages).toEqual([
      {
        role: "user",
        content: "每天 9 点整理文件",
      },
      {
        sessionId: "persisted_session",
        role: "assistant",
        content:
          "我可以创建这个定时任务。你想让我整理哪个文件夹？例如：下载、桌面、文档或项目。",
      },
    ]);
  });
```

- [ ] **Step 2: Run ChatService tests to verify the new test fails**

Run:

```bash
npm test -- src/main/chatService.test.ts
```

Expected: FAIL because current `ChatService` silently creates a downloads task instead of asking for the target directory.

- [ ] **Step 3: Refactor ChatService imports and task creation flow**

In `src/main/chatService.ts`, replace imports from `scheduledTasks` and `toolPermissions` with router imports:

```ts
import {
  buildScheduledTaskInputFromIntent,
  classifyAgentIntent,
  matchTaskFromMessage,
  type AgentIntentRoute,
} from "../shared/agentIntent";
import {
  describeSchedule,
  type ScheduledTask,
} from "../shared/scheduledTasks";
```

Then in `sendMessage`, compute the route once after persisting the user message:

```ts
      const intentRoute = classifyAgentIntent(userMessage);
      const taskCreationResult = await tryCreateTaskFromIntent({
        route: intentRoute,
        taskStore: options.taskStore,
      });
```

And pass the same route to task running:

```ts
      const taskRunResult = await tryRunTaskFromIntent({
        route: intentRoute,
        message: userMessage,
        taskStore: options.taskStore,
        runScheduledTask: options.runScheduledTask,
      });
```

- [ ] **Step 4: Replace private helper implementations**

In `src/main/chatService.ts`, replace `tryCreateTaskFromMessage`, `createTaskInputFromMessage`, `detectTargetDirectory`, `detectTaskName`, `tryRunTaskFromMessage`, `isTaskRunRequest`, `matchTaskFromMessage`, and `normalizeMatchText` with:

```ts
async function tryCreateTaskFromIntent(options: {
  route: AgentIntentRoute;
  taskStore: Pick<ScheduledTaskStore, "create"> | undefined;
}): Promise<TaskCreationDetection | null> {
  if (options.route.kind !== "create_task") {
    return null;
  }

  if (!options.taskStore) {
    return null;
  }

  if (options.route.missingSlots.length > 0 && options.route.clarification) {
    return {
      ok: true,
      result: {
        ok: true,
        reply: options.route.clarification,
        sessionId: "",
        relatedMemories: [],
        memoryId: null,
      },
    };
  }

  const draft = buildScheduledTaskInputFromIntent(options.route);
  if (!draft) {
    return null;
  }

  try {
    const task = await options.taskStore.create(draft);
    return {
      ok: true,
      result: {
        ok: true,
        reply: `已创建任务“${task.name}”，调度：${describeSchedule(task.schedule)}。你可以在“任务”页检查权限后运行。`,
        sessionId: "",
        relatedMemories: [],
        memoryId: null,
        createdTask: task,
      },
    };
  } catch (error) {
    return {
      ok: false,
      result: {
        ok: false,
        message:
          error instanceof Error ? `创建任务失败：${error.message}` : "创建任务失败。",
      },
    };
  }
}

async function tryRunTaskFromIntent(options: {
  route: AgentIntentRoute;
  message: string;
  taskStore: Pick<ScheduledTaskStore, "list"> | undefined;
  runScheduledTask: ((taskId: string) => Promise<RunScheduledTaskResult>) | undefined;
}): Promise<TaskRunDetection | null> {
  if (options.route.kind !== "run_task") {
    return null;
  }

  if (!options.taskStore || !options.runScheduledTask) {
    return null;
  }

  const tasks = await options.taskStore.list();
  const matchedTask = matchTaskFromMessage(options.message, tasks);

  if (!matchedTask) {
    return {
      ok: false,
      result: {
        ok: false,
        message: "没有找到匹配的本地任务。请先在“任务”里创建任务，或在消息里写清楚任务名称。",
      },
    };
  }

  const runResult = await options.runScheduledTask(matchedTask.id);
  if (!runResult.ok) {
    return {
      ok: false,
      result: {
        ok: false,
        message: `任务“${matchedTask.name}”没有运行成功：${runResult.message}`,
      },
    };
  }

  return {
    ok: true,
    result: {
      ok: true,
      reply: formatTaskRunReply(runResult.run),
      sessionId: "",
      relatedMemories: [],
      memoryId: null,
      executedRun: runResult.run,
    },
  };
}
```

- [ ] **Step 5: Run ChatService tests to verify they pass**

Run:

```bash
npm test -- src/main/chatService.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run router and ChatService tests together**

Run:

```bash
npm test -- src/shared/agentIntent.test.ts src/main/chatService.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add src/main/chatService.ts src/main/chatService.test.ts
git commit -m "feat: route chat actions through structured intent"
```

Expected: commit succeeds.

## Task 3: Full Verification And Final Review

**Files:**
- Verify: all modified files
- Commit: plan document if not already committed with implementation work

- [ ] **Step 1: Run full project verification**

Run:

```bash
npm run verify
```

Expected: all Vitest tests pass, TypeScript/Vite build succeeds, and agent evals pass.

- [ ] **Step 2: Review git diff**

Run:

```bash
git diff --stat main..HEAD
git diff main..HEAD -- src/shared/agentIntent.ts src/shared/agentIntent.test.ts src/main/chatService.ts src/main/chatService.test.ts docs/superpowers/plans/2026-06-08-agent-intent-router.md
```

Expected: diff only contains the intent-router plan, router module/tests, and ChatService integration.

- [ ] **Step 3: Commit the implementation plan if still uncommitted**

Run:

```bash
git status -sb
git add docs/superpowers/plans/2026-06-08-agent-intent-router.md
git commit -m "docs: plan agent intent router implementation"
```

Expected: commit succeeds if the plan was not included in an earlier commit. If it is already committed, skip this step.

- [ ] **Step 4: Confirm final branch state**

Run:

```bash
git status -sb
git log --oneline -5
```

Expected: branch is `codex/agent-intent-router`, implementation commits are present, and only pre-existing untracked files remain.
