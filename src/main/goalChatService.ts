import { randomUUID } from "node:crypto";
import {
  assertGoalTransition,
  type Goal,
  type GoalBudget,
  type SuccessCriterion,
} from "../shared/agentGoal";
import type { GoalReviewDecision } from "../shared/agentGoalReview";
import type { ChatSessionGoalSummary } from "../shared/chat";
import type { AgentGoalController } from "./agentGoalController";
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
};

export function createGoalChatService(options: {
  controller: Pick<AgentGoalController, "start" | "resume" | "resolveReview">;
  goalStore: Pick<AgentGoalStore, "save" | "get" | "appendLedger">;
  createId?: () => string;
  now?: () => string;
}): GoalChatService {
  const createId = options.createId ?? (() => `goal_${randomUUID()}`);
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async createFromChat(input) {
      const goal = createChatGoalDraft({
        id: createId(),
        sessionId: input.sessionId,
        originMessageId: input.originMessageId,
        description: input.description,
        now: now(),
      });
      await options.goalStore.save(goal);
      await options.goalStore.appendLedger(goal.id, {
        at: goal.createdAt,
        kind: "goal_planned",
        summary: `Goal created from chat session ${input.sessionId}.`,
      });
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
      return toGoalSummary(goal);
    },

    async resolveReview(goalId, decision) {
      return toGoalSummary(
        await options.controller.resolveReview(goalId, decision),
      );
    },
  };
}

function createChatGoalDraft(options: {
  id: string;
  sessionId: string;
  originMessageId: string | null;
  description: string;
  now: string;
}): Goal {
  const description = options.description.trim() || "Chat goal";
  const criterion: SuccessCriterion = {
    id: "criterion_1",
    description,
    acceptanceChecks: [
      {
        id: "criterion_1_review",
        kind: "model_review",
        description: "Evidence-backed review is required.",
        params: {},
        requiresEvidence: true,
      },
    ],
  };

  return {
    id: options.id,
    chatSessionId: options.sessionId,
    ...(options.originMessageId
      ? { originMessageId: options.originMessageId }
      : {}),
    description,
    successCriteria: [criterion],
    milestones: [
      {
        id: "milestone_1",
        description,
        dependsOn: [],
        successCriteria: [criterion],
        state: "ready",
        runIds: [],
        attempts: 0,
      },
    ],
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
    createdAt: options.now,
    updatedAt: options.now,
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
