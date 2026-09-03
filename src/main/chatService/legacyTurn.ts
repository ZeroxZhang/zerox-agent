import { toRelatedMemory } from "./modulemessages";
import { createLegacyPersistStage } from "./legacyPersistStage";
import { estimateChatTurnUsage } from "./modulemessages";
import { recordSessionTokenUsage } from "./modulemessages";
import { modelServiceNoticeFromError } from "../../shared/modelServiceNotice";
import { modelNoticeContinuationReason } from "./moduleruntime";
import { sanitizeModelServiceNotice } from "../../shared/modelServiceNotice";
import { formatAgentLoopFailure } from "./moduleruntime";
import { toPersistedChatContinuation } from "./modulemessages";
import { reconcileAgentLoopTokenUsage } from "./modulemessages";
import { normalizeReasoningForStatus } from "./moduleruntime";
import { emitActorToolStatusEvents } from "./moduleruntime";
import { buildToolResultStatusMessage } from "./moduleruntime";
import { emitActorSpawnedStatusEvent } from "./moduleruntime";
import { inferApprovalRiskLevel } from "./modulesettlement";
import { stringifyMaskedPreview } from "../../shared/chatOutput";
import { buildNativeToolEvidencePayload } from "./modulemessages";
import { getNativeToolDescriptor } from "./modulemessages";
import { stringifyRedactedCredentials } from "../../shared/credentialRedaction";
import { truncateHistoryContent } from "./modulemessages";
import { readToolArgString } from "./moduleruntime";
import { emitModelStreamEvent } from "./streamingStatus";
import { formatContextUsageStatus } from "./modulemessages";
import { toChatSessionContextSnapshot } from "./modulemessages";
import { toChatSessionTokenUsage } from "./modulemessages";
import { mergeChatSessionTokenUsage } from "./modulemessages";
import { throwIfResponseBodyLimitError } from "../fetchWithTimeout";
import { toChatCompletionResponse } from "../providers/normalize";
import { toCompleteRequest } from "../providers/normalize";
import { isMaxModeEnabled } from "../providers/maxMode";
import { buildChatSystemPrompt } from "./modulemessages";
import { sanitizeChatMessages } from "../messageIntegrity";
import { runAgentLoop } from "../agentLoop";
import { summarizeAgentRuntimeContextSnapshot } from "../../shared/agentRuntimeContext";
import { buildRuntimeContextMemoryScopes } from "./moduleruntime";
import { getToolRegistrySource } from "./modulemessages";
import { createRuntimeContextSnapshotForRun } from "../runtimeContextFactory";
import { createChatAgentEvidenceRecorder } from "../chatAgentEvidence";
import { createChatRuntimeTask } from "./moduleruntime";
import { normalizeAgentLoopMaxTurns } from "./streamingStatus";
import { extendRunContextForSelectedSkill } from "./moduleruntime";
import { ChatSessionTokenUsage } from "../../shared/chat";
import { ChatAgentStatus } from "../../shared/chat";
import { injectSkillInvocationMessage } from "./modulemessages";
import { createHistoryAttachmentReplayBudget } from "./modulemessages";
import { buildChatMessages } from "./modulemessages";
import { searchRelatedMemories } from "./modulemessages";
import { buildContinuationMessages } from "./moduleruntime";
import { ChatMessage } from "../openAiCompatibleClient";
import { MemorySearchResult } from "../../shared/memory";
import { AgentModelProfile } from "../agentRunnerService";
import { tryRunTaskFromIntent } from "./modulemessages";
import { AgentRunAdmissionGate } from "../../shared/agentRuns";
import { writeAtomicMemories } from "./modulemessages";
import { compactMessageIds } from "./modulemessages";
import { writeSessionMemory } from "./modulemessages";
import { tryCreateTaskFromIntent } from "./modulemessages";
import { classifyAgentIntent } from "../../shared/agentIntent";
import { detectGoalIntent } from "./moduleruntime";
import { extractGoalDescription } from "./moduleruntime";
import { tryRouteGoalIntent } from "./moduleruntime";
import { toInMemoryPendingSkillInputState } from "./modulemessages";
import { createPendingSkillInputState } from "./modulemessages";
import { createSkillUserInputRequest } from "./modulemessages";
import { resolveSkillInput } from "../skillExecutionService";
import { resolveRequestedSkill } from "./modulemessages";
import { isContinuationRequest } from "./moduleruntime";
import { findPersistedChatContinuation } from "./modulemessages";
import { formatPlanContinuationReply } from "./moduleruntime";
import { isAbortError } from "./moduleruntime";
import { formatLockedPlanReply } from "./moduleruntime";
import { extractExplicitGoalAmendmentObjective } from "./moduleruntime";
import { appendRawHistoryEntry } from "./modulemessages";
import { toSecretSafeFailure } from "../../shared/secretSafeFailure";
import { WorkspaceRunEnvelopeConflictError } from "../workspaceRunStore";
import { createChatWorkspaceRunRecorder } from "./modulesettlement";
import { getActiveGoalSummary } from "./moduleruntime";
import { ChatSessionGoalSummary } from "../../shared/chat";
import { ChatHistoryMessage } from "../../shared/chat";
import { buildChatWorkspaceSummary } from "./moduleruntime";
import { resolveChatWorkspace } from "./moduleruntime";
import { SecretSafeFailureError } from "../../shared/secretSafeFailure";
import { appendAssistantMessage } from "./modulemessages";
import { ChatTurnSettlementStatus } from "../../shared/chat";
import { createConversationRequestFingerprint } from "../../shared/conversationCausalSpine";
import { createChatWorkspaceRunId } from "./moduleruntime";
import { commitPreparedAssistantAcceptance } from "./modulesettlement";
import { settlePreparedWorkspaceAssistantAcceptance } from "./modulesettlement";
import { createAssistantAcceptanceRecoveryResult } from "../chatService";
import { AssistantAcceptanceRecoveryRequiredError } from "../chatService";
import { createConversationCausalAttemptId } from "../../shared/conversationCausalSpine";
import { findPersistedRequestTurn } from "./modulemessages";
import { LEGACY_CONVERSATION_REQUEST_FINGERPRINT_VERSION } from "../../shared/conversationCausalSpine";
import { resolveConversationRequestFingerprintVersion } from "../../shared/conversationCausalSpine";
import { resolveDurableConversationBinding } from "../../shared/conversationCausalSpine";
import { redactCredentialString } from "../../shared/credentialRedaction";
import { ChatOutputPart } from "../../shared/chatOutput";
import { createChatOutputAssembler } from "../chatOutputAssembler";
import { formatDateInTimeZone } from "../../shared/dateContext";
import { getSystemTimeZone } from "../../shared/dateContext";
import { RequiredConversationSettlementError } from "../chatService";
import { persistRequiredConversationSettlement } from "./modulesettlement";
import { persistRequiredChatActivityEvent } from "./modulemessages";
import { ChatTaskStatusEvent } from "../../shared/chat";
import { createChatPublicationAuthority } from "../chatService";
import { ChatWorkspaceRunRecorder } from "./modulesettlement";
import { SendChatMessageResult } from "../../shared/chat";
import { ChatTurnInternalOptions } from "../chatService";
import { SendChatMessageRuntimeOptions } from "../chatService";
import { SendChatMessageInput } from "../../shared/chat";
import type { ChatServiceOptions, ChatContinuationState } from "../chatService";
import { createGuidedInputRuntime } from "./guidedInput";
import { createChatStatusEmitter, getNowMs } from "./streamingStatus";
import { createConversationTurnId } from "../../shared/conversationCausalSpine";

/** Outer factory identifiers threaded into the legacy-turn runtime. */
export type LegacyTurnRuntime = {
  options: ChatServiceOptions;
  createId: () => string;
  memoryLimit: number;
  historyLimit: number;
  agentLoopMaxTurns: number;
  state: {
    pendingContinuations: Map<string, ChatContinuationState>;
  };
  guidedInput: ReturnType<typeof createGuidedInputRuntime>;
};

