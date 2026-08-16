import type { ModelContextWindowSource } from "./modelSettings";

export type AgentContextCompactionSummary = {
  strategy: "summarize" | "rebuild" | "summarize-degraded";
  beforeMessages: number;
  afterMessages: number;
  beforeTokens: number;
  afterTokens: number;
  compactedAt: string;
};

export type AgentContextUsage = {
  estimatedTokens: number;
  tokenBudget: number;
  occupancyRatio: number;
  messageCount: number;
  compactionCount: number;
  budgetEnforcement?: "hard" | "advisory";
  contextWindow?: number;
  contextWindowSource?: ModelContextWindowSource;
  lastCompaction?: AgentContextCompactionSummary;
  updatedAt: string;
};

export type AgentContextBudget = {
  tokenBudget: number;
  maxOutputTokens: number;
  safetyMarginTokens: number;
  enforcement: "hard" | "advisory";
  contextWindow?: number;
  contextWindowSource?: ModelContextWindowSource;
};

const ADVISORY_CONTEXT_WINDOW = 32_768;

export function resolveAgentContextBudget(input: {
  contextWindow?: number;
  contextWindowSource?: ModelContextWindowSource;
  maxOutputTokens: number;
}): AgentContextBudget {
  const knownContextWindow = normalizePositiveInteger(input.contextWindow);
  const maxOutputTokens = Math.max(
    1,
    Math.floor(Number(input.maxOutputTokens) || 1),
  );
  const enforcement = knownContextWindow ? "hard" : "advisory";
  const planningWindow =
    enforcement === "hard"
      ? knownContextWindow!
      : Math.max(ADVISORY_CONTEXT_WINDOW, maxOutputTokens * 2);
  const availableTokens = Math.max(1, planningWindow - maxOutputTokens);
  const tokenBudget = Math.max(1, Math.floor(availableTokens * 0.9));
  const safetyMarginTokens = Math.max(0, availableTokens - tokenBudget);

  return {
    tokenBudget,
    maxOutputTokens,
    safetyMarginTokens,
    enforcement,
    ...(enforcement === "hard"
      ? {
          contextWindow: knownContextWindow,
          ...(input.contextWindowSource
            ? { contextWindowSource: { ...input.contextWindowSource } }
            : {}),
        }
      : {}),
  };
}

export function resolveContextTokenBudget(input: {
  contextWindow?: number;
  maxOutputTokens: number;
}): number {
  return resolveAgentContextBudget(input).tokenBudget;
}

export function createAgentContextUsage(input: {
  estimatedTokens: number;
  tokenBudget: number;
  messageCount: number;
  compactionCount?: number;
  budgetEnforcement?: "hard" | "advisory";
  contextWindow?: number;
  contextWindowSource?: ModelContextWindowSource;
  lastCompaction?: AgentContextCompactionSummary;
  updatedAt: string;
}): AgentContextUsage {
  const estimatedTokens = normalizeNonNegativeInteger(input.estimatedTokens);
  const tokenBudget = Math.max(1, normalizeNonNegativeInteger(input.tokenBudget));
  const contextWindow = normalizePositiveInteger(input.contextWindow);
  return {
    estimatedTokens,
    tokenBudget,
    occupancyRatio: Math.min(1, estimatedTokens / tokenBudget),
    messageCount: normalizeNonNegativeInteger(input.messageCount),
    compactionCount: normalizeNonNegativeInteger(input.compactionCount),
    ...(input.budgetEnforcement
      ? { budgetEnforcement: input.budgetEnforcement }
      : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(contextWindow && input.contextWindowSource
      ? { contextWindowSource: { ...input.contextWindowSource } }
      : {}),
    ...(input.lastCompaction
      ? { lastCompaction: { ...input.lastCompaction } }
      : {}),
    updatedAt: input.updatedAt,
  };
}

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}
