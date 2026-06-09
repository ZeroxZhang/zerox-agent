import { describe, expect, it } from "vitest";
import {
  getDefaultNavigationSection,
  getNavigationSection,
  getNavigationSections,
  getStartupNavigationSection,
} from "./navigation";

describe("navigation", () => {
  it("starts on the agent chat workspace", () => {
    expect(getDefaultNavigationSection()).toMatchObject({
      id: "chat",
      label: "会话",
      module: "智能体工作台",
    });
  });

  it("orders Chinese navigation by the user-facing agent workflow", () => {
    expect(getNavigationSections().map((section) => section.id)).toEqual([
      "chat",
      "overview",
      "runs",
      "scheduled-tasks",
      "skills",
      "tools",
      "memory",
      "learning",
      "settings",
    ]);
  });

  it("falls back to the chat workspace for unknown ids", () => {
    expect(getNavigationSection("missing").id).toBe("chat");
  });

  it("opens valid startup hashes and falls back to chat for unknown hashes", () => {
    expect(getStartupNavigationSection("#tools")).toMatchObject({
      id: "tools",
      label: "工具",
      module: "第 5 模块",
    });
    expect(getStartupNavigationSection("#memory").id).toBe("memory");
    expect(getStartupNavigationSection("#missing").id).toBe("chat");
  });
});
