import type { NavigationSectionId } from "./navigation";

export type MaterialNavigationIcon = {
  label: string;
  /** Legacy Unicode glyph kept as an accessibility/text fallback. */
  glyph: string;
  /** Material Symbols style SVG path data rendered in a 24x24 viewBox. */
  path: string;
};

const materialNavigationIcons: Record<
  NavigationSectionId,
  MaterialNavigationIcon
> = {
  // chat bubble
  chat: {
    label: "会话",
    glyph: "⌂",
    path: "M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-4 4V5a1 1 0 0 1 1-1Zm3 5h10v-2H7v2Zm0 4h7v-2H7v2Z",
  },
  // dashboard grid
  overview: {
    label: "总览",
    glyph: "◇",
    path: "M3 3h8v8H3V3Zm10 0h8v5h-8V3ZM3 13h8v8H3v-8Zm10 3h8v5h-8v-5Z",
  },
  goals: {
    label: "目标",
    glyph: "◎",
    path: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
  },
  // play / runs history
  runs: {
    label: "运行",
    glyph: "▶",
    path: "M13 3a9 9 0 1 0 8.94 10H19.9A7 7 0 1 1 13 5V3Zm2 0v6h6a9.02 9.02 0 0 0-6-6Zm-4 5v6l5-3-5-3Z",
  },
  // schedule clock
  "scheduled-tasks": {
    label: "任务",
    glyph: "◷",
    path: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm.5-13h-1.5v6l5.25 3.15.75-1.23-4.5-2.67V7Z",
  },
  skills: {
    label: "技能",
    glyph: "✦",
    path: "M12 2 9.2 8.6 2 9.2l5.5 4.7L5.8 21 12 17l6.2 4-1.7-7.1L22 9.2l-7.2-.6L12 2Z",
  },
  // tune / settings sliders for tools
  tools: {
    label: "工具",
    glyph: "⌘",
    path: "M3 17v2h6v-2H3Zm0-6v2h10v-2H3Zm0-6v2h14V5H3Zm12 12v2h6v-2h-6Zm-4-6v2h10v-2H11Zm6-6v2h4V5h-4Z",
  },
  // memory chip
  memory: {
    label: "记忆",
    glyph: "◌",
    path: "M8 8h8v8H8V8Zm-3 1h2v6H5V9Zm12 0h2v6h-2V9ZM9 2h2v3H9V2Zm4 0h2v3h-2V2ZM9 19h2v3H9v-3Zm4 0h2v3h-2v-3ZM6 6h12v12H6V6Z",
  },
  // school / learning
  learning: {
    label: "学习",
    glyph: "✓",
    path: "M12 3 1 9l11 6 9-4.91V17h2V9L12 3Zm0 13.2L5 12.4v2.4l7 3.8 7-3.8v-2.4l-7 3.8Z",
  },
  // assessment chart
  evals: {
    label: "评测",
    glyph: "▣",
    path: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 14h2v-5H7v5Zm4 0h2V7h-2v10Zm4 0h2v-8h-2v8Z",
  },
  // gear
  settings: {
    label: "设置",
    glyph: "⚙",
    path: "M19.4 13a7.8 7.8 0 0 0 0-2l2-1.6-2-3.5-2.4 1a7.6 7.6 0 0 0-1.7-1l-.4-2.6h-4l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.5L4.6 11a7.8 7.8 0 0 0 0 2l-2 1.6 2 3.5 2.4-1a7.6 7.6 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.5-2-1.6ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z",
  },
};

export function getMaterialNavigationIcon(
  sectionId: NavigationSectionId,
): MaterialNavigationIcon {
  return materialNavigationIcons[sectionId];
}
