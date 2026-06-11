import { describe, expect, it } from "vitest";
import { computeHarnessScore } from "./harnessScore";

describe("computeHarnessScore", () => {
  it("scores all seven ETCLOVG harness categories", () => {
    const score = computeHarnessScore({
      hasAgentGuide: true,
      hasExecutionStore: true,
      hasInitScript: true,
      hasTrajectoryStore: true,
      evalPassRate: 1,
      recoverabilityRate: 1,
      pendingLearningCandidates: 0,
    });

    expect(score.categories.map((category) => category.id)).toEqual([
      "execution_environment",
      "tool_interface",
      "context_management",
      "lifecycle_orchestration",
      "observability",
      "verification",
      "governance",
    ]);
    expect(score.overall).toBeGreaterThan(8);
    expect(score.tone).toBe("good");
  });

  it("surfaces governance risk when reviewed learning backs up", () => {
    const score = computeHarnessScore({
      hasAgentGuide: true,
      hasExecutionStore: true,
      hasInitScript: true,
      hasTrajectoryStore: true,
      evalPassRate: 0.85,
      recoverabilityRate: 1,
      pendingLearningCandidates: 12,
    });

    expect(score.categories).toContainEqual(
      expect.objectContaining({
        id: "governance",
        score: 6,
      }),
    );
    expect(score.summary).toContain("12 reviewed learning candidates pending");
  });
});
