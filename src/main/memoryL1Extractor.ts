import type { MemoryInput } from "../shared/memory";

export type ChatTurnMemoryExtractionInput = {
  sessionId: string;
  userMessageId: string | null;
  assistantMessageId: string | null;
  userMessage: string;
  assistantReply: string;
};

const preferencePattern =
  /(记住|以后|默认|偏好|喜欢|希望|prefer|remember|default)/i;
const minSignalLength = 6;
const titleContentLimit = 36;

export function extractAtomicMemoriesFromChatTurn(
  input: ChatTurnMemoryExtractionInput,
): MemoryInput[] {
  const content = input.userMessage.trim();
  if (!isHighSignalPreference(content)) {
    return [];
  }

  const messageIds = [input.userMessageId, input.assistantMessageId].filter(
    (id): id is string => Boolean(id),
  );

  if (!messageIds.length) {
    return [];
  }

  return [
    {
      kind: "semantic",
      title: `用户偏好：${truncateForTitle(content, titleContentLimit)}`,
      content,
      tags: ["l1", "chat", "preference"],
      source: {
        type: "chat_session",
        sessionId: input.sessionId,
        messageIds,
      },
      importance: 4,
    },
  ];
}

function isHighSignalPreference(value: string): boolean {
  return value.length >= minSignalLength && preferencePattern.test(value);
}

function truncateForTitle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}
