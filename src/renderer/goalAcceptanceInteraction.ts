export type GoalAcceptanceUiContext = {
  goalId: string | null;
  sessionId: string | null;
  generation: number;
};

export type ManualCompletionConfirmation = {
  goalId: string;
  sessionId: string | null;
  generation: number;
};

export type GoalAcceptanceOperationKind =
  | "continue_acceptance"
  | "mark_completed_unverified";

export type GoalAcceptanceOperationToken = {
  operationId: string;
  kind: GoalAcceptanceOperationKind;
  goalId: string;
  sessionId: string | null;
  generation: number;
};

export function createManualCompletionConfirmation(
  context: GoalAcceptanceUiContext,
): ManualCompletionConfirmation | null {
  if (!context.goalId) {
    return null;
  }
  return {
    goalId: context.goalId,
    sessionId: context.sessionId,
    generation: context.generation,
  };
}

export function getConfirmedManualCompletionGoalId(
  confirmation: ManualCompletionConfirmation | null,
  context: GoalAcceptanceUiContext,
): string | undefined {
  return confirmation && contextMatches(confirmation, context)
    ? confirmation.goalId
    : undefined;
}

export function createGoalAcceptanceOperationToken(
  kind: GoalAcceptanceOperationKind,
  context: GoalAcceptanceUiContext,
  operationId: string,
): GoalAcceptanceOperationToken | null {
  if (!context.goalId || !operationId) {
    return null;
  }
  return {
    operationId,
    kind,
    goalId: context.goalId,
    sessionId: context.sessionId,
    generation: context.generation,
  };
}

export function isGoalAcceptanceOperationCurrent(
  token: GoalAcceptanceOperationToken,
  context: GoalAcceptanceUiContext,
  currentToken: GoalAcceptanceOperationToken | null,
): boolean {
  return doesGoalAcceptanceOperationOwnPending(token, currentToken) &&
    contextMatches(token, context);
}

export function doesGoalAcceptanceOperationOwnPending(
  token: GoalAcceptanceOperationToken,
  currentToken: GoalAcceptanceOperationToken | null,
): boolean {
  return Boolean(
    currentToken &&
      currentToken.operationId === token.operationId &&
      currentToken.kind === token.kind &&
      currentToken.goalId === token.goalId &&
      currentToken.sessionId === token.sessionId &&
      currentToken.generation === token.generation,
  );
}

export function isGoalAcceptanceResultForOperation(
  token: GoalAcceptanceOperationToken,
  resultGoalId: string,
): boolean {
  return token.goalId === resultGoalId;
}

function contextMatches(
  snapshot: Pick<
    GoalAcceptanceOperationToken | ManualCompletionConfirmation,
    "goalId" | "sessionId" | "generation"
  >,
  context: GoalAcceptanceUiContext,
): boolean {
  return snapshot.goalId === context.goalId &&
    snapshot.sessionId === context.sessionId &&
    snapshot.generation === context.generation;
}
