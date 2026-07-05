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
  | "system-overview"
  | "model-settings"
  | "skills"
  | "tools"
  | "memory"
  | "learning"
  | "evals";

export type NavigationTargetId =
  | NavigationSectionId
  | SettingsNavigationSectionId;

export type SettingsNavigationPriority = "primary" | "safety" | "review";

export type NavigationSection = {
  id: NavigationSectionId;
  label: string;
  module: string;
  summary: string;
  details: string[];
};

export type SettingsNavigationSection = {
  id: SettingsNavigationSectionId;
  intent: string;
  label: string;
  module: string;
  priority: SettingsNavigationPriority;
  summary: string;
};

export type SettingsNavigationGroup = {
  id: string;
  label: string;
  summary: string;
  sectionIds: SettingsNavigationSectionId[];
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
  {
    id: "scheduled-tasks",
    label: "任务",
    module: "第 4 模块",
    summary: "每日、工作日、每周和间隔自动任务。",
    details: [
      "把调度规则保存成本地结构化数据。",
      "让自然语言任务描述成为自动执行的主要入口。",
      "记录应用不可用时错过的运行。",
    ],
  },
  {
    id: "settings",
    label: "设置",
    module: "配置",
    summary: "按模型连接、权限、记忆、审核和系统健康组织本地配置。",
    details: [
      "先完成模型连接，再进入权限和本地记忆配置。",
      "把高风险工具、可学习内容和评测样例放入可审计路径。",
      "系统健康保留为状态面板，不打断首次配置。",
    ],
  },
];

const settingsNavigationSections: SettingsNavigationSection[] = [
  {
    id: "model-settings",
    intent: "首次配置",
    label: "模型",
    module: "连接",
    priority: "primary",
    summary: "API Key、模型、embedding 和生成默认值。",
  },
  {
    id: "tools",
    intent: "安全边界",
    label: "工具",
    module: "权限",
    priority: "safety",
    summary: "文件、shell、web 和动态工具授权审计。",
  },
  {
    id: "memory",
    intent: "长期上下文",
    label: "记忆",
    module: "本地记忆",
    priority: "primary",
    summary: "必需记忆、系统长期记忆和待审核习惯。",
  },
  {
    id: "skills",
    intent: "扩展能力",
    label: "技能",
    module: "本地能力",
    priority: "primary",
    summary: "本地 SKILL.md 发现与执行元数据。",
  },
  {
    id: "learning",
    intent: "人工审核",
    label: "学习",
    module: "审核",
    priority: "review",
    summary: "从运行轨迹提取候选经验并等待用户确认。",
  },
  {
    id: "evals",
    intent: "回归质量",
    label: "评测",
    module: "审核",
    priority: "review",
    summary: "把已确认轨迹提升为固定回归样例。",
  },
  {
    id: "system-overview",
    intent: "系统状态",
    label: "系统",
    module: "状态",
    priority: "review",
    summary: "系统健康、最近运行、待处理问题和下一步动作。",
  },
];

const settingsNavigationGroups: SettingsNavigationGroup[] = [
  {
    id: "setup",
    label: "启动配置",
    summary: "先让智能体能稳定连接和执行。",
    sectionIds: ["model-settings"],
  },
  {
    id: "capability",
    label: "能力与边界",
    summary: "管理本地能力、权限和长期上下文。",
    sectionIds: ["tools", "memory", "skills"],
  },
  {
    id: "review",
    label: "审核与质量",
    summary: "保留用户确认和回归证据。",
    sectionIds: ["learning", "evals", "system-overview"],
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

export function getStartupNavigationTarget(hash: string): NavigationTargetId {
  const rawId = hash.replace(/^#/, "");
  const settingsId = resolveSettingsNavigationId(rawId);
  return settingsId ?? getStartupNavigationSection(hash).id;
}

export function getSettingsNavigationSections(): SettingsNavigationSection[] {
  return settingsNavigationSections;
}

export function getDefaultSettingsNavigationSection(): SettingsNavigationSection {
  return settingsNavigationSections[0];
}

export function getStartupSettingsNavigationSection(
  hash: string,
): SettingsNavigationSection {
  const settingsId = resolveSettingsNavigationId(hash.replace(/^#/, ""));
  return settingsId
    ? getSettingsNavigationSection(settingsId)
    : getDefaultSettingsNavigationSection();
}

export function getSettingsNavigationSection(
  id: SettingsNavigationSectionId,
): SettingsNavigationSection {
  return (
    settingsNavigationSections.find((section) => section.id === id) ??
    getDefaultSettingsNavigationSection()
  );
}

export function getSettingsNavigationGroups(): SettingsNavigationGroup[] {
  return settingsNavigationGroups;
}

function resolvePrimaryNavigationId(id: string): NavigationSectionId {
  if (id === "goals") {
    return "chat";
  }

  if (id === "overview") {
    return "settings";
  }

  if (
    settingsNavigationSections.some((section) => section.id === id)
  ) {
    return "settings";
  }

  return id as NavigationSectionId;
}

function resolveSettingsNavigationId(
  id: string,
): SettingsNavigationSectionId | null {
  if (id === "overview") {
    return "system-overview";
  }

  return settingsNavigationSections.some((section) => section.id === id)
    ? (id as SettingsNavigationSectionId)
    : null;
}
