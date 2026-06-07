import { mkdtemp, readFile, rm } from "node:fs/promises";
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

  it("creates a session from the first user message and persists messages", async () => {
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
      title: "帮我整理下载文件夹，并生成报告",
      summary: "帮我整理下载文件夹，并生成报告",
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
        title: "帮我整理下载文件夹，并生成报告",
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
