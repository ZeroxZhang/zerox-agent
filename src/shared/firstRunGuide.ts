import type { AgentReadinessChecklist, AgentReadinessItem } from "./agentReadiness";
import type { AgentDataMode } from "./dataBoundary";
import type { NavigationSectionId } from "./navigation";

export type FirstRunGuideStepStatus = "done" | "active" | "locked";

export type FirstRunGuideAction = {
  id: "configure_model" | "prepare_agent" | "validate_agent" | "open_chat";
  label: string;
  target: NavigationSectionId;
  command?: "prepare" | "validate";
};

export type FirstRunGuideStep = {
  id: "model" | "prepare" | "validate";
  label: string;
  message: string;
  status: FirstRunGuideStepStatus;
};

export type FirstRunGuide = {
  title: string;
  message: string;
  modeLabel: string;
  progressLabel: string;
  primaryAction: FirstRunGuideAction;
  steps: FirstRunGuideStep[];
};

export function buildFirstRunGuide(
  checklist: AgentReadinessChecklist,
  mode: AgentDataMode,
): FirstRunGuide {
  const modelDone = itemIsReady(checklist, "model");
  const prepareDone =
    itemIsReady(checklist, "skill") && itemIsReady(checklist, "task");
  const validateDone =
    itemIsReady(checklist, "connection") && itemIsReady(checklist, "run");
  const progress = [modelDone, prepareDone, validateDone].filter(Boolean).length;

  if (!modelDone) {
    return buildGuide({
      title: "首次启动：先连接你的大模型",
      message:
        "先保存模型配置。Zerox 需要可用模型，才能安全地规划本地工作流并调用受控工具。",
      mode,
      progress,
      primaryAction: {
        id: "configure_model",
        label: "配置模型",
        target: "settings",
      },
      statuses: ["active", "locked", "locked"],
    });
  }

  if (!prepareDone) {
    return buildGuide({
      title: "首次启动：选择本地工作流",
      message:
        "选择一个真实的本地文件整理工作流，并在运行前确认它只访问授权目录。",
      mode,
      progress,
      primaryAction: {
        id: "prepare_agent",
        label: "一键准备",
        target: "overview",
        command: "prepare",
      },
      statuses: ["done", "active", "locked"],
    });
  }

  if (!validateDone) {
    return buildGuide({
      title: "首次启动：验收可恢复运行",
      message:
        "测试模型连接并运行默认任务，确认工具权限、运行日志和恢复路径都可检查。",
      mode,
      progress,
      primaryAction: {
        id: "validate_agent",
        label: "一键验收运行",
        target: "overview",
        command: "validate",
      },
      statuses: ["done", "done", "active"],
    });
  }

  return buildGuide({
    title: "本地控制台已可接管任务",
    message:
      "首次启动检查已通过。现在可以在会话里交给 Zerox 一个可观察、可取消、可复盘的本地任务。",
    mode,
    progress,
    primaryAction: {
      id: "open_chat",
      label: "开始使用",
      target: "chat",
    },
    statuses: ["done", "done", "done"],
  });
}

function buildGuide(options: {
  title: string;
  message: string;
  mode: AgentDataMode;
  progress: number;
  primaryAction: FirstRunGuideAction;
  statuses: [FirstRunGuideStepStatus, FirstRunGuideStepStatus, FirstRunGuideStepStatus];
}): FirstRunGuide {
  return {
    title: options.title,
    message: options.message,
    modeLabel: options.mode === "desktop" ? "正式本地数据" : "演示数据预览",
    progressLabel: `${options.progress}/3`,
    primaryAction: options.primaryAction,
    steps: [
      {
        id: "model",
        label: "连接模型",
        message: "保存 Base URL、对话模型和 API Key。",
        status: options.statuses[0],
      },
      {
        id: "prepare",
        label: "选择工作流并审核权限",
        message: "选择一个真实本地任务，检查技能、目标目录和工具权限。",
        status: options.statuses[1],
      },
      {
        id: "validate",
        label: "验收可恢复运行",
        message: "确认模型连接、工具调用、运行日志和恢复路径。",
        status: options.statuses[2],
      },
    ],
  };
}

function itemIsReady(
  checklist: AgentReadinessChecklist,
  id: AgentReadinessItem["id"],
): boolean {
  return checklist.items.find((item) => item.id === id)?.status === "ready";
}
