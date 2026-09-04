import { summarizeAgentRuntimeContextSnapshot } from "../../shared/agentRuntimeContext";
import { ChatAgentStatus, ChatHistoryMessage, ChatSessionGoalSummary, ChatSessionTokenUsage, SendChatMessageResult } from "../../shared/chat";
import { ChatOutputPart, stringifyMaskedPreview } from "../../shared/chatOutput";
import { redactCredentialString, stringifyRedactedCredentials } from "../../shared/credentialRedaction";
import { MemorySearchResult } from "../../shared/memory";
import { toSecretSafeFailure } from "../../shared/secretSafeFailure";
import { runAgentLoop } from "../agentLoop";
import { AgentModelProfile } from "../agentRunnerService";
import { createChatAgentEvidenceRecorder } from "../chatAgentEvidence";
import { createChatOutputAssembler } from "../chatOutputAssembler";
import { ChatContinuationState, ChatServiceOptions, RequiredConversationSettlementError, SendChatMessageRuntimeOptions } from "../chatService";
import { throwIfResponseBodyLimitError } from "../fetchWithTimeout";
import { sanitizeChatMessages } from "../messageIntegrity";
import { ChatMessage } from "../openAiCompatibleClient";
import { isMaxModeEnabled } from "../providers/maxMode";
import { toChatCompletionResponse, toCompleteRequest } from "../providers/normalize";
import { createRuntimeContextSnapshotForRun } from "../runtimeContextFactory";
import { resolveSkillInput } from "../skillExecutionService";
import { appendRawHistoryEntry, buildChatSystemPrompt, buildNativeToolEvidencePayload, formatContextUsageStatus, getNativeToolDescriptor, getToolRegistrySource, mergeChatSessionTokenUsage, reconcileAgentLoopTokenUsage, toChatSessionContextSnapshot, toChatSessionTokenUsage, toPersistedChatContinuation, truncateHistoryContent } from "./modulemessages";
import { buildRuntimeContextMemoryScopes, buildToolResultStatusMessage, createChatRuntimeTask, emitActorSpawnedStatusEvent, emitActorToolStatusEvents, extendRunContextForSelectedSkill, formatAgentLoopFailure, isAbortError, normalizeReasoningForStatus, readToolArgString } from "./moduleruntime";
import { inferApprovalRiskLevel } from "./modulesettlement";
import { createChatStatusEmitter, emitModelStreamEvent, getNowMs, normalizeAgentLoopMaxTurns } from "./streamingStatus";

import type { AgentRunContext } from "../../shared/agentWorkspace";
import type { SkillRecord } from "../../shared/skills";
import { modelServiceNoticeFromError, sanitizeModelServiceNotice } from "../../shared/modelServiceNotice";
import { modelNoticeContinuationReason } from "./moduleruntime";
export type LegacySimpleChatStageRt = {
  options: ChatServiceOptions;
  sessionId: () => string;
  requestId: string;
  activeGoal: () => ChatSessionGoalSummary | null;
  chatRunContext: AgentRunContext | undefined;
  profile: () => AgentModelProfile;
  relatedMemoryResults: () => MemorySearchResult[];
  chatMessages: () => ChatMessage[];
  reply: () => string;
  toolCallsUsed: () => number;
  agentStatus: () => ChatAgentStatus | undefined;
  accumulatedUsage: () => ChatSessionTokenUsage | null;
  accumulatedReasoningProjection: () => string;
  currentCausalAttempt: () => number;
  requestedSkill: { kind: "matched"; skill: SkillRecord } | { kind: "missing"; message: string } | null;
  continuationToResume: ChatContinuationState | null;
  resolvedSkillInput: ReturnType<typeof resolveSkillInput> | null;
  selectedSkillForGoal: () => SkillRecord | undefined;
  selectedSkillInputValuesForGoal: () => unknown;
  authoritativeHistory: () => ChatHistoryMessage[] | null;
  sessionMessageCount: () => number;
  sessionCompactionBaseline: () => number;
  startedAtMs: () => number;
  chatTimeZone: () => string;
  createId: () => string;
  agentLoopMaxTurns: number;
  memoryLimit: number;
  workspaceRunRecorder: () => { workspaceRunId: string } | null;
  pendingContinuations: Map<string, ChatContinuationState>;
  runtimeOptions: SendChatMessageRuntimeOptions;
  chatDate: string;
  setReply: (value: string) => void;
  setToolCallsUsed: (value: number) => void;
  setAgentStatus: (value: ChatAgentStatus | undefined) => void;
  setAccumulatedUsage: (value: ChatSessionTokenUsage | null) => void;
  setAccumulatedReasoningProjection: (value: string) => void;
  setCurrentCausalAttempt: (value: number) => void;
  emitStatus: ReturnType<typeof createChatStatusEmitter>;
  outputAssembler: ReturnType<typeof createChatOutputAssembler>;
  emitTerminalStreamEvent: (event: { type: "completed" | "failed" | "canceled"; message?: string; finalMessageId?: string; domainStateAvailable?: false }) => Promise<void>;
  emitOutputPart: (part: ChatOutputPart, provenance?: { domainStateAvailable?: false }) => void;
};

