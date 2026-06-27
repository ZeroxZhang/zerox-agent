import type {
  ChatClient,
  ChatCompletionRequest,
} from "./openAiCompatibleClient";
import {
  validateGoalDraft,
  type AcceptanceCheck,
  type AcceptanceCheckKind,
  type GoalSelectedSkill,
  type Goal,
  type Milestone,
  type SuccessCriterion,
} from "../shared/agentGoal";
import type {
  AgentTaskContract,
  ChromeBookmarksTaskContract,
} from "../shared/agentTaskContract";
import {
  createChromeBookmarkArtifactCriterion,
  hasTaskContractAcceptanceCriteria,
} from "../shared/agentTaskContractAcceptance";
import { classifyTaskFrame } from "../shared/agentTaskStrategy";

type AgentGoalPlanOptions = {
  successCriteria: SuccessCriterion[];
  availableTools: string[];
  availableSkills: string[];
  taskContract?: AgentTaskContract;
  selectedSkill?: GoalSelectedSkill;
};

export type AgentGoalPlanner = {
  plan(
    goalDescription: string,
    options: AgentGoalPlanOptions,
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
      const nativePlan = createNativeChromeBookmarkPlan(
        goalDescription,
        planOptions,
      );
      if (nativePlan) {
        return nativePlan;
      }

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
      let replanned: Milestone[];
      try {
        replanned = await requestMilestones({
          prompt: buildReplanPrompt(goal, reason),
          successCriteria: goal.successCriteria,
        });
      } catch {
        replanned = [createFallbackReplanMilestone(goal, reason)];
      }
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

function createNativeChromeBookmarkPlan(
  goalDescription: string,
  options: Pick<
    AgentGoalPlanOptions,
    "successCriteria" | "availableTools" | "taskContract"
  >,
): Milestone[] | null {
  if (options.taskContract) {
    if (!isSupportedChromeBookmarkContract(options.taskContract)) {
      return null;
    }
    if (!options.availableTools.includes("chrome_bookmarks_read")) {
      return null;
    }
    if (
      !isEvidenceBackedModelReviewOnly(options.successCriteria) &&
      !hasTaskContractAcceptanceCriteria(
        options.successCriteria,
        options.taskContract,
      )
    ) {
      return null;
    }
    return createChromeBookmarkMilestones(
      options.successCriteria,
      options.taskContract,
    );
  }

  if (!isEvidenceBackedModelReviewOnly(options.successCriteria)) {
    return null;
  }

  if (!isChromeBookmarkGoal(goalDescription, options.availableTools)) {
    return null;
  }

  return createChromeBookmarkMilestones(options.successCriteria);
}

function createChromeBookmarkMilestones(
  successCriteria: SuccessCriterion[],
  taskContract?: ChromeBookmarksTaskContract,
): Milestone[] {
  const milestoneCriteria = cloneSuccessCriteria(successCriteria);
  if (
    !taskContract ||
    !hasTaskContractAcceptanceCriteria(successCriteria, taskContract)
  ) {
    milestoneCriteria.push(createChromeBookmarkArtifactCriterion(taskContract));
  }

  return [
    {
      id: "extract_chrome_bookmarks",
      description:
        "Read Chrome bookmarks with chrome_bookmarks_read, present a concise preview, and write complete bookmark_list.md and goalEvidence.md artifacts.",
      dependsOn: [],
      successCriteria: milestoneCriteria,
      state: "ready",
      runIds: [],
      attempts: 0,
    },
  ];
}

function isSupportedChromeBookmarkContract(
  contract: unknown,
): contract is ChromeBookmarksTaskContract {
  if (!isRecord(contract)) {
    return false;
  }
  const source = contract.source;
  const transform = contract.transform;
  const deliverable = contract.deliverable;
  const destination = isRecord(deliverable) ? deliverable.destination : undefined;
  const acceptance = contract.acceptance;
  const capabilities = contract.capabilities;

  return (
    contract.schemaVersion === 1 &&
    contract.taskKind === "local_data_to_artifact" &&
    contract.mode === "deterministic" &&
    isRecord(source) &&
    source.type === "chrome_bookmarks" &&
    isRecord(transform) &&
    transform.type === "grouped_markdown" &&
    isRecord(deliverable) &&
    deliverable.artifactId === "bookmark_list" &&
    deliverable.artifactRef === "artifact:bookmark_list" &&
    deliverable.mediaType === "text/markdown" &&
    isRecord(destination) &&
    destination.kind === "desktop" &&
    destination.filename === "bookmark_list.md" &&
    isRecord(acceptance) &&
    acceptance.provenanceRequired === true &&
    hasExpectedEvidenceRefs(acceptance.evidenceRefs) &&
    hasChromeBookmarksReadCapability(capabilities)
  );
}

function hasExpectedEvidenceRefs(evidenceRefs: unknown): boolean {
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length !== 2) {
    return false;
  }

  return (
    evidenceRefs[0] === "artifact:bookmark_list" &&
    evidenceRefs[1] === "artifact:goalEvidence"
  );
}

function hasChromeBookmarksReadCapability(capabilities: unknown): boolean {
  return (
    Array.isArray(capabilities) &&
    capabilities.some(
      (capability) =>
        isRecord(capability) &&
        capability.id === "chrome_bookmarks_read" &&
        capability.toolName === "chrome_bookmarks_read",
    )
  );
}

function isChromeBookmarkGoal(
  goalDescription: string,
  availableTools: string[],
): boolean {
  return (
    availableTools.includes("chrome_bookmarks_read") &&
    /(chrome|浏览器).*(bookmark|bookmarks|书签)|(?:bookmark|bookmarks|书签).*(chrome|浏览器)/i.test(
      goalDescription,
    )
  );
}

function isEvidenceBackedModelReviewOnly(criteria: SuccessCriterion[]): boolean {
  const checks = criteria.flatMap((criterion) => criterion.acceptanceChecks);
  return (
    checks.length > 0 &&
    checks.every(
      (check) => check.kind === "model_review" && check.requiresEvidence,
    )
  );
}

function cloneSuccessCriteria(criteria: SuccessCriterion[]): SuccessCriterion[] {
  return JSON.parse(JSON.stringify(criteria)) as SuccessCriterion[];
}

function buildPlanPrompt(
  goalDescription: string,
  options: {
    successCriteria: SuccessCriterion[];
    availableTools: string[];
    availableSkills: string[];
    selectedSkill?: GoalSelectedSkill;
  },
): string {
  const taskFrame = classifyTaskFrame(goalDescription);

  return [
    "Decompose this high-level goal into bounded milestones.",
    "",
    `Goal: ${goalDescription}`,
    "",
    "Task strategy frame:",
    JSON.stringify(taskFrame),
    "Use the task strategy frame as a planning guard. Do not decompose small deterministic quick-action work into Goal Mode milestones.",
    "If the recommendedRuntime is quick_action, produce the smallest evidence-bearing milestone and avoid fragmented tool-heavy plans.",
    "Do not create clarification-only milestones that merely ask the user what they meant. If the user already named a concrete target, execute read-only inspection directly.",
    ...buildDomainToolGuidance(goalDescription, options.availableTools),
    ...buildSelectedSkillPlanningGuidance(options.selectedSkill),
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

function buildSelectedSkillPlanningGuidance(
  selectedSkill: GoalSelectedSkill | undefined,
): string[] {
  if (!selectedSkill) {
    return [];
  }

  return [
    "",
    "Selected skill contract:",
    `Skill: ${selectedSkill.manifest.name} (${selectedSkill.manifest.displayName})`,
    `Description: ${selectedSkill.manifest.description}`,
    "The generated milestones must require execution according to this selected skill. Do not treat it as optional.",
    "Selected skill body:",
    selectedSkill.body.trim() || "(empty skill body)",
  ];
}

function buildDomainToolGuidance(
  goalDescription: string,
  availableTools: string[],
): string[] {
  if (isChromeBookmarkGoal(goalDescription, availableTools)) {
    return [
      "Chrome/browser bookmark goals must use chrome_bookmarks_read as the primary evidence tool.",
      "If bookmark evidence is needed, use artifact:bookmark_list or artifact:goalEvidence; chrome_bookmarks_read writes bookmark_list.md and goalEvidence.md during Goal execution.",
      "Do not plan file_read, file_stat, shell_exec, jq, python, or generated scripts for Chrome Bookmarks JSON parsing when chrome_bookmarks_read is available.",
    ];
  }

  return [];
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
    parsed = JSON.parse(extractJsonObject(content));
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

function extractJsonObject(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  if (start === -1) {
    return candidate;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return candidate.slice(start, index + 1);
      }
    }
  }

  return candidate;
}

function createFallbackReplanMilestone(goal: Goal, reason: string): Milestone {
  const acceptedIds = goal.milestones
    .filter((milestone) => milestone.state === "accepted")
    .map((milestone) => milestone.id);
  const nextIndex = acceptedIds.length + 1;

  return {
    id: `milestone_replan_${nextIndex}`,
    description: reason.trim() || "Continue remaining goal work.",
    dependsOn: acceptedIds,
    successCriteria: goal.successCriteria,
    state: acceptedIds.length ? "pending" : "ready",
    runIds: [],
    attempts: 0,
  };
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
  const requiresEvidence = value.requiresEvidence === true;
  const params = normalizeAcceptanceCheckParams(kind, requiresEvidence, value.params);
  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id.trim() : "check",
    kind,
    description:
      typeof value.description === "string" ? value.description.trim() : "",
    params,
    requiresEvidence,
  };
}

function normalizeAcceptanceCheckParams(
  kind: AcceptanceCheckKind,
  requiresEvidence: boolean,
  value: unknown,
): Record<string, unknown> {
  const params = isRecord(value) ? { ...value } : {};
  if (kind !== "model_review" || !requiresEvidence) {
    return params;
  }

  const evidenceRefs = Array.isArray(params.evidenceRefs)
    ? params.evidenceRefs.filter((ref): ref is string =>
        typeof ref === "string" && ref.trim().length > 0
      )
    : [];

  return {
    ...params,
    evidenceRefs: evidenceRefs.length ? evidenceRefs : ["artifact:goalEvidence"],
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
