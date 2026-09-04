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

import { createLegacyPersistStage } from "./legacyPersistStage";
import { compactMessageIds, estimateChatTurnUsage, recordSessionTokenUsage, toRelatedMemory, writeAtomicMemories, writeSessionMemory } from "./modulemessages";
export type LegacyFinalizeStageRt = {
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
  persistStage: ReturnType<typeof createLegacyPersistStage>;
  input: { workspaceId?: string | null };
  userMessage: string;
  userMessageId: string | null;
  chatDate: string;
  runtimeOptions: SendChatMessageRuntimeOptions;
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

export const legacyFinalizeContinue = Symbol("legacy-finalize-continue");

export function createLegacyFinalizeStage(rt: LegacyFinalizeStageRt) {
  async function run(): Promise<SendChatMessageResult | typeof legacyFinalizeContinue> {
      const assistantMessageId = await rt.persistStage.persistAssistantReply({
        content: rt.reply(),
        relatedMemoryIds: rt.relatedMemoryResults().map((result) => result.record.id),
        settlementStatus:
          rt.agentStatus()?.state === "paused"
            ? "paused"
            : rt.agentStatus()?.state === "failed"
              ? "failed"
              : "succeeded",
        ...(rt.agentStatus()?.state === "failed"
          ? { terminalType: "failed" as const }
          : {}),
      });
      appendRawHistoryEntry({
        historyIndexStore: rt.options.historyIndexStore,
        createId: rt.createId,
        sessionId: rt.sessionId(),
        requestId: rt.requestId,
        role: "assistant",
        content: rt.reply(),
        workspaceId: (rt.chatRunContext?.workspaceId ?? rt.input.workspaceId) ?? undefined,
        createdAt: new Date(getNowMs(rt.options.now)).toISOString(),
      });
      const memoryId = await writeSessionMemory({
        memoryStore: rt.options.memoryStore,
        sessionId: rt.sessionId(),
        userMessage: rt.userMessage,
        reply: rt.reply(),
        messageIds: compactMessageIds(rt.userMessageId, assistantMessageId),
      });
      await writeAtomicMemories({
        memoryStore: rt.options.memoryStore,
        memoryProfileStore: rt.options.memoryProfileStore,
        sessionId: rt.sessionId(),
        userMessageId: rt.userMessageId,
        assistantMessageId,
        userMessage: rt.userMessage,
        assistantReply: rt.reply(),
      });
      await recordSessionTokenUsage({
        chatSessionStore: rt.options.chatSessionStore,
        sessionId: rt.sessionId(),
        usage:
          rt.accumulatedUsage() ??
          estimateChatTurnUsage([
            { role: "system", content: buildChatSystemPrompt(rt.chatDate, rt.chatTimeZone()) },
            ...rt.chatMessages(),
            { role: "assistant", content: rt.reply() },
          ]),
      });

      return {
        ok: true,
        reply: rt.reply(),
        sessionId: rt.sessionId(),
        relatedMemories: rt.relatedMemoryResults().map(toRelatedMemory),
        memoryId,
        ...(rt.agentStatus() ? { agentStatus: rt.agentStatus() } : {}),
        turnSettlementStatus:
          rt.agentStatus()?.state === "paused"
            ? "paused"
            : rt.agentStatus()?.state === "failed"
              ? "failed"
              : "succeeded",
        ...(rt.requestedSkill?.kind === "matched"
          ? {
              selectedSkill: {
                name: rt.requestedSkill.skill.manifest.name,
                displayName: rt.requestedSkill.skill.manifest.displayName,
              },
            }
          : {}),
      };
      return legacyFinalizeContinue;
  }
  return { run };
}
