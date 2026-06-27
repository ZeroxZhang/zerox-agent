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

  it("registers a stable chat session rename IPC handler", () => {
    const renameSource = getHandlerSource(ipcSource, '"chatSessions:rename"');

    expect(renameSource).toContain("container.renameChatSession(sessionId, title)");
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
