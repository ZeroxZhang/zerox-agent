# Runs Module Simplified Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current engineer-facing Runs page with a simpler `任务记录` surface that shows outcome, next action, recent tasks, and collapses technical evidence by default.

**Architecture:** Add a small shared view-model layer for run labels, primary actions, sorting, and simple event summaries, then refactor `RunsPanel` to render the approved v2 layout. Keep existing backend IPC/API behavior intact: list runs, list active executions, retry, pause, resume, trajectory loading, tool-result refs, and eval candidate generation still come from the same preload calls.

**Tech Stack:** Electron renderer, React, TypeScript, Vitest, existing CSS in `src/renderer/styles/legacy.css`, existing shared types in `src/shared`.

---

## File Structure

- Modify: `src/shared/navigation.ts`
  - Rename the primary nav label and summary from `运行` to `任务记录`.

- Create: `src/shared/runRecordViewModel.ts`
  - Owns consumer-facing status labels, primary action mapping, attention sorting, event translation, and simple task detail summaries.
  - This keeps `RunsPanel.tsx` from becoming a string-mapping dump.

- Create: `src/shared/runRecordViewModel.test.ts`
  - Covers status/action mapping, attention ordering, English event translation, and long/default empty states.

- Modify: `src/renderer/components/RunsPanel.tsx`
  - Replace the current three-column observability layout with the simplified v2 layout.
  - Keep `RunTrajectoryPanel` available inside collapsed technical detail.
  - Keep existing retry/resume/pause/generate-eval methods wired.

- Modify: `src/renderer/components/RunTrajectoryPanel.tsx`
  - Make the panel work as collapsed technical evidence and use user-facing labels.
  - Bound large tool-result content.

- Modify: `src/renderer/styles/legacy.css`
  - Replace old `.runs-layout`, `.run-inspector`, `.timeline-panel` behavior with stable centered layout, focus card, recent task list, simple detail panel, and mobile tabs.

- Do not create a new style entrypoint for this iteration. Keep Runs presentation rules in `src/renderer/styles/legacy.css` so the implementation stays scoped and avoids import churn.

---

## Task 1: Shared View Model And Navigation Copy

**Files:**
- Modify: `src/shared/navigation.ts`
- Create: `src/shared/runRecordViewModel.ts`
- Create: `src/shared/runRecordViewModel.test.ts`

- [ ] **Step 1: Write failing tests for user-facing labels and actions**

Create `src/shared/runRecordViewModel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentExecutionCheckpoint } from "./agentExecution";
import type { AgentRunRecord } from "./agentRuns";
import {
  buildRunRecordSummary,
  compareRunRecordPriority,
  getRunRecordAction,
  getRunRecordStatus,
  translateRunRecordEventTitle,
} from "./runRecordViewModel";

const baseRun: AgentRunRecord = {
  id: "run_1",
  taskId: "task_1",
  taskName: "整理桌面，新建 ba'k 文件夹",
  skillName: "default",
  status: "canceled",
  summary: "Agent loop canceled.",
  events: [
    {
      level: "info",
      message:
        "Goal milestone started: List current desktop contents to identify files and folders.",
      createdAt: "2026-06-27T10:18:39.000Z",
    },
    {
      level: "warn",
      message: "Agent loop canceled.",
      createdAt: "2026-06-27T10:18:48.000Z",
    },
  ],
  startedAt: "2026-06-27T10:18:30.000Z",
  finishedAt: "2026-06-27T10:18:48.000Z",
};

function runWithStatus(
  status: AgentRunRecord["status"],
  overrides: Partial<AgentRunRecord> = {},
): AgentRunRecord {
  return {
    ...baseRun,
    ...overrides,
    id: `run_${status}`,
    status,
  };
}

function checkpointWithStatus(
  status: AgentExecutionCheckpoint["status"],
): AgentExecutionCheckpoint {
  return {
    id: `checkpoint_${status}`,
    runId: `run_${status}`,
    taskId: "task_1",
    status,
    steps: [],
    messages: [],
    toolCallCount: 0,
    createdAt: "2026-06-27T10:18:30.000Z",
    updatedAt: "2026-06-27T10:18:48.000Z",
  };
}

describe("runRecordViewModel", () => {
  it("maps terminal statuses to consumer labels and primary actions", () => {
    expect(getRunRecordStatus(runWithStatus("succeeded")).label).toBe("已完成");
    expect(getRunRecordAction(runWithStatus("succeeded")).primary.label).toBe("查看结果");

    expect(getRunRecordStatus(runWithStatus("failed")).label).toBe("需要处理");
    expect(getRunRecordAction(runWithStatus("failed")).primary.label).toBe("修正后重试");

    expect(getRunRecordStatus(runWithStatus("canceled")).label).toBe("已停止");
    expect(getRunRecordAction(runWithStatus("canceled")).primary.label).toBe("重新运行");
  });

  it("maps active checkpoints to continue or stop actions", () => {
    expect(getRunRecordStatus(checkpointWithStatus("running")).label).toBe("正在运行");
    expect(getRunRecordAction(checkpointWithStatus("running")).primary.label).toBe("停止");

    expect(getRunRecordStatus(checkpointWithStatus("paused")).label).toBe("已暂停");
    expect(getRunRecordAction(checkpointWithStatus("paused")).primary.label).toBe("继续");

    expect(getRunRecordStatus(checkpointWithStatus("waiting_for_approval")).label).toBe("需要授权");
    expect(getRunRecordAction(checkpointWithStatus("waiting_for_approval")).primary.label).toBe("查看授权");
  });

  it("prioritizes attention records before completed history", () => {
    const sorted = [
      runWithStatus("succeeded"),
      runWithStatus("failed"),
      runWithStatus("canceled"),
    ].sort(compareRunRecordPriority);

    expect(sorted.map((run) => run.status)).toEqual([
      "failed",
      "canceled",
      "succeeded",
    ]);
  });

  it("translates common internal event messages into readable Chinese", () => {
    expect(translateRunRecordEventTitle("Agent loop canceled.")).toBe("任务已停止");
    expect(
      translateRunRecordEventTitle(
        "Goal milestone started: List current desktop contents to identify files and folders.",
      ),
    ).toBe("开始步骤：检查桌面内容");
  });

  it("summarizes a stopped run without exposing raw English by default", () => {
    const summary = buildRunRecordSummary(baseRun, []);

    expect(summary.outcome).toContain("任务开始后被停止");
    expect(summary.simpleSteps.map((step) => step.title)).toEqual([
      "开始步骤：检查桌面内容",
      "任务已停止",
    ]);
    expect(summary.technicalEventCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:

```bash
npm test -- src/shared/runRecordViewModel.test.ts
```

Expected: fail because `src/shared/runRecordViewModel.ts` does not exist.

- [ ] **Step 3: Implement the shared view model**

Create `src/shared/runRecordViewModel.ts`:

```ts
import type {
  AgentExecutionCheckpoint,
  AgentExecutionStatus,
} from "./agentExecution";
import type { AgentRunEvent, AgentRunRecord } from "./agentRuns";
import type { AgentTrajectoryEvent } from "./agentTrajectory";

