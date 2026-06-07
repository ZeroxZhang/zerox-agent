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
      message: "保存模型配置后，本地智能体才能进行真实推理和工具调用。",
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
      title: "首次启动：准备默认能力",
      message: "创建内置文件整理任务，给本地智能体一条可验证的执行路径。",
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
      title: "首次启动：做一次验收运行",
      message: "测试模型连接，并运行默认任务，确认桌面端真的能完成工作。",
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
    title: "本地智能体已正式可用",
    message: "首次启动检查已通过。现在可以直接在会话里发任务。",
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
        label: "准备默认能力",
        message: "扫描内置技能并创建默认文件整理任务。",
        status: options.statuses[1],
      },
      {
        id: "validate",
        label: "验收运行",
        message: "测试模型连接并完成一次默认任务运行。",
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
