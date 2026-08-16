import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChatSessionStore } from "./chatSessionStore";
import { createInMemoryStorage } from "./storage/storageDb";
import type { Storage } from "../shared/storageContract";

describe("chat session store", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-chat-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("starts empty when no chat session file exists", async () => {
    const store = createChatSessionStore({ configDir });

    await expect(store.list()).resolves.toEqual([]);
  });

  it("persists attachment metadata without persisting attachment bytes", async () => {
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("chat"),
    });
    const appended = await store.appendMessage({
      role: "user",
      content: "分析截图",
      attachments: [
        {
          id: "attachment_1",
          name: "screen.png",
          mediaType: "image/png",
          size: 68,
          kind: "image",
        },
      ],
    });

    expect(appended.message.attachments).toEqual([
      {
        id: "attachment_1",
        name: "screen.png",
        mediaType: "image/png",
        size: 68,
        kind: "image",
      },
    ]);
    const attachment = appended.message.attachments?.[0];
    if (!attachment) throw new Error("Expected persisted attachment.");
    const unsafePendingAttachment = {
      ...attachment,
      dataBase64: "must-not-be-persisted",
    };
    await store.appendActivityEvent(appended.session.id, {
      sessionId: appended.session.id,
      state: "waiting_for_input",
      message: "Skill input required.",
      createdAt: "2026-07-14T15:30:00.000Z",
      elapsedMs: 1,
      turn: 2,
      toolCallId: "tool_call_1",
      toolInvocationId: "invocation_1",
      toolName: "file_read",
      toolSource: "native",
      resultRef: "tool-result-refs/result_1.json",
      resultBytes: 321,
      invocationStatus: "completed",
      checkpointId: "checkpoint_1",
      memoryScopes: ["session", "workspace"],
      historyOperation: "append",
      workspaceId: "workspace_1",
      workspaceSummary: {
        name: "项目",
        rootPath: "/workspace/project",
        kind: "primary",
        sandboxMode: "workspace-write",
        branch: "codex/3.7.1",
      },
      ok: true,
      payload: {
        actorId: "actor_1",
        nested: { status: "done", dataBase64: "strip-me" },
      },
      pendingSkillInput: {
        inputRequestId: "input_1",
        status: "pending",
        sessionId: appended.session.id,
        requestId: "request_1",
        userMessage: "分析截图",
        selectedSkillName: "image-review",
        partialValues: {},
        attachments: [unsafePendingAttachment],
      },
    });
    const raw = await readFile(path.join(configDir, "chat-sessions.json"), "utf8");
    expect(raw).not.toContain("dataBase64");
    await expect(
      createChatSessionStore({ configDir }).get(appended.session.id),
    ).resolves.toMatchObject({
      messages: [expect.objectContaining({ attachments: appended.message.attachments })],
      activity: {
        statusEvents: [
          expect.objectContaining({
            toolCallId: "tool_call_1",
            toolInvocationId: "invocation_1",
            resultRef: "tool-result-refs/result_1.json",
            resultBytes: 321,
            checkpointId: "checkpoint_1",
            memoryScopes: ["session", "workspace"],
            workspaceId: "workspace_1",
            payload: {
              actorId: "actor_1",
              nested: { status: "done" },
            },
          }),
        ],
      },
    });
  });

  it("persists guided-input attachment payloads for restart recovery", async () => {
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("guided"),
    });
    const session = await store.appendMessage({ role: "user", content: "检查截图" });
    await store.appendActivityEvent(session.session.id, {
      sessionId: session.session.id,
      requestId: "request_guided",
      sequence: 1,
      turnId: "turn-request_guided",
      state: "waiting_for_input",
      message: "等待输入",
      createdAt: "2026-07-31T00:00:00.000Z",
      elapsedMs: 1,
      pendingSkillInput: {
        inputRequestId: "input_guided",
        status: "pending",
        sessionId: session.session.id,
        requestId: "request_guided",
        userMessage: "检查截图",
        selectedSkillName: "image-review",
        partialValues: {},
        attachments: [
          { id: "image_1", name: "screen.png", mediaType: "image/png", size: 3, kind: "image" },
        ],
        attachmentPayloads: [
          { id: "image_1", name: "screen.png", mediaType: "image/png", size: 3, kind: "image", dataBase64: "YWJj" },
        ],
      },
    });
    await store.flush();

    const restarted = createChatSessionStore({ configDir });
    await expect(restarted.get(session.session.id)).resolves.toMatchObject({
      activity: {
        statusEvents: [
          expect.objectContaining({
            requestId: "request_guided",
            sequence: 1,
            turnId: "turn-request_guided",
            pendingSkillInput: expect.objectContaining({
              attachmentPayloads: [expect.objectContaining({ dataBase64: "YWJj" })],
            }),
          }),
        ],
      },
    });
  });

  it("preserves a processing guided-input claim across restart", async () => {
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("guided-processing"),
    });
    const session = await store.appendMessage({
      role: "user",
      content: "继续技能",
    });
    await store.appendActivityEvent(session.session.id, {
      sessionId: session.session.id,
      requestId: "request_processing",
      state: "checkpoint_boundary",
      message: "Skill input execution claimed.",
      createdAt: "2026-08-15T00:00:00.000Z",
      elapsedMs: 1,
      inputRequest: {
        id: "input_processing",
        executionId: "execution_processing",
        sessionId: session.session.id,
        requestId: "request_processing",
        skillName: "local-skill",
        reason: "Confirm path.",
        fields: [
          {
            name: "path",
            label: "Path",
            type: "path",
            required: true,
          },
        ],
        createdAt: "2026-08-15T00:00:00.000Z",
      },
      pendingSkillInput: {
        inputRequestId: "input_processing",
        status: "processing",
        inputRequest: {
          id: "input_processing",
          executionId: "execution_processing",
          sessionId: session.session.id,
          requestId: "request_processing",
          skillName: "local-skill",
          reason: "Confirm path.",
          fields: [
            {
              name: "path",
              label: "Path",
              type: "path",
              required: true,
            },
          ],
          createdAt: "2026-08-15T00:00:00.000Z",
        },
        sessionId: session.session.id,
        requestId: "request_processing",
        userMessage: "继续技能",
        selectedSkillName: "local-skill",
        partialValues: { path: "/workspace" },
      },
    });
    await store.flush();

    const restarted = createChatSessionStore({ configDir });
    await expect(restarted.get(session.session.id)).resolves.toMatchObject({
      activity: {
        statusEvents: [
          expect.objectContaining({
            pendingSkillInput: expect.objectContaining({
              inputRequestId: "input_processing",
              status: "processing",
              inputRequest: expect.objectContaining({
                id: "input_processing",
              }),
            }),
          }),
        ],
      },
    });
  });

  it("reuses the pending user record when the same attachment turn is retried", async () => {
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("retry"),
    });
    const attachments = [
      {
        id: "attachment_retry",
        name: "screen.png",
        mediaType: "image/png",
        size: 68,
        kind: "image" as const,
      },
    ];
    const first = await store.appendMessage({
      role: "user",
      content: "分析截图",
      attachments,
    });
    const retry = await store.appendMessage({
      sessionId: first.session.id,
      role: "user",
      content: "分析截图",
      attachments,
    });

    expect(retry.message.id).toBe(first.message.id);
    expect(retry.session.messages).toEqual([first.message]);
    await expect(store.get(first.session.id)).resolves.toMatchObject({
      messages: [{ id: first.message.id }],
    });
  });

  it("quarantines corrupt chat JSON and exposes a recovery notice to the user", async () => {
    await writeFile(path.join(configDir, "chat-sessions.json"), "", "utf8");
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("chat"),
    });

    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({
        title: "会话存储恢复通知",
        messageCount: 1,
      }),
    ]);

    const files = await readdir(configDir);
    expect(
      files.some((file) => file.startsWith("chat-sessions.json.corrupt-")),
    ).toBe(true);

    const appended = await store.appendMessage({
      role: "user",
      content: "继续",
    });
    expect(appended.session.messages).toHaveLength(1);
  });

  it("handles concurrent corrupt chat session recovery without surfacing rename errors", async () => {
    await writeFile(path.join(configDir, "chat-sessions.json"), "", "utf8");
    const store = createChatSessionStore({ configDir });

    const recovered = await Promise.all([store.list(), store.list(), store.list()]);
    expect(recovered.every((sessions) => sessions.length === 1)).toBe(true);
    expect(recovered.flat().every((session) => session.title === "会话存储恢复通知"))
      .toBe(true);
  });

  it("creates a session with a brief generated title and persists messages", async () => {
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("chat"),
      now: createSteppedClock("2026-06-06T08:00:00.000Z"),
    });

    const userAppend = await store.appendMessage({
      role: "user",
      content: "帮我整理下载文件夹，并生成报告",
    });
    const assistantAppend = await store.appendMessage({
      sessionId: userAppend.session.id,
      role: "assistant",
      content: "我会先检查权限，然后运行本地文件整理任务。",
      relatedMemoryIds: ["mem_downloads"],
      executedRunId: "run_1",
    });

    expect(userAppend.session).toMatchObject({
      id: "chat_1",
      title: "整理下载报告",
      summary: "整理下载报告",
      createdAt: "2026-06-06T08:00:00.000Z",
      updatedAt: "2026-06-06T08:00:00.000Z",
    });
    expect(assistantAppend.message).toEqual({
      id: "chat_3",
      role: "assistant",
      content: "我会先检查权限，然后运行本地文件整理任务。",
      relatedMemoryIds: ["mem_downloads"],
      executedRunId: "run_1",
      createdAt: "2026-06-06T08:01:00.000Z",
    });
    expect(assistantAppend.session.messages).toHaveLength(2);

    await expect(store.list()).resolves.toEqual([
      {
        id: "chat_1",
        title: "整理下载报告",
        summary: "我会先检查权限，然后运行本地文件整理任务。",
        messageCount: 2,
        work: {
          source: "idle",
          status: "idle",
          updatedAt: "2026-06-06T08:01:00.000Z",
        },
        lastAssistantMessageAt: "2026-06-06T08:01:00.000Z",
        updatedAt: "2026-06-06T08:01:00.000Z",
      },
    ]);
    await expect(store.get("chat_1")).resolves.toEqual(assistantAppend.session);

    const raw = await readFile(path.join(configDir, "chat-sessions.json"), {
      encoding: "utf8",
    });
    expect(JSON.parse(raw)).toEqual({
      schemaVersion: 1,
      sessions: [assistantAppend.session],
    });

    const reloaded = createChatSessionStore({ configDir });
    await expect(reloaded.get("chat_1")).resolves.toEqual(assistantAppend.session);
  });

  it("preserves message content exactly when persisting markdown output", async () => {
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("chat"),
      now: createSteppedClock("2026-06-26T08:00:00.000Z"),
    });
    const exactContent = "  # Report\n\nResult stays spaced.  \n";

    const appended = await store.appendMessage({
      role: "assistant",
      content: exactContent,
    });

    expect(appended.message.content).toBe(exactContent);
    await expect(store.get(appended.session.id)).resolves.toMatchObject({
      messages: [expect.objectContaining({ content: exactContent })],
    });

    const raw = await readFile(path.join(configDir, "chat-sessions.json"), {
      encoding: "utf8",
    });
    expect(JSON.parse(raw).sessions[0].messages[0].content).toBe(exactContent);
  });

  it("persists workspace identity and summary on chat sessions", async () => {
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("chat"),
      now: createSteppedClock("2026-06-21T00:00:00.000Z"),
    });

    const created = await store.appendMessage({
      role: "user",
      content: "hello",
      workspaceId: "workspace_building_agent",
      workspaceSummary: {
        name: "building agent",
        rootPath: "/Volumes/Out/codex_projects/building agent",
        kind: "default",
        sandboxMode: "workspace-write",
        branch: "codex/v2.5.0-workspace-skill-execution",
      },
    });

    const reloaded = createChatSessionStore({ configDir });
    const loaded = await reloaded.get(created.session.id);
    expect(loaded?.workspaceId).toBe("workspace_building_agent");
    expect(loaded?.workspaceSummary).toEqual({
      name: "building agent",
      rootPath: "/Volumes/Out/codex_projects/building agent",
      kind: "default",
      sandboxMode: "workspace-write",
      branch: "codex/v2.5.0-workspace-skill-execution",
    });
    await expect(reloaded.list()).resolves.toEqual([
      expect.objectContaining({
        id: created.session.id,
        workspaceId: "workspace_building_agent",
        workspaceSummary: expect.objectContaining({
          rootPath: "/Volumes/Out/codex_projects/building agent",
        }),
      }),
    ]);
  });

  it("preserves prior workspace fields on follow-up messages", async () => {
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("chat"),
      now: createSteppedClock("2026-06-21T00:00:00.000Z"),
    });

    const created = await store.appendMessage({
      role: "user",
      content: "inspect",
      workspaceId: "workspace_building_agent",
      workspaceSummary: {
        name: "building agent",
        rootPath: "/Volumes/Out/codex_projects/building agent",
        kind: "default",
        sandboxMode: "workspace-write",
      },
    });
    const followUp = await store.appendMessage({
      sessionId: created.session.id,
      role: "assistant",
      content: "done",
    });

    expect(followUp.session.workspaceId).toBe("workspace_building_agent");
    expect(followUp.session.workspaceSummary?.rootPath).toBe(
      "/Volumes/Out/codex_projects/building agent",
    );
  });

  it("lists sessions with last assistant response time and token usage", async () => {
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("chat"),
      now: createSteppedClock("2026-06-20T08:00:00.000Z"),
    });

    const first = await store.appendMessage({
      role: "user",
      content: "整理历史会话",
    });
    await store.appendMessage({
      sessionId: first.session.id,
      role: "assistant",
      content: "已整理。",
    });
    await store.addTokenUsage(first.session.id, {
      totalTokens: 18700,
      promptTokens: 12000,
      completionTokens: 6700,
      estimated: false,
    });

    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({
        id: first.session.id,
        lastAssistantMessageAt: "2026-06-20T08:01:00.000Z",
        tokenUsage: {
          totalTokens: 18700,
          promptTokens: 12000,
          completionTokens: 6700,
          estimated: false,
        },
      }),
    ]);
  });

  it("bounds session summaries used by the sidebar list", async () => {
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("chat"),
      now: createSteppedClock("2026-06-20T08:00:00.000Z"),
    });

    const first = await store.appendMessage({
      role: "user",
      content: "分析项目",
    });
    const longAssistantSummary = [
      "🔧 使用了 70 个工具",
      "项目分析报告已生成完毕，保存在 /Volumes/Out/codex_projects/building-agent/report.md。",
      "以下是非常长的正文摘要。",
      "x".repeat(600),
    ].join("\n\n");
    await store.appendMessage({
      sessionId: first.session.id,
      role: "assistant",
      content: longAssistantSummary,
    });

    const [listedSession] = await store.list();
    const storedSession = await store.get(first.session.id);

    expect(listedSession.summary).toHaveLength(160);
    expect(listedSession.summary).toMatch(/\.\.\.$/);
    expect(listedSession.summary).not.toContain("\n");
    expect(storedSession?.summary).toBe(listedSession.summary);
  });

  it("persists rebuildable chat activity snapshots with a bounded event history", async () => {
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("chat"),
      now: createSteppedClock("2026-06-20T08:00:00.000Z"),
    });
    const first = await store.appendMessage({
      role: "user",
      content: "使用 onepager 技能生成 onepage",
    });

    for (let index = 0; index < 82; index += 1) {
      await store.appendActivityEvent(first.session.id, {
        sessionId: first.session.id,
        state: index === 0 ? "skill" : "model",
        message: `状态 ${index}`,
        createdAt: new Date(Date.UTC(2026, 5, 20, 8, 0, index)).toISOString(),
        elapsedMs: index * 1000,
        ...(index === 0 ? { selectedSkillName: "onepager" } : {}),
      });
    }

    const reloaded = createChatSessionStore({ configDir });
    const session = await reloaded.get(first.session.id);

    expect(session?.activity).toMatchObject({
      updatedAt: "2026-06-20T08:01:21.000Z",
      selectedSkillName: "onepager",
    });
    expect(session?.activity?.statusEvents).toHaveLength(80);
    expect(session?.activity?.statusEvents[0]).toMatchObject({
      state: "model",
      message: "状态 2",
    });
    expect(session?.activity?.statusEvents.at(-1)).toMatchObject({
      state: "model",
      message: "状态 81",
    });
  });

  it("persists the latest isolated context snapshot on the session and list item", async () => {
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("context"),
    });
    const first = await store.appendMessage({
      role: "user",
      content: "检查上下文隔离",
    });
    await store.appendActivityEvent(first.session.id, {
      sessionId: first.session.id,
      state: "context",
      message: "上下文已压缩",
      createdAt: "2026-08-03T08:00:00.000Z",
      elapsedMs: 200,
      context: {
        isolation: "session_plus_global_memory",
        estimatedTokens: 240,
        tokenBudget: 1_000,
        occupancyRatio: 0.99,
        messageCount: 4,
        compactionCount: 1,
        sessionMessageCount: 1,
        historyMessageCount: 1,
        recalledSessionMemories: 0,
        recalledGlobalMemories: 2,
        lastCompaction: {
          strategy: "summarize",
          beforeMessages: 8,
          afterMessages: 4,
          beforeTokens: 800,
          afterTokens: 240,
          compactedAt: "2026-08-03T08:00:00.000Z",
        },
        updatedAt: "2026-08-03T08:00:00.000Z",
      },
    });

    const restarted = createChatSessionStore({ configDir });
    await expect(restarted.get(first.session.id)).resolves.toMatchObject({
      context: {
        isolation: "session_plus_global_memory",
        estimatedTokens: 240,
        tokenBudget: 1_000,
        occupancyRatio: 0.24,
        compactionCount: 1,
        lastCompaction: {
          beforeTokens: 800,
          afterTokens: 240,
        },
      },
    });
    await expect(restarted.list()).resolves.toEqual([
      expect.objectContaining({
        context: expect.objectContaining({
          isolation: "session_plus_global_memory",
          estimatedTokens: 240,
          compactionCount: 1,
        }),
      }),
    ]);
  });

  it("archives restores and deletes sessions without touching other sessions", async () => {
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("chat"),
      now: createSteppedClock("2026-06-20T08:00:00.000Z"),
    });

    const archived = await store.appendMessage({
      role: "user",
      content: "旧会话",
    });
    const active = await store.appendMessage({
      role: "user",
      content: "新会话",
    });

    await expect(store.archive(archived.session.id)).resolves.toMatchObject({
      id: archived.session.id,
      archivedAt: "2026-06-20T08:02:00.000Z",
    });
    const listedSessions = await store.list();
    expect(listedSessions).toEqual([
      expect.objectContaining({
        id: active.session.id,
      }),
      expect.objectContaining({
        id: archived.session.id,
        archivedAt: "2026-06-20T08:02:00.000Z",
      }),
    ]);
    expect(listedSessions[0]).not.toHaveProperty("archivedAt");

    const restoredSession = await store.restore(archived.session.id);
    expect(restoredSession).toMatchObject({
      id: archived.session.id,
    });
    expect(restoredSession).not.toHaveProperty("archivedAt");
    await expect(store.delete(active.session.id)).resolves.toBe(true);
    await expect(store.get(active.session.id)).resolves.toBeNull();
    await expect(store.get(archived.session.id)).resolves.toMatchObject({
      id: archived.session.id,
    });
  });

  it("renames a session title without changing message timestamps or summary", async () => {
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("chat"),
      now: createSteppedClock("2026-06-20T08:00:00.000Z"),
    });
    const created = await store.appendMessage({
      role: "user",
      content: "帮我做 2.8.2 版本迭代",
    });
    await store.appendMessage({
      sessionId: created.session.id,
      role: "assistant",
      content: "我会先写红测。",
    });

    const renamed = await store.rename(created.session.id, "2.8.2 迭代");

    expect(renamed).toMatchObject({
      id: created.session.id,
      title: "2.8.2 迭代",
      summary: "我会先写红测。",
      updatedAt: "2026-06-20T08:01:00.000Z",
    });
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({
        id: created.session.id,
        title: "2.8.2 迭代",
        summary: "我会先写红测。",
        updatedAt: "2026-06-20T08:01:00.000Z",
        lastAssistantMessageAt: "2026-06-20T08:01:00.000Z",
      }),
    ]);
  });

  it("normalizes legacy sessions without archive or token metadata", async () => {
    await writeFile(
      path.join(configDir, "chat-sessions.json"),
      JSON.stringify({
        schemaVersion: 1,
        sessions: [
          {
            id: "legacy",
            title: "旧会话",
            summary: "旧摘要",
            messages: [
              {
                id: "m1",
                role: "user",
                content: "继续",
                createdAt: "2026-06-18T08:00:00.000Z",
              },
            ],
            createdAt: "2026-06-18T08:00:00.000Z",
            updatedAt: "2026-06-18T08:00:00.000Z",
          },
        ],
      }),
      "utf8",
    );
    const store = createChatSessionStore({ configDir });

    await expect(store.list()).resolves.toEqual([
      {
        id: "legacy",
        title: "旧会话",
        summary: "旧摘要",
        messageCount: 1,
        updatedAt: "2026-06-18T08:00:00.000Z",
        lastAssistantMessageAt: "2026-06-18T08:00:00.000Z",
        work: {
          source: "idle",
          status: "idle",
          updatedAt: "2026-06-18T08:00:00.000Z",
        },
      },
    ]);
  });

  it("drops malformed persisted workspace summaries", async () => {
    await writeFile(
      path.join(configDir, "chat-sessions.json"),
      JSON.stringify({
        schemaVersion: 1,
        sessions: [
          {
            id: "legacy",
            title: "旧会话",
            summary: "旧摘要",
            messages: [],
            workspaceId: 42,
            workspaceSummary: {
              name: "building agent",
              rootPath: "",
              kind: "default",
              sandboxMode: "workspace-write",
            },
            createdAt: "2026-06-18T08:00:00.000Z",
            updatedAt: "2026-06-18T08:00:00.000Z",
          },
        ],
      }),
      "utf8",
    );
    const store = createChatSessionStore({ configDir });

    const loaded = await store.get("legacy");
    expect(loaded?.workspaceId).toBe("42");
    expect(loaded?.workspaceSummary).toBeUndefined();
  });

  it("normalizes persisted streaming and waiting input activity states", async () => {
    await writeFile(
      path.join(configDir, "chat-sessions.json"),
      JSON.stringify({
        schemaVersion: 1,
        sessions: [
          {
            id: "legacy_activity",
            title: "技能会话",
            summary: "等待输入",
            messages: [],
            activity: {
              updatedAt: "2026-06-23T08:00:01.000Z",
              statusEvents: [
                {
                  sessionId: "legacy_activity",
                  state: "streaming",
                  message: "Streaming answer",
                  createdAt: "2026-06-23T08:00:00.000Z",
                  elapsedMs: 100,
                },
                {
                  sessionId: "legacy_activity",
                  state: "waiting_for_input",
                  message: "Waiting for skill input",
                  createdAt: "2026-06-23T08:00:01.000Z",
                  elapsedMs: 200,
                  inputRequest: {
                    id: "input_1",
                    executionId: "execution_1",
                    sessionId: "legacy_activity",
                    requestId: "request_1",
                    skillName: "onepager",
                    reason: "Choose a source path.",
                    fields: [
                      {
                        name: "sourcePath",
                        label: "Source path",
                        type: "path",
                        required: true,
                      },
                      {
                        name: "format",
                        label: "Format",
                        type: "choice",
                        required: true,
                        choices: ["markdown", "html"],
                      },
                    ],
                    createdAt: "2026-06-23T08:00:01.000Z",
                  },
                },
              ],
            },
            createdAt: "2026-06-23T08:00:00.000Z",
            updatedAt: "2026-06-23T08:00:01.000Z",
          },
        ],
      }),
      "utf8",
    );
    const store = createChatSessionStore({ configDir });

    const loaded = await store.get("legacy_activity");

    expect(loaded?.activity?.statusEvents.map((event) => event.state)).toEqual([
      "streaming",
      "waiting_for_input",
    ]);
    expect(loaded?.activity?.statusEvents.at(-1)).toMatchObject({
      inputRequest: {
        id: "input_1",
        executionId: "execution_1",
        reason: "Choose a source path.",
        fields: [
          {
            name: "sourcePath",
            type: "path",
          },
          {
            name: "format",
            type: "choice",
            choices: ["markdown", "html"],
          },
        ],
      },
    });
  });

  it("serializes concurrent session mutations without dropping messages", async () => {
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("chat"),
      now: createSteppedClock("2026-06-06T08:00:00.000Z"),
    });
    const userAppend = await store.appendMessage({
      role: "user",
      content: "帮我看一下 Chrome 书签",
    });

    await Promise.all([
      store.appendMessage({
        sessionId: userAppend.session.id,
        role: "assistant",
        content: "第一条结果。",
      }),
      store.appendMessage({
        sessionId: userAppend.session.id,
        role: "assistant",
        content: "第二条结果。",
      }),
    ]);

    const session = await store.get(userAppend.session.id);
    expect(session?.messages.map((message) => message.content)).toEqual([
      "帮我看一下 Chrome 书签",
      "第一条结果。",
      "第二条结果。",
    ]);
  });

  it("summarizes long goal-style prompts without keeping project paths in the title", async () => {
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("chat"),
      now: createSteppedClock("2026-06-06T08:00:00.000Z"),
    });

    const appended = await store.appendMessage({
      role: "user",
      content:
        "/目标 帮我review你自己这个项目，项目位置是：'/Volumes/Out/codex_projects/building agent'，提出迭代优化的方案",
    });

    expect(appended.session.title).toBe("项目 Review 优化");
    expect(appended.session.title).not.toContain("/Volumes");
    expect(appended.session.title.length).toBeLessThanOrEqual(16);
  });

  it("searches raw chat messages as conversation evidence", async () => {
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("chat"),
      now: createSteppedClock("2026-06-06T08:00:00.000Z"),
    });

    const first = await store.appendMessage({
      role: "user",
      content: "帮我整理下载文件夹",
    });
    await store.appendMessage({
      sessionId: first.session.id,
      role: "assistant",
      content: "报告已保存为 Markdown。",
    });
    await store.appendMessage({
      role: "user",
      content: "明天提醒我检查发票",
    });

    await expect(
      store.searchMessages({ query: "报告 markdown", limit: 5 }),
    ).resolves.toEqual([
      {
        sessionId: "chat_1",
        sessionTitle: "整理下载文件夹",
        messageId: "chat_3",
        role: "assistant",
        content: "报告已保存为 Markdown。",
        createdAt: "2026-06-06T08:01:00.000Z",
        score: 4,
        matchedTerms: ["报告", "markdown"],
      },
    ]);
  });

  it("persists active and historical goal ids on chat sessions", async () => {
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("chat"),
      now: createSteppedClock("2026-06-12T08:00:00.000Z"),
    });

    const first = await store.appendMessage({
      role: "user",
      content: "把这轮设为目标：发布 v1.8.0",
    });
    const linked = await store.attachGoal(first.session.id, {
      id: "goal_release",
      status: "executing",
      description: "发布 v1.8.0",
    });

    expect(linked.activeGoalId).toBe("goal_release");
    expect(linked.goalIds).toEqual(["goal_release"]);
    expect(linked.goalSummaries).toEqual([
      {
        id: "goal_release",
        status: "executing",
        description: "发布 v1.8.0",
      },
    ]);
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({
        id: first.session.id,
        activeGoal: {
          id: "goal_release",
          description: "发布 v1.8.0",
          status: "executing",
        },
      }),
    ]);
  });

  it("clears the active goal while preserving goal history", async () => {
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("chat"),
      now: createSteppedClock("2026-06-12T08:00:00.000Z"),
    });

    const first = await store.appendMessage({
      role: "user",
      content: "目标：完成 release",
    });
    await store.attachGoal(first.session.id, {
      id: "goal_release",
      status: "executing",
      description: "完成 release",
    });

    const cleared = await store.clearActiveGoal(first.session.id, "goal_release");

    expect(cleared?.activeGoalId).toBeUndefined();
    expect(cleared?.goalIds).toEqual(["goal_release"]);
    const listed = await store.list();
    expect(listed).toEqual([
      expect.objectContaining({
        id: first.session.id,
      }),
    ]);
    expect(listed[0].activeGoal).toBeUndefined();
  });

  it("stores a stalled goal as recovery context instead of an active goal", async () => {
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("chat"),
      now: createSteppedClock("2026-08-02T07:50:00.000Z"),
    });
    const first = await store.appendMessage({
      role: "user",
      content: "继续完成 Skill 包",
    });

    const linked = await store.attachGoal(first.session.id, {
      id: "goal_stalled",
      status: "stopped_stalled",
      description: "构建 Skill 包",
      updatedAt: "2026-08-02T07:50:00.000Z",
    });

    expect(linked.activeGoalId).toBeUndefined();
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({
        recoveryGoal: expect.objectContaining({ id: "goal_stalled" }),
        work: expect.objectContaining({
          source: "goal",
          relationship: "recovery",
          goalId: "goal_stalled",
        }),
      }),
    ]);
  });
});

