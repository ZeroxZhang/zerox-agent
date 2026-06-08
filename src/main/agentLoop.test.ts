import { describe, expect, it } from "vitest";
import { runAgentLoop } from "./agentLoop";
import type { AgentToolExecutor } from "./agentToolExecutor";
import type {
  ChatClient,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ToolDefinition,
} from "./openAiCompatibleClient";

const modelProfile = {
  baseUrl: "https://api.example.com/v1",
  apiKey: "secret",
  model: "agent-model",
  temperature: 0.2,
  maxTokens: 8192,
};

const testTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "file_list",
      description: "List files",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
];

describe("agent loop", () => {
  it("finalizes instead of executing a repeated identical tool call", async () => {
    const requests: ChatCompletionRequest[] = [];
    const chatClient: ChatClient = {
      async complete(request) {
        requests.push(request);
        if (requests.length <= 2) {
          return toolCallResponse(`tool_call_${requests.length}`);
        }

        expect(request.tools).toBeUndefined();
        expect(request.messages.at(-1)).toMatchObject({
          role: "system",
          content: expect.stringContaining("检测到模型重复请求相同工具"),
        });
        return {
          content: "我已经基于第一次目录结果完成总结。",
          toolCalls: [],
          finishReason: "stop",
        };
      },
    };
    let executions = 0;

    const result = await runAgentLoop(
      [{ role: "user", content: "检查这个目录并告诉我结果" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(() => {
          executions += 1;
        }),
        maxTurns: 6,
        tools: testTools,
      },
    );

    expect(requests).toHaveLength(3);
    expect(executions).toBe(1);
    expect(result).toMatchObject({
      status: "succeeded",
      summary:
        "检测到模型重复请求相同工具，我先基于已有结果给出阶段性总结：\n\n我已经基于第一次目录结果完成总结。",
      turns: 1,
      toolCallsExecuted: 1,
    });
  });

  it("asks the model for a final no-tool summary when tool turns reach the limit", async () => {
    const requests: ChatCompletionRequest[] = [];
    const chatClient: ChatClient = {
      async complete(request) {
        requests.push(request);
        if (requests.length <= 2) {
          return toolCallResponse(
            `tool_call_${requests.length}`,
            `/tmp/path_${requests.length}`,
          );
        }

        expect(request.tools).toBeUndefined();
        expect(request.messages.at(-1)).toMatchObject({
          role: "system",
          content: expect.stringContaining("工具调用轮次已达到上限"),
        });
        return {
          content: "我已经检查了已有结果，建议把任务拆成更小步骤继续。",
          toolCalls: [],
          finishReason: "stop",
        };
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "检查这个目录并告诉我结果" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(),
        maxTurns: 2,
        tools: testTools,
      },
    );

    expect(requests).toHaveLength(3);
    expect(result).toMatchObject({
      status: "succeeded",
      summary:
        "已达到工具调用轮次上限，我先基于已有结果给出阶段性总结：\n\n我已经检查了已有结果，建议把任务拆成更小步骤继续。",
      turns: 2,
      toolCallsExecuted: 2,
    });
  });
});

function toolCallResponse(id: string, path = "/tmp"): ChatCompletionResponse {
  return {
    content: null,
    finishReason: "tool_calls",
    toolCalls: [
      {
        id,
        type: "function",
        function: {
          name: "file_list",
          arguments: JSON.stringify({ path }),
        },
      },
    ],
  };
}

function createToolExecutor(onExecute?: () => void): AgentToolExecutor {
  return {
    async execute() {
      onExecute?.();
      return {
        ok: true,
        result: { files: ["a.txt", "b.txt"] },
      };
    },
    getRegistry() {
      throw new Error("not used");
    },
    hasTool() {
      return true;
    },
  };
}