export type RunRecordTone = "attention" | "danger" | "info" | "success";

export type RunRecordStatusView = {
  label: string;
  tone: RunRecordTone;
  description: string;
  needsAttention: boolean;
};

export type RunRecordActionKind =
  | "continue"
  | "open_chat"
  | "open_settings"
  | "review_permission"
  | "retry"
  | "stop"
  | "view_details"
  | "view_result";

export type RunRecordAction = {
  kind: RunRecordActionKind;
  label: string;
};

export type RunRecordActionView = {
  primary: RunRecordAction;
  secondary: RunRecordAction[];
};

export type RunRecordListItem = {
  id: string;
  title: string;
  subtitle: string;
  updatedAt: string;
  status: RunRecordStatusView;
  source: "active" | "history";
};

export type RunRecordSimpleStep = {
  title: string;
  detail: string;
  tone: RunRecordTone;
  createdAt: string;
};

export type RunRecordSummary = {
  title: string;
  outcome: string;
  nextStep: string;
  producedArtifacts: boolean;
  wroteMemory: boolean;
  simpleSteps: RunRecordSimpleStep[];
  technicalEventCount: number;
  trajectoryEventCount: number;
};

const statusPriority: Record<AgentExecutionStatus, number> = {
  failed: 0,
  waiting_for_approval: 1,
  paused: 2,
  running: 3,
  canceled: 4,
  queued: 5,
  succeeded: 6,
};

export function getRunRecordStatus(
  record: AgentRunRecord | AgentExecutionCheckpoint,
): RunRecordStatusView {
  switch (record.status) {
    case "succeeded":
      return {
        label: "已完成",
        tone: "success",
        description: "任务已完成，可以查看结果和证据。",
        needsAttention: false,
      };
    case "failed":
      return {
        label: "需要处理",
        tone: "danger",
        description: "任务失败，需要修正后再试。",
        needsAttention: true,
      };
    case "canceled":
      return {
        label: "已停止",
        tone: "attention",
        description: "任务已停止，没有继续操作电脑。",
        needsAttention: true,
      };
    case "paused":
      return {
        label: "已暂停",
        tone: "info",
        description: "任务保存了检查点，可以继续。",
        needsAttention: true,
      };
    case "running":
      return {
        label: "正在运行",
        tone: "info",
        description: "任务正在执行，可以停止或打开会话。",
        needsAttention: false,
      };
    case "waiting_for_approval":
      return {
        label: "需要授权",
        tone: "attention",
        description: "任务等待你确认权限。",
        needsAttention: true,
      };
    case "queued":
      return {
        label: "排队中",
        tone: "info",
        description: "任务正在等待开始。",
        needsAttention: false,
      };
  }
}