describe("SQLite chat session store", () => {
  let configDir: string;
  let storage: Storage;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "zerox-chat-sqlite-"));
    storage = await createInMemoryStorage();
  });

  afterEach(async () => {
    storage.close();
    await rm(configDir, { recursive: true, force: true });
  });

  it("matches message, list, activity, goal, usage, archive, and search behavior", async () => {
    const store = createChatSessionStore({
      configDir,
      backend: "sqlite",
      storage,
      createId: createSequentialId("chat"),
      now: createSteppedClock("2026-06-06T08:00:00.000Z"),
    });
    const first = await store.appendMessage({
      role: "user",
      content: "帮我整理下载文件夹，并生成报告",
      workspaceId: "workspace_1",
    });
    const second = await store.appendMessage({
      sessionId: first.session.id,
      role: "assistant",
      content: "报告已保存为 Markdown。",
    });
    await store.addTokenUsage(first.session.id, {
      totalTokens: 12,
      estimated: false,
    });
    await store.appendActivityEvent(first.session.id, {
      sessionId: first.session.id,
      state: "completed",
      message: "done",
      createdAt: "2026-06-06T08:03:00.000Z",
      elapsedMs: 10,
    });
    await store.attachGoal(first.session.id, {
      id: "goal_1",
      description: "发布报告",
      status: "executing",
      updatedAt: "2026-06-06T08:04:00.000Z",
    });
    await store.clearActiveGoal(first.session.id, "goal_1");
    await store.rename(first.session.id, "下载报告");

    const stored = await store.get(first.session.id);
    expect(stored).toMatchObject({
      id: first.session.id,
      title: "下载报告",
      workspaceId: "workspace_1",
      messages: [first.message, second.message],
      tokenUsage: { totalTokens: 12, estimated: false },
      goalIds: ["goal_1"],
    });
    expect(stored).not.toHaveProperty("activeGoalId");
    expect(await store.list()).toEqual([
      expect.objectContaining({
        id: first.session.id,
        title: "下载报告",
        messageCount: 2,
        lastAssistantMessageAt: second.message.createdAt,
      }),
    ]);
    const searchResults = await store.searchMessages({
      query: "报告 markdown",
      limit: 5,
    });
    expect(searchResults[0]).toEqual(
      expect.objectContaining({
        messageId: second.message.id,
        score: 5,
      }),
    );
    const archived = await store.archive(first.session.id);
    expect(archived?.archivedAt).toBeDefined();
    expect((await store.restore(first.session.id))?.archivedAt).toBeUndefined();
  });

  it("serializes concurrent message appends with monotonic event order", async () => {
    const store = createChatSessionStore({
      configDir,
      backend: "sqlite",
      storage,
      createId: createSequentialId("chat"),
      now: createSteppedClock("2026-06-06T08:00:00.000Z"),
    });
    const first = await store.appendMessage({
      role: "user",
      content: "start",
    });

    await Promise.all([
      store.appendMessage({
        sessionId: first.session.id,
        role: "assistant",
        content: "first",
      }),
      store.appendMessage({
        sessionId: first.session.id,
        role: "assistant",
        content: "second",
      }),
    ]);

    expect(
      (await store.get(first.session.id))?.messages.map(
        (message) => message.content,
      ),
    ).toEqual(["start", "first", "second"]);
    expect(
      storage.db
        .prepare(
          `SELECT seq, type
             FROM chat_session_events
            WHERE session_id = ?
            ORDER BY seq ASC`,
        )
        .all(first.session.id),
    ).toEqual([
      { seq: 1, type: "message_appended" },
      { seq: 2, type: "message_appended" },
      { seq: 3, type: "message_appended" },
    ]);
  });

  it("generates a fresh session id when a requested session does not exist", async () => {
    const store = createChatSessionStore({
      configDir,
      backend: "sqlite",
      storage,
      createId: createSequentialId("chat"),
      now: createSteppedClock("2026-06-06T08:00:00.000Z"),
    });

    const appended = await store.appendMessage({
      sessionId: "missing_session",
      role: "user",
      content: "new conversation",
    });

    expect(appended.session.id).toBe("chat_1");
    expect(appended.session.id).not.toBe("missing_session");
  });

  it("imports legacy JSON once, verifies parity, and leaves the source untouched", async () => {
    const legacy = createChatSessionStore({
      configDir,
      createId: createSequentialId("legacy"),
      now: createSteppedClock("2026-06-06T08:00:00.000Z"),
    });
    const created = await legacy.appendMessage({
      role: "user",
      content: "legacy message",
    });
    const jsonPath = path.join(configDir, "chat-sessions.json");
    const before = await readFile(jsonPath, "utf8");

    const sqlite = createChatSessionStore({
      configDir,
      backend: "sqlite",
      storage,
    });
    expect(await sqlite.get(created.session.id)).toEqual(created.session);
    await sqlite.appendMessage({
      sessionId: created.session.id,
      role: "assistant",
      content: "sqlite-only message",
    });
    expect(await readFile(jsonPath, "utf8")).toBe(before);

    await sqlite.delete(created.session.id);
    const restarted = createChatSessionStore({
      configDir,
      backend: "sqlite",
      storage,
    });
    expect(await restarted.get(created.session.id)).toBeNull();
  });

  it("imports the legacy corrupt-file recovery notice into SQLite", async () => {
    await writeFile(
      path.join(configDir, "chat-sessions.json"),
      "",
      "utf8",
    );
    const sqlite = createChatSessionStore({
      configDir,
      backend: "sqlite",
      storage,
    });

    await expect(sqlite.list()).resolves.toEqual([
      expect.objectContaining({
        title: "会话存储恢复通知",
        messageCount: 1,
      }),
    ]);
    expect(
      (await readdir(configDir)).some((file) =>
        file.startsWith("chat-sessions.json.corrupt-"),
      ),
    ).toBe(true);
  });
});

function createSequentialId(prefix: string): () => string {
  let next = 1;
  return () => `${prefix}_${next++}`;
}

function createSteppedClock(start: string): () => Date {
  let offset = 0;
  const startMs = new Date(start).getTime();
  return () => {
    const value = new Date(startMs + offset * 60_000);
    offset += 1;
    return value;
  };
}
