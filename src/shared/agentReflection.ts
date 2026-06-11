import type { AgentToolName } from "./toolPermissions";

export type AgentReflectionFailureClass =
  | "permission_denied"
  | "verification_failed"
  | "network_failed"
  | "tool_failed"
  | "duplicate_retry_blocked"
  | "budget_exhausted";

export type AgentReflectionSuggestion = "retry" | "skip" | "abort";

export type AgentRunBudget = {
  retryBudget: number;
};

export type AgentReflectionDecision = {
  failureClass: AgentReflectionFailureClass;
  suggestion: AgentReflectionSuggestion;
  retryAllowed: boolean;
  argumentFingerprint: string;
  citedEvidence: string;
  adjustedApproach: string;
};

export function createToolFailureReflection(input: {
  toolName: AgentToolName;
  args: Record<string, unknown>;
  error: string;
  errorDetails?: Record<string, unknown>;
  previousReflections: AgentReflectionDecision[];
  budget: AgentRunBudget;
}): AgentReflectionDecision {
  const argumentFingerprint = `${input.toolName}:${stableStringify(input.args)}`;
  if (
    input.previousReflections.some(
      (reflection) => reflection.argumentFingerprint === argumentFingerprint,
    )
  ) {
    return buildDecision(input, {
      argumentFingerprint,
      failureClass: "duplicate_retry_blocked",
      suggestion: "abort",
      retryAllowed: false,
      adjustedApproach:
        "Do not retry the exact same tool arguments again; change the query, path, command, or ask the user for direction.",
    });
  }

  if (input.previousReflections.length >= input.budget.retryBudget) {
    return buildDecision(input, {
      argumentFingerprint,
      failureClass: "budget_exhausted",
      suggestion: "abort",
      retryAllowed: false,
      adjustedApproach:
        "Retry budget is exhausted; return a partial result with the evidence already collected.",
    });
  }

  const failureClass = classifyFailure(input.toolName, input.error, input.errorDetails);
  const retryAllowed = failureClass !== "permission_denied";

  return buildDecision(input, {
    argumentFingerprint,
    failureClass,
    suggestion: retryAllowed ? "retry" : "abort",
    retryAllowed,
    adjustedApproach: retryAllowed
      ? "Retry once with changed arguments based on the cited observation."
      : "Stop and ask for approval or a narrower authorized target.",
  });
}

function classifyFailure(
  toolName: AgentToolName,
  error: string,
  errorDetails?: Record<string, unknown>,
): AgentReflectionFailureClass {
  const kind = String(errorDetails?.kind ?? "");
  if (/permission|权限|沙箱|workspace/i.test(error)) {
    return "permission_denied";
  }
  if (toolName === "test_run" || kind === "exit") {
    return "verification_failed";
  }
  if (/network|fetch|ENOTFOUND|ECONNRESET|timeout/i.test(error)) {
    return "network_failed";
  }
  return "tool_failed";
}

function buildDecision(
  input: { error: string },
  fields: Omit<AgentReflectionDecision, "citedEvidence">,
): AgentReflectionDecision {
  return {
    ...fields,
    citedEvidence: input.error,
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "undefined";
}
