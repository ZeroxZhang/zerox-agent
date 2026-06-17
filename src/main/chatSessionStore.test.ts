import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChatSessionStore } from "./chatSessionStore";

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

  it("quarantines corrupt chat session JSON and starts from an empty store", async () => {
    await writeFile(path.join(configDir, "chat-sessions.json"), "", "utf8");
    const store = createChatSessionStore({
      configDir,
      createId: createSequentialId("chat"),
    });

    await expect(store.list()).resolves.toEqual([]);

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

    await expect(Promise.all([store.list(), store.list(), store.list()])).resolves.toEqual([
      [],
      [],
      [],
    ]);
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
