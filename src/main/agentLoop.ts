import type { AgentToolExecutor } from "./agentToolExecutor";
import { createContextManager, type ContextManager } from "./contextManager";
import type { CompactionStrategy } from "./kernel/compactionStrategy";
import { NEVER_COMPACT_MARKER } from "../shared/compactionMarkers";
import type { AgentRunContext } from "../shared/agentWorkspace";
import type { SystemReminderContext, SystemReminderRegistry } from "../shared/systemReminder";
import type {
  ChatClient,
  ChatCompletionResponse,
  ChatMessage,
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
  buildAgentSystemPrompt,
  buildToolDefinitions,
  serializeToolObservation,
} from "../shared/agentProtocol";
import { serializeToolObservationWithOffload } from "./toolObservationOffload";
import type { ToolResultOffloadStore } from "./toolResultOffloadStore";
import { getToolCapability } from "../shared/agentToolCapabilities";

export type AgentLoopOptions = {
  chatClient: ChatClient;
  toolExecutor: AgentToolExecutor;
  toolAuthorizationService?: ToolAuthorizationService;
  taskId?: string;
  runContext?: AgentRunContext;
  runtimeTask?: RuntimeToolAuthorizationTask;
  systemPrompt?: string;
  maxTurns?: number;
  signal?: AbortSignal;
  tools?: ReturnType<typeof buildToolDefinitions>;
  toolResultOffloadStore?: ToolResultOffloadStore;
  toolResultOffloadThreshold?: number;
  pauseOnTurnLimit?: boolean;
  pauseOnStrategyGuard?: boolean;
  resumeMessages?: ChatMessage[];
  initialToolCallsExecuted?: number;
  pauseOnFailureLoop?: boolean;
  contextManager?: ContextManager;
  /** P2: overflow compaction routes through this strategy when provided
   *  (auto→rebuild when a checkpoint exists, else summarize = current behavior).
   *  Absent → legacy compressMessages (zero regression). */
  compactionStrategy?: CompactionStrategy;
  /** P3: system-reminder registry for conditional runtime injections.
   *  When provided, triggers are evaluated before each model call and matching
   *  reminders are injected as synthetic user messages. All triggers default OFF. */
  systemReminderRegistry?: SystemReminderRegistry;
  modelRetry?: ModelRetryOptions;
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
  onToolResult?: (
    toolName: string,
    ok: boolean,
    result: Awaited<ReturnType<AgentToolExecutor["execute"]>>,
  ) => void;
  onTurn?: (turn: number, phase: string) => void;
  onReasoning?: (reasoningContent: string, turn: number) => void;
  onModelResponse?: (response: ChatCompletionResponse, turn: number) => void;
  onContextCompacted?: (event: AgentLoopContextCompaction) => void;
  onModelRetry?: (event: ModelRetryEvent) => void;
  onStrategyGuard?: (event: AgentLoopStrategyGuardEvent) => void;
};

export type AgentLoopContextCompaction = {
  originalMessageCount: number;
  compactedMessageCount: number;
  estimatedTokens: number;
  tokenBudget: number;
};

export type AgentLoopStrategyGuardEvent = {
  code: "FRAGMENTED_TOOL_CALLS";
  severity: "warn";
  message: string;
  toolName: string;
  count: number;
};

export type AgentLoopContinuation = {
  reason: "turn_limit" | "tool_failure_loop" | "strategy_guard";
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
  continuation?: AgentLoopContinuation;
};

