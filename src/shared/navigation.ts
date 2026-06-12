export type NavigationSectionId =
  | "chat"
  | "overview"
  | "goals"
  | "runs"
  | "skills"
  | "scheduled-tasks"
  | "tools"
  | "memory"
  | "learning"
  | "evals"
  | "settings";

export type SettingsNavigationSectionId =
  | "model-settings"
  | "skills"
  | "tools"
  | "memory"
  | "learning"
  | "evals";

export type NavigationSection = {
  id: NavigationSectionId;
  label: string;
  module: string;
  summary: string;
  details: string[];
};

export type SettingsNavigationSection = {
  id: SettingsNavigationSectionId;
  label: string;
  module: string;
  summary: string;
};

const navigationSections: NavigationSection[] = [
  {
    id: "chat",
    label: "会话",
    module: "智能体工作台",
    summary: "和本地智能体对话，选择技能，触发任务，并查看上下文。",
    details: [
      "把对话窗口作为第一入口，而不是只展示后台控制台。",
      "在会话中展示模型、技能、任务、记忆和工具状态。",
      "让用户能从自然语言开始，再进入运行时间线排查细节。",
    ],
  },
  {
    id: "overview",
    label: "总览",
    module: "指挥中心",
    summary: "系统健康、最近运行、待处理问题和下一步动作。",
    details: [
      "查看本地智能体是否已经准备好工作。",
      "一眼看到最近运行、调度器和记忆状态。",
      "直接跳到能解决问题的页面。",
    ],
  },
  {
    id: "runs",
    label: "运行",
    module: "可观测性",
    summary: "运行历史、事件时间线、工具载荷和失败指引。",
    details: [
      "按顺序回放模型、权限、工具和记忆事件。",
      "不离开指挥中心就能检查选中的运行。",
      "把常见失败转成具体下一步动作。",
    ],
  },
  {
    id: "scheduled-tasks",
    label: "任务",
    module: "第 4 模块",
    summary: "手动运行、每日计划、间隔计划和 cron。",
    details: [
      "把调度规则保存成本地结构化数据。",
      "让手动运行和自动运行走同一条执行路径。",
      "记录应用不可用时错过的运行。",
    ],
  },
  {
    id: "settings",
    label: "设置",
    module: "配置",
    summary: "OpenAI-compatible 对话、embedding、密钥和运行默认值。",
    details: [
      "保存 base URL、模型名和运行默认值。",
      "用本地桌面存储加密 API Key。",
      "把对话和 embedding 设置放在同一个操作界面。",
    ],
  },
];

const settingsNavigationSections: SettingsNavigationSection[] = [
  {
    id: "model-settings",
    label: "模型",
    module: "配置",
    summary: "OpenAI-compatible 对话、embedding、密钥和运行默认值。",
  },
  {
    id: "skills",
    label: "技能",
    module: "本地能力",
    summary: "本地 SKILL.md 发现与执行元数据。",
  },
  {
    id: "tools",
    label: "工具",
    module: "权限",
    summary: "文件、shell、web_search 和 web_fetch 权限。",
  },
  {
    id: "memory",
    label: "记忆",
    module: "本地记忆",
    summary: "支持 embedding 和导出的本地长期记忆。",
  },
  {
    id: "learning",
    label: "学习",
    module: "审核",
    summary: "从运行轨迹提取候选经验，并由用户审核后写入记忆。",
  },
  {
    id: "evals",
    label: "评测",
    module: "审核",
    summary: "审核运行轨迹生成的评测候选，并提升为固定回归样例。",
  },
];

export function getNavigationSections(): NavigationSection[] {
  return navigationSections;
}

export function getDefaultNavigationSection(): NavigationSection {
  return navigationSections[0];
}

export function getNavigationSection(id: string): NavigationSection {
  const primaryId = resolvePrimaryNavigationId(id);
  return (
    navigationSections.find((section) => section.id === primaryId) ??
    getDefaultNavigationSection()
  );
}

export function getStartupNavigationSection(hash: string): NavigationSection {
  return getNavigationSection(hash.replace(/^#/, ""));
}

export function getSettingsNavigationSections(): SettingsNavigationSection[] {
  return settingsNavigationSections;
}

export function getDefaultSettingsNavigationSection(): SettingsNavigationSection {
  return settingsNavigationSections[0];
}

function resolvePrimaryNavigationId(id: string): NavigationSectionId {
  if (id === "goals") {
    return "chat";
  }

  if (
    settingsNavigationSections.some((section) => section.id === id) &&
    id !== "model-settings"
  ) {
    return "settings";
  }

  return id as NavigationSectionId;
}
