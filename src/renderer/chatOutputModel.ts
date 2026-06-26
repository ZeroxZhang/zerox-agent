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

export function isMainConversationOutputPart(part: ChatOutputPart): boolean {
  return !(
    part.type === "approval_request" ||
    part.type === "command_output" ||
    part.type === "input_request" ||
    part.type === "ledger_event" ||
    part.type === "tool_call" ||
    part.type === "tool_result"
  );
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
