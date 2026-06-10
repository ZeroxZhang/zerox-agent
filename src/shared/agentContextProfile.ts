import type { MemoryKind } from "./memory";

export type AgentContextLayer = "core" | "hot" | "cold";

export type AgentTaskIntent =
  | "code"
  | "research"
  | "writing"
  | "memory"
  | "general";

export type AgentContextProfile = {
  intent: AgentTaskIntent;
  coreBudgetTokens: number;
  hotTurnCount: number;
  coldSummaryBudgetTokens: number;
  memoryKinds: MemoryKind[];
};

export function createAgentContextProfile(input: {
  intent: AgentTaskIntent;
}): AgentContextProfile {
  return {
    intent: input.intent,
    coreBudgetTokens: 2000,
    hotTurnCount: input.intent === "memory" ? 4 : 6,
    coldSummaryBudgetTokens: 1200,
    memoryKinds: memoryKindsByIntent[input.intent],
  };
}

const memoryKindsByIntent: Record<AgentTaskIntent, MemoryKind[]> = {
  code: ["procedural", "semantic", "episodic"],
  research: ["semantic", "episodic", "procedural"],
  writing: ["semantic", "episodic", "procedural"],
  memory: ["core", "session", "semantic", "episodic", "procedural"],
  general: ["procedural", "semantic"],
};
