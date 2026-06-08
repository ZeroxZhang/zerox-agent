import type { ToolDefinition } from "../main/openAiCompatibleClient";
import type { AgentToolName } from "./toolPermissions";
import type { ExecutionPlan, ExecutionStep, AgentPhase } from "./agentRuns";

export type AgentModelToolCall = {
  type: "tool_call";
  tool: AgentToolName;
  args: Record<string, unknown>;
};

export type AgentModelFinal = {
  type: "final";
  message: string;
};

export type AgentModelMessage = AgentModelToolCall | AgentModelFinal;

export type ParseAgentModelResponseResult =
  | { ok: true; message: AgentModelMessage }
  | { ok: false; message: string };

export type ToolObservation = {
  tool: AgentToolName;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
  errorDetails?: Record<string, unknown>;
  toolCallId?: string;
};

const supportedTools = new Set<AgentToolName>([
  "file_list",
  "file_stat",
  "file_search",
  "file_read",
  "file_write",
  "memory_search",
  "conversation_search",
  "web_search",
  "web_fetch",
  "shell_exec",
]);

export function buildToolDefinitions(): ToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "file_list",
        description:
          "列出指定目录下的文件和子目录。使用此工具前先了解目录结构。",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "要列出的目录的绝对路径，例如 /Users/name/Documents 或 ~/Downloads",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "file_stat",
        description:
          "读取文件或目录的元信息（类型、大小、修改时间），不读取文件内容。适合先判断路径是否存在、文件大小和类型。",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "要检查的文件或目录绝对路径",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "file_search",
        description:
          "在目录内搜索文件名或小文本文件内容，避免为 find/grep 这类简单检索调用 shell。默认跳过大型文件和常见依赖目录。",
        parameters: {
          type: "object",
          properties: {
            root: {
              type: "string",
              description: "要搜索的目录绝对路径",
            },
            query: {
              type: "string",
              description: "要匹配的关键词",
            },
            mode: {
              type: "string",
              enum: ["name", "content", "both"],
              description: "搜索模式，默认 both",
            },
            maxResults: {
              type: "number",
              description: "最多返回结果数，默认 20，最大 100",
            },
          },
          required: ["root", "query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "file_read",
        description:
          "读取指定文件的内容并返回文本。仅读取已授权的路径。",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "要读取的文件的绝对路径",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "file_write",
        description:
          "将内容写入指定文件。如果目录不存在则自动创建。仅写入已授权的路径。",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "要写入的文件的绝对路径",
            },
            content: {
              type: "string",
              description: "要写入的文件内容",
            },
          },
          required: ["path", "content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "memory_search",
        description:
          "检索长期记忆（core/session/semantic/episodic/procedural）。只返回裁剪后的摘要，用于补充上下文。",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "要检索的关键词或问题",
            },
            kind: {
              type: "string",
              description:
                "可选记忆类型：all/core/session/semantic/episodic/procedural",
            },
            limit: {
              type: "number",
              description: "最多返回几条，默认 5，最大 10",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "conversation_search",
        description:
          "检索原始聊天消息证据。适合查找用户曾经说过的话或某次会话中的原始上下文。",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "要检索的关键词或问题",
            },
            sessionId: {
              type: "string",
              description: "可选：限制在某个会话内搜索",
            },
            limit: {
              type: "number",
              description: "最多返回几条，默认 5，最大 10",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "web_search",
        description:
          "使用 DuckDuckGo 搜索网页并返回结果列表（标题、URL、摘要）。需要任务授权 web.search 权限。",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "搜索关键词",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "web_fetch",
        description:
          "抓取指定 URL 的网页内容并返回文本。需要任务授权对应域名的 web.fetchDomains 权限。",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "要抓取的完整 URL，必须以 http:// 或 https:// 开头",
            },
          },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "shell_exec",
        description:
          "执行 shell 命令。默认超时 120 秒，可用 timeoutMs 为明确的长命令申请 25-600000 ms。仅允许执行已授权模板匹配的命令。优先使用 file_stat/file_search/file_read 等原生工具完成文件诊断。",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "要执行的完整 shell 命令",
            },
            timeoutMs: {
              type: "number",
              description: "可选超时时间，范围 25-600000 ms，默认 120000 ms",
            },
          },
          required: ["command"],
        },
      },
    },
  ];
}

