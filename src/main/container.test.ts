import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAppContainer,
  formatGoalTerminalHeading,
  reconcileIrreversibleGoalProgressEvent,
} from "./container";
import { registerAllIpcHandlers } from "./ipc";
import { createToolApprovalCoordinator } from "./toolApprovalCoordinator";
import { issueToolResultRefReadCapability } from "./toolResultOffloadStore";
import type { Goal } from "../shared/agentGoal";
import type { AgentExecutionCheckpoint } from "../shared/agentExecution";
import type { GoalProgressEvent } from "../shared/chat";
import type { ChatOutputPart } from "../shared/chatOutput";
import type { AcceptanceValidator } from "./agentGoalValidatorRegistry";

const execFileAsync = promisify(execFileCallback);

const toolWorkerMock = vi.hoisted(() => ({
  createToolWorker: vi.fn((options: unknown) => ({
    close: vi.fn(),
    execute: vi.fn(),
    options,
  })),
}));

const electronState = vi.hoisted(() => ({
  userDataPath: "",
  appPath: "",
  ipcHandlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
  app: {
    getAppPath: () => electronState.appPath,
    getPath: (name: string) => {
      if (name !== "userData") {
        throw new Error(`Unexpected Electron path request: ${name}`);
      }
      return electronState.userDataPath;
    },
    getVersion: () => "1.9.4",
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electronState.ipcHandlers.set(channel, handler);
    },
  },
  safeStorage: {
    decryptString: (value: Buffer) => value.toString("utf8"),
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    isEncryptionAvailable: () => true,
  },
}));

vi.mock("./tools/toolWorker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tools/toolWorker")>()),
  createToolWorker: toolWorkerMock.createToolWorker,
}));

