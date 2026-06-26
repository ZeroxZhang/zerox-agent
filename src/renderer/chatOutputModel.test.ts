import { describe, expect, it } from "vitest";
import {
  outputMarkdownFromMessage,
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
      content: "Legacy answer with evidence",
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
        id: "m2:text",
        type: "text",
        text: "Legacy answer with evidence",
        format: "markdown",
        renderKey: "m2:text",
        source: "persisted",
      },
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

  it("restores mixed output formats from persisted assistant messages", () => {
    const parts = outputPartsFromMessage({
      id: "m2",
      role: "assistant",
      content: "summary",
      createdAt: "2026-06-26T00:00:00.000Z",
      outputParts: [
        { id: "text-1", type: "text", text: "summary", format: "markdown" },
        { id: "table-1", type: "table", columns: ["A"], rows: [["1"]] },
        { id: "code-1", type: "code", language: "ts", code: "const x = 1;" },
        {
          id: "ledger-1",
          type: "ledger_event",
          status: "completed",
          title: "Verified",
        },
      ],
    });

    expect(parts.map((part) => part.type)).toEqual([
      "text",
      "table",
      "code",
    ]);
    expect(parts.map((part) => part.type)).not.toContain("ledger_event");
    expect(parts.every((part) => part.source === "persisted")).toBe(true);
  });

  it("preserves legacy content without leaking tool parts into the main transcript", () => {
    const message: ChatMessageRecord = {
      id: "m3",
      role: "assistant",
      content: "Legacy answer summary",
      createdAt: "2026-06-26T00:00:00.000Z",
      outputParts: [
        {
          id: "tool_1",
          type: "tool_call",
          toolCallId: "call_1",
          toolName: "read_file",
          argsPreview: { path: "notes.md" },
        },
      ],
    };

    expect(outputPartsFromMessage(message)).toEqual([
      {
        id: "m3:text",
        type: "text",
        text: "Legacy answer summary",
        format: "markdown",
        renderKey: "m3:text",
        source: "persisted",
      },
    ]);
  });

  it("keeps tool and runtime process parts out of the main transcript", () => {
    const message: ChatMessageRecord = {
      id: "m-process",
      role: "assistant",
      content: "",
      createdAt: "2026-06-26T00:00:00.000Z",
      outputParts: [
        {
          id: "tool_call_1",
          type: "tool_call",
          toolCallId: "call_1",
          toolName: "file_read",
          argsPreview: { path: "src/app.ts" },
        },
        {
          id: "tool_result_1",
          type: "tool_result",
          toolCallId: "call_1",
          ok: true,
          resultPreview: { content: "large file contents" },
        },
        {
          id: "command_output_1",
          type: "command_output",
          command: "npm test",
          stdout: "very long output",
          stderr: "",
        },
        {
          id: "ledger_1",
          type: "ledger_event",
          status: "running",
          title: "正在调用工具",
          toolName: "file_read",
        },
        {
          id: "approval_1",
          type: "approval_request",
          approvalId: "approval_1",
          toolName: "shell_exec",
          riskLevel: "high",
        },
        {
          id: "input_1",
          type: "input_request",
          inputRequestId: "input_1",
          skillName: "report",
          reason: "Need target file",
          fields: [],
        },
      ],
    };

    expect(outputPartsFromMessage(message)).toEqual([]);
  });

  it("builds markdown for assistant messages from text and evidence parts", () => {
    const message: ChatMessageRecord = {
      id: "m4",
      role: "assistant",
      content: "Legacy summary",
      createdAt: "2026-06-26T00:00:00.000Z",
      outputParts: [
        {
          id: "answer_1",
          type: "text",
          text: "Rendered summary",
          format: "markdown",
        },
        {
          id: "table_1",
          type: "table",
          columns: ["Name", "Score"],
          rows: [["A", "9"]],
        },
        {
          id: "diff_1",
          type: "file_diff",
          filePath: "src/renderer/chatOutputModel.ts",
          patch: "@@ -1 +1 @@\n-old\n+new",
        },
        {
          id: "tool_1",
          type: "tool_call",
          toolCallId: "call_1",
          toolName: "read_file",
          argsPreview: { path: "notes.md" },
        },
      ],
    };

    const markdown = outputMarkdownFromMessage(message);

    expect(markdown).toContain("Rendered summary");
    expect(markdown).toContain("| Name | Score |");
    expect(markdown).toContain("```diff");
    expect(markdown).not.toContain("Tool call: read_file");
    expect(markdown).not.toContain("notes.md");
    expect(markdown).not.toContain("Legacy summary");
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
      renderKey: "r1:diff_1",
      source: "stream",
    });
  });

  it("keeps the same render key for repeated live updates to the same output part", () => {
    const firstEvent: ChatStreamEvent = {
      type: "output_part",
      sessionId: "s1",
      requestId: "r1",
      sequence: 7,
      turnId: "turn-r1",
      createdAt: "2026-06-26T00:00:00.000Z",
      part: {
        id: "ledger_1",
        type: "ledger_event",
        status: "running",
        title: "Checking files",
      },
    };
    const secondEvent: ChatStreamEvent = {
      ...firstEvent,
      sequence: 8,
      part: {
        id: "ledger_1",
        type: "ledger_event",
        status: "completed",
        title: "Checked files",
      },
    };

    expect(outputPartFromStreamEvent(firstEvent)?.renderKey).toBe(
      outputPartFromStreamEvent(secondEvent)?.renderKey,
    );
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
