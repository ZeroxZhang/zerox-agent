import type { NavigationSectionId } from "./navigation";

export type MaterialNavigationIcon = {
  label: string;
  /** Legacy Unicode glyph kept as an accessibility/text fallback. */
  glyph: string;
  /** Rounded stroke SVG path data rendered in a 24x24 viewBox. */
  path: string;
};

const materialNavigationIcons: Record<
  NavigationSectionId,
  MaterialNavigationIcon
> = {
  chat: {
    label: "会话",
    glyph: "⌂",
    path: "M5 6.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H9l-4 3v-12.5Zm4 3.5h6M9 13h4",
  },
  overview: {
    label: "总览",
    glyph: "◇",
    path: "M4.5 5.5a1 1 0 0 1 1-1h4.5v5.5H4.5V5.5Zm9.5-1h4.5a1 1 0 0 1 1 1v4H14v-5ZM4.5 14h5.5v5.5H5.5a1 1 0 0 1-1-1V14Zm9.5 0h5.5v4.5a1 1 0 0 1-1 1H14V14Z",
  },
  goals: {
    label: "目标",
    glyph: "◎",
    path: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0-2a2.5 2.5 0 0 0 2.5-2.5",
  },
  runs: {
    label: "运行",
    glyph: "▶",
    path: "M5 12a7 7 0 1 0 2-4.9M5 5.5v4h4M11 9l5 3-5 3V9Z",
  },
  "scheduled-tasks": {
    label: "任务",
    glyph: "◷",
    path: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.5 2",
  },
  skills: {
    label: "技能",
    glyph: "✦",
    path: "M12 3.5 13.9 8l4.9.4-3.7 3.1 1.1 4.8-4.2-2.5-4.2 2.5 1.1-4.8-3.7-3.1L10.1 8 12 3.5Z",
  },
  tools: {
    label: "工具",
    glyph: "⌘",
    path: "M4 7h16M4 12h16M4 17h16M8 5v4M15 10v4M11 15v4",
  },
  memory: {
    label: "记忆",
    glyph: "◌",
    path: "M8 8h8v8H8V8ZM5 10h3M5 14h3M16 10h3M16 14h3M10 5v3M14 5v3M10 16v3M14 16v3",
  },
  learning: {
    label: "学习",
    glyph: "✓",
    path: "M12 5 3 9.5l9 4.5 9-4.5L12 5ZM7 12.5V16l5 3 5-3v-3.5",
  },
  evals: {
    label: "评测",
    glyph: "▣",
    path: "M6 4.5h12a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5ZM8.5 16v-4M12 16V8M15.5 16v-6",
  },
  settings: {
    label: "设置",
    glyph: "⚙",
    path: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM4 12h2M18 12h2M12 4v2M12 18v2M6.6 6.6 8 8M16 16l1.4 1.4M17.4 6.6 16 8M8 16l-1.4 1.4",
  },
};

export function getMaterialNavigationIcon(
  sectionId: NavigationSectionId,
): MaterialNavigationIcon {
  return materialNavigationIcons[sectionId];
}
