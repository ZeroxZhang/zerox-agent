import { randomUUID } from "node:crypto";
import type { AgentExecutionStore } from "./agentExecutionStore";
import type { AgentLearningStore } from "./agentLearningStore";
import type { AgentRunStore } from "./agentRunStore";
import type { AgentToolExecutor } from "./agentToolExecutor";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import type { AgentWorkspaceService } from "./agentWorkspaceService";
import { createAgentRuntimeEngine } from "./agentRuntimeEngine";
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
import {
  buildAgentSystemPrompt,
  buildPlanningPrompt,
  buildReflectionPrompt,
  buildTaskPrompt,
  buildToolDefinitions,
  parsePlanFromResponse,
  parseReflectionFromResponse,
} from "../shared/agentProtocol";
import { serializeToolObservationWithOffload } from "./toolObservationOffload";
import type { ToolResultOffloadStore } from "./toolResultOffloadStore";
import type {
  AgentPhase,
  AgentRunEvent,
  AgentRunRecord,
  RunScheduledTaskResult,
} from "../shared/agentRuns";
import type { SkillRecord } from "../shared/skills";

export type AgentModelProfile = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  thinking?: { type: "enabled" | "disabled"; budgetTokens?: number };
};

export type AgentRunnerService = {
  runTask(
    taskId: string,
    options?: { signal?: AbortSignal },
  ): Promise<RunScheduledTaskResult>;
  resumeRun(
    runId: string,
    options?: { signal?: AbortSignal },
  ): Promise<RunScheduledTaskResult>;
  runTaskStreaming(
    taskId: string,
    options?: { signal?: AbortSignal },
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
}): AgentRunnerService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const maxReflectionRounds = options.maxReflectionRounds ?? 3;
  const contextManager = options.contextManager ?? createContextManager();
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
      message,
      ...(phase ? { phase } : {}),
      ...(data ? { data } : {}),
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

    // Phase: authorize all tool calls in parallel
    const authResults = await Promise.all(
      toolCalls.map(async (tc) => {
        const toolName = tc.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          return { tc, toolName, args, allowed: false, reason: "无法解析工具参数 JSON。" };
        }

        throwIfCanceled(signal);
        const auth = await options.toolAuthorizationService.authorize(taskId, {
          toolName: toolName as never,
          args,
        });

        return {
          tc,
          toolName,
          args,
          allowed: auth.ok && auth.decision.allowed,
          reason: auth.ok ? auth.decision.reason : auth.message,
        };
      }),
    );

    // Phase: execute allowed tool calls in parallel
    const executeResults = await Promise.all(
      authResults.map(async (authResult) => {
        if (!authResult.allowed) {
          events.push(
            createEvent("warn", `工具 ${authResult.toolName} 未授权：${authResult.reason}`, "executing", {
              toolName: authResult.toolName,
            }),
          );
          return {
            toolCallId: authResult.tc.id,
            toolName: authResult.toolName,
            ok: false,
            error: `工具调用被拒绝：${authResult.reason}`,
            result: undefined as Record<string, unknown> | undefined,
          };
        }

        events.push(
          createEvent("info", `执行工具：${authResult.toolName}`, "executing", {
            toolName: authResult.toolName,
          }),
        );

        throwIfCanceled(signal);
        const result = await options.toolExecutor.execute({
          toolName: authResult.toolName as never,
          args: authResult.args,
        }, signal ? { signal } : undefined);

        events.push(
          createEvent(
            result.ok ? "info" : "warn",
            result.ok
              ? `工具 ${authResult.toolName} 执行成功`
              : `工具 ${authResult.toolName} 返回错误`,
            "executing",
            { toolName: authResult.toolName },
          ),
        );

        return {
          toolCallId: authResult.tc.id,
          toolName: authResult.toolName,
          ok: result.ok,
          error: result.ok ? undefined : (result as { error: string }).error,
          result: result.ok ? (result as { result: Record<string, unknown> }).result : undefined,
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

    return toolMessages;
  }

  async function runInternal(
    taskId: string,
    signal: AbortSignal | undefined,
    onEvent?: (event: AgentRunEvent) => void,
  ): Promise<RunScheduledTaskResult> {
    const task = await options.taskStore.get(taskId);
    if (!task) {
      return { ok: false, message: "Scheduled task was not found." };
    }

    const skill = await options.resolveSkill(task.skillName);
    if (!skill) {
      return { ok: false, message: "Task skill was not found." };
    }

    const startedAt = now().toISOString();
    const events: AgentRunEvent[] = [];
    const emit = (event: AgentRunEvent) => {
      events.push(event);
      onEvent?.(event);
    };

    emit(createEvent("info", "Agent run started.", "planning"));

    const toolDefinitions =
      "getRegistry" in options.toolExecutor
        ? (options.toolExecutor as AgentToolExecutor & { getRegistry(): { getDefinitions(): ToolDefinition[] } }).getRegistry().getDefinitions()
        : buildToolDefinitions();
    const toolNames = toolDefinitions.map((td) => td.function.name);

    // Fetch model profile early so we can pass modelId to the system prompt builder.
    // Wrapped in try/catch because this runs outside the main try block below.
    let profile: AgentModelProfile;
    try {
      profile = await options.getModelProfile();
    } catch (error) {
      return {
        ok: false,
        message: `Failed to load model profile: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    const systemPrompt = buildAgentSystemPrompt({
      modelId: profile.model,
      currentDate: startedAt.split("T")[0],
    });
    const proceduralMemoryContext =
      await buildProceduralMemoryPromptContext({
        memoryStore: options.memoryStore,
        taskName: task.name,
        skillName: task.skillName,
        skillDescription: skill.manifest.description,
      });

    let messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: appendProceduralMemoryContext(
          buildTaskPrompt(task, skill),
          proceduralMemoryContext,
        ),
      },
    ];

    let summary = "";
    let status: AgentRunRecord["status"] = "failed";
    let currentPhase: AgentPhase = "planning";

    // Determine if planning is needed
    const needsPlanning =
      skill.manifest.execution?.maxTurns !== undefined
        ? (skill.manifest.execution.maxTurns ?? 10) > 3
        : true;

    try {
      throwIfCanceled(signal);
      // profile already fetched above — reuse here

      function ensureContextWindow(msgs: ChatMessage[]): ChatMessage[] {
        const tokens = contextManager.estimateTokens(msgs);
        if (tokens > profile.maxTokens * 0.8) {
          emit(
            createEvent("info", `上下文窗口接近上限 (${tokens}/${profile.maxTokens} tokens)，正在压缩...`, currentPhase),
          );
          return contextManager.compressMessages(msgs, Math.floor(profile.maxTokens * 0.7));
        }
        return msgs;
      }

      async function completeWithRetry(
      requestParams: Parameters<typeof options.chatClient.complete>[0],
      maxRetries = 2,
    ): ReturnType<typeof options.chatClient.complete> {
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          throwIfCanceled(signal);
          return await options.chatClient.complete(requestParams);
        } catch (error) {
          if (attempt === maxRetries || isCancellationError(error, signal)) {
            throw error;
          }
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
          emit(
            createEvent(
              "warn",
              `LLM 调用失败，${delay}ms 后重试 (${attempt + 1}/${maxRetries})`,
              currentPhase,
            ),
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
      throw new Error("LLM retry exhausted.");
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
                skill.manifest.description,
                skill.body,
                toolNames,
              ),
              proceduralMemoryContext,
            ),
          },
        ];

        const planResponse = await options.chatClient.complete({
          ...profile,
          messages: planMessages,
          temperature: Math.min(profile.temperature, 0.3),
        });

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
      const maxTurns =
        skill.manifest.execution?.maxTurns ??
        (planSteps.length > 0 ? planSteps.length * 2 + 3 : 10);
      let turn = 0;

      if (planSteps.length > 0) {
        // Step-by-step execution with plan
        for (
          let stepIndex = 0;
          stepIndex < planSteps.length && turn < maxTurns;
          stepIndex++
        ) {
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
          const maxStepTurns = 4;

          while (!stepDone && stepTurns < maxStepTurns && turn < maxTurns) {
            throwIfCanceled(signal);
            turn += 1;
            stepTurns += 1;

            const response = await options.chatClient.complete({
              ...profile,
              messages,
              tools: toolDefinitions,
              tool_choice: "auto",
              ...(signal ? { signal } : {}),
            });

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
                summary = `任务中止：步骤"${step.description}"失败，反思后决定中止。分析：${reflection.analysis}`;
                status = "failed";
                emit(createEvent("error", summary, "done"));
                break;
              }
            }
          }
        }
      } else {
        // No plan — execute reactively
        while (turn < maxTurns) {
          throwIfCanceled(signal);
          turn += 1;
          messages = ensureContextWindow(messages);

          const response = await options.chatClient.complete({
            ...profile,
            messages,
            tools: toolDefinitions,
            tool_choice: "auto",
            ...(signal ? { signal } : {}),
          });

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
            summary = response.content;
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
          summary = "模型未返回有效内容或工具调用。";
          emit(createEvent("error", summary, "done"));
          break;
        }
      }

      if (!summary && status !== "failed") {
        if (planSteps.every((s) => s.status === "completed")) {
          summary = "所有计划步骤已完成。";
          status = "succeeded";
        } else if (turn >= maxTurns) {
          summary = "Agent run reached the maximum turn limit.";
          emit(createEvent("error", summary, "done"));
        }
      }
    } catch (error) {
      if (isCancellationError(error, signal)) {
        status = "canceled";
        summary = "运行已取消。";
        emit(createEvent("warn", "Agent run canceled.", "done"));
      } else {
        status = "failed";
        summary =
          error instanceof Error ? error.message : "Agent run failed.";
        emit(createEvent("error", summary, "done"));
      }
    }

    currentPhase = "done";
    const run: AgentRunRecord = {
      id: createId(),
      taskId: task.id,
      taskName: task.name,
      skillName: task.skillName,
      status,
      summary,
      events,
      startedAt,
      finishedAt: now().toISOString(),
    };

    if (run.status === "succeeded" && options.memoryStore?.create) {
      try {
        await options.memoryStore.create({
          kind: "episodic",
          title: `Run: ${task.name}`,
          content: run.summary,
          tags: ["agent-run", task.skillName],
          source: { type: "agent_run", refId: run.id },
          importance: 3,
        });
        run.events.push(
          createEvent("info", "Episodic memory written.", "done", {
            memoryKind: "episodic",
          }),
        );
      } catch (error) {
        run.events.push(
          createEvent("warn", "Unable to write episodic memory.", "done", {
            error:
              error instanceof Error
                ? error.message
                : "Unknown memory error.",
          }),
        );
      }
    }

    await options.runStore.append(run);
    await options.taskStore.recordRun(task.id, new Date(run.finishedAt));

    return { ok: true, run };
  }

  return {
    async runTask(taskId, runOptions) {
      if (runtimeEngine) {
        return runtimeEngine.startTask(taskId, runOptions);
      }

      return runInternal(taskId, runOptions?.signal);
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
      if (runtimeEngine) {
        const result = await runtimeEngine.startTask(taskId, runOptions);

        if (result.ok) {
          for (const event of result.run.events) {
            yield event;
          }
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
        return;
      }

      const emittedEvents: AgentRunEvent[] = [];

      const result = await runInternal(
        taskId,
        runOptions?.signal,
        (event) => {
          emittedEvents.push(event);
        },
      );

      // Yield all events
      for (const event of emittedEvents) {
        yield event;
      }

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
