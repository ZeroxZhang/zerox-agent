import type { NavigationSectionId } from "./navigation";

export type MaterialNavigationIcon = {
  label: string;
  glyph: string;
};

const materialNavigationIcons: Record<
  NavigationSectionId,
  MaterialNavigationIcon
> = {
  chat: { label: "会话", glyph: "⌂" },
  overview: { label: "总览", glyph: "◇" },
  runs: { label: "运行", glyph: "▶" },
  "scheduled-tasks": { label: "任务", glyph: "◷" },
  skills: { label: "技能", glyph: "✦" },
  tools: { label: "工具", glyph: "⌘" },
  memory: { label: "记忆", glyph: "◎" },
  learning: { label: "学习", glyph: "✓" },
  settings: { label: "设置", glyph: "⚙" },
};

export function getMaterialNavigationIcon(
  sectionId: NavigationSectionId,
): MaterialNavigationIcon {
  return materialNavigationIcons[sectionId];
}
