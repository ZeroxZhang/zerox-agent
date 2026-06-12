import { describe, expect, it } from "vitest";
import {
  getDefaultSettingsNavigationSection,
  getDefaultNavigationSection,
  getNavigationSection,
  getNavigationSections,
  getSettingsNavigationSections,
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
      "settings",
    ]);
  });

  it("nests technical control surfaces under Settings", () => {
    expect(getDefaultSettingsNavigationSection()).toMatchObject({
      id: "model-settings",
      label: "模型",
    });
    expect(getSettingsNavigationSections().map((section) => section.id)).toEqual([
      "model-settings",
      "skills",
      "tools",
      "memory",
      "learning",
      "evals",
    ]);
  });

  it("falls back to the chat workspace for unknown ids", () => {
    expect(getNavigationSection("missing").id).toBe("chat");
  });

  it("opens valid startup hashes and falls back to chat for unknown hashes", () => {
    expect(getStartupNavigationSection("#tools")).toMatchObject({
      id: "settings",
      label: "设置",
      module: "配置",
    });
    expect(getStartupNavigationSection("#memory").id).toBe("settings");
    expect(getStartupNavigationSection("#learning").id).toBe("settings");
    expect(getStartupNavigationSection("#evals").id).toBe("settings");
    expect(getStartupNavigationSection("#goals").id).toBe("chat");
    expect(getStartupNavigationSection("#missing").id).toBe("chat");
  });
});
