export type NavigationSectionId =
  | "chat"
  | "overview"
  | "runs"
  | "skills"
  | "scheduled-tasks"
  | "tools"
  | "memory"
  | "learning"
  | "settings";

export type NavigationSection = {
  id: NavigationSectionId;
  label: string;
  module: string;
  summary: string;
  details: string[];
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
    id: "skills",
    label: "技能",
    module: "第 3 模块",
    summary: "本地 SKILL.md 发现与执行元数据。",
    details: [
      "从批准的位置扫描技能文件夹。",
      "把 frontmatter 解析成稳定的 manifest。",
      "在同一个库中展示智能体型和脚本型技能。",
    ],
  },
  {
    id: "tools",
    label: "工具",
    module: "第 5 模块",
    summary: "文件、shell、web_search 和 web_fetch 权限。",
    details: [
      "自动执行前按任务授权工具。",
      "每一次工具调用都检查任务权限清单。",
      "为文件、shell 和网络访问写入审计日志。",
    ],
  },
  {
    id: "memory",
    label: "记忆",
    module: "第 8 模块",
    summary: "支持 embedding 和导出的本地长期记忆。",
    details: [
      "区分 session、core、semantic、episodic 和 procedural memory。",
      "使用 embedding 做语义检索。",
      "让记忆可查看、可编辑、可删除、可导出。",
    ],
  },
  {
    id: "learning",
    label: "学习",
    module: "审核",
    summary: "从运行轨迹提取候选经验，并由用户审核后写入记忆。",
    details: [
      "查看待审核的流程记忆、失败教训和技能改进建议。",
      "接受或拒绝每条候选经验，避免静默改变 Agent 行为。",
      "把已接受的流程经验应用为可检索的 procedural memory。",
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

export function getNavigationSections(): NavigationSection[] {
  return navigationSections;
}

export function getDefaultNavigationSection(): NavigationSection {
  return navigationSections[0];
}

export function getNavigationSection(id: string): NavigationSection {
  return (
    navigationSections.find((section) => section.id === id) ??
    getDefaultNavigationSection()
  );
}

export function getStartupNavigationSection(_hash: string): NavigationSection {
  return getDefaultNavigationSection();
}
