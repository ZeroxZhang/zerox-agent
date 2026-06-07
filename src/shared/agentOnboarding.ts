import type { AgentReadinessChecklist, AgentReadinessItem } from "./agentReadiness";
import type { NavigationSectionId } from "./navigation";

export type AgentOnboardingAction = {
  id:
    | "configure_model"
    | "prepare_agent"
    | "validate_agent"
    | "open_chat"
    | "open_runs";
  label: string;
  target: NavigationSectionId;
  command?: "prepare" | "validate";
};

export type AgentOnboardingState = {
  tone: "blocked" | "setup" | "validate" | "ready";
  title: string;
  message: string;
  primaryAction: AgentOnboardingAction;
  secondaryAction?: AgentOnboardingAction;
};

export function buildAgentOnboardingState(
  checklist: AgentReadinessChecklist,
  lastValidatedAt?: string,
): AgentOnboardingState {
  const model = findItem(checklist, "model");
  if (model?.status !== "ready") {
    return {
      tone: "blocked",
      title: "先配置模型",
      message: "保存对话模型和模型密钥后，本地智能体才能开始调用大模型。",
      primaryAction: {
        id: "configure_model",
        label: "配置模型",
        target: "settings",
      },
      secondaryAction: {
        id: "open_chat",
        label: "回到会话",
        target: "chat",
      },
    };
  }

  const skill = findItem(checklist, "skill");
  const task = findItem(checklist, "task");
  if (skill?.status !== "ready" || task?.status !== "ready") {
    return {
      tone: "setup",
      title: "准备默认能力",
      message: "先创建内置文件整理任务，让本地智能体有一个可验证的执行路径。",
      primaryAction: {
        id: "prepare_agent",
        label: "一键准备",
        target: "overview",
        command: "prepare",
      },
      secondaryAction: {
        id: "open_chat",
        label: "回到会话",
        target: "chat",
      },
    };
  }

  const connection = findItem(checklist, "connection");
  const run = findItem(checklist, "run");
  if (connection?.status !== "ready" || run?.status !== "ready") {
    return {
      tone: "validate",
      title: "做一次验收运行",
      message: "测试模型连接，并运行默认文件整理任务，确认本地智能体真的能工作。",
      primaryAction: {
        id: "validate_agent",
        label: "一键验收运行",
        target: "overview",
        command: "validate",
      },
      secondaryAction: {
        id: "open_runs",
        label: "查看运行",
        target: "runs",
      },
    };
  }

  return {
    tone: "ready",
    title: "本地智能体已可使用",
    message: lastValidatedAt
      ? "最近验收已通过。现在可以直接在会话里发任务，或查看运行记录。"
      : "正式可用检查已通过。现在可以直接在会话里发任务，或查看运行记录。",
    primaryAction: {
      id: "open_chat",
      label: "开始会话",
      target: "chat",
    },
    secondaryAction: {
      id: "open_runs",
      label: "查看运行",
      target: "runs",
    },
  };
}

function findItem(
  checklist: AgentReadinessChecklist,
  id: AgentReadinessItem["id"],
): AgentReadinessItem | undefined {
  return checklist.items.find((item) => item.id === id);
}
