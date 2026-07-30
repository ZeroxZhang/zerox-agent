import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
  type BedrockRuntimeClientConfig,
} from "@aws-sdk/client-bedrock-runtime";
import { fromIni } from "@aws-sdk/credential-providers";
import { estimateTextTokens } from "../contextManager";
import { buildCachePrefix } from "./cachePrefix";
import type {
  CompleteRequest,
  CompleteResponse,
  LLMProvider,
  NormalizedContent,
  NormalizedMessage,
  ProviderCapabilities,
  ProviderId,
  StreamEvent,
  ToolDefinition,
} from "./provider";

const capabilities: ProviderCapabilities = {
  toolUse: true,
  thinking: true,
  vision: true,
  promptCache: false,
  streamingToolCalls: false,
};

export type BedrockProviderOptions = {
  region: string;
  authMethod?: "api_key" | "profile" | "iam";
  bedrockApiKey?: string;
  awsProfile?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsSessionToken?: string;
  client?: Pick<BedrockRuntimeClient, "send">;
};

export function createBedrockProvider(
  options: BedrockProviderOptions,
): LLMProvider {
  const client = options.client ?? new BedrockRuntimeClient(buildClientConfig(options));

  return {
    id: "bedrock" as ProviderId,
    capabilities,

    async complete(req) {
      const { family, modelId } = splitFamily(req.model);
      if (family === "claude") {
        return completeClaude(client, modelId, req);
      }
      return completeConverse(client, modelId, req);
    },

    async *stream(req): AsyncIterable<StreamEvent> {
      const response = await this.complete(req);
      if (response.reasoningContent) {
        yield { type: "thinking_delta", text: response.reasoningContent };
      }
      if (response.content) {
        yield { type: "text_delta", text: response.content };
      }
      for (const toolCall of response.toolCalls) {
        yield {
          type: "tool_call_delta",
          toolCallId: toolCall.id,
          name: toolCall.function.name,
          argumentsDelta: toolCall.function.arguments,
        };
      }
      yield { type: "done", response };
    },

    async countTokens(messages, opts?) {
      return heuristicCount(messages, opts?.system, opts?.tools);
    },

    buildCachePrefix(messages, opts?) {
      return buildCachePrefix(messages, opts);
    },
  };
}

function buildClientConfig(
  options: BedrockProviderOptions,
): BedrockRuntimeClientConfig {
  const config: BedrockRuntimeClientConfig = {
    region: options.region || "us-east-1",
  };
  if (options.authMethod === "api_key" && options.bedrockApiKey) {
    config.token = { token: options.bedrockApiKey };
  } else if (
    options.authMethod === "iam" &&
    options.awsAccessKeyId &&
    options.awsSecretAccessKey
  ) {
    config.credentials = {
      accessKeyId: options.awsAccessKeyId,
      secretAccessKey: options.awsSecretAccessKey,
      ...(options.awsSessionToken
        ? { sessionToken: options.awsSessionToken }
        : {}),
    };
  } else if (options.authMethod === "profile" && options.awsProfile) {
    config.credentials = fromIni({ profile: options.awsProfile });
  }
  return config;
}

async function completeClaude(
  client: Pick<BedrockRuntimeClient, "send">,
  modelId: string,
  req: CompleteRequest,
): Promise<CompleteResponse> {
  const { system, messages } = toAnthropicMessages(req.messages);
  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: req.maxTokens,
    temperature: req.temperature,
    system,
    messages,
    ...(req.tools?.length
      ? {
          tools: req.tools.map((tool) => ({
            name: tool.function.name,
            description: tool.function.description,
            input_schema: tool.function.parameters,
          })),
        }
      : {}),
    ...(req.thinking?.type === "enabled"
      ? {
          thinking: {
            type: "enabled",
            budget_tokens: req.thinking.budgetTokens ?? 4096,
          },
        }
      : {}),
  };
  const output = await client.send(
    new InvokeModelCommand({
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body: new TextEncoder().encode(JSON.stringify(body)),
    }),
    req.signal ? { abortSignal: req.signal } : undefined,
  );
  const json = JSON.parse(
    new TextDecoder().decode(output.body),
  ) as Record<string, unknown>;
  return parseAnthropicResponse(json);
}

