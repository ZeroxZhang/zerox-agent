import { exec } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ChatSessionStore } from "./chatSessionStore";
import { createWebTools, type WebTools } from "./webTools";
import { createDynamicToolRegistry, type DynamicToolRegistry } from "./dynamicToolRegistry";
import { searchCode } from "./nativeCodeTools";
import { readGitDiff, readGitStatus } from "./nativeGitTools";
import { createNativeResearchTools } from "./nativeResearchTools";
import { runNativeTestCommand } from "./nativeTestRunTool";
import type { ToolResultOffloadStore } from "./toolResultOffloadStore";
import type { MemoryStore } from "./memoryStore";
import type { AgentRunContext } from "../shared/agentWorkspace";
import { getMemoryKinds, type MemoryKind } from "../shared/memory";
import { defineNativeToolDescriptor } from "../shared/nativeCapabilities";
import type { ToolCallRequest } from "../shared/toolPermissions";
import { isSafeToolResultRef } from "../shared/toolResultRefs";

const execAsync = promisify(exec);

export type AgentToolExecutionResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string; errorDetails?: Record<string, unknown> };

export type AgentToolExecutionOptions = {
  runContext?: AgentRunContext;
  signal?: AbortSignal;
};

export type AgentToolExecutor = {
  execute(
    request: ToolCallRequest,
    options?: AgentToolExecutionOptions,
  ): Promise<AgentToolExecutionResult>;
  getRegistry(): DynamicToolRegistry;
  hasTool(toolName: string): boolean;
};

export function createAgentToolExecutor(options?: {
  webTools?: WebTools;
  registry?: DynamicToolRegistry;
  memoryStore?: Pick<MemoryStore, "search">;
  chatSessionStore?: Pick<ChatSessionStore, "searchMessages">;
  toolResultOffloadStore?: Pick<ToolResultOffloadStore, "read">;
}): AgentToolExecutor {
  const webTools = options?.webTools ?? createWebTools();
  const registry = options?.registry ?? createDynamicToolRegistry();

  // Register built-in tools
  registerBuiltinTools(registry, {
    webTools,
    memoryStore: options?.memoryStore,
    chatSessionStore: options?.chatSessionStore,
    toolResultOffloadStore: options?.toolResultOffloadStore,
  });

  return {
    async execute(request, executionOptions) {
      if (request.toolName === "shell_exec") {
        return executeShellCommand(
          request.args,
          executionOptions?.runContext,
          executionOptions?.signal,
        );
      }

      return registry.execute(request.toolName, request.args, executionOptions);
    },

    getRegistry() {
      return registry;
    },

    hasTool(toolName) {
      return registry.has(toolName);
    },
  };
}

