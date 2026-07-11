import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./openAiCompatibleClient";
import { boundRuntimeTranscript } from "./runtimeTranscript";

describe("runtime transcript bounds", () => {
  it("keeps a large tool-call/result batch atomic beyond message and call caps", () => {
    const toolCalls = Array.from({ length: 26 }, (_, index) => ({
      id: `call_${index}`,
      type: "function" as const,
      function: { name: "file_read", arguments: "{}" },
    }));
    const messages: ChatMessage[] = [
      { role: "user", content: "old" },
      { role: "assistant", content: "", tool_calls: toolCalls },
      ...toolCalls.map((call) => ({
        role: "tool" as const,
        tool_call_id: call.id,
        content: '{"ok":true}',
      })),
    ];
    const bounded = boundRuntimeTranscript(messages, { maxMessages: 24 });
    expect(bounded).toHaveLength(27);
    expect(bounded[0]?.tool_calls).toHaveLength(26);
    expect(bounded.slice(1).map((message) => message.tool_call_id)).toEqual(
      toolCalls.map((call) => call.id),
    );
  });
});
