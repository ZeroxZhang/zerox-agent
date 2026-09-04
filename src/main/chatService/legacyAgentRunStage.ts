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
export type LegacyAgentRunStageRt = {
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

export const legacyAgentRunContinue = Symbol("legacy-agent-run-continue");

export function createLegacyAgentRunStage(rt: LegacyAgentRunStageRt) {
  async function run(): Promise<SendChatMessageResult | typeof legacyAgentRunContinue> {
        // Unified agent mode: chat goes through agent loop with tool access
        const chatRunContextNow = rt.chatRunContext;
        const workspaceRunRecorderNow = rt.workspaceRunRecorder();
        const requestedSkillNow = rt.requestedSkill;
        const resolvedSkillInputNow = rt.resolvedSkillInput;
        const continuationToResumeNow = rt.continuationToResume;
        try {
          const toolExecutor = rt.options.toolExecutor!;
          const selectedSkill =
            requestedSkillNow?.kind === "matched" ? requestedSkillNow.skill : undefined;
          const agentRunContext =
            chatRunContextNow && selectedSkill
              ? extendRunContextForSelectedSkill({
                  runContext: chatRunContextNow,
                  selectedSkill,
                  ...(resolvedSkillInputNow?.status === "complete"
                    ? { skillInputValues: resolvedSkillInputNow.values }
                    : {}),
                })
              : chatRunContextNow;
          const loopMaxTurns =
            typeof selectedSkill?.manifest.execution.maxTurns === "number"
              ? normalizeAgentLoopMaxTurns(
                  selectedSkill.manifest.execution.maxTurns,
                )
              : rt.agentLoopMaxTurns;
          const chatRuntimeTask = agentRunContext
            ? createChatRuntimeTask({
                sessionId: rt.sessionId(),
                requestId: rt.requestId,
                runContext: agentRunContext,
                selectedSkill,
                ...(resolvedSkillInputNow?.status === "complete"
                  ? { skillInputValues: resolvedSkillInputNow.values }
                  : {}),
              })
            : null;
          let observedToolCallsExecuted =
            continuationToResumeNow?.toolCallsExecuted ?? 0;
          const actorToolTasks = new Map<string, string>();
          const emittedActorSpawnIds = new Set<string>();
          const parentEvidenceRunId = continuationToResumeNow?.evidenceRunId;
          const evidence = createChatAgentEvidenceRecorder({
            trajectoryStore: rt.options.trajectoryStore,
            ...(agentRunContext ? { runContext: agentRunContext } : {}),
            createId: rt.createId,
            now: rt.options.now,
          });
          await rt.options.conversationCausalStore?.addRefs({
            requestId: rt.requestId,
            refs: [{ kind: "trajectory_run", id: evidence.runId }],
          });
          const toolDefinitions =
            rt.profile().modelCapabilities?.tools === false
              ? []
              : toolExecutor.getRegistry().getDefinitions();
          const runtimeContextSnapshot = createRuntimeContextSnapshotForRun({
            surface: "chat",
            runId: evidence.runId,
            ...(agentRunContext ? { runContext: agentRunContext } : {}),
            modelProfile: rt.profile(),
            tools: toolDefinitions,
            getToolSource: (toolName) =>
              getToolRegistrySource(toolExecutor, toolName),
            ...(selectedSkill ? { selectedSkill } : {}),
            permission: {
              taskId:
                chatRuntimeTask?.taskId ?? `chat:${rt.sessionId()}:${rt.requestId}`,
              runtimeTaskId:
                chatRuntimeTask?.taskId ?? `chat:${rt.sessionId()}:${rt.requestId}`,
              approvalMode: "manual",
              policyLabel:
                chatRuntimeTask?.runtimeTask.policyLabel ??
                "chat workspace contract",
            },
            memory: {
              scopes: buildRuntimeContextMemoryScopes({
                sessionId: rt.sessionId(),
                runContext: agentRunContext,
                selectedSkill,
              }),
              recallBudgetTokens: rt.memoryLimit,
              rawHistoryEnabled: Boolean(rt.options.historyIndexStore),
            },
            checkpoint: {
              strategy: rt.options.compactionStrategy ? "rebuild" : "summarize",
              preserveToolPairs: true,
              protectSkillLoads: true,
              ...(parentEvidenceRunId
                ? {
                    checkpointId: parentEvidenceRunId,
                    boundaryId: rt.requestId,
                  }
                : {}),
            },
            trajectory: {
              ...(workspaceRunRecorderNow?.workspaceRunId
                ? { workspaceRunId: workspaceRunRecorderNow.workspaceRunId }
                : {}),
              sessionId: rt.sessionId(),
              requestId: rt.requestId,
            },
            createId: () => `runtime_snapshot_${evidence.runId}`,
            now: () => new Date(rt.startedAtMs()).toISOString(),
            systemTimeZone: rt.chatTimeZone(),
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
                      continuationRequestId: rt.requestId,
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
            await rt.options.conversationCausalStore?.addRefs({
              requestId: rt.requestId,
              refs: [{
                kind: "trajectory_event",
                runId: evidence.runId,
                eventId: runtimeContextEvidence.id,
              }],
            });
          }
          rt.emitStatus.send({
            state: "started",
            message: "Runtime context snapshot recorded.",
            payload: {
              runtimeContextSnapshotSummary,
            },
          });
          if (requestedSkillNow?.kind === "matched") {
            void evidence.append("skill_invoked", {
              skillName: requestedSkillNow.skill.manifest.name,
              displayName: requestedSkillNow.skill.manifest.displayName,
            });
          }
          const executeAgentLoop = rt.options.runAgentLoop ?? runAgentLoop;
          // Session history can contain interrupted tool batches from
          // earlier turns (aborts, mid-batch crashes). Repair pair
          // integrity before replaying it to the provider so a stale
          // session can never produce tool_call pairing HTTP 400s.
          const { messages: loopInputMessages } = sanitizeChatMessages(
            rt.chatMessages(),
            { unresolvedToolCalls: "trim" },
          );
          const loopResult = await executeAgentLoop(
            loopInputMessages,
            rt.profile(),
            {
              chatClient: rt.options.chatClient,
              toolExecutor,
              toolAuthorizationService: rt.options.toolAuthorizationService,
              ...(chatRuntimeTask ? { taskId: chatRuntimeTask.taskId } : {}),
              runId: evidence.runId,
              ...(agentRunContext ? { runContext: agentRunContext } : {}),
              ...(chatRuntimeTask
                ? { runtimeTask: chatRuntimeTask.runtimeTask }
                : {}),
              systemPrompt: buildChatSystemPrompt(rt.chatDate, rt.chatTimeZone()),
              maxTurns: loopMaxTurns,
              signal: rt.runtimeOptions.signal,
              tools: toolDefinitions,
              toolResultOffloadStore: rt.options.toolResultOffloadStore,
              toolResultOffloadThreshold: rt.options.toolResultOffloadThreshold,
              toolResultContinuationOwnerId: `chat:${rt.sessionId()}`,
              requestId: rt.requestId,
              ...(workspaceRunRecorderNow?.workspaceRunId
                ? { workspaceRunId: workspaceRunRecorderNow.workspaceRunId }
                : {}),
              ...(rt.options.compactionStrategy
                ? { compactionStrategy: rt.options.compactionStrategy }
                : {}),
              pauseOnTurnLimit: false,
              pauseOnFailureLoop: true,
              autoContinueOutputLimit: true,
              ...(rt.options.maxMode && isMaxModeEnabled()
                ? {
                    modelRequestExecutor: async (request: import("../openAiCompatibleClient").ChatCompletionRequest) => {
                      try {
                        const result = await rt.options.maxMode!.runStep(
                          toCompleteRequest(request),
                          {
                            candidates: 3,
                            judgeModel: rt.profile().model,
                            parentRunId: evidence.runId,
                            ...(rt.runtimeOptions.signal
                              ? { signal: rt.runtimeOptions.signal }
                              : {}),
                          },
                        );
                        return toChatCompletionResponse(result.winner, {
                          provider: rt.profile().providerId,
                          model: rt.profile().model,
                        });
                      } catch (error) {
                        throwIfResponseBodyLimitError(error);
                        return rt.options.chatClient.complete(request);
                      }
                    },
                  }
                : {}),
              ...(continuationToResumeNow
                ? {
                    resumeMessages: loopInputMessages,
                    initialToolCallsExecuted:
                      continuationToResumeNow.toolCallsExecuted,
                  }
                : {}),
              async onModelAttempt(event) {
                if (!rt.options.conversationCausalStore) {
                  if (
                    event.operation === "supersede"
                    || event.operation === "reset"
                  ) {
                    rt.outputAssembler.resetText();
                    rt.setAccumulatedReasoningProjection("");
                  }
                  rt.setCurrentCausalAttempt(event.attempt);
                  rt.emitStatus.sendAttemptControl(event);
                  return;
                }
                if (event.operation === "supersede") {
                  const settled = await rt.options.conversationCausalStore.settleAttempt({
                    requestId: rt.requestId,
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
                  rt.outputAssembler.resetText();
                  rt.setAccumulatedReasoningProjection("");
                  rt.setCurrentCausalAttempt(event.attempt);
                  rt.emitStatus.sendAttemptControl(event);
                  return;
                }
                if (event.operation === "reset") {
                  const settled = await rt.options.conversationCausalStore.settleAttempt({
                    requestId: rt.requestId,
                    attempt: event.attempt,
                    state: "reset",
                  });
                  if (
                    settled.disposition !== "applied"
                    && settled.disposition !== "duplicate"
                  ) {
                    throw new Error("Conversation attempt reset conflicted.");
                  }
                  rt.outputAssembler.resetText();
                  rt.setAccumulatedReasoningProjection("");
                  rt.emitStatus.sendAttemptControl(event);
                  return;
                }
                const begun = await rt.options.conversationCausalStore.beginAttempt({
                  requestId: rt.requestId,
                  attempt: event.attempt,
                });
                if (begun.disposition !== "applied" && begun.disposition !== "duplicate") {
                  throw new Error("Conversation retry begin conflicted.");
                }
                rt.setCurrentCausalAttempt(event.attempt);
                rt.emitStatus.sendAttemptControl(event);
              },
              onTurn(turn, phase) {
                void evidence.append("model_request", {
                  turn: turn + 1,
                  phase,
                });
                if (phase === "executing") {
                  rt.emitStatus.send({
                    state: "model",
                    message: `正在调用模型（第 ${turn + 1} 轮）`,
                    turn: turn + 1,
                    toolCallsExecuted: observedToolCallsExecuted,
                  });
                }
              },
              onModelResponse(response, turn) {
                rt.setAccumulatedUsage(mergeChatSessionTokenUsage(
                  rt.accumulatedUsage(),
                  toChatSessionTokenUsage(response.usage),
                ));
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
                  sessionMessageCount: rt.sessionMessageCount(),
                  historyMessageCount: rt.authoritativeHistory()?.length ?? 0,
                  relatedMemoryResults: rt.relatedMemoryResults(),
                  sessionCompactionBaseline: rt.sessionCompactionBaseline(),
                });
                rt.emitStatus.send({
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
                rt.setAccumulatedReasoningProjection(rt.accumulatedReasoningProjection() + reasoningContent);
              },
              onModelStreamEvent(event) {
                emitModelStreamEvent(rt.emitStatus, rt.outputAssembler, event);
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
                  historyIndexStore: rt.options.historyIndexStore,
                  createId: rt.createId,
                  sessionId: rt.sessionId(),
                  requestId: rt.requestId,
                  role: "tool",
                  toolName,
                  content:
                    `Tool call ${toolName}: ` +
                    truncateHistoryContent(
                      stringifyRedactedCredentials(args),
                    ),
                  workspaceId: agentRunContext?.workspaceId,
                  createdAt: new Date(getNowMs(rt.options.now)).toISOString(),
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
                rt.emitStatus.send({
                  state: "tool_call",
                  message: `正在调用工具：${toolName}`,
                  toolName,
                  toolCallId: event.toolCallId,
                  toolCallsExecuted: observedToolCallsExecuted,
                });
                rt.emitOutputPart(
                  rt.outputAssembler.appendLedgerEvent({
                    status: "running",
                    title: `正在调用工具：${toolName}`,
                    detail: stringifyMaskedPreview(args),
                    toolName,
                  }),
                );
              },
              async onToolInvocation(record) {
                if (rt.options.conversationCausalStore) {
                  const causalRefWrite = await rt.options.conversationCausalStore.addRefs({
                    requestId: rt.requestId,
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
                  await rt.emitStatus.sendRequired(invocationStatusEvent);
                } else {
                  rt.emitStatus.send(invocationStatusEvent);
                }
                if (record.status === "waiting_approval") {
                  rt.emitOutputPart(
                    rt.outputAssembler.appendApprovalRequest({
                      approvalId: record.approvalId ?? record.id,
                      toolName: record.toolName,
                      riskLevel: inferApprovalRiskLevel({
                        toolName: record.toolName,
                        source: record.source,
                      }),
                      argsPreview: record.args,
                    }),
                  );
                  rt.emitOutputPart(
                    rt.outputAssembler.appendLedgerEvent({
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
                    emitStatus: rt.emitStatus,
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
                  historyIndexStore: rt.options.historyIndexStore,
                  createId: rt.createId,
                  sessionId: rt.sessionId(),
                  requestId: rt.requestId,
                  role: "tool",
                  toolName,
                  content:
                    `Tool result ${toolName}: ${ok ? "ok" : "error"} ` +
                    truncateHistoryContent(
                      stringifyRedactedCredentials(result),
                    ),
                  workspaceId: agentRunContext?.workspaceId,
                  createdAt: new Date(getNowMs(rt.options.now)).toISOString(),
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
                rt.emitStatus.send({
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
                    emitStatus: rt.emitStatus,
                    result,
                    toolCallId: event.toolCallId,
                    task:
                      actorToolTasks.get(event.toolCallId) ?? "subagent",
                    toolCallsExecuted: observedToolCallsExecuted,
                    emittedActorSpawnIds,
                  });
                }
                for (const part of rt.outputAssembler.appendToolResult({
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
                  rt.emitOutputPart(part);
                }
                rt.emitOutputPart(
                  rt.outputAssembler.appendLedgerEvent({
                    status: ok ? "completed" : "failed",
                    title: buildToolResultStatusMessage(toolName, result),
                    ...(toolName ? { toolName } : {}),
                  }),
                );
              },
            },
          );
          if (rt.accumulatedReasoningProjection()) {
            rt.emitStatus.send({
              state: "reasoning",
              message: normalizeReasoningForStatus(
                rt.accumulatedReasoningProjection(),
              ),
              toolCallsExecuted: observedToolCallsExecuted,
            });
          }
          rt.setReply(rt.outputAssembler.setFinalText(loopResult.summary)?.text
            ?? redactCredentialString(loopResult.summary));
          const finalToolCallsExecuted = Math.max(
            loopResult.toolCallsExecuted,
            observedToolCallsExecuted,
          );
          rt.setToolCallsUsed(finalToolCallsExecuted);
          rt.setAccumulatedUsage(reconcileAgentLoopTokenUsage(
            rt.accumulatedUsage(),
            loopResult.tokensConsumed,
          ));
          const finalSummaryEvidence = await evidence.append("final_summary", {
            status: loopResult.status,
            toolCallsExecuted: finalToolCallsExecuted,
          });
          await evidence.drain();
          if (finalSummaryEvidence) {
            await rt.options.conversationCausalStore?.addRefs({
              requestId: rt.requestId,
              refs: [{
                kind: "trajectory_event",
                runId: evidence.runId,
                eventId: finalSummaryEvidence.id,
              }],
            });
          }

          if (loopResult.status === "canceled") {
            rt.emitStatus.send({
              state: "canceled",
              message: "任务已中断",
              toolCallsExecuted: loopResult.toolCallsExecuted,
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

          if (loopResult.status === "paused" && loopResult.continuation) {
            rt.pendingContinuations.set(rt.sessionId(), {
              messages: loopResult.messages,
              maxTurns: loopResult.continuation.maxTurns,
              toolCallsExecuted: loopResult.continuation.toolCallsExecuted,
              evidenceRunId: evidence.runId,
              createdAt: Date.now(),
            });
            rt.setAgentStatus({
              state: "paused",
              runId: evidence.runId,
              reason: loopResult.continuation.reason,
              maxTurns: loopResult.continuation.maxTurns,
              toolCallsExecuted: finalToolCallsExecuted,
              message: redactCredentialString(loopResult.summary),
              ...(loopResult.modelServiceNotice
                ? { modelServiceNotice: loopResult.modelServiceNotice }
                : {}),
            });
            if (loopResult.modelServiceNotice) {
              rt.emitOutputPart(
                rt.outputAssembler.appendDiagnostic({
                  severity: "warning",
                  title:
                    loopResult.modelServiceNotice.kind === "output_limit"
                      ? "模型输出未完成"
                      : "模型服务暂不可用",
                  message: loopResult.modelServiceNotice.message,
                }),
              );
            }
            await rt.emitStatus.sendRequired({
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
                  rt.pendingContinuations.get(rt.sessionId())!,
                ),
              },
            });
          } else if (loopResult.status === "failed") {
            rt.pendingContinuations.delete(rt.sessionId());
            rt.setAgentStatus({
              state: "failed",
              runId: evidence.runId,
              toolCallsExecuted: finalToolCallsExecuted,
              message: redactCredentialString(loopResult.summary),
            });
            await rt.emitStatus.sendRequired({
              state: "failed",
              message: formatAgentLoopFailure(
                redactCredentialString(loopResult.summary),
              ),
              toolCallsExecuted: finalToolCallsExecuted,
            });
          } else {
            rt.pendingContinuations.delete(rt.sessionId());
            rt.setAgentStatus({
              state: "completed",
              runId: evidence.runId,
              toolCallsExecuted: finalToolCallsExecuted,
            });
            rt.emitStatus.send({
              state: "completed",
              message: "任务已完成",
              toolCallsExecuted: finalToolCallsExecuted,
            });
          }

          if (rt.toolCallsUsed() > 0) {
            rt.setReply(`🔧 使用了 ${rt.toolCallsUsed()} 个工具\n\n${rt.reply()}`);
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
          const failureMessage = toSecretSafeFailure(
            error,
            "AGENT_RUN_EXECUTION_FAILED",
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
      return legacyAgentRunContinue;
  }
  return { run };
}