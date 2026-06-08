import { describe, expect, it } from "vitest";
import { extractAtomicMemoriesFromChatTurn } from "./memoryL1Extractor";

describe("memory L1 extractor", () => {
  it("extracts a semantic preference atom from high-signal chat turns", () => {
    expect(
      extractAtomicMemoriesFromChatTurn({
        sessionId: "chat_1",
        userMessageId: "msg_user",
        assistantMessageId: "msg_assistant",
        userMessage: "以后默认把报告保存成 Markdown",
        assistantReply: "好的，我会记住这个偏好。",
      }),
    ).toEqual([
      {
        kind: "semantic",
        title: "用户偏好：以后默认把报告保存成 Markdown",
        content: "以后默认把报告保存成 Markdown",
        tags: ["l1", "chat", "preference"],
        source: {
          type: "chat_session",
          sessionId: "chat_1",
          messageIds: ["msg_user", "msg_assistant"],
        },
        importance: 4,
      },
    ]);
  });

  it("does not extract atomic memories from ordinary task requests", () => {
    expect(
      extractAtomicMemoriesFromChatTurn({
        sessionId: "chat_1",
        userMessageId: "msg_user",
        assistantMessageId: "msg_assistant",
        userMessage: "帮我整理下载文件夹",
        assistantReply: "我会先检查任务。",
      }),
    ).toEqual([]);
  });

  it("truncates long preference titles while keeping full content", () => {
    const userMessage =
      "请记住以后默认把所有项目复盘报告保存成 Markdown，并且标题里包含日期和项目名称";

    expect(
      extractAtomicMemoriesFromChatTurn({
        sessionId: "chat_1",
        userMessageId: "msg_user",
        assistantMessageId: null,
        userMessage,
        assistantReply: "",
      })[0],
    ).toMatchObject({
      title: "用户偏好：请记住以后默认把所有项目复盘报告保存成 Markdown，并且标题里包…",
      content: userMessage,
      source: {
        type: "chat_session",
        sessionId: "chat_1",
        messageIds: ["msg_user"],
      },
    });
  });
});