function registerBuiltinTools(
  registry: DynamicToolRegistry,
  options: {
    webTools: WebTools;
    memoryStore?: Pick<MemoryStore, "search">;
    chatSessionStore?: Pick<ChatSessionStore, "searchMessages">;
    toolResultOffloadStore?: Pick<ToolResultOffloadStore, "read">;
  },
) {
  const researchTools = createNativeResearchTools({
    webTools: options.webTools,
  });

  registry.register(
    {
      type: "function",
      function: {
        name: "file_stat",
        description:
          "读取文件或目录的元信息（类型、大小、修改时间），不读取文件内容。",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "要检查的文件或目录绝对路径" },
          },
          required: ["path"],
        },
      },
    },
    async (args) => statLocalPath(String(args.path ?? "")),
    "built-in",
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "file_search",
        description:
          "在目录内搜索文件名或小文本文件内容，避免为 find/grep 这类简单检索调用 shell。",
        parameters: {
          type: "object",
          properties: {
            root: { type: "string", description: "要搜索的目录绝对路径" },
            query: { type: "string", description: "要匹配的关键词" },
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
    async (args) => searchLocalFiles(args),
    "built-in",
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "file_list",
        description: "列出指定目录下的文件和子目录。",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "要列出的目录的绝对路径" },
          },
          required: ["path"],
        },
      },
    },
    async (args) => listLocalDirectory(String(args.path ?? "")),
    "built-in",
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "file_read",
        description: "读取指定文件的内容并返回文本。",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "要读取的文件的绝对路径" },
          },
          required: ["path"],
        },
      },
    },
    async (args) =>
      readLocalFileOrToolResultRef(
        String(args.path ?? ""),
        options.toolResultOffloadStore,
      ),
    "built-in",
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "tool_result_read",
        description:
          "读取工具返回的大型结果引用。当上一步结果包含 result_ref 或 tool-result-refs/... 时使用。",
        parameters: {
          type: "object",
          properties: {
            ref: { type: "string", description: "工具结果引用" },
          },
          required: ["ref"],
        },
      },
    },
    async (args) =>
      readToolResultRef(String(args.ref ?? ""), options.toolResultOffloadStore),
    "built-in",
    defineNativeToolDescriptor({
      id: "tool_result_read",
      kind: "file",
      label: "Tool Result Read",
      description: "Read offloaded tool observations without treating refs as files.",
      riskLevel: "low",
      permissionScope: { files: "none", shell: "none", web: "none" },
      observableEvents: ["native_tool_invocation", "native_tool_observation"],
    }),
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "file_write",
        description: "将内容写入指定文件。如果目录不存在则自动创建。",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "要写入的文件的绝对路径" },
            content: { type: "string", description: "要写入的文件内容" },
          },
          required: ["path", "content"],
        },
      },
    },
    async (args) =>
      writeLocalFile(
        String(args.path ?? ""),
        String(args.content ?? ""),
      ),
    "built-in",
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "code_search",
        description:
          "在代码仓库中搜索文本，优先使用 ripgrep，自动跳过 node_modules/dist/release 等生成目录。",
        parameters: {
          type: "object",
          properties: {
            workspaceRoot: {
              type: "string",
              description: "要搜索的仓库或工作区绝对路径",
            },
            query: { type: "string", description: "要搜索的代码文本" },
            maxResults: {
              type: "number",
              description: "最多返回结果数，默认 20，最大 100",
            },
          },
          required: ["workspaceRoot", "query"],
        },
      },
    },
    async (args) =>
      searchCode({
        workspaceRoot: String(args.workspaceRoot ?? ""),
        query: String(args.query ?? ""),
        maxResults: optionalNumber(args.maxResults),
      }),
    "built-in",
    defineNativeToolDescriptor({
      id: "code_search",
      kind: "code",
      label: "Code Search",
      description: "Search source code without shell fallback.",
      riskLevel: "low",
      permissionScope: { files: "read", shell: "none", web: "none" },
      observableEvents: ["native_tool_invocation", "native_tool_observation"],
    }),
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "git_status",
        description:
          "读取仓库分支和工作区改动摘要，避免为 git status 调用 shell_exec。",
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
    async (args) =>
      readGitStatus({
        workspaceRoot: String(args.workspaceRoot ?? ""),
      }),
    "built-in",
    defineNativeToolDescriptor({
      id: "git_status",
      kind: "git",
      label: "Git Status",
      description: "Inspect branch and changed files without shell fallback.",
      riskLevel: "low",
      permissionScope: { files: "read", shell: "none", web: "none" },
      observableEvents: ["native_tool_invocation", "native_tool_observation"],
    }),
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "git_diff",
        description:
          "读取仓库 diff 和 numstat 摘要，可选择 staged diff，避免为 git diff 调用 shell_exec。",
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
    async (args) =>
      readGitDiff({
        workspaceRoot: String(args.workspaceRoot ?? ""),
        staged: Boolean(args.staged),
      }),
    "built-in",
    defineNativeToolDescriptor({
      id: "git_diff",
      kind: "git",
      label: "Git Diff",
      description: "Read source diffs without shell fallback.",
      riskLevel: "medium",
      permissionScope: { files: "read", shell: "none", web: "none" },
      observableEvents: ["native_tool_invocation", "native_tool_observation"],
    }),
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "test_run",
        description:
          "在工作区运行已授权的测试命令，返回 stdout/stderr/exitCode，并支持超时与中断。",
        parameters: {
          type: "object",
          properties: {
            workspaceRoot: {
              type: "string",
              description: "运行测试命令的工作区绝对路径",
            },
            command: { type: "string", description: "要运行的测试命令" },
            timeoutMs: {
              type: "number",
              description: "可选超时时间，范围 1000-600000 ms，默认 120000 ms",
            },
          },
          required: ["workspaceRoot", "command"],
        },
      },
    },
    async (args, executionOptions) =>
      runNativeTestCommand({
        workspaceRoot: String(args.workspaceRoot ?? ""),
        command: String(args.command ?? ""),
        timeoutMs: optionalNumber(args.timeoutMs),
        signal: executionOptions?.signal,
      }),
    "built-in",
    defineNativeToolDescriptor({
      id: "test_run",
      kind: "test",
      label: "Test Run",
      description: "Run approved test commands with structured output.",
      riskLevel: "medium",
      permissionScope: { files: "read", shell: "approved_command", web: "none" },
      observableEvents: ["native_tool_invocation", "native_tool_observation"],
    }),
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "shell_exec",
        description:
          "执行 shell 命令。默认超时 120 秒，可用 timeoutMs 明确设置 25-600000 ms。优先使用 file_stat/file_search/file_read 等原生工具完成文件诊断。",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "要执行的完整 shell 命令" },
            timeoutMs: {
              type: "number",
              description: "可选超时时间，范围 25-600000 ms，默认 120000 ms",
            },
          },
          required: ["command"],
        },
      },
    },
    async (args) => executeShellCommand(args),
    "built-in",
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "web_search",
        description: "使用 DuckDuckGo 搜索网页并返回结果列表。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "搜索关键词" },
          },
          required: ["query"],
        },
      },
    },
    async (args) => options.webTools.search(String(args.query ?? "")),
    "built-in",
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "web_fetch",
        description: "抓取指定 URL 的网页内容并返回文本。",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "要抓取的完整 URL" },
          },
          required: ["url"],
        },
      },
    },
    async (args) => options.webTools.fetchPage(String(args.url ?? "")),
    "built-in",
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "web_fetch_document",
        description:
          "抓取指定 URL 并返回规范化研究文档和引用种子。",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "要抓取的完整 URL" },
          },
          required: ["url"],
        },
      },
    },
    async (args) => researchTools.webFetchDocument(args),
    "built-in",
    defineNativeToolDescriptor({
      id: "web_fetch_document",
      kind: "web",
      label: "Web Fetch Document",
      description: "Fetch and normalize a source document for research writing.",
      riskLevel: "medium",
      permissionScope: { files: "none", shell: "none", web: "fetch" },
      observableEvents: ["native_tool_invocation", "native_tool_observation"],
    }),
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "citation_record",
        description:
          "记录结构化引用证据，供 Markdown 报告和 sidecar 审计使用。",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "可选引用 id" },
            url: { type: "string", description: "来源 URL" },
            title: { type: "string", description: "来源标题" },
            quote: { type: "string", description: "短摘录" },
            note: { type: "string", description: "审计备注" },
            accessedAt: { type: "string", description: "访问时间" },
          },
          required: ["url"],
        },
      },
    },
    async (args) => researchTools.citationRecord(args),
    "built-in",
    defineNativeToolDescriptor({
      id: "citation_record",
      kind: "citation",
      label: "Citation Record",
      description: "Record structured citation evidence separately from prose.",
      riskLevel: "low",
      permissionScope: { files: "none", shell: "none", web: "fetch" },
      observableEvents: ["native_tool_invocation", "native_tool_observation"],
    }),
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "citation_coverage_check",
        description:
          "检查 sourced_fact 是否全部引用已知 citation，并单列 model_inference。",
        parameters: {
          type: "object",
          properties: {
            citations: { type: "array", description: "citation 数组" },
            claims: { type: "array", description: "claim 数组" },
          },
          required: ["citations", "claims"],
        },
      },
    },
    async (args) => researchTools.citationCoverageCheck(args),
    "built-in",
    defineNativeToolDescriptor({
      id: "citation_coverage_check",
      kind: "citation",
      label: "Citation Coverage Check",
      description: "Verify sourced claims before report writing.",
      riskLevel: "low",
      permissionScope: { files: "none", shell: "none", web: "none" },
      observableEvents: ["native_tool_invocation", "native_tool_observation"],
    }),
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "markdown_report_write",
        description:
          "写入 citation-backed Markdown 报告和相邻 .citations.json sidecar。",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "报告绝对路径" },
            title: { type: "string", description: "报告标题" },
            generatedAt: { type: "string", description: "生成时间" },
            citations: { type: "array", description: "citation 数组" },
            claims: { type: "array", description: "claim 数组" },
            sections: { type: "array", description: "section 数组" },
          },
          required: ["path", "title", "citations", "claims", "sections"],
        },
      },
    },
    async (args) => researchTools.markdownReportWrite(args),
    "built-in",
    defineNativeToolDescriptor({
      id: "markdown_report_write",
      kind: "report",
      label: "Markdown Report Write",
      description: "Write Markdown reports with citation sidecars.",
      riskLevel: "medium",
      permissionScope: { files: "write", shell: "none", web: "none" },
      observableEvents: ["native_tool_invocation", "native_tool_observation"],
    }),
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "memory_search",
        description:
          "检索长期记忆（core/session/semantic/episodic/procedural）。只返回裁剪后的摘要，用于补充上下文。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "要检索的关键词或问题" },
            kind: {
              type: "string",
              description:
                "可选记忆类型：all/core/session/semantic/episodic/procedural",
            },
            limit: { type: "number", description: "最多返回几条，默认 5，最大 10" },
          },
          required: ["query"],
        },
      },
    },
    async (args) => searchMemory(args, options.memoryStore),
    "built-in",
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "conversation_search",
        description:
          "检索原始聊天消息证据。适合查找用户曾经说过的话或某次会话中的原始上下文。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "要检索的关键词或问题" },
            sessionId: { type: "string", description: "可选：限制在某个会话内搜索" },
            limit: { type: "number", description: "最多返回几条，默认 5，最大 10" },
          },
          required: ["query"],
        },
      },
    },
    async (args) => searchConversations(args, options.chatSessionStore),
    "built-in",
  );
}