export function getRunRecordAction(
  record: AgentRunRecord | AgentExecutionCheckpoint,
): RunRecordActionView {
  switch (record.status) {
    case "running":
      return {
        primary: { kind: "stop", label: "停止" },
        secondary: [
          { kind: "open_chat", label: "打开会话" },
          { kind: "view_details", label: "查看详情" },
        ],
      };
    case "paused":
      return {
        primary: { kind: "continue", label: "继续" },
        secondary: [
          { kind: "stop", label: "停止" },
          { kind: "open_chat", label: "打开会话" },
        ],
      };
    case "waiting_for_approval":
      return {
        primary: { kind: "review_permission", label: "查看授权" },
        secondary: [
          { kind: "open_chat", label: "打开会话" },
          { kind: "stop", label: "停止" },
        ],
      };
    case "failed":
      return {
        primary: { kind: "retry", label: "修正后重试" },
        secondary: [
          { kind: "open_chat", label: "打开会话" },
          { kind: "view_details", label: "查看详情" },
        ],
      };
    case "succeeded":
      return {
        primary: { kind: "view_result", label: "查看结果" },
        secondary: [
          { kind: "open_chat", label: "打开会话" },
          { kind: "retry", label: "再次运行" },
        ],
      };
    case "canceled":
    case "queued":
      return {
        primary: { kind: "retry", label: "重新运行" },
        secondary: [
          { kind: "open_chat", label: "打开原会话" },
          { kind: "view_details", label: "查看详情" },
        ],
      };
  }
}

export function toRunRecordListItem(
  record: AgentRunRecord | AgentExecutionCheckpoint,
): RunRecordListItem {
  const isRun = "taskName" in record;
  const status = getRunRecordStatus(record);
  return {
    id: isRun ? record.id : record.runId,
    title: isRun ? record.taskName : `任务 ${record.taskId}`,
    subtitle: isRun
      ? `${status.label} · ${record.summary || status.description}`
      : `${status.label} · ${record.currentStepId ? `步骤 ${record.currentStepId}` : status.description}`,
    updatedAt: isRun ? record.finishedAt : record.updatedAt,
    status,
    source: isRun ? "history" : "active",
  };
}

export function compareRunRecordPriority(
  left: AgentRunRecord | AgentExecutionCheckpoint,
  right: AgentRunRecord | AgentExecutionCheckpoint,
): number {
  const statusDelta = statusPriority[left.status] - statusPriority[right.status];
  if (statusDelta !== 0) {
    return statusDelta;
  }

  const leftTime = Date.parse("finishedAt" in left ? left.finishedAt : left.updatedAt);
  const rightTime = Date.parse("finishedAt" in right ? right.finishedAt : right.updatedAt);
  return rightTime - leftTime;
}

export function buildRunRecordSummary(
  run: AgentRunRecord,
  trajectoryEvents: AgentTrajectoryEvent[],
): RunRecordSummary {
  const status = getRunRecordStatus(run);
  const simpleSteps = run.events.slice(0, 6).map(toSimpleStep);
  const wroteMemory =
    run.events.some((event) => event.message.toLowerCase().includes("memory")) ||
    trajectoryEvents.some((event) => event.type.includes("memory"));

  return {
    title: run.taskName,
    outcome: buildOutcomeText(run, status),
    nextStep: buildNextStepText(run),
    producedArtifacts: Boolean(run.artifacts?.length),
    wroteMemory,
    simpleSteps,
    technicalEventCount: run.events.length,
    trajectoryEventCount: trajectoryEvents.length,
  };
}

export function translateRunRecordEventTitle(message: string): string {
  const normalized = message.trim().toLowerCase();

  if (normalized === "agent loop canceled.") {
    return "任务已停止";
  }

  if (normalized.startsWith("goal milestone started")) {
    if (normalized.includes("desktop")) {
      return "开始步骤：检查桌面内容";
    }
    return "开始步骤";
  }

  if (normalized.startsWith("let me break down this milestone")) {
    return "生成执行计划";
  }

  if (normalized === "agent run started.") {
    return "任务开始";
  }

  if (normalized === "agent run finished.") {
    return "任务结束";
  }

  if (normalized === "checkpoint written") {
    return "已保存恢复点";
  }

  if (normalized === "context compacted") {
    return "已整理上下文";
  }

  if (normalized.includes("tool call denied") || normalized.includes("工具调用被拒绝")) {
    return "工具权限被拒绝";
  }

  if (normalized.includes("model response") || normalized.includes("模型响应")) {
    return "收到模型回复";
  }

  return message.replace(/\.$/, "");
}

function toSimpleStep(event: AgentRunEvent): RunRecordSimpleStep {
  const title = translateRunRecordEventTitle(event.message);
  return {
    title,
    detail: buildEventDetail(event, title),
    tone: event.level === "error" ? "danger" : event.level === "warn" ? "attention" : "info",
    createdAt: event.createdAt,
  };
}

