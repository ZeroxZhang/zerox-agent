import type {
  AcceptanceRepairDirective,
  AcceptanceVerdict,
  GoalAcceptanceCheckResult,
  GoalAcceptanceFailureRecord,
  GoalAcceptanceState,
} from "../shared/agentGoal";

type BaseAcceptanceRepairDecision = {
  summary: string;
  failedCheckIds: string[];
  fingerprint: string;
  occurrence: number;
  instructions: string[];
};

export type AcceptanceCertifyDecision = BaseAcceptanceRepairDecision & {
  action: "certify";
  verdict: "accepted";
};

export type AcceptanceBlockedDecision = BaseAcceptanceRepairDecision & {
  action: "stop_blocked";
  verdict: "blocked_external" | "impossible" | "acceptance_unavailable";
  blockedVerdict: "blocked_external" | "impossible" | "acceptance_unavailable";
};

export type AcceptanceActionDecision = AcceptanceRepairDirective & {
  verdict: Exclude<
    AcceptanceVerdict,
    "accepted" | "blocked_external" | "impossible" | "acceptance_unavailable"
  >;
};

export type AcceptanceRepairDecision =
  | AcceptanceCertifyDecision
  | AcceptanceBlockedDecision
  | AcceptanceActionDecision;

export type RepairPolicyInput = {
  verdict: AcceptanceVerdict;
  occurrence: number;
  fingerprint: string;
  checkResults: GoalAcceptanceCheckResult[];
};

export function decideAcceptanceRepair(
  input: RepairPolicyInput,
): AcceptanceRepairDecision {
  validateOccurrence(input.occurrence);
  const failedChecks = input.checkResults
    .filter((result) => !result.passed)
    .slice()
    .sort((left, right) =>
      left.checkId.localeCompare(right.checkId) ||
      left.kind.localeCompare(right.kind) ||
      left.code.localeCompare(right.code),
    );
  const failedCheckIds = [...new Set(failedChecks.map((result) => result.checkId))];
  const base = {
    failedCheckIds,
    fingerprint: input.fingerprint,
    occurrence: input.occurrence,
  };

  if (input.verdict === "accepted") {
    return {
      action: "certify",
      verdict: "accepted",
      summary: "Acceptance passed; certify the target.",
      ...base,
      failedCheckIds: [],
      instructions: ["Do not schedule repair; proceed to certification."],
    };
  }

  if (input.verdict === "replan_required") {
    return {
      action: "replan",
      verdict: input.verdict,
      summary: failedSummary("Acceptance requires structural replanning", failedCheckIds),
      ...base,
      instructions: [
        failedCheckInstruction(failedCheckIds),
        "Change the goal or milestone structure before running acceptance again.",
      ],
    };
  }

  if (
    input.verdict === "blocked_external" ||
    input.verdict === "impossible" ||
    input.verdict === "acceptance_unavailable"
  ) {
    return {
      action: "stop_blocked",
      verdict: input.verdict,
      blockedVerdict: input.verdict,
      summary: blockedSummary(input.verdict, failedCheckIds),
      ...base,
      instructions: [blockedInstruction(input.verdict), failedCheckInstruction(failedCheckIds)],
    };
  }

  if (input.occurrence === 1) {
    return {
      action: "repair_same_milestone",
      verdict: input.verdict,
      summary: failedSummary("Acceptance failed", failedCheckIds),
      ...base,
      instructions: repairInstructions(failedChecks),
    };
  }

  if (input.occurrence === 2) {
    return {
      action: "retry_alternate_strategy",
      verdict: input.verdict,
      summary: failedSummary("Acceptance failed again", failedCheckIds),
      ...base,
      instructions: [
        ...repairInstructions(failedChecks),
        "Use a materially different strategy and materially different tool arguments; do not repeat the prior failed approach.",
      ],
    };
  }

  return {
    action: "stop_stalled",
    verdict: input.verdict,
    summary: failedSummary(
      `Acceptance stalled after ${input.occurrence} matching occurrences`,
      failedCheckIds,
    ),
    ...base,
    instructions: [
      failedCheckInstruction(failedCheckIds),
      "Stop automatic repair because the same logical failure has repeated.",
    ],
  };
}

export function appendAcceptanceFailure(
  state: GoalAcceptanceState,
  record: GoalAcceptanceFailureRecord,
): GoalAcceptanceState {
  const appendedRecord: GoalAcceptanceFailureRecord = {
    ...record,
    failedCheckIds: [...record.failedCheckIds],
    evidenceRefs: [...record.evidenceRefs],
    actionSignatures: [...record.actionSignatures],
  };

  return {
    ...state,
    recentFailures: [...state.recentFailures, appendedRecord].slice(-20),
  };
}

function validateOccurrence(occurrence: number): void {
  if (!Number.isInteger(occurrence) || occurrence < 1) {
    throw new RangeError("Acceptance failure occurrence must be a positive integer.");
  }
}

function failedSummary(prefix: string, failedCheckIds: string[]): string {
  return `${prefix} for checks: ${formatCheckIds(failedCheckIds)}.`;
}

function blockedSummary(
  verdict: AcceptanceBlockedDecision["blockedVerdict"],
  failedCheckIds: string[],
): string {
  const prefix = {
    blocked_external: "Acceptance stopped because an external dependency is blocked",
    impossible: "Acceptance stopped because the goal is impossible",
    acceptance_unavailable: "Acceptance stopped because validation is unavailable",
  }[verdict];
  return failedSummary(prefix, failedCheckIds);
}

function blockedInstruction(
  verdict: AcceptanceBlockedDecision["blockedVerdict"],
): string {
  return {
    blocked_external:
      "Resolve the external dependency before explicitly resuming acceptance.",
    impossible: "Revise or cancel the impossible goal before resuming execution.",
    acceptance_unavailable:
      "Restore the required validator or judge before explicitly retrying acceptance.",
  }[verdict];
}

function repairInstructions(results: GoalAcceptanceCheckResult[]): string[] {
  if (results.length === 0) {
    return ["Repair the failed acceptance checks and provide evidence for re-evaluation."];
  }
  return results.map(
    (result) =>
      `Resolve failed acceptance check "${result.checkId}" (${result.kind}, code: ${result.code}) and provide evidence for re-evaluation.`,
  );
}

function failedCheckInstruction(failedCheckIds: string[]): string {
  return `Address the exact failed acceptance checks: ${formatCheckIds(failedCheckIds)}.`;
}

function formatCheckIds(failedCheckIds: string[]): string {
  return failedCheckIds.length > 0 ? failedCheckIds.join(", ") : "none";
}