async function listLocalDirectory(
  directoryPath: string,
): Promise<AgentToolExecutionResult> {
  if (!directoryPath) {
    return { ok: false, error: "file_list requires a path." };
  }

  const resolvedPath = resolveUserPath(directoryPath);
  const entries = await readdir(resolvedPath, { withFileTypes: true });
  const listedEntries = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const entryPath = path.join(resolvedPath, entry.name);
        const entryStat = await stat(entryPath);

        return {
          name: entry.name,
          path: entryPath,
          type: entry.isDirectory()
            ? "directory"
            : entry.isFile()
              ? "file"
              : "other",
          size: entryStat.size,
          modifiedAt: entryStat.mtime.toISOString(),
        };
      }),
  );

  return {
    ok: true,
    result: { path: resolvedPath, entries: listedEntries },
  };
}

async function readLocalFile(filePath: string): Promise<AgentToolExecutionResult> {
  if (!filePath) {
    return { ok: false, error: "file_read requires a path." };
  }

  const resolvedPath = resolveUserPath(filePath);
  const content = await readFile(resolvedPath, "utf8");

  return { ok: true, result: { path: resolvedPath, content } };
}

async function readLocalFileOrToolResultRef(
  filePath: string,
  store?: Pick<ToolResultOffloadStore, "read">,
): Promise<AgentToolExecutionResult> {
  if (isSafeToolResultRef(filePath)) {
    return readToolResultRef(filePath, store);
  }

  return readLocalFile(filePath);
}

