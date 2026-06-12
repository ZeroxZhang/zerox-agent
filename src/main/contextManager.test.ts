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
});