function buildOutcomeText(
  run: AgentRunRecord,
  status: RunRecordStatusView,
): string {
  if (run.status === "canceled") {
    return "任务开始后被停止。没有继续操作电脑。";
  }
  if (run.status === "failed") {
    return run.failureMessage || run.summary || "任务失败，需要处理后再试。";
  }
  if (run.status === "succeeded") {
    return run.summary || "任务已完成。";
  }
  return status.description;
}

function buildNextStepText(run: AgentRunRecord): string {
  if (run.status === "failed") {
    if (run.failureClass === "permission_denied") {
      return "检查授权后再重试。";
    }
    if (run.failureClass === "model_error") {
      return "检查模型设置后再重试。";
    }
    return "修正问题后重试。";
  }
  if (run.status === "canceled") {
    return "确认任务描述没问题后重新运行。";
  }
  if (run.status === "succeeded") {
    return "查看结果和证据。";
  }
  return "查看任务详情。";
}

function buildEventDetail(event: AgentRunEvent, title: string): string {
  if (title === "任务已停止") {
    return "停止后没有继续执行后续步骤。";
  }
  if (title === "开始步骤：检查桌面内容") {
    return "智能体准备确认桌面路径和已有文件。";
  }
  if (title === "生成执行计划") {
    return "智能体拆分了后续操作步骤。";
  }
  if (event.data?.toolName && typeof event.data.toolName === "string") {
    return `工具：${event.data.toolName}`;
  }
  return event.phase ? `阶段：${event.phase}` : "已记录这个步骤。";
}
```

- [ ] **Step 4: Update navigation copy**

In `src/shared/navigation.ts`, replace the `runs` section with:

```ts
  {
    id: "runs",
    label: "任务记录",
    module: "活动",
    summary: "查看每次任务是否完成，以及下一步怎么处理。",
    details: [
      "先展示需要处理的任务，而不是默认展开技术日志。",
      "每条记录都给出明确状态、结果和下一步动作。",
      "技术证据保留在详情里，用于排障和复盘。",
    ],
  },
```

- [ ] **Step 5: Run the shared tests**

Run:

```bash
npm test -- src/shared/runRecordViewModel.test.ts src/shared/navigation.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/shared/navigation.ts src/shared/runRecordViewModel.ts src/shared/runRecordViewModel.test.ts
git commit -m "feat: add task record view model"
```

---

## Task 2: Simplify RunsPanel Default Layout

**Files:**
- Modify: `src/renderer/components/RunsPanel.tsx`

- [ ] **Step 1: Add imports and state for simplified selection**

In `src/renderer/components/RunsPanel.tsx`, add imports:

```ts
import {
  buildRunRecordSummary,
  compareRunRecordPriority,
  getRunRecordAction,
  getRunRecordStatus,
  toRunRecordListItem,
  type RunRecordAction,
} from "../../shared/runRecordViewModel";
import { Icon } from "./Icon";
```

Keep existing imports that are still needed for eval candidates, handoff review, kernel events, run graph, and trajectory.

Add mobile/detail state near existing selected IDs:

```ts
const [activeRunsTab, setActiveRunsTab] = useState<"action" | "history" | "details">("action");
const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
```

- [ ] **Step 2: Create derived selected data**

Inside `RunsPanel`, after `selectedRun` and trajectory loading, add:

```ts
const sortedRuns = useMemo(
  () => [...runs].sort(compareRunRecordPriority),
  [runs],
);
const selectedRunRecord = selectedRun ?? sortedRuns[0] ?? null;
const selectedRunStatus = selectedRunRecord
  ? getRunRecordStatus(selectedRunRecord)
  : null;
const selectedRunAction = selectedRunRecord
  ? getRunRecordAction(selectedRunRecord)
  : null;
const selectedRunSummary = selectedRunRecord
  ? buildRunRecordSummary(selectedRunRecord, trajectoryEvents)
  : null;
