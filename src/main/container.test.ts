import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppContainer } from "./container";
import type { Goal } from "../shared/agentGoal";
import type { GoalProgressEvent } from "../shared/chat";

const electronState = vi.hoisted(() => ({
  userDataPath: "",
  appPath: "",
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
  overrides: Pick<Goal, "id" | "chatSessionId" | "status">,
): Goal {
  const timestamp = "2026-06-14T15:00:00.000Z";

  return {
    id: overrides.id,
    chatSessionId: overrides.chatSessionId,
    description: "回复 smoke 短句",
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
    milestones: [
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
    budget: {
      maxIterations: 2,
      maxToolCalls: 4,
      maxWallClockMs: 60_000,
      maxReplans: 1,
    },
    budgetUsage: {
      iterations: 0,
      toolCalls: 0,
      wallClockMs: 0,
      tokens: 0,
      replans: 0,
    },
    reviewPolicy: "review_final_only",
    planVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
