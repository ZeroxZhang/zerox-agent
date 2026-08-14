import { randomUUID } from "node:crypto";
import { createContextManager, type ContextManager } from "./contextManager";
import type { CompactionStrategy } from "./kernel/compactionStrategy";
import { NEVER_COMPACT_MARKER } from "../shared/compactionMarkers";
import { isMaxModeEnabled } from "./providers/maxMode";
import type { ActorRuntime } from "./actors/actorRuntime";
import type { AgentExecutionStore } from "./agentExecutionStore";
import { classifyAgentFailure } from "./agentFailureClassifier";
import { extractLearningCandidatesFromTrajectory } from "./agentLearningExtractor";
import type { AgentLearningStore } from "./agentLearningStore";
import {
  appendProceduralMemoryContext,
  buildProceduralMemoryPromptContext,
} from "./agentProceduralMemory";
import type { AgentRunStore } from "./agentRunStore";
import type { AgentToolExecutor } from "./agentToolExecutor";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import type { AgentWorkspaceService } from "./agentWorkspaceService";
import type { MemoryStore } from "./memoryStore";
import {
  completeWithModelRetry,
  type ModelRetryOptions,
} from "./modelRetry";
import type {
  ChatClient,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ToolDefinition,
} from "./openAiCompatibleClient";
import { toCompleteRequest } from "./providers/normalize";
import type { ScheduledTaskStore } from "./taskStore";
import type { ToolAuthorizationService } from "./toolAuthorizationService";
import { createToolRuntime } from "./toolRuntime";
import {
  buildAgentSystemPrompt,
  buildTaskPrompt,
  buildToolDefinitions,
} from "../shared/agentProtocol";
import { formatDateInTimeZone, getSystemTimeZone } from "../shared/dateContext";
import {
  createToolFailureReflection,
  type AgentReflectionDecision,
} from "../shared/agentReflection";
import { serializeToolObservationWithOffload } from "./toolObservationOffload";
import type { ToolResultOffloadStore } from "./toolResultOffloadStore";
import type {
  AgentExecutionCheckpoint,
  AgentExecutionMessage,
  AgentExecutionStatus,
  AgentExecutionStep,
} from "../shared/agentExecution";
import type {
  AgentTrajectoryEvent,
  AgentTrajectoryEventType,
  AgentTrajectoryRedaction,
} from "../shared/agentTrajectory";
import type { NativeToolDescriptor } from "../shared/nativeCapabilities";
import type { AgentRunContext } from "../shared/agentWorkspace";
import type {
  AgentRunEvent,
  AgentRunRecord,
  RunScheduledTaskResult,
} from "../shared/agentRuns";
import {
  modelServiceNoticeFromError,
  type ModelServiceNotice,
} from "../shared/modelServiceNotice";
import type { ModelCapabilities } from "../shared/modelSettings";
import type { SkillRecord } from "../shared/skills";
import type {
  ProductionKernelDriver,
  ProductionKernelReporter,
} from "./kernel/productionKernelDriver";
import type { AgentToolName } from "../shared/toolPermissions";
import type { ScheduledTask } from "../shared/scheduledTasks";
import { filterToolDefinitionsForScheduledTask } from "./scheduledTaskToolVisibility";
import {
  createToolInvocation,
  transitionToolInvocation,
  type ToolInvocationRecord,
  type ToolInvocationTransition,
} from "../shared/toolInvocationLedger";
import { createRuntimeContextSnapshotForRun } from "./runtimeContextFactory";
import { summarizeAgentRuntimeContextSnapshot } from "../shared/agentRuntimeContext";
import type { ExecutionContextMemoryScope } from "../shared/executionContextPackage";
import { runAgentLoop as runSharedAgentLoop } from "./agentLoop";
import { resolveContextTokenBudget } from "../shared/contextUsage";

export type AgentRuntimeModelProfile = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  contextWindow?: number;
  modelCapabilities?: ModelCapabilities;
};

export type AgentRuntimeEngine = {
  startTask(
    taskId: string,
    options?: {
      signal?: AbortSignal;
      sessionId?: string;
      onEvent?: (event: AgentRunEvent) => void;
    },
  ): Promise<RunScheduledTaskResult>;
  resumeRun(
    runId: string,
    options?: { signal?: AbortSignal; onEvent?: (event: AgentRunEvent) => void },
  ): Promise<RunScheduledTaskResult>;
};