const recentRunItems = useMemo(
  () => sortedRuns.slice(0, 8).map(toRunRecordListItem),
  [sortedRuns],
);
const activeExecutionItems = useMemo(
  () => activeExecutions.slice(0, 4).map(toRunRecordListItem),
  [activeExecutions],
);
```

- [ ] **Step 3: Add an action dispatcher**

Add this function inside `RunsPanel`:

```ts
async function handleRunRecordAction(action: RunRecordAction) {
  if (!selectedRunRecord) {
    return;
  }

  if (action.kind === "retry") {
    await handleRetrySelectedRun();
    return;
  }

  if (action.kind === "continue") {
    const checkpoint = activeExecutions.find(
      (execution) => execution.runId === selectedRunRecord.id,
    );
    if (checkpoint) {
      await handleResumeExecution(checkpoint);
    } else {
      setStatus({
        kind: "error",
        message: "没有找到可恢复检查点，请重新运行任务。",
      });
    }
    return;
  }

  if (action.kind === "stop") {
    const checkpoint = activeExecutions.find(
      (execution) => execution.runId === selectedRunRecord.id,
    );
    if (checkpoint) {
      await handlePauseExecution(checkpoint);
    } else {
      setStatus({
        kind: "idle",
        message: "这条任务当前没有运行中的检查点。",
      });
    }
    return;
  }

  if (action.kind === "view_details" || action.kind === "view_result") {
    setActiveRunsTab("details");
    setShowTechnicalDetails(action.kind === "view_details");
    return;
  }

  if (action.kind === "open_chat") {
    setStatus({
      kind: "idle",
      message: "可以从左侧会话列表打开原会话；后续版本会直接跳转到关联会话。",
    });
    return;
  }

  if (action.kind === "review_permission") {
    setStatus({
      kind: "idle",
      message: "请到设置或工具权限中查看这次任务需要的授权。",
    });
    return;
  }

  if (action.kind === "open_settings") {
    setStatus({
      kind: "idle",
      message: "请打开设置检查模型配置。",
    });
  }
}
```

- [ ] **Step 4: Replace the JSX layout**

Replace the existing `return` body of `RunsPanel` with this simplified structure. Keep the existing helper functions below the component.

```tsx
return (
  <section className="runs-panel task-records-panel">
    <div className="panel-heading task-records-heading">
      <div>
        <h2>任务记录</h2>
        <p>看任务是否完成。需要处理时，直接给你下一步。</p>
      </div>
      <div className="task-records-heading-actions">
        <button className="secondary-action" type="button">
          打开会话
        </button>
        <button className="primary-action" type="button">
          新任务
        </button>
      </div>
    </div>

    {selectedRunRecord && selectedRunStatus && selectedRunAction && selectedRunSummary ? (
      <>
        <article className={`task-record-focus is-${selectedRunStatus.tone}`}>
          <div className="task-record-focus-main">
            <span className={`task-record-status is-${selectedRunStatus.tone}`}>
              {selectedRunStatus.label}
            </span>
            <h3>{selectedRunSummary.title}</h3>
            <p>{selectedRunSummary.outcome}</p>
          </div>
          <div className="task-record-next">
            <span>下一步</span>
            <strong>{selectedRunSummary.nextStep}</strong>
            <button
              className="primary-action"
              disabled={status.kind === "loading"}
              onClick={() => void handleRunRecordAction(selectedRunAction.primary)}
              type="button"
            >
              {selectedRunAction.primary.label}
            </button>
            <div className="task-record-secondary-actions">
              {selectedRunAction.secondary.map((action) => (
                <button
                  className="secondary-action"
                  disabled={status.kind === "loading"}
                  key={action.kind}
                  onClick={() => void handleRunRecordAction(action)}
                  type="button"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </article>

        <div className="task-record-mobile-tabs" role="tablist" aria-label="任务记录视图">
          <button
            className={activeRunsTab === "action" ? "is-active" : ""}
            onClick={() => setActiveRunsTab("action")}
            type="button"
          >
            处理
          </button>
          <button
            className={activeRunsTab === "history" ? "is-active" : ""}
            onClick={() => setActiveRunsTab("history")}
            type="button"
          >
            历史
          </button>
          <button
            className={activeRunsTab === "details" ? "is-active" : ""}
            onClick={() => setActiveRunsTab("details")}
            type="button"
          >
            详情
          </button>
        </div>

        <div className="task-records-content">
          <section
            className={`task-record-card task-record-history ${
              activeRunsTab === "history" ? "is-active-mobile" : ""
            }`}
            aria-label="最近任务"
          >
            <div className="task-record-card-header">
              <h3>最近任务</h3>
              <span>{recentRunItems.length} 次</span>
            </div>
            {activeExecutionItems.length ? (
              <div className="task-record-active-list" aria-label="正在进行">
                {activeExecutionItems.map((item) => (
                  <button
                    className="task-record-row is-active-execution"
                    key={`active-${item.id}`}
                    onClick={() => setSelectedRunId(item.id)}
                    type="button"
                  >
                    <span className={`task-record-status is-${item.status.tone}`}>
                      {item.status.label}
                    </span>
                    <strong>{item.title}</strong>
                    <small>{item.subtitle}</small>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="task-record-list">
              {recentRunItems.map((item) => (
                <button
                  className={`task-record-row ${
                    item.id === selectedRunRecord.id ? "is-selected" : ""
                  }`}
                  key={item.id}
                  onClick={() => setSelectedRunId(item.id)}
                  type="button"
                >
                  <span className={`task-record-status is-${item.status.tone}`}>
                    {item.status.label}
                  </span>
                  <strong>{item.title}</strong>
                  <small>{item.subtitle}</small>
                </button>
              ))}
            </div>
          </section>

          <section
            className={`task-record-card task-record-details ${
              activeRunsTab === "details" || activeRunsTab === "action"
                ? "is-active-mobile"
                : ""
            }`}
            aria-label="任务详情"
          >
            <div className="task-record-card-header">
              <h3>这次发生了什么</h3>
              <span>简版详情</span>
            </div>
            <div className="task-record-step-list">
              {selectedRunSummary.simpleSteps.length ? (
                selectedRunSummary.simpleSteps.map((step, index) => (
                  <article className={`task-record-step is-${step.tone}`} key={`${step.createdAt}-${index}`}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>{step.title}</strong>
                      <p>{step.detail}</p>
                    </div>
                    <time>{formatTime(step.createdAt)}</time>
                  </article>
                ))
              ) : (
                <p className="task-record-empty-copy">这次任务没有可查看的步骤。</p>
              )}
            </div>

            <div className="task-record-facts">
              <span>{selectedRunSummary.producedArtifacts ? "已生成产物" : "未生成产物"}</span>
              <span>{selectedRunSummary.wroteMemory ? "已写入记忆" : "未写入记忆"}</span>
              <span>{selectedRunSummary.technicalEventCount} 条技术事件</span>
            </div>

            <details
              className="task-record-technical-details"
              open={showTechnicalDetails}
              onToggle={(event) => setShowTechnicalDetails(event.currentTarget.open)}
            >
              <summary>技术详情</summary>
              <RunInspector
                canGenerateEvalCandidate={Boolean(
                  selectedRunRecord && isTerminalRun(selectedRunRecord),
                )}
                evalCandidate={selectedEvalCandidate}
                event={selectedEvent}
                guidance={guidance}
                isBusy={status.kind === "loading"}
                kernelEvents={selectedKernelEvents}
                onGenerateEvalCandidate={handleGenerateEvalCandidateForSelectedRun}
                run={selectedRunRecord}
                trajectoryEvents={trajectoryEvents}
              />
            </details>
          </section>
        </div>
      </>
    ) : (
      <section className="task-record-empty-state">
        <Icon name="task" size={28} />
        <h3>还没有任务记录</h3>
        <p>从会话里发起一个任务，完成后会在这里看到结果和步骤。</p>
        <button className="primary-action" type="button">
          打开会话
        </button>
      </section>
    )}

    <p className={`settings-message is-${status.kind}`}>{status.message}</p>
  </section>
);
```

- [ ] **Step 5: Adjust type guards**

Ensure `selectedRunRecord` is always an `AgentRunRecord` before passing to `RunInspector`.
If TypeScript complains because active checkpoints are not full run records, use `selectedRun` for inspector props:

```tsx
run={selectedRun}
canGenerateEvalCandidate={Boolean(selectedRun && isTerminalRun(selectedRun))}
```

The focus card still uses `selectedRunRecord`, but technical details require a historical run.

- [ ] **Step 6: Run component typecheck**

Run:

```bash
npm run build
```

Expected: TypeScript succeeds or reveals JSX/type errors to fix before continuing.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/renderer/components/RunsPanel.tsx
git commit -m "feat: simplify task records layout"
```

---

## Task 3: Collapse Technical Evidence And Bound Large Output

**Files:**
- Modify: `src/renderer/components/RunTrajectoryPanel.tsx`
- Modify: `src/renderer/components/RunsPanel.tsx`

- [ ] **Step 1: Update trajectory labels**

In `RunTrajectoryPanel.tsx`, change user-visible labels:

```tsx
<section className="trajectory-panel" aria-label="技术详情">
  <div className="section-heading">
    <span>技术事件</span>
    <small>{props.events.length} 条</small>
  </div>
```

For the empty state:

```tsx
<p>这次任务没有可查看的详细证据，可能来自旧版本或预览数据。</p>
```

For tool result refs:

```tsx
<span>工具结果</span>
```

- [ ] **Step 2: Bound raw previews with CSS class names**

Ensure the existing `<pre className="payload-preview">` remains, but it will be bounded by CSS in Task 4. Do not inline styles.

- [ ] **Step 3: Keep technical sections grouped**

In `RunInspector`, keep existing sections but rely on the parent `<details>` to hide them. Rename labels:

```tsx
<span className="inspector-label">下一步</span>
<span className="inspector-label">步骤详情</span>
<span className="inspector-label">证据链</span>
<span className="inspector-label">高级日志</span>
<span className="inspector-label">运行身份</span>
<span className="inspector-label">回归样例</span>
<span className="inspector-label">协作审核</span>
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- src/renderer/chatOutputModel.test.ts src/shared/agentRunInsights.test.ts
```

Expected: pass. These are smoke-adjacent tests for renderer output and run insight behavior.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/renderer/components/RunTrajectoryPanel.tsx src/renderer/components/RunsPanel.tsx
git commit -m "feat: collapse task record technical evidence"
```

---

## Task 4: CSS Layout, Alignment, And Responsive Behavior

**Files:**
- Modify: `src/renderer/styles/legacy.css`

- [ ] **Step 1: Replace old Runs layout rules**

In `src/renderer/styles/legacy.css`, replace the old `.runs-layout`, `.run-list-panel`, `.timeline-panel`, `.run-inspector`, `.run-summary-card`, and `.run-metrics` rules around the Runtime panel section with:

```css
.task-records-panel {
  max-width: 1120px;
  margin: 0 auto;
}

.task-records-heading {
  align-items: flex-start;
}

.task-records-heading-actions,
.task-record-secondary-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: flex-end;
}

.task-record-focus {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 300px);
  gap: var(--space-5);
  align-items: start;
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-2xl);
  background: var(--bg-surface);
  box-shadow: var(--shadow-sm);
}

.task-record-focus.is-attention {
  border-color: var(--status-warning-border);
  background: var(--status-warning-bg);
}

.task-record-focus.is-danger {
  border-color: var(--status-error-border);
  background: var(--status-error-bg);
}

.task-record-focus.is-success {
  border-color: var(--status-success-border);
  background: var(--status-success-bg);
}

.task-record-focus-main {
  min-width: 0;
}

.task-record-focus-main h3 {
  margin: var(--space-3) 0 var(--space-2);
  color: var(--text-primary);
  font-size: clamp(var(--text-2xl), 3vw, var(--text-4xl));
  line-height: var(--leading-tight);
  overflow-wrap: anywhere;
}

.task-record-focus-main p,
.task-record-next strong {
  color: var(--text-secondary);
  line-height: var(--leading-normal);
  overflow-wrap: anywhere;
}

.task-record-next {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: var(--radius-xl);
  background: rgba(255, 255, 255, 0.64);
}

.task-record-next > span,
.task-record-card-header span {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}

.task-record-status {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-height: 28px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  white-space: nowrap;
}

.task-record-status.is-attention {
  color: var(--status-warning-text);
  border-color: var(--status-warning-border);
  background: var(--status-warning-bg);
}

.task-record-status.is-danger {
  color: var(--status-error-text);
  border-color: var(--status-error-border);
  background: var(--status-error-bg);
}

.task-record-status.is-success {
  color: var(--status-success-text);
  border-color: var(--status-success-border);
  background: var(--status-success-bg);
}

.task-record-status.is-info {
  color: var(--text-accent);
  border-color: var(--border-accent);
  background: var(--bg-accent-muted);
}

.task-records-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 0.72fr);
  gap: var(--space-4);
  align-items: start;
  margin-top: var(--space-4);
}

.task-record-card {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-2xl);
  background: var(--bg-surface);
  overflow: hidden;
}

.task-record-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}

.task-record-card-header h3 {
  margin: 0;
  font-size: var(--text-lg);
}

.task-record-list,
.task-record-active-list,
.task-record-step-list {
  display: grid;
}

.task-record-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-2) var(--space-3);
  width: 100%;
  padding: var(--space-4);
  border: 0;
  border-bottom: 1px solid var(--border-subtle);
  background: transparent;
  color: inherit;
  text-align: left;
}

