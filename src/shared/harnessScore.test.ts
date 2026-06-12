import { describe, expect, it } from "vitest";
import { computeHarnessScore, type HarnessScoreInput } from "./harnessScore";

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

  it("includes goal-mode pass rate in the verification signal", () => {
    const score = computeHarnessScore({
      hasAgentGuide: true,
      hasExecutionStore: true,
      hasInitScript: true,
      hasTrajectoryStore: true,
      evalPassRate: 1,
      recoverabilityRate: 1,
      pendingLearningCandidates: 0,
      goalPassRate: 1,
      goalFixtureCount: 6,
    } as HarnessScoreInput & {
      goalPassRate: number;
      goalFixtureCount: number;
    });

    expect(score.categories).toContainEqual(
      expect.objectContaining({
        id: "verification",
        score: 10,
      }),
    );
    expect(score.summary).toContain("goal-mode pass 100% across 6 fixtures");
  });
});