async function readToolResultRef(
  ref: string,
  store?: Pick<ToolResultOffloadStore, "read">,
): Promise<AgentToolExecutionResult> {
  if (!isSafeToolResultRef(ref)) {
    return {
      ok: false,
      error: "tool_result_read requires a safe tool-result ref.",
    };
  }
  if (!store) {
    return {
      ok: false,
      error: "tool_result_read is not available in this runtime.",
    };
  }

  const content = await store.read(ref);
  if (!content) {
    return {
      ok: false,
      error: "tool_result_read could not find the requested ref.",
    };
  }

  return {
    ok: true,
    result: {
      ref,
      content,
    },
  };
}

async function statLocalPath(
  targetPath: string,
): Promise<AgentToolExecutionResult> {
  if (!targetPath) {
    return { ok: false, error: "file_stat requires a path." };
  }

  const resolvedPath = resolveUserPath(targetPath);
  const entryStat = await stat(resolvedPath);

  return {
    ok: true,
    result: {
      path: resolvedPath,
      type: entryStat.isDirectory()
        ? "directory"
        : entryStat.isFile()
          ? "file"
          : "other",
      size: entryStat.size,
      modifiedAt: entryStat.mtime.toISOString(),
      createdAt: entryStat.birthtime.toISOString(),
    },
  };
}

