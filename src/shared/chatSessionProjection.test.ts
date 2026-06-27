import { describe, expect, it } from "vitest";
import type { ChatSessionRecord } from "./chat";
import { projectChatSessionForTranscript } from "./chatSessionProjection";

describe("chat session projection", () => {
  it("drops non-transcript output parts before a persisted session is sent to the renderer", () => {
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

    expect(projected.messages[0].outputParts).toEqual([
      {
        id: "text_1",
        type: "text",
        text: "Done",
        format: "markdown",
      },
    ]);
    expect(JSON.stringify(projected).length).toBeLessThan(
      JSON.stringify(session).length / 20,
    );
  });

  it("removes outputParts entirely when no transcript part remains", () => {
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

    expect(projectChatSessionForTranscript(session).messages[0]).not.toHaveProperty(
      "outputParts",
    );
  });
});