export function buildAgentSystemPrompt(): string {
  return [
    "你是一个本地桌面 AI agent 的运行时核心。",
    "你可以调用工具来完成任务：列出目录、读取元信息、搜索文件、读写文件、检索本地记忆、搜索网页、抓取网页内容、执行受权 shell 命令。",
    "",
    "工作原则：",
    "- 文件诊断优先使用 file_list、file_stat、file_search、file_read；只有原生工具无法完成时再使用 shell_exec。",
    "- 将复杂任务分解为清晰的步骤序列。",
    "- 每个工具调用返回结果后，分析结果再决定下一步。",
    "- 如果工具返回错误，先分析原因，尝试调整参数或方法。",
    "- memory_search 和 conversation_search 只用于按需回忆；每轮最多调用 3 次，避免把记忆检索当成循环动作。",
    "- 任务完成后给出结构清晰的中文摘要。",
    "",
    "输出语言：默认使用中文输出最终消息、报告正文和用户可见摘要。",
    "只有任务输入明确要求其他语言时才切换。",
  ].join("\n");
}

export function buildPlanningPrompt(
  taskName: string,
  skillDescription: string,
  skillBody: string,
  availableTools: string[],
): string {
  return [
    "你需要为以下任务制定执行计划。",
    "",
    `任务名称：${taskName}`,
    `技能描述：${skillDescription}`,
    "",
    "技能指令：",
    skillBody,
    "",
    `可用工具：${availableTools.join("、")}`,
    "",
    "请返回一个 JSON 格式的执行计划：",
    '{',
    '  "steps": [',
    '    {',
    '      "description": "第一步要做什么",',
    '      "expectedTool": "可能用到的工具名称或 null",',
    '      "expectedOutcome": "这一步预期的产出"',
    '    }',
    '  ],',
    '  "reasoning": "为什么这样规划"',
    '}',
    "",
    "要求：",
    "- 步骤数量适中（通常 2-7 步）",
    "- 仅使用可用工具列表中的工具",
    "- 每步有明确的、可验证的产出",
    "- 考虑步骤之间的依赖关系",
    "",
    "只返回 JSON，不要额外解释。",
  ].join("\n");
}

export function buildReflectionPrompt(
  failedStep: string,
  errorMessage: string,
  previousSteps: string,
): string {
  return [
    "任务执行中有一个步骤失败了。请分析原因并建议下一步行动。",
    "",
    `失败的步骤：${failedStep}`,
    `错误信息：${errorMessage}`,
    "",
    previousSteps ? `之前已完成的步骤：\n${previousSteps}` : "",
    "",
    "请返回一个 JSON 格式的决策：",
    '{',
    '  "analysis": "失败原因分析",',
    '  "suggestion": "retry 或 skip 或 abort",',
    '  "adjustedApproach": "如果建议 retry，描述调整后的方法"',
    '}',
    "",
    "- retry：调整方法后重新执行这一步",
    "- skip：这一步可以跳过，继续后续步骤",
    "- abort：无法修复，终止任务",
    "",
    "只返回 JSON，不要额外解释。",
  ].join("\n");
}

export function buildPlanVerificationPrompt(planText: string): string {
  return [
    "验证以下执行计划是否合理：",
    planText,
    "",
    "返回 JSON：",
    '{ "valid": true/false, "issues": ["问题描述"] }',
  ].join("\n");
}

