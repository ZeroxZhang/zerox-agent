import {
  maskPreviewSecrets,
  type ChatOutputPart,
  type ChatTextPart,
  type ChatToolCallPart,
} from "../shared/chatOutput";

export type ChatOutputAssembler = {
  appendText(text: string): ChatTextPart | undefined;
  appendToolCall(input: {
    toolCallId: string;
    toolName?: string;
    toolSource?: string;
    argumentsText?: string;
  }): ChatToolCallPart;
  parts(): ChatOutputPart[];
};

type ToolCallBuffer = {
  part: ChatToolCallPart;
  argumentsText: string;
};

export function createChatOutputAssembler(
  now = () => new Date().toISOString(),
): ChatOutputAssembler {
  const parts: ChatOutputPart[] = [];
  const toolCalls = new Map<string, ToolCallBuffer>();

  return {
    appendText(text) {
      if (!text) {
        return undefined;
      }

      const lastPart = parts.at(-1);
      if (lastPart?.type === "text") {
        lastPart.text += text;
        return lastPart;
      }

      const part: ChatTextPart = {
        id: `text_${parts.length + 1}`,
        type: "text",
        text,
        format: "markdown",
        createdAt: now(),
      };
      parts.push(part);
      return part;
    },

    appendToolCall(input) {
      const toolCallId = input.toolCallId || `tool_call_${toolCalls.size + 1}`;
      const existing = toolCalls.get(toolCallId);
      const accumulatedArguments = `${existing?.argumentsText ?? ""}${input.argumentsText ?? ""}`;
      const argsPreview = normalizeArgsPreview(accumulatedArguments);

      if (existing) {
        existing.argumentsText = accumulatedArguments;
        existing.part.toolName = input.toolName ?? existing.part.toolName;
        existing.part.toolSource = input.toolSource ?? existing.part.toolSource;
        existing.part.argsPreview = maskPreviewSecrets(argsPreview);
        return existing.part;
      }

      const part: ChatToolCallPart = {
        id: `tool_${toolCallId}`,
        type: "tool_call",
        toolCallId,
        toolName: input.toolName ?? "tool",
        ...(input.toolSource ? { toolSource: input.toolSource } : {}),
        ...(argsPreview !== undefined
          ? { argsPreview: maskPreviewSecrets(argsPreview) }
          : {}),
        createdAt: now(),
      };
      parts.push(part);
      toolCalls.set(toolCallId, {
        part,
        argumentsText: accumulatedArguments,
      });
      return part;
    },

    parts() {
      return parts.map((part) => ({ ...part }));
    },
  };
}

function normalizeArgsPreview(argumentsText: string): unknown {
  if (!argumentsText) {
    return undefined;
  }

  try {
    return JSON.parse(argumentsText) as unknown;
  } catch {
    return argumentsText;
  }
}
