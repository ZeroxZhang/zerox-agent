import type { AgentTrajectoryEventType } from "./agentTrajectory";
import type { AgentToolName } from "./toolPermissions";

export type NativeToolKind =
  | "code"
  | "file"
  | "git"
  | "test"
  | "web"
  | "citation"
  | "report"
  | "orchestration";

export type NativeToolRiskLevel = "low" | "medium" | "high";

export type NativeToolPermissionScope = {
  files: "none" | "read" | "write";
  shell: "none" | "approved_command";
  web: "none" | "search" | "fetch";
};

export type NativeToolDescriptor = {
  id: AgentToolName;
  kind: NativeToolKind;
  label: string;
  description: string;
  riskLevel: NativeToolRiskLevel;
  permissionScope: NativeToolPermissionScope;
  observableEvents: AgentTrajectoryEventType[];
  enabled: boolean;
};

export type AgentCapabilityScoreCategoryId =
  | "native_tool_coverage"
  | "verification"
  | "retry_recovery"
  | "handoff"
  | "review_governance";

export type AgentCapabilityScoreTone = "bad" | "good" | "warn";

export type AgentCapabilityScoreInput = {
  nativeToolCount: number;
  expectedNativeToolCount: number;
  evalPassRate: number;
  retrySuccessRate: number;
  childHandoffSuccessRate: number;
  pendingEvalCandidates: number;
  pendingLearningCandidates: number;
};

export type AgentCapabilityScoreCategory = {
  id: AgentCapabilityScoreCategoryId;
  label: string;
  score: number;
};

export type AgentCapabilityScore = {
  overall: number;
  tone: AgentCapabilityScoreTone;
  summary: string;
  categories: AgentCapabilityScoreCategory[];
};

export function defineNativeToolDescriptor(
  descriptor: Omit<NativeToolDescriptor, "enabled"> & { enabled?: boolean },
): NativeToolDescriptor {
  return {
    ...descriptor,
    enabled: descriptor.enabled ?? true,
  };
}

export function computeAgentCapabilityScore(
  input: AgentCapabilityScoreInput,
): AgentCapabilityScore {
  const categories: AgentCapabilityScoreCategory[] = [
    {
      id: "native_tool_coverage",
      label: "Native tool coverage",
      score: ratioToScore(input.nativeToolCount, input.expectedNativeToolCount),
    },
    {
      id: "verification",
      label: "Verification",
      score: ratioToScore(input.evalPassRate, 1),
    },
    {
      id: "retry_recovery",
      label: "Retry recovery",
      score: ratioToScore(input.retrySuccessRate, 1),
    },
    {
      id: "handoff",
      label: "Handoff",
      score: ratioToScore(input.childHandoffSuccessRate, 1),
    },
    {
      id: "review_governance",
      label: "Review governance",
      score: scoreReviewGovernance(
        input.pendingEvalCandidates + input.pendingLearningCandidates,
      ),
    },
  ].map((category) => ({
    ...category,
    score: roundScore(category.score),
  }));
  const overall = roundScore(
    categories.reduce((sum, category) => sum + category.score, 0) /
      categories.length,
  );

  return {
    overall,
    tone: getTone(overall),
    summary: `${input.nativeToolCount}/${input.expectedNativeToolCount} native tools; ${input.pendingEvalCandidates} eval candidates pending.`,
    categories,
  };
}

function ratioToScore(numerator: number, denominator: number): number {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return 0;
  }

  return Math.max(0, Math.min(10, (numerator / denominator) * 10));
}

function scoreReviewGovernance(pendingReviewItems: number): number {
  if (pendingReviewItems > 10) {
    return 5;
  }

  if (pendingReviewItems > 5) {
    return 7;
  }

  if (pendingReviewItems > 0) {
    return 8;
  }

  return 9;
}

function getTone(score: number): AgentCapabilityScoreTone {
  if (score >= 8) {
    return "good";
  }

  return score >= 5 ? "warn" : "bad";
}

function roundScore(value: number): number {
  return Number(value.toFixed(2));
}
