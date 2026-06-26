import type { ChatMessage } from "./openAiCompatibleClient";

export type BuildCheckpointBoundaryMessagesOptions = {
  checkpointId: string;
  checkpointSummary: string;
  messages: ChatMessage[];
  tailCount: number;
  protectedToolNames: string[];
  toolResultRefs?: Record<string, string>;
  toolResultCompactThreshold?: number;
  createdAt: string;
};

export function buildCheckpointBoundaryMessages(
  options: BuildCheckpointBoundaryMessagesOptions,
): ChatMessage[] {
  const boundary: ChatMessage = {
    role: "system",
    content: [
      `Checkpoint boundary: ${options.checkpointId}`,
      `Created at: ${options.createdAt}`,
      "The original transcript remains stored locally; this synthetic boundary rebuilds the active context.",
      "",
      options.checkpointSummary,
    ].join("\n"),
  };
  const preservedIndexes = new Set<number>();

  for (const index of findProtectedToolPairIndexes(
    options.messages,
    new Set(options.protectedToolNames),
  )) {
    preservedIndexes.add(index);
  }

  const tailStart = Math.max(0, options.messages.length - options.tailCount);
  for (let index = tailStart; index < options.messages.length; index += 1) {
    preservedIndexes.add(index);
  }
  completeToolPairIndexes(options.messages, preservedIndexes);

  return [
    boundary,
    ...[...preservedIndexes]
      .sort((left, right) => left - right)
      .map((index) =>
        microcompactToolResult(options.messages[index], {
          threshold: options.toolResultCompactThreshold ?? 8_000,
          protectedToolNames: new Set(options.protectedToolNames),
          toolResultRefs: options.toolResultRefs ?? {},
        }),
      ),
  ];
}

function findProtectedToolPairIndexes(
  messages: ChatMessage[],
  protectedToolNames: Set<string>,
): number[] {
  const protectedToolCallIds = new Set<string>();
  const indexes: number[] = [];

  for (const [index, message] of messages.entries()) {
    const protectedCalls = (message.tool_calls ?? []).filter((toolCall) =>
      protectedToolNames.has(toolCall.function.name),
    );
    if (!protectedCalls.length) {
      continue;
    }
    indexes.push(index);
    for (const call of protectedCalls) {
      protectedToolCallIds.add(call.id);
    }
  }

  for (const [index, message] of messages.entries()) {
    if (message.role === "tool" && message.tool_call_id && protectedToolCallIds.has(message.tool_call_id)) {
      indexes.push(index);
    }
  }

  return indexes;
}

function completeToolPairIndexes(messages: ChatMessage[], preservedIndexes: Set<number>) {
  const toolCallIndexes = new Map<string, number>();
  const toolResultIndexes = new Map<string, number>();

  for (const [index, message] of messages.entries()) {
    for (const toolCall of message.tool_calls ?? []) {
      toolCallIndexes.set(toolCall.id, index);
    }
    if (message.role === "tool" && message.tool_call_id) {
      toolResultIndexes.set(message.tool_call_id, index);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const index of [...preservedIndexes]) {
      const message = messages[index];
      if (!message) {
        continue;
      }
      if (message.role === "tool" && message.tool_call_id) {
        const assistantIndex = toolCallIndexes.get(message.tool_call_id);
        if (assistantIndex !== undefined && !preservedIndexes.has(assistantIndex)) {
          preservedIndexes.add(assistantIndex);
          changed = true;
        }
      }
      for (const toolCall of message.tool_calls ?? []) {
        const resultIndex = toolResultIndexes.get(toolCall.id);
        if (resultIndex !== undefined && !preservedIndexes.has(resultIndex)) {
          preservedIndexes.add(resultIndex);
          changed = true;
        }
      }
    }
  }
}

function microcompactToolResult(
  message: ChatMessage,
  options: {
    threshold: number;
    protectedToolNames: Set<string>;
    toolResultRefs: Record<string, string>;
  },
): ChatMessage {
  if (
    message.role !== "tool" ||
    message.content.length <= options.threshold ||
    (message.name && options.protectedToolNames.has(message.name))
  ) {
    return message;
  }

  const toolName = message.name ?? "tool";
  const toolCallId = message.tool_call_id ?? "unknown";
  const ref = options.toolResultRefs[toolCallId];
  return {
    ...message,
    content: ref
      ? `[tool result compacted: ${toolName} ${toolCallId}, ${message.content.length} bytes; use tool_result_read with ref ${ref}]`
      : `[tool result compacted: ${toolName} ${toolCallId}, ${message.content.length} bytes; original result remains in the local checkpoint transcript]`,
  };
}
