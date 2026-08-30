import type { ChatMessage, ToolCall } from "./openAiCompatibleClient";
import type { ContextSurfaceState } from "../shared/contextSurface";
import {
  redactCredentialJsonText,
  redactCredentialString,
  redactCredentials,
  stringifyRedactedCredentials,
} from "../shared/credentialRedaction";

/**
 * Message-sequence integrity layer.
 *
 * Single source of truth for the provider-side conversation invariant:
 *
 *   1. Every `assistant.tool_calls[*].id` MUST be answered by a following
 *      `tool` message with the matching `tool_call_id`, with no non-tool
 *      message in between.
 *   2. Every `tool` message MUST answer a tool_call of the nearest preceding
 *      assistant message that is still unanswered.
 *   3. No empty assistant messages (no content, no tool calls).
 *   4. No duplicated consecutive assistant messages (retry artifacts).
 *
 * Historically four different modules (context compaction, runtime
 * transcript bounding, goal-context assembly, loop trimming) each mutated
 * the conversation with their own pair-preservation rules. Their
 * inconsistencies produced provider HTTP 400 rejections
 * ("assistant message with 'tool_calls' must be followed by tool messages"
 * / "role 'tool' must be a response to a preceding message with
 * 'tool_calls'"), which were then persisted into checkpoints and replayed on
 * every resume — identical failure storms no retry could escape.
 *
 * Every boundary that persists, resumes, compresses, or submits a
 * conversation to a provider routes through `sanitizeChatMessages` so the
 * invariant holds everywhere by construction instead of by convention.
 */

export type MessageIntegrityRepairKind =
  /** tool responses synthesized for tool_calls that had no answer. */
  | "synthesized_tool_result"
  /** tool_calls removed from an assistant message because no answer exists. */
  | "trimmed_unanswered_tool_calls"
  /** orphan tool message dropped (no matching preceding tool_call). */
  | "dropped_orphan_tool_message"
  /** empty assistant message (no content, no tool_calls) dropped. */
  | "dropped_empty_assistant"
  /** consecutive duplicate assistant message dropped. */
  | "dropped_duplicate_assistant"
  /** injected runtime system message (reminder/finalize/recovery) dropped. */
  | "dropped_injected_system";

export type MessageIntegrityRepair = {
  kind: MessageIntegrityRepairKind;
  index: number;
  detail: string;
};

export type SanitizeChatMessagesOptions = {
  /**
   * How to repair assistant tool_calls that have no answering tool message.
   * - "synthesize": append an explicit error tool result so the model keeps
   *   visibility that the call was interrupted (preferred before a model
   *   request, preserves evidence).
   * - "trim": remove the unanswered tool_calls from the assistant message
   *   (preferred when persisting, so replayed history never re-triggers the
   *   same dead call).
   * Defaults to "synthesize".
   */
  unresolvedToolCalls?: "synthesize" | "trim";
  /**
   * When true, drop system messages that were injected mid-conversation by
   * the runtime (strategy guards, finalize prompts, recovery prompts,
   * resume directives). Used when persisting checkpoints so injected
   * prompts do not accumulate across resume cycles. The leading system
   * prompt and genuine goal anchors are always kept.
   */
  stripInjectedSystemMessages?: boolean;
};

export type SanitizeChatMessagesResult = {
  messages: ChatMessage[];
  repairs: MessageIntegrityRepair[];
};

const SYNTHESIZED_TOOL_RESULT_PREFIX = "tool_result_unavailable";

/**
 * Prefixes that identify runtime-injected system messages. These are
 * ephemeral steering prompts; persisting them into checkpoints makes every
 * resume cycle re-send an ever-growing stack of stale instructions.
 */
const INJECTED_SYSTEM_PREFIXES = [
  "Strategy guard warning (",
  "检测到模型重复请求相同工具",
  "连续 ",
  "Resume directly from the latest real message/tool result.",
];

export function isInjectedRuntimeSystemMessage(message: ChatMessage): boolean {
  if (message.role !== "system") return false;
  const content = message.content ?? "";
  return INJECTED_SYSTEM_PREFIXES.some((prefix) => content.startsWith(prefix));
}

/**
 * Repair a conversation so it satisfies the provider message-sequence
 * invariant. Pure: never mutates the input messages; returns cloned
 * messages when any repair is required (and the original references when
 * nothing changed).
 */
