import { describe, expect, it } from "vitest";
import type { Goal, Milestone } from "../shared/agentGoal";
import type { GoalReviewDecision } from "../shared/agentGoalReview";
import type { GoalDraft } from "../shared/goalTranslation";
import type { SkillRecord } from "../shared/skills";
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
        acceptanceProtocolVersion: 2,
        acceptanceState: {
          protocolVersion: 2,
          phase: "idle",
          attempt: 0,
          recentFailures: [],
        },
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

  it("stores the selected skill snapshot and passes it into goal planning", async () => {
    const savedGoals: Goal[] = [];
    const ledgerEvents: ProgressLedgerEvent[] = [];
    let plannedSkillName: string | undefined;
    let plannedSkillBody: string | undefined;
    const service = createGoalChatService({
      controller: createController(),
      goalStore: createGoalStore({ savedGoals, ledgerEvents }),
      planner: {
        async plan(description, planOptions) {
          plannedSkillName = planOptions.selectedSkill?.manifest.name;
          plannedSkillBody = planOptions.selectedSkill?.body;
          return [
            {
              id: "milestone_skill_report",
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
      getAvailableTools: () => ["shell_exec"],
      createId: () => "goal_skill_report",
      now: () => "2026-06-12T08:00:00.000Z",
    });

    await service.createFromChat({
      sessionId: "chat_1",
      originMessageId: "message_1",
      description: "生成一份可阅读 HTML 报告",
      selectedSkill: createSkillRecord({
        name: "onepager",
        body: "Onepager 技能流程：必须先做内容架构分析。",
      }),
    });

    expect(plannedSkillName).toBe("onepager");
    expect(plannedSkillBody).toBe("Onepager 技能流程：必须先做内容架构分析。");
    expect(savedGoals[0]).toMatchObject({
      id: "goal_skill_report",
      selectedSkill: {
        body: "Onepager 技能流程：必须先做内容架构分析。",
        manifest: {
          name: "onepager",
          displayName: "onepager",
        },
      },
    });
  });

  it("creates a real goal from a confirmed draft without losing criteria or skill snapshots", async () => {
    const savedGoals: Goal[] = [];
    const ledgerEvents: ProgressLedgerEvent[] = [];
    let plannedCriteriaCount = 0;
    const service = createGoalChatService({
      controller: createController(),
      goalStore: createGoalStore({ savedGoals, ledgerEvents }),
      planner: {
        async plan(description, planOptions) {
          plannedCriteriaCount = planOptions.successCriteria.length;
          return [
            {
              id: "milestone_from_draft",
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
      createId: () => "goal_from_draft",
      now: () => "2026-07-05T08:00:00.000Z",
    });

    const summary = await service.createFromDraft({
      draft: createGoalDraft({
        workspaceId: "workspace_project",
        selectedSkill: createSkillRecord({
          name: "onepager",
          body: "Onepager body.",
        }),
      }),
    });

    expect(summary).toEqual({
      id: "goal_from_draft",
      description: "发布 v3.2.0 并完成验收",
      status: "planning",
    });
    expect(plannedCriteriaCount).toBe(2);
    expect(savedGoals[0]).toMatchObject({
      id: "goal_from_draft",
      chatSessionId: "chat_1",
      workspaceId: "workspace_project",
      originMessageId: "message_1",
      description: "发布 v3.2.0 并完成验收",
      acceptanceProtocolVersion: 2,
      acceptanceState: {
        protocolVersion: 2,
        phase: "idle",
        attempt: 0,
        recentFailures: [],
      },
      selectedSkill: {
        manifest: { name: "onepager" },
        body: "Onepager body.",
      },
      selectedSkillInputValues: {
        format: "html",
      },
      successCriteria: [
        { id: "criterion_build", description: "npm run build passes" },
        { id: "criterion_smoke", description: "smoke run passes" },
      ],
    });
    expect(ledgerEvents).toEqual([
      {
        at: "2026-07-05T08:00:00.000Z",
        kind: "goal_planned",
        summary: "Goal created from confirmed draft goal_draft_1.",
      },
    ]);
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

  it.each([
    ["start", "planning"],
    ["resume", "executing"],
  ] as const)(
    "upgrades a legacy %s goal to protocol v2 in one canonical save before controller execution",
    async (operation, status) => {
      let persistedGoal = createGoal({ status });
      const savedGoals: Goal[] = [];
      const controllerCalls: string[] = [];
      const service = createGoalChatService({
        controller: createController({
          async start(goalId) {
            controllerCalls.push(`start:${goalId}`);
            return persistedGoal;
          },
          async resume(goalId) {
            controllerCalls.push(`resume:${goalId}`);
            return persistedGoal;
          },
        }),
        goalStore: {
          async get(goalId) {
            return persistedGoal.id === goalId
              ? structuredClone(persistedGoal)
              : null;
          },
          async save(goal) {
            persistedGoal = structuredClone(goal);
            savedGoals.push(structuredClone(goal));
            return structuredClone(goal);
          },
          async appendLedger() {},
        },
        planner: createFakePlanner(),
        now: () => "2026-07-11T08:00:00.000Z",
      });

      const summary = await service[operation](persistedGoal.id);
      await Promise.resolve();

      expect(savedGoals).toHaveLength(1);
      expect(savedGoals[0]).toMatchObject({
        status: "executing",
        acceptanceProtocolVersion: 2,
        acceptanceState: {
          protocolVersion: 2,
          phase: "idle",
          attempt: 0,
          recentFailures: [],
        },
      });
      expect(summary.status).toBe("executing");
      expect(controllerCalls).toEqual([`${operation}:goal_release`]);
    },
  );

  it("does not upgrade or restart a terminal legacy achieved goal", async () => {
    const achieved = createGoal({
      status: "achieved",
      stopReason: "goal_accepted",
    });
    const savedGoals: Goal[] = [];
    const resumed: string[] = [];
    const service = createGoalChatService({
      controller: createController({
        async resume(goalId) {
          resumed.push(goalId);
          return achieved;
        },
      }),
      goalStore: createGoalStore({ existingGoal: achieved, savedGoals }),
      planner: createFakePlanner(),
    });

    await expect(service.resume(achieved.id)).resolves.toMatchObject({
      status: "achieved",
    });
    expect(savedGoals).toEqual([]);
    expect(resumed).toEqual([]);
    expect(achieved).not.toHaveProperty("acceptanceProtocolVersion");
    expect(achieved).not.toHaveProperty("acceptanceCertificate");
  });

  it("counts a manual replan exactly once when the planner updates usage", async () => {
    const savedGoals: Goal[] = [];
    const existingGoal = createGoal({ status: "stopped_budget" });
    const service = createGoalChatService({
      controller: createController(),
      goalStore: createGoalStore({ existingGoal, savedGoals }),
      planner: {
        async plan() {
          throw new Error("unexpected plan");
        },
        async replan(goal) {
          goal.planVersion += 1;
          goal.budgetUsage.replans += 1;
          return goal.milestones;
        },
      },
      now: () => "2026-06-12T08:00:00.000Z",
    });

    await service.replan("goal_release", "只调整剩余步骤");

    expect(savedGoals.at(-1)?.planVersion).toBe(2);
    expect(savedGoals.at(-1)?.budgetUsage.replans).toBe(1);
  });

  it("returns a concurrently canceled goal instead of publishing a stale manual replan", async () => {
    const existingGoal = createGoal({ status: "stopped_budget" });
    const canceledGoal = createGoal({
      status: "canceled",
      stopReason: "user_canceled",
    });
    const ledgerEvents: ProgressLedgerEvent[] = [];
    const service = createGoalChatService({
      controller: createController(),
      goalStore: {
        async get() {
          return existingGoal;
        },
        async save() {
          return canceledGoal;
        },
        async appendLedger(_goalId, event) {
          ledgerEvents.push(event);
        },
      },
      planner: {
        async plan() {
          throw new Error("unexpected plan");
        },
        async replan(goal) {
          goal.planVersion += 1;
          goal.budgetUsage.replans += 1;
          return goal.milestones;
        },
      },
      now: () => "2026-06-12T08:00:00.000Z",
    });

    const summary = await service.replan("goal_release", "调整剩余步骤");

    expect(summary.status).toBe("canceled");
    expect(ledgerEvents).toEqual([]);
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

  it("returns achieved when achievement wins a concurrent cancel", async () => {
    const progressEvents: import("../shared/chat").GoalProgressEvent[] = [];
    const ledgerEvents: ProgressLedgerEvent[] = [];
    const runningGoal = createGoal({ status: "executing" });
    const achievedGoal = createGoal({
      status: "achieved",
      stopReason: "goal_accepted",
    });
    let persistedGoal = runningGoal;
    const service = createGoalChatService({
      controller: createController(),
      goalStore: {
        async get() {
          return persistedGoal;
        },
        async save(nextGoal) {
          persistedGoal = nextGoal.status === "canceled" ? achievedGoal : nextGoal;
          return persistedGoal;
        },
        async appendLedger(_goalId, event) {
          ledgerEvents.push(event);
        },
      },
      planner: createFakePlanner(),
      onProgress(event) {
        progressEvents.push(event);
      },
      now: () => "2026-06-12T08:00:00.000Z",
    });

    const summary = await service.cancel("goal_release");

    expect(summary.status).toBe("achieved");
    expect(ledgerEvents).toEqual([]);
    expect(progressEvents).toEqual([]);
  });

  it("pauses an active chat goal at a review gate", async () => {
    const savedGoals: Goal[] = [];
    const ledgerEvents: ProgressLedgerEvent[] = [];
    const runningGoal = createGoal({ status: "executing" });
    runningGoal.milestones[0] = {
      ...runningGoal.milestones[0]!,
      state: "running",
    };
    const service = createGoalChatService({
      controller: createController(),
      goalStore: createGoalStore({
        existingGoal: runningGoal,
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
      milestones: [{ state: "ready" }],
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

  it("aborts a background controller run when pausing the goal", async () => {
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

    await service.pause("goal_release");
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
      acceptanceProtocolVersion: 2,
      acceptanceState: { protocolVersion: 2, phase: "idle" },
    });
    expect(ledgerEvents.at(-1)).toEqual({
      at: "2026-06-12T08:00:00.000Z",
      kind: "goal_planned",
      summary: "Goal retried from chat recovery UI.",
    });
  });

  it.each([
    ["external_blocked", "blocked_external"],
    ["acceptance_unavailable", "acceptance_unavailable"],
  ] as const)(
    "retries %s goals once while retaining acceptance failure history",
    async (stopReason, verdict) => {
      const savedGoals: Goal[] = [];
      const resumed: string[] = [];
      const blocked = createBlockedGoal(stopReason, verdict);
      const service = createGoalChatService({
        controller: createController({
          async resume(goalId) {
            resumed.push(goalId);
            return blocked;
          },
        }),
        goalStore: createGoalStore({ existingGoal: blocked, savedGoals }),
        planner: createFakePlanner(),
        now: () => "2026-07-11T08:00:00.000Z",
      });

      const summary = await service.retry(blocked.id);
      await Promise.resolve();

      expect(summary.status).toBe("executing");
      expect(resumed).toEqual([blocked.id]);
      expect(savedGoals.at(-1)).toMatchObject({
        status: "executing",
        stopReason: undefined,
        planVersion: 1,
        budgetUsage: { replans: 0 },
        acceptanceState: {
          phase: "idle",
          recentFailures: blocked.acceptanceState?.recentFailures,
          lastDecision: blocked.acceptanceState?.lastDecision,
        },
      });
    },
  );

  it("rejects an unchanged impossible retry without reviving or resuming it", async () => {
    const blocked = createBlockedGoal("goal_impossible", "impossible");
    const savedGoals: Goal[] = [];
    const resumed: string[] = [];
    const service = createGoalChatService({
      controller: createController({
        async resume(goalId) {
          resumed.push(goalId);
          return blocked;
        },
      }),
      goalStore: createGoalStore({ existingGoal: blocked, savedGoals }),
      planner: createFakePlanner(),
    });

    await expect(service.retry(blocked.id)).rejects.toThrow(
      /adjust|replan|调整|重新规划/i,
    );
    expect(savedGoals).toEqual([]);
    expect(resumed).toEqual([]);
    expect(blocked.status).toBe("stopped_blocked");
  });

  it("allows impossible retry only after one successful explicit replan", async () => {
    const blocked = createBlockedGoal("goal_impossible", "impossible");
    const savedGoals: Goal[] = [];
    const resumed: string[] = [];
    const service = createGoalChatService({
      controller: createController({
        async resume(goalId) {
          resumed.push(goalId);
          return blocked;
        },
      }),
      goalStore: createGoalStore({ existingGoal: blocked, savedGoals }),
      planner: {
        async plan() {
          throw new Error("unexpected plan");
        },
        async replan(goal) {
          goal.planVersion += 1;
          goal.budgetUsage.replans += 1;
          return goal.milestones.map((milestone) => ({
            ...milestone,
            description: "Use the adjusted feasible plan.",
          }));
        },
      },
      now: () => "2026-07-11T08:00:00.000Z",
    });

    await service.replan(blocked.id, "调整不可实现的条件");
    const replanned = savedGoals.at(-1);
    expect(replanned).toMatchObject({
      status: "stopped_blocked",
      stopReason: "goal_impossible",
      planVersion: 2,
      budgetUsage: { replans: 1 },
      acceptanceState: {
        phase: "idle",
        recentFailures: blocked.acceptanceState?.recentFailures,
      },
    });

    const summary = await service.retry(blocked.id);
    await Promise.resolve();

    expect(summary.status).toBe("executing");
    expect(resumed).toEqual([blocked.id]);
    expect(savedGoals.at(-1)).toMatchObject({
      status: "executing",
      planVersion: 2,
      budgetUsage: { replans: 1 },
      acceptanceState: {
        phase: "idle",
        recentFailures: blocked.acceptanceState?.recentFailures,
      },
    });
  });

  it("does not restart when cancellation wins a concurrent retry", async () => {
    const progressEvents: import("../shared/chat").GoalProgressEvent[] = [];
    const ledgerEvents: ProgressLedgerEvent[] = [];
    const resumed: string[] = [];
    const stoppedGoal = createGoal({
      status: "stopped_budget",
      stopReason: "budget_exhausted",
    });
    const canceledGoal = createGoal({
      status: "canceled",
      stopReason: "user_canceled",
    });
    let persistedGoal = stoppedGoal;
    const service = createGoalChatService({
      controller: createController({
        async resume(goalId) {
          resumed.push(goalId);
          return createGoal({ id: goalId, status: "executing" });
        },
      }),
      goalStore: {
        async get() {
          return persistedGoal;
        },
        async save(nextGoal) {
          persistedGoal = nextGoal.status === "executing" ? canceledGoal : nextGoal;
          return persistedGoal;
        },
        async appendLedger(_goalId, event) {
          ledgerEvents.push(event);
        },
      },
      planner: createFakePlanner(),
      onProgress(event) {
        progressEvents.push(event);
      },
      now: () => "2026-06-12T08:00:00.000Z",
    });

    const summary = await service.retry("goal_release");

    expect(summary.status).toBe("canceled");
    expect(resumed).toEqual([]);
    expect(ledgerEvents).toEqual([]);
    expect(progressEvents).toEqual([]);
  });

  it("does not restart when achievement wins a concurrent retry", async () => {
    const progressEvents: import("../shared/chat").GoalProgressEvent[] = [];
    const resumed: string[] = [];
    const stoppedGoal = createGoal({
      status: "stopped_budget",
      stopReason: "budget_exhausted",
    });
    const achievedGoal = createGoal({
      status: "achieved",
      stopReason: "goal_accepted",
    });
    const service = createGoalChatService({
      controller: createController({
        async resume(goalId) {
          resumed.push(goalId);
          return achievedGoal;
        },
      }),
      goalStore: {
        async get() {
          return stoppedGoal;
        },
        async save() {
          return achievedGoal;
        },
        async appendLedger() {
          throw new Error("A lost retry must not append ledger state.");
        },
      },
      planner: createFakePlanner(),
      onProgress(event) {
        progressEvents.push(event);
      },
    });

    await expect(service.retry(stoppedGoal.id)).resolves.toMatchObject({
      status: "achieved",
    });
    expect(resumed).toEqual([]);
    expect(progressEvents).toEqual([]);
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

function createSkillRecord(
  partial: Partial<SkillRecord> & Pick<SkillRecord["manifest"], "name"> & { body?: string },
): SkillRecord {
  const name = partial.name;
  return {
    rootDir: `/tmp/skills/${name}`,
    skillFile: `/tmp/skills/${name}/SKILL.md`,
    body: partial.body ?? "Skill body",
    manifest: {
      name,
      displayName: partial.manifest?.displayName ?? name,
      description: partial.manifest?.description ?? `${name} description`,
      version: partial.manifest?.version ?? "0.1.0",
      execution: partial.manifest?.execution ?? {
        mode: "agent",
        entrypoint: null,
      },
      inputs: partial.manifest?.inputs ?? [],
      permissions: partial.manifest?.permissions ?? {
        files: { read: [], write: [] },
        shell: { commands: [] },
        web: { search: false, fetchDomains: [] },
        memory: { read: false, write: false },
      },
      ...(partial.manifest?.planning ? { planning: partial.manifest.planning } : {}),
      ...(partial.manifest?.tools ? { tools: partial.manifest.tools } : {}),
      ...(partial.manifest?.mcpServers ? { mcpServers: partial.manifest.mcpServers } : {}),
      ...(partial.manifest?.dependencies ? { dependencies: partial.manifest.dependencies } : {}),
    },
  };
}

function createGoalDraft(partial: Partial<GoalDraft> = {}): GoalDraft {
  return {
    id: "goal_draft_1",
    sessionId: "chat_1",
    originMessageId: "message_1",
    sourceMessage: "请发布 v3.2.0",
    normalizedDescription: "发布 v3.2.0 并完成验收",
    successCriteria: [
      {
        id: "criterion_build",
        description: "npm run build passes",
        acceptanceChecks: [
          {
            id: "check_build",
            kind: "command_exit_code",
            description: "npm run build exits 0",
            params: { command: "npm run build", expectedExitCode: 0 },
            requiresEvidence: true,
          },
        ],
      },
      {
        id: "criterion_smoke",
        description: "smoke run passes",
        acceptanceChecks: [
          {
            id: "check_smoke",
            kind: "test_passes",
            description: "npm run smoke:prod passes",
            params: { command: "npm run smoke:prod" },
            requiresEvidence: true,
          },
        ],
      },
    ],
    acceptanceCoverage: {
      deterministicChecks: 2,
      modelReviewChecks: 0,
      totalChecks: 2,
      hasDeterministicCoverage: true,
      hasModelReviewCoverage: false,
    },
    warnings: [],
    selectedSkillInputValues: {
      format: "html",
    },
    status: "draft",
    createdAt: "2026-07-05T08:00:00.000Z",
    updatedAt: "2026-07-05T08:00:00.000Z",
    ...partial,
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

function createBlockedGoal(
  stopReason:
    | "external_blocked"
    | "goal_impossible"
    | "acceptance_unavailable",
  verdict: "blocked_external" | "impossible" | "acceptance_unavailable",
): Goal {
  return createGoal({
    status: "stopped_blocked",
    stopReason,
    acceptanceProtocolVersion: 2,
    acceptanceState: {
      protocolVersion: 2,
      phase: "blocked",
      attempt: 3,
      recentFailures: [
        {
          at: "2026-07-11T07:59:00.000Z",
          targetKind: "goal",
          targetId: "goal_release",
          fingerprint: "b".repeat(64),
          occurrence: 1,
          verdict,
          failureClass:
            stopReason === "goal_impossible"
              ? "goal_impossible"
              : stopReason === "acceptance_unavailable"
                ? "validator_unavailable"
                : "external_dependency_missing",
          failedCheckIds: ["criterion_1_review"],
          evidenceRefs: ["artifact:goalEvidence"],
          actionSignatures: ["model_review:bounded"],
        },
      ],
      lastDecision: {
        action: "stop_blocked",
        summary: "User action is required.",
        failedCheckIds: ["criterion_1_review"],
        fingerprint: "b".repeat(64),
        occurrence: 1,
        instructions: ["Adjust the condition or restore the dependency."],
      },
    },
  });
}
