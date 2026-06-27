import type { AgentBootstrapValidationSnapshot } from "../shared/agentBootstrap";
import type { AgentEvalReport } from "../shared/agentEval";
import type { AgentLearningCandidate } from "../shared/agentLearning";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { MemoryRecord } from "../shared/memory";
import type { PublicModelSettings } from "../shared/modelSettings";
import type { ScheduledTask } from "../shared/scheduledTasks";

export const demoRuns: AgentRunRecord[] = [
  {
    id: "demo_run_1",
    taskId: "demo_task_1",
    taskName: "整理下载文件夹",
    skillName: "local-file-organizer",
    status: "succeeded",
    runContext: {
      workspaceId: "workspace_demo",
      workspaceRoot: "/Users/demo/Zerox/workspaces/default",
      sandbox: {
        mode: "workspace_write",
        network: "task_policy",
        shell: "approved_commands",
        allowWorkspaceEscape: false,
        extraReadRoots: [],
        extraWriteRoots: [],
      },
      sessionId: "session_demo",
      agentRole: "primary",
      depth: 0,
    },
    childRunIds: ["demo_run_3"],
    summary: "已生成 Markdown 报告，并写入一条情景记忆。",
    events: [
      {
        level: "info",
        message: "智能体运行开始",
        createdAt: "2026-06-05T08:00:00.000Z",
      },
      {
        level: "info",
        message: "收到模型响应",
        data: { turn: 0 },
        createdAt: "2026-06-05T08:00:02.000Z",
      },
      {
        level: "info",
        message: "工具调用已授权",
        data: { toolName: "file_read" },
        createdAt: "2026-06-05T08:00:03.000Z",
      },
      {
        level: "info",
        message: "工具调用已执行",
        data: { toolName: "file_read" },
        createdAt: "2026-06-05T08:00:04.000Z",
      },
      {
        level: "info",
        message: "已写入情景记忆",
        data: { memoryKind: "episodic" },
        createdAt: "2026-06-05T08:00:05.000Z",
      },
      {
        level: "info",
        message: "智能体运行结束",
        createdAt: "2026-06-05T08:00:06.000Z",
      },
    ],
    startedAt: "2026-06-05T08:00:00.000Z",
    finishedAt: "2026-06-05T08:00:06.000Z",
  },
  {
    id: "demo_run_2",
    taskId: "demo_task_2",
    taskName: "抓取市场笔记",
    skillName: "research-summarizer",
    status: "failed",
    summary: "工具调用被拒绝：web_fetch 的域名不在允许列表中。",
    events: [
      {
        level: "info",
        message: "智能体运行开始",
        createdAt: "2026-06-05T07:30:00.000Z",
      },
      {
        level: "info",
        message: "收到模型响应",
        data: { turn: 0 },
        createdAt: "2026-06-05T07:30:02.000Z",
      },
      {
        level: "error",
        message: "工具调用被拒绝：web_fetch 的域名不在允许列表中。",
        data: { toolName: "web_fetch" },
        createdAt: "2026-06-05T07:30:03.000Z",
      },
    ],
    startedAt: "2026-06-05T07:30:00.000Z",
    finishedAt: "2026-06-05T07:30:03.000Z",
  },
  {
    id: "demo_run_3",
    taskId: "demo_task_1",
    taskName: "整理下载文件夹 / executor",
    skillName: "local-file-organizer",
    status: "succeeded",
    runContext: {
      workspaceId: "workspace_demo",
      workspaceRoot: "/Users/demo/Zerox/workspaces/default",
      sandbox: {
        mode: "workspace_write",
        network: "task_policy",
        shell: "approved_commands",
        allowWorkspaceEscape: false,
        extraReadRoots: [],
        extraWriteRoots: [],
      },
      parentRunId: "demo_run_1",
      sessionId: "session_demo",
      agentRole: "executor",
      depth: 1,
    },
    summary: "子运行完成文件读取，并把结果交还给主运行。",
    events: [
      {
        level: "info",
        message: "子智能体运行开始",
        createdAt: "2026-06-05T08:00:01.000Z",
      },
      {
        level: "info",
        message: "子智能体完成工具执行",
        data: { toolName: "file_read" },
        createdAt: "2026-06-05T08:00:04.000Z",
      },
    ],
    startedAt: "2026-06-05T08:00:01.000Z",
    finishedAt: "2026-06-05T08:00:04.000Z",
  },
];

