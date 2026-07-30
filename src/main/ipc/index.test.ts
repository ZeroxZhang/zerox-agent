import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent, ChatTaskStatusEvent } from "../../shared/chat";

const electronState = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electronState.ipcHandlers.set(channel, handler);
    },
  },
}));

describe("chat IPC handlers", () => {
  const ipcSource = readFileSync(
    path.join(process.cwd(), "src/main/ipc/index.ts"),
    "utf8",
  );

  it("forwards stream events from guided skill input responses to the invoking renderer", () => {
    const respondSkillInputSource = getHandlerSource(
      ipcSource,
      '"chat:respondSkillInput"',
    );

    expect(respondSkillInputSource).toContain("event: IpcMainInvokeEvent");
    expect(respondSkillInputSource).toContain("const sender = event.sender");
    expect(respondSkillInputSource).toContain(
      "container.chatService().respondSkillInput(input,",
    );
    expect(respondSkillInputSource).toContain("onStreamEvent");
    expect(respondSkillInputSource).toContain('sender.send("chat:streamEvent"');
  });

  it("opens project workspaces through the native directory picker", () => {
    const openProjectSource = getHandlerSource(
      ipcSource,
      '"agentWorkspaces:openProject"',
    );

    expect(openProjectSource).toContain("dialog.showOpenDialog");
    expect(openProjectSource).toContain('"openDirectory"');
    expect(openProjectSource).toContain("createProjectWorkspace");
    expect(openProjectSource).toContain('mode === "create"');
    expect(openProjectSource).toContain("新建工作区");
    expect(openProjectSource).toContain("promptToCreate");
    expect(openProjectSource).toContain("return null");
  });

  it("forwards guided skill continuation status and stream events to the invoking renderer", async () => {
    electronState.ipcHandlers.clear();
    const { registerAllIpcHandlers } = await import("./index");
    const statusEvent: ChatTaskStatusEvent = {
      sessionId: "session_1",
      state: "model",
      message: "Resuming model call",
      createdAt: "2026-06-24T08:00:00.000Z",
      elapsedMs: 25,
    };
    const streamEvent: ChatStreamEvent = {
      type: "answer_delta",
      sessionId: "session_1",
      requestId: "request_1",
      text: "done",
      createdAt: "2026-06-24T08:00:01.000Z",
    };
    const respondSkillInput = vi.fn(async (_input, runtimeOptions) => {
      runtimeOptions.onStatusEvent?.(statusEvent);
      runtimeOptions.onStreamEvent?.(streamEvent);
      return {
        ok: false as const,
        message: "Skill input required.",
      };
    });
    const container = {
      onGoalProgressEvent: vi.fn(),
      onAgentRunsChanged: vi.fn(),
      chatService: () => ({
        respondSkillInput,
      }),
    } as unknown as Parameters<typeof registerAllIpcHandlers>[0];
    registerAllIpcHandlers(container);

    const handler = electronState.ipcHandlers.get("chat:respondSkillInput");
    expect(handler).toBeTypeOf("function");
    const sender = {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    };
    const result = await handler?.(
      { sender },
      {
        inputRequestId: "input_1",
        values: {},
      },
    );

    expect(result).toEqual({
      ok: false,
      message: "Skill input required.",
    });
    expect(sender.send).toHaveBeenCalledWith("chat:statusEvent", statusEvent);
    expect(sender.send).toHaveBeenCalledWith("chat:streamEvent", streamEvent);
  });

  it("aborts and drains active chat messages during application shutdown", async () => {
    electronState.ipcHandlers.clear();
    const { registerAllIpcHandlers, shutdownActiveChatMessages } = await import("./index");
    let observedSignal: AbortSignal | undefined;
    const sendMessage = vi.fn(async (_input, runtimeOptions) => {
      observedSignal = runtimeOptions.signal;
      return new Promise((resolve) => {
        runtimeOptions.signal.addEventListener("abort", () => {
          resolve({ ok: false as const, message: "canceled" });
        }, { once: true });
      });
    });
    const container = {
      onGoalProgressEvent: vi.fn(),
      onAgentRunsChanged: vi.fn(),
      chatService: () => ({ sendMessage }),
    } as unknown as Parameters<typeof registerAllIpcHandlers>[0];
    registerAllIpcHandlers(container);
    const handler = electronState.ipcHandlers.get("chat:sendMessage");
    const invocation = handler?.(
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      { sessionId: "session_1", requestId: "request_shutdown", message: "work" },
    );
    await Promise.resolve();

    await expect(shutdownActiveChatMessages()).resolves.toBe(1);
    expect(observedSignal?.aborted).toBe(true);
    await expect(invocation).resolves.toEqual({ ok: false, message: "canceled" });
    await expect(
      handler?.(
        { sender: { isDestroyed: () => false, send: vi.fn() } },
        { requestId: "late_request", message: "must not start" },
      ),
    ).resolves.toEqual({
      ok: false,
      message: "应用正在退出，未接收新的会话请求。",
    });
  });

  it("rejects a duplicate in-flight request id without replacing its cancellation state", async () => {
    electronState.ipcHandlers.clear();
    const { registerAllIpcHandlers, shutdownActiveChatMessages } = await import("./index");
    const sendMessage = vi.fn(async (_input, runtimeOptions) =>
      new Promise((resolve) => {
        runtimeOptions.signal.addEventListener("abort", () => {
          resolve({ ok: false as const, message: "canceled" });
        }, { once: true });
      }),
    );
    const container = {
      onGoalProgressEvent: vi.fn(),
      onAgentRunsChanged: vi.fn(),
      chatService: () => ({ sendMessage }),
    } as unknown as Parameters<typeof registerAllIpcHandlers>[0];
    registerAllIpcHandlers(container);
    const handler = electronState.ipcHandlers.get("chat:sendMessage");
    const sender = { isDestroyed: () => false, send: vi.fn() };
    const input = {
      sessionId: "session_1",
      requestId: "request_duplicate",
      message: "work",
    };

    const first = handler?.({ sender }, input);
    await Promise.resolve();
    await expect(handler?.({ sender }, input)).resolves.toEqual({
      ok: false,
      message: "请求 request_duplicate 已在执行，请等待完成或先取消。",
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);

    await expect(shutdownActiveChatMessages()).resolves.toBe(1);
    await expect(first).resolves.toEqual({ ok: false, message: "canceled" });
  });

  it("does not turn a missing targeted request id into cancel-all", async () => {
    electronState.ipcHandlers.clear();
    const { registerAllIpcHandlers, shutdownActiveChatMessages } = await import("./index");
    let signal: AbortSignal | undefined;
    const sendMessage = vi.fn(async (_input, runtimeOptions) => {
      signal = runtimeOptions.signal;
      return new Promise((resolve) => {
        signal?.addEventListener("abort", () => {
          resolve({ ok: false as const, message: "canceled" });
        }, { once: true });
      });
    });
    const container = {
      onGoalProgressEvent: vi.fn(),
      onAgentRunsChanged: vi.fn(),
      chatService: () => ({ sendMessage }),
    } as unknown as Parameters<typeof registerAllIpcHandlers>[0];
    registerAllIpcHandlers(container);
    const sender = { isDestroyed: () => false, send: vi.fn() };
    const active = electronState.ipcHandlers.get("chat:sendMessage")?.(
      { sender },
      { requestId: "active", message: "work" },
    );
    await Promise.resolve();

    expect(
      electronState.ipcHandlers.get("chat:cancelMessage")?.({}, "stale"),
    ).toEqual({ ok: false, message: "没有找到请求 stale。" });
    expect(signal?.aborted).toBe(false);

    await shutdownActiveChatMessages();
    await expect(active).resolves.toEqual({ ok: false, message: "canceled" });
  });

  it("passes a generated request id into the chat service", async () => {
    electronState.ipcHandlers.clear();
    const { registerAllIpcHandlers } = await import("./index");
    const sendMessage = vi.fn(async () => ({ ok: false as const, message: "done" }));
    const container = {
      onGoalProgressEvent: vi.fn(),
      onAgentRunsChanged: vi.fn(),
      chatService: () => ({ sendMessage }),
    } as unknown as Parameters<typeof registerAllIpcHandlers>[0];
    registerAllIpcHandlers(container);

    await electronState.ipcHandlers.get("chat:sendMessage")?.(
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      { message: "work" },
    );

    expect(sendMessage.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ requestId: expect.any(String) }),
    );
  });

  it("tracks and drains guided skill continuation work during shutdown", async () => {
    electronState.ipcHandlers.clear();
    const { registerAllIpcHandlers, shutdownActiveChatMessages } = await import("./index");
    let signal: AbortSignal | undefined;
    const respondSkillInput = vi.fn(async (_input, runtimeOptions) => {
      signal = runtimeOptions.signal;
      return new Promise((resolve) => {
        signal?.addEventListener("abort", () => {
          resolve({ ok: false as const, message: "canceled" });
        }, { once: true });
      });
    });
    const container = {
      onGoalProgressEvent: vi.fn(),
      onAgentRunsChanged: vi.fn(),
      chatService: () => ({ respondSkillInput }),
    } as unknown as Parameters<typeof registerAllIpcHandlers>[0];
    registerAllIpcHandlers(container);
    const completion = electronState.ipcHandlers.get("chat:respondSkillInput")?.(
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      {
        inputRequestId: "input_shutdown",
        requestId: "guided_shutdown",
        values: {},
      },
    );
    await Promise.resolve();

    await expect(shutdownActiveChatMessages()).resolves.toBe(1);
    expect(signal?.aborted).toBe(true);
    await expect(completion).resolves.toEqual({ ok: false, message: "canceled" });
  });

  it("uses the renderer lifecycle request id to cancel guided continuation work", async () => {
    electronState.ipcHandlers.clear();
    const { registerAllIpcHandlers } = await import("./index");
    const respondSkillInput = vi.fn(async (_input, runtimeOptions) =>
      new Promise((resolve) => {
        runtimeOptions.signal.addEventListener("abort", () => {
          resolve({ ok: false as const, message: "canceled" });
        }, { once: true });
      }),
    );
    const container = {
      onGoalProgressEvent: vi.fn(),
      onAgentRunsChanged: vi.fn(),
      chatService: () => ({ respondSkillInput }),
    } as unknown as Parameters<typeof registerAllIpcHandlers>[0];
    registerAllIpcHandlers(container);
    const completion = electronState.ipcHandlers.get("chat:respondSkillInput")?.(
      { sender: { isDestroyed: () => false, send: vi.fn() } },
      {
        inputRequestId: "input_cancel",
        requestId: "original_request",
        values: {},
      },
    );
    await Promise.resolve();

    expect(
      electronState.ipcHandlers.get("chat:cancelMessage")?.({}, "original_request"),
    ).toEqual({ ok: true, message: "已请求中断任务。" });
    await expect(completion).resolves.toEqual({ ok: false, message: "canceled" });
  });

  it("registers a stable chat session rename IPC handler", () => {
    const renameSource = getHandlerSource(ipcSource, '"chatSessions:rename"');

    expect(renameSource).toContain("container.renameChatSession(sessionId, title)");
  });

  it("registers provider test-save and credential-removal handlers", () => {
    const testAndSaveSource = getHandlerSource(
      ipcSource,
      '"modelCatalog:testAndSaveConnection"',
    );
    const clearCredentialSource = getHandlerSource(
      ipcSource,
      '"modelCatalog:clearConnectionCredential"',
    );

    expect(testAndSaveSource).toContain("testAndSaveProvider(input)");
    expect(testAndSaveSource).toContain("modelRouter().invalidate");
    expect(clearCredentialSource).toContain(
      "clearConnectionCredential(",
    );
    expect(clearCredentialSource).toContain("enrichCatalog(result.catalog)");
  });

  it("registers distinct final-acceptance recovery handlers", async () => {
    electronState.ipcHandlers.clear();
    const { registerAllIpcHandlers } = await import("./index");
    const continueGoalAcceptance = vi.fn(async () => ({ ok: true }));
    const markGoalCompletedUnverified = vi.fn(async () => ({ ok: true }));
    const container = {
      onGoalProgressEvent: vi.fn(),
      onAgentRunsChanged: vi.fn(),
      continueGoalAcceptance,
      markGoalCompletedUnverified,
    } as unknown as Parameters<typeof registerAllIpcHandlers>[0];
    registerAllIpcHandlers(container);

    await expect(
      electronState.ipcHandlers.get("goal:continueAcceptance")?.({}, "goal_1"),
    ).resolves.toEqual({ ok: true });
    await expect(
      electronState.ipcHandlers.get("goal:markCompletedUnverified")?.(
        {},
        "goal_1",
      ),
    ).resolves.toEqual({ ok: true });
    expect(continueGoalAcceptance).toHaveBeenCalledWith("goal_1");
    expect(markGoalCompletedUnverified).toHaveBeenCalledWith("goal_1");
  });

  it("persists the recovered plan state so the session rail does not keep a stale failure", async () => {
    electronState.ipcHandlers.clear();
    const { registerAllIpcHandlers } = await import("./index");
    const plan = {
      id: "plan_1",
      sessionId: "session_1",
      status: "awaiting_input",
      revision: 18,
      taskContract: { objective: "制作论文解析 Skill" },
      finalArtifact: {
        title: "终版论文解析 Skill 计划",
        gateReason: "请选择 CLI 或 Web UI。",
        unresolvedQuestions: ["请选择 CLI 或 Web UI。"],
      },
      rounds: [],
    };
    const retryFailedRound = vi.fn(async () => ({
      ok: true as const,
      plan,
      message: "已从失败轮次继续规划。",
    }));
    const appendMessage = vi.fn(async () => undefined);
    const container = {
      onGoalProgressEvent: vi.fn(),
      onAgentRunsChanged: vi.fn(),
      planDebateOrchestrator: () => ({ retryFailedRound }),
      chatSessionStore: () => ({
        get: vi.fn(async () => ({ messages: [] })),
        appendMessage,
      }),
    } as unknown as Parameters<typeof registerAllIpcHandlers>[0];
    registerAllIpcHandlers(container);

    await expect(
      electronState.ipcHandlers.get("plans:retryFailedRound")?.(
        {},
        "plan_1",
        "profile_b",
      ),
    ).resolves.toEqual({
      ok: true,
      plan,
      message: "已从失败轮次继续规划。",
    });
    expect(retryFailedRound).toHaveBeenCalledWith("plan_1", "profile_b");
    expect(appendMessage).toHaveBeenCalledWith({
      sessionId: "session_1",
      role: "assistant",
      content: "规划辩论已完成，仍需补充信息：请选择 CLI 或 Web UI。",
      goalEventRef: "plan-retry:plan_1:18",
    });
  });

  it("repairs a stale failed session summary when loading a recovered plan", async () => {
    electronState.ipcHandlers.clear();
    const { registerAllIpcHandlers } = await import("./index");
    const plan = {
      id: "plan_1",
      sessionId: "session_1",
      status: "awaiting_confirmation",
      revision: 19,
      taskContract: { objective: "制作论文解析 Skill" },
      finalArtifact: {
        title: "终版论文解析 Skill 计划",
        unresolvedQuestions: [],
      },
      rounds: [],
    };
    const appendMessage = vi.fn(async () => undefined);
    const container = {
      onGoalProgressEvent: vi.fn(),
      onAgentRunsChanged: vi.fn(),
      planStore: () => ({
        getLatestBySession: vi.fn(async () => plan),
      }),
      chatSessionStore: () => ({
        get: vi.fn(async () => ({
          messages: [
            {
              role: "assistant",
              content: "计划已暂停：规划输出缺少 objective 或 milestones。",
            },
          ],
        })),
        appendMessage,
      }),
    } as unknown as Parameters<typeof registerAllIpcHandlers>[0];
    registerAllIpcHandlers(container);

    await expect(
      electronState.ipcHandlers.get("plans:getLatestBySession")?.(
        {},
        "session_1",
      ),
    ).resolves.toEqual(plan);
    expect(appendMessage).toHaveBeenCalledWith({
      sessionId: "session_1",
      role: "assistant",
      content:
        "规划已恢复，终版计划「终版论文解析 Skill 计划」已就绪，等待确认后开始执行。",
      goalEventRef: "plan-retry:plan_1:19",
    });
  });

  it.each([
    "goal:continueAcceptance",
    "goal:markCompletedUnverified",
  ])("rejects unsafe goal ids before invoking %s", async (channel) => {
    electronState.ipcHandlers.clear();
    const { registerAllIpcHandlers } = await import("./index");
    const continueGoalAcceptance = vi.fn(async () => ({ ok: true }));
    const markGoalCompletedUnverified = vi.fn(async () => ({ ok: true }));
    const container = {
      onGoalProgressEvent: vi.fn(),
      onAgentRunsChanged: vi.fn(),
      continueGoalAcceptance,
      markGoalCompletedUnverified,
    } as unknown as Parameters<typeof registerAllIpcHandlers>[0];
    registerAllIpcHandlers(container);
    const handler = electronState.ipcHandlers.get(channel);

    for (const unsafeGoalId of [
      "",
      "   ",
      "../goal_1",
      "goal_../secret",
      "goal\\secret",
      "x".repeat(129),
      42,
      null,
    ]) {
      await expect(handler?.({}, unsafeGoalId)).resolves.toEqual({
        ok: false,
        message: "目标 ID 无效。",
      });
    }
    expect(continueGoalAcceptance).not.toHaveBeenCalled();
    expect(markGoalCompletedUnverified).not.toHaveBeenCalled();
  });
});

function getHandlerSource(source: string, channel: string): string {
  const startIndex = source.indexOf(channel);
  if (startIndex === -1) {
    return "";
  }
  const nextHandlerIndex = source.indexOf("ipcMain.handle(", startIndex + channel.length);
  return source.slice(
    startIndex,
    nextHandlerIndex === -1 ? undefined : nextHandlerIndex,
  );
}
