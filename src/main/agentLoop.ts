import type { AgentToolExecutor } from "./agentToolExecutor";
import type {
  ChatClient,
  ChatMessage,
  ToolCall,
} from "./openAiCompatibleClient";
import type { ToolAuthorizationService } from "./toolAuthorizationService";
import {
  buildAgentSystemPrompt,
  buildToolDefinitions,
  serializeToolObservation,
} from "../shared/agentProtocol";

export type AgentLoopOptions = {
  chatClient: ChatClient;
  toolExecutor: AgentToolExecutor;
  toolAuthorizationService?: ToolAuthorizationService;
  taskId?: string;
  systemPrompt?: string;
  maxTurns?: number;
  signal?: AbortSignal;
  tools?: ReturnType<typeof buildToolDefinitions>;
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
  onToolResult?: (toolName: string, ok: boolean) => void;
  onTurn?: (turn: number, phase: string) => void;
};

export type AgentLoopResult = {
  summary: string;
  status: "succeeded" | "failed" | "canceled";
  turns: number;
  messages: ChatMessage[];
  toolCallsExecuted: number;
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
    onToolCall,
    onToolResult,
    onTurn,
  } = options;

  const toolDefinitions = customTools ?? buildToolDefinitions();
  const messages: ChatMessage[] = [];

  // Add system prompt
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  } else {
    messages.push({
      role: "system",
      content: buildAgentSystemPrompt(),
    });
  }

  // Add initial messages
  messages.push(...initialMessages);

  let summary = "";
  let status: AgentLoopResult["status"] = "failed";
  let turns = 0;
  let toolCallsExecuted = 0;
  let lastExecutedToolSignature: string | null = null;

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

    try {
      const response = await chatClient.complete({
        ...modelProfile,
        messages,
        ...(signal ? { signal } : {}),
      });

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

      const response = await chatClient.complete({
        ...modelProfile,
        messages,
        tools: toolDefinitions,
        tool_choice: "auto",
        ...(signal ? { signal } : {}),
      });

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
            const auth = await toolAuthorizationService.authorize(taskId, {
              toolName: toolName as never,
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
              onToolResult?.(toolName, false);
              continue;
            }
          }

          onToolCall?.(toolName, args);

          // Execute tool
          const result = await toolExecutor.execute({
            toolName: toolName as never,
            args,
          });

          toolCallsExecuted += 1;
          lastExecutedToolSignature = signature;
          onToolResult?.(toolName, result.ok);

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: serializeToolObservation({
              tool: toolName as never,
              ok: result.ok,
              ...(result.ok
                ? { result: (result as { result: Record<string, unknown> }).result }
                : { error: (result as { error: string }).error }),
              toolCallId: toolCall.id,
            }),
          });
        }

        continue;
      }

      // No content and no tool calls
      summary = "Agent did not produce a response.";
      break;
    }

    if (!summary && turns >= maxTurns) {
      await finalizeWithoutTools({
        prompt: buildTurnLimitFinalizationPrompt(maxTurns, toolCallsExecuted),
        summaryPrefix: "已达到工具调用轮次上限，我先基于已有结果给出阶段性总结：",
        fallbackSummary: buildTurnLimitFallbackSummary(maxTurns, toolCallsExecuted),
      });
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
  };
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
