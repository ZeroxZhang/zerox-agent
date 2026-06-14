import { describe, expect, it } from "vitest";
import type { Goal, Milestone, SuccessCriterion } from "../shared/agentGoal";
import type { ChatSessionGoalSummary } from "../shared/chat";
import { buildGoalProgressViewModel } from "./goalProgressViewModel";

describe("goal progress view model", () => {
  it("explains a planned chat goal as waiting to start", () => {
    const goal = createGoal({
      status: "planning",
      milestones: [milestone({ state: "ready" })],
    });

    const viewModel = buildGoalProgressViewModel(toSummary(goal), goal);

    expect(viewModel.statusLabel).toBe("已规划，待启动");
    expect(viewModel.statusDetail).toContain("还没有开始执行");
    expect(viewModel.nextActionLabel).toBe("开始执行");
    expect(viewModel.nextActionDetail).toContain("Milestone milestone_1");
    expect(viewModel.progressText).toBe("0/1 已完成");
    expect(viewModel.milestoneRows).toEqual([
      expect.objectContaining({
        description: "调研 serenity",
        stateLabel: "待执行",
      }),
    ]);
  });

  it("summarizes executing progress and the current milestone", () => {
    const goal = createGoal({
      status: "executing",
      milestones: [
        milestone({
          id: "milestone_done",
          state: "accepted",
          lastAcceptanceSummary: "资料源已验收。",
        }),
        milestone({ id: "milestone_running", state: "running" }),
      ],
      budgetUsage: {
        iterations: 1,
        toolCalls: 5,
        wallClockMs: 90_000,
        tokens: 0,
        replans: 0,
      },
    });

    const viewModel = buildGoalProgressViewModel(toSummary(goal), goal);

    expect(viewModel.statusLabel).toBe("执行中");
    expect(viewModel.nextActionLabel).toBe("当前阶段");
    expect(viewModel.nextActionDetail).toContain("Milestone milestone_running");
    expect(viewModel.progressText).toBe("1/2 已完成");
    expect(viewModel.metricCards).toEqual(
      expect.arrayContaining([
        { label: "迭代", value: "1/8" },
        { label: "工具调用", value: "5/64" },
        { label: "运行时间", value: "1.5/45 分钟" },
      ]),
    );
  });

  it("explains failed goals through explicit recovery actions", () => {
    const viewModel = buildGoalProgressViewModel(
      {
        id: "goal_failed",
        description: "深度调研 Serenity",
        status: "failed",
      },
      null,
    );

    expect(viewModel.statusLabel).toBe("失败");
    expect(viewModel.nextActionLabel).toBe("恢复路径");
    expect(viewModel.nextActionDetail).toContain("重试目标");
  });
});

function createGoal(overrides: Partial<Goal> = {}): Goal {
  const criterion: SuccessCriterion = {
    id: "criterion_1",
    description: "调研 serenity",
    acceptanceChecks: [
      {
        id: "criterion_1_review",
        kind: "model_review",
        description: "需要基于证据验收。",
        params: {},
        requiresEvidence: true,
      },
    ],
  };

  return {
    id: "goal_1",
    description: "帮我深度调研一下 serenity",
    successCriteria: [criterion],
    milestones: [milestone()],
    status: "planning",
    budget: {
      maxIterations: 8,
      maxToolCalls: 64,
      maxWallClockMs: 45 * 60 * 1000,
      maxReplans: 3,
    },
    budgetUsage: {
      iterations: 0,
      toolCalls: 0,
      wallClockMs: 0,
      tokens: 0,
      replans: 0,
    },
    reviewPolicy: "review_each_milestone",
    planVersion: 1,
    createdAt: "2026-06-13T13:30:00.000Z",
    updatedAt: "2026-06-13T13:35:00.000Z",
    ...overrides,
  };
}

function milestone(overrides: Partial<Milestone> = {}): Milestone {
  const criterion: SuccessCriterion = {
    id: "criterion_1",
    description: "调研 serenity",
    acceptanceChecks: [
      {
        id: "criterion_1_review",
        kind: "model_review",
        description: "需要基于证据验收。",
        params: {},
        requiresEvidence: true,
      },
    ],
  };

  return {
    id: "milestone_1",
    description: "调研 serenity",
    dependsOn: [],
    successCriteria: [criterion],
    state: "ready",
    runIds: [],
    attempts: 0,
    ...overrides,
  };
}

function toSummary(goal: Goal): ChatSessionGoalSummary {
  return {
    id: goal.id,
    description: goal.description,
    status: goal.status,
  };
}
