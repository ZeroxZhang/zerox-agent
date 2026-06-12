import { describe, expect, it } from "vitest";
import type { Goal } from "../shared/agentGoal";
import type { GoalReviewDecision } from "../shared/agentGoalReview";
import { createGoalChatService } from "./goalChatService";
import type { ProgressLedgerEvent } from "./agentGoalStore";

describe("goal chat service", () => {
  it("creates a chat-linked goal with a deterministic summary", async () => {
    const savedGoals: Goal[] = [];
    const ledgerEvents: ProgressLedgerEvent[] = [];
    const service = createGoalChatService({
      controller: createController(),
      goalStore: createGoalStore({ savedGoals, ledgerEvents }),
      createId: () => "goal_release",
      now: () => "2026-06-12T08:00:00.000Z",
    });

    const summary = await service.createFromChat({
      sessionId: "chat_1",
      originMessageId: "message_1",
      description: "发布 v1.8.0",
    });

    expect(summary).toEqual({
      id: "goal_release",
      description: "发布 v1.8.0",
      status: "planning",
    });
    expect(savedGoals).toMatchObject([
      {
        id: "goal_release",
        chatSessionId: "chat_1",
        originMessageId: "message_1",
        description: "发布 v1.8.0",
        status: "planning",
        milestones: [
          {
            id: "milestone_1",
            description: "发布 v1.8.0",
            state: "ready",
          },
        ],
      },
    ]);
    expect(ledgerEvents).toEqual([
      {
        at: "2026-06-12T08:00:00.000Z",
        kind: "goal_planned",
        summary: "Goal created from chat session chat_1.",
      },
    ]);
  });

  it("uses the goal controller when resuming a chat goal", async () => {
    const resumed: string[] = [];
    const service = createGoalChatService({
      controller: createController({
        async resume(goalId) {
          resumed.push(goalId);
          return createGoal({ id: goalId, status: "achieved" });
        },
      }),
      goalStore: createGoalStore(),
      createId: () => "goal_release",
      now: () => "2026-06-12T08:00:00.000Z",
    });

    const summary = await service.resume("goal_release");

    expect(resumed).toEqual(["goal_release"]);
    expect(summary).toEqual({
      id: "goal_release",
      description: "发布 v1.8.0",
      status: "achieved",
    });
  });

  it("cancels an active chat goal through the goal store", async () => {
    const savedGoals: Goal[] = [];
    const ledgerEvents: ProgressLedgerEvent[] = [];
    const service = createGoalChatService({
      controller: createController(),
      goalStore: createGoalStore({
        existingGoal: createGoal({ status: "executing" }),
        savedGoals,
        ledgerEvents,
      }),
      createId: () => "goal_release",
      now: () => "2026-06-12T08:00:00.000Z",
    });

    const summary = await service.cancel("goal_release");

    expect(summary).toEqual({
      id: "goal_release",
      description: "发布 v1.8.0",
      status: "canceled",
    });
    expect(savedGoals.at(-1)).toMatchObject({
      id: "goal_release",
      status: "canceled",
      stopReason: "user_canceled",
    });
    expect(ledgerEvents.at(-1)).toEqual({
      at: "2026-06-12T08:00:00.000Z",
      kind: "goal_stopped",
      summary: "Goal canceled from chat.",
    });
  });
});

function createController(overrides: Partial<{
  start(goalId: string, options?: { signal?: AbortSignal }): Promise<Goal>;
  resume(goalId: string, options?: { signal?: AbortSignal }): Promise<Goal>;
  resolveReview(goalId: string, decision: GoalReviewDecision): Promise<Goal>;
}> = {}) {
  return {
    async start(goalId: string) {
      return createGoal({ id: goalId, status: "executing" });
    },
    async resume(goalId: string) {
      return createGoal({ id: goalId, status: "executing" });
    },
    async resolveReview(goalId: string) {
      return createGoal({ id: goalId, status: "executing" });
    },
    ...overrides,
  };
}

function createGoalStore(options: {
  existingGoal?: Goal;
  savedGoals?: Goal[];
  ledgerEvents?: ProgressLedgerEvent[];
} = {}) {
  let goal = options.existingGoal ?? null;
  return {
    async save(nextGoal: Goal) {
      goal = nextGoal;
      options.savedGoals?.push(nextGoal);
      return nextGoal;
    },
    async get(goalId: string) {
      return goal?.id === goalId ? goal : null;
    },
    async appendLedger(_goalId: string, event: ProgressLedgerEvent) {
      options.ledgerEvents?.push(event);
    },
  };
}

function createGoal(overrides: Partial<Goal> = {}): Goal {
  const criterion = {
    id: "criterion_1",
    description: "发布 v1.8.0",
    acceptanceChecks: [
      {
        id: "criterion_1_review",
        kind: "model_review" as const,
        description: "Evidence-backed review is required.",
        params: {},
        requiresEvidence: true,
      },
    ],
  };

  return {
    id: "goal_release",
    description: "发布 v1.8.0",
    successCriteria: [criterion],
    milestones: [
      {
        id: "milestone_1",
        description: "发布 v1.8.0",
        dependsOn: [],
        successCriteria: [criterion],
        state: "ready",
        runIds: [],
        attempts: 0,
      },
    ],
    status: "planning",
    budget: {
      maxIterations: 8,
      maxToolCalls: 64,
      maxWallClockMs: 45 * 60 * 1000,
      maxReplans: 3,
    },
    budgetUsage: {
      iterations: 0,
      toolCalls: 0,
      wallClockMs: 0,
      tokens: 0,
      replans: 0,
    },
    reviewPolicy: "review_each_milestone",
    planVersion: 1,
    createdAt: "2026-06-12T08:00:00.000Z",
    updatedAt: "2026-06-12T08:00:00.000Z",
    ...overrides,
  };
}
