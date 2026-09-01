import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONVERSATION_CAUSAL_SCHEMA_VERSION,
  type ToolApprovalIntent,
} from "../shared/conversationCausalSpine";
import { createConversationCausalStore } from "./conversationCausalStore";
import { createToolApprovalCoordinator } from "./toolApprovalCoordinator";
import type { ToolUserApprovalRequest } from "./toolAuthorizationService";

describe("tool approval coordinator", () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(tempDirs.splice(0).map((dir) =>
      rm(dir, { recursive: true, force: true }),
    ));
  });

  function persistenceOptions() {
    const configDir = path.join(os.tmpdir(), `zerox-approval-${randomUUID()}`);
    tempDirs.push(configDir);
    return {
      store: createConversationCausalStore({ configDir }),
      processEpoch: "process:test",
    };
  }

  it("routes approval requests to the renderer instead of a native global dialog", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const coordinator = createToolApprovalCoordinator({
      ...persistenceOptions(),
      createId: () => "approval_1",
      now: () => "2026-06-14T12:00:00.000Z",
      sendToRenderers(channel, payload) {
        sent.push({ channel, payload });
      },
    });

    const approval = coordinator.requestUserApproval(createRequest());

    await vi.waitFor(() => expect(sent).toEqual([
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
    ]));

    await expect(
      coordinator.resolveApproval({
        id: "approval_1",
        approved: true,
      }),
    ).resolves.toBe(true);
    await expect(approval).resolves.toMatchObject({
      approved: true,
      reason: "用户已在应用内授权本次 web_fetch。",
    });
  });

  it("keeps exact tool arguments private to main across renderer IPC", async () => {
    const sentinel = "TOOL_IPC_SECRET_74ab";
    const sent: unknown[] = [];
    const options = persistenceOptions();
    const coordinator = createToolApprovalCoordinator({
      ...options,
      createId: () => "approval_private_args",
      sendToRenderers(_channel, payload) {
        sent.push(payload);
      },
    });
    const approval = coordinator.requestUserApproval({
      ...createRequest(),
      request: {
        toolName: "web_fetch",
        args: {
          url: "https://example.com/source",
          headers: { authorization: sentinel },
        },
      },
    });
    await vi.waitFor(() => expect(coordinator.pendingSnapshot()).toHaveLength(1));
    const durable = await options.store.getApprovalIntent("approval_private_args");
    expect(JSON.stringify({
      sent,
      pending: coordinator.pendingSnapshot(),
      durable,
    })).not.toContain(sentinel);
    expect(coordinator.pendingSnapshot()[0]?.request).toEqual({
      toolName: "web_fetch",
    });
    await coordinator.resolveApproval({ id: "approval_private_args", approved: false });
    await approval;
  });

  it("persists the approval intent before publishing it to the renderer", async () => {
    const lifecycle: string[] = [];
    const coordinator = createToolApprovalCoordinator({
      ...persistenceOptions(),
      createId: () => "approval_ordered",
      sendToRenderers(channel) {
        if (channel === "toolApproval:request") lifecycle.push("published");
      },
    });

    const approval = coordinator.requestUserApproval(createRequest(), {
      async onIntentPersisted(intent) {
        expect(intent).toEqual({ id: "approval_ordered", revision: 1 });
        lifecycle.push("intent_persisted");
      },
    });

    await vi.waitFor(() => expect(lifecycle).toEqual([
      "intent_persisted",
      "published",
    ]));
    await coordinator.resolveApproval({ id: "approval_ordered", approved: false });
    await expect(approval).resolves.toMatchObject({ approved: false });
  });

  it("republishes one live-process pending prompt with the same durable id", async () => {
    const sent: string[] = [];
    const coordinator = createToolApprovalCoordinator({
      ...persistenceOptions(),
      createId: () => "approval_reload",
      sendToRenderers(channel, payload) {
        if (channel === "toolApproval:request") {
          sent.push((payload as { id: string }).id);
        }
      },
    });

    const approval = coordinator.requestUserApproval(createRequest());
    await vi.waitFor(() => expect(sent).toEqual(["approval_reload"]));
    expect(coordinator.republishPending()).toBe(1);
    expect(sent).toEqual(["approval_reload", "approval_reload"]);
    await coordinator.resolveApproval({ id: "approval_reload", approved: false });
    await expect(approval).resolves.toMatchObject({ approved: false });
  });

  it("returns a cloned pending snapshot for subscribe-first renderer recovery", async () => {
    const coordinator = createToolApprovalCoordinator({
      ...persistenceOptions(),
      createId: () => "approval_snapshot",
      sendToRenderers() {},
    });
    const approval = coordinator.requestUserApproval(createRequest());
    await vi.waitFor(() => expect(coordinator.pendingSnapshot()).toHaveLength(1));
    const snapshot = coordinator.pendingSnapshot();
    snapshot[0]!.taskName = "mutated renderer copy";
    expect(coordinator.pendingSnapshot()[0]?.taskName).toBe("Goal milestone");
    await coordinator.resolveApproval({ id: "approval_snapshot", approved: false });
    await approval;
  });

  it("interrupts prior-process intents during cold-start initialization", async () => {
    const options = persistenceOptions();
    await options.store.createApprovalIntent(createPersistedIntent(
      "approval_stale",
      "process:old",
    ));
    const sent: unknown[] = [];
    const coordinator = createToolApprovalCoordinator({
      ...options,
      processEpoch: "process:new",
      sendToRenderers(_channel, payload) {
        sent.push(payload);
      },
    });

    await expect(coordinator.initialize()).resolves.toBe(1);
    await expect(options.store.getApprovalIntent("approval_stale")).resolves
      .toMatchObject({ state: "interrupted", revision: 2 });
    expect(coordinator.republishPending()).toBe(0);
    expect(sent).toEqual([]);
  });

  it("fails closed without publishing when approval intent persistence fails", async () => {
    const options = persistenceOptions();
    const coordinator = createToolApprovalCoordinator({
      ...options,
      store: {
        ...options.store,
        async createApprovalIntent() {
          throw new Error("disk unavailable");
        },
      },
      createId: () => "approval_unpersisted",
      sendToRenderers: vi.fn(),
    });

    await expect(coordinator.requestUserApproval(createRequest())).resolves.toMatchObject({
      approved: false,
      automatic: true,
      approvalId: "approval_unpersisted",
    });
    expect(coordinator.republishPending()).toBe(0);
  });

  it("uses one atomic causal write and leaves no orphan when linked approval creation fails", async () => {
    const options = persistenceOptions();
    const requestId = "request_atomic_approval";
    await options.store.claimRequest({
      requestId,
      turnId: `turn-${requestId}`,
      inputFingerprint: "f".repeat(64),
    });
    const legacyCreate = vi.fn(options.store.createApprovalIntent);
    const sendToRenderers = vi.fn();
    const coordinator = createToolApprovalCoordinator({
      ...options,
      store: {
        ...options.store,
        createApprovalIntent: legacyCreate,
        async createApprovalIntentAndLink() {
          throw new Error("atomic approval transaction unavailable");
        },
      },
      createId: () => "approval_atomic_failure",
      sendToRenderers,
    });

    await expect(coordinator.requestUserApproval({
      ...createRequest(),
      causalRef: {
        requestId,
        turnId: `turn-${requestId}`,
        attempt: 1,
      },
    })).resolves.toMatchObject({
      approved: false,
      automatic: true,
      approvalId: "approval_atomic_failure",
    });

    expect(legacyCreate).not.toHaveBeenCalled();
    expect(sendToRenderers).not.toHaveBeenCalledWith(
      "toolApproval:request",
      expect.anything(),
    );
    await expect(options.store.getApprovalIntent("approval_atomic_failure"))
      .resolves.toBeNull();
    await expect(options.store.getRequest(requestId)).resolves.toMatchObject({
      refs: [],
    });
  });

  it("resolves the waiter fail-closed when the approval decision result is unavailable", async () => {
    const options = persistenceOptions();
    let failNextDecision = true;
    const coordinator = createToolApprovalCoordinator({
      ...options,
      store: {
        ...options.store,
        async decideApproval(input) {
          if (failNextDecision) {
            failNextDecision = false;
            throw new Error("disk unavailable");
          }
          return options.store.decideApproval(input);
        },
      },
      createId: () => "approval_decision_failure",
      sendToRenderers() {},
    });

    const approval = coordinator.requestUserApproval(createRequest());
    await vi.waitFor(() => expect(coordinator.republishPending()).toBe(1));
    await expect(coordinator.resolveApproval({
      id: "approval_decision_failure",
      approved: true,
    })).resolves.toBe(true);
    expect(coordinator.republishPending()).toBe(0);
    await expect(approval).resolves.toMatchObject({
      approved: false,
      automatic: true,
    });
  });

  it("never grants an ambiguously committed approved decision", async () => {
    const options = persistenceOptions();
    const coordinator = createToolApprovalCoordinator({
      ...options,
      store: {
        ...options.store,
        async decideApproval(input) {
          await options.store.decideApproval(input);
          throw new Error("rename committed but acknowledgement was lost");
        },
      },
      createId: () => "approval_ambiguous_commit",
      sendToRenderers() {},
    });
    const approval = coordinator.requestUserApproval(createRequest());
    await vi.waitFor(() => expect(coordinator.pendingSnapshot()).toHaveLength(1));
    await expect(coordinator.resolveApproval({
      id: "approval_ambiguous_commit",
      approved: true,
    })).resolves.toBe(true);
    await expect(options.store.getApprovalIntent("approval_ambiguous_commit"))
      .resolves.toMatchObject({ state: "approved" });
    await expect(approval).resolves.toMatchObject({ approved: false });
    expect(coordinator.pendingSnapshot()).toEqual([]);
  });

  it("redacts credential-shaped task names before durable persistence", async () => {
    const options = persistenceOptions();
    const coordinator = createToolApprovalCoordinator({
      ...options,
      createId: () => "approval_safe_task_name",
      sendToRenderers() {},
    });
    const approval = coordinator.requestUserApproval({
      ...createRequest(),
      taskName: "Goal sk-sp-MUTATION-TASKNAME-SECRET\nsecond line",
    });
    await vi.waitFor(() => expect(coordinator.pendingSnapshot()).toHaveLength(1));
    await expect(options.store.getApprovalIntent("approval_safe_task_name"))
      .resolves.toMatchObject({
        taskName: expect.not.stringContaining("sk-sp-MUTATION-TASKNAME-SECRET"),
      });
    expect(coordinator.pendingSnapshot()[0]?.taskName).not.toContain(
      "sk-sp-MUTATION-TASKNAME-SECRET",
    );
    await coordinator.resolveApproval({ id: "approval_safe_task_name", approved: false });
    await approval;
  });

  it("keeps a durable waiter resolvable when renderer delivery throws", async () => {
    const coordinator = createToolApprovalCoordinator({
      ...persistenceOptions(),
      createId: () => "approval_renderer_failure",
      sendToRenderers() {
        throw new Error("window unavailable");
      },
    });

    const approval = coordinator.requestUserApproval(createRequest());
    await vi.waitFor(() => expect(coordinator.republishPending()).toBe(1));
    await expect(coordinator.resolveApproval({
      id: "approval_renderer_failure",
      approved: false,
    })).resolves.toBe(true);
    await expect(approval).resolves.toMatchObject({ approved: false });
  });

  it.each([
    ["file_write", { path: "/tmp/report.txt", content: "done" }],
    ["shell_exec", { command: "npm test" }],
    ["web_fetch", { url: "https://example.com/source" }],
  ])("auto-approves ordinary %s requests", async (toolName, args) => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const coordinator = createToolApprovalCoordinator({
      ...persistenceOptions(),
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
    ).resolves.toMatchObject({
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
      ...persistenceOptions(),
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

    await vi.waitFor(() => expect(sent).toContainEqual({
      channel: "toolApproval:request",
      payload: expect.objectContaining({ id: "approval_waiting" }),
    }));

    coordinator.setAutoApprovalEnabled(true);

    await expect(approval).resolves.toMatchObject({
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
      ...persistenceOptions(),
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

    await vi.waitFor(() => expect(sent).toContainEqual({
      channel: "toolApproval:request",
      payload: expect.objectContaining({
        id: "approval_publish",
        risk: expect.objectContaining({
          requiresConfirmation: true,
          category: "irreversible_external_action",
        }),
      }),
    }));
    await coordinator.resolveApproval({ id: "approval_publish", approved: false });
    await expect(approval).resolves.toMatchObject({ approved: false });
  });

  it("settles and removes a pending approval when the run is aborted", async () => {
    const controller = new AbortController();
    const coordinator = createToolApprovalCoordinator({
      ...persistenceOptions(),
      createId: () => "approval_abort",
      sendToRenderers() {},
    });
    const approval = coordinator.requestUserApproval(createRequest(), {
      signal: controller.signal,
    });

    controller.abort();

    await expect(approval).resolves.toMatchObject({
      approved: false,
      reason: "运行已取消，授权请求已关闭。",
      automatic: true,
    });
    await expect(
      coordinator.resolveApproval({ id: "approval_abort", approved: true }),
    ).resolves.toBe(false);
  });

  it("rejects and drains every pending approval during shutdown", async () => {
    let next = 0;
    const coordinator = createToolApprovalCoordinator({
      ...persistenceOptions(),
      createId: () => `approval_shutdown_${++next}`,
      sendToRenderers() {},
    });
    const first = coordinator.requestUserApproval(createRequest());
    const second = coordinator.requestUserApproval(createRequest());

    await vi.waitFor(() => expect(coordinator.republishPending()).toBe(2));
    await expect(coordinator.rejectAllPending()).resolves.toBe(2);
    await expect(first).resolves.toMatchObject({
      approved: false,
      automatic: true,
      reason: "应用正在退出，授权请求已关闭。",
    });
    await expect(second).resolves.toMatchObject({ approved: false });
    await expect(coordinator.rejectAllPending()).resolves.toBe(0);
  });

  it("times out a forced ask after the configured bounded wait", async () => {
    vi.useFakeTimers();
    const coordinator = createToolApprovalCoordinator({
      ...persistenceOptions(),
      approvalTimeoutMs: 60_000,
      createId: () => "approval_timeout",
      sendToRenderers() {},
    });
    coordinator.setAutoApprovalEnabled(true);
    const approval = coordinator.requestUserApproval({
      ...createRequest(),
      request: { toolName: "shell_exec", args: { command: "npm publish" } },
    });

    await vi.waitFor(() => expect(coordinator.republishPending()).toBe(1));

    await vi.advanceTimersByTimeAsync(60_000);

    await expect(approval).resolves.toMatchObject({
      approved: false,
      reason: "授权等待已超过 60 秒，已拒绝本次 shell_exec；请改用安全替代方案。",
      automatic: true,
    });
  });

  it("forces and locks auto approval while goal mode is enabled", () => {
    const coordinator = createToolApprovalCoordinator({
      ...persistenceOptions(),
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
      ...persistenceOptions(),
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
      ...persistenceOptions(),
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
      ...persistenceOptions(),
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

    await vi.waitFor(() => expect(sent).toContainEqual({
      channel: "toolApproval:request",
      payload: expect.objectContaining({ id: "approval_chat" }),
    }));
    await expect(coordinator.resolveApproval({ id: "approval_chat", approved: false }))
      .resolves.toBe(true);
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

function createPersistedIntent(
  id: string,
  ownerProcessEpoch: string,
): ToolApprovalIntent {
  return {
    schemaVersion: CONVERSATION_CAUSAL_SCHEMA_VERSION,
    id,
    revision: 1,
    state: "pending",
    requestFingerprint: `fingerprint:${id}`,
    taskId: "goal:goal_1",
    taskName: "Goal milestone",
    toolName: "web_fetch",
    safeArgsSummary: { url: "https://example.com/source" },
    risk: {
      level: "normal",
      category: "none",
      requiresConfirmation: false,
    },
    causalRef: {},
    ownerProcessEpoch,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    expiresAt: "2026-08-18T00:01:00.000Z",
  };
}
