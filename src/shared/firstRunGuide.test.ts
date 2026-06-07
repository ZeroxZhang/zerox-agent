import { describe, expect, it } from "vitest";
import type { AgentReadinessChecklist } from "./agentReadiness";
import { buildFirstRunGuide } from "./firstRunGuide";

describe("first-run guide", () => {
  it("starts with model configuration when no model is ready", () => {
    const guide = buildFirstRunGuide(
      createChecklist([
        ["model", "needs_action"],
        ["skill", "needs_action"],
        ["task", "needs_action"],
        ["connection", "pending"],
        ["run", "pending"],
      ]),
      "desktop",
    );

    expect(guide).toMatchObject({
      title: "首次启动：先连接你的大模型",
      progressLabel: "0/3",
      modeLabel: "正式本地数据",
      primaryAction: {
        id: "configure_model",
        label: "配置模型",
        target: "settings",
      },
    });
    expect(guide.steps.map((step) => step.status)).toEqual([
      "active",
      "locked",
      "locked",
    ]);
  });

  it("promotes one-click prepare after the model is configured", () => {
    const guide = buildFirstRunGuide(
      createChecklist([
        ["model", "ready"],
        ["skill", "ready"],
        ["task", "needs_action"],
        ["connection", "pending"],
        ["run", "pending"],
      ]),
      "desktop",
    );

    expect(guide).toMatchObject({
      title: "首次启动：准备默认能力",
      progressLabel: "1/3",
      primaryAction: {
        id: "prepare_agent",
        label: "一键准备",
        target: "overview",
        command: "prepare",
      },
    });
    expect(guide.steps.map((step) => step.status)).toEqual([
      "done",
      "active",
      "locked",
    ]);
  });

  it("promotes validation after model, skill, and task are ready", () => {
    const guide = buildFirstRunGuide(
      createChecklist([
        ["model", "ready"],
        ["skill", "ready"],
        ["task", "ready"],
        ["connection", "pending"],
        ["run", "pending"],
      ]),
      "desktop",
    );

    expect(guide).toMatchObject({
      title: "首次启动：做一次验收运行",
      progressLabel: "2/3",
      primaryAction: {
        id: "validate_agent",
        label: "一键验收运行",
        target: "overview",
        command: "validate",
      },
    });
    expect(guide.steps.map((step) => step.status)).toEqual([
      "done",
      "done",
      "active",
    ]);
  });

  it("marks the local agent usable after all first-run gates pass", () => {
    const guide = buildFirstRunGuide(
      createChecklist([
        ["model", "ready"],
        ["skill", "ready"],
        ["task", "ready"],
        ["connection", "ready"],
        ["run", "ready"],
      ]),
      "preview",
    );

    expect(guide).toMatchObject({
      title: "本地智能体已正式可用",
      progressLabel: "3/3",
      modeLabel: "演示数据预览",
      primaryAction: {
        id: "open_chat",
        label: "开始使用",
        target: "chat",
      },
    });
    expect(guide.steps.map((step) => step.status)).toEqual([
      "done",
      "done",
      "done",
    ]);
  });
});

function createChecklist(
  statuses: Array<
    [
      AgentReadinessChecklist["items"][number]["id"],
      AgentReadinessChecklist["items"][number]["status"],
    ]
  >,
): AgentReadinessChecklist {
  const items = statuses.map(([id, status]) => ({
    id,
    status,
    label: id,
    message: id,
    actionLabel: id,
    target: "overview" as const,
  }));
  const completeCount = items.filter((item) => item.status === "ready").length;

  return {
    ready: completeCount === items.length,
    completeCount,
    totalCount: items.length,
    items,
  };
}
