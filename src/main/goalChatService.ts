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
import type { AgentGoalController } from "./agentGoalController";
import type { AgentGoalPlanner } from "./agentGoalPlanner";
import type { AgentGoalStore } from "./agentGoalStore";

export type GoalChatService = {
  createFromChat(input: {
    sessionId: string;
    originMessageId: string | null;
    description: string;
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
  createId?: () => string;
  now?: () => string;
  onProgress?: (event: GoalProgressEvent) => void;
}): GoalChatService {
  const createId = options.createId ?? (() => `goal_${randomUUID()}`);
  const now = options.now ?? (() => new Date().toISOString());

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

  return {
    async createFromChat(input) {
      const goalId = createId();
      const description = input.description.trim() || "Chat goal";
      const artifactPath = `goal-${goalId}-result.md`;
      const goalCriterion: SuccessCriterion = {
        id: "criterion_goal_done",
        description: `Goal artifact exists: ${artifactPath}`,
        acceptanceChecks: [
          {
            id: "criterion_goal_done_check",
            kind: "file_exists",
            description: `The goal artifact ${artifactPath} must exist in the workspace.`,
            params: { path: artifactPath },
            requiresEvidence: false,
          },
        ],
      };

      let milestones: Milestone[];
      try {
        milestones = await options.planner.plan(description, {
          successCriteria: [goalCriterion],
          availableTools: [],
          availableSkills: [],
        });
      } catch {
        // Fallback: create a single achievable milestone that produces the artifact.
        milestones = [
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

      const goal: Goal = {
        id: goalId,
        chatSessionId: input.sessionId,
        ...(input.originMessageId
          ? { originMessageId: input.originMessageId }
          : {}),
        description,
        successCriteria: [goalCriterion],
        milestones,
        status: "planning",
        budget: createDefaultChatGoalBudget(),
        budgetUsage: {
          iterations: 0,
          toolCalls: 0,
          wallClockMs: 0,
          tokens: 0,
          replans: 0,
        },
        reviewPolicy: "review_each_milestone",
        planVersion: 1,
        createdAt: now(),
        updatedAt: now(),
      };

      await options.goalStore.save(goal);
      await options.goalStore.appendLedger(goal.id, {
        at: goal.createdAt,
        kind: "goal_planned",
        summary: `Goal created from chat session ${input.sessionId}.`,
      });
      notifyProgress("started", goal, "目标已创建，等待启动。");
      return toGoalSummary(goal);
    },

    async start(goalId, runOptions) {
      return toGoalSummary(await options.controller.start(goalId, runOptions));
    },

    async resume(goalId, runOptions) {
      return toGoalSummary(await options.controller.resume(goalId, runOptions));
    },

    async pause(goalId) {
      const goal = await options.goalStore.get(goalId);
      if (!goal) {
        throw new Error(`Goal "${goalId}" was not found.`);
      }

      if (goal.status !== "waiting_for_review") {
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

      if (goal.budgetUsage.replans >= goal.budget.maxReplans) {
        throw new Error("重新规划次数已达上限，请先增加预算。");
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
      return toGoalSummary(
        await options.controller.resume(goalId, { signal: undefined }),
      );
    },
  };
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
