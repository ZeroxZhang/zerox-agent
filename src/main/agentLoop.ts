import type {
  AgentToolExecutionResult,
  AgentToolExecutor,
} from "./agentToolExecutor";
import { createContextManager, type ContextManager } from "./contextManager";
import type { CompactionStrategy } from "./kernel/compactionStrategy";
import { NEVER_COMPACT_MARKER } from "../shared/compactionMarkers";
import type { AgentRunContext } from "../shared/agentWorkspace";
import type { SystemReminderContext, SystemReminderRegistry } from "../shared/systemReminder";
import type {
  ChatClient,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  StreamEvent,
  StreamingChatClient,
  ToolCall,
} from "./openAiCompatibleClient";
import {
  completeWithModelRetry,
  type ModelRetryEvent,
  type ModelRetryOptions,
} from "./modelRetry";
import type {
  RuntimeToolAuthorizationTask,
  ToolAuthorizationService,
} from "./toolAuthorizationService";
import {
  createToolRuntime,
  type ToolRuntimeOutcome,
} from "./toolRuntime";
import type { ToolRuntimeEvent } from "./dynamicToolRegistry";
import {
  buildAgentSystemPrompt,
  buildToolDefinitions,
  serializeToolObservation,
} from "../shared/agentProtocol";
import { formatDateInTimeZone, getSystemTimeZone } from "../shared/dateContext";
import { serializeToolObservationWithOffload } from "./toolObservationOffload";
import type { ToolResultOffloadStore } from "./toolResultOffloadStore";
import {
  getToolCapability,
  getToolConcurrencyMode,
  type ToolConcurrencyMode,
} from "../shared/agentToolCapabilities";
import {
  modelServiceNoticeFromError,
  modelServiceNoticeFromFinishReason,
  type ModelServiceNotice,
} from "../shared/modelServiceNotice";
import {
  createToolInvocation,
  transitionToolInvocation,
  type ToolInvocationRecord,
  type ToolInvocationTransition,
} from "../shared/toolInvocationLedger";
import { sanitizeChatMessages } from "./messageIntegrity";
import {
  buildExplorationDedupNote,
  buildReadResultDigest,
  createExplorationDedupTracker,
  isMutatingToolCall,
  isReadClassTool,
} from "./agentExplorationDedup";
import {
  createAgentContextUsage,
  resolveContextTokenBudget,
  type AgentContextCompactionSummary,
  type AgentContextUsage,
} from "../shared/contextUsage";
import type { ContextSurfaceState } from "../shared/contextSurface";
import { createContextSurface } from "./contextSurface";
import {
  createSerialToolPolicyAdmission,
  scheduleToolBatch,
} from "./toolBatchScheduler";

export type AgentLoopOptions = {
  chatClient: ChatClient;
  toolExecutor: AgentToolExecutor;
  toolAuthorizationService?: ToolAuthorizationService;
  taskId?: string;
  /** Stable execution identity for checkpoints, compaction, and evidence. */
  runId?: string;
  runContext?: AgentRunContext;
  runtimeTask?: RuntimeToolAuthorizationTask;
  systemPrompt?: string;
  /** Legacy name; controls checkpoint cadence and never limits total turns. */
  maxTurns?: number;
  /** @deprecated Ignored. Tool calls are usage telemetry only. */
  maxToolCalls?: number;
  /** @deprecated Ignored. Wall-clock time is usage telemetry only. */
  maxWallClockMs?: number;
  signal?: AbortSignal;
  tools?: ReturnType<typeof buildToolDefinitions>;
  toolResultOffloadStore?: ToolResultOffloadStore;
  toolResultOffloadThreshold?: number;
  requestId?: string;
  workspaceRunId?: string;
  /** @deprecated Ignored. maxTurns is a checkpoint interval, never a stop. */
  pauseOnTurnLimit?: boolean;
  pauseOnStrategyGuard?: boolean;
  resumeMessages?: ChatMessage[];
  resumeContextSurface?: ContextSurfaceState;
  initialToolCallsExecuted?: number;
  initialTokensConsumed?: number;
  initialTokensEstimated?: boolean;
  maxParallelToolCalls?: number;
  pauseOnFailureLoop?: boolean;
  contextManager?: ContextManager;
  /** @deprecated Kept for caller compatibility. Token usage is telemetry-only. */
  tokenBudget?: number;
  /** P2: overflow compaction routes through this strategy when provided
   *  (auto→rebuild when a checkpoint exists, else summarize = current behavior).
   *  Absent → legacy compressMessages (zero regression). */
  compactionStrategy?: CompactionStrategy;
  /** P3: system-reminder registry for conditional runtime injections.
   *  When provided, triggers are evaluated before each model call and matching
   *  reminders are injected as synthetic user messages. All triggers default OFF. */
  systemReminderRegistry?: SystemReminderRegistry;
  modelRetry?: ModelRetryOptions;
  onToolCall?: (
    toolName: string,
    args: Record<string, unknown>,
    event: AgentLoopToolEvent,
  ) => void;
  onToolResult?: (
    toolName: string,
    ok: boolean,
    result: Awaited<ReturnType<AgentToolExecutor["execute"]>>,
    event: AgentLoopToolEvent,
  ) => void;
  onToolRuntimeEvent?: (
    toolName: string,
    runtimeEvent: ToolRuntimeEvent,
    event: AgentLoopToolEvent,
  ) => void;
  onToolInvocation?: (record: ToolInvocationRecord) => void;
  onTurn?: (turn: number, phase: string) => void;
  onReasoning?: (reasoningContent: string, turn: number) => void;
  onModelResponse?: (response: ChatCompletionResponse, turn: number) => void;
  onModelStreamEvent?: (event: StreamEvent, turn: number) => void;
  onContextCompacted?: (event: AgentLoopContextCompaction) => void;
  onContextUsage?: (usage: AgentContextUsage) => void;
  onModelRetry?: (event: ModelRetryEvent) => void;
  onStrategyGuard?: (event: AgentLoopStrategyGuardEvent) => void;
  onCheckpoint?: (checkpoint: AgentLoopCheckpoint) => void | Promise<void>;
  /** Optional production model-step override (for example best-of-N). */
  modelRequestExecutor?: (
    request: ChatCompletionRequest,
    turn: number,
  ) => Promise<ChatCompletionResponse>;
};

export type AgentLoopCheckpoint = {
  messages: ChatMessage[];
  contextSurface: ContextSurfaceState;
  turns: number;
  toolCallsExecuted: number;
  nextAction: string;
  tokensConsumed: number;
  tokensEstimated: boolean;
};

export type AgentLoopContextCompaction = {
  originalMessageCount: number;
  compactedMessageCount: number;
  estimatedTokens: number;
  compactedTokens: number;
  tokenBudget: number;
  strategy: AgentContextCompactionSummary["strategy"];
  surfaceReplacementId?: string;
  shadowedNodeCount?: number;
  sourceNodeCount?: number;
};

export type AgentLoopStrategyGuardEvent = {
  code: "FRAGMENTED_TOOL_CALLS" | "REPEATED_EXPLORATION";
  severity: "warn";
  message: string;
  toolName: string;
  count: number;
};

export type AgentLoopToolEvent = {
  toolCallId: string;
  runId?: string;
  sessionId?: string;
  requestId?: string;
  workspaceRunId?: string;
  resultRef?: string;
  resultBytes?: number;
};

type PreparedAgentToolCall = {
  toolCall: ToolCall;
  toolName: string;
  args: Record<string, unknown> | null;
  signature: string | null;
  mode: ToolConcurrencyMode;
  registeredToolSource: string | null;
};

type ExecutedAgentToolCall = {
  prepared: PreparedAgentToolCall;
  args: Record<string, unknown> | null;
  toolEventBase: AgentLoopToolEvent;
  runtimeOutcome?: ToolRuntimeOutcome;
  transitionInvocation?: (
    transition: Omit<ToolInvocationTransition, "at"> & { at?: string },
  ) => void;
};

