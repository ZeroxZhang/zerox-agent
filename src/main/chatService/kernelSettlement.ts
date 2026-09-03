import { randomUUID } from "node:crypto";
import { createConversationRequestFingerprint } from "../../shared/conversationCausalSpine";
import type {
  ChatStreamEvent,
  ChatTaskStatusEvent,
  SendChatMessageResult,
} from "../../shared/chat";
import { normalizeChatTaskStatusEventForPersistence } from "../chatSessionStore";
import type { ChatKernelSettlement } from "../kernel/chatKernelSegment";

function toRequiredSettlementTarget(
  event: ChatTaskStatusEvent,
):
  | "waiting_for_input"
  | "waiting_for_approval"
  | "checkpoint_boundary"
  | "paused"
  | "failed"
  | "canceled"
  | null {
  if (event.state === "waiting_for_input") return "waiting_for_input";
  if (
    event.state === "tool_invocation"
    && event.invocationStatus === "waiting_approval"
  ) {
    return "waiting_for_approval";
  }
  if (event.state === "checkpoint_boundary") return "checkpoint_boundary";
  if (event.state === "paused") return "paused";
  if (event.state === "failed") return "failed";
  if (event.state === "canceled") return "canceled";
  return null;
}

function createRequiredSettlementId(input: {
  requestId: string;
  attempt: number;
  sourceSequence: number;
  targetState: string;
}): string {
  return `required_settlement_${createConversationRequestFingerprint({
    schemaVersion: 1,
    ...input,
  })}`;
}

export function createRequiredChatEventFingerprint(
  event: ChatTaskStatusEvent,
): string {
  const persistedEvent = normalizeChatTaskStatusEventForPersistence(event);
  const pendingSkillInput = persistedEvent.pendingSkillInput
    ? {
        ...persistedEvent.pendingSkillInput,
        ...(persistedEvent.pendingSkillInput.attachmentPayloads
          ? {
              attachmentPayloads: persistedEvent.pendingSkillInput.attachmentPayloads.map(
                ({ dataBase64, ...metadata }) => ({
                  ...metadata,
                  dataFingerprint: createConversationRequestFingerprint(dataBase64),
                }),
              ),
            }
          : {}),
      }
    : undefined;
  return createConversationRequestFingerprint({
    schemaVersion: 2,
    event: {
      ...persistedEvent,
      ...(pendingSkillInput ? { pendingSkillInput } : {}),
    },
  });
}

function createChatKernelRunId(requestId: string): string {
  return `chat_kernel_${createConversationRequestFingerprint({
    schemaVersion: 1,
    requestId,
    invocationId: randomUUID(),
  })}`;
}

function toChatKernelStatus(
  result: SendChatMessageResult,
  terminal: Extract<
    ChatStreamEvent,
    { type: "completed" | "failed" | "canceled" }
  > | undefined,
  statusEvent: ChatTaskStatusEvent | undefined,
): ChatKernelSettlement<unknown>["status"] {
  if (terminal?.type === "canceled") return "canceled";
  if (terminal?.type === "failed") return "failed";
  if (result.turnSettlementStatus === "unknown") return "paused";
  if (!result.ok) {
    if (statusEvent?.state === "waiting_for_input" || statusEvent?.state === "paused") {
      return "paused";
    }
    if (statusEvent?.state === "canceled") return "canceled";
    if (statusEvent?.state === "failed") return "failed";
    return result.code === "CANCELED" ? "canceled" : "failed";
  }
  if (result.turnSettlementStatus === "paused") return "paused";
  if (result.turnSettlementStatus === "failed") return "failed";
  if (result.agentStatus?.state === "paused") return "paused";
  if (result.agentStatus?.state === "failed") return "failed";
  return "succeeded";
}

export {
  toRequiredSettlementTarget,
  createRequiredSettlementId,
  createChatKernelRunId,
  toChatKernelStatus,
};
