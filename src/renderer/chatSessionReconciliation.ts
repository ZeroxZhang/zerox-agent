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
