import type { Goal } from "../shared/agentGoal";
import type { ChatSessionTokenUsage } from "../shared/chat";
import type { PlanRecord } from "../shared/planMode";

export function projectChatSessionTokenUsage(input: {
  chatUsage?: ChatSessionTokenUsage;
  plans: PlanRecord[];
  goals: Goal[];
}): ChatSessionTokenUsage | undefined {
  const chatTokens = normalizeCount(input.chatUsage?.totalTokens);
  const planUsage = collectPlanUsage(input.plans);
  const goalTokens = input.goals.reduce(
    (total, goal) => total + normalizeCount(goal.executionUsage.tokens),
    0,
  );
  const totalTokens = chatTokens + planUsage.totalTokens + goalTokens;
  if (!totalTokens && !input.chatUsage) {
    return undefined;
  }

  return {
    totalTokens,
    ...(goalTokens === 0 &&
    (input.chatUsage?.promptTokens !== undefined || planUsage.inputTokens > 0)
      ? {
          promptTokens:
            normalizeCount(input.chatUsage?.promptTokens) + planUsage.inputTokens,
        }
      : {}),
    ...(goalTokens === 0 &&
    (input.chatUsage?.completionTokens !== undefined || planUsage.outputTokens > 0)
      ? {
          completionTokens:
            normalizeCount(input.chatUsage?.completionTokens) +
            planUsage.outputTokens,
        }
      : {}),
    estimated: Boolean(input.chatUsage?.estimated),
    breakdown: {
      chatTokens,
      planTokens: planUsage.totalTokens,
      goalTokens,
    },
  };
}

function collectPlanUsage(plans: PlanRecord[]): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  const usageByRunId = new Map<
    string,
    { inputTokens: number; outputTokens: number }
  >();
  for (const plan of plans) {
    for (const stage of plan.planningStages ?? []) {
      if (!stage.usage || usageByRunId.has(stage.runId)) continue;
      usageByRunId.set(stage.runId, normalizeUsage(stage.usage));
    }
    for (const round of plan.rounds) {
      if (!round.usage || usageByRunId.has(round.runId)) continue;
      usageByRunId.set(round.runId, normalizeUsage(round.usage));
    }
  }
  let inputTokens = 0;
  let outputTokens = 0;
  for (const usage of usageByRunId.values()) {
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

function normalizeUsage(usage: {
  inputTokens: number;
  outputTokens: number;
}): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: normalizeCount(usage.inputTokens),
    outputTokens: normalizeCount(usage.outputTokens),
  };
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}