export type AgentLoopContinuation = {
  reason:
    /** @deprecated Historical continuation decoding only. */
    | "turn_limit"
    | "tool_failure_loop"
    | "strategy_guard"
    | "provider_output_limit"
    | "provider_rate_limit"
    | "provider_quota"
    | "provider_stop";
  maxTurns: number;
  toolCallsExecuted: number;
  toolName?: string;
  failureKind?: string;
  failureError?: string;
  failureArgs?: Record<string, unknown>;
  strategyGuardCode?: AgentLoopStrategyGuardEvent["code"];
};

export type AgentLoopResult = {
  summary: string;
  status: "succeeded" | "failed" | "canceled" | "paused";
  turns: number;
  messages: ChatMessage[];
  toolCallsExecuted: number;
  tokensConsumed?: number;
  tokensEstimated?: boolean;
  contextUsage?: AgentContextUsage;
  contextSurface?: ContextSurfaceState;
  continuation?: AgentLoopContinuation;
  modelServiceNotice?: ModelServiceNotice;
};

export async function runAgentLoop(
  initialMessages: ChatMessage[],
  modelProfile: {
    baseUrl: string;
    apiKey: string;
    model: string;
    providerId?: string;
    temperature: number;
    maxTokens: number;
    contextWindow?: number;
  },
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const {
    chatClient,
    toolExecutor,
    toolAuthorizationService,
    taskId,
    runId,
    runContext,
    runtimeTask,
    systemPrompt,
    maxTurns = 4,
    signal: parentSignal,
    tools: customTools,
    toolResultOffloadStore,
    toolResultOffloadThreshold,
    requestId,
    workspaceRunId,
    pauseOnStrategyGuard = false,
    resumeMessages,
    resumeContextSurface,
    initialToolCallsExecuted = 0,
    initialTokensConsumed = 0,
    initialTokensEstimated = false,
    maxParallelToolCalls = 4,
    pauseOnFailureLoop = false,
    contextManager = createContextManager(),
    compactionStrategy,
    systemReminderRegistry,
    onCheckpoint,
    modelRetry,
    onToolCall,
    onToolResult,
    onToolRuntimeEvent,
    onToolInvocation,
    onTurn,
    onReasoning,
    onModelResponse,
    onModelStreamEvent,
    onContextCompacted,
    onContextUsage,
    onModelRetry,
    onStrategyGuard,
    modelRequestExecutor,
  } = options;
  const signal = parentSignal;
  const checkpointInterval = Math.max(1, Math.floor(maxTurns));

  async function emitCheckpoint(nextAction: string): Promise<void> {
    await onCheckpoint?.({
      messages: contextSurface.messages(),
      contextSurface: contextSurface.snapshot(),
      turns: turns + 1,
      toolCallsExecuted,
      nextAction,
      tokensConsumed: estimateConsumedTokens(),
      tokensEstimated: areConsumedTokensEstimated(),
    });
  }

  const toolDefinitions = customTools ?? buildToolDefinitions();
  const initialSurfaceMessages: ChatMessage[] = [];
  // Anchor date to loop creation, interpreted in the user's system timezone.
  const loopTimeZone = getSystemTimeZone();
  const loopDate = formatDateInTimeZone(new Date(), loopTimeZone);

  if (!resumeMessages) {
    if (systemPrompt) {
      initialSurfaceMessages.push({ role: "system", content: systemPrompt });
    } else {
      initialSurfaceMessages.push({
        role: "system",
        content: buildAgentSystemPrompt({
          modelId: modelProfile.model,
          currentDate: loopDate,
          timeZone: loopTimeZone,
        }),
      });
    }

    initialSurfaceMessages.push(...initialMessages);
  } else {
    initialSurfaceMessages.push(...resumeMessages);
  }
  const contextSurface = createContextSurface({
    runId: runId ?? taskId ?? requestId ?? "agent_loop",
    ...(resumeContextSurface
      ? {
          state: resumeContextSurface,
          expectedMessages: initialSurfaceMessages,
        }
      : { initialMessages: initialSurfaceMessages }),
    estimateMessageTokens: (message) =>
      contextManager.estimateTokens([message]),
  });
  const messages: ChatMessage[] = contextSurface.messages();

  function refreshMessagesFromSurface(): void {
    messages.splice(0, messages.length, ...contextSurface.messages());
  }

  function appendMessage(message: ChatMessage): ChatMessage {
    const event = contextSurface.append(message);
    messages.push(event.message);
    return messages.at(-1)!;
  }

  function insertMessage(index: number, message: ChatMessage): void {
    const event = contextSurface.insert(index, message);
    messages.splice(index, 0, event.message);
  }

  function replaceSurface(
    replacement: ChatMessage[],
    input: {
      reason:
        | "summarize"
        | "rebuild"
        | "summarize-degraded"
        | "message-integrity"
        | "tool-batch-trim";
      strategy?: "summarize" | "rebuild" | "summarize-degraded";
      checkpointRef?: string;
    },
  ) {
    const event = contextSurface.replace(replacement, input);
    refreshMessagesFromSurface();
    return event;
  }

  let summary = "";
  let status: AgentLoopResult["status"] = "failed";
  let turns = 0;
  let toolCallsExecuted = Math.max(0, Math.floor(initialToolCallsExecuted));
  let lastToolFailure: {
    toolName: string;
    error: string;
    args?: Record<string, unknown>;
  } | null = null;
  let continuation: AgentLoopContinuation | undefined;
  let modelServiceNotice: ModelServiceNotice | undefined;
  let lastExecutedToolSignature: string | null =
    findLastExecutedToolSignature(messages);
  let toolFailureStreak: {
    toolName: string;
    kind: string;
    count: number;
  } | null = null;
  const currentToolFailureStreak = () => toolFailureStreak;
  const currentLoopStatus = (): AgentLoopResult["status"] => status;
  let toolFailureLoopRecoveryAttempts = 0;
  const toolCallCounts = new Map<string, number>();
  const emittedStrategyGuards = new Set<string>();
  const successfulToolNames = new Set<string>();
  const toolRuntime = createToolRuntime({
    authorizationService: toolAuthorizationService,
    toolExecutor,
    guards: [
      {
        name: "native_fallback",
        evaluate(context) {
          const reason = rejectNativeToolFallback({
            toolName: context.request.toolName,
            args: context.request.args,
            successfulToolNames,
          });
          return reason
            ? { allowed: false as const, reason }
            : { allowed: true as const };
        },
      },
    ],
  });
  // Exploration dedup: track successful read-class calls per run so
  // cross-turn duplicate exploration is surfaced to the model instead of
  // silently burning turns (observed in production: same files re-read
  // dozens of times in long goal runs).
  const explorationDedup = createExplorationDedupTracker();
  let emittedExplorationGuards = 0;
  const contextTokenBudget = resolveContextTokenBudget({
    contextWindow: modelProfile.contextWindow,
    maxOutputTokens: modelProfile.maxTokens,
  });
  let contextCompactionCount = 0;
  let latestContextUsage: AgentContextUsage | undefined;
  let lastContextCompaction: AgentContextCompactionSummary | undefined;
  // Token consumption is observability-only and never changes run status.
  let cumulativeTokensConsumed = Math.max(
    0,
    Math.floor(initialTokensConsumed),
  );
  let cumulativeTokensEstimated =
    cumulativeTokensConsumed > 0 && initialTokensEstimated;

  function estimateConsumedTokens(): number {
    return cumulativeTokensConsumed > 0
      ? cumulativeTokensConsumed
      : Math.max(1, contextSurface.estimatedTokens());
  }

  function areConsumedTokensEstimated(): boolean {
    return cumulativeTokensConsumed <= 0 || cumulativeTokensEstimated;
  }

  /**
   * Enforce the provider message-sequence invariant on the live
   * conversation. Runs before every model request (synthesizing answers for
   * interrupted tool batches) and once more when the loop exits (trimming
   * unanswered calls) so persisted transcripts can never poison a resume.
   * Returns the repairs so callers can observe them.
   */
  function enforceMessageIntegrity(
    unresolvedToolCalls: "synthesize" | "trim",
  ) {
    const { messages: sanitized, repairs } = sanitizeChatMessages(messages, {
      unresolvedToolCalls,
    });
    if (repairs.length === 0) {
      return repairs;
    }
    replaceSurface(sanitized, { reason: "message-integrity" });
    return repairs;
  }

  function recordModelResponseTokens(
    response: ChatCompletionResponse,
  ): void {
    const hasReportedUsage = Boolean(response.usage);
    const turnTokens = hasReportedUsage
      ? (response.usage?.inputTokens ?? 0) +
        (response.usage?.outputTokens ?? 0)
      : estimateCompletionTokens(
          contextSurface.messages(),
          response,
          contextManager,
          contextSurface.estimatedTokens(),
        );
    if (!hasReportedUsage) {
      cumulativeTokensEstimated = true;
    }
    cumulativeTokensConsumed += turnTokens;
  }

  function reportContextUsage(estimatedTokens: number): AgentContextUsage {
    const usage = createAgentContextUsage({
      estimatedTokens,
      tokenBudget: contextTokenBudget,
      messageCount: contextSurface.stats().visibleMessageCount,
      compactionCount: contextCompactionCount,
      ...(modelProfile.contextWindow
        ? { contextWindow: modelProfile.contextWindow }
        : {}),
      ...(lastContextCompaction
        ? { lastCompaction: lastContextCompaction }
        : {}),
      updatedAt: new Date().toISOString(),
    });
    latestContextUsage = usage;
    onContextUsage?.(usage);
    return usage;
  }

  async function compactMessagesBeforeModelRequest() {
    const estimatedTokens = contextSurface.estimatedTokens();
    if (estimatedTokens <= contextTokenBudget) {
      reportContextUsage(estimatedTokens);
      return;
    }

    const originalMessageCount = messages.length;

    // P2: route through the compaction strategy when provided. Default flag
    // `auto` degrades to summarize (= compressMessages) when no checkpoint
    // exists — byte-equivalent to the legacy path unless a rebuild happens.
    if (compactionStrategy) {
      const result = await compactionStrategy.compact({
        messages: contextSurface.messages(),
        budget: contextTokenBudget,
        runId: runId ?? taskId ?? requestId ?? modelProfile.model,
        estimatedTokens,
        surfaceNodeIds: contextSurface.visibleNodeIds(),
        protectedMarkers: [NEVER_COMPACT_MARKER],
      });
      if (
        !result.compacted ||
        result.messages.length === 0 ||
        result.afterTokens >= estimatedTokens
      ) {
        throwContextCompactionNoProgress(
          estimatedTokens,
          contextTokenBudget,
        );
      }
      const replacement = replaceSurface(result.messages, {
        reason: result.strategy,
        strategy: result.strategy,
        ...(result.checkpointRef
          ? { checkpointRef: result.checkpointRef }
          : {}),
      });
      const compactedTokens = contextSurface.estimatedTokens();
      contextCompactionCount += 1;
      lastContextCompaction = {
        strategy: result.strategy,
        beforeMessages: originalMessageCount,
        afterMessages: messages.length,
        beforeTokens: estimatedTokens,
        afterTokens: compactedTokens,
        compactedAt: new Date().toISOString(),
      };
      onContextCompacted?.({
        originalMessageCount,
        compactedMessageCount: messages.length,
        estimatedTokens,
        compactedTokens,
        tokenBudget: contextTokenBudget,
        strategy: result.strategy,
        surfaceReplacementId: replacement.id,
        shadowedNodeCount: replacement.shadowedNodeIds.length,
        sourceNodeCount: replacement.sourceNodeIds.length,
      });
      reportContextUsage(compactedTokens);
      return;
    }

    const surfaceMessages = contextSurface.messages();
    const compacted = contextManager.compressMessages(
      surfaceMessages,
      contextTokenBudget,
      estimatedTokens,
    );
    const nextTokens = contextManager.estimateTokens(compacted);
    if (
      compacted.length === 0 ||
      nextTokens >= estimatedTokens
    ) {
      throwContextCompactionNoProgress(
        estimatedTokens,
        contextTokenBudget,
      );
    }

    const replacement = replaceSurface(compacted, {
      reason: "summarize",
      strategy: "summarize",
    });
    const compactedTokens = contextSurface.estimatedTokens();
    contextCompactionCount += 1;
    lastContextCompaction = {
      strategy: "summarize",
      beforeMessages: originalMessageCount,
      afterMessages: messages.length,
      beforeTokens: estimatedTokens,
      afterTokens: compactedTokens,
      compactedAt: new Date().toISOString(),
    };
    onContextCompacted?.({
      originalMessageCount,
      compactedMessageCount: messages.length,
      estimatedTokens,
      compactedTokens,
      tokenBudget: contextTokenBudget,
      strategy: "summarize",
      surfaceReplacementId: replacement.id,
      shadowedNodeCount: replacement.shadowedNodeIds.length,
      sourceNodeCount: replacement.sourceNodeIds.length,
    });
    reportContextUsage(compactedTokens);
  }

  /** Evaluate system-reminder triggers and inject matching reminders as synthetic user messages. */
  function injectSystemReminders(ctx: SystemReminderContext): void {
    if (!systemReminderRegistry) return;
    const reminders = systemReminderRegistry.evaluate(ctx);
    if (reminders.length === 0) return;

    // Insert each reminder after the last user message in the list.
    // This ensures system-reminders appear after any real user instruction
    // but before the model's next assistant/tool response.
    for (const reminder of reminders) {
      let lastUserIdx = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          lastUserIdx = i;
          break;
        }
      }
      insertMessage(lastUserIdx + 1, { role: "user", content: reminder });
    }
  }

  function rememberToolFailure(
    toolName: string,
    error: string,
    args?: Record<string, unknown>,
  ): void {
    lastToolFailure = {
      toolName,
      error,
      ...(args ? { args } : {}),
    };
  }

  async function finalizeWithoutTools(options: {
    prompt: string;
    summaryPrefix: string;
    fallbackSummary: string;
  }) {
    onTurn?.(turns, "finalizing");
    appendMessage({
      role: "system",
      content: options.prompt,
    });
    injectSystemReminders({
      estimatedTokens: contextSurface.estimatedTokens(),
      tokenBudget: contextTokenBudget,
    });
    await compactMessagesBeforeModelRequest();
    enforceMessageIntegrity("synthesize");

    try {
      const response = await raceWithCancellation(completeModelRequest({
        ...modelProfile,
        messages: contextSurface.messages(),
        ...(signal ? { signal } : {}),
      }, turns + 1), signal);

      recordModelResponseTokens(response);

      if (response.content) {
        summary = `${options.summaryPrefix}\n\n${response.content}`;
        status = "succeeded";
        appendMessage({
          role: "assistant",
          content: response.content,
        });
      } else {
        summary = options.fallbackSummary;
        status = "failed";
      }
    } catch (error) {
      summary = `${options.fallbackSummary}${
        error instanceof Error ? ` 总结生成失败：${error.message}` : ""
      }`;
      status = "failed";
    }
  }

  function recordToolStrategySignals(
    toolName: string,
  ): AgentLoopStrategyGuardEvent | null {
    const count = (toolCallCounts.get(toolName) ?? 0) + 1;
    toolCallCounts.set(toolName, count);

    const capability = getToolCapability(toolName);
    const guardKey = `FRAGMENTED_TOOL_CALLS:${toolName}`;
    if (
      count === 4 &&
      capability &&
      capability.sideEffect === "local_read" &&
      !capability.supportsBatch &&
      !emittedStrategyGuards.has(guardKey)
    ) {
      emittedStrategyGuards.add(guardKey);
      const event: AgentLoopStrategyGuardEvent = {
        code: "FRAGMENTED_TOOL_CALLS",
        severity: "warn",
        message: `${toolName} has been called ${count} times in one loop; switch to a batch or recursive strategy.`,
        toolName,
        count,
      };
      onStrategyGuard?.(event);
      return event;
    }

    return null;
  }

  async function completeModelRequest(
    request: ChatCompletionRequest,
    turn: number,
  ): Promise<ChatCompletionResponse> {
    if (modelRequestExecutor) {
      return modelRequestExecutor(request, turn);
    }
    if (isStreamingChatClient(chatClient)) {
      // Transport resilience: a stream that stalls mid-generation (SSE idle
      // timeout, connection reset) previously failed the whole run even
      // though the request is idempotent. Retry the stream a bounded number
      // of times before giving up. Thinking-style models routinely pause
      // longer than the 30s per-read idle budget, so a single idle timeout
      // must never be fatal.
      const maxStreamAttempts = 3;
      for (let attempt = 1; attempt <= maxStreamAttempts; attempt += 1) {
        try {
          return await aggregateStreamingCompletion(chatClient, request, (event) => {
            onModelStreamEvent?.(event, turn);
          });
        } catch (error) {
          if (
            error instanceof StreamingCompletionError &&
            !error.hasMeaningfulStreamEvent &&
            !isStreamAbortError(error.cause, request.signal)
          ) {
            if (
              modelServiceNoticeFromError(error.cause, {
                provider: modelProfile.providerId,
                model: modelProfile.model,
              })
            ) {
              throw error.cause;
            }
            return completeWithModelRetry(
              chatClient,
              request,
              modelRetry,
              onModelRetry,
            );
          }
          const retryableStreamFailure =
            error instanceof StreamingCompletionError &&
            !isStreamAbortError(error.cause, request.signal) &&
            isRetryableStreamError(error.cause) &&
            !modelServiceNoticeFromError(error.cause, {
              provider: modelProfile.providerId,
              model: modelProfile.model,
            });
          if (retryableStreamFailure && attempt < maxStreamAttempts) {
            const delayMs = Math.min(2_000 * attempt, 5_000);
            await onModelRetry?.({
              attempt,
              maxRetries: maxStreamAttempts - 1,
              delayMs,
              error: `模型流中断（第 ${attempt} 次），即将重试：${
                error.cause instanceof Error
                  ? error.cause.message
                  : String(error.cause ?? "unknown")
              }`,
            });
            await sleepBeforeStreamRetry(delayMs, request.signal);
            continue;
          }
          throw error;
        }
      }
      throw new Error("Model stream retries exhausted.");
    }

    return completeWithModelRetry(
      chatClient,
      request,
      modelRetry,
      onModelRetry,
    );
  }

  function isRetryableStreamError(error: unknown): boolean {
    const message =
      error instanceof Error ? error.message : String(error ?? "");
    return /idle timeout|timed out|timeout|ECONNRESET|EPIPE|network|fetch failed|socket|terminated|overloaded/i.test(
      message,
    );
  }

  async function sleepBeforeStreamRetry(
    delayMs: number,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        reject(
          signal?.reason instanceof Error
            ? signal.reason
            : new Error("Agent loop canceled."),
        );
      };
      const timeout = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, delayMs);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  try {
    for (;; turns += 1) {
      if (signal?.aborted) {
        status = "canceled";
        summary = "Agent loop canceled.";
        break;
      }

      onTurn?.(turns, "executing");
      injectSystemReminders({
        estimatedTokens: contextSurface.estimatedTokens(),
        tokenBudget: contextTokenBudget,
        loopSignature: lastExecutedToolSignature,
        loopCount: currentToolFailureStreak()?.count,
        // Only signal "execution" on the first turn after planning,
        // so mode_transition fires exactly once at the boundary.
        mode: turns === 0 ? "planning" : turns === 1 ? "execution" : undefined,
      });
      await compactMessagesBeforeModelRequest();
      enforceMessageIntegrity("synthesize");

      const response = await raceWithCancellation(completeModelRequest({
        ...modelProfile,
        messages: contextSurface.messages(),
        tools: toolDefinitions,
        tool_choice: "auto",
        ...(signal ? { signal } : {}),
      }, turns + 1), signal);
      onModelResponse?.(response, turns + 1);
      if (response.reasoningContent) {
        onReasoning?.(response.reasoningContent, turns + 1);
      }

      recordModelResponseTokens(response);
      modelServiceNotice =
        response.modelServiceNotice ??
        modelServiceNoticeFromFinishReason(response.finishReason, {
          provider: modelProfile.providerId,
          model: modelProfile.model,
        });
      if (modelServiceNotice) {
        const partialContent =
          response.content?.trim() ||
          response.reasoningContent?.trim() ||
          modelServiceNotice.message;
        appendMessage({ role: "assistant", content: partialContent });
        status = "paused";
        continuation = {
          reason: continuationReasonForNotice(modelServiceNotice),
          maxTurns: checkpointInterval,
          toolCallsExecuted,
        };
        summary = partialContent;
        break;
      }

      // No tool calls + content → final
      if (!response.toolCalls.length && response.content) {
        summary = response.content;
        status = "succeeded";
        appendMessage({ role: "assistant", content: response.content });
        break;
      }

      if (!response.toolCalls.length && response.reasoningContent?.trim()) {
        summary = buildFinalReplyFromReasoningContent(response.reasoningContent);
        status = "succeeded";
        appendMessage({
          role: "assistant",
          content: summary,
        });
        break;
      }

      // Tool calls present
      if (response.toolCalls.length > 0) {
        const preparedToolCalls = response.toolCalls.map((toolCall) => {
          let args: Record<string, unknown> | null = null;
          try {
            args = JSON.parse(
              toolCall.function.arguments,
            ) as Record<string, unknown>;
          } catch {
            // Keep the existing parse-error path below.
          }
          const registeredToolSource = getToolSource(
            toolExecutor,
            toolCall.function.name,
          );

          return {
            toolCall,
            toolName: toolCall.function.name,
            args,
            signature: args
              ? createToolCallSignature(toolCall.function.name, args)
              : null,
            mode: getToolConcurrencyMode(
              toolCall.function.name,
              args,
              registeredToolSource,
            ),
            registeredToolSource,
          } satisfies PreparedAgentToolCall;
        });
        const repeatedToolCall =
          preparedToolCalls.length === 1 &&
          preparedToolCalls[0]?.signature &&
          preparedToolCalls[0].signature === lastExecutedToolSignature
            ? preparedToolCalls[0]
            : null;

        if (repeatedToolCall?.args) {
          await finalizeWithoutTools({
            prompt: buildRepeatedToolCallFinalizationPrompt(
              repeatedToolCall.toolName,
              repeatedToolCall.args,
              toolCallsExecuted,
            ),
            summaryPrefix: "检测到模型重复请求相同工具，我先基于已有结果给出阶段性总结：",
            fallbackSummary: buildRepeatedToolCallFallbackSummary(
              repeatedToolCall.toolName,
              toolCallsExecuted,
            ),
          });
          break;
        }

        // Add assistant message with tool calls
        appendMessage({
          role: "assistant",
          content: response.content ?? "",
          tool_calls: response.toolCalls,
        });
        const assistantToolMessageIndex = messages.length - 1;
        const processedToolCalls: ToolCall[] = [];

        const policyAdmission = createSerialToolPolicyAdmission();
        let firstDispatchError: unknown;
        let stopRemainingToolBatch = false;
        const pendingBatchSystemMessages: ChatMessage[] = [];

        const commitToolExecution = async (
          execution: ExecutedAgentToolCall,
        ): Promise<void> => {
          const {
            prepared,
            args,
            toolEventBase,
            runtimeOutcome,
            transitionInvocation,
          } = execution;
          const { toolCall, toolName, signature } = prepared;
          if (!args || !runtimeOutcome || !transitionInvocation) {
            const parseFailure: AgentToolExecutionResult = {
              ok: false,
              error: "参数 JSON 解析失败",
            };
            appendMessage({
              role: "tool",
              tool_call_id: toolCall.id,
              name: toolName,
              content: JSON.stringify({
                type: "tool_result",
                tool: toolName,
                ok: false,
                error: parseFailure.error,
              }),
            });
            processedToolCalls.push(toolCall);
            rememberToolFailure(toolName, parseFailure.error);
            onToolResult?.(
              toolName,
              false,
              parseFailure,
              toolEventBase,
            );
            return;
          }

          const result = runtimeOutcome.result;
          if (!runtimeOutcome.dispatched) {
            const failure = result.ok ? "工具调用未执行。" : result.error;
            transitionInvocation({
              status: "error",
              error: failure,
            });
            appendMessage({
              role: "tool",
              tool_call_id: toolCall.id,
              name: toolName,
              content: serializeToolObservation({
                tool: toolName as never,
                ok: false,
                error: failure,
                toolCallId: toolCall.id,
              }),
            });
            processedToolCalls.push(toolCall);
            rememberToolFailure(toolName, failure, args);
            onToolResult?.(toolName, false, {
              ok: false,
              error: failure,
              ...(!result.ok && result.errorDetails
                ? { errorDetails: result.errorDetails }
                : {}),
            }, toolEventBase);
            return;
          }

          toolCallsExecuted += 1;
          const strategyGuardEvent = recordToolStrategySignals(toolName);
          lastExecutedToolSignature = signature;
          if (result.ok) {
            successfulToolNames.add(toolName);
          } else {
            rememberToolFailure(toolName, result.error, args);
          }
          const failureLoop = updateToolFailureStreak(
            toolFailureStreak,
            toolName,
            result,
          );
          toolFailureStreak = failureLoop.streak;
          if (result.ok) {
            toolFailureLoopRecoveryAttempts = 0;
          }

          const serializedObservation =
            await serializeToolObservationWithOffload({
              tool: toolName as never,
              ok: result.ok,
              ...(result.ok
                ? {
                    result: (
                      result as { result: Record<string, unknown> }
                    ).result,
                  }
                : {
                    error: result.error,
                    ...(result.errorDetails
                      ? { errorDetails: result.errorDetails }
                      : {}),
                  }),
              toolCallId: toolCall.id,
            }, {
              store: toolResultOffloadStore,
              thresholdChars: toolResultOffloadThreshold,
              runId: taskId,
              sessionId: runContext?.sessionId,
              requestId,
              workspaceRunId,
            });
          const toolResultEvent = buildToolEvent({
            toolCallId: toolCall.id,
            runId: taskId,
            sessionId: runContext?.sessionId,
            requestId,
            workspaceRunId,
            resultRef: serializedObservation.resultRef,
            resultBytes: serializedObservation.originalChars,
          });
          transitionInvocation(
            result.ok
              ? {
                  status: "completed",
                  ok: true,
                  ...(serializedObservation.resultRef
                    ? { resultRef: serializedObservation.resultRef }
                    : {}),
                }
              : {
                  status: "error",
                  ok: false,
                  error: result.error,
                  ...(serializedObservation.resultRef
                    ? { resultRef: serializedObservation.resultRef }
                    : {}),
                },
          );
          appendMessage({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolName,
            content: serializedObservation.content,
          });
          processedToolCalls.push(toolCall);
          onToolResult?.(toolName, result.ok, result, toolResultEvent);

          const explorationDedupCheck = explorationDedup.check(
            toolName,
            args,
            turns + 1,
          );
          if (result.ok) {
            if (isMutatingToolCall(toolName, args)) {
              explorationDedup.recordMutation(toolName);
            } else if (isReadClassTool(toolName)) {
              explorationDedup.recordRead(
                toolName,
                args,
                turns + 1,
                buildReadResultDigest(serializedObservation.content),
              );
            }
          }

          if (isTerminalToolBatchStatus(currentLoopStatus())) {
            return;
          }
          const selfFinalizingSummary = buildSelfFinalizingToolSummary(
            toolName,
            result,
          );
          if (selfFinalizingSummary) {
            status = "succeeded";
            summary = selfFinalizingSummary;
            return;
          }
          if (pauseOnStrategyGuard && strategyGuardEvent) {
            status = "paused";
            continuation = {
              reason: "strategy_guard",
              maxTurns: checkpointInterval,
              toolCallsExecuted,
              toolName,
              strategyGuardCode: strategyGuardEvent.code,
            };
            summary = buildStrategyGuardPauseSummary(
              strategyGuardEvent,
              toolCallsExecuted,
            );
            return;
          }
          if (strategyGuardEvent) {
            pendingBatchSystemMessages.push({
              role: "system",
              content: [
                `Strategy guard warning (${strategyGuardEvent.code}): ${strategyGuardEvent.message}`,
                "Continue the task, but switch to a batch, recursive, inventory, or search tool before making another call of the same kind.",
              ].join("\n"),
            });
          }
          if (explorationDedupCheck?.isDuplicate && result.ok) {
            pendingBatchSystemMessages.push({
              role: "system",
              content: buildExplorationDedupNote({
                toolName,
                args,
                priorReads: explorationDedupCheck.priorReads,
                firstTurn: explorationDedupCheck.firstTurn,
                lastTurn: explorationDedupCheck.lastTurn,
                ...(explorationDedupCheck.digest
                  ? { digest: explorationDedupCheck.digest }
                  : {}),
              }),
            });
            const nextGuardThreshold =
              (emittedExplorationGuards + 1) * 3;
            if (explorationDedup.duplicateCount() >= nextGuardThreshold) {
              emittedExplorationGuards += 1;
              onStrategyGuard?.({
                code: "REPEATED_EXPLORATION",
                severity: "warn",
                message: `The model has re-read already-explored targets ${explorationDedup.duplicateCount()} times in this run; reuse the existing evidence and focus on unexplored areas or the deliverable.`,
                toolName,
                count: explorationDedup.duplicateCount(),
              });
            }
          }
          if (
            pauseOnFailureLoop &&
            failureLoop.shouldPause &&
            !result.ok
          ) {
            const failureKind = failureLoop.streak?.kind ?? "unknown";
            const failureCount = failureLoop.streak?.count ?? 3;
            if (toolFailureLoopRecoveryAttempts < 1) {
              toolFailureLoopRecoveryAttempts += 1;
              toolFailureStreak = null;
              stopRemainingToolBatch = true;
              pendingBatchSystemMessages.push({
                role: "system",
                content: buildToolFailureLoopRecoveryPrompt({
                  toolName,
                  failureKind,
                  error: result.error,
                  args,
                  toolCallsExecuted,
                  count: failureCount,
                }),
              });
              return;
            }
            status = "paused";
            continuation = {
              reason: "tool_failure_loop",
              maxTurns: checkpointInterval,
              toolCallsExecuted,
              toolName,
              failureKind,
              failureError: result.error,
              failureArgs: args,
            };
            summary = buildToolFailureLoopPauseSummary({
              toolName,
              failureKind,
              error: result.error,
              args,
              toolCallsExecuted,
              count: failureCount,
            });
          }
        };

        await scheduleToolBatch(
          preparedToolCalls.map((prepared) => ({
            value: prepared,
            mode: prepared.mode,
          })),
          {
            maxParallel: maxParallelToolCalls,
            ...(signal ? { signal } : {}),
            async execute(prepared): Promise<ExecutedAgentToolCall> {
              const { toolCall, toolName } = prepared;
              const toolEventBase = buildToolEvent({
                toolCallId: toolCall.id,
                runId: taskId,
                sessionId: runContext?.sessionId,
                requestId,
                workspaceRunId,
              });
              if (!prepared.args) {
                return {
                  prepared,
                  args: null,
                  toolEventBase,
                };
              }
              const args = applyRunContextDefaultsToToolArgs(
                toolName,
                prepared.args,
                runContext,
              );
              return policyAdmission.run(async (release) => {
                const registeredToolSource =
                  prepared.registeredToolSource;
                const toolSource =
                  registeredToolSource ?? "built-in";
                let toolInvocation = createToolInvocation({
                  id: `tool_invocation_${toolCall.id}`,
                  runId:
                    taskId ??
                    workspaceRunId ??
                    requestId ??
                    runContext?.runId ??
                    "agent_loop",
                  toolCallId: toolCall.id,
                  toolName,
                  source: toolSource,
                  args,
                  createdAt: new Date().toISOString(),
                });
                const emitToolInvocation = () => {
                  onToolInvocation?.(toolInvocation);
                };
                const transitionInvocation = (
                  transition: Omit<
                    ToolInvocationTransition,
                    "at"
                  > & { at?: string },
                ) => {
                  toolInvocation = transitionToolInvocation(
                    toolInvocation,
                    {
                      ...transition,
                      at:
                        transition.at ??
                        new Date().toISOString(),
                    },
                  );
                  emitToolInvocation();
                };
                emitToolInvocation();
                transitionInvocation({ status: "visible" });

                let runtimeOutcome: ToolRuntimeOutcome;
                try {
                  runtimeOutcome = await toolRuntime.execute({
                    taskId: taskId ?? "",
                    request: {
                      toolName,
                      ...(registeredToolSource
                        ? { source: registeredToolSource }
                        : {}),
                      args,
                    },
                    authorizationOptions: {
                      ...(runtimeTask ? { runtimeTask } : {}),
                      onApprovalRequested: async (request) => {
                        transitionInvocation({
                          status: "waiting_approval",
                          reason: request.deniedReason,
                        });
                      },
                      onApprovalResolved: async (approval) => {
                        if (approval.approved) {
                          transitionInvocation({
                            status: "authorized",
                            reason:
                              approval.reason ?? "user approved",
                          });
                        }
                      },
                    },
                    executionOptions: {
                      ...(signal ? { signal } : {}),
                      ...(runContext ? { runContext } : {}),
                      onRuntimeEvent(runtimeEvent) {
                        onToolRuntimeEvent?.(
                          toolName,
                          runtimeEvent,
                          toolEventBase,
                        );
                      },
                      toolResultReadScope: {
                        ...(taskId ? { runId: taskId } : {}),
                        ...(runContext?.sessionId
                          ? { sessionId: runContext.sessionId }
                          : {}),
                        ...(requestId ? { requestId } : {}),
                        ...(workspaceRunId
                          ? { workspaceRunId }
                          : {}),
                      },
                    },
                    onStage(event) {
                      if (
                        event.stage === "authorized" &&
                        toolInvocation.status !== "authorized"
                      ) {
                        transitionInvocation({
                          status: "authorized",
                          reason: event.reason,
                        });
                      }
                      if (event.stage === "dispatching") {
                        onToolCall?.(
                          toolName,
                          args,
                          toolEventBase,
                        );
                        transitionInvocation({ status: "running" });
                        release();
                      }
                    },
                  });
                } catch (error) {
                  transitionInvocation({
                    status: "error",
                    error:
                      error instanceof Error
                        ? error.message
                        : String(error),
                  });
                  throw error;
                }
                return {
                  prepared,
                  args,
                  toolEventBase,
                  runtimeOutcome,
                  transitionInvocation,
                };
              }, signal ? { signal } : {});
            },
            async commit(batchResult) {
              if (batchResult.status === "rejected") {
                firstDispatchError ??= batchResult.reason;
                return;
              }
              if (batchResult.status === "fulfilled") {
                await commitToolExecution(batchResult.value);
              }
            },
            afterGroup() {
              return (
                !stopRemainingToolBatch &&
                !isTerminalToolBatchStatus(currentLoopStatus())
              );
            },
          },
        );

        if (
          trimUnansweredToolCalls(
            messages[assistantToolMessageIndex],
            processedToolCalls,
          )
        ) {
          replaceSurface(messages, { reason: "tool-batch-trim" });
        }
        for (const pendingMessage of pendingBatchSystemMessages) {
          appendMessage(pendingMessage);
        }
        if (firstDispatchError && !signal?.aborted) {
          throw firstDispatchError;
        }
        if (signal?.aborted) {
          status = "canceled";
          summary = "Agent loop canceled during tool execution.";
        }
        if (!signal?.aborted && processedToolCalls.length > 0) {
          const reachedCheckpointInterval =
            (turns + 1) % checkpointInterval === 0;
          await emitCheckpoint(
            reachedCheckpointInterval
              ? "Checkpoint interval reached; state saved and execution continues automatically."
              : "Continue from the completed tool-call batch.",
          );
        }

        const batchStatus = currentLoopStatus();
        if (batchStatus === "paused") {
          break;
        }
        if (batchStatus === "succeeded" || batchStatus === "canceled") {
          break;
        }

        continue;
      }

      // No content and no tool calls
      summary = lastToolFailure
        ? buildEmptyModelResponseAfterToolFailureSummary(lastToolFailure)
        : "模型没有返回可用回复。请稍后重试，或换一个更明确的问题。";
      break;
    }

  } catch (error) {
    if (signal?.aborted) {
      status = "canceled";
      summary = "Agent loop canceled.";
    } else {
      modelServiceNotice = modelServiceNoticeFromError(
        error instanceof StreamingCompletionError ? error.cause : error,
        { provider: modelProfile.providerId, model: modelProfile.model },
      );
      if (modelServiceNotice) {
        status = "paused";
        continuation = {
          reason: continuationReasonForNotice(modelServiceNotice),
          maxTurns: checkpointInterval,
          toolCallsExecuted,
        };
        summary = modelServiceNotice.message;
      } else {
        status = "failed";
        summary = error instanceof Error ? error.message : "Agent loop failed.";
      }
    }
  }

  // Final integrity pass: anything that leaves the loop — success, failure,
  // pause, cancel, or an exception escaping mid-tool-batch — carries a
  // transcript that satisfies the provider invariant. Unanswered tool calls
  // are trimmed (not synthesized) so persisted checkpoints never replay a
  // dead call into the next run.
  enforceMessageIntegrity("trim");

  return {
    summary,
    status,
    turns,
    messages: contextSurface.messages(),
    toolCallsExecuted,
    tokensConsumed: estimateConsumedTokens(),
    tokensEstimated: areConsumedTokensEstimated(),
    contextSurface: contextSurface.snapshot(),
    ...(latestContextUsage ? { contextUsage: latestContextUsage } : {}),
    ...(continuation ? { continuation } : {}),
    ...(modelServiceNotice ? { modelServiceNotice } : {}),
  };
}

