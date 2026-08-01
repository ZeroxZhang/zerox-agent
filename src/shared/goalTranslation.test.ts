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

  it("rewrites a cd-chained exit-0 command into the workspaceRoot params form", () => {
    const result = normalizeGoalDraftCriteria([
      {
        id: "criterion_tests",
        description: "Tests pass.",
        acceptanceChecks: [
          {
            id: "check_tests",
            kind: "command_exit_code",
            description: "Unit tests exit 0.",
            params: {
              command: "cd packages/app && npm test",
              expectedExitCode: 0,
            },
            requiresEvidence: false,
          },
        ],
      },
    ]);

    expect(result.successCriteria[0].acceptanceChecks[0]).toMatchObject({
      kind: "test_passes",
      params: {
        command: "npm test",
        workspaceRoot: "packages/app",
      },
    });
    expect(
      result.successCriteria[0].acceptanceChecks[0].params.expectedExitCode,
    ).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "cd_chain_acceptance_command_rewritten",
    ]);
  });

  it("drops a `cd .` prefix instead of pinning a workspaceRoot", () => {
    const result = normalizeGoalDraftCriteria([
      {
        id: "criterion_lint",
        description: "Lint passes.",
        acceptanceChecks: [
          {
            id: "check_lint",
            kind: "test_passes",
            description: "Lint exits 0.",
            params: { command: "cd . && npm run lint" },
            requiresEvidence: false,
          },
        ],
      },
    ]);

    expect(result.successCriteria[0].acceptanceChecks[0]).toMatchObject({
      kind: "test_passes",
      params: { command: "npm run lint" },
    });
    expect(
      result.successCriteria[0].acceptanceChecks[0].params.workspaceRoot,
    ).toBeUndefined();
  });

  it("keeps non-rewritable cd chains untouched for the quality gate", () => {
    const result = normalizeGoalDraftCriteria([
      {
        id: "criterion_deploy",
        description: "Deploy check.",
        acceptanceChecks: [
          {
            id: "check_nonzero",
            kind: "command_exit_code",
            description: "Command exits 2.",
            params: {
              command: "cd packages/app && npm run check",
              expectedExitCode: 2,
            },
            requiresEvidence: false,
          },
          {
            id: "check_conflicting_root",
            kind: "test_passes",
            description: "Conflicting workspaceRoot stays blocked.",
            params: {
              command: "cd packages/app && npm test",
              workspaceRoot: "other/dir",
            },
            requiresEvidence: false,
          },
          {
            id: "check_still_chained",
            kind: "test_passes",
            description: "Remainder still chains.",
            params: { command: "cd packages/app && npm test && npm run lint" },
            requiresEvidence: false,
          },
        ],
      },
    ]);

    const [nonzero, conflicting, stillChained] =
      result.successCriteria[0].acceptanceChecks;
    expect(nonzero).toMatchObject({
      kind: "command_exit_code",
      params: {
        command: "cd packages/app && npm run check",
        expectedExitCode: 2,
      },
    });
    expect(conflicting.params.command).toBe("cd packages/app && npm test");
    expect(stillChained.params.command).toBe(
      "cd packages/app && npm test && npm run lint",
    );
    expect(
      result.warnings.filter(
        (warning) => warning.code === "cd_chain_acceptance_command_rewritten",
      ),
    ).toEqual([]);
  });
});
