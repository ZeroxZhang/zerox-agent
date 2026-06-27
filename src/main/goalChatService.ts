import { randomUUID } from "node:crypto";
import {
  assertGoalTransition,
  type Goal,
  type GoalBudget,
  type Milestone,
  type SuccessCriterion,
} from "../shared/agentGoal";

import type { GoalReviewDecision } from "../shared/agentGoalReview";
import type { ChatSessionGoalSummary, GoalProgressEvent } from "../shared/chat";
import { classifyTaskFrame, type TaskFrame } from "../shared/agentTaskStrategy";
import {
  compileAgentTaskContract,
  type AgentTaskContract,
} from "../shared/agentTaskContract";
import { createTaskContractSuccessCriterion } from "../shared/agentTaskContractAcceptance";
import {
  createQuickActionPlan,
  type QuickActionPlan,
} from "../shared/agentQuickAction";
import type { SkillInputValue } from "../shared/skillExecutionContract";
import type { SkillRecord } from "../shared/skills";
import type { AgentGoalController } from "./agentGoalController";
import type { AgentGoalPlanner } from "./agentGoalPlanner";
import type { AgentGoalStore } from "./agentGoalStore";

export type GoalChatService = {
  createFromChat(input: {
    sessionId: string;
    originMessageId: string | null;
    description: string;
    selectedSkill?: SkillRecord;
    selectedSkillInputValues?: Record<string, SkillInputValue>;
  }): Promise<ChatSessionGoalSummary>;
  start(
    goalId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ChatSessionGoalSummary>;
  resume(
    goalId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ChatSessionGoalSummary>;
  pause(goalId: string): Promise<ChatSessionGoalSummary>;
  cancel(goalId: string): Promise<ChatSessionGoalSummary>;
  resolveReview(
    goalId: string,
    decision: GoalReviewDecision,
  ): Promise<ChatSessionGoalSummary>;
  increaseBudget(
    goalId: string,
    delta: Partial<GoalBudget>,
  ): Promise<ChatSessionGoalSummary>;
  replan(goalId: string, instructions: string): Promise<ChatSessionGoalSummary>;
  retry(goalId: string): Promise<ChatSessionGoalSummary>;
};

export function createGoalChatService(options: {
  controller: Pick<AgentGoalController, "start" | "resume" | "resolveReview">;
  goalStore: Pick<AgentGoalStore, "save" | "get" | "appendLedger">;
  planner: Pick<AgentGoalPlanner, "plan" | "replan">;
  getAvailableTools?: () => string[];
  getAvailableSkills?: () => string[];
  createId?: () => string;
  now?: () => string;
  onProgress?: (event: GoalProgressEvent) => void;
}): GoalChatService {
  const createId = options.createId ?? (() => `goal_${randomUUID()}`);
  const now = options.now ?? (() => new Date().toISOString());
  const activeGoalControllers = new Map<string, AbortController>();

  function notifyProgress(
    event: GoalProgressEvent["event"],
    goal: Goal,
    message: string,
    milestoneId?: string,
  ) {
    options.onProgress?.({
      kind: "goal_progress",
      goalId: goal.id,
      sessionId: goal.chatSessionId,
      status: goal.status,
      milestoneId,
      event,
      message,
      timestamp: now(),
    });
  }

  function startBackgroundGoalRun(
    goalId: string,
    runOptions: { signal?: AbortSignal } | undefined,
    runner: (goalId: string, options: { signal?: AbortSignal }) => Promise<Goal>,
  ) {
    const existing = activeGoalControllers.get(goalId);
    if (existing && !existing.signal.aborted) {
      return;
    }

    const controller = new AbortController();
    activeGoalControllers.set(goalId, controller);
    const abortFromParent = () => controller.abort();
    runOptions?.signal?.addEventListener("abort", abortFromParent, { once: true });

    void runner(goalId, { signal: controller.signal })
      .catch(() => {
        // Errors are captured by the controller and surfaced via progress events.
      })
      .finally(() => {
        runOptions?.signal?.removeEventListener("abort", abortFromParent);
        if (activeGoalControllers.get(goalId) === controller) {
          activeGoalControllers.delete(goalId);
        }
      });
  }

  function abortBackgroundGoalRun(goalId: string) {
    const controller = activeGoalControllers.get(goalId);
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    activeGoalControllers.delete(goalId);
  }

  async function queueGoalExecution(goal: Goal): Promise<Goal> {
    if (goal.status !== "planning") {
      return goal;
    }

    assertGoalTransition(goal.status, "executing");
    goal.status = "executing";
    goal.updatedAt = now();
    await options.goalStore.save(goal);
    await options.goalStore.appendLedger(goal.id, {
      at: goal.updatedAt,
      kind: "goal_planned",
      summary: "Goal execution queued from chat.",
    });
    notifyProgress("started", goal, "目标已开始执行。");
    return goal;
  }

  return {
    async createFromChat(input) {
      const goalId = createId();
      const description = input.description.trim() || "Chat goal";
      const taskContract = compileAgentTaskContract({
        description,
        chatSessionId: input.sessionId,
        ...(input.originMessageId
          ? { originMessageId: input.originMessageId }
          : {}),
      });
      const goalCriterion = createGoalSuccessCriterion(
        description,
        taskContract,
      );
      const taskFrame = classifyTaskFrame(description);
      const quickActionPlan = createQuickActionPlan(description, taskFrame);
      const quickActionReviewPlan =
        !taskContract && shouldRouteToQuickActionReview(taskFrame, quickActionPlan)
          ? quickActionPlan
          : null;

      const milestones = quickActionReviewPlan
        ? [
            createQuickActionReviewMilestone(
              description,
              goalCriterion,
              quickActionReviewPlan,
            ),
          ]
        : await planGoalMilestones(
            description,
            goalCriterion,
            taskContract,
            input.selectedSkill,
          );

      const goal: Goal = {
        id: goalId,
        chatSessionId: input.sessionId,
        ...(input.originMessageId
          ? { originMessageId: input.originMessageId }
          : {}),
        description,
        ...(taskContract ? { taskContract } : {}),
        ...(input.selectedSkill
          ? { selectedSkill: snapshotSelectedSkill(input.selectedSkill) }
          : {}),
        ...(input.selectedSkillInputValues
          ? { selectedSkillInputValues: input.selectedSkillInputValues }
          : {}),
        successCriteria: [goalCriterion],
        milestones,
        status: quickActionReviewPlan ? "waiting_for_review" : "planning",
        budget: createDefaultChatGoalBudget(),
        budgetUsage: {
          iterations: 0,
          toolCalls: 0,
          wallClockMs: 0,
          tokens: 0,
          replans: 0,
        },
        reviewPolicy: "review_high_risk_only",
        planVersion: 1,
        createdAt: now(),
        updatedAt: now(),
      };

      await options.goalStore.save(goal);
      if (quickActionReviewPlan) {
        await options.goalStore.appendLedger(goal.id, {
          at: goal.createdAt,
          kind: "review_requested",
          summary: buildQuickActionReviewSummary(taskFrame, quickActionReviewPlan),
        });
        notifyProgress(
          "review_requested",
          goal,
          "该目标更适合快速动作，已暂停等待审核。",
        );
      } else {
        await options.goalStore.appendLedger(goal.id, {
          at: goal.createdAt,
          kind: "goal_planned",
          summary: `Goal created from chat session ${input.sessionId}.`,
        });
        notifyProgress("started", goal, "目标已创建，等待启动。");
      }
      return toGoalSummary(goal);
    },

    async start(goalId, runOptions) {
      const goal = await options.goalStore.get(goalId);
      if (!goal) {
        throw new Error(`Goal "${goalId}" was not found.`);
      }
      const queuedGoal = await queueGoalExecution(goal);
      if (queuedGoal.status === "executing") {
        startBackgroundGoalRun(goalId, runOptions, (id, runnerOptions) =>
          options.controller.start(id, runnerOptions),
        );
      }
      return toGoalSummary(
        (await options.goalStore.get(goalId)) ?? queuedGoal,
      );
    },

    async resume(goalId, runOptions) {
      const goal = await options.goalStore.get(goalId);
      if (!goal) {
        throw new Error(`Goal "${goalId}" was not found.`);
      }
      const queuedGoal = await queueGoalExecution(goal);
      if (queuedGoal.status !== "waiting_for_review") {
        startBackgroundGoalRun(goalId, runOptions, (id, runnerOptions) =>
          options.controller.resume(id, runnerOptions),
        );
      }
      return toGoalSummary(
        (await options.goalStore.get(goalId)) ?? queuedGoal,
      );
    },

    async pause(goalId) {
      const goal = await options.goalStore.get(goalId);
      if (!goal) {
        throw new Error(`Goal "${goalId}" was not found.`);
      }

      if (goal.status !== "waiting_for_review") {
        abortBackgroundGoalRun(goalId);
        assertGoalTransition(goal.status, "waiting_for_review");
        goal.status = "waiting_for_review";
        goal.updatedAt = now();
        await options.goalStore.save(goal);
        await options.goalStore.appendLedger(goal.id, {
          at: goal.updatedAt,
          kind: "review_requested",
          summary: "Goal paused from chat and is waiting for review.",
        });
        notifyProgress("review_requested", goal, "目标已暂停，等待审核。");
      }

      return toGoalSummary(goal);
    },

    async cancel(goalId) {
      const goal = await options.goalStore.get(goalId);
      if (!goal) {
        throw new Error(`Goal "${goalId}" was not found.`);
      }

      if (goal.status !== "canceled") {
        assertGoalTransition(goal.status, "canceled");
      }
      abortBackgroundGoalRun(goalId);
      goal.status = "canceled";
      goal.stopReason = "user_canceled";
      goal.updatedAt = now();
      await options.goalStore.save(goal);
      await options.goalStore.appendLedger(goal.id, {
        at: goal.updatedAt,
        kind: "goal_stopped",
        summary: "Goal canceled from chat.",
      });
      notifyProgress("stopped", goal, "目标已取消。");
      return toGoalSummary(goal);
    },

    async resolveReview(goalId, decision) {
      return toGoalSummary(
        await options.controller.resolveReview(goalId, decision),
      );
    },

    async increaseBudget(goalId, delta) {
      const goal = await options.goalStore.get(goalId);
      if (!goal) {
        throw new Error(`Goal "${goalId}" was not found.`);
      }

      goal.budget = {
        maxIterations: Math.max(
          goal.budget.maxIterations,
          goal.budget.maxIterations + (delta.maxIterations ?? 0),
        ),
        maxToolCalls: Math.max(
          goal.budget.maxToolCalls,
          goal.budget.maxToolCalls + (delta.maxToolCalls ?? 0),
        ),
        maxWallClockMs: Math.max(
          goal.budget.maxWallClockMs,
          goal.budget.maxWallClockMs + (delta.maxWallClockMs ?? 0),
        ),
        maxReplans: Math.max(
          goal.budget.maxReplans,
          goal.budget.maxReplans + (delta.maxReplans ?? 0),
        ),
        ...(goal.budget.maxTokens !== undefined || delta.maxTokens !== undefined
          ? {
              maxTokens: Math.max(
                goal.budget.maxTokens ?? 0,
                (goal.budget.maxTokens ?? 0) + (delta.maxTokens ?? 0),
              ),
            }
          : {}),
      };
      goal.updatedAt = now();
      await options.goalStore.save(goal);
      await options.goalStore.appendLedger(goal.id, {
        at: goal.updatedAt,
        kind: "goal_replanned",
        summary: "Budget increased from chat recovery UI.",
      });
      notifyProgress("replanned", goal, "预算已增加，可以继续执行。");
      return toGoalSummary(goal);
    },

    async replan(goalId, instructions) {
      const goal = await options.goalStore.get(goalId);
      if (!goal) {
        throw new Error(`Goal "${goalId}" was not found.`);
      }

      goal.milestones = await options.planner.replan(goal, instructions);
      goal.budgetUsage.replans += 1;
      goal.updatedAt = now();
      await options.goalStore.save(goal);
      await options.goalStore.appendLedger(goal.id, {
        at: goal.updatedAt,
        kind: "goal_replanned",
        summary: `Replanned from chat recovery UI: ${instructions}`,
      });
      notifyProgress("replanned", goal, "目标已重新规划。");
      return toGoalSummary(goal);
    },

    async retry(goalId) {
      const goal = await options.goalStore.get(goalId);
      if (!goal) {
        throw new Error(`Goal "${goalId}" was not found.`);
      }

      if (goal.status !== "failed" && goal.status !== "stopped_stalled") {
        assertGoalTransition(goal.status, "executing");
      }
      goal.status = "executing";
      goal.stopReason = undefined;
      goal.updatedAt = now();
      await options.goalStore.save(goal);
      await options.goalStore.appendLedger(goal.id, {
        at: goal.updatedAt,
        kind: "goal_planned",
        summary: "Goal retried from chat recovery UI.",
      });
      notifyProgress("started", goal, "目标已恢复执行。");
      startBackgroundGoalRun(goalId, { signal: undefined }, (id, runnerOptions) =>
        options.controller.resume(id, runnerOptions),
      );
      return toGoalSummary(
        (await options.goalStore.get(goalId)) ?? goal,
      );
    },
  };

  async function planGoalMilestones(
    description: string,
    goalCriterion: SuccessCriterion,
    taskContract: AgentTaskContract | undefined,
    selectedSkill: SkillRecord | undefined,
  ): Promise<Milestone[]> {
    try {
      return await options.planner.plan(description, {
        successCriteria: [goalCriterion],
        availableTools: options.getAvailableTools?.() ?? [],
        availableSkills: options.getAvailableSkills?.() ?? [],
        ...(taskContract ? { taskContract } : {}),
        ...(selectedSkill ? { selectedSkill: snapshotSelectedSkill(selectedSkill) } : {}),
      });
    } catch {
      // Fallback: create a single achievable milestone that produces the artifact.
      return [
        {
          id: "milestone_1",
          description,
          dependsOn: [],
          successCriteria: [goalCriterion],
          state: "ready",
          runIds: [],
          attempts: 0,
        },
      ];
    }
  }
}

function snapshotSelectedSkill(skill: SkillRecord): SkillRecord {
  return {
    rootDir: skill.rootDir,
    skillFile: skill.skillFile,
    body: skill.body,
    manifest: JSON.parse(JSON.stringify(skill.manifest)) as SkillRecord["manifest"],
  };
}

function createGoalSuccessCriterion(
  description: string,
  taskContract: AgentTaskContract | undefined,
): SuccessCriterion {
  const contractCriterion = taskContract
    ? createTaskContractSuccessCriterion(taskContract)
    : undefined;
  if (contractCriterion) {
    return contractCriterion;
  }

  return {
    id: "criterion_goal_satisfied",
    description: `Goal condition is satisfied: ${description}`,
    acceptanceChecks: [
      {
        id: "criterion_goal_satisfied_review",
        kind: "model_review",
        description:
          "An independent judge confirms the goal condition is satisfied from recorded execution evidence.",
        params: {
          condition: description,
          evidenceRefs: ["artifact:goalEvidence"],
        },
        requiresEvidence: true,
      },
    ],
  };
}

function shouldRouteToQuickActionReview(
  frame: TaskFrame,
  quickActionPlan: QuickActionPlan | null,
): quickActionPlan is QuickActionPlan {
  return (
    frame.recommendedRuntime === "quick_action" &&
    frame.needsConfirmation &&
    Boolean(quickActionPlan)
  );
}

function createQuickActionReviewMilestone(
  description: string,
  goalCriterion: SuccessCriterion,
  quickActionPlan: QuickActionPlan,
): Milestone {
  return {
    id: "milestone_quick_action_review",
    description: `Review ${quickActionPlan.workflowId} quick-action plan before executing: ${description}`,
    dependsOn: [],
    successCriteria: [goalCriterion],
    state: "pending",
    runIds: [],
    attempts: 0,
  };
}

function buildQuickActionReviewSummary(
  frame: TaskFrame,
  quickActionPlan: QuickActionPlan,
): string {
  const toolNames = quickActionPlan.steps
    .map((step) => step.toolName)
    .filter((toolName): toolName is string => Boolean(toolName));

  return `Quick-action ${quickActionPlan.workflowId} recommended before Goal Mode execution: ${frame.domain}/${frame.mode}/${frame.risk} via ${toolNames.join(", ")}.`;
}

function createDefaultChatGoalBudget(): GoalBudget {
  return {
    maxIterations: 8,
    maxToolCalls: 64,
    maxWallClockMs: 45 * 60 * 1000,
    maxReplans: 3,
  };
}

function toGoalSummary(goal: Goal): ChatSessionGoalSummary {
  return {
    id: goal.id,
    description: goal.description,
    status: goal.status,
  };
}
