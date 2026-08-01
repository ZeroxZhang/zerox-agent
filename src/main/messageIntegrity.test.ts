import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./openAiCompatibleClient";
import {
  groupToolPairedMessages,
  inspectChatMessages,
  isInjectedRuntimeSystemMessage,
  isMessageSequenceProviderError,
  sanitizeChatMessages,
} from "./messageIntegrity";

function assistantWithToolCalls(
  ids: string[],
  content = "",
): ChatMessage {
  return {
    role: "assistant",
    content,
    tool_calls: ids.map((id) => ({
      id,
      type: "function" as const,
      function: { name: `tool_${id}`, arguments: "{}" },
    })),
  };
}

function toolMessage(id: string, content = "{}"): ChatMessage {
  return { role: "tool", tool_call_id: id, content };
}

describe("sanitizeChatMessages", () => {
  it("keeps a well-formed conversation untouched", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      assistantWithToolCalls(["a", "b"]),
      toolMessage("a"),
      toolMessage("b"),
      { role: "assistant", content: "done" },
    ];
    const result = sanitizeChatMessages(messages);
    expect(result.repairs).toEqual([]);
    expect(result.messages).toHaveLength(messages.length);
  });

  it("synthesizes missing tool results for unanswered tool_calls", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
      assistantWithToolCalls(["a", "b"]),
      toolMessage("a"),
      // tool b never answered; then the run was interrupted
    ];
    const result = sanitizeChatMessages(messages);
    expect(result.messages).toHaveLength(4);
    const synthesized = result.messages.at(-1)!;
    expect(synthesized.role).toBe("tool");
    expect(synthesized.tool_call_id).toBe("b");
    expect(JSON.parse(synthesized.content).ok).toBe(false);
    expect(
      result.repairs.some((r) => r.kind === "synthesized_tool_result"),
    ).toBe(true);
    expect(inspectChatMessages(result.messages)).toEqual([]);
  });

  it("synthesizes answers when a non-tool message interrupts a tool batch", () => {
    const messages: ChatMessage[] = [
      assistantWithToolCalls(["a", "b"]),
      toolMessage("a"),
      { role: "system", content: "Resume directly from the latest real message/tool result." },
      { role: "user", content: "milestone instruction" },
    ];
    const result = sanitizeChatMessages(messages);
    expect(inspectChatMessages(result.messages)).toEqual([]);
    // synthesized tool result for b sits between tool(a) and the system message
    expect(result.messages[2]).toMatchObject({ role: "tool", tool_call_id: "b" });
  });

  it("trims unanswered tool_calls when persisting", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
      assistantWithToolCalls(["a", "b"], "working"),
      toolMessage("a"),
    ];
    const result = sanitizeChatMessages(messages, {
      unresolvedToolCalls: "trim",
    });
    const assistant = result.messages[1]!;
    expect(assistant.tool_calls).toHaveLength(1);
    expect(assistant.tool_calls![0]!.id).toBe("a");
    expect(inspectChatMessages(result.messages)).toEqual([]);
  });

  it("drops an assistant message that becomes empty after trimming", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
      assistantWithToolCalls(["a"]),
    ];
    const result = sanitizeChatMessages(messages, {
      unresolvedToolCalls: "trim",
    });
    expect(result.messages).toHaveLength(1);
    expect(
      result.repairs.some((r) => r.kind === "dropped_empty_assistant"),
    ).toBe(true);
  });

  it("drops orphan tool messages", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
      toolMessage("ghost"),
      { role: "assistant", content: "ok" },
    ];
    const result = sanitizeChatMessages(messages);
    expect(result.messages).toHaveLength(2);
    expect(
      result.repairs.some((r) => r.kind === "dropped_orphan_tool_message"),
    ).toBe(true);
    expect(inspectChatMessages(result.messages)).toEqual([]);
  });

  it("drops empty assistant messages", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
      { role: "assistant", content: "  " },
      { role: "assistant", content: "real answer" },
    ];
    const result = sanitizeChatMessages(messages);
    expect(result.messages).toHaveLength(2);
  });

  it("drops consecutive duplicate assistant messages", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: "same" },
      { role: "assistant", content: "same" },
    ];
    const result = sanitizeChatMessages(messages);
    expect(result.messages).toHaveLength(1);
    expect(
      result.repairs.some((r) => r.kind === "dropped_duplicate_assistant"),
    ).toBe(true);
  });

  it("strips injected runtime system messages but keeps the leading prompt and anchors", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are the agent." },
      { role: "system", content: "Strategy guard warning (FRAGMENTED_TOOL_CALLS): ..." },
      { role: "user", content: "go" },
      { role: "system", content: "Resume directly from the latest real message/tool result. Do not recap." },
      { role: "assistant", content: "ok" },
    ];
    const result = sanitizeChatMessages(messages, {
      stripInjectedSystemMessages: true,
    });
    expect(result.messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
    ]);
    expect(result.messages[0]!.content).toBe("You are the agent.");
  });

  it("is idempotent", () => {
    const messages: ChatMessage[] = [
      assistantWithToolCalls(["a", "b"]),
      toolMessage("a"),
      toolMessage("ghost"),
      { role: "assistant", content: "" },
    ];
    const once = sanitizeChatMessages(messages);
    const twice = sanitizeChatMessages(once.messages);
    expect(twice.repairs).toEqual([]);
    expect(twice.messages).toEqual(once.messages);
  });

  it("never mutates the input", () => {
    const assistant = assistantWithToolCalls(["a"]);
    const messages: ChatMessage[] = [assistant];
    sanitizeChatMessages(messages, { unresolvedToolCalls: "trim" });
    expect(assistant.tool_calls).toHaveLength(1);
    expect(messages).toHaveLength(1);
  });
});

