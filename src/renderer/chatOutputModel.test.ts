import { describe, expect, it } from "vitest";
import {
  outputPartFromStreamEvent,
  outputPartsFromMessage,
} from "./chatOutputModel";
import type { ChatMessageRecord, ChatStreamEvent } from "../shared/chat";

describe("chat output model", () => {
  it("falls back to a persisted markdown text part for legacy messages", () => {
    const message: ChatMessageRecord = {
      id: "m1",
      role: "assistant",
      content: "plain **markdown**",
      createdAt: "2026-06-26T00:00:00.000Z",
    };

    expect(outputPartsFromMessage(message)).toEqual([
      {
        id: "m1:text",
        type: "text",
        text: "plain **markdown**",
        format: "markdown",
        renderKey: "m1:text",
        source: "persisted",
      },
    ]);
  });

  it("keeps persisted output parts and gives each one a stable render key", () => {
    const message: ChatMessageRecord = {
      id: "m2",
      role: "assistant",
      content: "fallback should not be used",
      createdAt: "2026-06-26T00:00:00.000Z",
      outputParts: [
        {
          id: "table_1",
          type: "table",
          columns: ["Name", "Score"],
          rows: [["A", "9"]],
        },
        {
          id: "code_1",
          type: "code",
          language: "ts",
          code: "const score = 9;",
        },
      ],
    };

    expect(outputPartsFromMessage(message)).toEqual([
      {
        id: "table_1",
        type: "table",
        columns: ["Name", "Score"],
        rows: [["A", "9"]],
        renderKey: "m2:table_1",
        source: "persisted",
      },
      {
        id: "code_1",
        type: "code",
        language: "ts",
        code: "const score = 9;",
        renderKey: "m2:code_1",
        source: "persisted",
      },
    ]);
  });

  it("converts live output_part stream events into renderable parts", () => {
    const event: ChatStreamEvent = {
      type: "output_part",
      sessionId: "s1",
      requestId: "r1",
      sequence: 7,
      turnId: "turn-r1",
      createdAt: "2026-06-26T00:00:00.000Z",
      part: {
        id: "diff_1",
        type: "file_diff",
        filePath: "src/renderer/chatMarkdown.ts",
        patch: "@@ -1 +1 @@\n-old\n+new",
      },
    };

    expect(outputPartFromStreamEvent(event)).toEqual({
      id: "diff_1",
      type: "file_diff",
      filePath: "src/renderer/chatMarkdown.ts",
      patch: "@@ -1 +1 @@\n-old\n+new",
      renderKey: "r1:7:diff_1",
      source: "stream",
    });
  });

  it("ignores stream events that are not output parts", () => {
    const event: ChatStreamEvent = {
      type: "answer_delta",
      sessionId: "s1",
      requestId: "r1",
      sequence: 8,
      turnId: "turn-r1",
      createdAt: "2026-06-26T00:00:00.000Z",
      text: "hello",
    };

    expect(outputPartFromStreamEvent(event)).toBeUndefined();
  });
});
