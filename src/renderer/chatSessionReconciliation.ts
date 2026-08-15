export function shouldApplyPersistedSessionRefresh(
  activeSessionId: string | null,
  refreshSessionId: string,
  activeGeneration?: number,
  refreshGeneration?: number,
): boolean {
  return (
    (activeGeneration === undefined ||
      refreshGeneration === undefined ||
      activeGeneration === refreshGeneration) &&
    (activeSessionId === null || activeSessionId === refreshSessionId)
  );
}

export type ChatSessionSelectionContext = {
  sessionId: string | null;
  generation: number;
};

export function isChatSessionSelectionCurrent(
  captured: ChatSessionSelectionContext,
  currentSessionId: string | null,
  currentGeneration: number,
): boolean {
  return (
    captured.sessionId === currentSessionId &&
    captured.generation === currentGeneration
  );
}

export function shouldApplySequencedSessionResult(
  captured: ChatSessionSelectionContext,
  currentSessionId: string | null,
  currentGeneration: number,
  requestSequence: number,
  currentSequence: number,
): boolean {
  return (
    requestSequence === currentSequence &&
    isChatSessionSelectionCurrent(
      captured,
      currentSessionId,
      currentGeneration,
    )
  );
}

export function shouldApplyChatRequestSettlement(
  activeRequestId: string | null,
  requestId: string,
  requestGeneration: number,
  currentGeneration: number,
): boolean {
  return (
    activeRequestId === requestId &&
    requestGeneration === currentGeneration
  );
}

export function rollbackFailedAttachmentTurn(
  messages: ChatStreamMessage[],
  options: { userMessageId: string; requestId: string },
): ChatStreamMessage[] {
  return messages.filter(
    (message) =>
      message.id !== options.userMessageId &&
      message.streamRequestId !== options.requestId,
  );
}
import type { ChatStreamMessage } from "./chatStreamReducer";
