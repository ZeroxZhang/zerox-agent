import { describe, expect, it } from "vitest";
import type { Goal } from "../shared/agentGoal";
import { extractGoalOutputRoots } from "./goalOutputRoots";

describe("goal output roots", () => {
  it("trims Chinese prose that is directly attached to an absolute path", () => {
    const goal = createGoal(
      "帮我整理/Users/zerox/Downloads目录下的文件，按照类型创建文件夹并移动。",
    );

    expect(extractGoalOutputRoots(goal)).toEqual(["/Users/zerox/Downloads"]);
  });

  it("preserves explicit Chinese path segments when they are separated by slashes", () => {
    const goal = createGoal(
      "把报告写入 /Users/zerox/项目资料/下载目录/inventory_log.md",
    );

    expect(extractGoalOutputRoots(goal)).toEqual([
      "/Users/zerox/项目资料/下载目录",
    ]);
  });
});

function createGoal(description: string): Goal {
  return {
    id: "goal_1",
    description,
    successCriteria: [],
    milestones: [],
    status: "planning",
    budget: {
      maxIterations: 8,
      maxToolCalls: 64,
      maxWallClockMs: 600_000,
      maxReplans: 2,
    },
    budgetUsage: {
      iterations: 0,
      toolCalls: 0,
      wallClockMs: 0,
      tokens: 0,
      replans: 0,
    },
    reviewPolicy: "review_high_risk_only",
    planVersion: 1,
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-06-15T00:00:00.000Z",
  };
}