describe("app container goal drafts", () => {
  let tempDir: string;
  const originalToolWorkerEnv = process.env.ZEROX_TOOL_WORKER;
  const originalLegacyToolWorkerEnv = process.env.BUILDING_AGENT_TOOL_WORKER;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "zerox-container-"));
    electronState.userDataPath = tempDir;
    electronState.appPath = process.cwd();
    electronState.ipcHandlers.clear();
    toolWorkerMock.createToolWorker.mockClear();
    delete process.env.ZEROX_TOOL_WORKER;
    delete process.env.BUILDING_AGENT_TOOL_WORKER;
  });

  afterEach(async () => {
    if (originalToolWorkerEnv === undefined) {
      delete process.env.ZEROX_TOOL_WORKER;
    } else {
      process.env.ZEROX_TOOL_WORKER = originalToolWorkerEnv;
    }
    if (originalLegacyToolWorkerEnv === undefined) {
      delete process.env.BUILDING_AGENT_TOOL_WORKER;
    } else {
      process.env.BUILDING_AGENT_TOOL_WORKER = originalLegacyToolWorkerEnv;
    }
    await rm(tempDir, { force: true, recursive: true });
  });

  it("wires ZEROX_TOOL_WORKER=subprocess through the production container worker", () => {
    process.env.ZEROX_TOOL_WORKER = "subprocess";
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });

    const containerWithWorker = container as typeof container & {
      toolWorker?: () => unknown;
    };
    expect(containerWithWorker.toolWorker).toBeTypeOf("function");
    containerWithWorker.toolWorker?.();

    expect(toolWorkerMock.createToolWorker).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "subprocess" }),
    );
  });

  it("preserves explicit in-process worker mode for development and tests", () => {
    process.env.ZEROX_TOOL_WORKER = "inproc";
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });

    const containerWithWorker = container as typeof container & {
      toolWorker?: () => unknown;
    };
    expect(containerWithWorker.toolWorker).toBeTypeOf("function");
    containerWithWorker.toolWorker?.();

    expect(toolWorkerMock.createToolWorker).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "inproc" }),
    );
  });

  it("constructs one production acceptance registry with builtins and trusted custom validators", async () => {
    let receivedContext: unknown;
    const customKind = "validator:trusted/report" as const;
    const customValidator: AcceptanceValidator = {
      kind: customKind,
      async evaluate(input) {
        receivedContext = input.context;
        return {
          checkId: input.check.id,
          kind: customKind,
          passed: true,
          code: "trusted_report_valid",
          evidenceRefs: ["artifact:trusted-report"],
          detail: "Trusted report is valid.",
        };
      },
    };
    const container = createAppContainer({
      acceptanceValidators: [customValidator],
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });
    const registry = container.agentGoalValidatorRegistry();
    const acceptance = container.agentGoalAcceptance();
    const sentinel = "container-secret-api-key";

    expect(container.agentGoalValidatorRegistry()).toBe(registry);
    expect(registry.listKinds()).toEqual([
      "file_exists",
      "command_exit_code",
      "test_passes",
      "assertion",
      customKind,
    ]);
    const result = await acceptance.evaluate(
      {
        id: "milestone_custom",
        description: "Validate trusted report.",
        dependsOn: [],
        successCriteria: [{
          id: "criterion_custom",
          description: "Trusted report is valid.",
          acceptanceChecks: [{
            id: "check_custom",
            kind: customKind,
            description: "Run trusted validator.",
            params: {},
            requiresEvidence: false,
          }],
        }],
        state: "running",
        runIds: ["run_custom"],
        attempts: 1,
      },
      {
        runId: "run_custom",
        workspacePath: tempDir,
        toolExecutor: {
          async execute() {
            throw new Error("Tool call is not expected.");
          },
        },
        trajectoryStore: {
          async append(_runId, event) {
            return event;
          },
        },
        modelProfile: {
          baseUrl: "https://provider.invalid",
          apiKey: sentinel,
          model: "judge-model",
          temperature: 0,
          maxTokens: 100,
        },
      },
    );

    expect(result).toMatchObject({ accepted: true, verdict: "accepted" });
    expect(receivedContext).not.toHaveProperty("modelProfile");
    expect(JSON.stringify(receivedContext)).not.toContain(sentinel);
  });

  it("rejects trusted validator kinds that duplicate builtins or each other", () => {
    const builtinDuplicate: AcceptanceValidator = {
      kind: "assertion",
      async evaluate({ check }) {
        return {
          checkId: check.id,
          kind: check.kind,
          passed: true,
          code: "duplicate",
          evidenceRefs: [],
          detail: "Duplicate.",
        };
      },
    };
    const container = createAppContainer({
      acceptanceValidators: [builtinDuplicate],
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });

    expect(() => container.agentGoalValidatorRegistry()).toThrow(
      "Acceptance validator already registered: assertion",
    );
  });

  it.each([
    ["external_blocked", "外部依赖受阻"],
    ["goal_impossible", "目标不可实现"],
    ["acceptance_unavailable", "验收暂不可用"],
  ] as const)("formats stopped_blocked terminal status truthfully for %s", (stopReason, text) => {
    const goal = createStoredGoal({
      id: `goal_${stopReason}`,
      status: "stopped_blocked",
      stopReason,
    });

    expect(formatGoalTerminalHeading(goal)).toContain(text);
    expect(formatGoalTerminalHeading(goal)).not.toContain("目标已达成");
  });

  it("creates evidence-backed model review checks for manual goals", () => {
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });

    const goal = container.createGoalDraft({
      description: "完成一次端到端目标模式验证",
      successCriteria: ["目标模式能够自主执行并通过验证"],
      budget: {
        maxIterations: 4,
        maxToolCalls: 12,
        maxWallClockMs: 300_000,
        maxReplans: 1,
      },
      reviewPolicy: "review_final_only",
    });

    expect(goal.successCriteria[0]?.acceptanceChecks[0]).toMatchObject({
      kind: "model_review",
      requiresEvidence: true,
      params: {
        condition: "目标模式能够自主执行并通过验证",
        evidenceRefs: ["artifact:goalEvidence"],
      },
    });
    expect(goal).toMatchObject({
      acceptanceProtocolVersion: 2,
      acceptanceState: {
        protocolVersion: 2,
        phase: "idle",
        attempt: 0,
        recentFailures: [],
      },
    });
  });

  it("creates evidence-backed fallback checks when manual goal criteria are blank", () => {
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });

    const goal = container.createGoalDraft({
      description: "修复目标模式",
      successCriteria: ["   "],
      budget: {
        maxIterations: 4,
        maxToolCalls: 12,
        maxWallClockMs: 300_000,
        maxReplans: 1,
      },
      reviewPolicy: "review_final_only",
    });

    expect(goal.successCriteria[0]?.acceptanceChecks[0]).toMatchObject({
      kind: "model_review",
      requiresEvidence: true,
      params: {
        condition: "修复目标模式",
        evidenceRefs: ["artifact:goalEvidence"],
      },
    });
  });

  it("denies forged renderer capabilities while preserving scoped and issued ref reads", async () => {
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });
    const written = await container.toolResultOffloadStore().write({
      runId: "run_owner",
      toolName: "file_read",
      content: JSON.stringify({
        type: "tool_result",
        tool: "file_read",
        ok: true,
        result: { content: "scoped UI content" },
      }),
    });
    await expect(container.readToolResultRef(written.relativePath)).resolves.toMatchObject({
      ok: false,
    });
    await expect(
      container.readToolResultRef(written.relativePath, { runId: "run_other" }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      container.readToolResultRef(written.relativePath, { runId: "run_owner" }),
    ).resolves.toMatchObject({
      ok: true,
      content: expect.stringContaining("scoped UI content"),
    });
    await expect(
      container.readToolResultRef(written.relativePath, {
        capability: {
          kind: "tool_result_ref_read",
          ref: written.relativePath,
        },
      }),
    ).resolves.toMatchObject({ ok: false });

    await expect(
      container.readToolResultRef(written.relativePath, {
        capability: issueToolResultRefReadCapability({
          ref: written.relativePath,
          issuedByRunId: "run_owner",
        }),
      }),
    ).resolves.toMatchObject({
      ok: true,
      content: expect.stringContaining("scoped UI content"),
    });

    registerAllIpcHandlers(container);
    const ipcReadRef = electronState.ipcHandlers.get("toolResults:readRef");
    expect(ipcReadRef).toBeTypeOf("function");
    await expect(
      ipcReadRef?.({}, written.relativePath, { runId: "run_owner" }),
    ).resolves.toMatchObject({
      ok: true,
      content: expect.stringContaining("scoped UI content"),
    });
    await expect(
      ipcReadRef?.({}, written.relativePath, {
        runId: "run_other",
        capability: {
          kind: "tool_result_ref_read",
          ref: written.relativePath,
        },
      }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("creates a chat session for legacy active runs that were not bound to one", async () => {
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });
    const task = await container.scheduledTaskStore().create({
      name: "每天汇报天气",
      skillName: "",
      enabled: true,
      schedule: { kind: "daily", time: "12:33" },
      input: { request: "查询上海此刻的天气" },
    });
    const checkpoint: AgentExecutionCheckpoint = {
      id: "checkpoint_legacy",
      runId: "run_legacy_without_session",
      taskId: task.id,
      status: "waiting_for_approval",
      currentStepId: "step_1",
      steps: [
        {
          id: "step_1",
          description: task.name,
          expectedOutcome: "Task completes with a final summary.",
          state: "waiting_for_approval",
          attempts: 1,
        },
      ],
      messages: [
        {
          role: "user",
          content: "定时任务：每天汇报天气\n\n查询上海此刻的天气",
        },
      ],
      toolCallCount: 0,
      createdAt: "2026-06-28T04:33:00.000Z",
      updatedAt: "2026-06-28T04:33:35.632Z",
    };
    await container.agentExecutionStore().save(checkpoint);

    const result = await container.openAgentRunSession(
      "run_legacy_without_session",
    );

    expect(result).toMatchObject({ ok: true, sessionId: expect.any(String) });
    if (!result.ok) {
      throw new Error(result.message);
    }
    const session = await container.chatSessionStore().get(result.sessionId);
    expect(session?.messages.map((message) => message.content).join("\n")).toContain(
      "定时任务：每天汇报天气",
    );
    expect(session?.messages.map((message) => message.content).join("\n")).toContain(
      "等待授权",
    );
    await expect(
      container.agentExecutionStore().get("run_legacy_without_session"),
    ).resolves.toMatchObject({
      runContext: {
        sessionId: result.sessionId,
      },
    });
  });

  it("rejects globally automatic approval for untrusted git worktree creation", async () => {
    const coordinator = createToolApprovalCoordinator({
      sendToRenderers() {},
      createId: () => "approval_auto_worktree",
      now: () => "2026-06-21T00:00:00.000Z",
    });
    coordinator.setAutoApprovalEnabled(true);
    const container = createAppContainer({
      requestToolApproval: coordinator.requestUserApproval,
    });
    const repositoryRoot = path.join(tempDir, "untrusted-repo");
    await createSeedGitRepository(repositoryRoot);

    await expect(
      container.requestGitWorktreeAgentWorkspace({
        name: "Auto-approved worktree",
        repositoryRoot,
        branch: "codex/auto-approved-worktree",
      }),
    ).rejects.toThrow(/explicit user approval/i);

    await expect(container.agentWorkspaceStore().list()).resolves.toEqual([]);
    await expect(listGitBranches(repositoryRoot)).resolves.not.toContain(
      "codex/auto-approved-worktree",
    );
  });

  it("syncs background goal status changes into chat session summaries before notifying listeners", async () => {
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });
    const session = await container.chatSessionStore().appendMessage({
      role: "user",
      content: "/目标 回复 smoke 短句",
    });
    const goal = createStoredGoal({
      id: "goal_sync",
      chatSessionId: session.session.id,
      status: "planning",
    });

    await container.agentGoalStore().save(goal);
    await container.chatSessionStore().attachGoal(session.session.id, {
      id: goal.id,
      description: goal.description,
      status: "planning",
    });

    const progress = new Promise<GoalProgressEvent>((resolve) => {
      const unsubscribe = container.onGoalProgressEvent((event) => {
        if (event.goalId === goal.id && event.status === "canceled") {
          unsubscribe();
          resolve(event);
        }
      });
    });

    await container.goalChatService().cancel(goal.id);
    await progress;

    const listedSession = (await container.chatSessionStore().list()).find(
      (item) => item.id === session.session.id,
    );
    expect(listedSession?.activeGoal).toBeUndefined();
    expect(
      (await container.chatSessionStore().get(session.session.id))?.goalSummaries?.find(
        (summary) => summary.id === goal.id,
      ),
    ).toMatchObject({
      id: goal.id,
      status: "canceled",
    });
  });

  it("reconciles stale progress events against irreversible persisted goal status", () => {
    const staleEvent: GoalProgressEvent = {
      kind: "goal_progress",
      goalId: "goal_race",
      sessionId: "chat_race",
      status: "waiting_for_review",
      event: "review_requested",
      message: "里程碑完成，等待你审核。",
      timestamp: "2026-06-12T08:00:00.000Z",
    };

    expect(
      reconcileIrreversibleGoalProgressEvent(
        staleEvent,
        createStoredGoal({
          id: "goal_race",
          status: "canceled",
          stopReason: "user_canceled",
        }),
      ),
    ).toMatchObject({
      status: "canceled",
      event: "stopped",
      message: "目标已取消。",
    });
  });

  it.each([
    "acceptance_manifest_created",
    "acceptance_failure_classified",
    "acceptance_repair_scheduled",
    "acceptance_strategy_changed",
    "acceptance_blocked",
    "acceptance_certified",
  ] satisfies GoalProgressEvent["event"][])(
    "canonically reconciles stale %s delivery before terminal notification",
    (event) => {
      const staleEvent: GoalProgressEvent = {
        kind: "goal_progress",
        goalId: `goal_${event}`,
        sessionId: "chat_acceptance_race",
        status: "executing",
        event,
        message: "Stale acceptance progress.",
        timestamp: "2026-07-11T08:00:00.000Z",
      };

      expect(
        reconcileIrreversibleGoalProgressEvent(
          staleEvent,
          createStoredGoal({
            id: staleEvent.goalId,
            status: event === "acceptance_certified" ? "canceled" : "achieved",
            stopReason:
              event === "acceptance_certified"
                ? "user_canceled"
                : "goal_accepted",
          }),
        ),
      ).toMatchObject({
        status: event === "acceptance_certified" ? "canceled" : "achieved",
        event: "stopped",
        message:
          event === "acceptance_certified" ? "目标已取消。" : "目标已达成。",
      });
    },
  );

  it.each([
    ["external_blocked", "外部依赖受阻"],
    ["goal_impossible", "目标不可实现"],
    ["acceptance_unavailable", "验收暂不可用"],
  ] as const)(
    "keeps %s blocked chat output reason-specific and recoverable",
    async (stopReason, expectedText) => {
      const container = createAppContainer({
        async requestToolApproval() {
          return { approved: false, reason: "test" };
        },
      });
      const session = await container.chatSessionStore().appendMessage({
        role: "user",
        content: "/目标 验证阻塞状态",
      });
      const goal = createStoredGoal({
        id: `goal_blocked_${stopReason}`,
        chatSessionId: session.session.id,
        status: "stopped_blocked",
        stopReason,
      });
      await container.agentGoalStore().save(goal);
      await container.chatSessionStore().attachGoal(session.session.id, {
        id: goal.id,
        description: goal.description,
        status: goal.status,
      });

      const listed = (await container.listChatSessions()).find(
        (item) => item.id === session.session.id,
      );
      const message = formatGoalTerminalHeading(goal);

      expect(listed?.activeGoal).toMatchObject({
        id: goal.id,
        status: "stopped_blocked",
      });
      expect(message).toContain(expectedText);
      expect(message).not.toContain("目标已达成");
      expect(message).not.toContain("已完成");
    },
  );

  it("keeps the chat session terminal when a stale budget event arrives after cancellation", async () => {
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });
    const session = await container.chatSessionStore().appendMessage({
      role: "user",
      content: "/目标 验证取消竞态",
    });
    const goal = createStoredGoal({
      id: "goal_progress_race",
      chatSessionId: session.session.id,
      status: "stopped_budget",
      stopReason: "budget_exhausted",
    });
    const store = container.agentGoalStore();
    await store.save(goal);
    await container.chatSessionStore().attachGoal(session.session.id, {
      id: goal.id,
      description: goal.description,
      status: goal.status,
    });

    let releaseBudgetLedger: (() => void) | undefined;
    const budgetLedgerGate = new Promise<void>((resolve) => {
      releaseBudgetLedger = resolve;
    });
    let budgetLedgerEnteredResolve: (() => void) | undefined;
    const budgetLedgerEntered = new Promise<void>((resolve) => {
      budgetLedgerEnteredResolve = resolve;
    });
    const appendLedger = store.appendLedger.bind(store);
    store.appendLedger = async (goalId, event) => {
      if (event.kind === "goal_replanned") {
        budgetLedgerEnteredResolve?.();
        await budgetLedgerGate;
      }
      await appendLedger(goalId, event);
    };

    const progressEvents: GoalProgressEvent[] = [];
    let deliveredResolve: (() => void) | undefined;
    const delivered = new Promise<void>((resolve) => {
      deliveredResolve = resolve;
    });
    const unsubscribe = container.onGoalProgressEvent((event) => {
      if (event.goalId !== goal.id) {
        return;
      }
      progressEvents.push(event);
      if (progressEvents.length >= 2) {
        deliveredResolve?.();
      }
    });

    const increasing = container.goalChatService().increaseBudget(goal.id, {
      maxIterations: 1,
    });
    await budgetLedgerEntered;
    await container.goalChatService().cancel(goal.id);
    releaseBudgetLedger?.();
    await increasing;
    await delivered;
    unsubscribe();

    expect(progressEvents).toHaveLength(2);
    expect(progressEvents.every((event) => event.status === "canceled")).toBe(true);
    expect(progressEvents.at(-1)).toMatchObject({
      status: "canceled",
      event: "stopped",
      message: "目标已取消。",
    });
    expect(
      (await container.chatSessionStore().get(session.session.id))?.goalSummaries?.find(
        (summary) => summary.id === goal.id,
      ),
    ).toMatchObject({ status: "canceled" });
  });

  it("appends a final assistant result when a background goal is achieved", async () => {
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });
    const session = await container.chatSessionStore().appendMessage({
      role: "user",
      content: "/目标 帮我看一下我chrome浏览器的书签都有哪些",
    });
    const goal = createStoredGoal({
      id: "goal_terminal_result",
      chatSessionId: session.session.id,
      status: "waiting_for_review",
      description: "帮我看一下我chrome浏览器的书签都有哪些",
      successCriteria: [
        {
          id: "criterion_goal_progress",
          description: "所有里程碑都已完成",
          acceptanceChecks: [
            {
              id: "check_goal_progress",
              kind: "assertion",
              description: "Goal progress shows all milestones accepted.",
              params: {
                artifactRef: "goalProgress",
                path: "allMilestonesAccepted",
                equals: true,
              },
              requiresEvidence: false,
            },
          ],
        },
      ],
      milestones: [
        {
          id: "milestone_bookmarks",
          description: "读取 Chrome 书签",
          dependsOn: [],
          successCriteria: [
            {
              id: "criterion_bookmarks",
              description: "Chrome 书签已读取",
              acceptanceChecks: [
                {
                  id: "check_bookmarks",
                  kind: "assertion",
                  description: "Bookmark summary exists.",
                  params: {
                    artifactRef: "milestoneProgress",
                    path: "hasRun",
                    equals: true,
                  },
                  requiresEvidence: false,
                },
              ],
            },
          ],
          state: "accepted",
          runIds: ["goal_run_bookmarks"],
          attempts: 1,
          lastRunStatus: "succeeded",
          lastRunSummary: "Chrome 书签：OpenAI https://openai.com",
          lastAcceptanceSummary: "Chrome 书签清单已完成。",
        },
      ],
    });

    await container.agentGoalStore().save(goal);
    await container.chatSessionStore().attachGoal(session.session.id, {
      id: goal.id,
      description: goal.description,
      status: "waiting_for_review",
    });

    const progress = new Promise<GoalProgressEvent>((resolve) => {
      const unsubscribe = container.onGoalProgressEvent((event) => {
        if (event.goalId === goal.id && event.status === "achieved") {
          unsubscribe();
          resolve(event);
        }
      });
    });

    const result = await container.goalChatService().resolveReview(goal.id, {
      kind: "approve_continue",
    });
    expect(result.status).toBe("executing");
    await progress;

    const loadedSession = await container.chatSessionStore().get(session.session.id);
    const terminalMessage = loadedSession?.messages.find(
      (message) =>
        message.role === "assistant" &&
        message.goalEventRef === "goal-terminal:goal_terminal_result:achieved",
    );
    expect(terminalMessage?.content).toContain("目标已达成");
    expect(terminalMessage?.content).toContain("Chrome 书签");
    expect(terminalMessage?.content).toContain("https://openai.com");
    expect(terminalMessage?.goalId).toBe(goal.id);
  });

  it("repairs stale persisted chat goal summaries from the goal store when sessions load", async () => {
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });
    const session = await container.chatSessionStore().appendMessage({
      role: "user",
      content: "/目标 回复 smoke 短句",
    });
    const goal = createStoredGoal({
      id: "goal_repair",
      chatSessionId: session.session.id,
      status: "achieved",
    });

    await container.agentGoalStore().save(goal);
    await container.chatSessionStore().attachGoal(session.session.id, {
      id: goal.id,
      description: goal.description,
      status: "executing",
    });

    const listedSession = (await container.listChatSessions()).find(
      (item) => item.id === session.session.id,
    );
    expect(listedSession?.activeGoal).toBeUndefined();
    expect(
      (await container.chatSessionStore().get(session.session.id))?.goalSummaries?.find(
        (summary) => summary.id === goal.id,
      ),
    ).toMatchObject({
      id: goal.id,
      status: "achieved",
    });

    const loadedSession = await container.getChatSession(session.session.id);
    expect(
      loadedSession?.goalSummaries?.find((summary) => summary.id === goal.id),
    ).toMatchObject({
      id: goal.id,
      status: "achieved",
    });

    const persistedSession = (await container.chatSessionStore().list()).find(
      (item) => item.id === session.session.id,
    );
    const persistedRecord = await container.chatSessionStore().get(session.session.id);
    expect(persistedSession?.activeGoal).toBeUndefined();
    expect(persistedRecord?.activeGoalId).toBeUndefined();
    expect(persistedRecord?.goalSummaries?.find((summary) => summary.id === goal.id)).toMatchObject({
      id: goal.id,
      status: "achieved",
    });
  });

  it("projects chat session details for the renderer without dropping stored audit output", async () => {
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });
    const outputParts: ChatOutputPart[] = [
      {
        id: "text_1",
        type: "text",
        text: "Readable answer",
        format: "markdown",
      },
      {
        id: "tool_result_1",
        type: "tool_result",
        toolCallId: "call_1",
        ok: true,
        resultPreview: { payload: "x".repeat(120_000) },
      },
      {
        id: "command_output_1",
        type: "command_output",
        command: "cat huge.json",
        stdout: "x".repeat(80_000),
        stderr: "",
        exitCode: 0,
      },
    ];
    const appended = await container.chatSessionStore().appendMessage({
      role: "assistant",
      content: "Readable answer",
      outputParts,
    });

    const rendererSession = await container.getChatSession(appended.session.id);
    const storedSession = await container.chatSessionStore().get(appended.session.id);

    expect(rendererSession?.messages[0].outputParts).toEqual([outputParts[0]]);
    expect(storedSession?.messages[0].outputParts).toEqual(outputParts);
    expect(JSON.stringify(rendererSession).length).toBeLessThan(
      JSON.stringify(storedSession).length / 20,
    );
  });
});

