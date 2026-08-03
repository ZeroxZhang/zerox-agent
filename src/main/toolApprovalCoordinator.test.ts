import { afterEach, describe, expect, it, vi } from "vitest";
import { createToolApprovalCoordinator } from "./toolApprovalCoordinator";
import type { ToolUserApprovalRequest } from "./toolAuthorizationService";

describe("tool approval coordinator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("routes approval requests to the renderer instead of a native global dialog", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const coordinator = createToolApprovalCoordinator({
      createId: () => "approval_1",
      now: () => "2026-06-14T12:00:00.000Z",
      sendToRenderers(channel, payload) {
        sent.push({ channel, payload });
      },
    });

    const approval = coordinator.requestUserApproval(createRequest());

    expect(sent).toEqual([
      {
        channel: "toolApproval:request",
        payload: expect.objectContaining({
          id: "approval_1",
          taskName: "Goal milestone",
          deniedReason: "web_fetch URL 域名不在允许列表内。",
          risk: {
            level: "normal",
            reason:
              "The operation is not in the Policy B forced-confirmation class.",
            category: "none",
            requiresConfirmation: false,
            affectedTargets: [],
          },
          argsSummary: {
            url: "https://example.com/source",
          },
        }),
      },
    ]);

    expect(
      coordinator.resolveApproval({
        id: "approval_1",
        approved: true,
      }),
    ).toBe(true);
    await expect(approval).resolves.toEqual({
      approved: true,
      reason: "用户已在应用内授权本次 web_fetch。",
    });
  });

  it.each([
    ["file_write", { path: "/tmp/report.txt", content: "done" }],
    ["shell_exec", { command: "npm test" }],
    ["web_fetch", { url: "https://example.com/source" }],
  ])("auto-approves ordinary %s requests", async (toolName, args) => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const coordinator = createToolApprovalCoordinator({
      createId: () => `approval_${toolName}`,
      now: () => "2026-06-14T12:00:00.000Z",
      sendToRenderers(channel, payload) {
        sent.push({ channel, payload });
      },
    });

    coordinator.setAutoApprovalEnabled(true);
    await expect(
      coordinator.requestUserApproval({
        ...createRequest(),
        request: { toolName, args },
      }),
    ).resolves.toEqual({
      approved: true,
      reason: `自动授权已放行本次 ${toolName}。`,
      automatic: true,
    });
    expect(sent).not.toContainEqual(
      expect.objectContaining({ channel: "toolApproval:request" }),
    );
  });

  it("approves a pending ordinary write when auto approval is enabled", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const coordinator = createToolApprovalCoordinator({
      createId: () => "approval_waiting",
      now: () => "2026-06-14T12:00:00.000Z",
      sendToRenderers(channel, payload) {
        sent.push({ channel, payload });
      },
    });

    const approval = coordinator.requestUserApproval({
      ...createRequest(),
      request: {
        toolName: "file_write",
        args: { path: "/tmp/report.md", content: "done" },
      },
    });

    expect(sent).toContainEqual({
      channel: "toolApproval:request",
      payload: expect.objectContaining({ id: "approval_waiting" }),
    });

    coordinator.setAutoApprovalEnabled(true);

    await expect(approval).resolves.toEqual({
      approved: true,
      reason: "自动授权已放行本次 file_write。",
      automatic: true,
    });
    expect(sent).toContainEqual({
      channel: "toolApproval:decision",
      payload: expect.objectContaining({
        id: "approval_waiting",
        approved: true,
        automatic: true,
      }),
    });
  });

  it("keeps a Policy B forced ask pending while auto approval is enabled", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const coordinator = createToolApprovalCoordinator({
      createId: () => "approval_publish",
      sendToRenderers(channel, payload) {
        sent.push({ channel, payload });
      },
    });
    coordinator.setAutoApprovalEnabled(true);

    const approval = coordinator.requestUserApproval({
      ...createRequest(),
      request: { toolName: "shell_exec", args: { command: "npm publish" } },
    });

    expect(sent).toContainEqual({
      channel: "toolApproval:request",
      payload: expect.objectContaining({
        id: "approval_publish",
        risk: expect.objectContaining({
          requiresConfirmation: true,
          category: "irreversible_external_action",
        }),
      }),
    });
    coordinator.resolveApproval({ id: "approval_publish", approved: false });
    await expect(approval).resolves.toMatchObject({ approved: false });
  });

  it("settles and removes a pending approval when the run is aborted", async () => {
    const controller = new AbortController();
    const coordinator = createToolApprovalCoordinator({
      createId: () => "approval_abort",
      sendToRenderers() {},
    });
    const approval = coordinator.requestUserApproval(createRequest(), {
      signal: controller.signal,
    });

    controller.abort();

    await expect(approval).resolves.toEqual({
      approved: false,
      reason: "运行已取消，授权请求已关闭。",
      automatic: true,
    });
    expect(
      coordinator.resolveApproval({ id: "approval_abort", approved: true }),
    ).toBe(false);
  });

  it("rejects and drains every pending approval during shutdown", async () => {
    let next = 0;
    const coordinator = createToolApprovalCoordinator({
      createId: () => `approval_shutdown_${++next}`,
      sendToRenderers() {},
    });
    const first = coordinator.requestUserApproval(createRequest());
    const second = coordinator.requestUserApproval(createRequest());

    expect(coordinator.rejectAllPending()).toBe(2);
    await expect(first).resolves.toMatchObject({
      approved: false,
      automatic: true,
      reason: "应用正在退出，授权请求已关闭。",
    });
    await expect(second).resolves.toMatchObject({ approved: false });
    expect(coordinator.rejectAllPending()).toBe(0);
  });

  it("times out a forced ask after the configured bounded wait", async () => {
    vi.useFakeTimers();
    const coordinator = createToolApprovalCoordinator({
      approvalTimeoutMs: 60_000,
      createId: () => "approval_timeout",
      sendToRenderers() {},
    });
    coordinator.setAutoApprovalEnabled(true);
    const approval = coordinator.requestUserApproval({
      ...createRequest(),
      request: { toolName: "shell_exec", args: { command: "npm publish" } },
    });

    await vi.advanceTimersByTimeAsync(60_000);

    await expect(approval).resolves.toEqual({
      approved: false,
      reason: "授权等待已超过 60 秒，已拒绝本次 shell_exec；请改用安全替代方案。",
      automatic: true,
    });
  });

  it("forces and locks auto approval while goal mode is enabled", () => {
    const coordinator = createToolApprovalCoordinator({
      sendToRenderers() {},
    });

    coordinator.setGoalModeEnabled(true);
    expect(coordinator.getAutoApprovalState()).toEqual({
      autoApprovalEnabled: true,
      goalModeEnabled: true,
      autoApprovalLocked: true,
    });

    coordinator.setAutoApprovalEnabled(false);
    expect(coordinator.getAutoApprovalState()).toEqual({
      autoApprovalEnabled: true,
      goalModeEnabled: true,
      autoApprovalLocked: true,
    });

    coordinator.setGoalModeEnabled(false);
    expect(coordinator.getAutoApprovalState()).toEqual({
      autoApprovalEnabled: false,
      goalModeEnabled: false,
      autoApprovalLocked: false,
    });
  });

  it.each([
    {
      standalone: false,
      goalPreference: true,
      activeGoal: false,
      label: "Goal mode selection",
    },
    {
      standalone: false,
      goalPreference: false,
      activeGoal: true,
      label: "active Goal recovery",
    },
    {
      standalone: true,
      goalPreference: true,
      activeGoal: true,
      label: "combined autonomy sources",
    },
  ])("keeps Goal autonomy indivisible for $label", ({ standalone, goalPreference, activeGoal }) => {
    const coordinator = createToolApprovalCoordinator({
      sendToRenderers() {},
    });

    coordinator.setAutoApprovalEnabled(standalone);
    coordinator.setGoalModeEnabled(goalPreference);
    if (activeGoal) coordinator.setGoalActive("goal_matrix", true);

    expect(coordinator.getAutoApprovalState()).toMatchObject({
      autoApprovalEnabled: true,
      goalModeEnabled: true,
      autoApprovalLocked: true,
    });
  });

  it("keeps auto approval locked while a goal is actively running", () => {
    const coordinator = createToolApprovalCoordinator({
      sendToRenderers() {},
    });

    coordinator.setGoalActive("goal_1", true);
    coordinator.setGoalModeEnabled(false);
    coordinator.setAutoApprovalEnabled(false);

    expect(coordinator.getAutoApprovalState()).toEqual({
      autoApprovalEnabled: true,
      goalModeEnabled: true,
      autoApprovalLocked: true,
    });

    coordinator.setGoalActive("goal_1", false);
    expect(coordinator.getAutoApprovalState()).toEqual({
      autoApprovalEnabled: false,
      goalModeEnabled: false,
      autoApprovalLocked: false,
    });
  });

  it("does not leak an active goal's auto approval into a chat request", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const coordinator = createToolApprovalCoordinator({
      createId: () => "approval_chat",
      sendToRenderers(channel, payload) {
        sent.push({ channel, payload });
      },
    });
    coordinator.setGoalActive("goal_1", true);

    const approval = coordinator.requestUserApproval({
      ...createRequest(),
      taskId: "chat_session_1_request_1",
      taskName: "Chat task",
    });

    expect(sent).toContainEqual({
      channel: "toolApproval:request",
      payload: expect.objectContaining({ id: "approval_chat" }),
    });
    expect(coordinator.resolveApproval({ id: "approval_chat", approved: false })).toBe(true);
    await expect(approval).resolves.toMatchObject({ approved: false });
  });
});

function createRequest(): ToolUserApprovalRequest {
  return {
    taskId: "goal:goal_1",
    taskName: "Goal milestone",
    deniedReason: "web_fetch URL 域名不在允许列表内。",
    request: {
      toolName: "web_fetch",
      args: { url: "https://example.com/source" },
    },
  };
}
