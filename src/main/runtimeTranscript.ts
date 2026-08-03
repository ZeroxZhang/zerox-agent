import type { ChatMessage } from "./openAiCompatibleClient";
import {
  groupToolPairedMessages,
  sanitizeChatMessages,
} from "./messageIntegrity";

/**
 * Bound a runtime transcript for checkpoint persistence.
 *
 * The transcript is first repaired through the shared message-integrity
 * layer (unanswered tool calls trimmed, orphans dropped), then bounded to
 * whole tool-paired groups from the end. The historical implementation
 * silently discarded incomplete tool-call groups — losing the most recent
 * progress and, in combination with the divergent grouping rules in
 * goal-context assembly, producing provider 400 rejections on resume.
 */
export function boundRuntimeTranscript(
  messages: ChatMessage[],
  options: { maxMessages?: number; maxChars?: number } = {},
): ChatMessage[] {
  const maxMessages = options.maxMessages ?? 24;
  const maxChars = options.maxChars ?? 4_000;
  const { messages: intact } = sanitizeChatMessages(messages, {
    unresolvedToolCalls: "trim",
  });
  const groups = groupToolPairedMessages(intact);
  const kept: ChatMessage[][] = [];
  let count = 0;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]!;
    if (kept.length > 0 && count + group.length > maxMessages) break;
    kept.unshift(group);
    count += group.length;
  }
  return kept.flat().map((message) => ({
    ...message,
    content:
      message.content.length > maxChars
        ? `${message.content.slice(0, maxChars)}... [truncated]`
        : message.content,
    ...(message.tool_calls
      ? {
          tool_calls: message.tool_calls.map((call) => ({
            ...call,
            function: { ...call.function },
          })),
        }
      : {}),
  }));
}
