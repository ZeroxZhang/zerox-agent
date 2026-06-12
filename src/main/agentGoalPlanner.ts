import type {
  ChatClient,
  ChatCompletionRequest,
} from "./openAiCompatibleClient";
import {
  validateGoalDraft,
  type AcceptanceCheck,
  type AcceptanceCheckKind,
  type Goal,
  type Milestone,
  type SuccessCriterion,
} from "../shared/agentGoal";

export type AgentGoalPlanner = {
  plan(
    goalDescription: string,
    options: {
      successCriteria: SuccessCriterion[];
      availableTools: string[];
      availableSkills: string[];
    },
  ): Promise<Milestone[]>;
  replan(goal: Goal, reason: string): Promise<Milestone[]>;
};

export type AgentGoalPlannerModelProfile = Pick<
  ChatCompletionRequest,
  "baseUrl" | "apiKey" | "model" | "temperature" | "maxTokens"
>;

export function createAgentGoalPlanner(options: {
  chatClient: ChatClient;
  modelProfile: AgentGoalPlannerModelProfile;
  maxPlanAttempts?: number;
}): AgentGoalPlanner {
  const maxPlanAttempts = options.maxPlanAttempts ?? 2;

  async function requestMilestones(request: {
    prompt: string;
    successCriteria: SuccessCriterion[];
  }): Promise<Milestone[]> {
    let rejectionReason: string | undefined;

    for (let attempt = 0; attempt < maxPlanAttempts; attempt += 1) {
      const response = await options.chatClient.complete({
        ...options.modelProfile,
        temperature: Math.min(options.modelProfile.temperature, 0.2),
        messages: [
          {
            role: "user",
            content: buildPrompt(request.prompt, rejectionReason),
          },
        ],
        tool_choice: "none",
      });

      try {
        const milestones = parseMilestones(response.content ?? "");
        validateMilestonePlan(request.successCriteria, milestones);
        return milestones;
      } catch (error) {
        rejectionReason = (error as Error).message;
        if (attempt === maxPlanAttempts - 1) {
          throw error;
        }
      }
    }

    throw new Error("Goal planner did not produce a valid plan.");
  }

  return {
    async plan(goalDescription, planOptions) {
      return requestMilestones({
        prompt: buildPlanPrompt(goalDescription, planOptions),
        successCriteria: planOptions.successCriteria,
      });
    },

    async replan(goal, reason) {
      const acceptedMilestones = goal.milestones.filter(
        (milestone) => milestone.state === "accepted",
      );
      const acceptedIds = new Set(
        acceptedMilestones.map((milestone) => milestone.id),
      );
      const replanned = await requestMilestones({
        prompt: buildReplanPrompt(goal, reason),
        successCriteria: goal.successCriteria,
      });
      const merged = [
        ...acceptedMilestones,
        ...replanned.filter((milestone) => !acceptedIds.has(milestone.id)),
      ];

      validateMilestonePlan(goal.successCriteria, merged);
      goal.planVersion += 1;
      goal.budgetUsage.replans += 1;

      return merged;
    },
  };
}

function buildPlanPrompt(
  goalDescription: string,
  options: {
    successCriteria: SuccessCriterion[];
    availableTools: string[];
    availableSkills: string[];
  },
): string {
  return [
    "Decompose this high-level goal into bounded milestones.",
    "",
    `Goal: ${goalDescription}`,
    "",
    `Goal success criteria: ${JSON.stringify(options.successCriteria)}`,
    `Available tools: ${options.availableTools.join(", ") || "none"}`,
    `Available skills: ${options.availableSkills.join(", ") || "none"}`,
    "",
    "Return JSON only:",
    '{"milestones":[{"id":"milestone_id","description":"work to do","dependsOn":[],"successCriteria":[]}]}',
    "",
    "Every milestone must include at least one success criterion with at least one acceptance check.",
  ].join("\n");
}

