import { describe, expect, it } from "vitest";
import { buildCheckpointBoundaryMessages } from "./contextBoundary";
import type { ChatMessage } from "./openAiCompatibleClient";

describe("context boundary rebuild", () => {
  it("injects a synthetic checkpoint boundary while preserving protected skill tool pairs", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "old request" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_skill_load",
            type: "function",
            function: { name: "skill_load", arguments: '{"skillName":"onepager"}' },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_skill_load",
        name: "skill_load",
        content: "onepager instruction body",
      },
      { role: "user", content: "recent request" },
      { role: "assistant", content: "recent answer" },
    ];

    const rebuilt = buildCheckpointBoundaryMessages({
      checkpointId: "checkpoint_1",
      checkpointSummary: "The run loaded onepager and answered the recent request.",
      messages,
      tailCount: 1,
      protectedToolNames: ["skill_load"],
      createdAt: "2026-06-25T00:00:00.000Z",
    });

    expect(rebuilt).toEqual([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("checkpoint_1"),
      }),
      messages[1],
      messages[2],
      messages[4],
    ]);
    expect(rebuilt.map((message) => message.content)).not.toContain("old request");
  });

  it("microcompacts unprotected large tool results without advertising missing refs", () => {
    const rebuilt = buildCheckpointBoundaryMessages({
      checkpointId: "checkpoint_1",
      checkpointSummary: "Large tool result was offloaded.",
      messages: [
        {
          role: "tool",
          tool_call_id: "call_file_read",
          name: "file_read",
          content: "x".repeat(120),
        },
      ],
      tailCount: 1,
      protectedToolNames: [],
      toolResultCompactThreshold: 80,
      createdAt: "2026-06-25T00:00:00.000Z",
    });

    expect(rebuilt[1]).toEqual({
      role: "tool",
      tool_call_id: "call_file_read",
      name: "file_read",
      content:
        "[tool result compacted: file_read call_file_read, 120 bytes; original result remains in the local checkpoint transcript]",
    });
  });

  it("preserves tool call pairs when the retained tail starts at a tool result", () => {
    const assistantCall: ChatMessage = {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call_file_read",
          type: "function",
          function: { name: "file_read", arguments: '{"path":"README.md"}' },
        },
      ],
    };
    const toolResult: ChatMessage = {
      role: "tool",
      tool_call_id: "call_file_read",
      name: "file_read",
      content: "README content",
    };

    const rebuilt = buildCheckpointBoundaryMessages({
      checkpointId: "checkpoint_1",
      checkpointSummary: "Tail retained a file read result.",
      messages: [
        { role: "user", content: "old request" },
        assistantCall,
        toolResult,
      ],
      tailCount: 1,
      protectedToolNames: [],
      createdAt: "2026-06-25T00:00:00.000Z",
    });

    expect(rebuilt).toEqual([
      expect.objectContaining({ role: "system" }),
      assistantCall,
      toolResult,
    ]);
  });
});
