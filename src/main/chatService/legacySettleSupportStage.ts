import { ChatTaskStatusEvent } from "../../shared/chat";
import { ChatServiceOptions, RequiredConversationSettlementError } from "../chatService";
import { persistRequiredChatActivityEvent } from "./modulemessages";
import { ChatWorkspaceRunRecorder, persistRequiredConversationSettlement } from "./modulesettlement";

export type LegacySettleSupportRt = {
  options: ChatServiceOptions;
  sessionId: () => string;
  requestId: string;
  currentCausalAttempt: () => number;
  publicationAuthority: { invalidate(reasonCode: string): void };
  internalOptions: { onDomainStateUnavailable?: () => void };
  pendingContinuations: { delete(key: string): boolean };
  workspaceRunRecorder: () => ChatWorkspaceRunRecorder | null;
};

export function createLegacySettleSupportStage(rt: LegacySettleSupportRt) {
      function invalidatePublicationAuthority(reasonCode: string): void {
        rt.publicationAuthority.invalidate(reasonCode);
        rt.internalOptions.onDomainStateUnavailable?.();
      }

      async function interruptRequiredSettlementAttempt(): Promise<void> {
        rt.pendingContinuations.delete(rt.sessionId());
        if (!rt.options.conversationCausalStore || rt.currentCausalAttempt() < 1) return;
        try {
          const settled = await rt.options.conversationCausalStore.settleAttempt({
            requestId: rt.requestId,
            attempt: rt.currentCausalAttempt(),
            state: "interrupted",
          });
          if (
            settled.disposition !== "applied"
            && settled.disposition !== "duplicate"
          ) {
            await rt.options.conversationCausalStore.addRefs({
              requestId: rt.requestId,
              refs: [],
              coverage: {
                state: "degraded",
                reasonCodes: ["required_settlement_attempt_interrupt_conflict"],
              },
            }).catch(() => undefined);
          }
        } catch {
          await rt.options.conversationCausalStore.addRefs({
            requestId: rt.requestId,
            refs: [],
            coverage: {
              state: "degraded",
              reasonCodes: ["required_settlement_attempt_interrupt_failed"],
            },
          }).catch(() => undefined);
        }
      }

      async function compensateRequiredSettlementFailure(
        event: ChatTaskStatusEvent,
      ): Promise<boolean> {
        const recorder = rt.workspaceRunRecorder();
        const {
          payload: _payload,
          inputRequest: _inputRequest,
          pendingSkillInput,
          maxTurns: _maxTurns,
          ...safeEvent
        } = event;
        const failureEvent: ChatTaskStatusEvent = {
          ...safeEvent,
          ...(event.settlementId
            ? { settlementId: `${event.settlementId}:tombstone` }
            : {}),
          state: "failed",
          message: "Required conversation settlement failed.",
          ...(pendingSkillInput
            ? {
                pendingSkillInput: {
                  ...pendingSkillInput,
                  status: "failed",
                  attachmentPayloads: undefined,
                },
              }
            : {}),
        };
        const [chatCompensation, workspaceCompensation] = await Promise.allSettled([
          persistRequiredChatActivityEvent(rt.options.chatSessionStore, failureEvent),
          recorder
            ? recorder.appendStatusEvent(failureEvent)
            : Promise.resolve(null),
        ]);
        const reasonCodes = ["required_conversation_settlement_failed"];
        if (chatCompensation.status === "rejected") {
          reasonCodes.push("required_chat_failure_compensation_failed");
          invalidatePublicationAuthority("required_chat_failure_compensation_failed");
        }
        if (workspaceCompensation.status === "rejected") {
          reasonCodes.push("required_workspace_failure_compensation_failed");
        }
        const recorded = workspaceCompensation.status === "fulfilled"
          ? workspaceCompensation.value
          : null;
        await rt.options.conversationCausalStore?.addRefs({
          requestId: rt.requestId,
          refs: [
            ...(recorder
              ? [{ kind: "workspace_run" as const, id: recorder.workspaceRunId }]
              : []),
            ...(recorded?.eventId && recorder
              ? [{
                  kind: "workspace_event" as const,
                  runId: recorder.workspaceRunId,
                  eventId: recorded.eventId,
                }]
              : []),
          ],
          coverage: { state: "degraded", reasonCodes },
        }).catch(() => undefined);
        await interruptRequiredSettlementAttempt();
        return chatCompensation.status === "fulfilled";
      }

      async function persistChatStatusEvent(
        event: ChatTaskStatusEvent,
        requiredChat: boolean,
      ): Promise<void> {
        const recorder = rt.workspaceRunRecorder();
        if (!requiredChat) {
          if (rt.options.chatSessionStore?.appendActivityEvent) {
            try {
              await rt.options.chatSessionStore.appendActivityEvent(event.sessionId, event);
            } catch {
              await rt.options.conversationCausalStore?.addRefs({
                requestId: rt.requestId,
                refs: [],
                coverage: {
                  state: "degraded",
                  reasonCodes: ["chat_activity_write_failed"],
                },
              }).catch(() => undefined);
            }
          }
          if (!recorder) {
            await rt.options.conversationCausalStore?.addRefs({
              requestId: rt.requestId,
              refs: [],
              coverage: {
                state: "partial",
                reasonCodes: ["workspace_run_unavailable"],
              },
            }).catch(() => undefined);
            return;
          }
          try {
            const recorded = await recorder.appendStatusEvent(event);
            await rt.options.conversationCausalStore?.addRefs({
              requestId: rt.requestId,
              refs: [
                { kind: "workspace_run", id: recorder.workspaceRunId },
                ...(recorded.eventId
                  ? [{
                      kind: "workspace_event" as const,
                      runId: recorder.workspaceRunId,
                      eventId: recorded.eventId,
                    }]
                  : []),
              ],
            }).catch(() => undefined);
          } catch {
            await rt.options.conversationCausalStore?.addRefs({
              requestId: rt.requestId,
              refs: [{ kind: "workspace_run", id: recorder.workspaceRunId }],
              coverage: {
                state: "degraded",
                reasonCodes: ["workspace_run_write_failed"],
              },
            }).catch(() => undefined);
          }
          return;
        }
        try {
          await persistRequiredConversationSettlement({
            requestId: rt.requestId,
            attempt: rt.currentCausalAttempt(),
            event,
            chatSessionStore: rt.options.chatSessionStore,
            conversationCausalStore: rt.options.conversationCausalStore,
            workspaceRunRecorder: recorder,
            workspaceUnavailableReasonCode: "workspace_run_unavailable",
          });
        } catch (error) {
          const failureStatusPersisted =
            await compensateRequiredSettlementFailure(event);
          throw new RequiredConversationSettlementError(
            failureStatusPersisted,
            error,
            error instanceof RequiredConversationSettlementError
              ? error.failureCode
              : "CROSS_DOMAIN_SETTLEMENT_FAILED",
          );
        }
      }
  return {
    invalidatePublicationAuthority,
    interruptRequiredSettlementAttempt,
    compensateRequiredSettlementFailure,
    persistChatStatusEvent,
  };
}