export async function runAgentLoop(
  initialMessages: ChatMessage[],
  modelProfile: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
  },
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const {
    chatClient,
    toolExecutor,
    toolAuthorizationService,
    taskId,
    runContext,
    runtimeTask,
    systemPrompt,
    maxTurns = 4,
    signal,
    tools: customTools,
    toolResultOffloadStore,
    toolResultOffloadThreshold,
    pauseOnTurnLimit = false,
    pauseOnStrategyGuard = false,
    resumeMessages,
    initialToolCallsExecuted = 0,
    pauseOnFailureLoop = false,
    contextManager = createContextManager(),
    compactionStrategy,
    systemReminderRegistry,
    modelRetry,
    onToolCall,
    onToolResult,
    onTurn,
    onReasoning,
    onModelResponse,
    onContextCompacted,
    onModelRetry,
    onStrategyGuard,
  } = options;

  const toolDefinitions = customTools ?? buildToolDefinitions();
  const messages: ChatMessage[] = resumeMessages ? [...resumeMessages] : [];
  // Anchor date to loop creation so the system prompt stays byte-identical
  // across turns — critical for Anthropic prompt cache hit rate.
  const loopDate = new Date().toISOString().split("T")[0];

  if (!resumeMessages) {
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    } else {
      messages.push({
        role: "system",
        content: buildAgentSystemPrompt({
          modelId: modelProfile.model,
          currentDate: loopDate,
        }),
      });
    }

    messages.push(...initialMessages);
  }

  let summary = "";
  let status: AgentLoopResult["status"] = "failed";
  let turns = 0;
  let toolCallsExecuted = Math.max(0, Math.floor(initialToolCallsExecuted));
  let continuation: AgentLoopContinuation | undefined;
  let lastExecutedToolSignature: string | null =
    findLastExecutedToolSignature(messages);
  let toolFailureStreak: {
    toolName: string;
    kind: string;
    count: number;
  } | null = null;
  let toolFailureLoopRecoveryAttempts = 0;
  const toolCallCounts = new Map<string, number>();
  const emittedStrategyGuards = new Set<string>();
  const successfulToolNames = new Set<string>();
  const contextTokenBudget = Math.max(1, Math.floor(modelProfile.maxTokens * 0.7));

  async function compactMessagesBeforeModelRequest() {
    const estimatedTokens = contextManager.estimateTokens(messages);
    if (estimatedTokens <= contextTokenBudget) {
      return;
    }

    const originalMessageCount = messages.length;

    // P2: route through the compaction strategy when provided. Default flag
    // `auto` degrades to summarize (= compressMessages) when no checkpoint
    // exists — byte-equivalent to the legacy path unless a rebuild happens.
    if (compactionStrategy) {
      const result = await compactionStrategy.compact({
        messages,
        budget: contextTokenBudget,
        runId: modelProfile.model,
        protectedMarkers: [NEVER_COMPACT_MARKER],
      });
      if (!result.compacted) {
        return;
      }
      messages.splice(0, messages.length, ...result.messages);
      onContextCompacted?.({
        originalMessageCount,
        compactedMessageCount: messages.length,
        estimatedTokens,
        tokenBudget: contextTokenBudget,
      });
      return;
    }

    const compacted = contextManager.compressMessages(
      messages,
      contextTokenBudget,
    );
    if (compacted.length === originalMessageCount && compacted === messages) {
      return;
    }

    messages.splice(0, messages.length, ...compacted);
    onContextCompacted?.({
      originalMessageCount,
      compactedMessageCount: messages.length,
      estimatedTokens,
      tokenBudget: contextTokenBudget,
    });
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
      messages.splice(lastUserIdx + 1, 0, { role: "user", content: reminder });
    }
  }

  async function finalizeWithoutTools(options: {
    prompt: string;
    summaryPrefix: string;
    fallbackSummary: string;
  }) {
    onTurn?.(turns, "finalizing");
    messages.push({
      role: "system",
      content: options.prompt,
    });
    injectSystemReminders({
      estimatedTokens: contextManager.estimateTokens(messages),
      tokenBudget: contextTokenBudget,
    });
    await compactMessagesBeforeModelRequest();

    try {
      const response = await completeWithModelRetry(
        chatClient,
        {
          ...modelProfile,
          messages,
          ...(signal ? { signal } : {}),
        },
        modelRetry,
        onModelRetry,
      );

      if (response.content) {
        summary = `${options.summaryPrefix}\n\n${response.content}`;
        status = "succeeded";
        messages.push({
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

  try {
    for (; turns < maxTurns; turns += 1) {
      if (signal?.aborted) {
        status = "canceled";
        summary = "Agent loop canceled.";
        break;
      }

      onTurn?.(turns, "executing");
      injectSystemReminders({
        estimatedTokens: contextManager.estimateTokens(messages),
        tokenBudget: contextTokenBudget,
        loopSignature: lastExecutedToolSignature,
        loopCount: toolFailureStreak?.count,
        // Only signal "execution" on the first turn after planning,
        // so mode_transition fires exactly once at the boundary.
        mode: turns === 0 ? "planning" : turns === 1 ? "execution" : undefined,
      });
      await compactMessagesBeforeModelRequest();

      const response = await completeWithModelRetry(
        chatClient,
        {
          ...modelProfile,
          messages,
          tools: toolDefinitions,
          tool_choice: "auto",
          ...(signal ? { signal } : {}),
        },
        modelRetry,
        onModelRetry,
      );
      onModelResponse?.(response, turns + 1);
      if (response.reasoningContent) {
        onReasoning?.(response.reasoningContent, turns + 1);
      }

      // No tool calls + content → final
      if (!response.toolCalls.length && response.content) {
        summary = response.content;
        status = "succeeded";
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

          return {
            toolCall,
            toolName: toolCall.function.name,
            args,
            signature: args
              ? createToolCallSignature(toolCall.function.name, args)
              : null,
          };
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
        messages.push({
          role: "assistant",
          content: response.content ?? "",
          tool_calls: response.toolCalls,
        });

        // Process each tool call
        for (const preparedToolCall of preparedToolCalls) {
          const { toolCall, toolName, signature } = preparedToolCall;
          if (!preparedToolCall.args) {
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                type: "tool_result",
                tool: toolCall.function.name,
                ok: false,
                error: "参数 JSON 解析失败",
              }),
            });
            continue;
          }

          const args = applyRunContextDefaultsToToolArgs(
            toolName,
            preparedToolCall.args,
            runContext,
          );
          const nativeFallbackRejection = rejectNativeToolFallback({
            toolName,
            args,
            successfulToolNames,
          });
          if (nativeFallbackRejection) {
            const rejectedResult = {
              ok: false as const,
              error: nativeFallbackRejection,
            };
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: serializeToolObservation({
                tool: toolName as never,
                ok: false,
                error: nativeFallbackRejection,
                toolCallId: toolCall.id,
              }),
            });
            onToolResult?.(toolName, false, rejectedResult);
            continue;
          }

          // Authorization check (if authorizer is available)
          if (toolAuthorizationService && taskId) {
            const toolSource = getToolSource(toolExecutor, toolName);
            const auth = await toolAuthorizationService.authorize(taskId, {
              toolName: toolName as never,
              ...(toolSource ? { source: toolSource } : {}),
              args,
            }, {
              ...(runContext ? { runContext } : {}),
              ...(runtimeTask ? { runtimeTask } : {}),
            });

            if (!auth.ok || !auth.decision.allowed) {
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: serializeToolObservation({
                  tool: toolName as never,
                  ok: false,
                  error: auth.ok
                    ? auth.decision.reason
                    : auth.message,
                  toolCallId: toolCall.id,
                }),
              });
              onToolResult?.(toolName, false, {
                ok: false,
                error: auth.ok ? auth.decision.reason : auth.message,
              });
              continue;
            }
          }

          onToolCall?.(toolName, args);

          // Execute tool
          const result = await toolExecutor.execute({
            toolName: toolName as never,
            args,
          }, {
            ...(signal ? { signal } : {}),
            ...(runContext ? { runContext } : {}),
          });

          toolCallsExecuted += 1;
          const strategyGuardEvent = recordToolStrategySignals(toolName);
          lastExecutedToolSignature = signature;
          if (result.ok) {
            successfulToolNames.add(toolName);
          }
          onToolResult?.(toolName, result.ok, result);
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
                ? { result: (result as { result: Record<string, unknown> }).result }
                : {
                    error: (result as { error: string }).error,
                    ...((result as { errorDetails?: Record<string, unknown> })
                      .errorDetails
                      ? {
                          errorDetails: (
                            result as {
                              errorDetails: Record<string, unknown>;
                            }
                          ).errorDetails,
                        }
                      : {}),
                  }),
              toolCallId: toolCall.id,
            }, {
              store: toolResultOffloadStore,
              thresholdChars: toolResultOffloadThreshold,
              runId: taskId,
            });

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: serializedObservation.content,
          });

          const selfFinalizingSummary = buildSelfFinalizingToolSummary(
            toolName,
            result,
          );
          if (selfFinalizingSummary) {
            status = "succeeded";
            summary = selfFinalizingSummary;
            break;
          }

          if (pauseOnStrategyGuard && strategyGuardEvent) {
            status = "paused";
            continuation = {
              reason: "strategy_guard",
              maxTurns,
              toolCallsExecuted,
              toolName,
              strategyGuardCode: strategyGuardEvent.code,
            };
            summary = buildStrategyGuardPauseSummary(
              strategyGuardEvent,
              toolCallsExecuted,
            );
            break;
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
              messages.push({
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
              break;
            }

            status = "paused";
            continuation = {
              reason: "tool_failure_loop",
              maxTurns,
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
            break;
          }
        }

        if (status === "paused") {
          break;
        }
        if (status === "succeeded") {
          break;
        }

        continue;
      }

      // No content and no tool calls
      summary = "Agent did not produce a response.";
      break;
    }

    if (!summary && turns >= maxTurns) {
      if (pauseOnTurnLimit) {
        status = "paused";
        continuation = {
          reason: "turn_limit",
          maxTurns,
          toolCallsExecuted,
        };
        summary = buildTurnLimitPauseSummary(maxTurns, toolCallsExecuted);
        onTurn?.(turns, "paused");
      } else {
        await finalizeWithoutTools({
          prompt: buildTurnLimitFinalizationPrompt(maxTurns, toolCallsExecuted),
          summaryPrefix: "已达到工具调用轮次上限，我先基于已有结果给出阶段性总结：",
          fallbackSummary: buildTurnLimitFallbackSummary(maxTurns, toolCallsExecuted),
        });
      }
    }
  } catch (error) {
    if (signal?.aborted) {
      status = "canceled";
      summary = "Agent loop canceled.";
    } else {
      status = "failed";
      summary = error instanceof Error ? error.message : "Agent loop failed.";
    }
  }

  return {
    summary,
    status,
    turns,
    messages,
    toolCallsExecuted,
    ...(continuation ? { continuation } : {}),
  };
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