export const demoTasks: ScheduledTask[] = [
  {
    id: "demo_task_1",
    name: "整理下载文件夹",
    skillName: "",
    enabled: true,
    schedule: { kind: "daily", time: "09:00" },
    input: { targetDir: "~/Downloads", reportName: "agent-report.md" },
    permissions: {
      files: { read: ["~/Downloads"], write: ["~/Downloads"] },
      web: { search: false, fetchDomains: [] },
      shell: { commands: [] },
      memory: { read: false, write: false },
    },
    createdAt: "2026-06-05T08:00:00.000Z",
    updatedAt: "2026-06-05T08:00:00.000Z",
    lastRunAt: "2026-06-05T08:00:00.000Z",
    nextRunAt: "2026-06-06T09:00:00.000Z",
  },
];

export const demoMemories: MemoryRecord[] = [
  {
    id: "demo_memory_1",
    kind: "episodic",
    title: "运行：整理下载文件夹",
    content: "文件整理 skill 已生成报告，并写入运行摘要。",
    tags: ["智能体运行", "downloads"],
    source: { type: "agent_run", refId: "demo_run_1" },
    importance: 3,
    createdAt: "2026-06-05T08:00:06.000Z",
    updatedAt: "2026-06-05T08:00:06.000Z",
  },
];

export const demoLearningCandidates: AgentLearningCandidate[] = [
  {
    id: "demo_learning_1",
    type: "procedural_memory",
    status: "pending_review",
    sourceRunId: "demo_run_1",
    sourceTrajectoryEventIds: ["demo_event_tool_list", "demo_event_tool_read"],
    claim: "整理下载目录时，先列出目录再读取候选文件。",
    recommendedAction: "审核后写入流程记忆，用于后续本地文件整理任务。",
    risk: "低风险；只影响计划提示，不会自动执行未授权工具。",
    createdAt: "2026-06-05T08:00:07.000Z",
    updatedAt: "2026-06-05T08:00:07.000Z",
  },
];

export const demoAgentEvalReport: AgentEvalReport = {
  total: 7,
  passed: 7,
  failed: 0,
  passRate: 1,
  toolSuccessRate: 0.8,
  recoverabilityRate: 1,
  failures: [],
};

export const demoModelSettings: PublicModelSettings = {
  baseUrl: "https://api.example.com/v1",
  chatModel: "qwen-plus",
  embeddingModel: "text-embedding-model",
  hasApiKey: true,
  maxTokens: 8192,
  temperature: 0.2,
  thinkingEnabled: false,
  thinkingBudgetTokens: 8192,
  updatedAt: "2026-06-05T08:00:00.000Z",
};

export function createDemoValidationSnapshot(
  validatedAt = new Date().toISOString(),
): AgentBootstrapValidationSnapshot {
  return {
    validatedAt,
    report: {
      ready: true,
      model: { ready: true, message: "浏览器预览：模型配置已就绪。" },
      skill: { ready: true, message: "浏览器预览：内置文件整理技能已就绪。" },
      task: {
        ready: true,
        created: false,
        task: demoTasks[0] ?? null,
        message: "浏览器预览：默认文件整理任务已存在。",
      },
      connection: {
        ready: true,
        checked: true,
        latencyMs: 0,
        message: "浏览器预览：模型连接测试通过。",
      },
      run: {
        ready: true,
        ran: true,
        run: demoRuns[0] ?? null,
        message: "浏览器预览：默认任务已验收运行。",
      },
    },
  };
}
