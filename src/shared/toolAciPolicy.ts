import type { NativeToolDescriptor } from "./nativeCapabilities";
import type { AgentToolName } from "./toolPermissions";

export type ToolAciPolicyFindingCode =
  | "missing_permission_scope"
  | "missing_observable_events"
  | "missing_risk_level"
  | "ambiguous_description";

export type ToolAciPolicyFinding = {
  toolName: AgentToolName;
  code: ToolAciPolicyFindingCode;
  message: string;
};

export type ToolAciPolicyReport = {
  passed: boolean;
  findings: ToolAciPolicyFinding[];
};

export function evaluateToolAciPolicy(input: {
  nativeDescriptors: NativeToolDescriptor[];
}): ToolAciPolicyReport {
  const findings = input.nativeDescriptors.flatMap(evaluateDescriptor);

  return {
    passed: findings.length === 0,
    findings,
  };
}

function evaluateDescriptor(
  descriptor: NativeToolDescriptor,
): ToolAciPolicyFinding[] {
  const findings: ToolAciPolicyFinding[] = [];

  if (!descriptor.riskLevel) {
    findings.push({
      toolName: descriptor.id,
      code: "missing_risk_level",
      message: "Native tool descriptor must declare a risk level.",
    });
  }

  if (!descriptor.permissionScope) {
    findings.push({
      toolName: descriptor.id,
      code: "missing_permission_scope",
      message: "Native tool descriptor must declare its permission scope.",
    });
  }

  if (!hasRequiredObservableEvents(descriptor.observableEvents)) {
    findings.push({
      toolName: descriptor.id,
      code: "missing_observable_events",
      message:
        "Native tool descriptor must emit native_tool_invocation and native_tool_observation events.",
    });
  }

  const vagueWords = findStandaloneVagueWords(descriptor.description);
  if (vagueWords.length > 0) {
    findings.push({
      toolName: descriptor.id,
      code: "ambiguous_description",
      message: `Native tool description uses vague standalone words: ${vagueWords.join(", ")}.`,
    });
  }

  return findings;
}

function hasRequiredObservableEvents(events: unknown): boolean {
  return (
    Array.isArray(events) &&
    events.includes("native_tool_invocation") &&
    events.includes("native_tool_observation")
  );
}

function findStandaloneVagueWords(description: unknown): string[] {
  if (typeof description !== "string") {
    return [];
  }

  const matches = description
    .toLowerCase()
    .match(/(?<![\w-])(thing|stuff|data)(?![\w-])/g);
  return [...new Set(matches ?? [])];
}
