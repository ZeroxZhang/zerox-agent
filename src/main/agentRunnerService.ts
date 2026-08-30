import { randomUUID } from "node:crypto";
import type { AgentExecutionStore } from "./agentExecutionStore";
import type { AgentLearningStore } from "./agentLearningStore";
import type { AgentRunStore } from "./agentRunStore";
import type { AgentToolExecutor } from "./agentToolExecutor";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import type { AgentWorkspaceService } from "./agentWorkspaceService";
import { createAgentRuntimeEngine } from "./agentRuntimeEngine";
import type { runAgentLoop as runSharedAgentLoop } from "./agentLoop";
import { createContextManager, type ContextManager } from "./contextManager";
import type { CompactionStrategy } from "./kernel/compactionStrategy";
import type { MemoryStore } from "./memoryStore";
import {
  appendProceduralMemoryContext,
  buildProceduralMemoryPromptContext,
} from "./agentProceduralMemory";
import type {
  ChatClient,
  ChatMessage,
  StreamingChatClient,
  ToolCall,
  ToolDefinition,
} from "./openAiCompatibleClient";
import type { ScheduledTaskStore } from "./taskStore";
import type { ToolAuthorizationService } from "./toolAuthorizationService";
import { createToolRuntime } from "./toolRuntime";
import {
  buildAgentSystemPrompt,
  buildPlanningPrompt,
  buildReflectionPrompt,
  buildTaskPrompt,
  buildToolDefinitions,
  parsePlanFromResponse,
  parseReflectionFromResponse,
} from "../shared/agentProtocol";
import { formatDateInTimeZone, getSystemTimeZone } from "../shared/dateContext";
import { serializeToolObservationWithOffload } from "./toolObservationOffload";
import type { ToolResultOffloadStore } from "./toolResultOffloadStore";
import {
  assertAgentRunAdmissionLease,
  commitAdmittedAgentRun,
  projectSecretSafeAgentRun,
  publishAgentRunObserverEvent,
  type AgentRunExecutionAdmittedHandler,
  type AgentPhase,
  type AgentRunEvent,
  type AgentRunAdmissionGate,
  type AgentRunRecord,
  type RunScheduledTaskResult,
} from "../shared/agentRuns";
import {
  createSecretSafeFailure,
  toSecretSafeFailure,
  type SecretSafeFailure,
} from "../shared/secretSafeFailure";
import type { SkillRecord } from "../shared/skills";
import type {
  ModelCapabilities,
  ModelContextWindowSource,
} from "../shared/modelSettings";
import { filterToolDefinitionsForScheduledTask } from "./scheduledTaskToolVisibility";
import {
  modelServiceNoticeFromError,
  throwForModelServiceNotice,
  type ModelServiceNotice,
} from "../shared/modelServiceNotice";
import { resolveAgentContextBudget } from "../shared/contextUsage";
import type { ProductionKernelDriver } from "./kernel/productionKernelDriver";
import {
  redactCredentials,
  redactCredentialString,
} from "../shared/credentialRedaction";

export type AgentModelProfile = {
  baseUrl: string;
  apiKey: string;
  model: string;
  providerId?: string;
  profile?: string;
  temperature: number;
  maxTokens: number;
  contextWindow?: number;
  contextWindowSource?: ModelContextWindowSource;
  thinking?: { type: "enabled" | "disabled"; budgetTokens?: number };
  modelCapabilities?: ModelCapabilities;
};

export type AgentRunnerService = {
  runTask(
    taskId: string,
    options?: {
      signal?: AbortSignal;
      sessionId?: string;
      onEvent?: (event: AgentRunEvent) => void;
      beforeExecution?: AgentRunAdmissionGate;
      onExecutionAdmitted?: AgentRunExecutionAdmittedHandler;
    },
  ): Promise<RunScheduledTaskResult>;
  resumeRun(
    runId: string,
    options?: {
      signal?: AbortSignal;
      onEvent?: (event: AgentRunEvent) => void;
      beforeExecution?: AgentRunAdmissionGate;
      onExecutionAdmitted?: AgentRunExecutionAdmittedHandler;
    },
  ): Promise<RunScheduledTaskResult>;
  runTaskStreaming(
    taskId: string,
    options?: {
      signal?: AbortSignal;
      beforeExecution?: AgentRunAdmissionGate;
      onExecutionAdmitted?: AgentRunExecutionAdmittedHandler;
    },
  ): AsyncIterable<AgentRunEvent>;
};