export function sanitizeChatMessages(
  input: readonly ChatMessage[],
  options: SanitizeChatMessagesOptions = {},
): SanitizeChatMessagesResult {
  const unresolved = options.unresolvedToolCalls ?? "synthesize";
  const repairs: MessageIntegrityRepair[] = [];
  const output: ChatMessage[] = [];

  /** tool_call ids of the current open assistant batch, in order. */
  let openToolCallIds: string[] = [];
  /** index in `output` of the assistant message that opened the batch. */
  let openAssistantIndex = -1;

  const closeOpenBatch = (atIndex: number) => {
    if (openToolCallIds.length === 0 || openAssistantIndex < 0) {
      openToolCallIds = [];
      openAssistantIndex = -1;
      return;
    }
    const assistant = output[openAssistantIndex]!;
    if (unresolved === "trim") {
      const kept = (assistant.tool_calls ?? []).filter(
        (call) => !openToolCallIds.includes(call.id),
      );
      repairs.push({
        kind: "trimmed_unanswered_tool_calls",
        index: openAssistantIndex,
        detail: `Removed ${openToolCallIds.length} unanswered tool_call(s): ${openToolCallIds.join(", ")}`,
      });
      if (kept.length > 0) {
        output[openAssistantIndex] = { ...assistant, tool_calls: kept };
      } else if (assistant.content.trim()) {
        const clone = { ...assistant };
        delete clone.tool_calls;
        output[openAssistantIndex] = clone;
      } else {
        output.splice(openAssistantIndex, 1);
        repairs.push({
          kind: "dropped_empty_assistant",
          index: openAssistantIndex,
          detail: "Assistant message became empty after trimming tool_calls.",
        });
      }
    } else {
      for (const toolCall of assistant.tool_calls ?? []) {
        if (!openToolCallIds.includes(toolCall.id)) continue;
        output.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            type: "tool_result",
            tool: toolCall.function.name,
            ok: false,
            error:
              "Tool execution was interrupted before a result was recorded. Do not retry this exact call blindly; reassess the task state first.",
            [SYNTHESIZED_TOOL_RESULT_PREFIX]: true,
          }),
        });
        repairs.push({
          kind: "synthesized_tool_result",
          index: atIndex,
          detail: `Synthesized missing tool result for ${toolCall.function.name} (${toolCall.id}).`,
        });
      }
    }
    openToolCallIds = [];
    openAssistantIndex = -1;
  };

  for (let index = 0; index < input.length; index += 1) {
    const message = redactChatMessageCredentials(input[index]!);

    if (message.role === "tool") {
      const matching = openToolCallIds.indexOf(message.tool_call_id ?? "");
      if (openToolCallIds.length === 0 || matching < 0) {
        repairs.push({
          kind: "dropped_orphan_tool_message",
          index,
          detail: `Tool message answered no open tool_call (tool_call_id=${message.tool_call_id ?? "none"}).`,
        });
        continue;
      }
      output.push(message);
      openToolCallIds.splice(matching, 1);
      continue;
    }

    // Any non-tool message closes the previous open tool-call batch.
    closeOpenBatch(index);

    if (
      options.stripInjectedSystemMessages &&
      isInjectedRuntimeSystemMessage(message) &&
      // Keep the very first system message (the real system prompt) even if
      // it happens to match a prefix.
      output.some((candidate) => candidate.role === "system")
    ) {
      repairs.push({
        kind: "dropped_injected_system",
        index,
        detail: message.content.slice(0, 60),
      });
      continue;
    }

    if (
      message.role === "assistant" &&
      !(message.content ?? "").trim() &&
      !(message.tool_calls?.length)
    ) {
      repairs.push({
        kind: "dropped_empty_assistant",
        index,
        detail: "Assistant message had neither content nor tool_calls.",
      });
      continue;
    }

    if (message.role === "assistant") {
      const previous = output.at(-1);
      if (
        previous &&
        previous.role === "assistant" &&
        !previous.tool_calls?.length &&
        !message.tool_calls?.length &&
        previous.content === message.content
      ) {
        repairs.push({
          kind: "dropped_duplicate_assistant",
          index,
          detail: "Identical consecutive assistant message.",
        });
        continue;
      }
    }

    output.push(message);

    if (message.role === "assistant" && message.tool_calls?.length) {
      openToolCallIds = message.tool_calls.map((call) => call.id);
      openAssistantIndex = output.length - 1;
    }
  }

  closeOpenBatch(input.length);

  return { messages: output, repairs };
}

export function redactChatMessageCredentials(message: ChatMessage): ChatMessage {
  const redacted = redactCredentials(message) as ChatMessage;
  const safeContent = message.role === "tool"
    ? redactToolMessageContent(message.content)
    : redacted.content;
  if (!message.tool_calls?.length) {
    return { ...redacted, content: safeContent };
  }
  return {
    ...redacted,
    content: safeContent,
    tool_calls: message.tool_calls.map((toolCall) => ({
      ...toolCall,
      function: {
        ...toolCall.function,
        arguments: redactCredentialJsonText(toolCall.function.arguments),
      },
    })),
  };
}