export function createAgentRuntimeEngine(options: {
  taskStore: Pick<ScheduledTaskStore, "get" | "recordRun">;
  runStore: AgentRunStore;
  executionStore: AgentExecutionStore;
  resolveSkill: (skillName: string) => Promise<SkillRecord | null>;
  chatClient: ChatClient;
  getModelProfile: () => Promise<AgentRuntimeModelProfile>;
  toolAuthorizationService: ToolAuthorizationService;
  toolExecutor: AgentToolExecutor;
  workspaceService?: Pick<AgentWorkspaceService, "resolveRunContext">;
  trajectoryStore?: AgentTrajectoryStore;
  learningStore?: Pick<AgentLearningStore, "create">;
  memoryStore?: Partial<Pick<MemoryStore, "create" | "search">>;
  toolResultOffloadStore?: ToolResultOffloadStore;
  toolResultOffloadThreshold?: number;
  contextManager?: ContextManager;
  /** P2: when provided, overflow compaction routes through this strategy
   *  (auto→rebuild when a checkpoint exists, else summarize = current behavior).
   *  Absent → legacy compressMessages (zero regression). */
  compactionStrategy?: CompactionStrategy;
  /** P8: when provided AND ZEROX_MAX_MODE is on, the model request step runs
   *  best-of-N candidates through this MaxMode instead of a single complete.
   *  Absent/off → single completeWithModelRetry (zero regression). */
  maxMode?: { runStep: (req: import("./providers/provider").CompleteRequest, opts: import("./providers/maxMode").MaxModeRunStepOptions) => Promise<import("./providers/maxMode").MaxModeResult> };
  /** P8: actor runtime for max-mode winner replay. */
  actorRuntimeForMaxMode?: ActorRuntime;
  modelRetry?: ModelRetryOptions;
  /** Shared production turn loop. Omitted only by legacy compatibility tests. */
  runLoop?: typeof runSharedAgentLoop;
  /** Scheduled production lifecycle driver. Omitted only for explicit rollback/tests. */
  productionKernelDriver?: ProductionKernelDriver;
  createId?: () => string;
  now?: () => Date;
}): AgentRuntimeEngine {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const contextManager = options.contextManager ?? createContextManager();
  const toolRuntime = createToolRuntime({
    authorizationService: options.toolAuthorizationService,
    toolExecutor: options.toolExecutor,
  });
  const trajectorySequences = new Map<string, number>();
  const trajectoryAppendQueues = new Map<string, Promise<void>>();

  function createEvent(
    level: AgentRunEvent["level"],
    message: string,
    data?: Record<string, unknown>,
  ): AgentRunEvent {
    return {
      level,
      message,
      ...(data ? { data } : {}),
      createdAt: now().toISOString(),
    };
  }

  function publishEvent(
    event: AgentRunEvent,
    onEvent: ((event: AgentRunEvent) => void) | undefined,
  ): AgentRunEvent {
    onEvent?.(event);
    return event;
  }

  async function saveCheckpoint(
    checkpoint: AgentExecutionCheckpoint,
    status: AgentExecutionStatus,
    updates: Partial<AgentExecutionCheckpoint> = {},
  ): Promise<AgentExecutionCheckpoint> {
    const updated: AgentExecutionCheckpoint = {
      ...checkpoint,
      ...updates,
      status,
      id: createId(),
      updatedAt: now().toISOString(),
    };
    if (checkpoint.status !== status) {
      await appendTrajectory(updated.runId, "state_transition", {
        from: checkpoint.status,
        to: status,
      }, undefined, updated.runContext);
    }
    await options.executionStore.save(updated);
    await appendTrajectory(updated.runId, "checkpoint_written", {
      checkpointId: updated.id,
      status: updated.status,
      currentStepId: updated.currentStepId,
    }, undefined, updated.runContext);
    return updated;
  }

  async function appendTrajectory(
    runId: string,
    type: AgentTrajectoryEventType,
    payload: Record<string, unknown>,
    redaction: AgentTrajectoryEvent["redaction"] | undefined = {
      containsApiKey: false,
      containsFileContent: false,
      containsUserText: false,
    },
    runContext?: AgentTrajectoryEvent["runContext"],
  ) {
    if (!options.trajectoryStore) return;

    const previous = trajectoryAppendQueues.get(runId) ?? Promise.resolve();
    const append = previous.catch(() => undefined).then(async () => {
      let sequence = trajectorySequences.get(runId);
      if (sequence === undefined) {
        const persisted = await options.trajectoryStore!.list(runId);
        sequence = Math.max(0, ...persisted.map((event) => event.sequence));
      }
      sequence += 1;
      trajectorySequences.set(runId, sequence);
      await options.trajectoryStore!.append(runId, {
        id: createId(),
        runId,
        type,
        sequence,
        ...(runContext ? { runContext } : {}),
        payload,
        redaction: redaction ?? {
          containsApiKey: false,
          containsFileContent: false,
          containsUserText: false,
        },
        createdAt: now().toISOString(),
      });
    });
    const settled = append.then(
      () => undefined,
      () => undefined,
    );
    trajectoryAppendQueues.set(runId, settled);
    try {
      await append;
    } finally {
      if (trajectoryAppendQueues.get(runId) === settled) {
        trajectoryAppendQueues.delete(runId);
      }
    }
  }

  async function finishRun(input: {
    checkpoint: AgentExecutionCheckpoint;
    taskId: string;
    taskName: string;
    skillName: string;
    status: AgentRunRecord["status"];
    summary: string;
    events: AgentRunEvent[];
    startedAt: string;
    modelServiceNotice?: ModelServiceNotice;
    failure?: unknown;
    onEvent?: (event: AgentRunEvent) => void;
  }): Promise<RunScheduledTaskResult> {
    const finishedAt = now().toISOString();
    const failureClass = input.failure
      ? classifyAgentFailure(input.failure)
      : undefined;
    const failureMessage = input.failure
      ? formatFailureMessage(input.failure)
      : undefined;
    if (failureClass) {
      await appendTrajectory(
        input.checkpoint.runId,
        "failure_classified",
        buildFailureClassifiedPayload(
          input.failure,
          failureClass,
          failureMessage,
        ),
      );
    }
    const checkpoint = await saveCheckpoint(
      input.checkpoint,
      input.status,
      failureClass || failureMessage
        ? { steps: markCurrentStepFailed(input.checkpoint.steps, failureClass, failureMessage) }
        : undefined,
    );
    const run: AgentRunRecord = {
      id: input.checkpoint.runId,
      taskId: input.taskId,
      taskName: input.taskName,
      skillName: input.skillName,
      status: input.status,
      ...(checkpoint.runContext ? { runContext: checkpoint.runContext } : {}),
      summary: input.summary,
      events: input.events,
      checkpointId: checkpoint.id,
      ...(input.modelServiceNotice
        ? { modelServiceNotice: input.modelServiceNotice }
        : {}),
      ...(failureClass ? { failureClass } : {}),
      ...(failureMessage ? { failureMessage } : {}),
      startedAt: input.startedAt,
      finishedAt,
    };

    if (run.status === "succeeded" && options.memoryStore?.create) {
      try {
        await options.memoryStore.create({
          kind: "episodic",
          title: `Run: ${input.taskName}`,
          content: run.summary,
          tags: ["agent-run", input.skillName],
          source: { type: "agent_run", refId: run.id },
          importance: 3,
        });
        run.events.push(
          publishEvent(createEvent("info", "Episodic memory written.", {
            memoryKind: "episodic",
          }), input.onEvent),
        );
      } catch (error) {
        run.events.push(
          publishEvent(createEvent("warn", "Unable to write episodic memory.", {
            error:
              error instanceof Error
                ? error.message
                : "Unknown memory error.",
          }), input.onEvent),
        );
      }
    }

    await options.runStore.append(run);
    if (input.status !== "paused") {
      await options.taskStore.recordRun(input.taskId, new Date(finishedAt));
    }
    await createLearningCandidates(run);

    return { ok: true, run };
  }

  async function createLearningCandidates(run: AgentRunRecord) {
    if (!options.learningStore || !options.trajectoryStore) {
      return;
    }

    const trajectory = await options.trajectoryStore.list(run.id);
    const candidates = extractLearningCandidatesFromTrajectory(run, trajectory);

    for (const candidate of candidates) {
      await options.learningStore.create(candidate);
    }
  }

  async function runFromCheckpointWithSharedLoop(
    checkpoint: AgentExecutionCheckpoint,
    task: ScheduledTask,
    skill: SkillRecord | null,
    signal: AbortSignal | undefined,
    events: AgentRunEvent[],
    startedAt: string,
    onEvent?: (event: AgentRunEvent) => void,
  ): Promise<RunScheduledTaskResult> {
    let current = await saveCheckpoint(checkpoint, "running", {
      steps: markCurrentStepRunning(
        checkpoint.steps,
        checkpoint.currentStepId,
        now().toISOString(),
      ),
    });
    const profile = await options.getModelProfile();
    const maxTurns = skill?.manifest.execution.maxTurns ?? 10;
    const toolDefinitions = profile.modelCapabilities?.tools === false
      ? []
      : filterToolDefinitionsForScheduledTask(
          getToolDefinitions(options.toolExecutor),
          task,
        );
    let observationTail = Promise.resolve();
    const observe = (operation: () => Promise<void>) => {
      observationTail = observationTail.then(operation, operation);
    };
    const appendObserved = (
      type: AgentTrajectoryEventType,
      payload: Record<string, unknown>,
      redaction: AgentTrajectoryRedaction = {
        containsApiKey: false,
        containsFileContent: false,
        containsUserText: false,
      },
    ) => {
      observe(() => appendTrajectory(
        current.runId,
        type,
        payload,
        redaction,
        current.runContext,
      ));
    };

    let kernelReporter: ProductionKernelReporter | undefined;
    const executeLoopSegment = () => options.runLoop!(
      [],
      profile,
      {
        chatClient: options.chatClient,
        toolExecutor: options.toolExecutor,
        toolAuthorizationService: options.toolAuthorizationService,
        taskId: task.id,
        runId: current.runId,
        ...(current.runContext ? { runContext: current.runContext } : {}),
        resumeMessages: current.messages.map(toChatMessage),
        ...(current.contextSurface
          ? { resumeContextSurface: current.contextSurface }
          : {}),
        initialToolCallsExecuted: current.toolCallCount,
        initialTokensConsumed: current.tokensConsumed ?? 0,
        initialTokensEstimated: current.tokensEstimated ?? false,
        tools: toolDefinitions,
        maxTurns,
        pauseOnTurnLimit: false,
        pauseOnFailureLoop: true,
        ...(signal ? { signal } : {}),
        ...(options.toolResultOffloadStore
          ? { toolResultOffloadStore: options.toolResultOffloadStore }
          : {}),
        ...(options.toolResultOffloadThreshold !== undefined
          ? { toolResultOffloadThreshold: options.toolResultOffloadThreshold }
          : {}),
        ...(options.compactionStrategy
          ? { compactionStrategy: options.compactionStrategy }
          : {}),
        ...(options.modelRetry ? { modelRetry: options.modelRetry } : {}),
        ...(options.maxMode && isMaxModeEnabled()
          ? {
              modelRequestExecutor: async (request: ChatCompletionRequest) => {
                try {
                  const result = await options.maxMode!.runStep(
                    toCompleteRequest(request),
                    {
                      candidates: 3,
                      judgeModel: profile.model,
                      ...(options.actorRuntimeForMaxMode
                        ? { actorRuntime: options.actorRuntimeForMaxMode }
                        : {}),
                      parentRunId: current.runId,
                      ...(signal ? { signal } : {}),
                    },
                  );
                  const winner = result.winner;
                  return {
                    content: winner.content,
                    toolCalls: winner.toolCalls,
                    finishReason: winner.finishReason,
                    ...(winner.reasoningContent
                      ? { reasoningContent: winner.reasoningContent }
                      : {}),
                    ...(winner.usage ? { usage: winner.usage } : {}),
                    ...(winner.cacheReadTokens !== undefined
                      ? { cacheReadTokens: winner.cacheReadTokens }
                      : {}),
                    ...(winner.cacheWriteTokens !== undefined
                      ? { cacheWriteTokens: winner.cacheWriteTokens }
                      : {}),
                  };
                } catch {
                  return completeWithModelRetry(
                    options.chatClient,
                    request,
                    options.modelRetry,
                    (event) => appendObserved("model_retry", event),
                  );
                }
              },
            }
          : {}),
        onTurn(turn, phase) {
          const event = createEvent(
            "info",
            phase === "executing" ? `Agent turn ${turn + 1}.` : `Agent phase: ${phase}.`,
            { turn, phase },
          );
          events.push(event);
          onEvent?.(event);
          appendObserved("model_request", {
            turn,
            phase,
          }, {
            containsApiKey: false,
            containsFileContent: false,
            containsUserText: true,
          });
        },
        onModelResponse(response, turn) {
          appendObserved("model_response", {
            turn,
            hasContent: Boolean(response.content),
            toolCallCount: response.toolCalls.length,
            finishReason: response.finishReason,
            ...(response.usage ? { usage: response.usage } : {}),
          }, {
            containsApiKey: false,
            containsFileContent: false,
            containsUserText: Boolean(response.content),
          });
        },
        onModelRetry(event) {
          const runEvent = createEvent("warn", "Retrying model request.", event);
          events.push(runEvent);
          onEvent?.(runEvent);
          appendObserved("model_retry", event);
          kernelReporter?.retry({
            attempt: event.attempt,
            maxRetries: event.maxRetries,
            afterMs: event.delayMs,
            error: event.error,
          });
        },
        onContextCompacted(event) {
          const runEvent = createEvent(
            "info",
            `上下文已压缩：${event.estimatedTokens} → ${event.compactedTokens} tokens`,
            { ...event },
          );
          events.push(runEvent);
          onEvent?.(runEvent);
          appendObserved("context_compacted", event);
        },
        onToolCall(toolName, args, event) {
          const runEvent = createEvent("info", `Calling tool: ${toolName}.`, {
            toolCallId: event.toolCallId,
            toolName,
          });
          events.push(runEvent);
          onEvent?.(runEvent);
          appendObserved("tool_call", {
            toolCallId: event.toolCallId,
            toolName,
            args,
          }, {
            containsApiKey: false,
            containsFileContent: false,
            containsUserText: true,
          });
          kernelReporter?.toolCall(toolName, args);
        },
        onToolRuntimeEvent(_toolName, runtimeEvent, event) {
          if (runtimeEvent.type !== "read_code_subcall") {
            return;
          }
          appendObserved(
            runtimeEvent.status === "started"
              ? "tool_call"
              : "tool_result",
            {
              parentToolCallId: event.toolCallId,
              codeModeCallId: runtimeEvent.callId,
              toolName: runtimeEvent.toolName,
              codeMode: "read_only_dag",
              ...(runtimeEvent.ok !== undefined
                ? { ok: runtimeEvent.ok }
                : {}),
            },
          );
        },
        onToolResult(toolName, ok, result, event) {
          const runEvent = createEvent(
            ok ? "info" : "warn",
            ok ? `Tool completed: ${toolName}.` : `Tool failed: ${toolName}.`,
            { toolCallId: event.toolCallId, toolName, ok },
          );
          events.push(runEvent);
          onEvent?.(runEvent);
          appendObserved("tool_result", {
            toolCallId: event.toolCallId,
            toolName,
            ok,
            ...(result.ok ? {} : { error: result.error }),
            ...(event.resultRef ? { resultRef: event.resultRef } : {}),
            ...(event.resultBytes !== undefined
              ? { originalChars: event.resultBytes }
              : {}),
          });
        },
        onToolInvocation(record) {
          appendObserved("tool_invocation", {
            toolInvocationId: record.id,
            toolCallId: record.toolCallId,
            toolName: record.toolName,
            toolSource: record.source,
            invocationStatus: record.status,
            args: record.args,
            ...(typeof record.ok === "boolean" ? { ok: record.ok } : {}),
            ...(record.resultRef ? { resultRef: record.resultRef } : {}),
            ...(record.error ? { error: record.error } : {}),
            history: record.history,
          });
        },
        async onCheckpoint(loopCheckpoint) {
          await observationTail;
          current = await saveCheckpoint(current, "running", {
            messages: loopCheckpoint.messages.map(toExecutionMessage),
            contextSurface: loopCheckpoint.contextSurface,
            toolCallCount: loopCheckpoint.toolCallsExecuted,
            tokensConsumed: loopCheckpoint.tokensConsumed,
            tokensEstimated: loopCheckpoint.tokensEstimated,
          });
          const event = createEvent("info", "Agent checkpoint saved.", {
            checkpointId: current.id,
            toolCallsExecuted: loopCheckpoint.toolCallsExecuted,
          });
          events.push(event);
          onEvent?.(event);
          kernelReporter?.checkpoint(
            `agent-executions/${current.runId}/${current.id}`,
            loopCheckpoint.turns,
          );
        },
      },
    );
    const persistLoopResult = async (
      loopResult: Awaited<ReturnType<typeof executeLoopSegment>>,
    ): Promise<RunScheduledTaskResult> => {
      await observationTail;
      current = await saveCheckpoint(
        current,
        loopResult.status === "paused" ? "paused" : "running",
        {
          messages: loopResult.messages.map(toExecutionMessage),
          ...(loopResult.contextSurface
            ? { contextSurface: loopResult.contextSurface }
            : {}),
          toolCallCount: loopResult.toolCallsExecuted,
          tokensConsumed: loopResult.tokensConsumed ?? 0,
          tokensEstimated: loopResult.tokensEstimated ?? true,
          ...(loopResult.status === "succeeded"
            ? {
                steps: markCurrentStepCompleted(
                  current.steps,
                  current.currentStepId,
                  now().toISOString(),
                ),
              }
            : {}),
        },
      );
      if (loopResult.status === "succeeded") {
        await appendTrajectory(current.runId, "final_summary", {
          status: "succeeded",
          summaryLength: loopResult.summary.length,
          tokensConsumed: loopResult.tokensConsumed ?? 0,
        }, {
          containsApiKey: false,
          containsFileContent: false,
          containsUserText: true,
        }, current.runContext);
      }

      const status = loopResult.status;
      const terminalEvent = createEvent(
        status === "succeeded" ? "info" : status === "paused" ? "warn" : "error",
        `Shared agent loop ${status}.`,
        { tokensConsumed: loopResult.tokensConsumed ?? 0 },
      );
      events.push(terminalEvent);
      onEvent?.(terminalEvent);
      return finishRun({
        checkpoint: current,
        taskId: task.id,
        taskName: task.name,
        skillName: getRunSkillName(task),
        status,
        summary: loopResult.summary,
        events,
        startedAt,
        ...(onEvent ? { onEvent } : {}),
        ...(loopResult.modelServiceNotice
          ? { modelServiceNotice: loopResult.modelServiceNotice }
          : {}),
        ...(status === "failed" || status === "canceled"
          ? { failure: new Error(loopResult.summary) }
          : {}),
      });
    };
    type LoopSegmentResult = Awaited<
      ReturnType<typeof executeLoopSegment>
    >;
    const createSettledLoopResult = (
      status: LoopSegmentResult["status"],
      summary: string,
      modelServiceNotice?: ModelServiceNotice,
    ): LoopSegmentResult => ({
      status,
      summary,
      turns: 0,
      messages: current.messages.map(toChatMessage),
      ...(current.contextSurface
        ? { contextSurface: current.contextSurface }
        : {}),
      toolCallsExecuted: current.toolCallCount,
      tokensConsumed: current.tokensConsumed ?? 0,
      tokensEstimated: current.tokensEstimated ?? false,
      ...(modelServiceNotice ? { modelServiceNotice } : {}),
    });
    const normalizeAbortedLoopResult = (
      loopResult: LoopSegmentResult,
    ): LoopSegmentResult => {
      if (!signal?.aborted) return loopResult;
      const paused = isPauseSignal(signal);
      return {
        ...loopResult,
        status: paused ? "paused" : "canceled",
        summary: paused ? "运行已暂停。" : "运行已取消。",
      };
    };
    const persistSegment = async (
      loopResult: LoopSegmentResult,
    ) => {
      const settled = normalizeAbortedLoopResult(loopResult);
      const result = await persistLoopResult(settled);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return {
        status: settled.status,
        summary: settled.summary,
        result,
      };
    };
    const executePersistedSegment = async (
      reporter?: ProductionKernelReporter,
    ) => {
      kernelReporter = reporter;
      let loopResult: LoopSegmentResult;
      try {
        loopResult = await executeLoopSegment();
      } catch (error) {
        const modelServiceNotice = modelServiceNoticeFromError(error);
        loopResult = createSettledLoopResult(
          isPauseError(error, signal)
            ? "paused"
            : isCancellationError(error, signal)
              ? "canceled"
              : modelServiceNotice
                ? "paused"
                : "failed",
          modelServiceNotice?.message ?? formatFailureMessage(error),
          modelServiceNotice,
        );
      }
      return persistSegment(loopResult);
    };

    if (!options.productionKernelDriver) {
      return (await executePersistedSegment()).result;
    }
    return (
      await options.productionKernelDriver.run({
        runId: current.runId,
        mode: "scheduled_task",
        ...(signal ? { signal } : {}),
        checkpointEvery: maxTurns,
        execute: executePersistedSegment,
        settleAborted(status) {
          return persistSegment(
            createSettledLoopResult(
              status,
              status === "paused"
                ? "运行已暂停。"
                : "运行已取消。",
            ),
          );
        },
      })
    ).segment.result;
  }

  async function runFromCheckpoint(
    checkpoint: AgentExecutionCheckpoint,
    task: ScheduledTask,
    skill: SkillRecord | null,
    signal: AbortSignal | undefined,
    events: AgentRunEvent[],
    startedAt: string,
    onEvent?: (event: AgentRunEvent) => void,
  ): Promise<RunScheduledTaskResult> {
    if (options.runLoop) {
      return runFromCheckpointWithSharedLoop(
        checkpoint,
        task,
        skill,
        signal,
        events,
        startedAt,
        onEvent,
      );
    }
    let current = await saveCheckpoint(checkpoint, "running", {
      steps: markCurrentStepRunning(
        checkpoint.steps,
        checkpoint.currentStepId,
        now().toISOString(),
      ),
    });
    let messages: ChatMessage[] = current.messages.map(toChatMessage);
    let toolCallCount = current.toolCallCount;
    const reflectionDecisions: AgentReflectionDecision[] = [];
    const profile = await options.getModelProfile();
    const maxTurns = skill?.manifest.execution.maxTurns ?? 10;
    const toolDefinitions = profile.modelCapabilities?.tools === false
      ? []
      : filterToolDefinitionsForScheduledTask(
          getToolDefinitions(options.toolExecutor),
          task,
        );
    const contextTokenBudget = resolveContextTokenBudget({
      contextWindow: profile.contextWindow,
      maxOutputTokens: profile.maxTokens,
    });

    function publishContextCompaction(
      estimatedTokens: number,
      compactedTokens: number,
    ) {
      const event = createEvent(
        "info",
        `上下文已压缩：${estimatedTokens} → ${compactedTokens} tokens`,
        { estimatedTokens, compactedTokens, tokenBudget: contextTokenBudget },
      );
      events.push(event);
      onEvent?.(event);
    }

    async function compactMessagesBeforeModelRequest() {
      const estimatedTokens = contextManager.estimateTokens(messages);
      if (estimatedTokens <= contextTokenBudget) {
        return;
      }

      // P2: route through the compaction strategy when provided. Default flag
      // `auto` degrades to summarize (= compressMessages) when no checkpoint
      // exists, so this is byte-equivalent to the legacy path unless a markdown
      // checkpoint is present (rebuild). Absent strategy → legacy path.
      if (options.compactionStrategy) {
        const originalMessageCount = messages.length;
        const result = await options.compactionStrategy.compact({
          messages,
          budget: contextTokenBudget,
          runId: current.runId,
          protectedMarkers: [NEVER_COMPACT_MARKER],
        });
        if (!result.compacted) {
          return;
        }
        messages = result.messages;
        const compactedTokens = contextManager.estimateTokens(messages);
        publishContextCompaction(estimatedTokens, compactedTokens);
        if (result.strategy === "rebuild" || result.strategy === "summarize-degraded") {
          await appendTrajectory(current.runId, "context_rebuilt", {
            strategy: result.strategy,
            ...(result.checkpointRef ? { checkpointRef: result.checkpointRef } : {}),
            beforeTokens: result.beforeTokens,
            afterTokens: result.afterTokens,
            memoryHits: result.memoryHits ?? [],
            microcompactedRefs: result.microcompactedRefs ?? [],
            ...(result.degradedReason ? { degradedReason: result.degradedReason } : {}),
            createdAt: now().toISOString(),
          }, {
            containsApiKey: false,
            containsFileContent: false,
            containsUserText: false,
          }, current.runContext);
        } else {
          await appendTrajectory(current.runId, "context_compacted", {
            originalMessageCount,
            compactedMessageCount: messages.length,
            estimatedTokens,
            compactedTokens,
            tokenBudget: contextTokenBudget,
            strategy: result.strategy,
          }, {
            containsApiKey: false,
            containsFileContent: false,
            containsUserText: false,
          }, current.runContext);
        }
        return;
      }

      const originalMessageCount = messages.length;
      const compacted = contextManager.compressMessages(
        messages,
        contextTokenBudget,
      );
      if (compacted.length === originalMessageCount && compacted === messages) {
        return;
      }

      messages = compacted;
      const compactedTokens = contextManager.estimateTokens(messages);
      publishContextCompaction(estimatedTokens, compactedTokens);
      await appendTrajectory(current.runId, "context_compacted", {
        originalMessageCount,
        compactedMessageCount: messages.length,
        estimatedTokens,
        compactedTokens,
        tokenBudget: contextTokenBudget,
        strategy: "summarize",
      }, {
        containsApiKey: false,
        containsFileContent: false,
        containsUserText: false,
      }, current.runContext);
    }

    for (let turn = 0; Number.isFinite(turn); turn += 1) {
      throwIfCanceled(signal);
      await compactMessagesBeforeModelRequest();
      await appendTrajectory(current.runId, "model_request", {
        turn,
        messageCount: messages.length,
      }, {
        containsApiKey: false,
        containsFileContent: false,
        containsUserText: true,
      }, current.runContext);
      const response = await runModelRequest();
      async function runModelRequest(): Promise<ChatCompletionResponse> {
        // P8: max-mode (best-of-N) when enabled + deps present. Default off.
        if (options.maxMode && isMaxModeEnabled()) {
          try {
            const result = await options.maxMode.runStep(
              toCompleteRequest({
                ...profile,
                messages,
                tools: toolDefinitions,
                tool_choice: "auto",
                ...(signal ? { signal } : {}),
              } as ChatCompletionRequest),
              {
                candidates: 3,
                judgeModel: profile.model,
                ...(options.actorRuntimeForMaxMode ? { actorRuntime: options.actorRuntimeForMaxMode } : {}),
                parentRunId: current.runId,
                ...(signal ? { signal } : {}),
              },
            );
            const w = result.winner;
            return {
              content: w.content,
              toolCalls: w.toolCalls,
              finishReason: w.finishReason,
              ...(w.reasoningContent ? { reasoningContent: w.reasoningContent } : {}),
              ...(w.usage ? { usage: w.usage } : {}),
              ...(w.cacheReadTokens ? { cacheReadTokens: w.cacheReadTokens } : {}),
              ...(w.cacheWriteTokens ? { cacheWriteTokens: w.cacheWriteTokens } : {}),
            };
          } catch {
            // fall through to the standard single-complete path on any max-mode failure
          }
        }
        return completeWithModelRetry(
          options.chatClient,
          {
            ...profile,
            messages,
            tools: toolDefinitions,
            tool_choice: "auto",
            ...(signal ? { signal } : {}),
          },
          options.modelRetry,
          async (event) => {
            await appendTrajectory(current.runId, "model_retry", event, {
              containsApiKey: false,
              containsFileContent: false,
              containsUserText: false,
            }, current.runContext);
          },
        );
      }
      await appendTrajectory(current.runId, "model_response", {
        turn,
        hasContent: Boolean(response.content),
        toolCallCount: response.toolCalls.length,
        finishReason: response.finishReason,
        // P8: usage for runGraph cost aggregation (Patch 11 model_response node).
        ...(response.usage ? { usage: response.usage } : {}),
        ...(response.cacheReadTokens !== undefined ? { cacheReadTokens: response.cacheReadTokens } : {}),
        ...(response.cacheWriteTokens !== undefined ? { cacheWriteTokens: response.cacheWriteTokens } : {}),
      }, {
        containsApiKey: false,
        containsFileContent: false,
        containsUserText: Boolean(response.content),
      }, current.runContext);

      if (!response.toolCalls.length && response.content) {
        current = {
          ...current,
          messages: messages.map(toExecutionMessage),
          toolCallCount,
          steps: markCurrentStepCompleted(
            current.steps,
            current.currentStepId,
            now().toISOString(),
          ),
        };
        await appendTrajectory(current.runId, "final_summary", {
          status: "succeeded",
          summaryLength: response.content.length,
        }, {
          containsApiKey: false,
          containsFileContent: false,
          containsUserText: true,
        }, current.runContext);
        return finishRun({
          checkpoint: current,
          taskId: task.id,
          taskName: task.name,
          skillName: getRunSkillName(task),
          status: "succeeded",
          summary: response.content,
          events,
          startedAt,
          ...(onEvent ? { onEvent } : {}),
        });
      }

      if (!response.toolCalls.length) {
        throw new Error("模型未返回有效内容或工具调用。");
      }

      messages.push({
        role: "assistant",
        content: response.content ?? "",
        tool_calls: response.toolCalls,
      });

      let wroteToolCheckpoint = false;
      for (const toolCall of response.toolCalls) {
        const toolName = toolCall.function.name as AgentToolName;
        const args = parseToolArguments(toolCall.function.arguments);
        await appendTrajectory(current.runId, "tool_call", {
          toolCallId: toolCall.id,
          toolName,
          args,
        }, {
          containsApiKey: false,
          containsFileContent: false,
          containsUserText: true,
        }, current.runContext);
        const toolSource = getToolSource(options.toolExecutor, toolName);
        let toolInvocation = createToolInvocation({
          id: `tool_invocation_${toolCall.id}`,
          runId: current.runId,
          toolCallId: toolCall.id,
          toolName,
          source: toolSource ?? "built-in",
          args,
          createdAt: now().toISOString(),
        });
        const appendToolInvocation = async (record: ToolInvocationRecord) => {
          await appendTrajectory(current.runId, "tool_invocation", {
            toolInvocationId: record.id,
            toolCallId: record.toolCallId,
            toolName: record.toolName,
            toolSource: record.source,
            invocationStatus: record.status,
            args: record.args,
            ...(typeof record.ok === "boolean" ? { ok: record.ok } : {}),
            ...(record.resultRef ? { resultRef: record.resultRef } : {}),
            ...(record.error ? { error: record.error } : {}),
            history: record.history,
          }, {
            containsApiKey: false,
            containsFileContent: false,
            containsUserText: true,
          }, current.runContext);
        };
        const transitionInvocation = async (
          transition: Omit<ToolInvocationTransition, "at"> & { at?: string },
        ) => {
          toolInvocation = transitionToolInvocation(toolInvocation, {
            ...transition,
            at: transition.at ?? now().toISOString(),
          });
          await appendToolInvocation(toolInvocation);
        };
        await appendToolInvocation(toolInvocation);
        await transitionInvocation({ status: "visible" });
        const nativeDescriptor = getNativeToolDescriptor(
          options.toolExecutor,
          toolName,
        );
        const runtimeOutcome = await toolRuntime.execute({
          taskId: task.id,
          request: {
            toolName,
            ...(toolSource ? { source: toolSource } : {}),
            args,
          },
          authorizationOptions: {
            onApprovalRequested: async () => {
              await transitionInvocation({ status: "waiting_approval" });
              current = await saveCheckpoint(current, "waiting_for_approval");
            },
            onApprovalResolved: async (approval) => {
              if (!approval.approved) return;
              throwIfCanceled(signal);
              await transitionInvocation({ status: "authorized" });
              throwIfCanceled(signal);
              current = await saveCheckpoint(current, "running");
            },
          },
          executionOptions: {
            runContext: current.runContext,
            ...(signal ? { signal } : {}),
            toolResultReadScope: {
              runId: current.runId,
              ...(current.runContext?.sessionId
                ? { sessionId: current.runContext.sessionId }
                : {}),
              ...(current.runContext?.runId
                ? { workspaceRunId: current.runContext.runId }
                : {}),
            },
          },
          async onStage(event) {
            if (
              event.stage === "authorized" &&
              toolInvocation.status !== "authorized"
            ) {
              await transitionInvocation({
                status: "authorized",
                reason: event.reason,
              });
            }
            if (event.stage === "dispatching") {
              if (nativeDescriptor) {
                await appendTrajectory(
                  current.runId,
                  "native_tool_invocation",
                  {
                    toolCallId: toolCall.id,
                    ...buildNativeToolEvidencePayload(nativeDescriptor),
                  },
                  {
                    containsApiKey: false,
                    containsFileContent: false,
                    containsUserText: false,
                  },
                  current.runContext,
                );
              }
              await transitionInvocation({ status: "running" });
            }
          },
        });
        const result = runtimeOutcome.result;
        if (!runtimeOutcome.dispatched) {
          const reason = result.ok ? "工具调用未执行。" : result.error;
          await transitionInvocation({
            status: "error",
            error: reason,
          });
          if (/运行沙箱阻止|workspace|workspace_only/i.test(reason)) {
            await appendTrajectory(current.runId, "workspace_escape_denied", {
              toolCallId: toolCall.id,
              toolName,
              reason,
              ...(typeof args.path === "string" ? { path: args.path } : {}),
              ...(typeof args.command === "string"
                ? { command: args.command }
                : {}),
            }, {
              containsApiKey: false,
              containsFileContent: false,
              containsUserText: false,
            }, current.runContext);
          }
          throw new Error(`工具调用被拒绝：${reason}`);
        }
        toolCallCount += 1;
        if (nativeDescriptor) {
          await appendTrajectory(current.runId, "native_tool_observation", {
            toolCallId: toolCall.id,
            ...buildNativeToolEvidencePayload(nativeDescriptor),
            ok: result.ok,
            ...(result.ok
              ? { resultKeys: Object.keys(result.result).slice(0, 10) }
              : { error: result.error }),
          }, {
            containsApiKey: false,
            containsFileContent: false,
            containsUserText: false,
          }, current.runContext);
        }
        const serializedObservation =
          await serializeToolObservationWithOffload({
            tool: toolName,
            ok: result.ok,
            ...(result.ok
              ? { result: result.result }
              : { error: result.error }),
            toolCallId: toolCall.id,
          }, {
            store: options.toolResultOffloadStore,
            thresholdChars: options.toolResultOffloadThreshold,
            runId: current.runId,
            sessionId: current.runContext?.sessionId,
            workspaceRunId: current.runContext?.runId,
          });
        await transitionInvocation(
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
        await appendTrajectory(current.runId, "tool_result", {
          toolCallId: toolCall.id,
          toolName,
          ok: result.ok,
          ...(serializedObservation.offloaded
            ? {
                offloaded: true,
                resultRef: serializedObservation.resultRef,
                originalChars: serializedObservation.originalChars,
              }
            : {}),
        }, {
          containsApiKey: false,
          containsFileContent: result.ok && !serializedObservation.offloaded,
          containsUserText: false,
        }, current.runContext);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: serializedObservation.content,
        });
        current = await saveCheckpoint(current, "running", {
          messages: messages.map(toExecutionMessage),
          toolCallCount,
        });
        wroteToolCheckpoint = true;

        if (!result.ok) {
          const reflection = createToolFailureReflection({
            toolName,
            args,
            error: result.error,
            errorDetails: result.errorDetails,
            previousReflections: reflectionDecisions,
          });
          reflectionDecisions.push(reflection);
          await appendTrajectory(current.runId, "reflection_added", {
            toolCallId: toolCall.id,
            toolName,
            ...reflection,
          }, {
            containsApiKey: false,
            containsFileContent: false,
            containsUserText: false,
          }, current.runContext);
          if (reflection.retryAllowed && reflection.suggestion === "retry") {
            continue;
          }
          throw new ToolReflectionFailureError(toolName, result.error, reflection);
        }
      }

      if (!wroteToolCheckpoint) {
        current = await saveCheckpoint(current, "running", {
          messages: messages.map(toExecutionMessage),
          toolCallCount,
        });
      }
    }

    throw new Error("Agent run ended without a terminal model response.");
  }

  return {
    async startTask(taskId, runOptions) {
      const task = await options.taskStore.get(taskId);
      if (!task) {
        return { ok: false, message: "Scheduled task was not found." };
      }

      const taskSkillName = task.skillName.trim();
      const skill = taskSkillName ? await options.resolveSkill(taskSkillName) : null;
      if (taskSkillName && !skill) {
        return { ok: false, message: "Task skill was not found." };
      }

      const startedAt = now().toISOString();
      const runId = createId();
      const startedEvent = createEvent("info", "Agent runtime started.");
      const events = [publishEvent(startedEvent, runOptions?.onEvent)];
      const runContext = await options.workspaceService?.resolveRunContext(
        runOptions?.sessionId ? { sessionId: runOptions.sessionId } : undefined,
      );
      const initialProfile = await options.getModelProfile();
      const initialToolDefinitions = initialProfile.modelCapabilities?.tools === false
        ? []
        : filterToolDefinitionsForScheduledTask(
            getToolDefinitions(options.toolExecutor),
            task,
          );
      const systemTimeZone = getSystemTimeZone();
      const proceduralMemoryContext =
        await buildProceduralMemoryPromptContext({
          memoryStore: options.memoryStore,
          taskName: task.name,
          skillName: taskSkillName || "prompt-task",
          skillDescription: skill?.manifest.description,
        });
      const step: AgentExecutionStep = {
        id: createId(),
        description: task.name,
        expectedOutcome: "Task completes with a final summary.",
        state: "pending",
        attempts: 0,
      };
      let checkpoint: AgentExecutionCheckpoint = {
        id: createId(),
        runId,
        taskId: task.id,
        status: "queued",
        ...(runContext ? { runContext } : {}),
        currentStepId: step.id,
        steps: [step],
        messages: [
          {
            role: "system",
            content: buildAgentSystemPrompt({
              modelId: initialProfile.model,
              currentDate: formatDateInTimeZone(new Date(startedAt), systemTimeZone),
              timeZone: systemTimeZone,
            }),
          },
          {
            role: "user",
            content: appendProceduralMemoryContext(
              buildTaskPrompt(task, skill),
              proceduralMemoryContext,
            ),
          },
        ],
        toolCallCount: 0,
        createdAt: startedAt,
        updatedAt: startedAt,
      };

      await options.executionStore.save(checkpoint);
      if (runContext) {
        const runtimeContextSnapshot = createRuntimeContextSnapshotForRun({
          surface: "scheduled_task",
          runId,
          runContext,
          modelProfile: initialProfile,
          tools: initialToolDefinitions,
          getToolSource: (toolName) =>
            getToolSource(options.toolExecutor, toolName),
          ...(skill ? { selectedSkill: skill } : {}),
          permission: {
            taskId: task.id,
            runtimeTaskId: `scheduled:${task.id}`,
            approvalMode: "scheduled",
          },
          memory: {
            scopes: buildScheduledRuntimeMemoryScopes({
              task,
              runContext,
              skill,
            }),
            recallBudgetTokens: 0,
            rawHistoryEnabled: false,
          },
          checkpoint: {
            strategy: "boundary",
            preserveToolPairs: true,
            protectSkillLoads: true,
            checkpointId: checkpoint.id,
          },
          trajectory: {
            ...(runContext.sessionId ? { sessionId: runContext.sessionId } : {}),
          },
          createId: () => `runtime_snapshot_${runId}`,
          now: () => startedAt,
          systemTimeZone,
        });
        await appendTrajectory(runId, "run_context_created", {
          workspaceId: runContext.workspaceId,
          workspaceRoot: runContext.workspaceRoot,
          agentRole: runContext.agentRole,
          depth: runContext.depth,
          ...(runContext.parentRunId ? { parentRunId: runContext.parentRunId } : {}),
          ...(runContext.sessionId ? { sessionId: runContext.sessionId } : {}),
          runtimeContextSnapshot,
          runtimeContextSnapshotSummary:
            summarizeAgentRuntimeContextSnapshot(runtimeContextSnapshot),
        }, undefined, runContext);
      }
      await appendTrajectory(runId, "state_transition", {
        from: null,
        to: "queued",
      }, undefined, runContext);
      await appendTrajectory(runId, "checkpoint_written", {
        checkpointId: checkpoint.id,
        status: checkpoint.status,
        currentStepId: checkpoint.currentStepId,
      }, undefined, runContext);

      try {
        return await runFromCheckpoint(
          checkpoint,
          task,
          skill,
          runOptions?.signal,
          events,
          startedAt,
          runOptions?.onEvent,
        );
      } catch (error) {
        if (isPauseError(error, runOptions?.signal)) {
          const latestCheckpoint =
            (await options.executionStore.get(runId)) ?? checkpoint;
          return finishRun({
            checkpoint: latestCheckpoint,
            taskId: task.id,
            taskName: task.name,
            skillName: getRunSkillName(task),
            status: "paused",
            summary: "运行已暂停。",
            events: [...events, createEvent("warn", "Agent run paused.")],
            startedAt,
            ...(runOptions?.onEvent ? { onEvent: runOptions.onEvent } : {}),
          });
        }

        if (isCancellationError(error, runOptions?.signal)) {
          const latestCheckpoint =
            (await options.executionStore.get(runId)) ?? checkpoint;
          return finishRun({
            checkpoint: latestCheckpoint,
            taskId: task.id,
            taskName: task.name,
            skillName: getRunSkillName(task),
            status: "canceled",
            summary: "运行已取消。",
            events: [...events, createEvent("warn", "Agent run canceled.")],
            startedAt,
            failure: error,
            ...(runOptions?.onEvent ? { onEvent: runOptions.onEvent } : {}),
          });
        }

        const latestCheckpoint =
          (await options.executionStore.get(runId)) ?? checkpoint;
        const modelServiceNotice = modelServiceNoticeFromError(error);
        if (modelServiceNotice) {
          return finishRun({
            checkpoint: latestCheckpoint,
            taskId: task.id,
            taskName: task.name,
            skillName: getRunSkillName(task),
            status: "paused",
            summary: modelServiceNotice.message,
            events: [
              ...events,
              createEvent("warn", modelServiceNotice.message),
            ],
            startedAt,
            modelServiceNotice,
            ...(runOptions?.onEvent ? { onEvent: runOptions.onEvent } : {}),
          });
        }
        return finishRun({
          checkpoint: latestCheckpoint,
          taskId: task.id,
          taskName: task.name,
          skillName: getRunSkillName(task),
          status: "failed",
          summary: error instanceof Error ? error.message : "Agent run failed.",
          events: [...events, createEvent("error", formatFailureMessage(error))],
          startedAt,
          failure: error,
          ...(runOptions?.onEvent ? { onEvent: runOptions.onEvent } : {}),
        });
      }
    },

    async resumeRun(runId, runOptions) {
      const checkpoint = await options.executionStore.get(runId);
      if (!checkpoint) {
        return { ok: false, message: "Agent execution checkpoint was not found." };
      }

      const task = await options.taskStore.get(checkpoint.taskId);
      if (!task) {
        return { ok: false, message: "Scheduled task was not found." };
      }

      const taskSkillName = task.skillName.trim();
      const skill = taskSkillName ? await options.resolveSkill(taskSkillName) : null;
      if (taskSkillName && !skill) {
        return { ok: false, message: "Task skill was not found." };
      }

      try {
        return await runFromCheckpoint(
          checkpoint,
          task,
          skill,
          runOptions?.signal,
          [publishEvent(createEvent("info", "Agent runtime resumed."), runOptions?.onEvent)],
          checkpoint.createdAt,
          runOptions?.onEvent,
        );
      } catch (error) {
        if (isPauseError(error, runOptions?.signal)) {
          const latestCheckpoint =
            (await options.executionStore.get(runId)) ?? checkpoint;
          return finishRun({
            checkpoint: latestCheckpoint,
            taskId: task.id,
            taskName: task.name,
            skillName: getRunSkillName(task),
            status: "paused",
            summary: "运行已暂停。",
            events: [createEvent("warn", "Agent run paused.")],
            startedAt: checkpoint.createdAt,
            ...(runOptions?.onEvent ? { onEvent: runOptions.onEvent } : {}),
          });
        }

        const latestCheckpoint =
          (await options.executionStore.get(runId)) ?? checkpoint;
        const modelServiceNotice = modelServiceNoticeFromError(error);
        if (modelServiceNotice) {
          return finishRun({
            checkpoint: latestCheckpoint,
            taskId: task.id,
            taskName: task.name,
            skillName: getRunSkillName(task),
            status: "paused",
            summary: modelServiceNotice.message,
            events: [createEvent("warn", modelServiceNotice.message)],
            startedAt: checkpoint.createdAt,
            modelServiceNotice,
            ...(runOptions?.onEvent ? { onEvent: runOptions.onEvent } : {}),
          });
        }
        return finishRun({
          checkpoint: latestCheckpoint,
          taskId: task.id,
          taskName: task.name,
          skillName: getRunSkillName(task),
          status: isCancellationError(error, runOptions?.signal)
            ? "canceled"
            : "failed",
          summary: isCancellationError(error, runOptions?.signal)
            ? "运行已取消。"
            : formatFailureMessage(error),
          events: [createEvent("error", formatFailureMessage(error))],
          startedAt: checkpoint.createdAt,
          failure: error,
          ...(runOptions?.onEvent ? { onEvent: runOptions.onEvent } : {}),
        });
      }
    },
  };
}

