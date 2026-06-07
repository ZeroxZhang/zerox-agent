import type { AgentRunRecord } from "./agentRuns";
import type { AgentBootstrapValidationReport } from "./agentBootstrap";
import type { MemoryRecord } from "./memory";
import type { PublicModelSettings } from "./modelSettings";
import type { NavigationSectionId } from "./navigation";
import type { ScheduledTask } from "./scheduledTasks";

export type AgentReadinessItemStatus = "ready" | "pending" | "needs_action";

export type AgentReadinessItem = {
  id: "model" | "skill" | "task" | "connection" | "run";
  label: string;
  status: AgentReadinessItemStatus;
  message: string;
  actionLabel: string;
  target: NavigationSectionId;
};

export type AgentReadinessChecklist = {
  ready: boolean;
  completeCount: number;
  totalCount: number;
  items: AgentReadinessItem[];
};

export function buildAgentReadinessChecklist(_options: {
  modelSettings: PublicModelSettings;
  tasks: ScheduledTask[];
  runs: AgentRunRecord[];
  memories: MemoryRecord[];
  skillCount: number;
  report?: AgentBootstrapValidationReport;
}): AgentReadinessChecklist {
  const options = _options;
  const defaultTask = options.tasks.find(isDefaultFileOrganizerTask);
  const successfulDefaultRun = options.runs.find(
    (run) =>
      run.skillName === "local-file-organizer" &&
      run.taskName === "整理下载文件夹" &&
      run.status === "succeeded",
  );
  const hasModel = Boolean(
    options.report?.model.ready ||
      (options.modelSettings.chatModel && options.modelSettings.hasApiKey),
  );
  const hasSkill = Boolean(options.report?.skill.ready || options.skillCount > 0);
  const hasTask = Boolean(options.report?.task.ready || defaultTask);
  const connection = options.report?.connection;
  const validatedRun = options.report?.run;
  const items: AgentReadinessItem[] = [
    {
      id: "model",
      label: "模型配置",
      status: hasModel ? "ready" : "needs_action",
      message: hasModel
        ? "模型配置已就绪。"
        : "还没有保存对话模型和模型密钥。",
      actionLabel: hasModel ? "查看设置" : "配置模型",
      target: "settings",
    },
    {
      id: "skill",
      label: "内置技能",
      status: hasSkill ? "ready" : "needs_action",
      message: hasSkill ? "内置文件整理技能已就绪。" : "还没有发现本地技能。",
      actionLabel: hasSkill ? "查看技能" : "扫描技能",
      target: "skills",
    },
    {
      id: "task",
      label: "默认任务",
      status: hasTask ? "ready" : "needs_action",
      message: hasTask ? "默认文件整理任务已存在。" : "还没有默认文件整理任务。",
      actionLabel: hasTask ? "查看任务" : "一键准备",
      target: hasTask ? "scheduled-tasks" : "overview",
    },
    {
      id: "connection",
      label: "模型连接",
      status: connection
        ? connection.ready
          ? "ready"
          : "needs_action"
        : "pending",
      message: connection?.message ?? "等待一键验收运行测试模型连接。",
      actionLabel: connection?.ready ? "重新验收运行" : "一键验收运行",
      target: "overview",
    },
    {
      id: "run",
      label: "首次运行",
      status: validatedRun
        ? validatedRun.ready
          ? "ready"
          : "needs_action"
        : successfulDefaultRun
        ? "ready"
        : "pending",
      message:
        validatedRun?.message ??
        (successfulDefaultRun
          ? "默认文件整理任务已完成过一次。"
          : "等待默认任务完成一次验收运行。"),
      actionLabel:
        validatedRun?.ready || successfulDefaultRun
          ? "查看运行记录"
          : "一键验收运行",
      target: validatedRun?.ready || successfulDefaultRun ? "runs" : "overview",
    },
  ];
  const completeCount = items.filter((item) => item.status === "ready").length;

  return {
    ready: completeCount === items.length,
    completeCount,
    totalCount: items.length,
    items,
  };
}

function isDefaultFileOrganizerTask(task: ScheduledTask): boolean {
  return (
    task.name === "整理下载文件夹" &&
    task.skillName === "local-file-organizer"
  );
}
