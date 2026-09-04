import { toRelatedMemory } from "./modulemessages";
import { createLegacyFinalizeStage, legacyFinalizeContinue } from "./legacyFinalizeStage";
import { createLegacySimpleChatStage, legacySimpleChatContinue } from "./legacySimpleChatStage";
import { createLegacyAgentRunStage, legacyAgentRunContinue } from "./legacyAgentRunStage";
import { createLegacyPlanInputStage, legacyPlanInputContinue } from "./legacyPlanInputStage";
import { createLegacyTurnEmitStage } from "./legacyTurnEmitStage";
import { createLegacySettleSupportStage } from "./legacySettleSupportStage";
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

      const settleSupport = createLegacySettleSupportStage({
        options,
        sessionId: () => sessionId,
        requestId,
        currentCausalAttempt: () => currentCausalAttempt,
        publicationAuthority,
        internalOptions,
        pendingContinuations,
        workspaceRunRecorder: () => workspaceRunRecorder,
      } as unknown as Parameters<typeof createLegacySettleSupportStage>[0]);
      const {
        invalidatePublicationAuthority,
        interruptRequiredSettlementAttempt,
        compensateRequiredSettlementFailure,
        persistChatStatusEvent,
      } = settleSupport;
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

      const emitStage = createLegacyTurnEmitStage({
        options,
        requestId,
        publicationAuthority,
        emitStatus,
        outputAssembler,
        terminalStreamEventSent: () => terminalStreamEventSent,
        setTerminalStreamEventSent: (value: boolean) => {
          terminalStreamEventSent = value;
        },
        currentCausalAttempt: () => currentCausalAttempt,
        setCurrentCausalAttempt: (value: number) => {
          currentCausalAttempt = value;
        },
        invalidatePublicationAuthority,
      } as unknown as Parameters<typeof createLegacyTurnEmitStage>[0]);
      const {
        finalizeAssistantOutput,
        emitOutputPart,
        ensureCausalAttempt,
        emitTerminalStreamEvent,
        settleClaimOwnedFailure,
      } = emitStage;


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

      const legacyPlanInputStage = createLegacyPlanInputStage({
        options,
        sessionId: () => sessionId,
        requestId,
        activeGoal: () => activeGoal,
        chatRunContext: () => chatRunContext,
        userMessage,
        modelUserMessage,
        preexistingInputRoutingPlan,
        input,
        runtimeOptions,
        createId,
        internalOptions,
        planService: options.planService,
        emitStatus,
        persistStage,
        emitTerminalStreamEvent,
      } as unknown as Parameters<typeof createLegacyPlanInputStage>[0]);

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
        const __planInputResult = await legacyPlanInputStage.run();
        if (__planInputResult !== legacyPlanInputContinue) {
          return __planInputResult;
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

      let reply = "";
      const legacyStageRt = {
        options,
        sessionId: () => sessionId,
        requestId,
        activeGoal: () => activeGoal,
        chatRunContext,
        profile: () => profile,
        relatedMemoryResults: () => relatedMemoryResults,
        chatMessages: () => chatMessages,
        reply: () => reply,
        toolCallsUsed: () => toolCallsUsed,
        agentStatus: () => agentStatus,
        accumulatedUsage: () => accumulatedUsage,
        accumulatedReasoningProjection: () => accumulatedReasoningProjection,
        currentCausalAttempt: () => currentCausalAttempt,
        requestedSkill,
        continuationToResume,
        resolvedSkillInput,
        selectedSkillForGoal: () => selectedSkillForGoal,
        selectedSkillInputValuesForGoal: () => selectedSkillInputValuesForGoal,
        authoritativeHistory: () => authoritativeHistory,
        sessionMessageCount: () => sessionMessageCount,
        sessionCompactionBaseline: () => sessionCompactionBaseline,
        startedAtMs: () => startedAtMs,
        chatTimeZone: () => chatTimeZone,
        createId,
        agentLoopMaxTurns,
        memoryLimit,
        runtimeOptions,
        chatDate,
        persistStage,
        input,
        userMessage,
        userMessageId,
        workspaceRunRecorder: () => workspaceRunRecorder,
        pendingContinuations,
        setReply: (value: string) => {
          reply = value;
        },
        setToolCallsUsed: (value: number) => {
          toolCallsUsed = value;
        },
        setAgentStatus: (value: ChatAgentStatus | undefined) => {
          agentStatus = value;
        },
        setAccumulatedUsage: (value: ChatSessionTokenUsage | null) => {
          accumulatedUsage = value;
        },
        setAccumulatedReasoningProjection: (value: string) => {
          accumulatedReasoningProjection = value;
        },
        setCurrentCausalAttempt: (value: number) => {
          currentCausalAttempt = value;
        },
        emitStatus,
        outputAssembler,
        emitTerminalStreamEvent,
        emitOutputPart,
      };

      const legacyAgentRunStage = createLegacyAgentRunStage(
        legacyStageRt as unknown as Parameters<typeof createLegacyAgentRunStage>[0],
      );
      const legacySimpleChatStage = createLegacySimpleChatStage(
        legacyStageRt as unknown as Parameters<typeof createLegacySimpleChatStage>[0],
      );
      let toolCallsUsed = 0;
      const legacyFinalizeStage = createLegacyFinalizeStage(
        legacyStageRt as unknown as Parameters<typeof createLegacyFinalizeStage>[0],
      );

      let agentStatus: ChatAgentStatus | undefined;
      let accumulatedUsage: ChatSessionTokenUsage | null = null;

      if (options.toolExecutor) {
        const __agentRunResult = await legacyAgentRunStage.run();
        if (__agentRunResult !== legacyAgentRunContinue) {
          return __agentRunResult;
        }
      } else {
        const __fbResult = await legacySimpleChatStage.run();
        if (__fbResult !== legacySimpleChatContinue) {
          return __fbResult;
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
      const __tailResult = await legacyFinalizeStage.run();
      if (__tailResult !== legacyFinalizeContinue) {
        return __tailResult;
      }
      return { ok: false, message: "Finalize stage did not settle the turn." };
  }

  return {
    executeMessageInternal,
  };
}