async function completeConverse(
  client: Pick<BedrockRuntimeClient, "send">,
  modelId: string,
  req: CompleteRequest,
): Promise<CompleteResponse> {
  const { system, messages } = toConverseMessages(req.messages);
  const response = await client.send(
    new ConverseCommand({
      modelId,
      system: system.map((text) => ({ text })),
      messages: messages as never,
      inferenceConfig: {
        temperature: req.temperature,
        maxTokens: req.maxTokens,
      },
      ...(req.tools?.length
        ? {
            toolConfig: {
              tools: req.tools.map((tool) => ({
                toolSpec: {
                  name: tool.function.name,
                  description: tool.function.description,
                  inputSchema: { json: tool.function.parameters as never },
                },
              })),
            },
          }
        : {}),
    }),
    req.signal ? { abortSignal: req.signal } : undefined,
  );

  const content =
    (response.output as { message?: { content?: unknown[] } } | undefined)
      ?.message?.content ?? [];
  let text = "";
  let reasoningContent = "";
  const toolCalls: CompleteResponse["toolCalls"] = [];
  for (const block of content) {
    const candidate = block as {
      text?: string;
      reasoningContent?: { reasoningText?: { text?: string } };
      toolUse?: { toolUseId?: string; name?: string; input?: unknown };
    };
    if (candidate.text) {
      text += candidate.text;
    }
    if (candidate.reasoningContent?.reasoningText?.text) {
      reasoningContent += candidate.reasoningContent.reasoningText.text;
    }
    if (candidate.toolUse?.name) {
      toolCalls.push({
        id: candidate.toolUse.toolUseId ?? candidate.toolUse.name,
        type: "function",
        function: {
          name: candidate.toolUse.name,
          arguments: JSON.stringify(candidate.toolUse.input ?? {}),
        },
      });
    }
  }
  return {
    content: text || null,
    toolCalls,
    finishReason: response.stopReason ?? "end_turn",
    ...(reasoningContent ? { reasoningContent } : {}),
    cacheReadTokens: response.usage?.cacheReadInputTokens ?? 0,
    cacheWriteTokens: response.usage?.cacheWriteInputTokens ?? 0,
    ...(response.usage
      ? {
          usage: {
            inputTokens: response.usage.inputTokens ?? 0,
            outputTokens: response.usage.outputTokens ?? 0,
          },
        }
      : {}),
  };
}

function splitFamily(model: string): { family: string; modelId: string } {
  const separator = model.indexOf("/");
  if (separator < 0) {
    return { family: "other", modelId: model };
  }
  return {
    family: model.slice(0, separator),
    modelId: model.slice(separator + 1),
  };
}

function toAnthropicMessages(messages: NormalizedMessage[]): {
  system: string;
  messages: unknown[];
} {
  let system = "";
  const output: unknown[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      system += `${system ? "\n\n" : ""}${message.content}`;
      continue;
    }
    if (message.role === "tool") {
      output.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.toolCallId,
            content: message.content,
          },
        ],
      });
      continue;
    }
    output.push({
      role: message.role,
      content: message.content.map(toAnthropicBlock),
    });
  }
  return { system, messages: output };
}

function toAnthropicBlock(content: NormalizedContent): Record<string, unknown> {
  switch (content.type) {
    case "text":
      return { type: "text", text: content.text };
    case "thinking":
      return { type: "thinking", thinking: content.text };
    case "tool_use":
      return {
        type: "tool_use",
        id: content.id,
        name: content.name,
        input: content.input,
      };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: content.toolUseId,
        content: content.content,
      };
    case "image":
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: content.mediaType,
          data: content.data,
        },
      };
  }
}

function toConverseMessages(messages: NormalizedMessage[]): {
  system: string[];
  messages: unknown[];
} {
  const system: string[] = [];
  const output: unknown[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      system.push(message.content);
      continue;
    }
    if (message.role === "tool") {
      output.push({
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: message.toolCallId,
              content: [{ text: message.content }],
            },
          },
        ],
      });
      continue;
    }
    output.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content.map(toConverseBlock),
    });
  }
  return { system, messages: output };
}

function toConverseBlock(content: NormalizedContent): Record<string, unknown> {
  switch (content.type) {
    case "text":
    case "thinking":
      return { text: content.text };
    case "tool_use":
      return {
        toolUse: {
          toolUseId: content.id,
          name: content.name,
          input: content.input,
        },
      };
    case "tool_result":
      return {
        toolResult: {
          toolUseId: content.toolUseId,
          content: [{ text: content.content }],
        },
      };
    case "image": {
      const format = content.mediaType.split("/")[1] || "png";
      return {
        image: {
          format,
          source: { bytes: Buffer.from(content.data, "base64") },
        },
      };
    }
  }
}

function parseAnthropicResponse(
  json: Record<string, unknown>,
): CompleteResponse {
  const blocks = Array.isArray(json.content) ? json.content : [];
  let text = "";
  let reasoningContent = "";
  const toolCalls: CompleteResponse["toolCalls"] = [];
  for (const block of blocks) {
    const candidate = block as {
      type?: string;
      text?: string;
      thinking?: string;
      id?: string;
      name?: string;
      input?: unknown;
    };
    if (candidate.type === "text" && candidate.text) {
      text += candidate.text;
    }
    if (candidate.type === "thinking" && candidate.thinking) {
      reasoningContent += candidate.thinking;
    }
    if (candidate.type === "tool_use" && candidate.name) {
      toolCalls.push({
        id: candidate.id ?? candidate.name,
        type: "function",
        function: {
          name: candidate.name,
          arguments: JSON.stringify(candidate.input ?? {}),
        },
      });
    }
  }
  const usage = json.usage as
    | {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      }
    | undefined;
  return {
    content: text || null,
    toolCalls,
    finishReason: String(json.stop_reason ?? "end_turn"),
    ...(reasoningContent ? { reasoningContent } : {}),
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
    ...(usage
      ? {
          usage: {
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
          },
        }
      : {}),
  };
}

function heuristicCount(
  messages: NormalizedMessage[],
  system?: string,
  tools?: ToolDefinition[],
): number {
  return estimateTextTokens(
    [
      system ?? "",
      JSON.stringify(messages),
      JSON.stringify(tools ?? []),
    ].join("\n"),
  );
}
