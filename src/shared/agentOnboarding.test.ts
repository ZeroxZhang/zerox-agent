import { describe, expect, it } from "vitest";
import { buildAgentOnboardingState } from "./agentOnboarding";
import type { AgentReadinessChecklist } from "./agentReadiness";

describe("agent onboarding state", () => {
  it("asks the user to configure the model before any other setup action", () => {
    const state = buildAgentOnboardingState(
      createChecklist([
        ["model", "needs_action"],
        ["skill", "needs_action"],
        ["task", "needs_action"],
        ["connection", "pending"],
        ["run", "pending"],
      ]),
    );

    expect(state).toEqual({
      tone: "blocked",
      title: "先配置模型",
      message: "保存对话模型和模型密钥后，本地智能体才能开始调用大模型。",
      primaryAction: {
        id: "configure_model",
        label: "配置模型",
        target: "settings",
      },
      secondaryAction: {
        id: "open_chat",
        label: "回到会话",
        target: "chat",
      },
    });
  });

  it("promotes one-click prepare when the model is ready but the default task is missing", () => {
    const state = buildAgentOnboardingState(
      createChecklist([
        ["model", "ready"],
        ["skill", "ready"],
        ["task", "needs_action"],
        ["connection", "pending"],
        ["run", "pending"],
      ]),
    );

    expect(state.primaryAction).toEqual({
      id: "prepare_agent",
      label: "一键准备",
      target: "overview",
      command: "prepare",
    });
    expect(state.title).toBe("准备默认能力");
    expect(state.tone).toBe("setup");
  });

  it("promotes validation when setup is ready but connection has not been checked", () => {
    const state = buildAgentOnboardingState(
      createChecklist([
        ["model", "ready"],
        ["skill", "ready"],
        ["task", "ready"],
        ["connection", "pending"],
        ["run", "ready"],
      ]),
    );

    expect(state.primaryAction).toEqual({
      id: "validate_agent",
      label: "一键验收运行",
      target: "overview",
      command: "validate",
    });
    expect(state.title).toBe("做一次验收运行");
    expect(state.tone).toBe("validate");
  });

  it("sends the user to the chat workspace when all checks are ready", () => {
    const state = buildAgentOnboardingState(
      createChecklist([
        ["model", "ready"],
        ["skill", "ready"],
        ["task", "ready"],
        ["connection", "ready"],
        ["run", "ready"],
      ]),
      "2026-06-07T00:00:00.000Z",
    );

    expect(state).toEqual({
      tone: "ready",
      title: "本地智能体已可使用",
      message: "最近验收已通过。现在可以直接在会话里发任务，或查看运行记录。",
      primaryAction: {
        id: "open_chat",
        label: "开始会话",
        target: "chat",
      },
      secondaryAction: {
        id: "open_runs",
        label: "查看运行",
        target: "runs",
      },
    });
  });
});

function createChecklist(
  statuses: Array<[AgentReadinessChecklist["items"][number]["id"], AgentReadinessChecklist["items"][number]["status"]]>,
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
