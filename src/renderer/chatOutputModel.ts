import type { ChatMessageRecord, ChatStreamEvent } from "../shared/chat";
import type { ChatOutputPart } from "../shared/chatOutput";

export type RenderedOutputPartSource = "persisted" | "stream";

export type RenderedOutputPart = ChatOutputPart & {
  renderKey: string;
  source: RenderedOutputPartSource;
};

export function outputPartsFromMessage(
  message: ChatMessageRecord,
): RenderedOutputPart[] {
  if (message.outputParts?.length) {
    return message.outputParts.map((part) => ({
      ...part,
      renderKey: `${message.id}:${part.id}`,
      source: "persisted",
    }));
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
    renderKey: `${event.requestId}:${event.sequence}:${event.part.id}`,
    source: "stream",
  };
}
