import { ChatOutputPart } from "../../shared/chatOutput";
import { redactCredentialString } from "../../shared/credentialRedaction";
import { createChatOutputAssembler } from "../chatOutputAssembler";
import { ChatServiceOptions, RequiredConversationSettlementError } from "../chatService";
import { createChatStatusEmitter } from "./streamingStatus";

export type LegacyTurnEmitStageRt = {
  options: ChatServiceOptions;
  requestId: string;
  publicationAuthority: { durableSessionId(): string | null; domainStateAvailable(): boolean };
  emitStatus: ReturnType<typeof createChatStatusEmitter>;
  outputAssembler: ReturnType<typeof createChatOutputAssembler>;
  terminalStreamEventSent: () => boolean;
  setTerminalStreamEventSent: (value: boolean) => void;
  currentCausalAttempt: () => number;
  setCurrentCausalAttempt: (value: number) => void;
  invalidatePublicationAuthority: (reasonCode: string) => void;
};

export function createLegacyTurnEmitStage(rt: LegacyTurnEmitStageRt) {

      function finalizeAssistantOutput(content: string): {
        outputParts?: ChatOutputPart[];
      } {
        rt.outputAssembler.setFinalText(redactCredentialString(content));
        const outputParts = rt.outputAssembler.parts();
        return {
          ...(outputParts.length > 0 ? { outputParts } : {}),
        };
      }
      function emitOutputPart(
        part: ChatOutputPart,
        provenance: { domainStateAvailable?: false } = {},
      ) {
        rt.emitStatus.sendStreamEvent({
          type: "output_part",
          part,
          ...provenance,
        });
      }
      async function ensureCausalAttempt(): Promise<void> {
        if (!rt.options.conversationCausalStore) {
          rt.setCurrentCausalAttempt(Math.max(1, rt.currentCausalAttempt()));
          return;
        }
        const current = await rt.options.conversationCausalStore.getRequest(rt.requestId);
        const last = current?.attempts.at(-1);
        if (last?.state === "accepted") {
          rt.setCurrentCausalAttempt(last.attempt);
          return;
        }
        if (last?.state === "active") {
          rt.setCurrentCausalAttempt(last.attempt);
          return;
        }
        const nextAttempt = (last?.attempt ?? 0) + 1;
        const begun = await rt.options.conversationCausalStore.beginAttempt({
          requestId: rt.requestId,
          attempt: nextAttempt,
        });
        if (begun.disposition !== "applied" && begun.disposition !== "duplicate") {
          throw new Error("Conversation causal attempt could not be started.");
        }
        rt.setCurrentCausalAttempt(nextAttempt);
      }
      async function emitTerminalStreamEvent(event: {
        type: "completed" | "failed" | "canceled";
        message?: string;
        finalMessageId?: string;
        domainStateAvailable?: false;
      }) {
        if (rt.terminalStreamEventSent()) {
          return;
        }
        const domainStateAvailable =
          event.domainStateAvailable === false
            || !rt.publicationAuthority.domainStateAvailable()
            ? false as const
            : undefined;
        if (
          event.message &&
          (event.type === "failed" || event.type === "canceled")
        ) {
          emitOutputPart(
            rt.outputAssembler.appendDiagnostic({
              severity: event.type === "failed" ? "error" : "warning",
              title: event.type === "failed" ? "请求失败" : "请求已取消",
              message: event.message,
            }),
            domainStateAvailable === false
              ? { domainStateAvailable: false }
              : {},
          );
        }
        rt.setTerminalStreamEventSent(true);
        await rt.emitStatus.drainPersistence();
        rt.emitStatus.sendTerminalEvent({
          ...event,
          ...(domainStateAvailable === false
            ? { domainStateAvailable: false as const }
            : {}),
        });
      }
      async function settleClaimOwnedFailure(message: string): Promise<void> {
        const durableSessionId = rt.publicationAuthority.durableSessionId();
        if (durableSessionId && rt.options.chatSessionStore?.appendActivityEvent) {
          try {
            await rt.emitStatus.sendRequired({
              state: "failed",
              message,
              toolCallsExecuted: 0,
            });
            await emitTerminalStreamEvent({
              type: "failed",
              message,
            });
            return;
          } catch (error) {
            if (
              !(error instanceof RequiredConversationSettlementError)
              || !error.failureStatusPersisted
            ) {
              rt.invalidatePublicationAuthority("claim_terminal_activity_write_failed");
            }
            await rt.options.conversationCausalStore?.addRefs({
              requestId: rt.requestId,
              refs: [],
              coverage: {
                state: "degraded",
                reasonCodes: ["claim_terminal_activity_write_failed"],
              },
            }).catch(() => undefined);
            rt.emitStatus.sendPublishedOnly({
              state: "failed",
              message,
              toolCallsExecuted: 0,
            });
          }
        } else {
          rt.invalidatePublicationAuthority(
            durableSessionId
              ? "chat_activity_adapter_unavailable"
              : "session_binding_unproven",
          );
          await rt.options.conversationCausalStore?.addRefs({
            requestId: rt.requestId,
            refs: [],
            coverage: {
              state: "degraded",
              reasonCodes: [
                durableSessionId
                  ? "chat_activity_adapter_unavailable"
                  : "session_binding_unproven",
              ],
            },
          }).catch(() => undefined);
          rt.emitStatus.sendPublishedOnly({
            state: "failed",
            message,
            toolCallsExecuted: 0,
          });
        }
        await emitTerminalStreamEvent({
          type: "failed",
          message,
          domainStateAvailable: false,
        });
      }
  return {
    finalizeAssistantOutput,
    emitOutputPart,
    ensureCausalAttempt,
    emitTerminalStreamEvent,
    settleClaimOwnedFailure,
  };
}