function isStreamingChatClient(
  client: ChatClient,
): client is ChatClient & StreamingChatClient {
  return typeof (client as { streamComplete?: unknown }).streamComplete === "function";
}

async function raceWithCancellation<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    void promise.catch(() => undefined);
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Agent loop canceled.");
  }

  let abortHandler: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        abortHandler = () => {
          void promise.catch(() => undefined);
          reject(
            signal.reason instanceof Error
              ? signal.reason
              : new Error("Agent loop canceled."),
          );
        };
        signal.addEventListener("abort", abortHandler, { once: true });
      }),
    ]);
  } finally {
    if (abortHandler) signal.removeEventListener("abort", abortHandler);
  }
}

function throwIfCanceled(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new Error("Agent loop canceled.");
  }
}

class StreamingCompletionError extends Error {
  readonly hasMeaningfulStreamEvent: boolean;
  override readonly cause: unknown;

  constructor(error: unknown, hasMeaningfulStreamEvent: boolean) {
    super(error instanceof Error ? error.message : String(error ?? "Model stream failed."));
    this.name = "StreamingCompletionError";
    this.cause = error;
    this.hasMeaningfulStreamEvent = hasMeaningfulStreamEvent;
  }
}

async function aggregateStreamingCompletion(
  chatClient: ChatClient & StreamingChatClient,
  request: ChatCompletionRequest,
  onStreamEvent?: (event: StreamEvent) => void,
): Promise<ChatCompletionResponse> {
  let content = "";
  let reasoningContent = "";
  let finishReason = "stop";
  let streamModelServiceNotice: ModelServiceNotice | undefined;
  let activeToolCallKey: string | null = null;
  let hasMeaningfulStreamEvent = false;
  const toolCalls = new Map<string, { id: string; name: string; arguments: string }>();

  try {
    for await (const event of chatClient.streamComplete(request)) {
      throwIfCanceled(request.signal);
      onStreamEvent?.(event);

      if (event.type === "content_delta") {
        hasMeaningfulStreamEvent = true;
        content += event.text;
        continue;
      }

      if (event.type === "reasoning_delta") {
        hasMeaningfulStreamEvent = true;
        reasoningContent += event.text;
        continue;
      }

      if (event.type === "tool_call_delta") {
        hasMeaningfulStreamEvent = true;
        const index = normalizeStreamToolCallIndex(event.index);
        const key: string =
          index !== undefined
            ? `index:${index}`
            : event.id
              ? `id:${event.id}`
              : activeToolCallKey && toolCalls.size <= 1
                ? activeToolCallKey
                : `legacy:${toolCalls.size + 1}`;
        if (index === undefined) {
          activeToolCallKey = key;
        }
        const fallbackId =
          index !== undefined
            ? `tool_call_${index + 1}`
            : key.replace(/^(id|legacy):/, "") || `tool_call_${toolCalls.size + 1}`;
        const existing = toolCalls.get(key) ?? {
          id: event.id || fallbackId,
          name: "",
          arguments: "",
        };
        if (event.id) {
          existing.id = event.id;
        }
        if (event.name) {
          existing.name = event.name;
        }
        if (event.arguments) {
          existing.arguments += event.arguments;
        }
        toolCalls.set(key, existing);
        continue;
      }

      finishReason = event.finishReason || finishReason;
      streamModelServiceNotice =
        event.modelServiceNotice ?? streamModelServiceNotice;
    }
  } catch (error) {
    throw new StreamingCompletionError(error, hasMeaningfulStreamEvent);
  }

  throwIfCanceled(request.signal);

  return {
    content: content || null,
    toolCalls: [...toolCalls.values()].map((toolCall) => ({
      id: toolCall.id,
      type: "function" as const,
      function: {
        name: toolCall.name,
        arguments: toolCall.arguments,
      },
    })),
    finishReason,
    ...(streamModelServiceNotice ??
    modelServiceNoticeFromFinishReason(finishReason, {
      model: request.model,
    })
      ? {
          modelServiceNotice:
            streamModelServiceNotice ??
            modelServiceNoticeFromFinishReason(finishReason, {
              model: request.model,
            }),
        }
      : {}),
    ...(reasoningContent ? { reasoningContent } : {}),
  };
}