export function parsePlanFromResponse(content: string): ExecutionPlan | null {
  try {
    const parsed = JSON.parse(content) as {
      steps?: Array<{
        description?: string;
        expectedTool?: string | null;
        expectedOutcome?: string;
      }>;
      reasoning?: string;
    };

    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      return null;
    }

    const steps: ExecutionStep[] = parsed.steps.map((step) => ({
      description: String(step.description ?? ""),
      expectedTool: isSupportedToolName(step.expectedTool)
        ? step.expectedTool
        : undefined,
      expectedOutcome: String(step.expectedOutcome ?? ""),
      status: "pending" as const,
    }));

    if (steps.some((step) => !step.description)) {
      return null;
    }

    return {
      steps,
      estimatedTurns: steps.length * 2 + 3,
      reasoning: String(parsed.reasoning ?? ""),
    };
  } catch {
    return null;
  }
}

export function parseReflectionFromResponse(
  content: string,
): { analysis: string; suggestion: "retry" | "skip" | "abort"; adjustedApproach: string } | null {
  try {
    const parsed = JSON.parse(content) as {
      analysis?: string;
      suggestion?: string;
      adjustedApproach?: string;
    };

    const suggestion = normalizeSuggestion(parsed.suggestion);
    if (!suggestion) return null;

    return {
      analysis: String(parsed.analysis ?? ""),
      suggestion,
      adjustedApproach: String(parsed.adjustedApproach ?? ""),
    };
  } catch {
    return null;
  }
}

function normalizeSuggestion(
  value: string | undefined,
): "retry" | "skip" | "abort" | null {
  if (value === "retry" || value === "skip" || value === "abort") {
    return value;
  }
  return null;
}

export function parseAgentModelResponse(
  content: string,
): ParseAgentModelResponseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, message: "模型回复必须是有效的 JSON。" };
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return { ok: false, message: "模型回复必须包含 type 字段。" };
  }

  if (parsed.type === "final") {
    if (typeof parsed.message !== "string" || !parsed.message.trim()) {
      return { ok: false, message: "最终回复必须包含 message 字段。" };
    }

    return {
      ok: true,
      message: { type: "final", message: parsed.message },
    };
  }

  if (parsed.type === "tool_call") {
    if (!isSupportedTool(parsed.tool)) {
      return { ok: false, message: "模型请求了不支持的工具。" };
    }

    if (!isRecord(parsed.args)) {
      return { ok: false, message: "工具调用参数必须是 JSON 对象。" };
    }

    return {
      ok: true,
      message: {
        type: "tool_call",
        tool: parsed.tool,
        args: parsed.args,
      },
    };
  }

  return { ok: false, message: "模型回复类型暂不支持。" };
}

export function serializeToolObservation(
  observation: ToolObservation,
): string {
  return JSON.stringify({
    type: "tool_result",
    tool: observation.tool,
    ok: observation.ok,
    ...(observation.result ? { result: observation.result } : {}),
    ...(observation.error ? { error: observation.error } : {}),
    ...(observation.errorDetails
      ? { error_details: observation.errorDetails }
      : {}),
    ...(observation.toolCallId ? { tool_call_id: observation.toolCallId } : {}),
  });
}

export function buildTaskPrompt(
  task: { name: string; input: Record<string, unknown> },
  skill: { manifest: { displayName: string; description: string }; body: string },
): string {
  return [
    `任务名称：${task.name}`,
    `技能：${skill.manifest.displayName}`,
    `技能描述：${skill.manifest.description}`,
    "",
    "技能指令：",
    skill.body,
    "",
    "任务输入：",
    JSON.stringify(task.input, null, 2),
  ].join("\n");
}

export function isSupportedToolName(value: unknown): value is AgentToolName {
  return typeof value === "string" && supportedTools.has(value as AgentToolName);
}

function isSupportedTool(value: unknown): value is AgentToolName {
  return typeof value === "string" && supportedTools.has(value as AgentToolName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