export function createLegacyTurnRuntime(rt: LegacyTurnRuntime) {
  const options = rt.options;
  const createId = rt.createId;
  const memoryLimit = rt.memoryLimit;
  const historyLimit = rt.historyLimit;
  const agentLoopMaxTurns = rt.agentLoopMaxTurns;
  const pendingContinuations = rt.state.pendingContinuations;
  const guidedInput = rt.guidedInput;
  async function executeMessageInternal(
    input: SendChatMessageInput,
    runtimeOptions: SendChatMessageRuntimeOptions = {},
    internalOptions: ChatTurnInternalOptions = {},
  ): Promise<SendChatMessageResult> {
      if (runtimeOptions.signal?.aborted) {
        return {
          ok: false,
          code: "CANCELED",
          retryable: true,
          message: "已中断任务。",
        };
      }
      const preparation = internalOptions.preparedInput
        ? { ok: true as const, value: internalOptions.preparedInput }
        : await guidedInput.prepareChatMessageInput(input, runtimeOptions);
      if (!preparation.ok) {
        return preparation.result;
      }
      const {
        processedAttachments,
        userMessage,
        modelUserMessage,
        hasAttachments,
        preexistingInputRoutingPlan,
      } = preparation.value;

      let sessionId = input.sessionId ?? createId();
      const startedAtMs = getNowMs(options.now);
      const requestId = input.requestId ?? `request_${startedAtMs}`;
      let workspaceRunRecorder: ChatWorkspaceRunRecorder | null = null;
      let currentCausalAttempt = 0;
      const publicationAuthority =
        internalOptions.publicationAuthority ?? createChatPublicationAuthority();

      function invalidatePublicationAuthority(reasonCode: string): void {
        publicationAuthority.invalidate(reasonCode);
        internalOptions.onDomainStateUnavailable?.();
      }

      async function interruptRequiredSettlementAttempt(): Promise<void> {
        pendingContinuations.delete(sessionId);
        if (!options.conversationCausalStore || currentCausalAttempt < 1) return;
        try {
          const settled = await options.conversationCausalStore.settleAttempt({
            requestId,
            attempt: currentCausalAttempt,
            state: "interrupted",
          });
          if (
            settled.disposition !== "applied"
            && settled.disposition !== "duplicate"
          ) {
            await options.conversationCausalStore.addRefs({
              requestId,
              refs: [],
              coverage: {
                state: "degraded",
                reasonCodes: ["required_settlement_attempt_interrupt_conflict"],
              },
            }).catch(() => undefined);
          }
        } catch {
          await options.conversationCausalStore.addRefs({
            requestId,
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
          persistRequiredChatActivityEvent(options.chatSessionStore, failureEvent),
          workspaceRunRecorder
            ? workspaceRunRecorder.appendStatusEvent(failureEvent)
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
        await options.conversationCausalStore?.addRefs({
          requestId,
          refs: [
            ...(workspaceRunRecorder
              ? [{ kind: "workspace_run" as const, id: workspaceRunRecorder.workspaceRunId }]
              : []),
            ...(recorded?.eventId && workspaceRunRecorder
              ? [{
                  kind: "workspace_event" as const,
                  runId: workspaceRunRecorder.workspaceRunId,
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
        if (!requiredChat) {
          if (options.chatSessionStore?.appendActivityEvent) {
            try {
              await options.chatSessionStore.appendActivityEvent(event.sessionId, event);
            } catch {
              await options.conversationCausalStore?.addRefs({
                requestId,
                refs: [],
                coverage: {
                  state: "degraded",
                  reasonCodes: ["chat_activity_write_failed"],
                },
              }).catch(() => undefined);
            }
          }
          if (!workspaceRunRecorder) {
            await options.conversationCausalStore?.addRefs({
              requestId,
              refs: [],
              coverage: {
                state: "partial",
                reasonCodes: ["workspace_run_unavailable"],
              },
            }).catch(() => undefined);
            return;
          }
          try {
            const recorded = await workspaceRunRecorder.appendStatusEvent(event);
            await options.conversationCausalStore?.addRefs({
              requestId,
              refs: [
                { kind: "workspace_run", id: workspaceRunRecorder.workspaceRunId },
                ...(recorded.eventId
                  ? [{
                      kind: "workspace_event" as const,
                      runId: workspaceRunRecorder.workspaceRunId,
                      eventId: recorded.eventId,
                    }]
                  : []),
              ],
            }).catch(() => undefined);
          } catch {
            await options.conversationCausalStore?.addRefs({
              requestId,
              refs: [{ kind: "workspace_run", id: workspaceRunRecorder.workspaceRunId }],
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
            requestId,
            attempt: currentCausalAttempt,
            event,
            chatSessionStore: options.chatSessionStore,
            conversationCausalStore: options.conversationCausalStore,
            workspaceRunRecorder,
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
      const chatTimeZone = options.systemTimeZone ?? getSystemTimeZone();
      // Anchor date to turn start, interpreted in the user's system timezone.
      const chatDate = formatDateInTimeZone(new Date(startedAtMs), chatTimeZone);
      const emitStatus = createChatStatusEmitter({
        sessionId,
        requestId,
        startedAtMs,
        initialSequence: internalOptions.initialStreamSequence,
        now: options.now,
        onStatusEvent: runtimeOptions.onStatusEvent,
        onStreamEvent: runtimeOptions.onStreamEvent,
        getDomainStateAvailable: () => publicationAuthority.domainStateAvailable(),
        onPersistEvent(event) {
          return persistChatStatusEvent(event, false);
        },
        async onRequiredPersistEvent(event: ChatTaskStatusEvent) {
          await persistChatStatusEvent(event, true);
        },
      });
      const outputAssembler = createChatOutputAssembler(() =>
        new Date(getNowMs(options.now)).toISOString(),
      );
      let accumulatedReasoningProjection = "";
      let terminalStreamEventSent = false;

      function finalizeAssistantOutput(content: string): {
        outputParts?: ChatOutputPart[];
      } {
        outputAssembler.setFinalText(redactCredentialString(content));
        const outputParts = outputAssembler.parts();
        return {
          ...(outputParts.length > 0 ? { outputParts } : {}),
        };
      }

      function emitOutputPart(
        part: ChatOutputPart,
        provenance: { domainStateAvailable?: false } = {},
      ) {
        emitStatus.sendStreamEvent({
          type: "output_part",
          part,
          ...provenance,
        });
      }

      const causalTurnId = createConversationTurnId(requestId);
      const requestClaim = internalOptions.requestClaim !== undefined
        ? internalOptions.requestClaim
        : await guidedInput.claimChatRequest({
            requestId,
            turnId: causalTurnId,
            messageInput: input,
            preparedInput: preparation.value,
            createdAt: new Date(startedAtMs).toISOString(),
          });
      const claimBinding = resolveDurableConversationBinding(requestClaim?.value);
      const legacyRequestClaim = Boolean(
        requestClaim?.value
        && resolveConversationRequestFingerprintVersion(requestClaim.value)
          === LEGACY_CONVERSATION_REQUEST_FINGERPRINT_VERSION,
      );
      if (legacyRequestClaim) {
        await options.conversationCausalStore?.addRefs({
          requestId,
          refs: [],
          coverage: {
            state: "degraded",
            reasonCodes: ["legacy_request_fingerprint"],
          },
        }).catch(() => undefined);
      }
      currentCausalAttempt = requestClaim?.value?.attempts.at(-1)?.attempt ?? 0;

      async function ensureCausalAttempt(): Promise<void> {
        if (!options.conversationCausalStore) {
          currentCausalAttempt = Math.max(1, currentCausalAttempt);
          return;
        }
        const current = await options.conversationCausalStore.getRequest(requestId);
        const last = current?.attempts.at(-1);
        if (last?.state === "accepted") {
          currentCausalAttempt = last.attempt;
          return;
        }
        if (last?.state === "active") {
          currentCausalAttempt = last.attempt;
          return;
        }
        const nextAttempt = (last?.attempt ?? 0) + 1;
        const begun = await options.conversationCausalStore.beginAttempt({
          requestId,
          attempt: nextAttempt,
        });
        if (begun.disposition !== "applied" && begun.disposition !== "duplicate") {
          throw new Error("Conversation causal attempt could not be started.");
        }
        currentCausalAttempt = nextAttempt;
      }

      async function emitTerminalStreamEvent(event: {
        type: "completed" | "failed" | "canceled";
        message?: string;
        finalMessageId?: string;
        domainStateAvailable?: false;
      }) {
        if (terminalStreamEventSent) {
          return;
        }
        const domainStateAvailable =
          event.domainStateAvailable === false
            || !publicationAuthority.domainStateAvailable()
            ? false as const
            : undefined;
        if (
          event.message &&
          (event.type === "failed" || event.type === "canceled")
        ) {
          emitOutputPart(
            outputAssembler.appendDiagnostic({
              severity: event.type === "failed" ? "error" : "warning",
              title: event.type === "failed" ? "请求失败" : "请求已取消",
              message: event.message,
            }),
            domainStateAvailable === false
              ? { domainStateAvailable: false }
              : {},
          );
        }
        terminalStreamEventSent = true;
        await emitStatus.drainPersistence();
        emitStatus.sendTerminalEvent({
          ...event,
          ...(domainStateAvailable === false
            ? { domainStateAvailable: false as const }
            : {}),
        });
      }

      async function settleClaimOwnedFailure(message: string): Promise<void> {
        const durableSessionId = publicationAuthority.durableSessionId();
        if (durableSessionId && options.chatSessionStore?.appendActivityEvent) {
          try {
            await emitStatus.sendRequired({
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
              invalidatePublicationAuthority("claim_terminal_activity_write_failed");
            }
            await options.conversationCausalStore?.addRefs({
              requestId,
              refs: [],
              coverage: {
                state: "degraded",
                reasonCodes: ["claim_terminal_activity_write_failed"],
              },
            }).catch(() => undefined);
            emitStatus.sendPublishedOnly({
              state: "failed",
              message,
              toolCallsExecuted: 0,
            });
          }
        } else {
          invalidatePublicationAuthority(
            durableSessionId
              ? "chat_activity_adapter_unavailable"
              : "session_binding_unproven",
          );
          await options.conversationCausalStore?.addRefs({
            requestId,
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
          emitStatus.sendPublishedOnly({
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

      const replaySessionId = options.conversationCausalStore
        ? claimBinding?.sessionId
        : sessionId;
      const persistedRequestTurnCandidate =
        replaySessionId && input.requestId && options.chatSessionStore?.get
          ? await findPersistedRequestTurn(
              options.chatSessionStore,
              replaySessionId,
              input.requestId,
            )
          : null;
      if (
        claimBinding
        && persistedRequestTurnCandidate?.user?.id !== claimBinding.userMessageId
      ) {
        await settleClaimOwnedFailure(
          "持久化会话消息与 request 因果归属不一致，已拒绝重放。",
        );
        return {
          ok: false,
          code: "CONFLICT",
          message: "持久化会话消息与 request 因果归属不一致，已拒绝重放。",
        };
      }
      const persistedRequestTurn = claimBinding
        ? persistedRequestTurnCandidate?.user?.id === claimBinding.userMessageId
          ? persistedRequestTurnCandidate
          : null
        : options.conversationCausalStore
          ? null
          : persistedRequestTurnCandidate;
      if (persistedRequestTurn?.user) {
        sessionId = persistedRequestTurn.session.id;
        if (!publicationAuthority.markDurable(sessionId, persistedRequestTurn.user.id)) {
          invalidatePublicationAuthority("durable_binding_conflict");
        }
        emitStatus.setSessionId(sessionId);
        internalOptions.onDurableSessionResolved?.(sessionId);
      } else if (requestClaim?.value?.sessionId && !claimBinding) {
        await options.conversationCausalStore?.addRefs({
          requestId,
          refs: [],
          coverage: {
            state: "degraded",
            reasonCodes: ["session_binding_unproven"],
          },
        }).catch(() => undefined);
      }
      if (requestClaim?.disposition === "conflict") {
        await settleClaimOwnedFailure(
          "相同 requestId 已绑定到不同输入，已拒绝冲突重放。",
        );
        return {
          ok: false,
          message: "相同 requestId 已绑定到不同输入，已拒绝冲突重放。",
        };
      }
      if (persistedRequestTurn?.assistant) {
        const persistedAssistant = persistedRequestTurn.assistant;
        const replaySettlementStatus =
          persistedAssistant.turnSettlementStatus ?? "unknown";
        const persistedMessage = {
          id: persistedAssistant.id,
          role: persistedAssistant.role,
          requestId,
          turnId: causalTurnId,
          content: persistedAssistant.content,
          turnSettlementStatus: persistedAssistant.turnSettlementStatus,
        };
        let accepted;
        if (options.conversationCausalStore) {
          const witnessedAttempt = persistedAssistant.causalAttempt;
          const expectedAttemptId = witnessedAttempt !== undefined
            ? createConversationCausalAttemptId({
                requestId,
                turnId: causalTurnId,
                attempt: witnessedAttempt,
              })
            : null;
          const hasExactAttemptWitness =
            persistedAssistant.requestId === requestId
            && persistedAssistant.turnId === causalTurnId
            && witnessedAttempt !== undefined
            && witnessedAttempt > 0
            && persistedAssistant.causalAttemptId === expectedAttemptId;
          if (
            replaySettlementStatus === "failed"
            || replaySettlementStatus === "canceled"
          ) {
            currentCausalAttempt = Math.max(1, witnessedAttempt ?? 1);
            return {
              ok: false,
              code: "CONFLICT",
              message: "已持久化回复与因果收据冲突，未重放执行。",
            };
          }
          const receiptOwnedAttempt = hasExactAttemptWitness
            ? requestClaim?.value?.attempts.find((attempt) =>
                attempt.attempt === witnessedAttempt,
              )
            : requestClaim?.value?.attempts.find((attempt) =>
                (
                  attempt.state === "accepted"
                  && attempt.acceptedSettlement?.acceptedMessageId
                    === persistedAssistant.id
                )
                || attempt.assistantAcceptance?.acceptedSettlement.acceptedMessageId
                  === persistedAssistant.id,
              );
          if (!receiptOwnedAttempt) {
            await options.conversationCausalStore.addRefs({
              requestId,
              refs: [],
              coverage: {
                state: "degraded",
                reasonCodes: ["assistant_attempt_witness_missing"],
              },
            }).catch(() => undefined);
            return {
              ok: false,
              code: "CONFLICT",
              message: "已持久化回复缺少可验证的尝试归属，只能作为历史记录读取。",
            };
          }
          currentCausalAttempt = receiptOwnedAttempt.attempt;
          if (receiptOwnedAttempt.assistantAcceptance?.state === "preparing") {
            const prepared = await options.conversationCausalStore
              .prepareAssistantAcceptance({
                requestId,
                attempt: receiptOwnedAttempt.attempt,
                persistedMessage,
                ...(receiptOwnedAttempt.assistantAcceptance.workspaceRunId
                  ? {
                      workspaceRunId:
                        receiptOwnedAttempt.assistantAcceptance.workspaceRunId,
                    }
                  : {}),
              });
            if (
              prepared.disposition !== "applied"
              && prepared.disposition !== "duplicate"
            ) {
              return {
                ok: false,
                code: "CONFLICT",
                message: "已持久化回复与因果准备记录冲突，未发布成功。",
              };
            }
            const preparation = prepared.value?.attempts.find((attempt) =>
              attempt.attempt === receiptOwnedAttempt.attempt,
            )?.assistantAcceptance;
            if (!preparation) {
              throw new AssistantAcceptanceRecoveryRequiredError(
                createAssistantAcceptanceRecoveryResult(),
              );
            }
            let workspaceEventId: string | undefined;
            if (preparation.requiredDomains.includes("workspace")) {
              if (!options.workspaceRunStore || !preparation.workspaceRunId) {
                throw new AssistantAcceptanceRecoveryRequiredError(
                  createAssistantAcceptanceRecoveryResult(),
                );
              }
              const workspaceSettlement =
                await settlePreparedWorkspaceAssistantAcceptance({
                  workspaceRunStore: options.workspaceRunStore,
                  workspaceRunId: preparation.workspaceRunId,
                  acceptance: preparation,
                });
              workspaceEventId = workspaceSettlement.eventId;
              if (workspaceSettlement.disposition === "recovery_required") {
                throw new AssistantAcceptanceRecoveryRequiredError(
                  createAssistantAcceptanceRecoveryResult(),
                );
              }
            }
            const committed = await commitPreparedAssistantAcceptance({
              conversationCausalStore: options.conversationCausalStore,
              requestId,
              attempt: receiptOwnedAttempt.attempt,
              acceptance: preparation,
              workspaceEventId,
            });
            if (committed === "recovery_required") {
              throw new AssistantAcceptanceRecoveryRequiredError(
                createAssistantAcceptanceRecoveryResult(),
              );
            }
            accepted = {
              disposition: "duplicate" as const,
              value: await options.conversationCausalStore.getRequest(requestId)
                ?? undefined,
            };
          } else if (hasExactAttemptWitness) {
            currentCausalAttempt = witnessedAttempt;
            accepted = await options.conversationCausalStore.reconcileAssistant({
              requestId,
              attempt: witnessedAttempt,
              causalAttemptId: expectedAttemptId!,
              persistedMessage,
            });
          } else {
            accepted = await options.conversationCausalStore.acceptAssistant({
              requestId,
              attempt: receiptOwnedAttempt.attempt,
              persistedMessage,
            });
          }
        } else {
          currentCausalAttempt = Math.max(1, persistedAssistant.causalAttempt ?? 1);
        }
        if (
          accepted
          && accepted.disposition !== "applied"
          && accepted.disposition !== "duplicate"
        ) {
          return {
            ok: false,
            code: "CONFLICT",
            message: "已持久化回复与因果收据冲突，未重放执行。",
          };
        }
        const acceptedAttempt = accepted?.value?.attempts.find((attempt) =>
          attempt.acceptedSettlement?.acceptedMessageId === persistedAssistant.id
          || attempt.assistantAcceptance?.acceptedSettlement.acceptedMessageId
            === persistedAssistant.id,
        );
        const expectedWorkspaceRunId =
          acceptedAttempt?.assistantAcceptance?.workspaceRunId
          ?? createChatWorkspaceRunId(sessionId, requestId);
        const persistedWorkspaceRunId = accepted?.value?.refs.some(
          (ref) =>
            ref.kind === "workspace_run"
            && ref.id === expectedWorkspaceRunId,
        )
          ? expectedWorkspaceRunId
          : undefined;
        const expectsWorkspaceReconciliation = Boolean(
          options.workspaceRunStore
          || acceptedAttempt?.assistantAcceptance?.workspaceRunId
          || accepted?.value?.refs.some((ref) => ref.kind === "workspace_run"),
        );
        if (
          persistedWorkspaceRunId
          && options.workspaceRunStore
          && replaySettlementStatus === "succeeded"
        ) {
          const repairEventId = `chat_status_${createConversationRequestFingerprint({
            requestId,
            state: "completed",
            acceptedMessageId: persistedAssistant.id,
          })}`;
          try {
            await options.workspaceRunStore.settleLifecycle({
              workspaceRunId: persistedWorkspaceRunId,
              event: {
                id: repairEventId,
                createdAt: persistedAssistant.createdAt,
                type: "status",
                status: "succeeded",
                message: "Recovered accepted assistant reply.",
                causalRef: {
                  turnId: causalTurnId,
                  sourceSequence: 0,
                },
              },
              snapshotStatus: "succeeded",
              summary: "Recovered accepted assistant reply.",
            });
          } catch {
            await options.conversationCausalStore?.addRefs({
              requestId,
              refs: [{ kind: "workspace_run", id: persistedWorkspaceRunId }],
              coverage: {
                state: "degraded",
                reasonCodes: ["workspace_accept_reconcile_failed"],
              },
            }).catch(() => undefined);
          }
        } else if (
          replaySettlementStatus === "succeeded"
          && accepted?.value
          && expectsWorkspaceReconciliation
        ) {
          await options.conversationCausalStore?.addRefs({
            requestId,
            refs: [],
            coverage: {
              state: "degraded",
              reasonCodes: [
                persistedWorkspaceRunId
                  ? "workspace_accept_reconcile_unavailable"
                  : "workspace_owner_ref_missing",
              ],
            },
          }).catch(() => undefined);
        } else if (replaySettlementStatus === "unknown") {
          await options.conversationCausalStore?.addRefs({
            requestId,
            refs: persistedWorkspaceRunId
              ? [{ kind: "workspace_run", id: persistedWorkspaceRunId }]
              : [],
            coverage: {
              state: "degraded",
              reasonCodes: ["legacy_turn_settlement_unknown"],
            },
          }).catch(() => undefined);
        }
        emitStatus.setAssistantMessageId(persistedAssistant.id);
        emitStatus.sendAttemptControl({
          operation: "accepted",
          attempt: Math.max(1, currentCausalAttempt),
        });
        await emitTerminalStreamEvent({
          type:
            replaySettlementStatus === "failed"
              ? "failed"
              : replaySettlementStatus === "canceled"
                ? "canceled"
                : "completed",
          message: persistedAssistant.content,
          finalMessageId: persistedAssistant.id,
        });
        return {
          ok: true,
          reply: persistedAssistant.content,
          sessionId,
          relatedMemories: [],
          memoryId: null,
          turnSettlementStatus: replaySettlementStatus,
        };
      }
      if (legacyRequestClaim) {
        await settleClaimOwnedFailure(
          "旧版请求记录只能读取已持久化结果，无法安全恢复执行；请重新发送为新请求。",
        );
        return {
          ok: false,
          code: "CONFLICT",
          message:
            "旧版请求记录只能读取已持久化结果，无法安全恢复执行；请重新发送为新请求。",
        };
      }
      if (
        requestClaim?.disposition === "duplicate"
        && !internalOptions.skipUserMessageAppend
      ) {
        return {
          ok: false,
          retryable: true,
          message: "相同请求仍在处理中，未启动第二次执行。",
        };
      }

      const persistStage = createLegacyPersistStage({
        options,
        sessionId: () => sessionId,
        causalTurnId: () => causalTurnId,
        requestId,
        currentCausalAttempt: () => currentCausalAttempt,
        workspaceRunRecorder: () => workspaceRunRecorder,
        finalizeAssistantOutput,
        emitStatus,
        emitTerminalStreamEvent,
      } as unknown as Parameters<typeof createLegacyPersistStage>[0]);

      const workspaceResolution = internalOptions.preResolvedRunContext
        ? { ok: true as const, runContext: internalOptions.preResolvedRunContext }
        : await resolveChatWorkspace({
            workspaceService: options.workspaceService,
            workspaceId: input.workspaceId,
          });
      if (!workspaceResolution.ok) {
        await emitTerminalStreamEvent({
          type: "failed",
          message: workspaceResolution.message,
        });
        return {
          ok: false,
          message: workspaceResolution.message,
        };
      }
      let chatRunContext = workspaceResolution.runContext;
      const workspaceSummary =
        internalOptions.preResolvedWorkspaceSummary ??
        (chatRunContext ? buildChatWorkspaceSummary(chatRunContext) : input.workspaceSummary);
      let userMessageId: string | null = null;
      let authoritativeHistory: ChatHistoryMessage[] | null = null;
      let sessionMessageCount = 0;
      let sessionCompactionBaseline = 0;
      let activeGoal: ChatSessionGoalSummary | null = null;
      if (
        options.chatSessionStore &&
        !internalOptions.skipUserMessageAppend &&
        !persistedRequestTurn?.user
      ) {
        const appendResult = await options.chatSessionStore.appendMessage({
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          role: "user",
          requestId,
          content: userMessage,
          ...(processedAttachments.metadata.length
            ? { attachments: processedAttachments.metadata }
            : {}),
          ...(chatRunContext?.workspaceId || input.workspaceId
            ? { workspaceId: chatRunContext?.workspaceId ?? input.workspaceId }
            : {}),
          ...(workspaceSummary ? { workspaceSummary } : {}),
        });
        sessionId = appendResult.session.id;
        userMessageId = appendResult.message.id;
        if (!publicationAuthority.markDurable(sessionId, userMessageId)) {
          invalidatePublicationAuthority("durable_binding_conflict");
          throw new Error("Conversation publication authority rejected the durable user message.");
        }
        emitStatus.setSessionId(sessionId);
        internalOptions.onDurableSessionResolved?.(sessionId);
        authoritativeHistory = appendResult.session.messages
          .filter((message) => message.id !== userMessageId)
          .map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.attachments?.length
              ? { attachments: message.attachments }
              : {}),
          }));
        sessionMessageCount = appendResult.session.messages.length;
        sessionCompactionBaseline =
          appendResult.session.context?.compactionCount ?? 0;
        activeGoal = getActiveGoalSummary(appendResult.session);
      } else if (persistedRequestTurn?.user) {
        sessionId = persistedRequestTurn.session.id;
        userMessageId = persistedRequestTurn.user.id;
        if (!publicationAuthority.markDurable(sessionId, userMessageId)) {
          invalidatePublicationAuthority("durable_binding_conflict");
          throw new Error("Conversation publication authority rejected the persisted user message.");
        }
        emitStatus.setSessionId(sessionId);
        internalOptions.onDurableSessionResolved?.(sessionId);
        authoritativeHistory = persistedRequestTurn.session.messages
          .filter((message) => message.id !== persistedRequestTurn.user?.id)
          .map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.attachments?.length
              ? { attachments: message.attachments }
              : {}),
          }));
        sessionMessageCount = persistedRequestTurn.session.messages.length;
        sessionCompactionBaseline =
          persistedRequestTurn.session.context?.compactionCount ?? 0;
      } else if (internalOptions.skipUserMessageAppend) {
        const expectedUserMessageId = internalOptions.userMessageId ?? null;
        const storedSession =
          options.chatSessionStore?.get && input.sessionId
            ? await options.chatSessionStore.get(input.sessionId)
            : null;
        const storedUserMessage = expectedUserMessageId
          ? storedSession?.messages.find(
              (message) =>
                message.id === expectedUserMessageId && message.role === "user",
            )
          : null;
        if (storedSession && storedUserMessage) {
          sessionId = storedSession.id;
          userMessageId = storedUserMessage.id;
          if (!publicationAuthority.markDurable(sessionId, userMessageId)) {
            invalidatePublicationAuthority("durable_binding_conflict");
            throw new Error("Conversation publication authority rejected the guided-input user message.");
          }
          emitStatus.setSessionId(sessionId);
          internalOptions.onDurableSessionResolved?.(sessionId);
          authoritativeHistory = storedSession.messages
            .filter((message) => message.id !== userMessageId)
            .map((message) => ({
              role: message.role,
              content: message.content,
              ...(message.attachments?.length
                ? { attachments: message.attachments }
                : {}),
            }));
          sessionMessageCount = storedSession.messages.length;
          sessionCompactionBaseline =
            storedSession.context?.compactionCount ?? 0;
        }
      }
      if (options.conversationCausalStore) {
        if (!userMessageId) {
          await settleClaimOwnedFailure(
            "用户消息尚未持久化，无法安全开始或恢复执行。",
          );
          return {
            ok: false,
            retryable: true,
            message: "用户消息尚未持久化，无法安全开始或恢复执行。",
          };
        }
        const bound = await options.conversationCausalStore.bindRequest({
          requestId,
          sessionId,
          userMessageId,
        });
        if (bound.disposition === "conflict" || bound.disposition === "not_found") {
          await settleClaimOwnedFailure(
            "会话消息与 request 因果绑定冲突，已停止执行。",
          );
          return {
            ok: false,
            message: "会话消息与 request 因果绑定冲突，已停止执行。",
          };
        }
        const boundBinding = resolveDurableConversationBinding(bound.value);
        if (!boundBinding || boundBinding.userMessageId !== userMessageId) {
          invalidatePublicationAuthority("causal_binding_missing_user_message");
          throw new Error("Conversation causal binding did not return a durable session.");
        }
        sessionId = boundBinding.sessionId;
        if (!publicationAuthority.markDurable(sessionId, boundBinding.userMessageId)) {
          invalidatePublicationAuthority("durable_binding_conflict");
          throw new Error("Conversation publication authority rejected the causal binding.");
        }
        emitStatus.setSessionId(sessionId);
        internalOptions.onDurableSessionResolved?.(sessionId);
      }
      await ensureCausalAttempt();
      if (processedAttachments.validatedInputs.length) {
        guidedInput.cacheHistoryAttachmentPayloads(
          sessionId,
          processedAttachments.validatedInputs,
          startedAtMs,
        );
      } else {
        guidedInput.pruneHistoryAttachmentPayloads(startedAtMs);
      }
      if (chatRunContext) {
        chatRunContext = {
          ...chatRunContext,
          sessionId,
        };
        try {
          workspaceRunRecorder = await createChatWorkspaceRunRecorder({
            workspaceRunStore: options.workspaceRunStore,
            sessionId,
            requestId,
            runContext: chatRunContext,
            ...(input.selectedSkillName
              ? { selectedSkillName: input.selectedSkillName }
              : {}),
            createdAt: new Date(startedAtMs).toISOString(),
          });
          internalOptions.onWorkspaceRunRecorderResolved?.(workspaceRunRecorder);
        } catch (error) {
          if (error instanceof WorkspaceRunEnvelopeConflictError) {
            await options.conversationCausalStore?.addRefs({
              requestId,
              refs: [],
              coverage: {
                state: "degraded",
                reasonCodes: ["workspace_run_envelope_conflict"],
              },
            }).catch(() => undefined);
            await emitTerminalStreamEvent({
              type: "failed",
              message: "工作区运行状态与当前请求不一致，已安全停止。",
            });
            return {
              ok: false,
              code: "CONFLICT",
              message: "工作区运行状态与当前请求不一致，已安全停止。",
            };
          }
          const failure = toSecretSafeFailure(
            error,
            "WORKSPACE_RUN_INITIALIZATION_FAILED",
          );
          invalidatePublicationAuthority("workspace_run_initialize_failed");
          await options.conversationCausalStore?.addRefs({
            requestId,
            refs: [],
            coverage: {
              state: "degraded",
              reasonCodes: [...failure.coverageReasonCodes],
            },
          }).catch(() => undefined);
          emitStatus.sendPublishedOnly({
            state: "failed",
            message: failure.publicMessage,
          });
          await emitTerminalStreamEvent({
            type: "failed",
            message: failure.publicMessage,
            domainStateAvailable: false,
          });
          return {
            ok: false,
            code: "INTERNAL_ERROR",
            retryable: failure.retryable,
            message: failure.publicMessage,
            domainStateAvailable: false,
          };
        }
        if (options.workspaceRunStore && !workspaceRunRecorder) {
          await options.conversationCausalStore?.addRefs({
            requestId,
            refs: [],
            coverage: {
              state: "degraded",
              reasonCodes: ["workspace_run_initialize_failed"],
            },
          }).catch(() => undefined);
        }
        emitStatus.send({
          state: "workspace",
          message: `工作区：${workspaceSummary?.name ?? chatRunContext.workspaceRoot}`,
          workspaceId: chatRunContext.workspaceId,
          ...(workspaceSummary ? { workspaceSummary } : {}),
        });
      }
      appendRawHistoryEntry({
        historyIndexStore: options.historyIndexStore,
        createId,
        sessionId,
        requestId,
        role: "user",
        content: userMessage,
        workspaceId: chatRunContext?.workspaceId ?? input.workspaceId,
        createdAt: new Date(startedAtMs).toISOString(),
      });

      if (options.planService) {
        const inputRoutingPlan =
          preexistingInputRoutingPlan ??
          (await options.planService.getInputRoutingPlan(sessionId));
        if (inputRoutingPlan) {
          if (internalOptions.skipUserMessageAppend) {
            const reply =
              "当前会话已进入只读 Plan Mode，这个更早的 Skill 输入已作废；没有启动 Skill、普通 Agent 或写入工具。请直接在 Plan 输入框补充要求。";
            await emitStatus.sendRequired({
              state: "paused",
              message: "旧 Skill 输入已作废，当前会话保持只读规划",
              toolCallsExecuted: 0,
            });
            await persistStage.persistAssistantReply({
              content: reply,
              goalEventRef: `plan-invalidated-skill-input:${inputRoutingPlan.id}:${inputRoutingPlan.revision}`,
              settlementStatus: "paused",
            });
            return {
              ok: true,
              reply,
              sessionId,
              relatedMemories: [],
              memoryId: null,
              turnSettlementStatus: "paused",
              plan: inputRoutingPlan,
            };
          }
          const amendmentObjective = extractExplicitGoalAmendmentObjective(
            userMessage,
          );
          if (
            amendmentObjective &&
            inputRoutingPlan.purpose === "runtime_replan" &&
            inputRoutingPlan.goalId
          ) {
            if (!options.proposeGoalAmendment) {
              return {
                ok: false,
                message: "当前运行时未启用受控 Goal 修订服务。",
              };
            }
            emitStatus.send({
              state: "reasoning",
              message: "正在创建目标修订提案，当前 Goal 和活动 Plan 保持不变",
              toolCallsExecuted: 0,
            });
            const amendment = await options.proposeGoalAmendment(
              inputRoutingPlan.goalId,
              amendmentObjective,
              userMessage,
            );
            if (!amendment.ok) {
              emitStatus.send({
                state: "failed",
                message: amendment.message,
                toolCallsExecuted: 0,
              });
              await emitTerminalStreamEvent({
                type: "failed",
                message: amendment.message,
              });
              return { ok: false, message: amendment.message };
            }
            const reply = `${amendment.message} 当前 Goal 和活动 Plan 尚未改变；请在 Goal 详情中批准或拒绝。`;
            await emitStatus.sendRequired({
              state: "paused",
              message: "目标修订提案等待明确批准",
              toolCallsExecuted: 0,
            });
            await persistStage.persistAssistantReply({
              content: reply,
              goalEventRef: `goal-amendment:${amendment.proposal.id}`,
              settlementStatus: "paused",
            });
            appendRawHistoryEntry({
              historyIndexStore: options.historyIndexStore,
              createId,
              sessionId,
              requestId,
              role: "assistant",
              content: reply,
              workspaceId: chatRunContext?.workspaceId ?? input.workspaceId,
              createdAt: new Date(getNowMs(options.now)).toISOString(),
            });
            return {
              ok: true,
              reply,
              sessionId,
              relatedMemories: [],
              memoryId: null,
              turnSettlementStatus: "paused",
              plan: inputRoutingPlan,
              ...(activeGoal?.id === inputRoutingPlan.goalId
                ? { activeGoal }
                : {}),
            };
          }
          const canRevisePlan =
            inputRoutingPlan.status === "awaiting_input" ||
            inputRoutingPlan.status === "awaiting_confirmation" ||
            (inputRoutingPlan.status === "paused" &&
              Boolean(inputRoutingPlan.finalArtifact));
          if (!canRevisePlan) {
            const reply = formatLockedPlanReply(inputRoutingPlan);
            await emitStatus.sendRequired({
              state: "paused",
              message: "计划仍处于只读状态，请先处理计划恢复入口",
              toolCallsExecuted: 0,
            });
            await persistStage.persistAssistantReply({
              content: reply,
              goalEventRef: `plan-locked:${inputRoutingPlan.id}:${inputRoutingPlan.revision}`,
              settlementStatus: "paused",
            });
            return {
              ok: true,
              reply,
              sessionId,
              relatedMemories: [],
              memoryId: null,
              turnSettlementStatus: "paused",
              plan: inputRoutingPlan,
            };
          }
          emitStatus.send({
            state: "reasoning",
            message: "正在把补充或修改意见纳入只读计划并重新执行规划辩论",
            toolCallsExecuted: 0,
          });
          let continuation;
          try {
            continuation = await options.planService.continueWithInput(
              inputRoutingPlan.id,
              modelUserMessage,
              runtimeOptions.signal,
              input.planAutonomyMode,
            );
          } catch (error) {
            if (isAbortError(error, runtimeOptions.signal)) {
              emitStatus.send({
                state: "canceled",
                message: "规划已中断",
                toolCallsExecuted: 0,
              });
              await emitTerminalStreamEvent({
                type: "canceled",
                message: "已中断任务。",
              });
              return { ok: false, code: "CANCELED", retryable: true, message: "已中断任务。" };
            }
            const message = "继续规划失败，已安全停止。";
            emitStatus.send({
              state: "failed",
              message,
              toolCallsExecuted: 0,
            });
            await emitTerminalStreamEvent({ type: "failed", message });
            return { ok: false, message };
          }
          if (!continuation.ok) {
            emitStatus.send({
              state: "failed",
              message: continuation.message,
              toolCallsExecuted: 0,
            });
            await emitTerminalStreamEvent({
              type: "failed",
              message: continuation.message,
            });
            return { ok: false, message: continuation.message };
          }
          const plan = continuation.plan;
          const reply = formatPlanContinuationReply(plan);
          const planContinuationState =
            plan.status === "awaiting_confirmation" ? "completed" : "paused";
          const planContinuationEvent: Omit<
            ChatTaskStatusEvent,
            "sessionId" | "createdAt" | "elapsedMs"
          > = {
            state: planContinuationState,
            message:
              plan.status === "awaiting_confirmation"
                ? "计划已更新，等待确认"
                : "计划仍需补充信息或处理门禁",
            toolCallsExecuted: 0,
          };
          if (planContinuationState === "paused") {
            await emitStatus.sendRequired(planContinuationEvent);
          } else {
            emitStatus.send(planContinuationEvent);
          }
          await persistStage.persistAssistantReply({
            content: reply,
            goalEventRef: `plan-input:${plan.id}:${plan.revision}`,
            settlementStatus:
              plan.status === "awaiting_confirmation" ? "succeeded" : "paused",
          });
          appendRawHistoryEntry({
            historyIndexStore: options.historyIndexStore,
            createId,
            sessionId,
            requestId,
            role: "assistant",
            content: reply,
            workspaceId: chatRunContext?.workspaceId ?? input.workspaceId,
            createdAt: new Date(getNowMs(options.now)).toISOString(),
          });
          return {
            ok: true,
            reply,
            sessionId,
            relatedMemories: [],
            memoryId: null,
            turnSettlementStatus:
              plan.status === "awaiting_confirmation" ? "succeeded" : "paused",
            plan,
          };
        }
      }

      const pendingContinuation =
        pendingContinuations.get(sessionId) ??
        (await findPersistedChatContinuation({
          sessionId,
          chatSessionStore: options.chatSessionStore,
        }));
      const continuationToResume =
        pendingContinuation &&
        isContinuationRequest(userMessage)
          ? pendingContinuation
          : null;

      if (!continuationToResume && pendingContinuation) {
        pendingContinuations.delete(sessionId);
        await emitStatus.sendRequired({
          state: "checkpoint_boundary",
          message: "新的用户指令已替代上一个暂停检查点。",
          payload: { continuationCleared: true },
        });
      }

      const requestedSkill = internalOptions.forcedSkill
        ? ({ kind: "matched", skill: internalOptions.forcedSkill } as const)
        : !continuationToResume
          ? await resolveRequestedSkill({
              message: userMessage,
              selectedSkillName: input.selectedSkillName,
              discoverSkills: options.discoverSkills,
            })
          : null;
      if (requestedSkill?.kind === "missing") {
        await emitTerminalStreamEvent({
          type: "failed",
          message: requestedSkill.message,
        });
        return {
          ok: false,
          message: requestedSkill.message,
        };
      }

      if (requestedSkill?.kind === "matched") {
        emitStatus.send({
          state: "skill",
          message: `正在调用技能：${requestedSkill.skill.manifest.name}`,
          selectedSkillName: requestedSkill.skill.manifest.name,
        });
      }

      let resolvedSkillInput = internalOptions.resolvedSkillInput;
      if (
        requestedSkill?.kind === "matched" &&
        input.mode !== "goal_plan" &&
        !continuationToResume &&
        !resolvedSkillInput
      ) {
        const inputResolution = resolveSkillInput({
          skill: requestedSkill.skill,
          values: {},
          runContext: chatRunContext,
        });
        if (inputResolution.status !== "complete") {
          const inputRequest = createSkillUserInputRequest({
            createId,
            sessionId,
            requestId,
            skill: requestedSkill.skill,
            inputResolution,
            createdAt: new Date(getNowMs(options.now)).toISOString(),
          });
          const persisted = createPendingSkillInputState({
            inputRequest,
            sessionId,
            requestId,
            userMessage,
            userMessageId,
            selectedSkillName: requestedSkill.skill.manifest.name,
            ...(chatRunContext?.workspaceId ? { workspaceId: chatRunContext.workspaceId } : {}),
            ...(workspaceSummary ? { workspaceSummary } : {}),
            partialValues: inputResolution.values,
            ...(processedAttachments.metadata.length
              ? { attachments: processedAttachments.metadata }
              : {}),
            ...(processedAttachments.validatedInputs.length
              ? { attachmentPayloads: processedAttachments.validatedInputs }
              : {}),
          });
          if (options.conversationCausalStore) {
            const guidedRef = await options.conversationCausalStore.addRefs({
              requestId,
              refs: [{ kind: "guided_input", id: inputRequest.id }],
            });
            if (
              guidedRef.disposition !== "applied"
              && guidedRef.disposition !== "duplicate"
            ) {
              await emitTerminalStreamEvent({
                type: "failed",
                message: "Failed to establish guided input ownership.",
              });
              return {
                ok: false,
                code: "INTERNAL_ERROR",
                message: "Failed to establish guided input ownership.",
              };
            }
          }
          try {
            await emitStatus.sendWaitingForInput(
              inputRequest,
              "Skill input required.",
              persisted,
            );
            emitOutputPart(outputAssembler.appendInputRequest(inputRequest));
          } catch {
            await emitTerminalStreamEvent({
              type: "failed",
              message: "Failed to persist skill input request.",
            });
            return {
              ok: false,
              message: "Failed to persist skill input request.",
            };
          }
          guidedInput.cachePendingSkillInput(inputRequest.id, {
            ...toInMemoryPendingSkillInputState({
              persisted,
              selectedSkill: requestedSkill.skill,
              createdAtMs: startedAtMs,
              ...(processedAttachments.validatedInputs.length
                ? { attachments: processedAttachments.validatedInputs }
                : {}),
              ...(chatRunContext ? { runContext: chatRunContext } : {}),
            }),
            streamSequence: emitStatus.getSequence(),
          });
          return {
            ok: false,
            code: "SKILL_INPUT_REQUIRED",
            message: "Skill input required.",
          };
        }
        resolvedSkillInput = inputResolution;
      }

      const selectedSkillForGoal =
        requestedSkill?.kind === "matched" ? requestedSkill.skill : undefined;
      const selectedSkillInputValuesForGoal =
        resolvedSkillInput?.status === "complete"
          ? resolvedSkillInput.values
          : undefined;
      const goalRoute = await tryRouteGoalIntent({
        route:
          input.mode === "goal_draft" || input.mode === "goal_plan"
            ? {
                kind: "set_goal",
                description: extractGoalDescription(
                  input.mode === "goal_plan" ? modelUserMessage : userMessage,
                ),
              }
            : hasAttachments
              ? { kind: "none" }
              : detectGoalIntent(userMessage),
        activeGoal,
        chatSessionStore: options.chatSessionStore,
        goalService: options.goalService,
        goalDraftService: options.goalDraftService,
        planService: options.planService,
        proposeGoalAmendment: options.proposeGoalAmendment,
        runtimeReplanGoal: options.runtimeReplanGoal,
        usePlanMode: input.mode === "goal_plan",
        planMode: input.planMode ?? "direct",
        planAutonomyMode: input.planAutonomyMode,
        planModelAssignments: input.planModelAssignments,
        originMessageId: userMessageId,
        sessionId,
        requestId,
        persistAssistantReply: persistStage.persistAssistantReply,
        emitStatus,
        now: options.now,
        signal: runtimeOptions.signal,
        workspaceId: chatRunContext?.workspaceId ?? input.workspaceId,
        workspaceRoot: chatRunContext?.workspaceRoot,
        selectedSkill: selectedSkillForGoal,
        selectedSkillInputValues: selectedSkillInputValuesForGoal,
      });

      if (goalRoute) {
        return goalRoute.result;
      }

      if (!continuationToResume && !hasAttachments) {
        const intentRoute = classifyAgentIntent(userMessage);
        const taskCreationResult = requestedSkill
          ? null
          : await tryCreateTaskFromIntent({
              route: intentRoute,
              taskStore: options.taskStore,
            });

        if (taskCreationResult) {
          if (!taskCreationResult.ok) {
            await emitTerminalStreamEvent({
              type: "failed",
              message: taskCreationResult.result.message,
            });
            return taskCreationResult.result;
          }

          const assistantMessageId = await persistStage.persistAssistantReply({
            content: taskCreationResult.result.reply,
          });
          const memoryId = await writeSessionMemory({
            memoryStore: options.memoryStore,
            sessionId,
            userMessage,
            reply: taskCreationResult.result.reply,
            messageIds: compactMessageIds(userMessageId, assistantMessageId),
          });
          await writeAtomicMemories({
            memoryStore: options.memoryStore,
            memoryProfileStore: options.memoryProfileStore,
            sessionId,
            userMessageId,
            assistantMessageId,
            userMessage,
            assistantReply: taskCreationResult.result.reply,
          });

          return {
            ...taskCreationResult.result,
            sessionId,
            relatedMemories: [],
            memoryId,
          };
        }
        let admittedAgentRunId: string | undefined;
        const beforeAgentRunExecution: AgentRunAdmissionGate | undefined =
          options.conversationCausalStore
            ? async (candidate) => {
                if (
                  admittedAgentRunId
                  && admittedAgentRunId !== candidate.runId
                ) {
                  throw new Error("Scheduled AgentRun changed its admitted identity.");
                }
                if (candidate.sessionId !== sessionId) {
                  throw new Error("Scheduled AgentRun session admission mismatch.");
                }
                const executionRevision = candidate.executionRevision ?? 1;
                if (
                  !Number.isSafeInteger(executionRevision)
                  || executionRevision < 1
                ) {
                  throw new Error("Scheduled AgentRun execution revision is invalid.");
                }
                let linked;
                try {
                  linked = await options.conversationCausalStore!.admitAgentRun({
                    requestId,
                    runId: candidate.runId,
                    taskId: candidate.taskId,
                    sessionId,
                    executionRevision,
                  });
                } catch {
                  throw new Error("Scheduled AgentRun causal admission failed.");
                }
                if (
                  linked.disposition !== "applied"
                  && linked.disposition !== "duplicate"
                ) {
                  throw new Error("Scheduled AgentRun causal admission failed.");
                }
                admittedAgentRunId = candidate.runId;
                const started = await options.conversationCausalStore!
                  .settleAgentRunAdmission({
                    requestId,
                    runId: candidate.runId,
                    expectedExecutionRevision: executionRevision,
                    state: "started",
                  });
                if (
                  started.disposition !== "applied"
                  && started.disposition !== "duplicate"
                ) {
                  throw new Error("Scheduled AgentRun causal start failed.");
                }
                return {
                  runId: candidate.runId,
                  taskId: candidate.taskId,
                  executionRevision,
                  async settle(status, expectedExecutionRevision = executionRevision) {
                    if (expectedExecutionRevision !== executionRevision) {
                      throw new Error(
                        "Scheduled AgentRun settlement revision does not match its lease.",
                      );
                    }
                    const finalStatus =
                      status === "waiting_for_approval" ? "paused" : status;
                    if (
                      finalStatus !== "succeeded"
                      && finalStatus !== "paused"
                      && finalStatus !== "failed"
                      && finalStatus !== "canceled"
                    ) {
                      throw new Error("Scheduled AgentRun settled with a non-terminal status.");
                    }
                    const settled = await options.conversationCausalStore!
                      .settleAgentRunAdmission({
                        requestId,
                        runId: candidate.runId,
                        expectedExecutionRevision,
                        state: "settled",
                        finalStatus,
                      });
                    if (
                      settled.disposition !== "applied"
                      && settled.disposition !== "duplicate"
                    ) {
                      throw new Error("Scheduled AgentRun causal settlement failed.");
                    }
                  },
                };
              }
            : undefined;
        const taskRunResult = requestedSkill
          ? null
          : await tryRunTaskFromIntent({
              route: intentRoute,
              message: userMessage,
              sessionId,
              taskStore: options.taskStore,
              runScheduledTask: options.runScheduledTask,
              beforeExecution: beforeAgentRunExecution,
            });

        if (taskRunResult) {
          const settledRun = taskRunResult.result.executedRun;
          const executedRunId = settledRun?.id;
          if (
            options.conversationCausalStore
            && (admittedAgentRunId || executedRunId)
          ) {
            if (!executedRunId || admittedAgentRunId !== executedRunId) {
              throw new Error("Scheduled runner bypassed causal admission.");
            }
            const settledAdmission = (
              await options.conversationCausalStore.getRequest(requestId)
            )?.agentRunAdmissions?.find(
              (admission) => admission.runId === executedRunId,
            );
            const expectedFinalStatus =
              settledRun?.status === "waiting_for_approval"
                ? "paused"
                : settledRun?.status;
            if (
              settledAdmission?.state !== "settled"
              || settledAdmission.finalStatus !== expectedFinalStatus
            ) {
              throw new Error("Scheduled runner returned before causal settlement.");
            }
          }
          if (!taskRunResult.ok) {
            const failedRun = taskRunResult.result.executedRun;
            if (failedRun) {
              await emitStatus.sendRequired({
                state: failedRun.status === "canceled" ? "canceled" : "failed",
                message: taskRunResult.result.message,
                toolCallsExecuted: 0,
              });
              await persistStage.persistAssistantReply({
                content: taskRunResult.result.message,
                executedRunId: failedRun.id,
                settlementStatus:
                  failedRun.status === "canceled" ? "canceled" : "failed",
                terminalType:
                  failedRun.status === "canceled" ? "canceled" : "failed",
              });
            } else {
              await emitTerminalStreamEvent({
                type: "failed",
                message: taskRunResult.result.message,
              });
            }
            return taskRunResult.result;
          }

          if (taskRunResult.result.turnSettlementStatus === "paused") {
            await emitStatus.sendRequired({
              state: "paused",
              message: taskRunResult.result.reply,
              toolCallsExecuted: 0,
            });
          }
          const assistantMessageId = await persistStage.persistAssistantReply({
            content: taskRunResult.result.reply,
            executedRunId,
            settlementStatus:
              taskRunResult.result.turnSettlementStatus === "paused"
                ? "paused"
                : "succeeded",
          });
          const memoryId = await writeSessionMemory({
            memoryStore: options.memoryStore,
            sessionId,
            userMessage,
            reply: taskRunResult.result.reply,
            messageIds: compactMessageIds(userMessageId, assistantMessageId),
          });
          await writeAtomicMemories({
            memoryStore: options.memoryStore,
            memoryProfileStore: options.memoryProfileStore,
            sessionId,
            userMessageId,
            assistantMessageId,
            userMessage,
            assistantReply: taskRunResult.result.reply,
          });

          return {
            ...taskRunResult.result,
            sessionId,
            relatedMemories: [],
            memoryId,
          };
        }
      }

      let profile: AgentModelProfile;
      try {
        emitStatus.send({
          state: "started",
          message: "正在读取模型配置",
        });
        profile = await options.getModelProfile();
      } catch (error) {
        const incompleteProfile =
          error instanceof Error
          && error.message.includes("Model profile is incomplete");
        const failureMessage = incompleteProfile
          ? "模型配置不完整：请先在设置中保存 base URL、对话模型和 API Key。"
          : "无法读取模型配置，请检查设置后重试。";
        emitStatus.send({
          state: "failed",
          message: failureMessage,
        });
        if (incompleteProfile) {
          await emitTerminalStreamEvent({
            type: "failed",
            message: failureMessage,
          });
          return {
            ok: false,
            message: failureMessage,
          };
        }

        await emitTerminalStreamEvent({
          type: "failed",
          message: failureMessage,
        });
        return {
          ok: false,
          message: failureMessage,
        };
      }

      let relatedMemoryResults: MemorySearchResult[] = [];
      let chatMessages: ChatMessage[] = [];
      if (continuationToResume) {
        chatMessages = buildContinuationMessages({
          continuation: continuationToResume,
          userMessage: modelUserMessage,
          images: processedAttachments.images,
        });
      } else {
        emitStatus.send({
          state: "memory",
          message: "正在检索相关记忆",
        });
        relatedMemoryResults = await searchRelatedMemories({
          memoryStore: options.memoryStore,
          query: userMessage,
          limit: memoryLimit,
          sessionId,
        });
        chatMessages = buildChatMessages({
          userMessage: modelUserMessage,
          images: processedAttachments.images,
          // Durable main-process state is authoritative. A renderer can be
          // stale during New Chat or session switches, so its history is used
          // only by compatibility callers that have no session store.
          history: options.chatSessionStore
            ? authoritativeHistory ?? []
            : input.history ?? [],
          relatedMemoryResults,
          historyLimit,
          historyAttachmentReplayBudget:
            createHistoryAttachmentReplayBudget(
              processedAttachments.validatedInputs,
              processedAttachments.textContextCharsUsed,
            ),
          resolveHistoryAttachment(metadata) {
            return guidedInput.resolveHistoryAttachmentPayload(
              sessionId,
              metadata,
              startedAtMs,
            );
          },
        });
        if (requestedSkill?.kind === "matched") {
          chatMessages = injectSkillInvocationMessage(
            chatMessages,
            requestedSkill.skill,
            resolvedSkillInput,
          );
        }
      }

      let reply: string;
      let toolCallsUsed = 0;
      let agentStatus: ChatAgentStatus | undefined;
      let accumulatedUsage: ChatSessionTokenUsage | null = null;

      if (options.toolExecutor) {
        // Unified agent mode: chat goes through agent loop with tool access
        try {
          const toolExecutor = options.toolExecutor;
          const selectedSkill =
            requestedSkill?.kind === "matched" ? requestedSkill.skill : undefined;
          const agentRunContext =
            chatRunContext && selectedSkill
              ? extendRunContextForSelectedSkill({
                  runContext: chatRunContext,
                  selectedSkill,
                  ...(resolvedSkillInput?.status === "complete"
                    ? { skillInputValues: resolvedSkillInput.values }
                    : {}),
                })
              : chatRunContext;
          const loopMaxTurns =
            typeof selectedSkill?.manifest.execution.maxTurns === "number"
              ? normalizeAgentLoopMaxTurns(
                  selectedSkill.manifest.execution.maxTurns,
                )
              : agentLoopMaxTurns;
          const chatRuntimeTask = agentRunContext
            ? createChatRuntimeTask({
                sessionId,
                requestId,
                runContext: agentRunContext,
                selectedSkill,
                ...(resolvedSkillInput?.status === "complete"
                  ? { skillInputValues: resolvedSkillInput.values }
                  : {}),
              })
            : null;
          let observedToolCallsExecuted =
            continuationToResume?.toolCallsExecuted ?? 0;
          const actorToolTasks = new Map<string, string>();
          const emittedActorSpawnIds = new Set<string>();
          const parentEvidenceRunId = continuationToResume?.evidenceRunId;
          const evidence = createChatAgentEvidenceRecorder({
            trajectoryStore: options.trajectoryStore,
            ...(agentRunContext ? { runContext: agentRunContext } : {}),
            createId,
            now: options.now,
          });
          await options.conversationCausalStore?.addRefs({
            requestId,
            refs: [{ kind: "trajectory_run", id: evidence.runId }],
          });
          const toolDefinitions =
            profile.modelCapabilities?.tools === false
              ? []
              : toolExecutor.getRegistry().getDefinitions();
          const runtimeContextSnapshot = createRuntimeContextSnapshotForRun({
            surface: "chat",
            runId: evidence.runId,
            ...(agentRunContext ? { runContext: agentRunContext } : {}),
            modelProfile: profile,
            tools: toolDefinitions,
            getToolSource: (toolName) =>
              getToolRegistrySource(toolExecutor, toolName),
            ...(selectedSkill ? { selectedSkill } : {}),
            permission: {
              taskId:
                chatRuntimeTask?.taskId ?? `chat:${sessionId}:${requestId}`,
              runtimeTaskId:
                chatRuntimeTask?.taskId ?? `chat:${sessionId}:${requestId}`,
              approvalMode: "manual",
              policyLabel:
                chatRuntimeTask?.runtimeTask.policyLabel ??
                "chat workspace contract",
            },
            memory: {
              scopes: buildRuntimeContextMemoryScopes({
                sessionId,
                runContext: agentRunContext,
                selectedSkill,
              }),
              recallBudgetTokens: memoryLimit,
              rawHistoryEnabled: Boolean(options.historyIndexStore),
            },
            checkpoint: {
              strategy: options.compactionStrategy ? "rebuild" : "summarize",
              preserveToolPairs: true,
              protectSkillLoads: true,
              ...(parentEvidenceRunId
                ? {
                    checkpointId: parentEvidenceRunId,
                    boundaryId: requestId,
                  }
                : {}),
            },
            trajectory: {
              ...(workspaceRunRecorder?.workspaceRunId
                ? { workspaceRunId: workspaceRunRecorder.workspaceRunId }
                : {}),
              sessionId,
              requestId,
            },
            createId: () => `runtime_snapshot_${evidence.runId}`,
            now: () => new Date(startedAtMs).toISOString(),
            systemTimeZone: chatTimeZone,
          });
          const runtimeContextSnapshotSummary =
            summarizeAgentRuntimeContextSnapshot(runtimeContextSnapshot);
          const runtimeContextEvidence = await evidence.append(
            "run_context_created",
            {
              runtimeContextSnapshot,
              runtimeContextSnapshotSummary,
              ...(parentEvidenceRunId
                ? {
                    continuationLineage: {
                      parentEvidenceRunId,
                      continuationRequestId: requestId,
                    },
                  }
                : {}),
            },
            {
              containsApiKey: false,
              containsFileContent: false,
              containsUserText: false,
            },
          );
          if (runtimeContextEvidence) {
            await options.conversationCausalStore?.addRefs({
              requestId,
              refs: [{
                kind: "trajectory_event",
                runId: evidence.runId,
                eventId: runtimeContextEvidence.id,
              }],
            });
          }
          emitStatus.send({
            state: "started",
            message: "Runtime context snapshot recorded.",
            payload: {
              runtimeContextSnapshotSummary,
            },
          });
          if (requestedSkill?.kind === "matched") {
            void evidence.append("skill_invoked", {
              skillName: requestedSkill.skill.manifest.name,
              displayName: requestedSkill.skill.manifest.displayName,
            });
          }
          const executeAgentLoop = options.runAgentLoop ?? runAgentLoop;
          // Session history can contain interrupted tool batches from
          // earlier turns (aborts, mid-batch crashes). Repair pair
          // integrity before replaying it to the provider so a stale
          // session can never produce tool_call pairing HTTP 400s.
          const { messages: loopInputMessages } = sanitizeChatMessages(
            chatMessages,
            { unresolvedToolCalls: "trim" },
          );
          const loopResult = await executeAgentLoop(
            loopInputMessages,
            profile,
            {
              chatClient: options.chatClient,
              toolExecutor,
              toolAuthorizationService: options.toolAuthorizationService,
              ...(chatRuntimeTask ? { taskId: chatRuntimeTask.taskId } : {}),
              runId: evidence.runId,
              ...(agentRunContext ? { runContext: agentRunContext } : {}),
              ...(chatRuntimeTask
                ? { runtimeTask: chatRuntimeTask.runtimeTask }
                : {}),
              systemPrompt: buildChatSystemPrompt(chatDate, chatTimeZone),
              maxTurns: loopMaxTurns,
              signal: runtimeOptions.signal,
              tools: toolDefinitions,
              toolResultOffloadStore: options.toolResultOffloadStore,
              toolResultOffloadThreshold: options.toolResultOffloadThreshold,
              toolResultContinuationOwnerId: `chat:${sessionId}`,
              requestId,
              ...(workspaceRunRecorder?.workspaceRunId
                ? { workspaceRunId: workspaceRunRecorder.workspaceRunId }
                : {}),
              ...(options.compactionStrategy
                ? { compactionStrategy: options.compactionStrategy }
                : {}),
              pauseOnTurnLimit: false,
              pauseOnFailureLoop: true,
              autoContinueOutputLimit: true,
              ...(options.maxMode && isMaxModeEnabled()
                ? {
                    modelRequestExecutor: async (request: import("../openAiCompatibleClient").ChatCompletionRequest) => {
                      try {
                        const result = await options.maxMode!.runStep(
                          toCompleteRequest(request),
                          {
                            candidates: 3,
                            judgeModel: profile.model,
                            parentRunId: evidence.runId,
                            ...(runtimeOptions.signal
                              ? { signal: runtimeOptions.signal }
                              : {}),
                          },
                        );
                        return toChatCompletionResponse(result.winner, {
                          provider: profile.providerId,
                          model: profile.model,
                        });
                      } catch (error) {
                        throwIfResponseBodyLimitError(error);
                        return options.chatClient.complete(request);
                      }
                    },
                  }
                : {}),
              ...(continuationToResume
                ? {
                    resumeMessages: loopInputMessages,
                    initialToolCallsExecuted:
                      continuationToResume.toolCallsExecuted,
                  }
                : {}),
              async onModelAttempt(event) {
                if (!options.conversationCausalStore) {
                  if (
                    event.operation === "supersede"
                    || event.operation === "reset"
                  ) {
                    outputAssembler.resetText();
                    accumulatedReasoningProjection = "";
                  }
                  currentCausalAttempt = event.attempt;
                  emitStatus.sendAttemptControl(event);
                  return;
                }
                if (event.operation === "supersede") {
                  const settled = await options.conversationCausalStore.settleAttempt({
                    requestId,
                    attempt: event.supersedesAttempt,
                    state: "superseded",
                    supersedesAttempt: event.supersedesAttempt,
                  });
                  if (
                    settled.disposition !== "applied"
                    && settled.disposition !== "duplicate"
                  ) {
                    throw new Error("Conversation retry supersede conflicted.");
                  }
                  outputAssembler.resetText();
                  accumulatedReasoningProjection = "";
                  currentCausalAttempt = event.attempt;
                  emitStatus.sendAttemptControl(event);
                  return;
                }
                if (event.operation === "reset") {
                  const settled = await options.conversationCausalStore.settleAttempt({
                    requestId,
                    attempt: event.attempt,
                    state: "reset",
                  });
                  if (
                    settled.disposition !== "applied"
                    && settled.disposition !== "duplicate"
                  ) {
                    throw new Error("Conversation attempt reset conflicted.");
                  }
                  outputAssembler.resetText();
                  accumulatedReasoningProjection = "";
                  emitStatus.sendAttemptControl(event);
                  return;
                }
                const begun = await options.conversationCausalStore.beginAttempt({
                  requestId,
                  attempt: event.attempt,
                });
                if (begun.disposition !== "applied" && begun.disposition !== "duplicate") {
                  throw new Error("Conversation retry begin conflicted.");
                }
                currentCausalAttempt = event.attempt;
                emitStatus.sendAttemptControl(event);
              },
              onTurn(turn, phase) {
                void evidence.append("model_request", {
                  turn: turn + 1,
                  phase,
                });
                if (phase === "executing") {
                  emitStatus.send({
                    state: "model",
                    message: `正在调用模型（第 ${turn + 1} 轮）`,
                    turn: turn + 1,
                    toolCallsExecuted: observedToolCallsExecuted,
                  });
                }
              },
              onModelResponse(response, turn) {
                accumulatedUsage = mergeChatSessionTokenUsage(
                  accumulatedUsage,
                  toChatSessionTokenUsage(response.usage),
                );
                void evidence.append("model_response", {
                  turn,
                  hasContent: Boolean(response.content),
                  toolCallCount: response.toolCalls.length,
                  finishReason: response.finishReason,
                });
              },
              onContextUsage(usage) {
                const context = toChatSessionContextSnapshot({
                  usage,
                  sessionMessageCount,
                  historyMessageCount: authoritativeHistory?.length ?? 0,
                  relatedMemoryResults,
                  sessionCompactionBaseline,
                });
                emitStatus.send({
                  state: "context",
                  message: formatContextUsageStatus(context),
                  context,
                  toolCallsExecuted: observedToolCallsExecuted,
                });
              },
              onContextCompacted(event) {
                void evidence.append("context_compacted", event);
              },
              onReasoning(reasoningContent) {
                accumulatedReasoningProjection += reasoningContent;
              },
              onModelStreamEvent(event) {
                emitModelStreamEvent(emitStatus, outputAssembler, event);
              },
              onToolCall(toolName, args, event) {
                if (toolName === "actor") {
                  actorToolTasks.set(
                    event.toolCallId,
                    redactCredentialString(
                      readToolArgString(args, "task") || "subagent",
                    ),
                  );
                }
                void evidence.append("tool_call", {
                  toolName,
                  args,
                  toolCallId: event.toolCallId,
                });
                appendRawHistoryEntry({
                  historyIndexStore: options.historyIndexStore,
                  createId,
                  sessionId,
                  requestId,
                  role: "tool",
                  toolName,
                  content:
                    `Tool call ${toolName}: ` +
                    truncateHistoryContent(
                      stringifyRedactedCredentials(args),
                    ),
                  workspaceId: agentRunContext?.workspaceId,
                  createdAt: new Date(getNowMs(options.now)).toISOString(),
                });
                const nativeDescriptor = getNativeToolDescriptor(
                  toolExecutor,
                  toolName,
                );
                if (nativeDescriptor) {
                  void evidence.append("native_tool_invocation", {
                    ...buildNativeToolEvidencePayload(nativeDescriptor),
                  });
                }
                emitStatus.send({
                  state: "tool_call",
                  message: `正在调用工具：${toolName}`,
                  toolName,
                  toolCallId: event.toolCallId,
                  toolCallsExecuted: observedToolCallsExecuted,
                });
                emitOutputPart(
                  outputAssembler.appendLedgerEvent({
                    status: "running",
                    title: `正在调用工具：${toolName}`,
                    detail: stringifyMaskedPreview(args),
                    toolName,
                  }),
                );
              },
              async onToolInvocation(record) {
                if (options.conversationCausalStore) {
                  const causalRefWrite = await options.conversationCausalStore.addRefs({
                    requestId,
                    refs: [
                      {
                        kind: "tool_invocation",
                        runId: record.runId,
                        id: record.id,
                      },
                      ...(record.approvalId
                        ? [{ kind: "approval" as const, id: record.approvalId }]
                        : []),
                    ],
                  });
                  if (
                    causalRefWrite.disposition !== "applied"
                    && causalRefWrite.disposition !== "duplicate"
                  ) {
                    throw new Error(
                      "Tool Invocation requires durable causal references before dispatch.",
                    );
                  }
                }
                await evidence.append("tool_invocation", {
                  toolInvocationId: record.id,
                  toolCallId: record.toolCallId,
                  toolName: record.toolName,
                  toolSource: record.source,
                  invocationStatus: record.status,
                  ...(record.approvalId ? { approvalId: record.approvalId } : {}),
                  args: record.args,
                  ...(typeof record.ok === "boolean" ? { ok: record.ok } : {}),
                  ...(record.resultRef ? { resultRef: record.resultRef } : {}),
                  ...(record.error ? { error: record.error } : {}),
                  history: record.history,
                });
                const invocationStatusEvent = {
                  state: "tool_invocation",
                  message: `工具状态：${record.toolName} ${record.status}`,
                  toolInvocationId: record.id,
                  ...(record.approvalId ? { approvalId: record.approvalId } : {}),
                  toolCallId: record.toolCallId,
                  toolName: record.toolName,
                  toolSource: record.source,
                  invocationStatus: record.status,
                  ...(record.resultRef ? { resultRef: record.resultRef } : {}),
                  ...(typeof record.ok === "boolean" ? { ok: record.ok } : {}),
                  toolCallsExecuted: observedToolCallsExecuted,
                } as const;
                if (record.status === "waiting_approval") {
                  await emitStatus.sendRequired(invocationStatusEvent);
                } else {
                  emitStatus.send(invocationStatusEvent);
                }
                if (record.status === "waiting_approval") {
                  emitOutputPart(
                    outputAssembler.appendApprovalRequest({
                      approvalId: record.approvalId ?? record.id,
                      toolName: record.toolName,
                      riskLevel: inferApprovalRiskLevel({
                        toolName: record.toolName,
                        source: record.source,
                      }),
                      argsPreview: record.args,
                    }),
                  );
                  emitOutputPart(
                    outputAssembler.appendLedgerEvent({
                      status: "waiting",
                      title: `Waiting for approval: ${record.toolName}`,
                      detail: `Tool ${record.toolName} is waiting for approval.`,
                      toolName: record.toolName,
                    }),
                  );
                }
              },
              onToolRuntimeEvent(toolName, runtimeEvent, event) {
                if (toolName !== "actor") {
                  return;
                }
                if (runtimeEvent.type === "actor_spawned") {
                  const safeTask = redactCredentialString(runtimeEvent.task);
                  actorToolTasks.set(event.toolCallId, safeTask);
                  emitActorSpawnedStatusEvent({
                    emitStatus,
                    actorId: runtimeEvent.actorId,
                    task: safeTask,
                    toolCallId: event.toolCallId,
                    toolCallsExecuted: observedToolCallsExecuted,
                    emittedActorSpawnIds,
                  });
                }
              },
              onToolResult(toolName, ok, result, event) {
                observedToolCallsExecuted += 1;
                appendRawHistoryEntry({
                  historyIndexStore: options.historyIndexStore,
                  createId,
                  sessionId,
                  requestId,
                  role: "tool",
                  toolName,
                  content:
                    `Tool result ${toolName}: ${ok ? "ok" : "error"} ` +
                    truncateHistoryContent(
                      stringifyRedactedCredentials(result),
                    ),
                  workspaceId: agentRunContext?.workspaceId,
                  createdAt: new Date(getNowMs(options.now)).toISOString(),
                });
                const nativeDescriptor = getNativeToolDescriptor(
                  toolExecutor,
                  toolName,
                );
                if (nativeDescriptor) {
                  void evidence.append("native_tool_observation", {
                    ...buildNativeToolEvidencePayload(nativeDescriptor),
                    ok,
                    ...(ok && result && typeof result === "object"
                      ? { resultKeys: Object.keys(result).slice(0, 10) }
                      : {}),
                  });
                }
                void evidence.append("tool_result", {
                  toolName,
                  ok,
                  toolCallId: event.toolCallId,
                  ...(event.resultRef ? { resultRef: event.resultRef } : {}),
                });
                emitStatus.send({
                  state: "tool_result",
                  message: buildToolResultStatusMessage(toolName, result),
                  toolName,
                  toolCallId: event.toolCallId,
                  ...(event.resultRef ? { resultRef: event.resultRef } : {}),
                  ...(typeof event.resultBytes === "number"
                    ? { resultBytes: event.resultBytes }
                    : {}),
                  ok,
                  toolCallsExecuted: observedToolCallsExecuted,
                });
                if (toolName === "actor") {
                  emitActorToolStatusEvents({
                    emitStatus,
                    result,
                    toolCallId: event.toolCallId,
                    task:
                      actorToolTasks.get(event.toolCallId) ?? "subagent",
                    toolCallsExecuted: observedToolCallsExecuted,
                    emittedActorSpawnIds,
                  });
                }
                for (const part of outputAssembler.appendToolResult({
                  toolCallId: event.toolCallId,
                  toolName,
                  ok,
                  ...(ok && result && typeof result === "object" && "result" in result
                    ? {
                        resultPreview: (
                          result as { result: Record<string, unknown> }
                        ).result,
                      }
                    : {}),
                  ...(!ok && result && typeof result === "object" && "error" in result
                    ? {
                        error: (result as { error: string }).error,
                        ...("errorDetails" in result &&
                        (result as { errorDetails?: Record<string, unknown> })
                          .errorDetails
                          ? {
                              resultPreview: (
                                result as {
                                  errorDetails: Record<string, unknown>;
                                }
                              ).errorDetails,
                            }
                          : {}),
                      }
                    : {}),
                })) {
                  emitOutputPart(part);
                }
                emitOutputPart(
                  outputAssembler.appendLedgerEvent({
                    status: ok ? "completed" : "failed",
                    title: buildToolResultStatusMessage(toolName, result),
                    ...(toolName ? { toolName } : {}),
                  }),
                );
              },
            },
          );
          if (accumulatedReasoningProjection) {
            emitStatus.send({
              state: "reasoning",
              message: normalizeReasoningForStatus(
                accumulatedReasoningProjection,
              ),
              toolCallsExecuted: observedToolCallsExecuted,
            });
          }
          reply = outputAssembler.setFinalText(loopResult.summary)?.text
            ?? redactCredentialString(loopResult.summary);
          const finalToolCallsExecuted = Math.max(
            loopResult.toolCallsExecuted,
            observedToolCallsExecuted,
          );
          toolCallsUsed = finalToolCallsExecuted;
          accumulatedUsage = reconcileAgentLoopTokenUsage(
            accumulatedUsage,
            loopResult.tokensConsumed,
          );
          const finalSummaryEvidence = await evidence.append("final_summary", {
            status: loopResult.status,
            toolCallsExecuted: finalToolCallsExecuted,
          });
          await evidence.drain();
          if (finalSummaryEvidence) {
            await options.conversationCausalStore?.addRefs({
              requestId,
              refs: [{
                kind: "trajectory_event",
                runId: evidence.runId,
                eventId: finalSummaryEvidence.id,
              }],
            });
          }

          if (loopResult.status === "canceled") {
            emitStatus.send({
              state: "canceled",
              message: "任务已中断",
              toolCallsExecuted: loopResult.toolCallsExecuted,
            });
            await emitTerminalStreamEvent({
              type: "canceled",
              message: "已中断任务。",
            });
            return {
              ok: false,
              code: "CANCELED",
              retryable: true,
              message: "已中断任务。",
            };
          }

          if (loopResult.status === "paused" && loopResult.continuation) {
            pendingContinuations.set(sessionId, {
              messages: loopResult.messages,
              maxTurns: loopResult.continuation.maxTurns,
              toolCallsExecuted: loopResult.continuation.toolCallsExecuted,
              evidenceRunId: evidence.runId,
              createdAt: Date.now(),
            });
            agentStatus = {
              state: "paused",
              runId: evidence.runId,
              reason: loopResult.continuation.reason,
              maxTurns: loopResult.continuation.maxTurns,
              toolCallsExecuted: finalToolCallsExecuted,
              message: redactCredentialString(loopResult.summary),
              ...(loopResult.modelServiceNotice
                ? { modelServiceNotice: loopResult.modelServiceNotice }
                : {}),
            };
            if (loopResult.modelServiceNotice) {
              emitOutputPart(
                outputAssembler.appendDiagnostic({
                  severity: "warning",
                  title:
                    loopResult.modelServiceNotice.kind === "output_limit"
                      ? "模型输出未完成"
                      : "模型服务暂不可用",
                  message: loopResult.modelServiceNotice.message,
                }),
              );
            }
            await emitStatus.sendRequired({
              state: "paused",
              message:
                loopResult.modelServiceNotice
                  ? loopResult.modelServiceNotice.kind === "output_limit"
                    ? "模型输出被服务商截断，等待你继续"
                    : "模型服务返回限制，等待你重试"
                  : loopResult.continuation.reason === "tool_failure_loop"
                  ? "连续工具失败，等待确认"
                  : loopResult.continuation.reason === "strategy_guard"
                    ? "策略守护触发，等待确认"
                  : "已到达检查点，等待确认",
              maxTurns: loopResult.continuation.maxTurns,
              toolCallsExecuted: finalToolCallsExecuted,
              payload: {
                chatContinuation: toPersistedChatContinuation(
                  pendingContinuations.get(sessionId)!,
                ),
              },
            });
          } else if (loopResult.status === "failed") {
            pendingContinuations.delete(sessionId);
            agentStatus = {
              state: "failed",
              runId: evidence.runId,
              toolCallsExecuted: finalToolCallsExecuted,
              message: redactCredentialString(loopResult.summary),
            };
            await emitStatus.sendRequired({
              state: "failed",
              message: formatAgentLoopFailure(
                redactCredentialString(loopResult.summary),
              ),
              toolCallsExecuted: finalToolCallsExecuted,
            });
          } else {
            pendingContinuations.delete(sessionId);
            agentStatus = {
              state: "completed",
              runId: evidence.runId,
              toolCallsExecuted: finalToolCallsExecuted,
            };
            emitStatus.send({
              state: "completed",
              message: "任务已完成",
              toolCallsExecuted: finalToolCallsExecuted,
            });
          }

          if (toolCallsUsed > 0) {
            reply = `🔧 使用了 ${toolCallsUsed} 个工具\n\n${reply}`;
          }
        } catch (error) {
          if (isAbortError(error, runtimeOptions.signal)) {
            emitStatus.send({
              state: "canceled",
              message: "任务已中断",
            });
            await emitTerminalStreamEvent({
              type: "canceled",
              message: "已中断任务。",
            });
            return {
              ok: false,
              code: "CANCELED",
              retryable: true,
              message: "已中断任务。",
            };
          }
          const failureMessage = toSecretSafeFailure(
            error,
            "AGENT_RUN_EXECUTION_FAILED",
          ).publicMessage;
          const publishFailureStatus = error instanceof RequiredConversationSettlementError
            ? emitStatus.sendPublishedOnly
            : emitStatus.send;
          publishFailureStatus({
            state: "failed",
            message: failureMessage,
          });
          await emitTerminalStreamEvent({
            type: "failed",
            message: failureMessage,
          });
          return {
            ok: false,
            ...(error instanceof RequiredConversationSettlementError
              ? { code: "INTERNAL_ERROR" as const }
              : {}),
            message: failureMessage,
          };
        }
      } else {
        // Fallback: simple LLM chat (no tools)
        const messages: ChatMessage[] = [
          { role: "system", content: buildChatSystemPrompt(chatDate, chatTimeZone) },
          ...chatMessages,
        ];
        try {
          const response = await options.chatClient.complete({
            ...profile,
            messages,
            ...(runtimeOptions.signal ? { signal: runtimeOptions.signal } : {}),
          });
          if (response.reasoningContent) {
            emitStatus.send({
              state: "reasoning",
              message: normalizeReasoningForStatus(response.reasoningContent),
              toolCallsExecuted: 0,
            });
          }
          accumulatedUsage = mergeChatSessionTokenUsage(
            accumulatedUsage,
            toChatSessionTokenUsage(response.usage),
          );
          reply = redactCredentialString(response.content ?? "");
          if (response.modelServiceNotice) {
            const notice = sanitizeModelServiceNotice(
              response.modelServiceNotice,
            );
            const continuationReason =
              modelNoticeContinuationReason(notice);
            pendingContinuations.set(sessionId, {
              messages: [
                ...messages,
                ...(reply
                  ? [{ role: "assistant" as const, content: reply }]
                  : []),
              ],
              maxTurns: 1,
              toolCallsExecuted: 0,
              evidenceRunId: requestId,
              createdAt: Date.now(),
            });
            agentStatus = {
              state: "paused",
              runId: requestId,
              reason: continuationReason,
              maxTurns: 1,
              toolCallsExecuted: 0,
              message: notice.message,
              modelServiceNotice: notice,
            };
            emitOutputPart(
              outputAssembler.appendDiagnostic({
                severity: "warning",
                title:
                  notice.kind === "output_limit"
                    ? "模型输出未完成"
                    : "模型服务暂不可用",
                message: notice.message,
              }),
            );
            await emitStatus.sendRequired({
              state: "paused",
              message:
                notice.kind === "output_limit"
                  ? "模型输出被服务商截断，等待你继续"
                  : "模型服务返回限制，等待你重试",
              maxTurns: 1,
              toolCallsExecuted: 0,
              payload: {
                chatContinuation: toPersistedChatContinuation(
                  pendingContinuations.get(sessionId)!,
                ),
              },
            });
          } else {
            pendingContinuations.delete(sessionId);
            emitStatus.send({
              state: "completed",
              message: "任务已完成",
              toolCallsExecuted: 0,
            });
          }
        } catch (error) {
          if (isAbortError(error, runtimeOptions.signal)) {
            emitStatus.send({
              state: "canceled",
              message: "任务已中断",
            });
            await emitTerminalStreamEvent({
              type: "canceled",
              message: "已中断任务。",
            });
            return {
              ok: false,
              code: "CANCELED",
              retryable: true,
              message: "已中断任务。",
            };
          }
          const notice = modelServiceNoticeFromError(error, {
            provider: profile.providerId,
            model: profile.model,
          });
          if (notice) {
            reply = notice.message;
            pendingContinuations.set(sessionId, {
              messages,
              maxTurns: 1,
              toolCallsExecuted: 0,
              evidenceRunId: requestId,
              createdAt: Date.now(),
            });
            agentStatus = {
              state: "paused",
              runId: requestId,
              reason: modelNoticeContinuationReason(notice),
              maxTurns: 1,
              toolCallsExecuted: 0,
              message: notice.message,
              modelServiceNotice: notice,
            };
            emitOutputPart(
              outputAssembler.appendDiagnostic({
                severity: "warning",
                title: "模型服务暂不可用",
                message: notice.message,
              }),
            );
            await emitStatus.sendRequired({
              state: "paused",
              message: "模型服务返回限制，等待你重试",
              maxTurns: 1,
              toolCallsExecuted: 0,
              payload: {
                chatContinuation: toPersistedChatContinuation(
                  pendingContinuations.get(sessionId)!,
                ),
              },
            });
          } else {
            const failureMessage = toSecretSafeFailure(
              error,
              "INTERNAL_FAILURE",
            ).publicMessage;
            const publishFailureStatus = error instanceof RequiredConversationSettlementError
              ? emitStatus.sendPublishedOnly
              : emitStatus.send;
            publishFailureStatus({
              state: "failed",
              message: failureMessage,
            });
            await emitTerminalStreamEvent({
              type: "failed",
              message: failureMessage,
            });
            return {
              ok: false,
              ...(error instanceof RequiredConversationSettlementError
                ? { code: "INTERNAL_ERROR" as const }
                : {}),
              message: failureMessage,
            };
          }
        }
      }

      if (
        continuationToResume &&
        agentStatus?.state !== "paused"
      ) {
        pendingContinuations.delete(sessionId);
        await emitStatus.sendRequired({
          state: "checkpoint_boundary",
          message: "暂停检查点已成功消费。",
          payload: { continuationCleared: true },
        });
      }

      reply = redactCredentialString(reply);
      const assistantMessageId = await persistStage.persistAssistantReply({
        content: reply,
        relatedMemoryIds: relatedMemoryResults.map((result) => result.record.id),
        settlementStatus:
          agentStatus?.state === "paused"
            ? "paused"
            : agentStatus?.state === "failed"
              ? "failed"
              : "succeeded",
        ...(agentStatus?.state === "failed"
          ? { terminalType: "failed" as const }
          : {}),
      });
      appendRawHistoryEntry({
        historyIndexStore: options.historyIndexStore,
        createId,
        sessionId,
        requestId,
        role: "assistant",
        content: reply,
        workspaceId: chatRunContext?.workspaceId ?? input.workspaceId,
        createdAt: new Date(getNowMs(options.now)).toISOString(),
      });
      const memoryId = await writeSessionMemory({
        memoryStore: options.memoryStore,
        sessionId,
        userMessage,
        reply,
        messageIds: compactMessageIds(userMessageId, assistantMessageId),
      });
      await writeAtomicMemories({
        memoryStore: options.memoryStore,
        memoryProfileStore: options.memoryProfileStore,
        sessionId,
        userMessageId,
        assistantMessageId,
        userMessage,
        assistantReply: reply,
      });
      await recordSessionTokenUsage({
        chatSessionStore: options.chatSessionStore,
        sessionId,
        usage:
          accumulatedUsage ??
          estimateChatTurnUsage([
            { role: "system", content: buildChatSystemPrompt(chatDate, chatTimeZone) },
            ...chatMessages,
            { role: "assistant", content: reply },
          ]),
      });

      return {
        ok: true,
        reply,
        sessionId,
        relatedMemories: relatedMemoryResults.map(toRelatedMemory),
        memoryId,
        ...(agentStatus ? { agentStatus } : {}),
        turnSettlementStatus:
          agentStatus?.state === "paused"
            ? "paused"
            : agentStatus?.state === "failed"
              ? "failed"
              : "succeeded",
        ...(requestedSkill?.kind === "matched"
          ? {
              selectedSkill: {
                name: requestedSkill.skill.manifest.name,
                displayName: requestedSkill.skill.manifest.displayName,
              },
            }
          : {}),
      };
  }

  return {
    executeMessageInternal,
  };
}