function continuationReasonForNotice(
  notice: ModelServiceNotice,
): AgentLoopContinuation["reason"] {
  switch (notice.kind) {
    case "output_limit":
      return "provider_output_limit";
    case "rate_limit":
      return "provider_rate_limit";
    case "quota_exhausted":
      return "provider_quota";
    case "provider_stop":
      return "provider_stop";
  }
}

function normalizeStreamToolCallIndex(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}

function isStreamAbortError(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  return (
    signal?.aborted ||
    (error instanceof Error && /abort|aborted|cancell?ed|cancelled/i.test(error.message))
  );
}

function buildToolFailureLoopPauseSummary(options: {
  toolName: string;
  failureKind: string;
  error?: string;
  args?: Record<string, unknown>;
  toolCallsExecuted: number;
  count: number;
}): string {
  return [
    `连续 ${options.count} 次工具失败（${options.toolName}，${options.failureKind}）。`,
    ...(options.error ? [`最近错误：${truncateForPrompt(options.error, 240)}`] : []),
    ...(options.args ? [`最近参数：${formatToolArgsForPrompt(options.args)}`] : []),
    `我已经暂停，避免继续在同一个失败模式里空转。累计执行 ${options.toolCallsExecuted} 个工具。`,
    "你可以回复“继续”让我带着已有诊断接着试，也可以调整目标、提供脚本参数或要求我换一种工具路径。",
  ].join("\n");
}