async function searchLocalFiles(
  args: Record<string, unknown>,
): Promise<AgentToolExecutionResult> {
  const root = String(args.root ?? "");
  const query = String(args.query ?? "").trim();
  const mode = normalizeSearchMode(args.mode);
  const maxResults = clampNumber(args.maxResults, 20, 1, 100);

  if (!root) {
    return { ok: false, error: "file_search requires a root." };
  }
  if (!query) {
    return { ok: false, error: "file_search requires a query." };
  }

  const resolvedRoot = resolveUserPath(root);
  const queryLower = query.toLowerCase();
  const results: Record<string, unknown>[] = [];
  let visitedFiles = 0;
  let truncated = false;

  async function walk(directory: string, depth: number): Promise<void> {
    if (results.length >= maxResults || depth > 8 || visitedFiles >= 2_000) {
      truncated = true;
      return;
    }

    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (results.length >= maxResults || visitedFiles >= 2_000) {
        truncated = true;
        return;
      }

      if (entry.isDirectory() && shouldSkipSearchDirectory(entry.name)) {
        continue;
      }

      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath, depth + 1);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      visitedFiles += 1;
      if ((mode === "name" || mode === "both") && entry.name.toLowerCase().includes(queryLower)) {
        results.push({
          path: entryPath,
          type: "name",
          preview: entry.name,
        });
        if (results.length >= maxResults) return;
      }

      if (mode === "content" || mode === "both") {
        const contentMatch = await searchTextFile(entryPath, queryLower);
        if (contentMatch) {
          results.push(contentMatch);
        }
      }
    }
  }

  await walk(resolvedRoot, 0);

  return {
    ok: true,
    result: {
      root: resolvedRoot,
      query,
      mode,
      results,
      visitedFiles,
      truncated,
    },
  };
}

async function writeLocalFile(
  filePath: string,
  content: string,
): Promise<AgentToolExecutionResult> {
  if (!filePath) {
    return { ok: false, error: "file_write requires a path." };
  }

  const resolvedPath = resolveUserPath(filePath);
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, content, "utf8");

  return {
    ok: true,
    result: { path: resolvedPath, bytesWritten: Buffer.byteLength(content) },
  };
}

async function executeShellCommand(
  args: Record<string, unknown>,
  runContext?: AgentRunContext,
  signal?: AbortSignal,
): Promise<AgentToolExecutionResult> {
  const command = String(args.command ?? "");
  if (!command) {
    return { ok: false, error: "shell_exec requires a command." };
  }

  const timeoutMs = clampNumber(args.timeoutMs, 120_000, 25, 600_000);
  const startedAt = Date.now();

  try {
    const result = await execAsync(command, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      shell: getShellExecShell(),
      ...(signal ? { signal } : {}),
      ...(runContext ? { cwd: runContext.workspaceRoot } : {}),
    });
    const durationMs = Date.now() - startedAt;

    return {
      ok: true,
      result: {
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: 0,
        durationMs,
        timeoutMs,
      },
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const execError = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number;
      signal?: NodeJS.Signals;
      killed?: boolean;
    };
    const details = buildShellErrorDetails({
      command,
      timeoutMs,
      durationMs,
      signal,
      error: execError,
    });

    return {
      ok: false,
      error: summarizeShellError(details),
      errorDetails: details,
    };
  }
}

export function getShellExecShell(
  platform: NodeJS.Platform = process.platform,
  shellEnv: string | undefined = process.env.SHELL,
): string | undefined {
  if (platform === "win32") {
    return undefined;
  }
  if (platform === "darwin") {
    return "/bin/zsh";
  }

  const shell = shellEnv?.trim();
  return shell || "/bin/sh";
}

function normalizeSearchMode(value: unknown): "name" | "content" | "both" {
  return value === "name" || value === "content" || value === "both"
    ? value
    : "both";
}

function shouldSkipSearchDirectory(name: string): boolean {
  return new Set([
    ".git",
    "node_modules",
    "dist",
    "dist-electron",
    ".next",
    "coverage",
    ".cache",
  ]).has(name);
}

