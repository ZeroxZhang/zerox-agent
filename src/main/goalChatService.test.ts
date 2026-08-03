import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Goal, Milestone } from "../shared/agentGoal";
import type { GoalReviewDecision } from "../shared/agentGoalReview";
import type { GoalDraft } from "../shared/goalTranslation";
import type { SkillRecord } from "../shared/skills";
import { createGoalChatService } from "./goalChatService";
import {
  createAgentGoalStore,
  type ProgressLedgerEvent,
} from "./agentGoalStore";

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

  it("uses a concise milestone when the planner is unavailable", async () => {
    const savedGoals: Goal[] = [];
    const description = "分析并修复目标运行问题。".repeat(40);
    const service = createGoalChatService({
      controller: createController(),
      goalStore: createGoalStore({ savedGoals, ledgerEvents: [] }),
      planner: {
        async plan() {
          throw new Error("planner unavailable");
        },
        async replan() {
          throw new Error("unused");
        },
      },
      createId: () => "goal_fallback",
      now: () => "2026-07-11T19:20:00.000Z",
    });

    await service.createFromChat({
      sessionId: "chat_1",
      originMessageId: "message_1",
      description,
    });

    expect(savedGoals[0]?.description).toBe(description);
    expect(savedGoals[0]?.milestones[0]?.description).toBe(
      "执行目标并产出可验收结果",
    );
  });

  it("does not create a second review gate for quick-action goals", async () => {
    const savedGoals: Goal[] = [];
    const ledgerEvents: ProgressLedgerEvent[] = [];
    let plannerCalls = 0;
    const service = createGoalChatService({
      controller: createController(),
      goalStore: createGoalStore({ savedGoals, ledgerEvents }),
      planner: {
        async plan(description, planOptions) {
          plannerCalls += 1;
          return [
            {
              id: "milestone_1",
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
      createId: () => "goal_quick_action",
      now: () => "2026-06-12T08:00:00.000Z",
    });

    const summary = await service.createFromChat({
      sessionId: "chat_1",
      originMessageId: "message_1",
      description: "整理 /Users/bytedance/Downloads 这个文件夹",
    });

    expect(plannerCalls).toBe(1);
    expect(summary).toEqual({
      id: "goal_quick_action",
      description: "整理 /Users/bytedance/Downloads 这个文件夹",
      status: "planning",
    });
    expect(savedGoals[0]).toMatchObject({
      id: "goal_quick_action",
      status: "planning",
      milestones: [
        {
          id: "milestone_1",
          description: "整理 /Users/bytedance/Downloads 这个文件夹",
          state: "ready",
        },
      ],
    });
    expect(ledgerEvents).toEqual([
      {
        at: "2026-06-12T08:00:00.000Z",
        kind: "goal_planned",
        summary: "Goal created from chat session chat_1.",
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
        executionModelBinding: {
          profileId: "profile-plan-c",
          connectionId: "connection-plan-c",
          providerKind: "deepseek",
          modelId: "deepseek-v4-flash",
          revision: 7,
          connectionRevision: 2,
          profileRevision: 1,
          baseUrl: "https://api.deepseek.com",
          capabilities: {
            tools: true,
            vision: false,
            pdf: false,
            streaming: true,
            parallelToolCalls: true,
          },
          generation: {
            temperature: 0.2,
            maxTokens: 8192,
            thinkingEnabled: false,
            thinkingBudgetTokens: 8192,
          },
        },
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
      originalDescription: "请发布 v3.2.0",
      executionModelBinding: {
        profileId: "profile-plan-c",
        connectionId: "connection-plan-c",
        modelId: "deepseek-v4-flash",
      },
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

  it("normalizes Plan-confirmed milestone checks through the Goal contract boundary", async () => {
    const savedGoals: Goal[] = [];
    const service = createGoalChatService({
      controller: createController(),
      goalStore: createGoalStore({ savedGoals, ledgerEvents: [] }),
      planner: {
        async plan() {
          throw new Error("Explicit Plan milestones must not be replanned.");
        },
        async replan() {
          throw new Error("Unexpected replan.");
        },
      },
      createId: () => "goal_plan_contract",
      now: () => "2026-08-03T03:00:00.000Z",
    });
    const command =
      "python3 -c \"import json; json.load(open('allergen-map/data/china.geo.json'))\"";
    const criterion = {
      id: "criterion_geojson",
      description: "GeoJSON parses.",
      acceptanceChecks: [{
        id: "check_geojson",
        kind: "command_exit_code" as const,
        description: "GeoJSON parses.",
        params: { command, workspaceRoot: ".", expectedExitCode: 0 },
        requiresEvidence: false,
      }],
    };

    await service.createFromDraft({
      draft: createGoalDraft({
        successCriteria: [criterion],
        milestones: [{
          id: "milestone_1",
          description: "Create the project skeleton.",
          dependsOn: [],
          successCriteria: [criterion],
          state: "ready",
          runIds: [],
          attempts: 0,
        }],
      }),
    });

    const goal = savedGoals[0]!;
    expect(goal.successCriteria[0]!.acceptanceChecks[0]).toMatchObject({
      kind: "test_passes",
      params: { command, workspaceRoot: "." },
    });
    expect(
      goal.milestones[0]!.successCriteria[0]!.acceptanceChecks[0],
    ).toEqual(goal.successCriteria[0]!.acceptanceChecks[0]);
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

  it(
    "upgrades a serialized legacy executing goal through the real store before controller execution",
    async () => {
      const configDir = await mkdtemp(path.join(os.tmpdir(), "goal-chat-legacy-"));
      try {
        const goalsDir = path.join(configDir, "agent-goals");
        const goalPath = path.join(goalsDir, "goal_release.json");
        await mkdir(goalsDir, { recursive: true });
        const legacy = createGoal({ status: "executing" });
        const raw = `${JSON.stringify(legacy, null, 2)}\n`;
        await writeFile(goalPath, raw, "utf8");
        const realStore = createAgentGoalStore({ configDir });
        const controllerCalls: string[] = [];
        const service = createGoalChatService({
          controller: createController({
            async resume(goalId) {
              controllerCalls.push(`resume:${goalId}`);
              return (await realStore.get(goalId))!;
            },
          }),
          goalStore: realStore,
          planner: createFakePlanner(),
          now: () => "2026-07-11T08:00:00.000Z",
        });

        const summary = await service.resume(legacy.id);
        await Promise.resolve();
        const persisted = await realStore.get(legacy.id);

        expect(summary.status).toBe("executing");
        expect(controllerCalls).toEqual([`resume:${legacy.id}`]);
        expect(persisted).toMatchObject({
          status: "executing",
          acceptanceProtocolVersion: 2,
          acceptanceState: {
            protocolVersion: 2,
            phase: "idle",
            attempt: 0,
            recentFailures: [],
          },
        });
        expect(await readFile(goalPath, "utf8")).not.toBe(raw);
      } finally {
        await rm(configDir, { recursive: true, force: true });
      }
    },
  );

  it("reads a serialized terminal legacy goal through the real store without rewriting or restarting it", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "goal-chat-terminal-legacy-"));
    try {
      const goalsDir = path.join(configDir, "agent-goals");
      const goalPath = path.join(goalsDir, "goal_release.json");
      await mkdir(goalsDir, { recursive: true });
      const legacy = createGoal({
        status: "achieved",
        stopReason: "goal_accepted",
      });
      const raw = `${JSON.stringify(legacy, null, 4)}\n`;
      await writeFile(goalPath, raw, "utf8");
      const realStore = createAgentGoalStore({ configDir });
      const controllerCalls: string[] = [];
      const service = createGoalChatService({
        controller: createController({
          async resume(goalId) {
            controllerCalls.push(goalId);
            return legacy;
          },
        }),
        goalStore: realStore,
        planner: createFakePlanner(),
      });

      await expect(service.resume(legacy.id)).resolves.toMatchObject({
        status: "achieved",
      });

      expect(controllerCalls).toEqual([]);
      expect(await readFile(goalPath, "utf8")).toBe(raw);
      expect(await realStore.get(legacy.id)).not.toHaveProperty(
        "acceptanceProtocolVersion",
      );
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("keeps a historical budget-stopped goal read-only during replan", async () => {
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
          goal.executionUsage.replans += 1;
          return goal.milestones;
        },
      },
      now: () => "2026-06-12T08:00:00.000Z",
    });

    await expect(
      service.replan("goal_release", "只调整剩余步骤"),
    ).rejects.toThrow("read-only");
    expect(savedGoals).toEqual([]);
  });

  it("returns a concurrently canceled goal instead of publishing a stale manual replan", async () => {
    const existingGoal = createGoal({ status: "stopped_blocked" });
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
          goal.executionUsage.replans += 1;
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

  it("aborts and drains background goal runs during application shutdown", async () => {
    let startedSignal: AbortSignal | undefined;
    let settled = false;
    const service = createGoalChatService({
      controller: createController({
        async start(goalId, options) {
          startedSignal = options?.signal;
          return new Promise<Goal>((resolve) => {
            options?.signal?.addEventListener("abort", () => {
              settled = true;
              resolve(createGoal({ id: goalId, status: "canceled" }));
            }, { once: true });
          });
        },
      }),
      goalStore: createGoalStore({
        existingGoal: createGoal({ status: "planning" }),
      }),
      planner: createFakePlanner(),
      createId: () => "goal_shutdown",
      now: () => "2026-06-12T08:00:00.000Z",
    });

    await service.start("goal_release");
    await service.shutdown();

    expect(startedSignal?.aborted).toBe(true);
    expect(settled).toBe(true);
  });

  it("does not let a queued restart escape application shutdown", async () => {
    let starts = 0;
    let settleRun!: () => void;
    const service = createGoalChatService({
      controller: createController({
        async start(goalId) {
          starts += 1;
          return new Promise<Goal>((resolve) => {
            settleRun = () => resolve(createGoal({ id: goalId, status: "canceled" }));
          });
        },
      }),
      goalStore: createGoalStore({
        existingGoal: createGoal({ status: "planning" }),
      }),
      planner: createFakePlanner(),
      createId: () => "goal_shutdown_restart",
      now: () => "2026-06-12T08:00:00.000Z",
    });

    const parent = new AbortController();
    await service.start("goal_release", { signal: parent.signal });
    parent.abort();
    await service.start("goal_release");
    const shutdown = service.shutdown();
    settleRun();
    await shutdown;
    await Promise.resolve();

    expect(starts).toBe(1);
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

  it("keeps historical budget-stopped chat goals read-only", async () => {
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

    await expect(service.retry("goal_release")).rejects.toThrow("read-only");
    expect(resumed).toEqual([]);
    expect(savedGoals).toEqual([]);
    expect(ledgerEvents).toEqual([]);
  });

  it("retries a waiting-for-model goal only after the user requests it", async () => {
    const savedGoals: Goal[] = [];
    const ledgerEvents: ProgressLedgerEvent[] = [];
    const resumed: string[] = [];
    const waiting = createGoal({
      status: "waiting_for_model",
      modelServiceNotice: {
        kind: "rate_limit",
        provider: "test-provider",
        model: "test-model",
        statusCode: 429,
        retryAfterMs: 500,
        message: "模型服务商正在限流。",
      },
    });
    const service = createGoalChatService({
      controller: createController({
        async resume(goalId) {
          resumed.push(goalId);
          return createGoal({ id: goalId, status: "executing" });
        },
      }),
      goalStore: createGoalStore({
        existingGoal: waiting,
        savedGoals,
        ledgerEvents,
      }),
      planner: createFakePlanner(),
      now: () => "2026-06-12T08:00:00.000Z",
    });

    const summary = await service.retry(waiting.id);
    await Promise.resolve();

    expect(summary.status).toBe("executing");
    expect(savedGoals.at(-1)).toMatchObject({
      status: "executing",
      modelServiceNotice: undefined,
    });
    expect(ledgerEvents.at(-1)?.summary).toBe(
      "Goal retried from chat recovery UI.",
    );
    expect(resumed).toEqual([waiting.id]);
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
        executionUsage: { replans: 0 },
        acceptanceState: {
          phase: "idle",
          recentFailures: blocked.acceptanceState?.recentFailures,
          lastDecision: blocked.acceptanceState?.lastDecision,
        },
      });
    },
  );

  it("routes retry acceptance for a fully completed blocked goal through final acceptance recovery", async () => {
    const blocked = createBlockedGoal(
      "acceptance_unavailable",
      "acceptance_unavailable",
    );
    blocked.milestones = blocked.milestones.map((milestone) => ({
      ...milestone,
      state: "accepted" as const,
      attempts: 1,
      runIds: ["run_done"],
    }));
    const continued: string[] = [];
    const resumed: string[] = [];
    const savedGoals: Goal[] = [];
    const service = createGoalChatService({
      controller: createController({
        async continueAcceptance(goalId) {
          continued.push(goalId);
          return createGoal({ id: goalId, status: "achieved" });
        },
        async resume(goalId) {
          resumed.push(goalId);
          return blocked;
        },
      }),
      goalStore: createGoalStore({ existingGoal: blocked, savedGoals }),
      planner: createFakePlanner(),
    });

    await expect(service.retry(blocked.id)).resolves.toMatchObject({
      id: blocked.id,
      status: "achieved",
    });
    expect(continued).toEqual([blocked.id]);
    expect(resumed).toEqual([]);
    expect(savedGoals).toEqual([]);
  });

  it("rearms a rejected milestone and removes invalid dependency labels on retry", async () => {
    const savedGoals: Goal[] = [];
    const blocked = createBlockedGoal(
      "acceptance_unavailable",
      "acceptance_unavailable",
    );
    blocked.milestones = [
      {
        ...blocked.milestones[0]!,
        state: "rejected",
        lastAcceptanceSummary: "The partial run did not pass acceptance.",
      },
      {
        ...blocked.milestones[0]!,
        id: "milestone_2",
        description: "Continue after milestone one.",
        state: "pending",
        dependsOn: ["milestone_1", "external dependency label"],
      },
    ];
    const service = createGoalChatService({
      controller: createController({
        async resume() {
          return new Promise<Goal>(() => undefined);
        },
      }),
      goalStore: createGoalStore({ existingGoal: blocked, savedGoals }),
      planner: createFakePlanner(),
      now: () => "2026-07-30T08:00:00.000Z",
    });

    await expect(service.retry(blocked.id)).resolves.toMatchObject({
      status: "executing",
    });
    expect(savedGoals.at(-1)?.milestones).toEqual([
      expect.objectContaining({
        id: "milestone_1",
        state: "ready",
        dependsOn: [],
        lastAcceptanceSummary: undefined,
      }),
      expect.objectContaining({
        id: "milestone_2",
        state: "pending",
        dependsOn: ["milestone_1"],
      }),
    ]);
  });

  it("starts a fresh recovery epoch when the user retries a stalled goal", async () => {
    const savedGoals: Goal[] = [];
    const stalled = createGoal({
      status: "stopped_stalled",
      stopReason: "progress_stalled",
      acceptanceProtocolVersion: 2,
      acceptanceState: {
        protocolVersion: 2,
        phase: "idle",
        attempt: 5,
        recentFailures: [{
          at: "2026-07-30T07:59:00.000Z",
          targetKind: "milestone",
          targetId: "milestone_1",
          fingerprint: "c".repeat(64),
          occurrence: 5,
          verdict: "rejected",
          failureClass: "command_failed",
          failedCheckIds: ["check_python"],
          evidenceRefs: [],
          actionSignatures: ["shell_exec:python"],
        }],
        lastDecision: {
          action: "stop_stalled",
          summary: "The same acceptance failure repeated.",
          failedCheckIds: ["check_python"],
          fingerprint: "c".repeat(64),
          occurrence: 5,
          instructions: ["Resolve the environment mismatch."],
        },
      },
    });
    const service = createGoalChatService({
      controller: createController({
        async resume() {
          return new Promise<Goal>(() => undefined);
        },
      }),
      goalStore: createGoalStore({ existingGoal: stalled, savedGoals }),
      planner: createFakePlanner(),
      now: () => "2026-07-30T08:00:00.000Z",
    });

    await expect(service.retry(stalled.id)).resolves.toMatchObject({
      status: "executing",
    });
    expect(savedGoals.at(-1)?.acceptanceState).toMatchObject({
      phase: "idle",
      attempt: 5,
      recentFailures: [],
      lastDecision: undefined,
    });
  });

  it("rejects retry and replan for an acceptance-integrity failure", async () => {
    const blocked = createGoal({
      status: "stopped_blocked",
      stopReason: "acceptance_integrity_failed",
      acceptanceProtocolVersion: 2,
      acceptanceState: {
        protocolVersion: 2,
        phase: "blocked",
        attempt: 0,
        recentFailures: [],
      },
    });
    const savedGoals: Goal[] = [];
    let plannerCalls = 0;
    let resumeCalls = 0;
    const service = createGoalChatService({
      controller: createController({
        async resume() {
          resumeCalls += 1;
          return blocked;
        },
      }),
      goalStore: createGoalStore({ existingGoal: blocked, savedGoals }),
      planner: {
        async plan() {
          throw new Error("unexpected plan");
        },
        async replan() {
          plannerCalls += 1;
          return [];
        },
      },
    });

    await expect(service.retry(blocked.id)).rejects.toThrow(/integrity/i);
    await expect(service.replan(blocked.id, "try again")).rejects.toThrow(
      /integrity/i,
    );
    expect(savedGoals).toEqual([]);
    expect(resumeCalls).toBe(0);
    expect(plannerCalls).toBe(0);
  });

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
          goal.executionUsage.replans += 1;
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
      executionUsage: { replans: 1 },
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
      executionUsage: { replans: 1 },
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
      status: "waiting_for_model",
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
      status: "waiting_for_model",
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

  it("continues final acceptance explicitly and forwards the caller signal", async () => {
    const parentController = new AbortController();
    const signal = parentController.signal;
    const continuedGoal = createGoal({
      status: "waiting_for_acceptance",
      acceptanceState: {
        protocolVersion: 2,
        phase: "awaiting_user",
        attempt: 3,
        recentFailures: [],
      },
    });
    const continueAcceptance = async (
      goalId: string,
      options?: { signal?: AbortSignal },
    ) => {
      expect(goalId).toBe(continuedGoal.id);
      expect(options?.signal).not.toBe(signal);
      expect(options?.signal?.aborted).toBe(false);
      parentController.abort();
      expect(options?.signal?.aborted).toBe(true);
      const achieved = createGoal({ id: goalId, status: "achieved" });
      canonicalGoal = achieved;
      return achieved;
    };
    let canonicalGoal = continuedGoal;
    const service = createGoalChatService({
      controller: createController({ continueAcceptance }),
      goalStore: {
        async get(goalId) {
          return canonicalGoal.id === goalId ? canonicalGoal : null;
        },
        async save(goal) {
          canonicalGoal = goal;
          return canonicalGoal;
        },
        async appendLedger() {},
      },
      planner: createFakePlanner(),
    });

    await expect(
      service.continueAcceptance(continuedGoal.id, { signal }),
    ).resolves.toEqual({
      id: continuedGoal.id,
      description: continuedGoal.description,
      status: "achieved",
    });
  });

  it("records explicit unverified completion through the controller", async () => {
    const waitingGoal = createGoal({ status: "waiting_for_acceptance" });
    const markCompletedUnverified = async (goalId: string) =>
      createGoal({ id: goalId, status: "completed_unverified" });
    const service = createGoalChatService({
      controller: createController({ markCompletedUnverified }),
      goalStore: createGoalStore({ existingGoal: waitingGoal }),
      planner: createFakePlanner(),
    });

    await expect(
      service.markCompletedUnverified(waitingGoal.id),
    ).resolves.toEqual({
      id: waitingGoal.id,
      description: waitingGoal.description,
      status: "completed_unverified",
    });
  });

  it("aborts an active final-acceptance continuation when the goal is canceled", async () => {
    let persistedGoal = createGoal({ status: "waiting_for_acceptance" });
    let continuationSignal: AbortSignal | undefined;
    let continuationEnteredResolve: (() => void) | undefined;
    const continuationEntered = new Promise<void>((resolve) => {
      continuationEnteredResolve = resolve;
    });
    let releaseContinuation: (() => void) | undefined;
    let continuationCalls = 0;
    const continueAcceptance = async (
      goalId: string,
      options?: { signal?: AbortSignal },
    ) => {
      continuationCalls += 1;
      continuationSignal = options?.signal;
      continuationEnteredResolve?.();
      await new Promise<void>((resolve) => {
        releaseContinuation = resolve;
        options?.signal?.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
      return createGoal({ id: goalId, status: "achieved" });
    };
    const service = createGoalChatService({
      controller: createController({ continueAcceptance }),
      goalStore: {
        async get(goalId) {
          return persistedGoal.id === goalId ? persistedGoal : null;
        },
        async save(goal) {
          persistedGoal = structuredClone(goal);
          return persistedGoal;
        },
        async appendLedger() {},
      },
      planner: createFakePlanner(),
    });

    const continuing = service.continueAcceptance(persistedGoal.id);
    await continuationEntered;
    const duplicateContinuation = service.continueAcceptance(persistedGoal.id);
    const canceled = await service.cancel(persistedGoal.id);
    releaseContinuation?.();

    expect(continuationSignal?.aborted).toBe(true);
    expect(continuationCalls).toBe(1);
    expect(canceled.status).toBe("canceled");
    await expect(continuing).resolves.toMatchObject({ status: "canceled" });
    await expect(duplicateContinuation).resolves.toMatchObject({
      status: "canceled",
    });
  });

  it("keeps duplicate continuations registered through the final canonical read", async () => {
    let persistedGoal = createGoal({ status: "waiting_for_acceptance" });
    let continuationCalls = 0;
    let runnerReturned = false;
    let blockPostRunRead = true;
    let postRunReadEnteredResolve: (() => void) | undefined;
    const postRunReadEntered = new Promise<void>((resolve) => {
      postRunReadEnteredResolve = resolve;
    });
    let releasePostRunRead: (() => void) | undefined;
    const postRunReadReleased = new Promise<void>((resolve) => {
      releasePostRunRead = resolve;
    });
    const service = createGoalChatService({
      controller: createController({
        async continueAcceptance(goalId) {
          continuationCalls += 1;
          runnerReturned = true;
          return createGoal({
            id: goalId,
            status: "waiting_for_acceptance",
          });
        },
      }),
      goalStore: {
        async get(goalId) {
          const snapshot = structuredClone(persistedGoal);
          if (runnerReturned && blockPostRunRead) {
            blockPostRunRead = false;
            postRunReadEnteredResolve?.();
            await postRunReadReleased;
          }
          return snapshot.id === goalId ? snapshot : null;
        },
        async save(goal) {
          persistedGoal = structuredClone(goal);
          return persistedGoal;
        },
        async appendLedger() {},
      },
      planner: createFakePlanner(),
    });

    const first = service.continueAcceptance(persistedGoal.id);
    await postRunReadEntered;
    const second = service.continueAcceptance(persistedGoal.id);
    expect(continuationCalls).toBe(1);

    const canceled = await service.cancel(persistedGoal.id);
    releasePostRunRead?.();

    await expect(first).resolves.toMatchObject({ status: "canceled" });
    await expect(second).resolves.toMatchObject({ status: "canceled" });
    expect(canceled.status).toBe("canceled");
    expect(continuationCalls).toBe(1);

    await service.continueAcceptance(persistedGoal.id);
    expect(continuationCalls).toBe(2);
  });

  it("starts continuation after a waiting goal is published before background cleanup finishes", async () => {
    let persistedGoal = createGoal({ status: "executing" });
    let releaseBackground: (() => void) | undefined;
    const backgroundReleased = new Promise<void>((resolve) => {
      releaseBackground = resolve;
    });
    let waitingPublishedResolve: (() => void) | undefined;
    const waitingPublished = new Promise<void>((resolve) => {
      waitingPublishedResolve = resolve;
    });
    let continuationCalls = 0;
    const service = createGoalChatService({
      controller: createController({
        async start(goalId) {
          persistedGoal = createGoal({
            id: goalId,
            status: "waiting_for_acceptance",
          });
          waitingPublishedResolve?.();
          await backgroundReleased;
          return persistedGoal;
        },
        async continueAcceptance(goalId) {
          continuationCalls += 1;
          persistedGoal = createGoal({ id: goalId, status: "achieved" });
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
          return persistedGoal;
        },
        async appendLedger() {},
      },
      planner: createFakePlanner(),
    });

    await service.start(persistedGoal.id);
    await waitingPublished;
    const continued = service.continueAcceptance(persistedGoal.id);
    releaseBackground?.();

    await expect(continued).resolves.toMatchObject({ status: "achieved" });
    expect(continuationCalls).toBe(1);
  });

  it("returns a canonical terminal winner without starting continuation after background cleanup", async () => {
    let persistedGoal = createGoal({ status: "executing" });
    let releaseBackground: (() => void) | undefined;
    const backgroundReleased = new Promise<void>((resolve) => {
      releaseBackground = resolve;
    });
    let waitingPublishedResolve: (() => void) | undefined;
    const waitingPublished = new Promise<void>((resolve) => {
      waitingPublishedResolve = resolve;
    });
    let continuationCalls = 0;
    const service = createGoalChatService({
      controller: createController({
        async start(goalId) {
          persistedGoal = createGoal({
            id: goalId,
            status: "waiting_for_acceptance",
          });
          waitingPublishedResolve?.();
          await backgroundReleased;
          persistedGoal = createGoal({ id: goalId, status: "canceled" });
          return persistedGoal;
        },
        async continueAcceptance(goalId) {
          continuationCalls += 1;
          return createGoal({ id: goalId, status: "achieved" });
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
          return persistedGoal;
        },
        async appendLedger() {},
      },
      planner: createFakePlanner(),
    });

    await service.start(persistedGoal.id);
    await waitingPublished;
    const continued = service.continueAcceptance(persistedGoal.id);
    releaseBackground?.();

    await expect(continued).resolves.toMatchObject({ status: "canceled" });
    expect(continuationCalls).toBe(0);
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
  continueAcceptance(
    goalId: string,
    options?: { signal?: AbortSignal },
  ): Promise<Goal>;
  markCompletedUnverified(goalId: string): Promise<Goal>;
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
    async continueAcceptance(goalId: string) {
      return createGoal({ id: goalId, status: "achieved" });
    },
    async markCompletedUnverified(goalId: string) {
      return createGoal({ id: goalId, status: "completed_unverified" });
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
    executionUsage: {
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