function buildToolEvent(input: AgentLoopToolEvent): AgentLoopToolEvent {
  return {
    toolCallId: input.toolCallId,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.workspaceRunId ? { workspaceRunId: input.workspaceRunId } : {}),
    ...(input.resultRef ? { resultRef: input.resultRef } : {}),
    ...(typeof input.resultBytes === "number"
      ? { resultBytes: input.resultBytes }
      : {}),
  };
}

function trimUnansweredToolCalls(
  assistantMessage: ChatMessage | undefined,
  processedToolCalls: ToolCall[],
): boolean {
  if (
    !assistantMessage ||
    assistantMessage.role !== "assistant" ||
    !assistantMessage.tool_calls ||
    processedToolCalls.length >= assistantMessage.tool_calls.length
  ) {
    return false;
  }

  assistantMessage.tool_calls = processedToolCalls;
  return true;
}

function isTerminalToolBatchStatus(
  status: AgentLoopResult["status"],
): boolean {
  return (
    status === "paused" ||
    status === "succeeded" ||
    status === "canceled"
  );
}

function throwContextCompactionNoProgress(
  estimatedTokens: number,
  tokenBudget: number,
): never {
  throw new Error(
    `Context compaction made no progress: ${estimatedTokens} estimated tokens exceed the ${tokenBudget} token budget.`,
  );
}