function getToolDefinitions(toolExecutor: AgentToolExecutor): ToolDefinition[] {
  if ("getRegistry" in toolExecutor) {
    return toolExecutor.getRegistry().getDefinitions();
  }

  return buildToolDefinitions();
}

function getNativeToolDescriptor(
  toolExecutor: AgentToolExecutor,
  toolName: string,
): NativeToolDescriptor | null {
  const maybeExecutor = toolExecutor as Partial<Pick<AgentToolExecutor, "getRegistry">>;
  if (typeof maybeExecutor.getRegistry !== "function") {
    return null;
  }

  return maybeExecutor.getRegistry().getNativeDescriptor(toolName);
}

function getToolSource(
  toolExecutor: AgentToolExecutor,
  toolName: string,
): string | null {
  const maybeExecutor = toolExecutor as Partial<Pick<AgentToolExecutor, "getRegistry">>;
  if (typeof maybeExecutor.getRegistry !== "function") {
    return null;
  }

  return maybeExecutor.getRegistry().getSource(toolName);
}

function buildNativeToolEvidencePayload(
  descriptor: NativeToolDescriptor,
): Record<string, unknown> {
  return {
    toolName: descriptor.id,
    nativeKind: descriptor.kind,
    riskLevel: descriptor.riskLevel,
    permissionScope: descriptor.permissionScope,
    source: "registry",
    label: descriptor.label,
  };
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // handled below
  }

  throw new Error("参数 JSON 解析失败");
}