.task-record-row:last-child {
  border-bottom: 0;
}

.task-record-row:hover,
.task-record-row.is-selected {
  background: var(--bg-surface-hover);
}

.task-record-row strong,
.task-record-row small {
  min-width: 0;
  overflow-wrap: anywhere;
}

.task-record-row strong {
  color: var(--text-primary);
  font-size: var(--text-base);
}

.task-record-row small {
  grid-column: 2;
  color: var(--text-secondary);
  line-height: var(--leading-normal);
}

.task-record-step {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: start;
  padding: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}

.task-record-step:last-child {
  border-bottom: 0;
}

.task-record-step > span {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-subtle);
  background: var(--bg-surface-raised);
  color: var(--text-tertiary);
  font-weight: var(--font-semibold);
}

.task-record-step strong,
.task-record-step p {
  overflow-wrap: anywhere;
}

.task-record-step strong {
  display: block;
  color: var(--text-primary);
}

.task-record-step p {
  margin: var(--space-1) 0 0;
  color: var(--text-secondary);
  line-height: var(--leading-normal);
}

.task-record-step time {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  white-space: nowrap;
}

.task-record-facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: var(--space-4);
  border-top: 1px solid var(--border-subtle);
}

.task-record-facts span {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.task-record-technical-details {
  margin: 0 var(--space-4) var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  background: var(--bg-surface-raised);
}

.task-record-technical-details summary {
  cursor: pointer;
  font-weight: var(--font-semibold);
}

.task-record-technical-details .run-inspector {
  position: static;
  max-height: 560px;
  margin-top: var(--space-3);
  overflow: auto;
}

.task-record-mobile-tabs {
  display: none;
}

.task-record-empty-state {
  display: grid;
  justify-items: start;
  gap: var(--space-3);
  padding: var(--space-6);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-2xl);
  background: var(--bg-surface);
}