function applyRunContextDefaultsToToolArgs(
  toolName: string,
  args: Record<string, unknown>,
  runContext: AgentRunContext | undefined,
): Record<string, unknown> {
  if (!runContext || !isNativeWorkspaceRootTool(toolName)) {
    return args;
  }
  if (typeof args.workspaceRoot === "string" && args.workspaceRoot.trim()) {
    return args;
  }
  return {
    ...args,
    workspaceRoot: runContext.workspaceRoot,
  };
}

function isNativeWorkspaceRootTool(toolName: string): boolean {
  return (
    toolName === "code_search" ||
    toolName === "git_status" ||
    toolName === "git_diff" ||
    toolName === "test_run"
  );
}

function buildToolFailureLoopRecoveryPrompt(options: {
  toolName: string;
  failureKind: string;
  error: string;
  args: Record<string, unknown>;
  toolCallsExecuted: number;
  count: number;
}): string {
  return [
    `连续 ${options.count} 次工具失败（${options.toolName}，${options.failureKind}）。`,
    `最近错误：${truncateForPrompt(options.error, 240)}`,
    `最近参数：${formatToolArgsForPrompt(options.args)}`,
    `已执行工具数：${options.toolCallsExecuted}`,
    "",
    "恢复要求：",
    "- 不要继续用相同工具重试相同或猜测出来的路径。",
    "- 如果是路径不存在、文件名不确定或目录结构不清，先用 file_search 或列出已知父目录确认真实路径。",
    "- 如果已有成功工具结果足以回答用户，就停止继续探索，直接基于已有证据完成或给出阶段性结论。",
    "- 如果必须继续使用同类工具，先改变策略并说明依据。",
  ].join("\n");
}

