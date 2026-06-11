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

export type AgentContextProfileReport = {
  passed: boolean;
  profiles: Record<AgentTaskIntent, AgentContextProfile>;
  failures: string[];
};

const agentTaskIntents: AgentTaskIntent[] = [
  "code",
  "research",
  "writing",
  "memory",
  "general",
];

export function createAgentContextProfile(input: {
  intent: AgentTaskIntent;
}): AgentContextProfile {
  return {
    intent: input.intent,
    coreBudgetTokens: 2000,
    hotTurnCount: input.intent === "memory" ? 4 : 6,
    coldSummaryBudgetTokens: 1200,
    memoryKinds: [...memoryKindsByIntent[input.intent]],
  };
}

export function createAgentContextProfileReport(): AgentContextProfileReport {
  const profiles = Object.fromEntries(
    agentTaskIntents.map((intent) => [
      intent,
      createAgentContextProfile({ intent }),
    ]),
  ) as Record<AgentTaskIntent, AgentContextProfile>;
  const failures = Object.values(profiles).flatMap((profile) =>
    getProfileFailures(profile),
  );

  return {
    passed: failures.length === 0,
    profiles,
    failures,
  };
}

function getProfileFailures(profile: AgentContextProfile): string[] {
  const failures: string[] = [];
  if (profile.memoryKinds.length === 0) {
    failures.push(`${profile.intent}: missing memory kinds`);
  }
  if (profile.coreBudgetTokens <= 0) {
    failures.push(`${profile.intent}: core budget must be positive`);
  }
  if (profile.hotTurnCount <= 0) {
    failures.push(`${profile.intent}: hot turn count must be positive`);
  }
  if (profile.coldSummaryBudgetTokens <= 0) {
    failures.push(`${profile.intent}: cold summary budget must be positive`);
  }

  return failures;
}

const memoryKindsByIntent: Record<AgentTaskIntent, MemoryKind[]> = {
  code: ["procedural", "semantic", "episodic"],
  research: ["semantic", "episodic", "procedural"],
  writing: ["semantic", "episodic", "procedural"],
  memory: ["core", "session", "semantic", "episodic", "procedural"],
  general: ["procedural", "semantic"],
};