function redactToolMessageContent(content: string): string {
  const fenced = content.match(
    /^(<tool_result\b[^>]*>\s*)([\s\S]*?)(\s*<\/tool_result>\s*)$/i,
  );
  if (fenced) {
    try {
      return `${fenced[1]}${stringifyRedactedCredentials(
        JSON.parse(fenced[2] ?? "null"),
      )}${fenced[3]}`;
    } catch {
      return `${fenced[1]}{"redacted":"invalid_tool_result"}${fenced[3]}`;
    }
  }
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return stringifyRedactedCredentials(JSON.parse(content));
    } catch {
      return '{"redacted":"invalid_tool_result"}';
    }
  }
  return redactCredentialString(content);
}

export function redactChatMessagesCredentials(
  messages: readonly ChatMessage[],
): ChatMessage[] {
  return messages.map(redactChatMessageCredentials);
}

export function redactContextSurfaceCredentials(
  state: ContextSurfaceState,
): ContextSurfaceState {
  return {
    ...state,
    events: state.events.map((event) =>
      event.kind === "source"
        ? {
            ...event,
            message: redactChatMessageCredentials(
              event.message as ChatMessage,
            ),
          }
        : {
            ...event,
            replacementNodes: event.replacementNodes.map((node) => ({
              ...node,
              message: redactChatMessageCredentials(
                node.message as ChatMessage,
              ),
            })),
          },
    ),
  };
}

export type MessageSequenceIssue = {
  kind:
    | "unanswered_tool_calls"
    | "orphan_tool_message"
    | "empty_assistant"
    | "duplicate_assistant";
  index: number;
  detail: string;
};

/**
 * Read-only diagnostic used by tests, trajectory analysis, and failure
 * fingerprinting. Returns every invariant violation without repairing.
 */
export function inspectChatMessages(
  input: readonly ChatMessage[],
): MessageSequenceIssue[] {
  const issues: MessageSequenceIssue[] = [];
  const open = new Map<string, number>();
  let openAssistantIndex = -1;

  for (let index = 0; index < input.length; index += 1) {
    const message = input[index]!;
    if (message.role === "tool") {
      if (!open.delete(message.tool_call_id ?? "")) {
        issues.push({
          kind: "orphan_tool_message",
          index,
          detail: `tool_call_id=${message.tool_call_id ?? "none"}`,
        });
      }
      continue;
    }
    if (open.size > 0) {
      issues.push({
        kind: "unanswered_tool_calls",
        index: openAssistantIndex,
        detail: [...open.keys()].join(", "),
      });
      open.clear();
    }
    if (
      message.role === "assistant" &&
      !(message.content ?? "").trim() &&
      !(message.tool_calls?.length)
    ) {
      issues.push({ kind: "empty_assistant", index, detail: "" });
    }
    if (message.role === "assistant" && message.tool_calls?.length) {
      for (const call of message.tool_calls) open.set(call.id, index);
      openAssistantIndex = index;
    }
  }
  if (open.size > 0) {
    issues.push({
      kind: "unanswered_tool_calls",
      index: openAssistantIndex,
      detail: [...open.keys()].join(", "),
    });
  }
  return issues;
}

/**
 * True when a provider error is the message-sequence rejection class — the
 * failure this module exists to prevent and to fingerprint for resume
 * circuit-breaking.
 */
export function isMessageSequenceProviderError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : String(error ?? "");
  return (
    /tool_calls['’]? must be followed by tool messages/i.test(message) ||
    /role ['’]?tool['’]? must be a response to a preceding message/i.test(
      message,
    ) ||
    /messages with role .tool. must be a response/i.test(message) ||
    /tool_call_id/i.test(message) && /must be followed|preceding/i.test(message)
  );
}

/**
 * Group a conversation into atomic units that must never be separated:
 * an assistant message with tool_calls plus its answering tool messages.
 * Unlike the historical implementations this NEVER drops messages —
 * incomplete pairs are repaired by the caller via sanitizeChatMessages.
 */
export function groupToolPairedMessages(
  messages: readonly ChatMessage[],
): ChatMessage[][] {
  const groups: ChatMessage[][] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role !== "assistant" || !message.tool_calls?.length) {
      groups.push([message]);
      continue;
    }
    const ids = new Set(message.tool_calls.map((call) => call.id));
    const group = [message];
    while (
      index + 1 < messages.length &&
      messages[index + 1]?.role === "tool" &&
      ids.has(messages[index + 1]?.tool_call_id ?? "")
    ) {
      index += 1;
      group.push(messages[index]!);
    }
    groups.push(group);
  }
  return groups;
}

/** Deep-clone a message so persistence never shares mutable references. */
export function cloneChatMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    ...(message.tool_calls
      ? {
          tool_calls: message.tool_calls.map((call: ToolCall) => ({
            ...call,
            function: { ...call.function },
          })),
        }
      : {}),
  };
}