async function searchTextFile(
  filePath: string,
  queryLower: string,
): Promise<Record<string, unknown> | null> {
  const fileStat = await stat(filePath);
  if (fileStat.size > 256 * 1024) {
    return null;
  }

  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return null;
  }

  if (content.includes("\u0000")) {
    return null;
  }

  const lines = content.split(/\r?\n/);
  const lineIndex = lines.findIndex((line) =>
    line.toLowerCase().includes(queryLower),
  );

  if (lineIndex < 0) {
    return null;
  }

  return {
    path: filePath,
    type: "content",
    line: lineIndex + 1,
    preview: lines[lineIndex].trim().slice(0, 240),
  };
}

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function buildShellErrorDetails(options: {
  command: string;
  timeoutMs: number;
  durationMs: number;
  signal?: AbortSignal;
  error: Error & {
    stdout?: string;
    stderr?: string;
    code?: number;
    signal?: NodeJS.Signals;
    killed?: boolean;
  };
}): Record<string, unknown> {
  const stdout = options.error.stdout ?? "";
  const stderr = options.error.stderr ?? "";
  const exitCode = typeof options.error.code === "number" ? options.error.code : 1;
  const kind = options.signal?.aborted
    ? "canceled"
    : options.durationMs >= options.timeoutMs - 5
      ? "timeout"
      : !stdout.trim() && !stderr.trim()
        ? "empty_exit"
        : "exit";

  return {
    kind,
    command: options.command,
    stdout,
    stderr,
    stdoutTail: tailText(stdout),
    stderrTail: tailText(stderr),
    exitCode,
    signal: options.error.signal ?? null,
    killed: Boolean(options.error.killed),
    durationMs: options.durationMs,
    timeoutMs: options.timeoutMs,
  };
}

function summarizeShellError(details: Record<string, unknown>): string {
  const kind = String(details.kind ?? "exit");
  if (kind === "canceled") {
    return "shell_exec 已中断：用户或运行时取消了当前命令。";
  }
  if (kind === "timeout") {
    return `shell_exec 超时：命令超过 ${details.timeoutMs} ms 仍未结束。`;
  }

  const exitCode = Number(details.exitCode ?? 1);
  const stdout = String(details.stdout ?? "");
  const stderr = String(details.stderr ?? "");
  if (!stdout.trim() && !stderr.trim()) {
    return `shell_exec 失败：退出码 ${exitCode}，无 stdout/stderr。`;
  }

  const stderrTail = String(details.stderrTail ?? "").trim();
  const stdoutTail = String(details.stdoutTail ?? "").trim();
  return [
    `shell_exec 失败：退出码 ${exitCode}。`,
    stderrTail ? `stderr: ${stderrTail}` : "",
    !stderrTail && stdoutTail ? `stdout: ${stdoutTail}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function tailText(value: string): string {
  const normalized = value.replace(/\s+$/g, "");
  if (normalized.length <= 1200) {
    return normalized;
  }
  return normalized.slice(-1200);
}

function resolveUserPath(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(value);
}

async function searchMemory(
  args: Record<string, unknown>,
  memoryStore: Pick<MemoryStore, "search"> | undefined,
): Promise<AgentToolExecutionResult> {
  if (!memoryStore) {
    return { ok: false, error: "memory_search is not configured." };
  }

  const query = String(args.query ?? "").trim();
  if (!query) {
    return { ok: false, error: "memory_search requires a query." };
  }

  const kind = normalizeMemoryKind(args.kind);
  const limit = clampLimit(args.limit);
  const results = await memoryStore.search({
    query,
    kind,
    limit,
    strategy: "hybrid",
  });

  return {
    ok: true,
    result: {
      query,
      kind,
      results: results.map((result) => ({
        id: result.record.id,
        kind: result.record.kind,
        title: result.record.title,
        content: truncateForTool(result.record.content, 800),
        score: result.score,
        source: result.record.source,
      })),
    },
  };
}

async function searchConversations(
  args: Record<string, unknown>,
  chatSessionStore: Pick<ChatSessionStore, "searchMessages"> | undefined,
): Promise<AgentToolExecutionResult> {
  if (!chatSessionStore) {
    return { ok: false, error: "conversation_search is not configured." };
  }

  const query = String(args.query ?? "").trim();
  if (!query) {
    return { ok: false, error: "conversation_search requires a query." };
  }

  const limit = clampLimit(args.limit);
  const sessionId = String(args.sessionId ?? "").trim();
  const results = await chatSessionStore.searchMessages({
    query,
    limit,
    ...(sessionId ? { sessionId } : {}),
  });

  return {
    ok: true,
    result: {
      query,
      results: results.map((result) => ({
        sessionId: result.sessionId,
        sessionTitle: result.sessionTitle,
        messageId: result.messageId,
        role: result.role,
        content: truncateForTool(result.content, 800),
        createdAt: result.createdAt,
        score: result.score,
      })),
    },
  };
}

function normalizeMemoryKind(value: unknown): MemoryKind | "all" {
  if (value === "all") {
    return "all";
  }

  return getMemoryKinds().includes(value as MemoryKind)
    ? (value as MemoryKind)
    : "all";
}

function clampLimit(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 5;
  }

  return Math.min(10, Math.max(1, Math.floor(numeric)));
}

function truncateForTool(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}