describe("inspectChatMessages", () => {
  it("reports unanswered tool_calls and orphan tools", () => {
    const issues = inspectChatMessages([
      assistantWithToolCalls(["a", "b"]),
      toolMessage("a"),
      toolMessage("ghost"),
      { role: "user", content: "x" },
    ]);
    expect(issues.map((i) => i.kind).sort()).toEqual([
      "orphan_tool_message",
      "unanswered_tool_calls",
    ]);
  });
});

describe("isMessageSequenceProviderError", () => {
  it("matches the observed provider rejections", () => {
    expect(
      isMessageSequenceProviderError(
        new Error(
          "LLM request failed with status 400: An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'.",
        ),
      ),
    ).toBe(true);
    expect(
      isMessageSequenceProviderError(
        new Error(
          "LLM request failed with status 400: Messages with role 'tool' must be a response to a preceding message with 'tool_calls'",
        ),
      ),
    ).toBe(true);
    expect(isMessageSequenceProviderError(new Error("HTTP 500"))).toBe(false);
  });
});

describe("groupToolPairedMessages", () => {
  it("groups complete and incomplete pairs without dropping anything", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "go" },
      assistantWithToolCalls(["a", "b"]),
      toolMessage("a"),
      toolMessage("b"),
      assistantWithToolCalls(["c"]),
    ];
    const groups = groupToolPairedMessages(messages);
    expect(groups.map((g) => g.length)).toEqual([1, 3, 1]);
    expect(groups.flat()).toHaveLength(messages.length);
  });
});

describe("isInjectedRuntimeSystemMessage", () => {
  it("detects strategy guard and resume injections", () => {
    expect(
      isInjectedRuntimeSystemMessage({
        role: "system",
        content: "Strategy guard warning (FRAGMENTED_TOOL_CALLS): x",
      }),
    ).toBe(true);
    expect(
      isInjectedRuntimeSystemMessage({ role: "system", content: "You are..." }),
    ).toBe(false);
    expect(
      isInjectedRuntimeSystemMessage({ role: "user", content: "Strategy guard warning (" }),
    ).toBe(false);
  });
});
