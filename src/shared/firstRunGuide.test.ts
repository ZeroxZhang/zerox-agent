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
      message:
        "先保存模型配置。Zerox 需要可用模型，才能安全地规划本地工作流并调用受控工具。",
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
      title: "首次启动：选择本地工作流",
      message:
        "选择一个真实的本地文件整理工作流，并在运行前确认它只访问授权目录。",
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
      title: "首次启动：验收可恢复运行",
      message:
        "测试模型连接并运行默认任务，确认工具权限、运行日志和恢复路径都可检查。",
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
      title: "本地控制台已可接管任务",
      message:
        "首次启动检查已通过。现在可以在会话里交给 Zerox 一个可观察、可取消、可复盘的本地任务。",
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

  it("frames first-run steps around workflow, permission review, and recoverable validation", () => {
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

    expect(guide.steps.map((step) => step.label)).toEqual([
      "连接模型",
      "选择工作流并审核权限",
      "验收可恢复运行",
    ]);
    expect(guide.steps.map((step) => step.message).join("\n")).toContain(
      "选择一个真实本地任务，检查技能、目标目录和工具权限。",
    );
    expect(guide.steps.map((step) => step.message).join("\n")).toContain(
      "确认模型连接、工具调用、运行日志和恢复路径。",
    );
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