function buildEmptyModelResponseAfterToolFailureSummary(options: {
  toolName: string;
  error: string;
  args?: Record<string, unknown>;
}): string {
  return [
    "模型没有返回可用回复，已停止本轮执行。",
    `最近失败工具：${options.toolName}`,
    `失败原因：${truncateForPrompt(options.error, 240)}`,
    ...(options.args ? [`最近参数：${formatToolArgsForPrompt(options.args)}`] : []),
    "这通常表示模型在工具失败后没有给出最终总结。你可以直接重试，或补充一个更明确的数据来源/链接后继续。",
  ].join("\n");
}

function buildFinalReplyFromReasoningContent(reasoningContent: string): string {
  return reasoningContent.trim();
}

function buildStrategyGuardPauseSummary(
  event: AgentLoopStrategyGuardEvent,
  toolCallsExecuted: number,
): string {
  return [
    `策略守护触发（${event.code}）：${event.toolName} 已在同一轮运行中调用 ${event.count} 次。`,
    `我已经暂停，避免继续用碎片化工具调用消耗时间。累计执行 ${toolCallsExecuted} 个工具。`,
    "继续前应切换到批量或递归策略，或缩小目标范围后再恢复。",
  ].join("\n");
}

function getToolSource(
  toolExecutor: AgentToolExecutor,
  toolName: string,
): string | null {
  try {
    return toolExecutor.getRegistry().getSource(toolName);
  } catch {
    return null;
  }
}