async function createSeedGitRepository(repositoryRoot: string): Promise<void> {
  await mkdir(repositoryRoot, { recursive: true });
  await execFileAsync("git", ["init"], { cwd: repositoryRoot });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd: repositoryRoot,
  });
  await execFileAsync("git", ["config", "user.name", "Zerox Test"], {
    cwd: repositoryRoot,
  });
  await writeFile(path.join(repositoryRoot, "README.md"), "seed\n", "utf8");
  await execFileAsync("git", ["add", "README.md"], { cwd: repositoryRoot });
  await execFileAsync("git", ["commit", "-m", "seed"], { cwd: repositoryRoot });
}

async function listGitBranches(repositoryRoot: string): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["branch", "--format=%(refname:short)"], {
    cwd: repositoryRoot,
  });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function createStoredGoal(
  overrides: Pick<Goal, "id" | "chatSessionId" | "status"> & Partial<Goal>,
): Goal {
  const timestamp = "2026-06-14T15:00:00.000Z";

  return {
    id: overrides.id,
    chatSessionId: overrides.chatSessionId,
    description: overrides.description ?? "回复 smoke 短句",
    successCriteria: overrides.successCriteria ?? [
      {
        id: "criterion_smoke",
        description: "回复 smoke 短句",
        acceptanceChecks: [
          {
            id: "criterion_smoke_review",
            kind: "model_review",
            description: "Judge confirms smoke output.",
            params: {
              condition: "回复 smoke 短句",
              evidenceRefs: ["artifact:goalEvidence"],
            },
            requiresEvidence: true,
          },
        ],
      },
    ],
    milestones: overrides.milestones ?? [
      {
        id: "milestone_smoke",
        description: "回复 smoke 短句",
        dependsOn: [],
        successCriteria: [
          {
            id: "criterion_smoke",
            description: "回复 smoke 短句",
            acceptanceChecks: [
              {
                id: "criterion_smoke_review",
                kind: "model_review",
                description: "Judge confirms smoke output.",
                params: {
                  condition: "回复 smoke 短句",
                  evidenceRefs: ["artifact:goalEvidence"],
                },
                requiresEvidence: true,
              },
            ],
          },
        ],
        state: "ready",
        runIds: [],
        attempts: 0,
      },
    ],
    status: overrides.status,
    budget: overrides.budget ?? {
      maxIterations: 2,
      maxToolCalls: 4,
      maxWallClockMs: 60_000,
      maxReplans: 1,
    },
    budgetUsage: overrides.budgetUsage ?? {
      iterations: 0,
      toolCalls: 0,
      wallClockMs: 0,
      tokens: 0,
      replans: 0,
    },
    reviewPolicy: overrides.reviewPolicy ?? "review_final_only",
    planVersion: overrides.planVersion ?? 1,
    ...(overrides.stopReason ? { stopReason: overrides.stopReason } : {}),
    ...(overrides.workspaceId ? { workspaceId: overrides.workspaceId } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
