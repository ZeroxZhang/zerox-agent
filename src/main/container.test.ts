import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAppContainer,
  formatGoalTerminalHeading,
  isTerminalGoalStatus,
  prepareInterruptedGoalForResume,
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
import type { AcceptanceContext } from "./agentGoalAcceptance";
import type { PlanArtifact, PlanRecord } from "../shared/planMode";

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
  it("makes a checkpointed running milestone resumable after process restart", () => {
    const baseGoal = createStoredGoal({
      id: "goal_interrupted",
      chatSessionId: "chat_1",
      status: "executing",
      milestones: [
        {
          id: "milestone_1",
          description: "Continue work",
          dependsOn: [],
          successCriteria: [],
          state: "running",
          runIds: [],
          attempts: 1,
        },
      ],
    });
    const goal: Goal = {
      ...baseGoal,
      runtimeCheckpoint: {
        milestoneId: "milestone_1",
        transcriptMessages: [{ role: "assistant", content: "checkpoint" }],
        nextAction: "continue",
        updatedAt: "2026-07-11T12:00:00.000Z",
      },
    };

    expect(prepareInterruptedGoalForResume(goal).milestones[0]?.state).toBe("ready");
  });

  it("makes a running milestone resumable even before the first checkpoint", () => {
    const goal = createStoredGoal({
      id: "goal_interrupted_early",
      chatSessionId: "chat_1",
      status: "executing",
      milestones: [{
        id: "milestone_1",
        description: "Continue work",
        dependsOn: [],
        successCriteria: [],
        state: "running",
        runIds: [],
        attempts: 1,
      }],
    });
    expect(prepareInterruptedGoalForResume(goal).milestones[0]?.state).toBe("ready");
  });

  it("recovers an interrupted final-acceptance retry as waiting instead of auto-running it", () => {
    const goal = createStoredGoal({
      id: "goal_interrupted_acceptance",
      chatSessionId: "chat_1",
      status: "executing",
      milestones: [{
        id: "milestone_1",
        description: "Completed work",
        dependsOn: [],
        successCriteria: [],
        state: "accepted",
        runIds: ["run_1"],
        attempts: 1,
      }],
      acceptanceProtocolVersion: 2,
      acceptanceState: {
        protocolVersion: 2,
        phase: "retrying",
        attempt: 2,
        recentFailures: [],
      },
      acceptanceRetryState: {
        cycle: 1,
        attempt: 2,
        maxAttempts: 3,
        lastCode: "judge_timeout",
        lastDetail: "Final judge timed out.",
        nextRetryAt: "2026-07-11T05:00:02.000Z",
        evidenceFingerprint: "a".repeat(64),
        resumeFrom: "final_judge",
      },
    });

    expect(prepareInterruptedGoalForResume(goal)).toMatchObject({
      status: "waiting_for_acceptance",
      stopReason: undefined,
      acceptanceState: { phase: "awaiting_user" },
      acceptanceRetryState: {
        attempt: 2,
        evidenceFingerprint: "a".repeat(64),
      },
    });
    expect(
      prepareInterruptedGoalForResume(goal).acceptanceRetryState,
    ).not.toHaveProperty("nextRetryAt");
  });

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

  it("defaults honestly to in-process worker infrastructure and drains it on shutdown", async () => {
    const close = vi.fn(async () => undefined);
    toolWorkerMock.createToolWorker.mockReturnValueOnce({
      close,
      execute: vi.fn(),
    });
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });
    const containerWithWorker = container as typeof container & {
      toolWorker: () => unknown;
    };

    containerWithWorker.toolWorker();
    await container.shutdownRuntime();

    expect(toolWorkerMock.createToolWorker).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "inproc" }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("flushes durable stores even when one shutdown dependency rejects", async () => {
    toolWorkerMock.createToolWorker.mockReturnValueOnce({
      close: vi.fn(async () => {
        throw new Error("worker close failed");
      }),
      execute: vi.fn(),
    });
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });
    container.toolWorker();
    const runStore = container.agentRunStore();
    const flush = vi.spyOn(runStore, "flushShadowWrites");

    await expect(container.shutdownRuntime()).rejects.toThrow("worker close failed");
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("closes task admission before shutdown can be escaped by a late lookup", async () => {
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });
    const task = await container.scheduledTaskStore().create({
      name: "Late task",
      skillName: "",
      enabled: true,
      schedule: { kind: "daily", time: "12:33" },
      input: { request: "must not start after shutdown" },
    });
    let releaseLookup!: (value: typeof task) => void;
    vi.spyOn(container.scheduledTaskStore(), "get").mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseLookup = resolve;
      }),
    );

    const run = container.runAgentTask(task.id);
    await Promise.resolve();
    await expect(container.runAgentTask(task.id)).resolves.toEqual({
      ok: false,
      message: "这个任务已经在运行中。",
    });
    const shutdown = container.shutdownRuntime();
    releaseLookup(task);

    await expect(run).resolves.toEqual({
      ok: false,
      message: "应用正在退出，任务运行已取消。",
    });
    await expect(shutdown).resolves.toBeUndefined();
  });

  it("tracks resume admission before checkpoint lookup and drains it on shutdown", async () => {
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });
    const checkpoint: AgentExecutionCheckpoint = {
      id: "checkpoint_resume_shutdown",
      runId: "run_resume_shutdown",
      taskId: "task_resume_shutdown",
      status: "paused",
      currentStepId: "step_1",
      steps: [{
        id: "step_1",
        description: "Resume safely",
        expectedOutcome: "No late start",
        state: "pending",
        attempts: 1,
      }],
      messages: [],
      toolCallCount: 0,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    };
    let releaseLookup!: (value: AgentExecutionCheckpoint) => void;
    vi.spyOn(container.agentExecutionStore(), "get").mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseLookup = resolve;
      }),
    );

    const resume = container.resumeAgentRun(checkpoint.runId);
    await Promise.resolve();
    await expect(container.resumeAgentRun(checkpoint.runId)).resolves.toEqual({
      ok: false,
      message: "这个运行已经在恢复中。",
    });
    const shutdown = container.shutdownRuntime();
    releaseLookup(checkpoint);

    await expect(resume).resolves.toEqual({
      ok: false,
      message: "应用正在退出，任务恢复已取消。",
    });
    await expect(shutdown).resolves.toBeUndefined();
  });

  it("does not instantiate unavailable workflow-backed self improvement by default", () => {
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });

    expect(container.selfImprovementService()).toBeNull();
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

  it("classifies unverified completion as terminal while acceptance waiting stays active", () => {
    expect(isTerminalGoalStatus("completed_unverified")).toBe(true);
    expect(isTerminalGoalStatus("waiting_for_acceptance")).toBe(false);
  });

  it("does not auto-resume a persisted waiting acceptance on startup", async () => {
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });
    const waiting = createStoredGoal({
      id: "goal_waiting_startup",
      status: "waiting_for_acceptance",
      acceptanceProtocolVersion: 2,
      acceptanceState: {
        protocolVersion: 2,
        phase: "awaiting_user",
        attempt: 3,
        recentFailures: [],
      },
      acceptanceRetryState: {
        cycle: 1,
        attempt: 3,
        maxAttempts: 3,
        lastCode: "judge_timeout",
        lastDetail: "Final judge timed out.",
        evidenceFingerprint: "a".repeat(64),
        resumeFrom: "final_judge",
      },
    });
    await container.agentGoalStore().save(waiting);

    await expect(container.resumeInterruptedGoals()).resolves.toBe(0);
    await expect(container.agentGoalStore().get(waiting.id)).resolves.toMatchObject({
      status: "waiting_for_acceptance",
      acceptanceState: { phase: "awaiting_user" },
    });
  });

  it("formats unverified manual completion without claiming certification", () => {
    const heading = formatGoalTerminalHeading(
      createStoredGoal({
        id: "goal_completed_unverified",
        status: "completed_unverified",
        stopReason: "user_marked_complete",
      }),
    );

    expect(heading).toContain("手动完成");
    expect(heading).toContain("未经机器认证");
    expect(heading).not.toContain("目标已达成");
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

  it("allows ordinary git worktree creation when auto approval is enabled", async () => {
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

    const worktreePromise = container.requestGitWorktreeAgentWorkspace({
      name: "Auto-approved worktree",
      repositoryRoot,
      branch: "codex/auto-approved-worktree",
    });

    await expect(worktreePromise).resolves.toBeDefined();
    expect(
      coordinator.resolveApproval({
        id: "approval_auto_worktree",
        approved: true,
      }),
    ).toBe(false);
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
    ["achieved", "acceptance_repair_scheduled"],
    ["canceled", "replanned"],
    ["achieved", "checkpoint"],
    ["completed_unverified", "checkpoint"],
  ] as const)(
    "canonicalizes stale terminal %s/%s progress",
    (status, event) => {
      const stale: GoalProgressEvent = {
        kind: "goal_progress",
        goalId: "goal_stale_terminal",
        sessionId: "chat_stale_terminal",
        status: "executing",
        event,
        message: "Stale nonterminal progress.",
        timestamp: "2026-07-11T08:00:00.000Z",
      };

      expect(
        reconcileIrreversibleGoalProgressEvent(
          stale,
          createStoredGoal({
            id: stale.goalId,
            status,
            stopReason:
              status === "achieved"
                ? "goal_accepted"
                : status === "completed_unverified"
                  ? "user_marked_complete"
                  : "user_canceled",
          }),
        ),
      ).toMatchObject({
        status,
        event: "stopped",
        message:
          status === "achieved"
            ? "目标已达成。"
            : status === "completed_unverified"
              ? "目标已手动完成（未经机器认证）。"
              : "目标已取消。",
      });
    },
  );

  it.each([
    ["achieved", "acceptance_certified"],
    ["achieved", "stopped"],
    ["canceled", "stopped"],
    ["completed_unverified", "stopped"],
  ] as const)(
    "preserves current terminal %s/%s progress",
    (status, event) => {
      const current: GoalProgressEvent = {
        kind: "goal_progress",
        goalId: "goal_current_terminal",
        sessionId: "chat_current_terminal",
        status,
        event,
        message:
          event === "acceptance_certified"
            ? "目标已通过最终验收并生成证书。"
            : "目标已停止。",
        timestamp: "2026-07-11T08:00:00.000Z",
      };

      expect(
        reconcileIrreversibleGoalProgressEvent(
          current,
          createStoredGoal({
            id: current.goalId,
            status,
            stopReason:
              status === "achieved"
                ? "goal_accepted"
                : status === "completed_unverified"
                  ? "user_marked_complete"
                  : "user_canceled",
          }),
        ),
      ).toEqual(current);
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
    const deliveryValidator: AcceptanceValidator = {
      kind: "validator:certified_delivery",
      async evaluate({ check }) {
        return {
          checkId: check.id,
          kind: check.kind,
          passed: true,
          code: "delivery_accepted",
          evidenceRefs: [],
          detail: "Delivery fixture accepted without external evidence.",
        };
      },
    };
    const container = createAppContainer({
      acceptanceValidators: [deliveryValidator],
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
      acceptanceProtocolVersion: 2,
      acceptanceState: {
        protocolVersion: 2,
        phase: "idle",
        attempt: 0,
        recentFailures: [],
      },
      successCriteria: [
        {
          id: "criterion_goal_progress",
          description: "所有里程碑都已完成",
          acceptanceChecks: [
            {
              id: "check_goal_progress",
              kind: "validator:certified_delivery",
              description: "Goal progress is accepted by the delivery fixture.",
              params: {},
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

    const achievedProgress: GoalProgressEvent[] = [];
    const certifiedSessionChecks: Array<Promise<Goal["status"] | undefined>> = [];
    const progress = new Promise<GoalProgressEvent>((resolve) => {
      const unsubscribe = container.onGoalProgressEvent((event) => {
        if (event.goalId === goal.id && event.status === "achieved") {
          achievedProgress.push(event);
          if (event.event === "acceptance_certified") {
            certifiedSessionChecks.push(
              container.chatSessionStore().get(session.session.id).then(
                (record) =>
                  record?.goalSummaries?.find((summary) => summary.id === goal.id)
                    ?.status,
              ),
            );
          }
          if (event.event === "stopped") {
            unsubscribe();
            resolve(event);
          }
        } else if (event.goalId === goal.id && event.event === "stopped") {
          unsubscribe();
          resolve(event);
        }
      });
    });

    const result = await container.goalChatService().resolveReview(goal.id, {
      kind: "approve_continue",
    });
    expect(result.status).toBe("executing");
    const terminalProgress = await progress;

    expect(terminalProgress).toMatchObject({
      status: "achieved",
      message: "Goal acceptance passed.",
    });
    expect(achievedProgress.map((event) => event.event)).toEqual([
      "acceptance_certified",
      "stopped",
    ]);
    expect(certifiedSessionChecks).toHaveLength(1);
    await expect(Promise.all(certifiedSessionChecks)).resolves.toEqual([
      "achieved",
    ]);

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

  it("serializes non-preempting mutations for the same goal", async () => {
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });
    const goal = createStoredGoal({
      id: "goal_serial_mutations",
      status: "waiting_for_review",
    });
    await container.agentGoalStore().save(goal);
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const toSummary = () => ({
      id: goal.id,
      description: goal.description,
      status: goal.status,
    });

    const first = container.runGoalOperation(goal.id, async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
      return toSummary();
    });
    const second = container.runGoalOperation(goal.id, async () => {
      events.push("second:start");
      return toSummary();
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { ok: true },
      { ok: true },
    ]);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("makes a preempting cancellation invalidate old queued work and barrier new work", async () => {
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });
    const goal = createStoredGoal({
      id: "goal_preempt_barrier",
      status: "waiting_for_review",
    });
    await container.agentGoalStore().save(goal);
    const events: string[] = [];
    let releaseFirst!: () => void;
    let releaseCancel!: () => void;
    let signalFirstStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const cancelGate = new Promise<void>((resolve) => { releaseCancel = resolve; });
    const firstStarted = new Promise<void>((resolve) => { signalFirstStarted = resolve; });
    const toSummary = () => ({
      id: goal.id,
      description: goal.description,
      status: goal.status,
    });

    const first = container.runGoalOperation(goal.id, async () => {
      events.push("first:start");
      signalFirstStarted();
      await firstGate;
      events.push("first:end");
      return toSummary();
    });
    await firstStarted;
    const staleQueued = container.runGoalOperation(goal.id, async () => {
      events.push("stale:start");
      return toSummary();
    });
    const cancel = container.runGoalOperation(
      goal.id,
      async () => {
        events.push("cancel:start");
        await cancelGate;
        events.push("cancel:end");
        return toSummary();
      },
      { preempt: true },
    );
    const afterCancel = container.runGoalOperation(goal.id, async () => {
      events.push("after-cancel:start");
      return toSummary();
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["first:start", "cancel:start"]);
    releaseFirst();
    await expect(first).resolves.toMatchObject({ ok: true });
    await expect(staleQueued).resolves.toMatchObject({ ok: false });
    expect(events).not.toContain("stale:start");
    expect(events).not.toContain("after-cancel:start");
    releaseCancel();
    await expect(cancel).resolves.toMatchObject({ ok: true });
    await expect(afterCancel).resolves.toMatchObject({ ok: true });
    expect(events).toEqual([
      "first:start",
      "cancel:start",
      "first:end",
      "cancel:end",
      "after-cancel:start",
    ]);
  });

  it("cancels a final-acceptance continuation started through the container wrapper", async () => {
    let deterministicCalls = 0;
    const validator: AcceptanceValidator = {
      kind: "validator:continuation_cancel_probe",
      async evaluate({ check }) {
        deterministicCalls += 1;
        return {
          checkId: check.id,
          kind: check.kind,
          passed: true,
          code: "accepted",
          evidenceRefs: [],
          detail: "Deterministic probe accepted once.",
        };
      },
    };
    const container = createAppContainer({
      acceptanceValidators: [validator],
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });
    const deterministicCheck = {
      id: "check_cancel_probe",
      kind: validator.kind,
      description: "Build deterministic sealed evidence once.",
      params: {},
      requiresEvidence: false,
    } as const;
    const modelReviewCheck = {
      id: "check_cancel_final_judge",
      kind: "model_review",
      description: "Final judge reviews the sealed evidence.",
      params: {
        condition: "Confirm the sealed cancellation probe evidence.",
        evidenceRefs: ["evidence:sealed-cancel-probe"],
      },
      requiresEvidence: true,
    } as const;
    const goal = createStoredGoal({
      id: "goal_continue_cancel",
      chatSessionId: "chat_continue_cancel",
      status: "waiting_for_acceptance",
      acceptanceProtocolVersion: 2,
      acceptanceState: {
        protocolVersion: 2,
        phase: "awaiting_user",
        attempt: 3,
        recentFailures: [],
      },
      acceptanceRetryState: {
        cycle: 1,
        attempt: 3,
        maxAttempts: 3,
        lastCode: "judge_timeout",
        lastDetail: "Final judge timed out.",
        evidenceFingerprint: "a".repeat(64),
        resumeFrom: "final_judge",
      },
      successCriteria: [
        {
          id: "criterion_cancel_probe",
          description: "Cancellation probe completes.",
          acceptanceChecks: [deterministicCheck, modelReviewCheck],
        },
      ],
      milestones: [
        {
          id: "milestone_done",
          description: "Work already completed.",
          dependsOn: [],
          successCriteria: [],
          state: "accepted",
          runIds: ["run_done"],
          attempts: 1,
        },
      ],
    });
    const initialContext: AcceptanceContext = {
      runId: "run_initial_final_judge",
      goalId: goal.id,
      workspacePath: tempDir,
      toolExecutor: {
        async execute() {
          throw new Error("sealed replay fixture must not execute tools");
        },
      },
      trajectoryStore: {
        async append(_runId, event) {
          return event;
        },
      },
      chatClient: {
        async complete() {
          throw Object.assign(new Error("initial judge unavailable"), {
            status: 503,
          });
        },
      },
      modelProfile: {
        baseUrl: "https://judge.test/v1",
        apiKey: "fixture-secret",
        model: "sealed-judge",
        temperature: 0,
        maxTokens: 1024,
      },
      now: () => "2026-07-12T00:00:00.000Z",
    };
    const initial = await container.agentGoalAcceptance().evaluateGoal(
      goal,
      initialContext,
    );
    const sealedReplay = initial.finalJudgeReplay;
    expect(sealedReplay).toBeDefined();
    if (!sealedReplay) {
      throw new Error("sealed replay fixture was not created");
    }
    goal.acceptanceRetryState = {
      ...goal.acceptanceRetryState!,
      finalJudgeReplay: sealedReplay,
    };
    await container.modelSettingsStore.save({
      baseUrl: "https://judge.test/v1",
      chatModel: "sealed-judge",
      embeddingModel: "",
      apiKey: "fixture-secret",
      temperature: 0,
      maxTokens: 1024,
      thinkingEnabled: false,
      thinkingBudgetTokens: 1024,
    });
    await container.agentGoalStore().save(goal);

    let judgeSignal: AbortSignal | undefined;
    let judgeEnteredResolve: (() => void) | undefined;
    const judgeEntered = new Promise<void>((resolve) => {
      judgeEnteredResolve = resolve;
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_input, init) => {
        judgeSignal = init?.signal ?? undefined;
        judgeEnteredResolve?.();
        return new Promise<Response>((_resolve, reject) => {
          judgeSignal?.addEventListener(
            "abort",
            () =>
              reject(
                judgeSignal?.reason ??
                  new DOMException("Aborted", "AbortError"),
              ),
            { once: true },
          );
        });
      },
    );
    const { canceling, continued } = await (async () => {
      try {
        const continuing = container.continueGoalAcceptance(goal.id);
        await judgeEntered;
        const canceling = await container.runGoalOperation(
          goal.id,
          () => container.goalChatService().cancel(goal.id),
          { preempt: true },
        );
        return { canceling, continued: await continuing };
      } finally {
        fetchSpy.mockRestore();
      }
    })();

    expect(deterministicCalls).toBe(1);
    expect(judgeSignal?.aborted).toBe(true);
    expect(canceling).toMatchObject({ ok: true, goal: { status: "canceled" } });
    expect(continued).toMatchObject({ ok: true, goal: { status: "canceled" } });
    expect((await container.agentGoalStore().get(goal.id))?.status).toBe(
      "canceled",
    );
  });

  it("confirms a ready plan exactly once and links repeated confirmations to the same Goal", async () => {
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });
    const workspaceRoot = path.join(tempDir, "plan-workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const session = await container.chatSessionStore().appendMessage({
      role: "user",
      content: "Implement the confirmed plan",
    });
    const artifact: PlanArtifact = {
      title: "Confirmed Plan",
      summary: "A deterministic confirmation fixture.",
      objective: "Implement one local milestone.",
      scope: { in: ["local work"], out: ["external publish"] },
      assumptions: [],
      milestones: [
        {
          id: "milestone_confirm",
          title: "Implement",
          description: "Implement the local change.",
          acceptanceCriteria: ["Reviewed evidence exists."],
          dependencies: [],
        },
        {
          id: "milestone_validate",
          title: "Validate",
          description: "Validate the local change.",
          acceptanceCriteria: ["Validation evidence exists."],
          dependencies: ["Implement", "external approval label"],
        },
      ],
      dependencies: [],
      risks: [],
      acceptanceCriteria: ["Reviewed evidence exists."],
      claimLedger: [],
      unresolvedQuestions: [],
      minorityOpinion: [],
      actionGate: "ready",
      gateReason: "Ready for explicit confirmation.",
      markdown: "",
    };
    const basePlan: PlanRecord = {
      id: "plan_confirm_once",
      sessionId: session.session.id,
      workspaceRoot,
      sourceMessage: "Implement one local milestone.",
      mode: "direct",
      status: "awaiting_confirmation",
      actionGate: "ready",
      revision: 1,
      taskContract: {
        objective: artifact.objective,
        audience: "user",
        inScope: artifact.scope.in,
        outOfScope: artifact.scope.out,
        constraints: [],
        successCriteria: artifact.acceptanceCriteria,
        assumptions: [],
      },
      evidence: [],
      requestedModelAssignments: {},
      frozenModelAssignments: {},
      rounds: [],
      finalArtifact: artifact,
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z",
    };
    const projection = await container
      .planArtifactWriter()
      .write(basePlan, artifact);
    await container.planStore().create({ ...basePlan, projection });

    const [first, concurrent] = await Promise.all([
      container.confirmPlan({
        planId: basePlan.id,
        expectedRevision: 1,
      }),
      container.confirmPlan({
        planId: basePlan.id,
        expectedRevision: 1,
      }),
    ]);
    expect(first.ok).toBe(true);
    expect(concurrent.ok).toBe(true);
    if (!first.ok || !concurrent.ok) return;
    expect(concurrent.activeGoal.id).toBe(first.activeGoal.id);
    const repeated = await container.confirmPlan({
      planId: basePlan.id,
      expectedRevision: 1,
    });
    expect(repeated.ok).toBe(true);
    if (!repeated.ok) return;
    expect(repeated.activeGoal.id).toBe(first.activeGoal.id);
    expect(repeated.plan.executionGoalId).toBe(first.activeGoal.id);
    expect(repeated.plan.status).toBe("executing");
    expect(
      (
        await container.chatSessionStore().get(basePlan.sessionId)
      )?.messages.filter(
        (message) => message.goalEventRef === `plan-confirmed:${basePlan.id}`,
      ),
    ).toHaveLength(1);
    const linkedBeforeRecovery = await container.planStore().get(basePlan.id);
    const pendingRecoveryPlan = await container.planStore().save(
      {
        ...linkedBeforeRecovery!,
        status: "confirmed_pending_execution",
      },
      linkedBeforeRecovery!.revision,
      "test_crash_after_goal_link",
    );
    const recovered = await container.confirmPlan({
      planId: basePlan.id,
      expectedRevision: pendingRecoveryPlan.revision,
    });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.plan.executionGoalId).toBe(first.activeGoal.id);
    expect(recovered.activeGoal.id).toBe(first.activeGoal.id);
    const expectedRecoveredPlanStatus =
      recovered.activeGoal.status === "achieved" ||
      recovered.activeGoal.status === "completed_unverified"
        ? "completed"
        : recovered.activeGoal.status === "canceled"
          ? "canceled"
          : recovered.activeGoal.status === "failed" ||
              recovered.activeGoal.status === "stopped_budget" ||
              recovered.activeGoal.status === "stopped_stalled" ||
              recovered.activeGoal.status === "stopped_blocked"
            ? "failed"
            : "executing";
    expect(recovered.plan.status).toBe(expectedRecoveredPlanStatus);
    const linkedPlan = await container.planStore().get(basePlan.id);
    expect(linkedPlan).not.toBeNull();
    const failedPlan = await container.planStore().save(
      {
        ...linkedPlan!,
        status: "failed",
        actionGate: "blocked",
        executionRunId: "run_failed_after_confirmation",
      },
      linkedPlan!.revision,
      "test_plan_execution_failed",
    );
    const repeatedAfterFailure = await container.confirmPlan({
      planId: basePlan.id,
      expectedRevision: 1,
    });
    expect(repeatedAfterFailure.ok).toBe(true);
    if (!repeatedAfterFailure.ok) return;
    expect(repeatedAfterFailure.activeGoal.id).toBe(first.activeGoal.id);
    expect(repeatedAfterFailure.plan.revision).toBe(failedPlan.revision);
    expect(repeatedAfterFailure.plan.status).toBe("failed");
    const confirmedGoal = await container.agentGoalStore().get(
      first.activeGoal.id,
    );
    expect(confirmedGoal).toMatchObject({
      sourcePlanRef: expect.objectContaining({
        planId: basePlan.id,
        sha256: projection.sha256,
      }),
    });
    expect(
      confirmedGoal?.milestones.find(
        (milestone) => milestone.id === "milestone_validate",
      )?.dependsOn,
    ).toEqual(["milestone_confirm"]);
    await container.runGoalOperation(
      first.activeGoal.id,
      () => container.goalChatService().cancel(first.activeGoal.id),
      { preempt: true },
    );
    await container.shutdownRuntime();
  });

  it("refuses non-ready and drifted plan projections before creating a Goal", async () => {
    const container = createAppContainer({
      async requestToolApproval() {
        return { approved: false, reason: "test" };
      },
    });
    const workspaceRoot = path.join(tempDir, "drift-workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const session = await container.chatSessionStore().appendMessage({
      role: "user",
      content: "Do not execute drifted plan",
    });
    const artifact = {
      title: "Drift Plan",
      summary: "summary",
      objective: "objective",
      scope: { in: [], out: [] },
      assumptions: [],
      milestones: [
        {
          id: "m1",
          title: "M1",
          description: "work",
          acceptanceCriteria: ["done"],
          dependencies: [],
        },
      ],
      dependencies: [],
      risks: [],
      acceptanceCriteria: ["done"],
      claimLedger: [],
      unresolvedQuestions: [],
      minorityOpinion: [],
      actionGate: "ready" as const,
      gateReason: "ready",
      markdown: "",
    };
    const plan: PlanRecord = {
      id: "plan_drifted",
      sessionId: session.session.id,
      workspaceRoot,
      sourceMessage: "objective",
      mode: "direct",
      status: "awaiting_confirmation",
      actionGate: "ready",
      revision: 1,
      taskContract: {
        objective: "objective",
        audience: "user",
        inScope: [],
        outOfScope: [],
        constraints: [],
        successCriteria: ["done"],
        assumptions: [],
      },
      evidence: [],
      requestedModelAssignments: {},
      frozenModelAssignments: {},
      rounds: [],
      finalArtifact: artifact,
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z",
    };
    const projection = await container
      .planArtifactWriter()
      .write(plan, artifact);
    await writeFile(projection.path, "# user changed the plan\n");
    await container.planStore().create({ ...plan, projection });

    await expect(
      container.confirmPlan({
        planId: plan.id,
        expectedRevision: plan.revision,
      }),
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("投影已变化"),
    });
    expect(
      (await container.planStore().get(plan.id))?.executionGoalId,
    ).toBeUndefined();
    await container.shutdownRuntime();
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
    ...(overrides.acceptanceProtocolVersion
      ? { acceptanceProtocolVersion: overrides.acceptanceProtocolVersion }
      : {}),
    ...(overrides.acceptanceState
      ? { acceptanceState: overrides.acceptanceState }
      : {}),
    ...(overrides.acceptanceRetryState
      ? { acceptanceRetryState: overrides.acceptanceRetryState }
      : {}),
    ...(overrides.manualCompletionAttestation
      ? { manualCompletionAttestation: overrides.manualCompletionAttestation }
      : {}),
    ...(overrides.acceptanceCertificate
      ? { acceptanceCertificate: overrides.acceptanceCertificate }
      : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
