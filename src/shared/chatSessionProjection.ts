import type { ChatMessageRecord, ChatSessionRecord } from "./chat";
import type { ChatOutputPart } from "./chatOutput";

const transcriptOutputPartTypes = new Set<ChatOutputPart["type"]>([
  "artifact",
  "citation",
  "code",
  "diagnostic",
  "file_diff",
  "table",
  "text",
]);

export function projectChatSessionForTranscript(
  session: ChatSessionRecord,
): ChatSessionRecord {
  return {
    ...session,
    messages: session.messages.map(projectChatMessageForTranscript),
  };
}

export function projectChatMessageForTranscript(
  message: ChatMessageRecord,
): ChatMessageRecord {
  if (!message.outputParts?.length) {
    return message;
  }

  const outputParts = message.outputParts.filter(isTranscriptOutputPart);
  if (outputParts.length === message.outputParts.length) {
    return message;
  }

  const { outputParts: _outputParts, ...messageWithoutOutputParts } = message;
  return outputParts.length
    ? { ...messageWithoutOutputParts, outputParts }
    : messageWithoutOutputParts;
}

export function isTranscriptOutputPart(part: ChatOutputPart): boolean {
  return transcriptOutputPartTypes.has(part.type);
}
