import { describe, expect, it } from "vitest";
import { normalizeGoalDraftCriteria } from "./goalTranslation";
import type { SuccessCriterion } from "./agentGoal";

describe("goal draft translation validation", () => {
  it("clamps invalid acceptance check kinds and requires evidence for model review", () => {
    const result = normalizeGoalDraftCriteria([
      {
        id: "criterion_1",
        description: "Goal is complete.",
        acceptanceChecks: [
          {
            id: "bad_check",
            kind: "unknown_kind" as SuccessCriterion["acceptanceChecks"][number]["kind"],
            description: "Invalid check from model output.",
            params: {},
            requiresEvidence: false,
          },
        ],
      },
    ]);

    expect(result.successCriteria[0].acceptanceChecks[0]).toMatchObject({
      id: "bad_check",
      kind: "model_review",
      requiresEvidence: true,
      params: {
        evidenceRefs: ["artifact:goalEvidence"],
      },
    });
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "invalid_check_kind_clamped",
      "model_review_requires_evidence",
      "model_only_acceptance",
    ]);
  });

  it("does not warn about model-only acceptance when deterministic checks exist", () => {
    const result = normalizeGoalDraftCriteria([
      {
        id: "criterion_build",
        description: "Build passes.",
        acceptanceChecks: [
          {
            id: "check_build",
            kind: "command_exit_code",
            description: "npm run build exits 0.",
            params: { command: "npm run build", expectedExitCode: 0 },
            requiresEvidence: true,
          },
        ],
      },
    ]);

    expect(result.acceptanceCoverage).toMatchObject({
      deterministicChecks: 1,
      modelReviewChecks: 0,
      hasDeterministicCoverage: true,
    });
    expect(result.warnings).toEqual([]);
  });
});
