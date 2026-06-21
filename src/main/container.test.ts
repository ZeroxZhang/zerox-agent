import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppContainer } from "./container";
import { registerAllIpcHandlers } from "./ipc";
import type { Goal } from "../shared/agentGoal";
import type { GoalProgressEvent } from "../shared/chat";

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

describe("app container goal drafts", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "zerox-container-"));
    electronState.userDataPath = tempDir;
    electronState.appPath = process.cwd();
    electronState.ipcHandlers.clear();
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
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

  it("requires matching scope or explicit capability for scoped tool-result ref reads over container and IPC", async () => {
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
    expect(listedSession?.activeGoal).toMatchObject({
      id: goal.id,
      status: "canceled",
    });
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
    expect(result.status).toBe("achieved");
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
    expect(listedSession?.activeGoal).toMatchObject({
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
    expect(persistedSession?.activeGoal).toMatchObject({
      id: goal.id,
      status: "achieved",
    });
  });
});

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
