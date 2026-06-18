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

  it("canonicalizes home Desktop output roots from goal text", () => {
    const goal = createGoal("请把 Chrome 书签清单保存到 ~/Desktop/bookmark_list.md");

    expect(
      extractGoalOutputRoots(goal, {
        homeDir: "/Users/demo",
        workspaceRoot: "/Users/demo/project",
        platform: "darwin",
      }),
    ).toEqual(["/Users/demo/Desktop"]);
  });

  it("canonicalizes localized home Desktop aliases from goal text", () => {
    const goal = createGoal("请把 Chrome 书签清单保存到 ~/桌面/bookmark_list.md");

    expect(
      extractGoalOutputRoots(goal, {
        homeDir: "/Users/demo",
        workspaceRoot: "/Users/demo/project",
        platform: "darwin",
      }),
    ).toEqual(["/Users/demo/Desktop"]);
  });

  it("dedupes equivalent Desktop aliases across goal text and acceptance checks", () => {
    const goal = createGoal(
      "请把清单写到 Desktop/bookmark_list.md，也可以叫 桌面/bookmark_list.md 或 ~/Desktop/bookmark_list.md",
      [
        {
          id: "criterion_1",
          description: "file exists",
          acceptanceChecks: [
            {
              id: "check_1",
              kind: "file_exists",
              description: "absolute path",
              params: { path: "/Users/demo/Desktop/bookmark_list.md" },
            },
          ],
        },
      ],
    );

    expect(
      extractGoalOutputRoots(goal, {
        homeDir: "/Users/demo",
        workspaceRoot: "/Users/demo/project",
        platform: "darwin",
      }),
    ).toEqual(["/Users/demo/Desktop"]);
  });

  it.each([
    ["Desktop", "/Users/demo/Desktop"],
    ["~/Desktop", "/Users/demo/Desktop"],
    ["桌面", "/Users/demo/Desktop"],
    ["Downloads", "/Users/demo/Downloads"],
    ["~/Downloads", "/Users/demo/Downloads"],
    ["下载", "/Users/demo/Downloads"],
  ])("treats standalone acceptance-check alias as a directory root: %s", (alias, root) => {
    const goal = createGoal("Verify output location.", [
      {
        id: "criterion_1",
        description: "file exists",
        acceptanceChecks: [
          {
            id: "check_1",
            kind: "file_exists",
            description: "directory output",
            params: { path: alias },
          },
        ],
      },
    ]);

    expect(
      extractGoalOutputRoots(goal, {
        homeDir: "/Users/demo",
        workspaceRoot: "/Users/demo/project",
        platform: "darwin",
      }),
    ).toEqual([root]);
  });

  it("extracts Desktop roots from structured acceptance destinations", () => {
    const goal = createGoal("Verify deterministic artifact.", [
      {
        id: "criterion_1",
        description: "file exists",
        acceptanceChecks: [
          {
            id: "check_1",
            kind: "file_exists",
            description: "desktop artifact",
            params: {
              path: "bookmark_list.md",
              destination: { kind: "desktop", filename: "bookmark_list.md" },
            },
          },
        ],
      },
    ]);

    expect(
      extractGoalOutputRoots(goal, {
        homeDir: "/Users/demo",
        workspaceRoot: "/Users/demo/project",
        platform: "darwin",
      }),
    ).toEqual(["/Users/demo/Desktop"]);
  });

  it("does not treat nested relative Desktop segments as real Desktop output roots", () => {
    const goal = createGoal("Update src/Desktop/report.md in the workspace.");

    expect(
      extractGoalOutputRoots(goal, {
        homeDir: "/Users/demo",
        workspaceRoot: "/Users/demo/project",
        platform: "darwin",
      }),
    ).toEqual([]);
  });

  it.each([
    "write tests for Desktop alias parsing",
    "export Downloads parser coverage",
    "保存 Desktop alias 的单元测试",
  ])("ignores incidental standalone aliases: %s", (description) => {
    const goal = createGoal(description);

    expect(
      extractGoalOutputRoots(goal, {
        homeDir: "/Users/demo",
        workspaceRoot: "/Users/demo/project",
        platform: "darwin",
      }),
    ).toEqual([]);
  });

  it.each([
    ["write a Markdown file to Desktop", "/Users/demo/Desktop"],
    ["放到桌面", "/Users/demo/Desktop"],
    ["save to Downloads", "/Users/demo/Downloads"],
    ["放到下载", "/Users/demo/Downloads"],
  ])("extracts standalone output alias from intent: %s", (description, root) => {
    const goal = createGoal(description);

    expect(
      extractGoalOutputRoots(goal, {
        homeDir: "/Users/demo",
        workspaceRoot: "/Users/demo/project",
        platform: "darwin",
      }),
    ).toEqual([root]);
  });
});

function createGoal(description: string, successCriteria: Goal["successCriteria"] = []): Goal {
  return {
    id: "goal_1",
    description,
    successCriteria,
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