export const legacySimpleChatContinue = Symbol("legacy-simple-chat-continue");

export function createLegacySimpleChatStage(rt: LegacySimpleChatStageRt) {
  async function run(): Promise<SendChatMessageResult | typeof legacySimpleChatContinue> {
        // Fallback: simple LLM chat (no tools)
        const messages: ChatMessage[] = [
          { role: "system", content: buildChatSystemPrompt(rt.chatDate, rt.chatTimeZone()) },
          ...rt.chatMessages(),
        ];
        try {
          const response = await rt.options.chatClient.complete({
            ...rt.profile(),
            messages,
            ...(rt.runtimeOptions.signal ? { signal: rt.runtimeOptions.signal } : {}),
          });
          if (response.reasoningContent) {
            rt.emitStatus.send({
              state: "reasoning",
              message: normalizeReasoningForStatus(response.reasoningContent),
              toolCallsExecuted: 0,
            });
          }
          rt.setAccumulatedUsage(mergeChatSessionTokenUsage(
            rt.accumulatedUsage(),
            toChatSessionTokenUsage(response.usage),
          ));
          rt.setReply(redactCredentialString(response.content ?? ""));
          if (response.modelServiceNotice) {
            const notice = sanitizeModelServiceNotice(
              response.modelServiceNotice,
            );
            const continuationReason =
              modelNoticeContinuationReason(notice);
            rt.pendingContinuations.set(rt.sessionId(), {
              messages: [
                ...messages,
                ...(rt.reply()
                  ? [{ role: "assistant" as const, content: rt.reply() }]
                  : []),
              ],
              maxTurns: 1,
              toolCallsExecuted: 0,
              evidenceRunId: rt.requestId,
              createdAt: Date.now(),
            });
            rt.setAgentStatus({
              state: "paused",
              runId: rt.requestId,
              reason: continuationReason,
              maxTurns: 1,
              toolCallsExecuted: 0,
              message: notice.message,
              modelServiceNotice: notice,
            });
            rt.emitOutputPart(
              rt.outputAssembler.appendDiagnostic({
                severity: "warning",
                title:
                  notice.kind === "output_limit"
                    ? "模型输出未完成"
                    : "模型服务暂不可用",
                message: notice.message,
              }),
            );
            await rt.emitStatus.sendRequired({
              state: "paused",
              message:
                notice.kind === "output_limit"
                  ? "模型输出被服务商截断，等待你继续"
                  : "模型服务返回限制，等待你重试",
              maxTurns: 1,
              toolCallsExecuted: 0,
              payload: {
                chatContinuation: toPersistedChatContinuation(
                  rt.pendingContinuations.get(rt.sessionId())!,
                ),
              },
            });
          } else {
            rt.pendingContinuations.delete(rt.sessionId());
            rt.emitStatus.send({
              state: "completed",
              message: "任务已完成",
              toolCallsExecuted: 0,
            });
          }
        } catch (error) {
          if (isAbortError(error, rt.runtimeOptions.signal)) {
            rt.emitStatus.send({
              state: "canceled",
              message: "任务已中断",
            });
            await rt.emitTerminalStreamEvent({
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
            provider: rt.profile().providerId,
            model: rt.profile().model,
          });
          if (notice) {
            rt.setReply(notice.message);
            rt.pendingContinuations.set(rt.sessionId(), {
              messages,
              maxTurns: 1,
              toolCallsExecuted: 0,
              evidenceRunId: rt.requestId,
              createdAt: Date.now(),
            });
            rt.setAgentStatus({
              state: "paused",
              runId: rt.requestId,
              reason: modelNoticeContinuationReason(notice),
              maxTurns: 1,
              toolCallsExecuted: 0,
              message: notice.message,
              modelServiceNotice: notice,
            });
            rt.emitOutputPart(
              rt.outputAssembler.appendDiagnostic({
                severity: "warning",
                title: "模型服务暂不可用",
                message: notice.message,
              }),
            );
            await rt.emitStatus.sendRequired({
              state: "paused",
              message: "模型服务返回限制，等待你重试",
              maxTurns: 1,
              toolCallsExecuted: 0,
              payload: {
                chatContinuation: toPersistedChatContinuation(
                  rt.pendingContinuations.get(rt.sessionId())!,
                ),
              },
            });
          } else {
            const failureMessage = toSecretSafeFailure(
              error,
              "INTERNAL_FAILURE",
            ).publicMessage;
            const publishFailureStatus = error instanceof RequiredConversationSettlementError
              ? rt.emitStatus.sendPublishedOnly
              : rt.emitStatus.send;
            publishFailureStatus({
              state: "failed",
              message: failureMessage,
            });
            await rt.emitTerminalStreamEvent({
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
      return legacySimpleChatContinue;
  }
  return { run };
}
