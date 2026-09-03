import { ChatTurnSettlementStatus } from "../../shared/chat";
import { ChatOutputPart } from "../../shared/chatOutput";
import { createConversationCausalAttemptId } from "../../shared/conversationCausalSpine";
import { redactCredentialString } from "../../shared/credentialRedaction";
import { SecretSafeFailureError } from "../../shared/secretSafeFailure";
import { AssistantAcceptanceRecoveryRequiredError, ChatServiceOptions, createAssistantAcceptanceRecoveryResult } from "../chatService";
import { appendAssistantMessage } from "./modulemessages";
import { ChatWorkspaceRunRecorder, commitPreparedAssistantAcceptance } from "./modulesettlement";
import { createChatStatusEmitter } from "./streamingStatus";

export type LegacyPersistStageRt = {
  options: ChatServiceOptions;
  sessionId: () => string;
  causalTurnId: () => string;
  requestId: string;
  currentCausalAttempt: () => number;
  workspaceRunRecorder: () => ChatWorkspaceRunRecorder | null;
  finalizeAssistantOutput: (content: string) => { outputParts?: ChatOutputPart[] };
  emitStatus: ReturnType<typeof createChatStatusEmitter>;
  emitTerminalStreamEvent: (event: { type: "completed" | "failed" | "canceled"; message?: string; finalMessageId?: string; domainStateAvailable?: false }) => Promise<void>;
};

export function createLegacyPersistStage(rt: LegacyPersistStageRt) {
      async function persistAssistantReply(input: {
        content: string;
        relatedMemoryIds?: string[];
        executedRunId?: string;
        goalId?: string;
        goalEventRef?: string;
        terminalType?: "completed" | "failed" | "canceled";
        settlementStatus?: ChatTurnSettlementStatus;
      }): Promise<string | null> {
        const settlementStatus = input.settlementStatus ?? "succeeded";
        const safeContent = redactCredentialString(input.content);
        const finalizedOutput = rt.finalizeAssistantOutput(safeContent);
        const recorder = rt.workspaceRunRecorder();
        const assistantMessage = await appendAssistantMessage({
          chatSessionStore: rt.options.chatSessionStore,
          sessionId: rt.sessionId(),
          requestId: rt.requestId,
          turnId: rt.causalTurnId(),
          causalAttempt: rt.currentCausalAttempt(),
          causalAttemptId: createConversationCausalAttemptId({
            requestId: rt.requestId,
            turnId: rt.causalTurnId(),
            attempt: rt.currentCausalAttempt(),
          }),
          content: safeContent,
          turnSettlementStatus: settlementStatus,
          outputParts: finalizedOutput.outputParts,
          ...(input.relatedMemoryIds?.length
            ? { relatedMemoryIds: input.relatedMemoryIds }
            : {}),
          ...(input.executedRunId ? { executedRunId: input.executedRunId } : {}),
          ...(input.goalId ? { goalId: input.goalId } : {}),
          ...(input.goalEventRef ? { goalEventRef: input.goalEventRef } : {}),
        });
        const assistantMessageId = assistantMessage?.id ?? null;
        await rt.emitStatus.drainPersistence();
        const assistantRequiresAcceptance = settlementStatus !== "failed"
          && settlementStatus !== "canceled";
        if (
          assistantMessage
          && assistantRequiresAcceptance
          && rt.options.conversationCausalStore
        ) {
          const persistedMessage = {
            id: assistantMessage.id,
            role: assistantMessage.role,
            requestId: rt.requestId,
            turnId: rt.causalTurnId(),
            content: assistantMessage.content,
            turnSettlementStatus: assistantMessage.turnSettlementStatus,
          };
          const prepared = await rt.options.conversationCausalStore
            .prepareAssistantAcceptance({
              requestId: rt.requestId,
              attempt: rt.currentCausalAttempt(),
              persistedMessage,
              ...(recorder && settlementStatus === "succeeded"
                ? { workspaceRunId: recorder.workspaceRunId }
                : {}),
            });
          if (
            prepared.disposition !== "applied"
            && prepared.disposition !== "duplicate"
          ) {
            throw new Error("Durable assistant message conflicts with causal receipt.");
          }
          const acceptance = prepared.value?.attempts.find((attempt) =>
            attempt.attempt === rt.currentCausalAttempt(),
          )?.assistantAcceptance;
          if (!acceptance) {
            throw new Error("Durable assistant acceptance was not prepared.");
          }
          let workspaceEventId: string | undefined;
          if (recorder && settlementStatus === "succeeded") {
            let finalized;
            try {
              finalized = await recorder.finalizeAccepted(acceptance);
            } catch (error) {
              await rt.options.conversationCausalStore.addRefs({
                requestId: rt.requestId,
                refs: [{ kind: "workspace_run", id: recorder.workspaceRunId }],
                coverage: {
                  state: "degraded",
                  reasonCodes: ["workspace_terminal_settlement_failed"],
                },
              }).catch(() => undefined);
              throw error instanceof SecretSafeFailureError
                ? error
                : new SecretSafeFailureError("WORKSPACE_SETTLEMENT_FAILED", error);
            }
            workspaceEventId = finalized.eventId;
            if (finalized.disposition === "recovery_required") {
              throw new AssistantAcceptanceRecoveryRequiredError(
                createAssistantAcceptanceRecoveryResult(),
              );
            }
          }
          const committed = await commitPreparedAssistantAcceptance({
            conversationCausalStore: rt.options.conversationCausalStore,
            requestId: rt.requestId,
            attempt: rt.currentCausalAttempt(),
            acceptance,
            workspaceEventId,
          });
          if (committed === "recovery_required") {
            throw new AssistantAcceptanceRecoveryRequiredError(
              createAssistantAcceptanceRecoveryResult(),
            );
          }
        } else if (recorder && settlementStatus === "succeeded") {
          await recorder.finalizeAccepted();
        }
        if (assistantMessage && assistantRequiresAcceptance) {
          rt.emitStatus.sendAttemptControl({
            operation: "accepted",
            attempt: Math.max(1, rt.currentCausalAttempt()),
          });
        }
        rt.emitStatus.setAssistantMessageId(assistantMessageId);
        await rt.emitTerminalStreamEvent({
          type: input.terminalType ?? "completed",
          message: input.content,
          ...(assistantMessageId ? { finalMessageId: assistantMessageId } : {}),
        });
        return assistantMessageId;
      }
  return {
    persistAssistantReply,
  };
}