function throwIfCanceled(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new Error(isPauseSignal(signal) ? "Agent run paused." : "Agent run canceled.");
  }
}

function isPauseSignal(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true && (signal as AbortSignal & { reason?: unknown }).reason === "pause";
}

function isPauseError(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  return (
    isPauseSignal(signal) ||
    (error instanceof Error && /paused/i.test(error.message))
  );
}

function isCancellationError(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  return (
    signal?.aborted ||
    (error instanceof Error && /cancell?ed|abort/i.test(error.message))
  );
}

function formatFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "Agent run failed.");
}

class ToolReflectionFailureError extends Error {
  constructor(
    readonly toolName: AgentToolName,
    toolError: string,
    readonly reflection: AgentReflectionDecision,
  ) {
    super(
      `工具 ${toolName} 执行失败且恢复已停止（${reflection.failureClass}）：${toolError}`,
    );
    this.name = "ToolReflectionFailureError";
  }
}

function buildFailureClassifiedPayload(
  failure: unknown,
  failureClass: ReturnType<typeof classifyAgentFailure>,
  failureMessage: string | undefined,
): Record<string, unknown> {
  return {
    failureClass,
    ...(failureMessage ? { failureMessage } : {}),
    ...(failure instanceof ToolReflectionFailureError
      ? {
          toolName: failure.toolName,
          reflectionFailureClass: failure.reflection.failureClass,
          retryAllowed: failure.reflection.retryAllowed,
          suggestion: failure.reflection.suggestion,
        }
      : {}),
  };
}

