import { describe, expect, it } from "vitest";
import type { Goal, Milestone } from "../shared/agentGoal";
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
      planner: createFakePlanner(),
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
    expect(savedGoals[0]?.successCriteria[0]?.acceptanceChecks[0]).toMatchObject({
      kind: "model_review",
      params: {
        condition: "发布 v1.8.0",
        evidenceRefs: ["artifact:goalEvidence"],
      },
      requiresEvidence: true,
    });
    expect(
      savedGoals[0]?.milestones[0]?.successCriteria[0]?.acceptanceChecks[0],
    ).toMatchObject({
      kind: "model_review",
      params: {
        condition: "发布 v1.8.0",
        evidenceRefs: ["artifact:goalEvidence"],
      },
      requiresEvidence: true,
    });
    expect(savedGoals[0]?.reviewPolicy).toBe("review_high_risk_only");
    expect(ledgerEvents).toEqual([
      {
        at: "2026-06-12T08:00:00.000Z",
        kind: "goal_planned",
        summary: "Goal created from chat session chat_1.",
      },
    ]);
  });

  it("routes small deterministic quick-action goals to review without planning milestones", async () => {
    const savedGoals: Goal[] = [];
    const ledgerEvents: ProgressLedgerEvent[] = [];
    let plannerCalls = 0;
    const service = createGoalChatService({
      controller: createController(),
      goalStore: createGoalStore({ savedGoals, ledgerEvents }),
      planner: {
        async plan() {
          plannerCalls += 1;
          throw new Error("Planner should not be called for quick actions.");
        },
        async replan() {
          throw new Error("Unexpected replan.");
        },
      },
      createId: () => "goal_quick_action",
      now: () => "2026-06-12T08:00:00.000Z",
    });

    const summary = await service.createFromChat({
      sessionId: "chat_1",
      originMessageId: "message_1",
      description: "整理 /Users/bytedance/Downloads 这个文件夹",
    });

    expect(plannerCalls).toBe(0);
    expect(summary).toEqual({
      id: "goal_quick_action",
      description: "整理 /Users/bytedance/Downloads 这个文件夹",
      status: "waiting_for_review",
    });
    expect(savedGoals[0]).toMatchObject({
      id: "goal_quick_action",
      status: "waiting_for_review",
      milestones: [
        {
          id: "milestone_quick_action_review",
          description:
            "Review local_file_organize quick-action plan before executing: 整理 /Users/bytedance/Downloads 这个文件夹",
          state: "pending",
        },
      ],
    });
    expect(ledgerEvents).toEqual([
      {
        at: "2026-06-12T08:00:00.000Z",
        kind: "review_requested",
        summary:
          "Quick-action local_file_organize recommended before Goal Mode execution: files/deterministic/moves_data via file_inventory, file_move_plan, file_apply_moves, file_verify_moves.",
      },
    ]);
  });

  it("passes available native tools into goal planning", async () => {
    const savedGoals: Goal[] = [];
    const ledgerEvents: ProgressLedgerEvent[] = [];
    let plannedTools: string[] = [];
    const service = createGoalChatService({
      controller: createController(),
      goalStore: createGoalStore({ savedGoals, ledgerEvents }),
      planner: {
        async plan(description, planOptions) {
          plannedTools = planOptions.availableTools;
          return [
            {
              id: "milestone_chrome_bookmarks",
              description,
              dependsOn: [],
              successCriteria: planOptions.successCriteria,
              state: "ready",
              runIds: [],
              attempts: 0,
            },
          ];
        },
        async replan() {
          throw new Error("Unexpected replan.");
        },
      },
      getAvailableTools: () => ["chrome_bookmarks_read", "file_read"],
      createId: () => "goal_chrome_bookmarks",
      now: () => "2026-06-12T08:00:00.000Z",
    });

    await service.createFromChat({
      sessionId: "chat_1",
      originMessageId: "message_1",
      description: "看一下 Chrome 浏览器的书签",
    });

    expect(plannedTools).toEqual(["chrome_bookmarks_read", "file_read"]);
  });

  it("saves and passes task contracts for deterministic bookmark goals", async () => {
    const savedGoals: Goal[] = [];
    const ledgerEvents: ProgressLedgerEvent[] = [];
    let plannedTaskContract: unknown;
    const service = createGoalChatService({
      controller: createController(),
      goalStore: createGoalStore({ savedGoals, ledgerEvents }),
      planner: {
        async plan(description, planOptions) {
          plannedTaskContract = planOptions.taskContract;
          return [
            {
              id: "extract_chrome_bookmarks",
              description,
              dependsOn: [],
              successCriteria: planOptions.successCriteria,
              state: "ready",
              runIds: [],
              attempts: 0,
            },
          ];
        },
        async replan() {
          throw new Error("Unexpected replan.");
        },
      },
      getAvailableTools: () => ["chrome_bookmarks_read"],
      createId: () => "goal_chrome_bookmarks",
      now: () => "2026-06-12T08:00:00.000Z",
    });

    await service.createFromChat({
      sessionId: "chat_1",
      originMessageId: "message_1",
      description:
        "先去获取我 Chrome 浏览器的书签，按照类型分类，然后整理成一份 markdown 格式的文件，然后放在我的桌面上。",
    });

    expect(savedGoals[0]?.taskContract).toMatchObject({
      taskKind: "local_data_to_artifact",
      source: { type: "chrome_bookmarks" },
      transform: { type: "grouped_markdown" },
      deliverable: {
        artifactId: "bookmark_list",
        destination: { kind: "desktop", filename: "bookmark_list.md" },
      },
      acceptance: {
        evidenceRefs: ["artifact:bookmark_list", "artifact:goalEvidence"],
        provenanceRequired: true,
      },
      createdFrom: {
        chatSessionId: "chat_1",
        originMessageId: "message_1",
      },
    });
    expect(plannedTaskContract).toEqual(savedGoals[0]?.taskContract);
  });

  it("plans deterministic bookmark contracts with provenance checks instead of model review gates", async () => {
    const savedGoals: Goal[] = [];
    const ledgerEvents: ProgressLedgerEvent[] = [];
    let plannerCalls = 0;
    const service = createGoalChatService({
      controller: createController(),
      goalStore: createGoalStore({ savedGoals, ledgerEvents }),
      planner: {
        async plan(_description, planOptions) {
          plannerCalls += 1;
          return [
            {
              id: "extract_chrome_bookmarks",
              description: "Read Chrome bookmarks.",
              dependsOn: [],
              successCriteria: planOptions.successCriteria,
              state: "ready",
              runIds: [],
              attempts: 0,
            },
          ];
        },
        async replan() {
          throw new Error("Unexpected replan.");
        },
      },
      getAvailableTools: () => ["chrome_bookmarks_read"],
      createId: () => "goal_chrome_bookmarks",
      now: () => "2026-06-12T08:00:00.000Z",
    });

    const summary = await service.createFromChat({
      sessionId: "chat_1",
      originMessageId: "message_1",
      description:
        "读取当前 Chrome 书签，按文件夹/分组整理成 Markdown，保存到桌面 bookmark_list.md。",
    });

    const goalChecks =
      savedGoals[0]?.successCriteria.flatMap(
        (criterion) => criterion.acceptanceChecks,
      ) ?? [];
    const milestoneChecks =
      savedGoals[0]?.milestones.flatMap((milestone) =>
        milestone.successCriteria.flatMap(
          (criterion) => criterion.acceptanceChecks,
        ),
      ) ?? [];

    expect(plannerCalls).toBe(1);
    expect(summary).toEqual({
      id: "goal_chrome_bookmarks",
      description:
        "读取当前 Chrome 书签，按文件夹/分组整理成 Markdown，保存到桌面 bookmark_list.md。",
      status: "planning",
    });
    expect(savedGoals[0]).toMatchObject({
      id: "goal_chrome_bookmarks",
      status: "planning",
      taskContract: {
        source: { type: "chrome_bookmarks" },
        deliverable: {
          artifactRef: "artifact:bookmark_list",
          destination: { kind: "desktop", filename: "bookmark_list.md" },
        },
        acceptance: {
          provenanceRequired: true,
        },
      },
      milestones: [
        {
          id: "extract_chrome_bookmarks",
          state: "ready",
        },
      ],
    });
    expect(goalChecks.map((check) => check.kind)).toEqual([
      "file_exists",
      "file_exists",
    ]);
    expect(goalChecks).toEqual([
      expect.objectContaining({
        id: "check_bookmark_list_artifact",
        kind: "file_exists",
        params: {
          path: "bookmark_list.md",
          artifactRef: "artifact:bookmark_list",
          destination: { kind: "desktop", filename: "bookmark_list.md" },
          requireProvenance: true,
        },
        requiresEvidence: false,
      }),
      expect.objectContaining({
        id: "check_goal_evidence_artifact",
        kind: "file_exists",
        params: {
          path: "goalEvidence.md",
          artifactRef: "artifact:goalEvidence",
          destination: { kind: "desktop", filename: "goalEvidence.md" },
          requireProvenance: true,
        },
        requiresEvidence: false,
      }),
    ]);
    expect(milestoneChecks.some((check) => check.kind === "model_review")).toBe(
      false,
    );
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
      goalStore: createGoalStore({
        existingGoal: createGoal({ status: "executing" }),
      }),
      planner: createFakePlanner(),
      createId: () => "goal_release",
      now: () => "2026-06-12T08:00:00.000Z",
    });

    const summary = await service.resume("goal_release");

    expect(resumed).toEqual(["goal_release"]);
    expect(summary).toEqual({
      id: "goal_release",
      description: "发布 v1.8.0",
      status: "executing",
    });
  });

  it("marks a planning goal executing before the background controller run settles", async () => {
    const savedGoals: Goal[] = [];
    const ledgerEvents: ProgressLedgerEvent[] = [];
    let startedSignal: AbortSignal | undefined;
    const service = createGoalChatService({
      controller: createController({
        async resume(_goalId, options) {
          startedSignal = options?.signal;
          return new Promise<Goal>(() => undefined);
        },
      }),
      goalStore: createGoalStore({
        existingGoal: createGoal({ status: "planning" }),
        savedGoals,
        ledgerEvents,
      }),
      planner: createFakePlanner(),
      createId: () => "goal_release",
      now: () => "2026-06-12T08:00:00.000Z",
    });

    const summary = await service.resume("goal_release");

    expect(summary).toEqual({
      id: "goal_release",
      description: "发布 v1.8.0",
      status: "executing",
    });
    expect(startedSignal?.aborted).toBe(false);
    expect(savedGoals.at(-1)).toMatchObject({
      id: "goal_release",
      status: "executing",
    });
    expect(ledgerEvents.at(-1)).toEqual({
      at: "2026-06-12T08:00:00.000Z",
      kind: "goal_planned",
      summary: "Goal execution queued from chat.",
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
      planner: createFakePlanner(),
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

  it("pauses an active chat goal at a review gate", async () => {
    const savedGoals: Goal[] = [];
    const ledgerEvents: ProgressLedgerEvent[] = [];
    const service = createGoalChatService({
      controller: createController(),
      goalStore: createGoalStore({
        existingGoal: createGoal({ status: "executing" }),
        savedGoals,
        ledgerEvents,
      }),
      planner: createFakePlanner(),
      createId: () => "goal_release",
      now: () => "2026-06-12T08:00:00.000Z",
    });

    const summary = await service.pause("goal_release");

    expect(summary).toEqual({
      id: "goal_release",
      description: "发布 v1.8.0",
      status: "waiting_for_review",
    });
    expect(savedGoals.at(-1)).toMatchObject({
      id: "goal_release",
      status: "waiting_for_review",
    });
    expect(ledgerEvents.at(-1)).toEqual({
      at: "2026-06-12T08:00:00.000Z",
      kind: "review_requested",
      summary: "Goal paused from chat and is waiting for review.",
    });
  });

  it("aborts a background controller run when canceling the goal", async () => {
    let startedSignal: AbortSignal | undefined;
    const service = createGoalChatService({
      controller: createController({
        async start(_goalId, options) {
          startedSignal = options?.signal;
          return new Promise<Goal>(() => undefined);
        },
      }),
      goalStore: createGoalStore({
        existingGoal: createGoal({ status: "planning" }),
      }),
      planner: createFakePlanner(),
      createId: () => "goal_release",
      now: () => "2026-06-12T08:00:00.000Z",
    });

    await service.start("goal_release");
    expect(startedSignal?.aborted).toBe(false);

    await service.cancel("goal_release");
    expect(startedSignal?.aborted).toBe(true);
  });

  it("retries budget-stopped chat goals directly without requiring a budget increase", async () => {
    const savedGoals: Goal[] = [];
    const ledgerEvents: ProgressLedgerEvent[] = [];
    const resumed: string[] = [];
    const service = createGoalChatService({
      controller: createController({
        async resume(goalId) {
          resumed.push(goalId);
          return createGoal({ id: goalId, status: "executing" });
        },
      }),
      goalStore: createGoalStore({
        existingGoal: createGoal({
          status: "stopped_budget",
          stopReason: "budget_exhausted",
        }),
        savedGoals,
        ledgerEvents,
      }),
      planner: createFakePlanner(),
      createId: () => "goal_release",
      now: () => "2026-06-12T08:00:00.000Z",
    });

    const summary = await service.retry("goal_release");

    expect(summary).toEqual({
      id: "goal_release",
      description: "发布 v1.8.0",
      status: "executing",
    });
    expect(resumed).toEqual(["goal_release"]);
    expect(savedGoals.at(-1)).toMatchObject({
      id: "goal_release",
      status: "executing",
      stopReason: undefined,
    });
    expect(ledgerEvents.at(-1)).toEqual({
      at: "2026-06-12T08:00:00.000Z",
      kind: "goal_planned",
      summary: "Goal retried from chat recovery UI.",
    });
  });
});

function createFakePlanner(): Pick<
  import("./agentGoalPlanner").AgentGoalPlanner,
  "plan"
> {
  return {
    async plan(description, planOptions) {
      return [
        {
          id: "milestone_1",
          description,
          dependsOn: [],
          successCriteria: planOptions?.successCriteria ?? [],
          state: "ready",
          runIds: [],
          attempts: 0,
        },
      ];
    },
  };
}

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
