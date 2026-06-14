import { describe, expect, it } from "vitest";
import { buildAgentReadinessChecklist } from "./agentReadiness";
import type { AgentRunRecord } from "./agentRuns";
import type { AgentBootstrapValidationReport } from "./agentBootstrap";
import type { MemoryRecord } from "./memory";
import type { PublicModelSettings } from "./modelSettings";
import type { ScheduledTask } from "./scheduledTasks";

describe("agent readiness checklist", () => {
  it("builds an actionable first-run checklist before validation", () => {
    const checklist = buildAgentReadinessChecklist({
      modelSettings: createModelSettings({ hasApiKey: false, chatModel: "" }),
      tasks: [],
      runs: [],
      memories: [],
      skillCount: 0,
    });

    expect(checklist.ready).toBe(false);
    expect(checklist.completeCount).toBe(0);
    expect(checklist.totalCount).toBe(5);
    expect(checklist.items).toEqual([
      {
        id: "model",
        label: "模型配置",
        status: "needs_action",
        message: "还没有保存对话模型和模型密钥。",
        actionLabel: "配置模型",
        target: "settings",
      },
      {
        id: "skill",
        label: "内置技能",
        status: "needs_action",
        message: "还没有发现本地技能。",
        actionLabel: "扫描技能",
        target: "skills",
      },
      {
        id: "task",
        label: "默认任务",
        status: "needs_action",
        message: "还没有默认文件整理任务。",
        actionLabel: "一键准备",
        target: "overview",
      },
      {
        id: "connection",
        label: "模型连接",
        status: "pending",
        message: "等待一键验收运行测试模型连接。",
        actionLabel: "一键验收运行",
        target: "overview",
      },
      {
        id: "run",
        label: "首次运行",
        status: "pending",
        message: "等待默认任务完成一次验收运行。",
        actionLabel: "一键验收运行",
        target: "overview",
      },
    ]);
  });

  it("uses validation report evidence for connection and first-run readiness", () => {
    const checklist = buildAgentReadinessChecklist({
      modelSettings: createModelSettings({ hasApiKey: true, chatModel: "qwen-plus" }),
      tasks: [createTask()],
      runs: [],
      memories: [createMemory()],
      skillCount: 1,
      report: createValidationReport(),
    });

    expect(checklist.ready).toBe(true);
    expect(checklist.completeCount).toBe(5);
    expect(checklist.items.map((item) => item.status)).toEqual([
      "ready",
      "ready",
      "ready",
      "ready",
      "ready",
    ]);
    expect(checklist.items.at(-1)).toMatchObject({
      id: "run",
      message: "默认文件整理任务已验收运行。",
    });
  });
});

function createModelSettings(
  partial: Partial<PublicModelSettings>,
): PublicModelSettings {
  return {
    baseUrl: "https://api.example.com/v1",
    chatModel: "qwen-plus",
    embeddingModel: "",
    temperature: 0.2,
    maxTokens: 8192,
    thinkingEnabled: false,
    thinkingBudgetTokens: 8192,
    hasApiKey: true,
    updatedAt: "2026-06-06T08:00:00.000Z",
    ...partial,
  };
}

function createTask(partial: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task_1",
    name: "整理下载文件夹",
    skillName: "local-file-organizer",
    enabled: true,
    schedule: { kind: "manual" },
    input: { targetDir: "~/Downloads" },
    permissions: {
      files: { read: ["~/Downloads"], write: ["~/Downloads"] },
      web: { search: false, fetchDomains: [] },
      shell: { commands: [] },
    },
    createdAt: "2026-06-06T08:00:00.000Z",
    updatedAt: "2026-06-06T08:00:00.000Z",
    lastRunAt: null,
    nextRunAt: null,
    ...partial,
  };
}

function createRun(partial: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: "run_1",
    taskId: "task_1",
    taskName: "整理下载文件夹",
    skillName: "local-file-organizer",
    status: "succeeded",
    summary: "默认文件整理任务已验收运行。",
    events: [],
    startedAt: "2026-06-06T08:00:00.000Z",
    finishedAt: "2026-06-06T08:00:01.000Z",
    ...partial,
  };
}

function createMemory(): MemoryRecord {
  return {
    id: "memory_1",
    kind: "episodic",
    title: "运行：整理下载文件夹",
    content: "默认任务已经完成首次验收运行。",
    tags: ["验收运行"],
    source: { type: "agent_run", refId: "run_1" },
    importance: 3,
    createdAt: "2026-06-06T08:00:01.000Z",
    updatedAt: "2026-06-06T08:00:01.000Z",
  };
}

function createValidationReport(): AgentBootstrapValidationReport {
  const task = createTask();
  const run = createRun({ taskId: task.id });
  return {
    ready: true,
    model: { ready: true, message: "模型配置已就绪。" },
    skill: { ready: true, message: "内置文件整理技能已就绪。" },
    task: {
      ready: true,
      created: false,
      task,
      message: "默认文件整理任务已存在。",
    },
    connection: {
      ready: true,
      checked: true,
      latencyMs: 42,
      message: "模型连接测试成功。",
    },
    run: {
      ready: true,
      ran: true,
      run,
      message: "默认文件整理任务已验收运行。",
    },
  };
}