function buildReplanPrompt(goal: Goal, reason: string): string {
  return [
    "Replan the remaining non-accepted milestones for this goal.",
    "",
    `Goal: ${goal.description}`,
    `Reason: ${reason}`,
    `Accepted milestones to preserve: ${JSON.stringify(
      goal.milestones.filter((milestone) => milestone.state === "accepted"),
    )}`,
    `Current milestones: ${JSON.stringify(goal.milestones)}`,
    "",
    "Return JSON only with a full replacement for the remaining milestones:",
    '{"milestones":[{"id":"milestone_id","description":"work to do","dependsOn":[],"successCriteria":[]}]}',
  ].join("\n");
}

function buildPrompt(prompt: string, rejectionReason: string | undefined): string {
  if (!rejectionReason) {
    return prompt;
  }

  return [
    "Previous plan was rejected.",
    `Reason: ${rejectionReason}`,
    "",
    prompt,
  ].join("\n");
}

function validateMilestonePlan(
  successCriteria: SuccessCriterion[],
  milestones: Milestone[],
): void {
  validateGoalDraft({ successCriteria, milestones });
  assertNoDependencyCycles(milestones);
}

function parseMilestones(content: string): Milestone[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Goal planner response must be valid JSON.");
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.milestones)) {
    throw new Error("Goal planner response must include milestones.");
  }

  return parsed.milestones.map((milestone, index) =>
    normalizeMilestone(milestone, index),
  );
}

function normalizeMilestone(value: unknown, index: number): Milestone {
  if (!isRecord(value)) {
    throw new Error(`Milestone at index ${index} must be an object.`);
  }

  const id =
    typeof value.id === "string" && value.id.trim()
      ? value.id.trim()
      : `milestone_${index + 1}`;
  const description =
    typeof value.description === "string" ? value.description.trim() : "";

  if (!description) {
    throw new Error(`Milestone "${id}" must include a description.`);
  }

  const dependsOn = Array.isArray(value.dependsOn)
    ? value.dependsOn.filter((dep): dep is string => typeof dep === "string")
    : [];

  return {
    id,
    description,
    dependsOn,
    successCriteria: Array.isArray(value.successCriteria)
      ? value.successCriteria.map(normalizeSuccessCriterion)
      : [],
    state: dependsOn.length === 0 ? "ready" : "pending",
    runIds: [],
    attempts: 0,
  };
}

function normalizeSuccessCriterion(value: unknown): SuccessCriterion {
  if (!isRecord(value)) {
    throw new Error("Success criterion must be an object.");
  }

  return {
    id: typeof value.id === "string" && value.id.trim()
      ? value.id.trim()
      : "criterion",
    description:
      typeof value.description === "string" ? value.description.trim() : "",
    acceptanceChecks: Array.isArray(value.acceptanceChecks)
      ? value.acceptanceChecks.map(normalizeAcceptanceCheck)
      : [],
  };
}

function normalizeAcceptanceCheck(value: unknown): AcceptanceCheck {
  if (!isRecord(value)) {
    throw new Error("Acceptance check must be an object.");
  }

  const kind = normalizeAcceptanceCheckKind(value.kind);
  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id.trim() : "check",
    kind,
    description:
      typeof value.description === "string" ? value.description.trim() : "",
    params: isRecord(value.params) ? value.params : {},
    requiresEvidence: value.requiresEvidence === true,
  };
}

function normalizeAcceptanceCheckKind(value: unknown): AcceptanceCheckKind {
  if (
    value === "file_exists" ||
    value === "command_exit_code" ||
    value === "test_passes" ||
    value === "assertion" ||
    value === "model_review"
  ) {
    return value;
  }

  throw new Error(`Unsupported acceptance check kind "${String(value)}".`);
}

function assertNoDependencyCycles(milestones: Milestone[]): void {
  const byId = new Map<string, Milestone>();
  for (const milestone of milestones) {
    if (byId.has(milestone.id)) {
      throw new Error(`Duplicate milestone id "${milestone.id}".`);
    }
    byId.set(milestone.id, milestone);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;

    visiting.add(id);
    const milestone = byId.get(id);
    for (const dep of milestone?.dependsOn ?? []) {
      if (byId.has(dep) && visit(dep)) {
        return true;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  for (const id of byId.keys()) {
    if (visit(id)) {
      throw new Error("Goal milestone dependencies must not contain cycles.");
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
