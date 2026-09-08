import type { ChatMessageRecord, ChatStreamEvent } from "../shared/chat";
import {
  outputPartsToPlainText,
  type ChatOutputPart,
} from "../shared/chatOutput";

export type RenderedOutputPartSource = "persisted" | "stream";

export type RenderedOutputPart = ChatOutputPart & {
  renderKey: string;
  source: RenderedOutputPartSource;
};

/**
 * LD03: process facts are no longer filtered out of the main conversation.
 * Reasoning, tool calls, tool results and approvals render inline as process
 * blocks whose density and expansion come from the shared disclosure policy.
 */
export function isMainConversationOutputPart(_part: ChatOutputPart): boolean {
  return true;
}

export function outputPartsFromMessage(
  message: ChatMessageRecord,
): RenderedOutputPart[] {
  if (message.outputParts?.length) {
    const parts = message.outputParts.map((part) => ({
      ...part,
      renderKey: `${message.id}:${part.id}`,
      source: "persisted",
    })) satisfies RenderedOutputPart[];
    const hasTextPart = parts.some((part) => part.type === "text");
    if (hasTextPart || !message.content) {
      return parts.filter(isMainConversationOutputPart);
    }

    const legacyTextPart: RenderedOutputPart = {
      id: `${message.id}:text`,
      type: "text",
      text: message.content,
      format: "markdown",
      renderKey: `${message.id}:text`,
      source: "persisted",
    };

    return [legacyTextPart, ...parts].filter(isMainConversationOutputPart);
  }

  return [
    {
      id: `${message.id}:text`,
      type: "text",
      text: message.content,
      format: "markdown",
      renderKey: `${message.id}:text`,
      source: "persisted",
    },
  ];
}

export function outputPartFromStreamEvent(
  event: ChatStreamEvent,
): RenderedOutputPart | undefined {
  if (event.type !== "output_part") {
    return undefined;
  }

  return {
    ...event.part,
    renderKey: `${event.requestId}:${event.part.id}`,
    source: "stream",
  };
}

export function outputMarkdownFromMessage(message: ChatMessageRecord): string {
  if (message.role !== "assistant") {
    return message.content;
  }

  return outputPartsToPlainText(outputPartsFromMessage(message));
}