function updateToolFailureStreak(
  current: {
    toolName: string;
    kind: string;
    count: number;
  } | null,
  toolName: string,
  result: Awaited<ReturnType<AgentToolExecutor["execute"]>>,
): {
  streak: {
    toolName: string;
    kind: string;
    count: number;
  } | null;
  shouldPause: boolean;
} {
  if (result.ok) {
    return { streak: null, shouldPause: false };
  }

  const kind = normalizeToolFailureKind(result);
  const count =
    current && current.toolName === toolName && current.kind === kind
      ? current.count + 1
      : 1;
  const streak = { toolName, kind, count };

  return {
    streak,
    shouldPause: count >= 3,
  };
}

function normalizeToolFailureKind(
  result: Extract<
    Awaited<ReturnType<AgentToolExecutor["execute"]>>,
    { ok: false }
  >,
): string {
  const detailKind = result.errorDetails?.kind;
  if (typeof detailKind === "string" && detailKind.trim()) {
    return detailKind.trim();
  }
  if (/timeout|超时/i.test(result.error)) return "timeout";
  if (/enoent|not found|no such file|不存在|找不到/i.test(result.error)) {
    return "not_found";
  }
  if (/中断|cancel|abort/i.test(result.error)) return "canceled";
  if (/stdout\/stderr|no stdout|no stderr|无 stdout/i.test(result.error)) {
    return "empty_exit";
  }
  return "tool_error";
}

function formatToolArgsForPrompt(args: Record<string, unknown>): string {
  return truncateForPrompt(JSON.stringify(args), 240);
}

function truncateForPrompt(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function buildRepeatedToolCallFinalizationPrompt(
  toolName: string,
  args: Record<string, unknown>,
  toolCallsExecuted: number,
): string {
  return [
    `检测到模型重复请求相同工具（${toolName}，参数：${stableStringify(args)}）。`,
    `此前已执行 ${toolCallsExecuted} 个工具。`,
    "现在不要再调用工具。",
    "请只基于当前对话和已有工具结果，用中文给用户一个简洁的阶段性总结。",
    "如果需要继续，请说明应该换什么目标、路径或查询条件。",
  ].join("\n");
}

function buildRepeatedToolCallFallbackSummary(
  toolName: string,
  toolCallsExecuted: number,
): string {
  return `检测到模型重复请求相同工具（${toolName}），已停止继续执行以避免循环。已执行 ${toolCallsExecuted} 个工具，请缩小任务范围或换一个明确目标后重试。`;
}

function rejectNativeToolFallback(input: {
  toolName: string;
  args: Record<string, unknown>;
  successfulToolNames: ReadonlySet<string>;
}): string | null {
  if (!input.successfulToolNames.has("chrome_bookmarks_read")) {
    return null;
  }

  if (input.toolName === "shell_exec") {
    const command = String(input.args.command ?? "");
    if (isChromeBookmarkArtifactTarget(command)) {
      return [
        "chrome_bookmarks_read already returned structured Chrome bookmark data and bookmark_list artifact was already written.",
        "Do not use shell_exec to inspect bookmark_list.md after the native tool succeeds.",
        "Use the artifactPath/artifactRef from chrome_bookmarks_read in the final answer.",
      ].join(" ");
    }
    if (isChromeBookmarksFallbackTarget(command)) {
      return [
        "chrome_bookmarks_read already returned structured Chrome bookmark data.",
        "Do not use shell_exec, python, jq, cat, or generated scripts to parse Chrome Bookmarks JSON after the native tool succeeds.",
        "Use the chrome_bookmarks_read result or call tool_result_read when the observation was offloaded.",
      ].join(" ");
    }
  }

  if (input.toolName === "file_read") {
    const filePath = String(input.args.path ?? "");
    if (isChromeBookmarkArtifactTarget(filePath)) {
      return [
        "chrome_bookmarks_read already returned structured Chrome bookmark data and bookmark_list artifact was already written.",
        "Do not read bookmark_list.md back into the model after the native tool succeeds.",
        "Use the artifactPath/artifactRef from chrome_bookmarks_read in the final answer.",
      ].join(" ");
    }
    if (isChromeBookmarksFallbackTarget(filePath)) {
      return [
        "chrome_bookmarks_read already returned structured Chrome bookmark data.",
        "Do not inspect the raw Chrome Bookmarks path after the native tool succeeds.",
        "Use the chrome_bookmarks_read result or call tool_result_read when the observation was offloaded.",
      ].join(" ");
    }
  }

  if (input.toolName === "tool_result_read") {
    const ref = String(input.args.ref ?? "");
    if (ref.startsWith("artifact:")) {
      return [
        "chrome_bookmarks_read already returned structured Chrome bookmark data and bookmark_list artifact was already written.",
        "artifact refs are evidence references, not tool_result_read refs.",
        "Use the artifactPath/artifactRef from chrome_bookmarks_read in the final answer.",
      ].join(" ");
    }
  }

  if (
    input.toolName === "file_stat" ||
    input.toolName === "file_list" ||
    input.toolName === "file_search"
  ) {
    const requestedPath = String(
      input.toolName === "file_search"
        ? input.args.root ?? ""
        : input.args.path ?? "",
    );
    if (isChromeBookmarkArtifactTarget(requestedPath)) {
      return [
        "chrome_bookmarks_read already returned structured Chrome bookmark data and bookmark_list artifact was already written.",
        "Do not inspect bookmark_list.md after the native tool succeeds.",
        "Use the artifactPath/artifactRef from chrome_bookmarks_read in the final answer.",
      ].join(" ");
    }
    if (isChromeBookmarksFallbackTarget(requestedPath)) {
      return [
        "chrome_bookmarks_read already returned structured Chrome bookmark data.",
        "Do not inspect the raw Chrome Bookmarks path after the native tool succeeds.",
        "Use the chrome_bookmarks_read result or call tool_result_read when the observation was offloaded.",
      ].join(" ");
    }
  }

  return null;
}

function buildSelfFinalizingToolSummary(
  toolName: string,
  result: Awaited<ReturnType<AgentToolExecutor["execute"]>>,
): string | null {
  if (toolName !== "chrome_bookmarks_read" || !result.ok) {
    return null;
  }

  const answerPreview = result.result.answerPreview;
  const artifactRef = result.result.artifactRef;
  if (typeof answerPreview !== "string" || !answerPreview.trim()) {
    return null;
  }

  return typeof artifactRef === "string" && artifactRef
    ? answerPreview
    : null;
}

function isChromeBookmarksFallbackTarget(value: string): boolean {
  return /Google\/Chrome\/.*\/Bookmarks|Application Support\/Google\/Chrome|Chrome[^\n]*Bookmarks|Bookmarks[^\n]*Chrome/i.test(
    value,
  );
}

function isChromeBookmarkArtifactTarget(value: string): boolean {
  return /bookmark_list\.md|artifact:bookmark_list/i.test(value);
}

function createToolCallSignature(
  toolName: string,
  args: Record<string, unknown>,
): string {
  return `${toolName}:${stableStringify(args)}`;
}

function findLastExecutedToolSignature(messages: ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant" || message.tool_calls?.length !== 1) {
      continue;
    }

    const toolCall = message.tool_calls[0];
    if (!toolCall) {
      continue;
    }

    try {
      const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
      return createToolCallSignature(toolCall.function.name, args);
    } catch {
      return null;
    }
  }

  return null;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "undefined";
}

function estimateCompletionTokens(
  requestMessages: ChatMessage[],
  response: ChatCompletionResponse,
  contextManager: ContextManager,
  knownRequestTokens?: number,
): number {
  const output = [
    response.content ?? "",
    response.reasoningContent ?? "",
    ...response.toolCalls.map((call) => call.function.arguments),
  ].join("\n");
  return (
    (knownRequestTokens ?? contextManager.estimateTokens(requestMessages)) +
    Math.max(1, Math.ceil(output.length / 4))
  );
}
