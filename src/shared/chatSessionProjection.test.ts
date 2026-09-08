import { describe, expect, it } from "vitest";
import type { ChatSessionRecord } from "./chat";
import { projectChatSessionForTranscript } from "./chatSessionProjection";

describe("chat session projection", () => {
  it("bounds oversized previews without dropping the process fact on reload", () => {
    const largeToolResult = { rows: Array.from({ length: 200 }, (_, index) => ({
      id: index,
      value: "x".repeat(1_000),
    })) };
    const session: ChatSessionRecord = {
      id: "session_1",
      title: "Large output",
      summary: "Large output",
      createdAt: "2026-06-26T00:00:00.000Z",
      updatedAt: "2026-06-26T00:00:00.000Z",
      messages: [
        {
          id: "message_1",
          role: "assistant",
          content: "Done",
          createdAt: "2026-06-26T00:00:00.000Z",
          outputParts: [
            {
              id: "text_1",
              type: "text",
              text: "Done",
              format: "markdown",
            },
            {
              id: "tool_result_1",
              type: "tool_result",
              toolCallId: "call_1",
              ok: true,
              resultPreview: largeToolResult,
            },
            {
              id: "command_output_1",
              type: "command_output",
              command: "cat huge.json",
              stdout: "x".repeat(80_000),
              stderr: "",
              exitCode: 0,
            },
          ],
        },
      ],
    };

    const projected = projectChatSessionForTranscript(session);

    // LD03/LD04: process facts survive the read path; only their unbounded
    // preview payloads are replaced by a marker.
    const parts = projected.messages[0].outputParts ?? [];
    expect(parts.map((part) => part.type)).toEqual([
      "text",
      "tool_result",
      "command_output",
    ]);
    const toolResult = parts.find((part) => part.type === "tool_result");
    expect(toolResult).toMatchObject({
      type: "tool_result",
      toolCallId: "call_1",
      ok: true,
      resultPreview: "[已省略：内容过大，请查看证据]",
    });
    const commandOutput = parts.find((part) => part.type === "command_output");
    expect(commandOutput?.type === "command_output"
      ? commandOutput.stdout.length <= 2_048 + 64
      : false).toBe(true);
    expect(JSON.stringify(projected).length).toBeLessThan(
      JSON.stringify(session).length / 20,
    );
  });

  it("keeps a process-only message readable after reload", () => {
    const session: ChatSessionRecord = {
      id: "session_1",
      title: "Only tool detail",
      summary: "Only tool detail",
      createdAt: "2026-06-26T00:00:00.000Z",
      updatedAt: "2026-06-26T00:00:00.000Z",
      messages: [
        {
          id: "message_1",
          role: "assistant",
          content: "See tool result.",
          createdAt: "2026-06-26T00:00:00.000Z",
          outputParts: [
            {
              id: "tool_result_1",
              type: "tool_result",
              toolCallId: "call_1",
              ok: true,
              resultPreview: { huge: "x".repeat(10_000) },
            },
          ],
        },
      ],
    };

    const parts = projectChatSessionForTranscript(session).messages[0].outputParts;
    expect(parts?.map((part) => part.type)).toEqual(["tool_result"]);
    expect(parts?.[0]).toMatchObject({
      resultPreview: "[已省略：内容过大，请查看证据]",
    });
  });
});

describe("LD02 reasoning transcript survival", () => {
  it("keeps the bounded reasoning part so a reloaded session still holds the fact", () => {
    const session: ChatSessionRecord = {
      id: "session_reasoning",
      title: "Reasoning",
      summary: "Reasoning",
      createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T00:00:00.000Z",
      messages: [
        {
          id: "message_reasoning",
          role: "assistant",
          content: "Answer.",
          createdAt: "2026-09-08T00:00:00.000Z",
          outputParts: [
            {
              id: "reasoning_1",
              type: "reasoning",
              text: "redacted reasoning summary",
              redacted: true,
              truncated: false,
              streaming: false,
            },
            {
              id: "text_1",
              type: "text",
              text: "Answer.",
              format: "markdown",
            },
            {
              id: "tool_result_1",
              type: "tool_result",
              toolCallId: "call_1",
              ok: true,
              resultPreview: { files: ["README.md"] },
            },
          ],
        },
      ],
    };

    const projected = projectChatSessionForTranscript(session).messages[0];
    expect(projected?.outputParts?.map((part) => part.type)).toEqual([
      "reasoning",
      "text",
      "tool_result",
    ]);
  });
});
