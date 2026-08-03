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
  contextWindow?: number;
  lastCompaction?: AgentContextCompactionSummary;
  updatedAt: string;
};

export function resolveContextTokenBudget(input: {
  contextWindow?: number;
  maxOutputTokens: number;
}): number {
  const contextWindow = normalizePositiveInteger(input.contextWindow);
  const maxOutputTokens = Math.max(
    1,
    Math.floor(Number(input.maxOutputTokens) || 1),
  );
  if (contextWindow && contextWindow > maxOutputTokens) {
    // Reserve the configured maximum output plus a 10% provider/tokenizer
    // safety margin. maxOutputTokens is not itself the model context window.
    return Math.max(
      1,
      Math.floor((contextWindow - maxOutputTokens) * 0.9),
    );
  }

  // Compatibility fallback for custom profiles whose context window is not
  // known yet. This preserves the historical compaction threshold.
  return Math.max(1, Math.floor(maxOutputTokens * 0.7));
}

export function createAgentContextUsage(input: {
  estimatedTokens: number;
  tokenBudget: number;
  messageCount: number;
  compactionCount?: number;
  contextWindow?: number;
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
    ...(contextWindow ? { contextWindow } : {}),
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
