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

export type AgentPromptProfile =
  | "codex"
  | "claude"
  | "gemini"
  | "gpt"
  | "kimi"
  | "default";

export type AgentSystemPromptOptions = {
  modelId?: string;
  workspaceRoot?: string;
  currentDate?: string;
};

const supportedTools = new Set<AgentToolName>([
  "file_list",
  "file_stat",
  "file_search",
  "file_inventory",
  "file_move_plan",
  "file_apply_moves",
  "file_verify_moves",
  "file_rollback_moves",
  "file_read",
  "tool_result_read",
  "file_write",
  "chrome_bookmarks_read",
  "code_search",
  "git_status",
  "git_diff",
  "test_run",
  "memory_search",
  "conversation_search",
  "web_search",
  "web_fetch",
  "web_fetch_document",
  "citation_record",
  "citation_coverage_check",
  "markdown_report_write",
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
        name: "file_inventory",
        description:
          "批量读取目录清单和文件元信息，用于整理、迁移或审计前的预览。不修改文件。",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "要盘点的目录绝对路径",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "file_move_plan",
        description:
          "为本地目录整理生成可审核移动预览，不覆盖目标文件，不修改文件。",
        parameters: {
          type: "object",
          properties: {
            targetDir: {
              type: "string",
              description: "要整理的目录绝对路径",
            },
          },
          required: ["targetDir"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "file_apply_moves",
        description:
          "执行已经审核的本地文件移动计划。会先写事务日志，可用事务回滚。仅在用户确认预览后调用。",
        parameters: {
          type: "object",
          properties: {
            preview: {
              type: "object",
              description: "file_move_plan 返回的 preview 对象",
            },
          },
          required: ["preview"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "file_verify_moves",
        description: "验证本地文件移动事务的目标文件存在且源文件已移走。",
        parameters: {
          type: "object",
          properties: {
            transaction: {
              type: "object",
              description: "file_apply_moves 返回的 transaction 对象",
            },
          },
          required: ["transaction"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "file_rollback_moves",
        description:
          "按事务日志反向移动文件，回滚 file_apply_moves 的本地整理结果。仅在需要恢复时调用。",
        parameters: {
          type: "object",
          properties: {
            transaction: {
              type: "object",
              description: "file_apply_moves 返回的 transaction 对象",
            },
          },
          required: ["transaction"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "file_read",
        description:
          "读取指定文件的内容并返回文本。仅读取已授权的路径；不要用它读取 tool-result-refs 引用。",
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
        name: "tool_result_read",
        description:
          "读取工具返回的大型结果引用。当上一步结果包含 result_ref 或 tool-result-refs/... 时，使用此工具读取完整结果，不要改用 file_read。",
        parameters: {
          type: "object",
          properties: {
            ref: {
              type: "string",
              description: "工具结果引用，例如 tool-result-refs/run_call_file_list_ref.json",
            },
          },
          required: ["ref"],
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
        name: "chrome_bookmarks_read",
        description:
          "读取本机 Google Chrome 书签并返回结构化预览、统计和 Markdown 摘要；在 Goal 运行中会自动写入完整 artifact:bookmark_list / bookmark_list.md 和 artifact:goalEvidence / goalEvidence.md。用于 Chrome/浏览器书签任务；不要用 file_read 或 shell_exec 手动解析 Chrome Bookmarks JSON。",
        parameters: {
          type: "object",
          properties: {
            profile: {
              type: "string",
              description:
                "可选 Chrome profile 名称，例如 Default 或 Profile 1；省略时扫描所有包含 Bookmarks 文件的 profile",
            },
            chromeUserDataDir: {
              type: "string",
              description:
                "可选 Chrome 用户数据目录；默认使用当前系统的 Google Chrome 用户数据目录",
            },
            bookmarksPath: {
              type: "string",
              description:
                "可选：直接指定某个 Chrome Bookmarks JSON 文件路径，用于测试或非标准 profile",
            },
            maxBookmarks: {
              type: "number",
              description: "最多返回多少条书签明细，默认 5000，最大 10000",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "code_search",
        description:
          "在代码仓库中搜索文本，优先使用 ripgrep，自动跳过 node_modules/dist/release 等生成目录。代码诊断优先使用它，而不是 shell_exec。",
        parameters: {
          type: "object",
          properties: {
            workspaceRoot: {
              type: "string",
              description: "要搜索的仓库或工作区绝对路径",
            },
            query: {
              type: "string",
              description: "要搜索的代码文本",
            },
            maxResults: {
              type: "number",
              description: "最多返回结果数，默认 20，最大 100",
            },
          },
          required: ["workspaceRoot", "query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "git_status",
        description:
          "读取仓库分支和工作区改动摘要。代码工程任务需要了解改动面时优先使用它，而不是 shell_exec。",
        parameters: {
          type: "object",
          properties: {
            workspaceRoot: {
              type: "string",
              description: "Git 仓库工作区绝对路径",
            },
          },
          required: ["workspaceRoot"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "git_diff",
        description:
          "读取仓库 diff 和 numstat 摘要，可选择 staged diff。代码 review 或变更确认优先使用它，而不是 shell_exec。",
        parameters: {
          type: "object",
          properties: {
            workspaceRoot: {
              type: "string",
              description: "Git 仓库工作区绝对路径",
            },
            staged: {
              type: "boolean",
              description: "是否读取 staged/cached diff，默认 false",
            },
          },
          required: ["workspaceRoot"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "test_run",
        description:
          "在工作区运行已授权的测试命令，返回 stdout/stderr/exitCode，并支持超时与中断。验证代码改动优先使用它，而不是 shell_exec。",
        parameters: {
          type: "object",
          properties: {
            workspaceRoot: {
              type: "string",
              description: "运行测试命令的工作区绝对路径",
            },
            command: {
              type: "string",
              description: "要运行的测试命令",
            },
            timeoutMs: {
              type: "number",
              description: "可选超时时间，范围 1000-600000 ms，默认 120000 ms",
            },
          },
          required: ["workspaceRoot", "command"],
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
        name: "web_fetch_document",
        description:
          "抓取指定 URL 并返回适合研究写作的规范化文档和引用种子。需要任务授权对应域名的 web.fetchDomains 权限。",
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
        name: "citation_record",
        description:
          "把来源 URL、标题和摘录记录为结构化 citation evidence。报告正文应引用 citation id，而不是把证据混入自由文本。",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "可选 citation id；省略时由 URL 生成稳定 id",
            },
            url: { type: "string", description: "来源 URL" },
            title: { type: "string", description: "来源标题" },
            quote: { type: "string", description: "支持该结论的短摘录" },
            note: { type: "string", description: "可选审计备注" },
            accessedAt: {
              type: "string",
              description: "可选 ISO 时间；省略时由运行时生成",
            },
          },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "citation_coverage_check",
        description:
          "检查 claims 中每个 sourced_fact 是否引用了已知 citation；model_inference 会被单独统计但不要求 citation。",
        parameters: {
          type: "object",
          properties: {
            citations: {
              type: "array",
              description: "citation_record 产生的 citation 数组",
            },
            claims: {
              type: "array",
              description:
                "研究结论数组，每项包含 id、kind、text、citationIds",
            },
          },
          required: ["citations", "claims"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "markdown_report_write",
        description:
          "写入 citation-backed Markdown 报告，并在相邻位置写入 .citations.json 证据 sidecar。若 sourced_fact 缺少有效引用会拒绝写入。",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "要写入的 Markdown 绝对路径" },
            title: { type: "string", description: "报告标题" },
            generatedAt: {
              type: "string",
              description: "可选 ISO 时间；省略时由运行时生成",
            },
            citations: {
              type: "array",
              description: "结构化 citation 数组，会写入 sidecar",
            },
            claims: {
              type: "array",
              description:
                "结论数组。sourced_fact 必须包含 citationIds，model_inference 会在摘要中单列。",
            },
            sections: {
              type: "array",
              description: "正文 section 数组，每项包含 heading 和 claimIds",
            },
          },
          required: ["path", "title", "citations", "claims", "sections"],
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

export function buildAgentSystemPrompt(
  options: AgentSystemPromptOptions = {},
): string {
  const profile = selectAgentPromptProfile(options.modelId);
  return [
    "你是一个本地桌面 AI agent 的运行时核心。",
    "你可以调用工具来完成任务：列出目录、读取元信息、搜索文件、读写文件、读取大型工具结果引用、读取 Chrome 书签、搜索代码、读取 git 状态和 diff、运行已授权测试、检索本地记忆、搜索网页、抓取网页内容、记录引用、写 citation-backed Markdown 报告、执行受权 shell 命令。",
    "",
    "运行环境：",
    `- Model profile: ${profile}`,
    ...(options.modelId ? [`- Model ID: ${options.modelId}`] : []),
    ...(options.workspaceRoot ? [`- Workspace root: ${options.workspaceRoot}`] : []),
    ...(options.currentDate ? [`- Current date: ${options.currentDate}`] : []),
    "",
    "模型适配：",
    ...buildModelProfileGuidance(profile),
    "",
    "工作原则：",
    "- 文件诊断优先使用 file_list、file_stat、file_search、file_read；本地文件整理优先使用 file_inventory、file_move_plan、file_apply_moves、file_verify_moves；只有原生工具无法完成时再使用 shell_exec。",
    "- Chrome/浏览器书签读取必须优先使用 chrome_bookmarks_read；它会自动产出完整 artifact:bookmark_list 和 artifact:goalEvidence，不要用 file_read/file_stat/shell_exec 读取或解析 Chrome Bookmarks。",
    "- 当工具结果包含 result_ref 或 tool-result-refs/... 时，必须使用 tool_result_read 读取完整工具结果，不要把引用路径传给 file_read。",
    "- 代码工程优先使用 code_search、git_status、git_diff、test_run；只有这些原生工具无法完成时再申请 shell_exec。",
    "- 研究写作优先使用 web_fetch_document、citation_record、citation_coverage_check、markdown_report_write；报告摘要必须区分 sourced facts 和 model inference。",
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

export function selectAgentPromptProfile(modelId: string | undefined): AgentPromptProfile {
  const normalized = modelId?.toLowerCase() ?? "";
  if (normalized.includes("codex")) return "codex";
  if (normalized.includes("claude")) return "claude";
  if (normalized.includes("gemini")) return "gemini";
  if (normalized.includes("kimi")) return "kimi";
  if (
    normalized.includes("gpt") ||
    normalized.includes("o1") ||
    normalized.includes("o3") ||
    normalized.includes("o4")
  ) {
    return "gpt";
  }
  return "default";
}

function buildModelProfileGuidance(profile: AgentPromptProfile): string[] {
  switch (profile) {
    case "codex":
      return [
        "- Codex profile: stay concise, tool-first, and verification-driven.",
        "- Prefer small scoped edits and fresh command evidence before reporting completion.",
      ];
    case "claude":
      return [
        "- Claude profile: use independent review for non-trivial conclusions.",
        "- Maintain file discipline: avoid creating files unless necessary for the task.",
      ];
    case "gemini":
      return [
        "- Gemini profile: keep tool arguments explicit and restate constraints before risky actions.",
      ];
    case "gpt":
      return [
        "- GPT profile: keep plans structured, avoid premature final answers, and verify before stopping.",
      ];
    case "kimi":
      return [
        "- Kimi profile: keep instructions compact and prioritize direct tool observations.",
      ];
    case "default":
      return [
        "- Default profile: follow the shared local-first harness rules and ask for evidence when uncertain.",
      ];
  }
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