.task-record-empty-copy {
  margin: 0;
  padding: var(--space-4);
  color: var(--text-secondary);
}
```

- [ ] **Step 2: Add mobile rules**

In the existing responsive section around `@media (max-width: 760px)`, add:

```css
  .task-records-heading {
    gap: var(--space-4);
  }

  .task-records-heading-actions {
    justify-content: flex-start;
    width: 100%;
  }

  .task-record-focus {
    grid-template-columns: 1fr;
    padding: var(--space-4);
  }

  .task-record-next {
    width: 100%;
  }

  .task-record-mobile-tabs {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-1);
    margin-top: var(--space-4);
    padding: var(--space-1);
    border-radius: var(--radius-xl);
    background: var(--bg-surface-raised);
  }

  .task-record-mobile-tabs button {
    min-height: 44px;
    border: 0;
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--text-secondary);
    font-weight: var(--font-semibold);
  }

  .task-record-mobile-tabs button.is-active {
    background: var(--bg-surface);
    color: var(--text-primary);
    box-shadow: var(--shadow-xs);
  }

  .task-records-content {
    grid-template-columns: 1fr;
  }

  .task-record-card {
    display: none;
  }

  .task-record-card.is-active-mobile {
    display: block;
  }

  .task-record-row,
  .task-record-step {
    grid-template-columns: 1fr;
  }

  .task-record-row small,
  .task-record-step time {
    grid-column: auto;
  }
