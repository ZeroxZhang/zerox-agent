import type { ChatMessage } from "./openAiCompatibleClient";

export function boundRuntimeTranscript(
  messages: ChatMessage[],
  options: { maxMessages?: number; maxChars?: number } = {},
): ChatMessage[] {
  const maxMessages = options.maxMessages ?? 24;
  const maxChars = options.maxChars ?? 4_000;
  const groups = groupToolPairedMessages(messages);
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

function groupToolPairedMessages(messages: ChatMessage[]): ChatMessage[][] {
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
    if (group.length === message.tool_calls.length + 1) groups.push(group);
  }
  return groups;
}
