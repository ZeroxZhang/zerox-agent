export type HarnessScoreCategoryId =
  | "execution_environment"
  | "tool_interface"
  | "context_management"
  | "lifecycle_orchestration"
  | "observability"
  | "verification"
  | "governance";

export type HarnessScoreTone = "bad" | "good" | "warn";

export type HarnessScoreInput = {
  hasAgentGuide: boolean;
  hasExecutionStore: boolean;
  hasInitScript: boolean;
  hasTrajectoryStore: boolean;
  evalPassRate: number;
  recoverabilityRate: number;
  pendingLearningCandidates: number;
  toolSuccessRate?: number;
};

export type HarnessScoreCategory = {
  id: HarnessScoreCategoryId;
  label: string;
  score: number;
};

export type HarnessScore = {
  overall: number;
  tone: HarnessScoreTone;
  summary: string;
  categories: HarnessScoreCategory[];
};

export function computeHarnessScore(input: HarnessScoreInput): HarnessScore {
  const evalPassScore = ratioToScore(input.evalPassRate);
  const recoverabilityScore = ratioToScore(input.recoverabilityRate);
  const toolSuccessScore = ratioToScore(input.toolSuccessRate ?? 0.8);
  const governanceScore = scoreGovernance(input.pendingLearningCandidates);

  const categories: HarnessScoreCategory[] = [
    {
      id: "execution_environment",
      label: "Execution environment",
      score: average([
        input.hasInitScript ? 10 : 0,
        input.hasAgentGuide ? 10 : 0,
      ]),
    },
    {
      id: "tool_interface",
      label: "Tool interface",
      score: toolSuccessScore,
    },
    {
      id: "context_management",
      label: "Context management",
      score: average([
        input.hasAgentGuide ? 9 : 4,
        input.hasTrajectoryStore ? 9 : 5,
      ]),
    },
    {
      id: "lifecycle_orchestration",
      label: "Lifecycle/orchestration",
      score: average([
        input.hasExecutionStore ? 9 : 4,
        recoverabilityScore,
      ]),
    },
    {
      id: "observability",
      label: "Observability",
      score: input.hasTrajectoryStore ? 9 : 4,
    },
    {
      id: "verification",
      label: "Verification",
      score: average([evalPassScore, recoverabilityScore]),
    },
    {
      id: "governance",
      label: "Governance",
      score: governanceScore,
    },
  ];
  const overall = roundScore(average(categories.map((category) => category.score)));

  return {
    overall,
    tone: getTone(overall),
    summary: `${input.pendingLearningCandidates} reviewed learning candidates pending; eval pass ${Math.round(
      clampRatio(input.evalPassRate) * 100,
    )}%.`,
    categories: categories.map((category) => ({
      ...category,
      score: roundScore(category.score),
    })),
  };
}

function scoreGovernance(pendingLearningCandidates: number): number {
  if (pendingLearningCandidates > 10) {
    return 6;
  }

  if (pendingLearningCandidates > 5) {
    return 7;
  }

  if (pendingLearningCandidates > 0) {
    return 8;
  }

  return 9;
}

function getTone(score: number): HarnessScoreTone {
  if (score >= 8) {
    return "good";
  }

  return score >= 6 ? "warn" : "bad";
}

function ratioToScore(value: number): number {
  return clampRatio(value) * 10;
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundScore(value: number): number {
  return Number(value.toFixed(2));
}