function buildTurnLimitPauseSummary(
  maxTurns: number,
  toolCallsExecuted: number,
): string {
  return [
    `已到达长任务检查点（本轮 ${maxTurns} 轮，累计执行 ${toolCallsExecuted} 个工具）。`,
    "我已经暂停在当前上下文里，等待你确认下一步。",
    "回复“继续”会从已有工具结果接着执行；也可以告诉我调整方向或停止。",
  ].join("\n");
}

function buildTurnLimitFinalizationPrompt(
  maxTurns: number,
  toolCallsExecuted: number,
): string {
  return [
    `工具调用轮次已达到上限（${maxTurns} 轮，已执行 ${toolCallsExecuted} 个工具）。`,
    "现在不要再调用工具。",
    "请只基于当前对话和已有工具结果，用中文给用户一个简洁的阶段性总结。",
    "如果任务还没完成，请说明已完成什么、卡在哪里、建议用户如何缩小范围或继续下一步。",
  ].join("\n");
}

function buildTurnLimitFallbackSummary(
  maxTurns: number,
  toolCallsExecuted: number,
): string {
  return `已达到工具调用轮次上限（${maxTurns} 轮，已执行 ${toolCallsExecuted} 个工具）。请把任务拆小一点，或补充更明确的目标后重试。`;
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
