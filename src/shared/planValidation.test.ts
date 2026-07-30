import { describe, expect, it } from "vitest";
import type { PlanMilestone } from "./planMode";
import { validatePlanMilestoneGraph } from "./planValidation";

describe("plan milestone validation", () => {
  it("resolves stable IDs and unique titles and identifies every root", () => {
    const graph = validatePlanMilestoneGraph([
      milestone("build", "Build"),
      milestone("test", "Test", ["Build"]),
      milestone("docs", "Docs"),
    ]);

    expect(graph.dependenciesById.get("test")).toEqual(["build"]);
    expect([...graph.rootIds]).toEqual(["build", "docs"]);
  });

  it.each([
    {
      name: "duplicate IDs",
      milestones: [milestone("same", "One"), milestone("same", "Two")],
      message: "重复",
    },
    {
      name: "missing dependencies",
      milestones: [milestone("one", "One", ["missing"])],
      message: "不存在",
    },
    {
      name: "self dependencies",
      milestones: [milestone("one", "One", ["one"])],
      message: "自身",
    },
    {
      name: "dependency cycles",
      milestones: [
        milestone("one", "One", ["two"]),
        milestone("two", "Two", ["one"]),
      ],
      message: "循环",
    },
  ])("rejects $name", ({ milestones, message }) => {
    expect(() => validatePlanMilestoneGraph(milestones)).toThrow(message);
  });
});

function milestone(
  id: string,
  title: string,
  dependencies: string[] = [],
): PlanMilestone {
  return {
    id,
    title,
    description: `${title} work`,
    acceptanceCriteria: [`${title} verified`],
    dependencies,
  };
}
