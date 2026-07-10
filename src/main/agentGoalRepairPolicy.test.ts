import { describe, expect, it } from "vitest";
import type {
  AcceptanceVerdict,
  GoalAcceptanceCheckResult,
  GoalAcceptanceFailureRecord,
  GoalAcceptanceState,
} from "../shared/agentGoal";
import {
  appendAcceptanceFailure,
  decideAcceptanceRepair,
} from "./agentGoalRepairPolicy";

const checkResult = (
  overrides: Partial<GoalAcceptanceCheckResult> = {},
): GoalAcceptanceCheckResult => ({
  checkId: "check_tests",
  kind: "test_passes",
  passed: false,
  code: "test_exit_nonzero",
  failureClass: "test_failed",
  evidenceRefs: ["artifact:test-report"],
  detail: "npm test failed",
  ...overrides,
});

const policyInput = (
  verdict: AcceptanceVerdict,
  occurrence: number,
  checkResults: GoalAcceptanceCheckResult[] = [checkResult()],
) => ({
  verdict,
  occurrence,
  fingerprint: "f".repeat(64),
  checkResults,
});

describe("goal acceptance repair policy", () => {
  it.each([
    ["accepted", 1, "certify"],
    ["rejected_repairable", 1, "repair_same_milestone"],
    ["rejected_repairable", 2, "retry_alternate_strategy"],
    ["rejected_repairable", 3, "stop_stalled"],
    ["rejected_repairable", 42, "stop_stalled"],
    ["replan_required", 1, "replan"],
    ["blocked_external", 1, "stop_blocked"],
    ["impossible", 2, "stop_blocked"],
    ["acceptance_unavailable", 3, "stop_blocked"],
  ] as const)(
    "maps %s occurrence %i to %s",
    (verdict, occurrence, expectedAction) => {
      expect(decideAcceptanceRepair(policyInput(verdict, occurrence)).action).toBe(
        expectedAction,
      );
    },
  );

  it("returns an explicit non-repair certify decision for accepted results", () => {
    expect(
      decideAcceptanceRepair(
        policyInput("accepted", 7, [checkResult({ passed: true })]),
      ),
    ).toEqual({
      action: "certify",
      verdict: "accepted",
      summary: "Acceptance passed; certify the target.",
      failedCheckIds: [],
      fingerprint: "f".repeat(64),
      occurrence: 7,
      instructions: ["Do not schedule repair; proceed to certification."],
    });
  });

  it("builds deterministic directives with exact failed check ids", () => {
    const decision = decideAcceptanceRepair(
      policyInput("rejected_repairable", 1, [
        checkResult({ checkId: "z_check" }),
        checkResult({ checkId: "a_check", kind: "assertion" }),
        checkResult({ checkId: "passed", passed: true }),
        checkResult({ checkId: "a_check", kind: "assertion" }),
      ]),
    );

    expect(decision).toMatchObject({
      summary: "Acceptance failed for checks: a_check, z_check.",
      failedCheckIds: ["a_check", "z_check"],
      fingerprint: "f".repeat(64),
      occurrence: 1,
    });
    expect(decision.instructions.join("\n")).toContain("a_check");
    expect(decision.instructions.join("\n")).toContain("z_check");
  });

  it("requires a materially different strategy and tool arguments on occurrence 2", () => {
    const decision = decideAcceptanceRepair(
      policyInput("rejected_repairable", 2),
    );

    expect(decision.action).toBe("retry_alternate_strategy");
    expect(decision.instructions).toContain(
      "Use a materially different strategy and materially different tool arguments; do not repeat the prior failed approach.",
    );
  });

  it("replans only for the structural replan verdict", () => {
    expect(
      decideAcceptanceRepair(
        policyInput("rejected_repairable", 1, [
          checkResult({ failureClass: "plan_structure_invalid" }),
        ]),
      ).action,
    ).toBe("repair_same_milestone");
    expect(
      decideAcceptanceRepair(
        policyInput("rejected_repairable", 1, [
          checkResult({ failureClass: "artifact_invalid" }),
          checkResult({ failureClass: "test_failed" }),
          checkResult({ failureClass: "assertion_failed" }),
        ]),
      ).action,
    ).not.toBe("replan");
    expect(decideAcceptanceRepair(policyInput("replan_required", 9)).action).toBe(
      "replan",
    );
  });

  it.each([
    "blocked_external",
    "impossible",
    "acceptance_unavailable",
  ] as const)("preserves the typed blocked verdict %s", (verdict) => {
    expect(decideAcceptanceRepair(policyInput(verdict, 1))).toMatchObject({
      action: "stop_blocked",
      verdict,
      blockedVerdict: verdict,
    });
  });

  it("appends immutably and caps recent failure history to the newest 20", () => {
    const history = Array.from({ length: 20 }, (_, index) =>
      failureRecord(`fingerprint_${index}`),
    );
    const state: GoalAcceptanceState = {
      protocolVersion: 2,
      phase: "repairing",
      attempt: 4,
      recentFailures: history,
      lastDecision: {
        action: "repair_same_milestone",
        summary: "previous",
        failedCheckIds: ["previous"],
        fingerprint: "previous",
        occurrence: 1,
        instructions: ["previous"],
      },
    };
    const record = failureRecord("fingerprint_20");

    const next = appendAcceptanceFailure(state, record);

    expect(next).not.toBe(state);
    expect(next.recentFailures).not.toBe(state.recentFailures);
    expect(state.recentFailures).toEqual(history);
    expect(next).toMatchObject({
      protocolVersion: 2,
      phase: "repairing",
      attempt: 4,
      lastDecision: state.lastDecision,
    });
    expect(next.recentFailures).toHaveLength(20);
    expect(next.recentFailures[0]?.fingerprint).toBe("fingerprint_1");
    expect(next.recentFailures[19]?.fingerprint).toBe("fingerprint_20");
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid occurrence %s",
    (occurrence) => {
      expect(() =>
        decideAcceptanceRepair(policyInput("rejected_repairable", occurrence)),
      ).toThrow(/occurrence/i);
    },
  );
});

function failureRecord(fingerprint: string): GoalAcceptanceFailureRecord {
  return {
    at: "2026-07-11T00:00:00.000Z",
    targetKind: "milestone",
    targetId: "milestone_1",
    fingerprint,
    occurrence: 1,
    verdict: "rejected_repairable",
    failureClass: "test_failed",
    failedCheckIds: ["check_tests"],
    evidenceRefs: [],
    actionSignatures: [],
  };
}
