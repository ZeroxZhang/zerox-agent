import { describe, expect, it } from "vitest";
import {
  getDefaultSettingsNavigationSection,
  getDefaultNavigationSection,
  getNavigationSection,
  getNavigationSections,
  getSettingsNavigationGroups,
  getSettingsNavigationSection,
  getSettingsNavigationSections,
  getStartupNavigationTarget,
  getStartupSettingsNavigationSection,
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
      "runs",
      "scheduled-tasks",
      "settings",
    ]);
  });

  it("uses simplified task record copy for runs navigation", () => {
    expect(getNavigationSection("runs")).toMatchObject({
      id: "runs",
      label: "任务记录",
      module: "活动",
      summary: "查看每次任务是否完成，以及下一步怎么处理。",
    });
  });

  it("nests technical control surfaces under Settings", () => {
    expect(getDefaultSettingsNavigationSection()).toMatchObject({
      id: "model-settings",
      intent: "首次配置",
      label: "模型",
      priority: "primary",
    });
    expect(getSettingsNavigationSections().map((section) => section.id)).toEqual([
      "model-settings",
      "tools",
      "memory",
      "skills",
      "learning",
      "evals",
      "system-overview",
    ]);
  });

  it("groups settings by user intent and operation priority", () => {
    expect(getSettingsNavigationGroups()).toEqual([
      expect.objectContaining({
        id: "setup",
        label: "启动配置",
        sectionIds: ["model-settings"],
      }),
      expect.objectContaining({
        id: "capability",
        label: "能力与边界",
        sectionIds: ["tools", "memory", "skills"],
      }),
      expect.objectContaining({
        id: "review",
        label: "审核与质量",
        sectionIds: ["learning", "evals", "system-overview"],
      }),
    ]);
    expect(getSettingsNavigationSection("tools")).toMatchObject({
      intent: "安全边界",
      priority: "safety",
      summary: expect.stringContaining("授权审计"),
    });
    expect(getSettingsNavigationSection("system-overview")).toMatchObject({
      intent: "系统状态",
      module: "状态",
      priority: "review",
    });
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
    expect(getStartupNavigationSection("#overview")).toMatchObject({
      id: "settings",
      label: "设置",
    });
    expect(getStartupNavigationSection("#model-settings").id).toBe("settings");
    expect(getStartupNavigationSection("#memory").id).toBe("settings");
    expect(getStartupNavigationSection("#learning").id).toBe("settings");
    expect(getStartupNavigationSection("#evals").id).toBe("settings");
    expect(getStartupNavigationSection("#goals").id).toBe("chat");
    expect(getStartupNavigationSection("#missing").id).toBe("chat");
  });

  it("preserves Settings subpage startup targets for deep links and refresh", () => {
    expect(getStartupNavigationTarget("#settings")).toBe("settings");
    expect(getStartupNavigationTarget("#overview")).toBe("system-overview");
    expect(getStartupNavigationTarget("#system-overview")).toBe("system-overview");
    expect(getStartupNavigationTarget("#tools")).toBe("tools");
    expect(getStartupNavigationTarget("#memory")).toBe("memory");
    expect(getStartupNavigationTarget("#learning")).toBe("learning");
    expect(getStartupNavigationTarget("#evals")).toBe("evals");
    expect(getStartupNavigationTarget("#missing")).toBe("chat");

    expect(getStartupSettingsNavigationSection("#overview").id).toBe(
      "system-overview",
    );
    expect(getStartupSettingsNavigationSection("#system-overview").id).toBe(
      "system-overview",
    );
    expect(getStartupSettingsNavigationSection("#tools").id).toBe("tools");
    expect(getStartupSettingsNavigationSection("#settings").id).toBe(
      "model-settings",
    );
  });
});
