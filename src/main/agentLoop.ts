import type { AgentToolExecutor } from "./agentToolExecutor";
import { createContextManager, type ContextManager } from "./contextManager";
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
import type { ToolAuthorizationService } from "./toolAuthorizationService";
import {
  buildAgentSystemPrompt,
  buildToolDefinitions,
  serializeToolObservation,
} from "../shared/agentProtocol";
import { serializeToolObservationWithOffload } from "./toolObservationOffload";
import type { ToolResultOffloadStore } from "./toolResultOffloadStore";

export type AgentLoopOptions = {
  chatClient: ChatClient;
  toolExecutor: AgentToolExecutor;
  toolAuthorizationService?: ToolAuthorizationService;
  taskId?: string;
  systemPrompt?: string;
  maxTurns?: number;
  signal?: AbortSignal;
  tools?: ReturnType<typeof buildToolDefinitions>;
  toolResultOffloadStore?: ToolResultOffloadStore;
  toolResultOffloadThreshold?: number;
  pauseOnTurnLimit?: boolean;
  resumeMessages?: ChatMessage[];
  initialToolCallsExecuted?: number;
  pauseOnFailureLoop?: boolean;
  contextManager?: ContextManager;
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
};

export type AgentLoopContextCompaction = {
  originalMessageCount: number;
  compactedMessageCount: number;
  estimatedTokens: number;
  tokenBudget: number;
};

export type AgentLoopContinuation = {
  reason: "turn_limit" | "tool_failure_loop";
  maxTurns: number;
  toolCallsExecuted: number;
  toolName?: string;
  failureKind?: string;
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
    systemPrompt,
    maxTurns = 4,
    signal,
    tools: customTools,
    toolResultOffloadStore,
    toolResultOffloadThreshold,
    pauseOnTurnLimit = false,
    resumeMessages,
    initialToolCallsExecuted = 0,
    pauseOnFailureLoop = false,
    contextManager = createContextManager(),
    modelRetry,
    onToolCall,
    onToolResult,
    onTurn,
    onReasoning,
    onModelResponse,
    onContextCompacted,
    onModelRetry,
  } = options;

  const toolDefinitions = customTools ?? buildToolDefinitions();
  const messages: ChatMessage[] = resumeMessages ? [...resumeMessages] : [];

  if (!resumeMessages) {
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    } else {
      messages.push({
        role: "system",
        content: buildAgentSystemPrompt(),
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
  const contextTokenBudget = Math.max(1, Math.floor(modelProfile.maxTokens * 0.7));

  function compactMessagesBeforeModelRequest() {
    const estimatedTokens = contextManager.estimateTokens(messages);
    if (estimatedTokens <= contextTokenBudget) {
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

    messages.splice(0, messages.length, ...compacted);
    onContextCompacted?.({
      originalMessageCount,
      compactedMessageCount: messages.length,
      estimatedTokens,
      tokenBudget: contextTokenBudget,
    });
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
    compactMessagesBeforeModelRequest();

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

  try {
    for (; turns < maxTurns; turns += 1) {
      if (signal?.aborted) {
        status = "canceled";
        summary = "Agent loop canceled.";
        break;
      }

      onTurn?.(turns, "executing");
      compactMessagesBeforeModelRequest();

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

          const args = preparedToolCall.args;

          // Authorization check (if authorizer is available)
          if (toolAuthorizationService && taskId) {
            const toolSource = getToolSource(toolExecutor, toolName);
            const auth = await toolAuthorizationService.authorize(taskId, {
              toolName: toolName as never,
              ...(toolSource ? { source: toolSource } : {}),
              args,
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
          });

          toolCallsExecuted += 1;
          lastExecutedToolSignature = signature;
          onToolResult?.(toolName, result.ok, result);
          const failureLoop = updateToolFailureStreak(
            toolFailureStreak,
            toolName,
            result,
          );
          toolFailureStreak = failureLoop.streak;

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

          if (
            pauseOnFailureLoop &&
            failureLoop.shouldPause &&
            !result.ok
          ) {
            const failureKind = failureLoop.streak?.kind ?? "unknown";
            status = "paused";
            continuation = {
              reason: "tool_failure_loop",
              maxTurns,
              toolCallsExecuted,
              toolName,
              failureKind,
            };
            summary = buildToolFailureLoopPauseSummary({
              toolName,
              failureKind,
              toolCallsExecuted,
              count: failureLoop.streak?.count ?? 3,
            });
            break;
          }
        }

        if (status === "paused") {
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
  toolCallsExecuted: number;
  count: number;
}): string {
  return [
    `连续 ${options.count} 次工具失败（${options.toolName}，${options.failureKind}）。`,
    `我已经暂停，避免继续在同一个失败模式里空转。累计执行 ${options.toolCallsExecuted} 个工具。`,
    "你可以回复“继续”让我带着已有诊断接着试，也可以调整目标、提供脚本参数或要求我换一种工具路径。",
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
  if (/中断|cancel|abort/i.test(result.error)) return "canceled";
  if (/stdout\/stderr|no stdout|no stderr|无 stdout/i.test(result.error)) {
    return "empty_exit";
  }
  return "tool_error";
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