export function createAgentRunnerService(options: {
  taskStore: Pick<ScheduledTaskStore, "get" | "recordRun">;
  runStore: AgentRunStore;
  resolveSkill: (skillName: string) => Promise<SkillRecord | null>;
  chatClient: ChatClient;
  getModelProfile: () => Promise<AgentModelProfile>;
  toolAuthorizationService: ToolAuthorizationService;
  toolExecutor: AgentToolExecutor;
  executionStore?: AgentExecutionStore;
  workspaceService?: Pick<AgentWorkspaceService, "resolveRunContext">;
  trajectoryStore?: AgentTrajectoryStore;
  learningStore?: Pick<AgentLearningStore, "create">;
  memoryStore?: Partial<Pick<MemoryStore, "create" | "search">>;
  contextManager?: ContextManager;
  /** P2: passed through to the runtime engine's compaction path. */
  compactionStrategy?: CompactionStrategy;
  /** P8: max-mode (best-of-N) — passed through when ZEROX_MAX_MODE is on. */
  maxMode?: { runStep: (req: import("./providers/provider").CompleteRequest, opts: import("./providers/maxMode").MaxModeRunStepOptions) => Promise<import("./providers/maxMode").MaxModeResult> };
  actorRuntimeForMaxMode?: import("./actors/actorRuntime").ActorRuntime;
  toolResultOffloadStore?: ToolResultOffloadStore;
  toolResultOffloadThreshold?: number;
  createId?: () => string;
  now?: () => Date;
  maxReflectionRounds?: number;
  /** Shared production loop used by chat, goals, and scheduled runs. */
  runAgentLoop?: typeof runSharedAgentLoop;
  productionKernelDriver?: ProductionKernelDriver;
}): AgentRunnerService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const maxReflectionRounds = options.maxReflectionRounds ?? 3;
  const contextManager = options.contextManager ?? createContextManager();
  const toolRuntime = createToolRuntime({
    authorizationService: options.toolAuthorizationService,
    toolExecutor: options.toolExecutor,
  });
  const runtimeEngine = options.executionStore
    ? createAgentRuntimeEngine({
        taskStore: options.taskStore,
        runStore: options.runStore,
        executionStore: options.executionStore,
        resolveSkill: options.resolveSkill,
        chatClient: options.chatClient,
        getModelProfile: options.getModelProfile,
        toolAuthorizationService: options.toolAuthorizationService,
        toolExecutor: options.toolExecutor,
        ...(options.workspaceService ? { workspaceService: options.workspaceService } : {}),
        ...(options.trajectoryStore ? { trajectoryStore: options.trajectoryStore } : {}),
        ...(options.learningStore ? { learningStore: options.learningStore } : {}),
        ...(options.memoryStore ? { memoryStore: options.memoryStore } : {}),
        ...(options.toolResultOffloadStore
          ? { toolResultOffloadStore: options.toolResultOffloadStore }
          : {}),
        ...(options.toolResultOffloadThreshold !== undefined
          ? { toolResultOffloadThreshold: options.toolResultOffloadThreshold }
          : {}),
        ...(options.compactionStrategy
          ? { compactionStrategy: options.compactionStrategy }
          : {}),
        ...(options.maxMode ? { maxMode: options.maxMode } : {}),
        ...(options.actorRuntimeForMaxMode
          ? { actorRuntimeForMaxMode: options.actorRuntimeForMaxMode }
          : {}),
        createId,
        now,
        ...(options.runAgentLoop ? { runLoop: options.runAgentLoop } : {}),
        ...(options.productionKernelDriver
          ? { productionKernelDriver: options.productionKernelDriver }
          : {}),
      })
    : null;

  const isStreamingClient = (
    client: ChatClient,
  ): client is ChatClient & StreamingChatClient =>
    "streamComplete" in client &&
    typeof (client as StreamingChatClient).streamComplete === "function";

  function createEvent(
    level: AgentRunEvent["level"],
    message: string,
    phase?: AgentPhase,
    data?: Record<string, unknown>,
  ): AgentRunEvent {
    return {
      level,
      message: redactCredentialString(message),
      ...(phase ? { phase } : {}),
      ...(data
        ? { data: redactCredentials(data) as Record<string, unknown> }
        : {}),
      createdAt: now().toISOString(),
    };
  }

  function throwIfCanceled(signal: AbortSignal | undefined) {
    if (signal?.aborted) {
      throw new Error("Agent run canceled.");
    }
  }

  function isCancellationError(error: unknown, signal: AbortSignal | undefined) {
    return (
      signal?.aborted ||
      (error instanceof Error && /cancell?ed|abort/i.test(error.message))
    );
  }

  async function executeToolCalls(
    toolCalls: ToolCall[],
    taskId: string,
    events: AgentRunEvent[],
    signal: AbortSignal | undefined,
  ): Promise<ChatMessage[]> {
    const toolMessages: ChatMessage[] = [];

    const preparedCalls = await Promise.all(
      toolCalls.map(async (tc) => {
        const toolName = tc.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          return {
            tc,
            toolName,
            args,
            parseError: "无法解析工具参数 JSON。",
          };
        }

        return {
          tc,
          toolName,
          args,
        };
      }),
    );

    const executeResults = await Promise.all(
      preparedCalls.map(async (prepared) => {
        if (prepared.parseError) {
          events.push(
            createEvent("warn", prepared.parseError, "executing", {
              toolName: prepared.toolName,
            }),
          );
          return {
            toolCallId: prepared.tc.id,
            toolName: prepared.toolName,
            ok: false,
            error: prepared.parseError,
            result: undefined as Record<string, unknown> | undefined,
            dispatched: false,
          };
        }

        throwIfCanceled(signal);
        const outcome = await toolRuntime.execute({
          taskId,
          request: {
            toolName: prepared.toolName,
            args: prepared.args,
          },
          executionOptions: {
            ...(signal ? { signal } : {}),
            toolResultReadScope: { runId: taskId },
          },
          onStage(event) {
            if (event.stage === "dispatching") {
              events.push(
                createEvent(
                  "info",
                  `执行工具：${prepared.toolName}`,
                  "executing",
                  { toolName: prepared.toolName },
                ),
              );
            }
          },
        });
        const result = outcome.result;

        events.push(
          createEvent(
            result.ok ? "info" : "warn",
            result.ok
              ? `工具 ${prepared.toolName} 执行成功`
              : outcome.dispatched
                ? `工具 ${prepared.toolName} 返回错误`
                : `工具 ${prepared.toolName} 未授权：${result.error}`,
            "executing",
            { toolName: prepared.toolName },
          ),
        );

        return {
          toolCallId: prepared.tc.id,
          toolName: prepared.toolName,
          ok: result.ok,
          error: result.ok ? undefined : (result as { error: string }).error,
          result: result.ok ? (result as { result: Record<string, unknown> }).result : undefined,
          dispatched: outcome.dispatched,
        };
      }),
    );

    // Build tool result messages
    for (const execResult of executeResults) {
      const observation = {
        tool: execResult.toolName as never,
        ok: execResult.ok,
        ...(execResult.result ? { result: execResult.result } : {}),
        ...(execResult.error ? { error: execResult.error } : {}),
        toolCallId: execResult.toolCallId,
      };

      const serializedObservation =
        await serializeToolObservationWithOffload(observation, {
          store: options.toolResultOffloadStore,
          thresholdChars: options.toolResultOffloadThreshold,
          runId: taskId,
        });

      toolMessages.push({
        role: "tool",
        tool_call_id: execResult.toolCallId,
        content: serializedObservation.content,
      });
    }

    const denied = executeResults.find((result) => !result.dispatched);
    if (denied) {
      throw new Error(
        `Permission denied for tool ${denied.toolName}: ${denied.error}`,
      );
    }

    return toolMessages;
  }

  async function runInternal(
    taskId: string,
    signal: AbortSignal | undefined,
    onEvent?: (event: AgentRunEvent) => void,
    beforeExecution?: AgentRunAdmissionGate,
    sessionId?: string,
    onExecutionAdmitted?: AgentRunExecutionAdmittedHandler,
  ): Promise<RunScheduledTaskResult> {
    const task = await options.taskStore.get(taskId);
    if (!task) {
      return { ok: false, message: "Scheduled task was not found." };
    }

    const taskSkillName = task.skillName.trim();
    const skill = taskSkillName ? await options.resolveSkill(taskSkillName) : null;
    if (taskSkillName && !skill) {
      return { ok: false, message: "Task skill was not found." };
    }
    const admittedTaskId = task.id;
    const admittedTaskName = task.name;
    const admittedSkillName = getRunSkillName(task);

    const startedAt = now().toISOString();
    const runId = createId();
    const admissionCandidate = {
      runId,
      taskId: task.id,
      ...(sessionId ? { sessionId } : {}),
      executionRevision: 1,
    };
    const admissionLease = assertAgentRunAdmissionLease(
      admissionCandidate,
      await beforeExecution?.(admissionCandidate),
    );
    const events: AgentRunEvent[] = [];
    let executionAdmitted = false;
    const emit = (event: AgentRunEvent) => {
      events.push(event);
      publishAgentRunObserverEvent(onEvent, event);
    };

    async function persistInitializationFailure(): Promise<RunScheduledTaskResult> {
      const summary = "Agent run initialization failed.";
      const failureEvent = createEvent("error", summary, "done", {
        code: "AGENT_RUN_INITIALIZATION_FAILED",
      });
      events.push(failureEvent);
      if (executionAdmitted) {
        publishAgentRunObserverEvent(onEvent, failureEvent);
      }
      const run = projectSecretSafeAgentRun({
        id: runId,
        taskId: admittedTaskId,
        taskName: admittedTaskName,
        skillName: admittedSkillName,
        status: "failed",
        executionRevision: admissionCandidate.executionRevision,
        summary,
        events,
        failureClass: "unknown",
        failureCode: "AGENT_RUN_EXECUTION_FAILED",
        failureMessage: summary,
        startedAt,
        finishedAt: now().toISOString(),
      });
      await commitAdmittedAgentRun({
        run,
        admissionLease,
        appendRun: (record) => options.runStore.append(record),
      });
      await options.taskStore.recordRun(admittedTaskId, new Date(run.finishedAt))
        .catch(() => undefined);
      return { ok: true, run };
    }

    try {
      await onExecutionAdmitted?.(admissionCandidate);
      executionAdmitted = true;
    } catch {
      return persistInitializationFailure();
    }

    let profile: AgentModelProfile;
    let toolDefinitions: ToolDefinition[];
    let toolNames: string[];
    let messages: ChatMessage[];
    let needsPlanning: boolean;
    let proceduralMemoryContext: string | null;
    let contextBudget: ReturnType<typeof resolveAgentContextBudget>;
    let contextTokenBudget: number;
    try {
      emit(createEvent("info", "Agent run started.", "planning"));
      const availableToolDefinitions = filterToolDefinitionsForScheduledTask(
        "getRegistry" in options.toolExecutor
          ? (options.toolExecutor as AgentToolExecutor & { getRegistry(): { getDefinitions(): ToolDefinition[] } }).getRegistry().getDefinitions()
          : buildToolDefinitions(),
        task,
      );
      profile = await options.getModelProfile();
      toolDefinitions =
        profile.modelCapabilities?.tools === false ? [] : availableToolDefinitions;
      toolNames = toolDefinitions.map((td) => td.function.name);
      const systemTimeZone = getSystemTimeZone();
      const systemPrompt = buildAgentSystemPrompt({
        modelId: profile.model,
        currentDate: formatDateInTimeZone(new Date(startedAt), systemTimeZone),
        timeZone: systemTimeZone,
      });
      proceduralMemoryContext = await buildProceduralMemoryPromptContext({
        memoryStore: options.memoryStore,
        taskName: task.name,
        skillName: taskSkillName || "prompt-task",
        skillDescription: skill?.manifest.description,
      });
      messages = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: appendProceduralMemoryContext(
            buildTaskPrompt(task, skill),
            proceduralMemoryContext,
          ),
        },
      ];
      needsPlanning = skill
        ? skill.manifest.planning?.required === true
        : true;
      contextBudget = resolveAgentContextBudget({
        contextWindow: profile.contextWindow,
        contextWindowSource: profile.contextWindowSource,
        maxOutputTokens: profile.maxTokens,
      });
      contextTokenBudget = contextBudget.tokenBudget;
    } catch {
      return persistInitializationFailure();
    }

    let summary = "";
    let status: AgentRunRecord["status"] = "failed";
    let modelServiceNotice: ModelServiceNotice | undefined;
    let executionFailure: SecretSafeFailure | undefined;
    let currentPhase: AgentPhase = "planning";

    // Planning is an explicit Skill contract. maxTurns is only a checkpoint
    // interval and must not silently enable or disable planning.
    try {
      throwIfCanceled(signal);
      // profile already fetched above — reuse here

      function ensureContextWindow(msgs: ChatMessage[]): ChatMessage[] {
        const tokens = contextManager.estimateTokens(msgs);
        if (tokens > contextTokenBudget) {
          const compacted = contextManager.compressMessages(
            msgs,
            contextTokenBudget,
          );
          const compactedTokens = contextManager.estimateTokens(compacted);
          if (
            compacted.length === 0 ||
            compactedTokens >= tokens
          ) {
            if (contextBudget.enforcement === "hard") {
              throw new Error(
                `上下文无法继续压缩：估算 ${tokens} tokens，超过 ${contextTokenBudget} tokens 的已验证输入预算。`,
              );
            }
            return msgs;
          }
          if (
            contextBudget.enforcement === "hard" &&
            compactedTokens > contextTokenBudget
          ) {
            throw new Error(
              `上下文压缩后仍超出已验证输入预算：${tokens} → ${compactedTokens} tokens，预算 ${contextTokenBudget} tokens。`,
            );
          }
          emit(
            createEvent(
              "info",
              `上下文已压缩：${tokens} → ${compactedTokens} tokens`,
              currentPhase,
              {
                estimatedTokens: tokens,
                compactedTokens,
                tokenBudget: contextTokenBudget,
              },
            ),
          );
          return compacted;
        }
        return msgs;
      }

    // ── PHASE 1: PLAN ──
      let planSteps: Array<{
        description: string;
        expectedTool?: string;
        expectedOutcome: string;
        status: "pending" | "in_progress" | "completed" | "failed";
      }> = [];

      if (needsPlanning) {
        emit(createEvent("info", "正在制定执行计划...", "planning"));

        const planMessages: ChatMessage[] = [
          {
            role: "user",
            content: appendProceduralMemoryContext(
              buildPlanningPrompt(
                task.name,
                skill?.manifest.description ?? "任务未绑定技能，依据任务描述直接规划。",
                skill?.body ?? buildTaskPrompt(task, null),
                toolNames,
              ),
              proceduralMemoryContext,
            ),
          },
        ];

        const planResponse = await options.chatClient.complete({
          ...profile,
          messages: ensureContextWindow(planMessages),
          temperature: Math.min(profile.temperature, 0.3),
        });
        throwForModelServiceNotice(planResponse.modelServiceNotice);

        const planText = planResponse.content ?? "";
        const plan = parsePlanFromResponse(planText);

        if (plan && plan.steps.length > 0) {
          planSteps = plan.steps;
          emit(
            createEvent("info", `执行计划已制定：${plan.steps.length} 个步骤`, "planning", {
              steps: plan.steps.map((s) => s.description),
              reasoning: plan.reasoning,
            }),
          );
        } else {
          emit(
            createEvent("info", "跳过显式规划，直接执行。", "planning"),
          );
        }
      } else {
        emit(createEvent("info", "简单任务，跳过规划阶段。", "planning"));
      }

      // ── PHASE 2: EXECUTE ──
      currentPhase = "executing";
      const checkpointInterval =
        skill?.manifest.execution?.maxTurns ??
        (planSteps.length > 0 ? planSteps.length * 2 + 3 : 10);
      let turn = 0;
      const recordExecutionCheckpoint = () => {
        if (checkpointInterval > 0 && turn % checkpointInterval === 0) {
          emit(
            createEvent(
              "info",
              `已到达第 ${turn} 轮执行检查点，任务将自动继续。`,
              "executing",
              { turn, checkpointInterval },
            ),
          );
        }
      };

      if (planSteps.length > 0) {
        // Step-by-step execution with plan
        for (let stepIndex = 0; stepIndex < planSteps.length; stepIndex++) {
          throwIfCanceled(signal);
          const step = planSteps[stepIndex];
          step.status = "in_progress";
          emit(
            createEvent(
              "info",
              `执行步骤 ${stepIndex + 1}/${planSteps.length}：${step.description}`,
              "executing",
              { stepIndex, stepDescription: step.description },
            ),
          );

          // Add step context to messages
          const stepContext: ChatMessage = {
            role: "user",
            content: [
              `当前步骤（${stepIndex + 1}/${planSteps.length}）：${step.description}`,
              step.expectedOutcome
                ? `预期产出：${step.expectedOutcome}`
                : "",
              "请使用工具完成此步骤。完成后输出步骤结果。",
            ]
              .filter(Boolean)
              .join("\n"),
          };
          messages.push(stepContext);

          // Execute turns for this step
          let stepDone = false;
          let stepTurns = 0;
          const stepProgressCheckInterval = 4;

          while (!stepDone && stepTurns < stepProgressCheckInterval) {
            throwIfCanceled(signal);
            turn += 1;
            stepTurns += 1;
            recordExecutionCheckpoint();
            messages = ensureContextWindow(messages);

            const response = await options.chatClient.complete({
              ...profile,
              messages,
              tools: toolDefinitions,
              tool_choice: "auto",
              ...(signal ? { signal } : {}),
            });
            throwForModelServiceNotice(response.modelServiceNotice);

            if (response.content) {
              emit(
                createEvent("info", "模型回复已收到。", "executing", {
                  turn,
                  hasContent: true,
                  hasToolCalls: response.toolCalls.length > 0,
                }),
              );
            }

            // If no tool_calls and has content, step is done
            if (!response.toolCalls.length) {
              messages.push({
                role: "assistant",
                content: response.content ?? "",
              });
              step.status = "completed";
              stepDone = true;
              emit(
                createEvent("info", `步骤 ${stepIndex + 1} 完成。`, "executing", {
                  stepIndex,
                }),
              );
              continue;
            }

            // Process tool calls
            messages.push({
              role: "assistant",
              content: response.content ?? "",
              tool_calls: response.toolCalls,
            });

            const toolMessages = await executeToolCalls(
              response.toolCalls,
              taskId,
              events,
              signal,
            );
            messages.push(...toolMessages);

            // Check if all tools succeeded
            const allSucceeded = toolMessages.every((tm) => {
              try {
                const obs = JSON.parse(tm.content) as {
                  ok: boolean;
                };
                return obs.ok;
              } catch {
                return false;
              }
            });

            if (allSucceeded && response.toolCalls.length > 0) {
              // Continue to let LLM confirm step completion
              continue;
            }
          }

          if (!stepDone) {
            step.status = "failed";
            emit(
              createEvent(
                "warn",
                `步骤 ${stepIndex + 1} 未在限制轮次内完成。`,
                "executing",
                { stepIndex },
              ),
            );

            // ── PHASE 3: REFLECT ──
            currentPhase = "reflecting";
            let reflected = false;

            for (
              let reflectionRound = 0;
              reflectionRound < maxReflectionRounds && !reflected;
              reflectionRound++
            ) {
              throwIfCanceled(signal);
              emit(
                createEvent(
                  "info",
                  `反思轮次 ${reflectionRound + 1}/${maxReflectionRounds}`,
                  "reflecting",
                ),
              );

              const reflectionPrompt = buildReflectionPrompt(
                step.description,
                "步骤未在限制轮次内完成",
                planSteps
                  .filter((s) => s.status === "completed")
                  .map((s) => s.description)
                  .join("\n"),
              );

              const reflectionResponse = await options.chatClient.complete({
                ...profile,
                messages: [{ role: "user", content: reflectionPrompt }],
                temperature: Math.min(profile.temperature, 0.3),
              });
              throwForModelServiceNotice(
                reflectionResponse.modelServiceNotice,
              );

              const reflection = parseReflectionFromResponse(
                reflectionResponse.content ?? "",
              );

              if (!reflection) {
                emit(
                  createEvent("warn", "无法解析反思结果，跳过。", "reflecting"),
                );
                break;
              }

              emit(
                createEvent("info", `反思决策：${reflection.suggestion}`, "reflecting", {
                  analysis: reflection.analysis,
                }),
              );

              if (reflection.suggestion === "retry") {
                step.status = "pending";
                step.description = reflection.adjustedApproach || step.description;
                stepIndex -= 1; // Retry this step
                reflected = true;
                currentPhase = "executing";
              } else if (reflection.suggestion === "skip") {
                step.status = "completed";
                reflected = true;
                currentPhase = "executing";
              } else {
                // abort
                reflected = true;
                executionFailure = createSecretSafeFailure(
                  "AGENT_RUN_EXECUTION_FAILED",
                );
                summary = executionFailure.publicMessage;
                status = "failed";
                emit(createEvent("error", summary, "done", {
                  code: executionFailure.code,
                }));
                break;
              }
            }
          }
        }
      } else {
        // No plan — execute reactively
        while (Number.isFinite(turn)) {
          throwIfCanceled(signal);
          turn += 1;
          recordExecutionCheckpoint();
          messages = ensureContextWindow(messages);

          const response = await options.chatClient.complete({
            ...profile,
            messages,
            tools: toolDefinitions,
            tool_choice: "auto",
            ...(signal ? { signal } : {}),
          });
          throwForModelServiceNotice(response.modelServiceNotice);

          if (response.content) {
            emit(
              createEvent("info", "模型回复已收到。", "executing", {
                turn,
                hasContent: true,
                hasToolCalls: response.toolCalls.length > 0,
              }),
            );
          }

          // No tool calls + has content → final message
          if (!response.toolCalls.length && response.content) {
            summary = redactCredentialString(response.content);
            status = "succeeded";
            emit(createEvent("info", "Agent run finished.", "done"));
            break;
          }

          // Tool calls present
          if (response.toolCalls.length) {
            messages.push({
              role: "assistant",
              content: response.content ?? "",
              tool_calls: response.toolCalls,
            });

            const toolMessages = await executeToolCalls(
              response.toolCalls,
              taskId,
              events,
              signal,
            );
            messages.push(...toolMessages);
            continue;
          }

          // No content and no tool calls — treat as error
          executionFailure = createSecretSafeFailure(
            "AGENT_RUN_EXECUTION_FAILED",
          );
          summary = executionFailure.publicMessage;
          emit(createEvent("error", summary, "done", {
            code: executionFailure.code,
          }));
          break;
        }
      }

      if (!summary && status !== "failed") {
        if (planSteps.every((s) => s.status === "completed")) {
          summary = "所有计划步骤已完成。";
          status = "succeeded";
        }
      }
    } catch (error) {
      if (isCancellationError(error, signal)) {
        status = "canceled";
        summary = "运行已取消。";
        emit(createEvent("warn", "Agent run canceled.", "done"));
      } else {
        modelServiceNotice = modelServiceNoticeFromError(error, {
          model: profile.model,
        });
        executionFailure = toSecretSafeFailure(
          error,
          "AGENT_RUN_EXECUTION_FAILED",
        );
        status = modelServiceNotice ? "paused" : "failed";
        summary = modelServiceNotice?.message ?? executionFailure.publicMessage;
        emit(createEvent(
          modelServiceNotice ? "warn" : "error",
          summary,
          "done",
          modelServiceNotice ? undefined : { code: executionFailure.code },
        ));
      }
    }

    if (status === "failed" && !executionFailure) {
      executionFailure = createSecretSafeFailure(
        "AGENT_RUN_EXECUTION_FAILED",
      );
      summary = executionFailure.publicMessage;
    }
    currentPhase = "done";
    const run = projectSecretSafeAgentRun({
      id: runId,
      taskId: task.id,
      taskName: redactCredentialString(task.name),
      skillName: redactCredentialString(getRunSkillName(task)),
      status,
      executionRevision: admissionCandidate.executionRevision,
      summary: redactCredentialString(summary),
      events,
      ...(modelServiceNotice
        ? {
            modelServiceNotice: redactCredentials(
              modelServiceNotice,
            ) as ModelServiceNotice,
          }
        : {}),
      ...(status === "failed" && executionFailure
        ? {
            failureClass: "unknown" as const,
            failureCode: executionFailure.code,
            failureMessage: executionFailure.publicMessage,
          }
        : {}),
      startedAt,
      finishedAt: now().toISOString(),
    });

    await commitAdmittedAgentRun({
      run,
      admissionLease,
      appendRun: (record) => options.runStore.append(record),
    });

    if (run.status === "succeeded" && options.memoryStore?.create) {
      try {
        await options.memoryStore.create({
          kind: "episodic",
          title: `Run: ${run.taskName}`,
          content: run.summary,
          tags: ["agent-run", run.skillName],
          source: { type: "agent_run", refId: run.id },
          importance: 3,
        });
        emit(createEvent("info", "Episodic memory written.", "done", {
          memoryKind: "episodic",
        }));
      } catch (error) {
        const safeFailure = toSecretSafeFailure(error, "INTERNAL_FAILURE");
        emit(createEvent("warn", "Unable to write episodic memory.", "done", {
          code: safeFailure.code,
        }));
      }
    }
    run.events = redactCredentials(events) as AgentRunEvent[];
    await options.taskStore.recordRun(task.id, new Date(run.finishedAt))
      .catch(() => undefined);

    return { ok: true, run };
  }

  return {
    async runTask(taskId, runOptions) {
      if (runtimeEngine) {
        return runtimeEngine.startTask(taskId, runOptions);
      }

      return runInternal(
        taskId,
        runOptions?.signal,
        runOptions?.onEvent,
        runOptions?.beforeExecution,
        runOptions?.sessionId,
        runOptions?.onExecutionAdmitted,
      );
    },

    async resumeRun(runId, runOptions) {
      if (!runtimeEngine) {
        return {
          ok: false,
          message: "Recoverable runtime is not configured.",
        };
      }

      return runtimeEngine.resumeRun(runId, runOptions);
    },

    async *runTaskStreaming(taskId, runOptions) {
      const maxBufferedEvents = 256;
      const bufferedEvents: AgentRunEvent[] = [];
      let droppedEvents = 0;
      let wakeConsumer: (() => void) | undefined;
      let settled = false;
      const onEvent = (event: AgentRunEvent) => {
        if (bufferedEvents.length >= maxBufferedEvents) {
          const droppableIndex = bufferedEvents.findIndex(
            (candidate) => candidate.level === "info",
          );
          bufferedEvents.splice(droppableIndex >= 0 ? droppableIndex : 0, 1);
          droppedEvents += 1;
        }
        bufferedEvents.push(event);
        wakeConsumer?.();
        wakeConsumer = undefined;
      };
      const completion = (
        runtimeEngine
          ? runtimeEngine.startTask(taskId, { ...runOptions, onEvent })
          : runInternal(
              taskId,
              runOptions?.signal,
              onEvent,
              runOptions?.beforeExecution,
              undefined,
              runOptions?.onExecutionAdmitted,
            )
      ).finally(() => {
        settled = true;
        wakeConsumer?.();
        wakeConsumer = undefined;
      });

      while (!settled || bufferedEvents.length > 0) {
        const event = bufferedEvents.shift();
        if (event) {
          yield event;
          continue;
        }
        await new Promise<void>((resolve) => {
          wakeConsumer = resolve;
        });
      }

      if (droppedEvents > 0) {
        yield {
          level: "warn",
          message: `流式消费者处理过慢，已合并或丢弃 ${droppedEvents} 条中间信息事件；最终运行记录仍完整保留。`,
          data: { code: "STREAM_BACKPRESSURE", droppedEvents },
          createdAt: now().toISOString(),
        };
      }

      const result = await completion;

      // Yield the final result as a special event
      if (result.ok) {
        yield {
          level: "info",
          message: JSON.stringify(result.run),
          createdAt: now().toISOString(),
        };
      } else {
        yield {
          level: "error",
          message: result.message,
          createdAt: now().toISOString(),
        };
      }
    },
  };
}

function getRunSkillName(task: { skillName: string }): string {
  return task.skillName.trim() || "prompt-task";
}
