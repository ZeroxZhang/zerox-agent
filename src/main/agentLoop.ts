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
        // Add assistant message with tool calls
        messages.push({
          role: "assistant",
          content: response.content ?? "",
          tool_calls: response.toolCalls,
        });

        // Process each tool call
        for (const toolCall of response.toolCalls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(
              toolCall.function.arguments,
            ) as Record<string, unknown>;
          } catch {
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

          const toolName = toolCall.function.name;

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
      summary = "Agent loop reached maximum turns.";
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
