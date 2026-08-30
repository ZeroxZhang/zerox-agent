import type {
  ChatAgentStatus,
  ChatTurnResultSettlementStatus,
} from "../shared/chat";

export type ChatResultSettlementUiState = "paused" | "failed" | "canceled" | null;

/**
 * Reconciles a durable turn receipt with richer live Agent status. Legacy
 * `unknown` is deliberately non-success and remains paused until revalidated.
 */
export function getChatResultSettlementUiState(input: {
  agentStatus?: ChatAgentStatus;
  turnSettlementStatus?: ChatTurnResultSettlementStatus;
}): ChatResultSettlementUiState {
  if (
    input.agentStatus?.state === "failed"
    || input.turnSettlementStatus === "failed"
  ) {
    return "failed";
  }
  if (input.turnSettlementStatus === "canceled") {
    return "canceled";
  }
  if (
    input.agentStatus?.state === "paused"
    || input.turnSettlementStatus === "paused"
    || input.turnSettlementStatus === "unknown"
  ) {
    return "paused";
  }
  return null;
}
