import { describe, expect, it } from "vitest";
import { createContextManager } from "./contextManager";
import type { ChatMessage } from "./openAiCompatibleClient";

describe("context manager", () => {
  it("compresses older turns into a summary while preserving recent turns", () => {
    const manager = createContextManager({ maxTokens: 80, recentTurnsToKeep: 1 });
    const messages: ChatMessage[] = [
      { role: "system", content: "System instructions stay." },
      { role: "user", content: "Older request " + "a".repeat(120) },
      { role: "assistant", content: "Older answer " + "b".repeat(120) },
      { role: "user", content: "Recent request" },
      { role: "assistant", content: "Recent answer" },
    ];

    const compressed = manager.compressMessages(messages, 80);

    expect(compressed).toEqual([
      { role: "system", content: "System instructions stay." },
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("[之前对话摘要]"),
      }),
      { role: "user", content: "Recent request" },
      { role: "assistant", content: "Recent answer" },
    ]);
    expect(compressed.length).toBeLessThan(messages.length);
  });

  it("preserves every assistant tool-call message with its matching tool result", () => {
    const manager = createContextManager({ maxTokens: 40, recentTurnsToKeep: 3 });
    const messages: ChatMessage[] = [
      { role: "system", content: "System" },
      { role: "user", content: "Inspect and then test the project" },
      {
        role: "assistant",
        content: "",
        tool_calls: [createToolCall("call_1", "file_read")],
      },
      { role: "tool", tool_call_id: "call_1", content: '{"ok":true}' },
      {
        role: "assistant",
        content: "",
        tool_calls: [createToolCall("call_2", "shell_exec")],
      },
      { role: "tool", tool_call_id: "call_2", content: '{"ok":true}' },
      { role: "assistant", content: "Done" },
    ];

    const compressed = manager.compressMessages(messages, 40);

    expect(compressed.filter((message) => message.role === "assistant")).toHaveLength(3);
    for (const toolResult of compressed.filter((message) => message.role === "tool")) {
      expect(
        compressed.some((message) =>
          message.tool_calls?.some((call) => call.id === toolResult.tool_call_id),
        ),
      ).toBe(true);
    }
  });
});

function createToolCall(id: string, name: string) {
  return {
    id,
    type: "function" as const,
    function: { name, arguments: "{}" },
  };
}