function toExecutionMessage(message: ChatMessage): AgentExecutionMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    ...(message.name ? { name: message.name } : {}),
    ...(message.images
      ? { images: message.images.map((image) => ({ ...image })) }
      : {}),
  };
}

function toChatMessage(message: AgentExecutionMessage): ChatMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.tool_calls ? { tool_calls: message.tool_calls as ChatMessage["tool_calls"] } : {}),
    ...(message.name ? { name: message.name } : {}),
    ...(message.images
      ? { images: message.images.map((image) => ({ ...image })) }
      : {}),
  };
}

function getRunSkillName(task: { skillName: string }): string {
  return task.skillName.trim() || "prompt-task";
}

function buildScheduledRuntimeMemoryScopes(input: {
  task: ScheduledTask;
  runContext: AgentRunContext;
  skill: SkillRecord | null;
}): ExecutionContextMemoryScope[] {
  return [
    { kind: "project", id: input.task.id },
    ...(input.runContext.workspaceId
      ? [{ kind: "workspace" as const, id: input.runContext.workspaceId }]
      : []),
    ...(input.runContext.sessionId
      ? [{ kind: "session" as const, id: input.runContext.sessionId }]
      : []),
    ...(input.skill?.manifest.name
      ? [{ kind: "skill" as const, id: input.skill.manifest.name }]
      : []),
  ];
}

function markCurrentStepRunning(
  steps: AgentExecutionStep[],
  currentStepId: string | undefined,
  startedAt: string,
): AgentExecutionStep[] {
  return steps.map((step) =>
    step.id === currentStepId
      ? {
          ...step,
          state: step.state === "pending" ? "running" : step.state,
          attempts: step.attempts === 0 ? 1 : step.attempts,
          startedAt: step.startedAt ?? startedAt,
        }
      : step,
  );
}

function markCurrentStepCompleted(
  steps: AgentExecutionStep[],
  currentStepId: string | undefined,
  finishedAt: string,
): AgentExecutionStep[] {
  return steps.map((step) =>
    step.id === currentStepId
      ? {
          ...step,
          state: "completed",
          finishedAt,
        }
      : step,
  );
}

function markCurrentStepFailed(
  steps: AgentExecutionStep[],
  failureClass: ReturnType<typeof classifyAgentFailure> | undefined,
  failureMessage: string | undefined,
): AgentExecutionStep[] {
  return steps.map((step) =>
    step.state === "completed"
      ? step
      : {
          ...step,
          state: failureClass ? "failed" : step.state,
          ...(failureClass ? { failureClass } : {}),
          ...(failureMessage ? { failureMessage } : {}),
        },
  );
}
