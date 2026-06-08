export type AgentWorkPhase =
  | "idle"
  | "planning"
  | "memory"
  | "model"
  | "tool"
  | "paused"
  | "done"
  | "error";

export type AgentWorkStepStatus = "waiting" | "active" | "done" | "error";

export type AgentWorkStep = {
  id: string;
  label: string;
  detail: string;
  status: AgentWorkStepStatus;
};

const workStepDefinitions = [
  {
    id: "planning",
    label: "理解请求",
    detail: "判断目标、约束和下一步动作",
  },
  {
    id: "memory",
    label: "检索记忆",
    detail: "查找相关偏好、历史任务和上下文",
  },
  {
    id: "model",
    label: "调用模型",
    detail: "生成回复，必要时规划工具调用",
  },
  {
    id: "final",
    label: "整理回复",
    detail: "把结果、风险和下一步说清楚",
  },
] as const;

const activeStepByPhase: Record<AgentWorkPhase, number> = {
  idle: 0,
  planning: 0,
  memory: 1,
  model: 2,
  tool: 2,
  paused: 3,
  done: 4,
  error: 4,
};

export function buildAgentWorkSteps(phase: AgentWorkPhase): AgentWorkStep[] {
  const activeIndex = activeStepByPhase[phase];

  return workStepDefinitions.map((step, index) => ({
    ...step,
    status: getStepStatus({ phase, index, activeIndex }),
  }));
}

function getStepStatus(options: {
  phase: AgentWorkPhase;
  index: number;
  activeIndex: number;
}): AgentWorkStepStatus {
  if (options.phase === "error") {
    return options.index === 3 ? "error" : "done";
  }

  if (options.phase === "done") {
    return "done";
  }

  if (options.index < options.activeIndex) {
    return "done";
  }

  if (options.index === options.activeIndex) {
    return "active";
  }

  return "waiting";
}