```

- [ ] **Step 3: Bound raw previews globally**

Ensure `.payload-preview` includes max height and wrap behavior:

```css
.payload-preview {
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 4: Run style-sensitive build**

Run:

```bash
npm run build
```

Expected: command exits with code 0 and produces `dist/` plus `dist-electron/` outputs.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/renderer/styles/legacy.css
git commit -m "style: polish task records responsive layout"
```

---

## Task 5: Visual QA, Harness, And Progress Evidence

**Files:**
- Modify: `.zerox/progress.md`

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- src/shared/runRecordViewModel.test.ts src/shared/navigation.test.ts
```

Expected: pass.

- [ ] **Step 2: Run project checks**

Run:

```bash
npm run harness:check
npm run verify
```

Expected: each command exits with code 0.

- [ ] **Step 3: Run smoke check if UI/runtime behavior changed**

Run:

```bash
npm run smoke:prod
```

Expected: pass. If it fails because of an environment issue, record the exact failure in `.zerox/progress.md`.

- [ ] **Step 4: Start the app for visual QA**

Run:

```bash
npm run dev
```

Expected: Vite starts at `http://127.0.0.1:5173`, TypeScript watch produces `dist-electron/main/main.js`, and Electron opens the desktop app.

- [ ] **Step 5: Capture desktop and mobile screenshots**

Use Playwright or the available browser tooling to capture:

- Desktop: `1440x900`
- Mobile: `390x844`

Manual QA checklist:

- No horizontal scrolling at `390px`.
- No card edges misaligned in the main content.
- Status pills do not overlap task titles.
- Long title wraps inside the focus card.
- Primary action button remains visible and readable.
- `技术详情` opens without stretching raw JSON beyond its panel.
- Recent task rows align consistently.

- [ ] **Step 6: Update progress evidence**

Append to `.zerox/progress.md`:

```md
## 2026-06-27 Runs module simplified redesign

Changed files:
- `src/shared/navigation.ts`
- `src/shared/runRecordViewModel.ts`
- `src/shared/runRecordViewModel.test.ts`
- `src/renderer/components/RunsPanel.tsx`
- `src/renderer/components/RunTrajectoryPanel.tsx`
- `src/renderer/styles/legacy.css`

Design source:
- `docs/superpowers/specs/2026-06-27-runs-module-simplified-redesign.md`

Verification:
- `npm test -- src/shared/runRecordViewModel.test.ts src/shared/navigation.test.ts` — PASS
- `npm run harness:check` — PASS
- `npm run verify` — PASS
- `npm run smoke:prod` — PASS or recorded failure reason
- Visual QA desktop `1440x900` — PASS, no overlap/misalignment
- Visual QA mobile `390x844` — PASS, no horizontal scroll or clipped actions
```

- [ ] **Step 7: Commit Task 5**

```bash
git add .zerox/progress.md
git commit -m "chore: record task records redesign verification"
```

---

## Self-Review

Spec coverage:

- Module rename: Task 1.
- Simplified default path: Task 2.
- State-driven actions: Task 1 and Task 2.
- Technical details hidden by default: Task 3.
- Layout quality gate: Task 4 and Task 5.
- Empty and edge states: Task 1 and Task 2.
- Verification and `.zerox/progress.md`: Task 5.

No known placeholders remain. Implementation must keep existing backend APIs intact and avoid modifying unrelated untracked files.
