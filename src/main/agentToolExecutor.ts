import { exec } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ChatSessionStore } from "./chatSessionStore";
import { createWebTools, type WebTools } from "./webTools";
import { createDynamicToolRegistry, type DynamicToolRegistry } from "./dynamicToolRegistry";
import type { MemoryStore } from "./memoryStore";
import type { AgentRunContext } from "../shared/agentWorkspace";
import { getMemoryKinds, type MemoryKind } from "../shared/memory";
import type { ToolCallRequest } from "../shared/toolPermissions";

const execAsync = promisify(exec);

export type AgentToolExecutionResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string };

export type AgentToolExecutionOptions = {
  runContext?: AgentRunContext;
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
}): AgentToolExecutor {
  const webTools = options?.webTools ?? createWebTools();
  const registry = options?.registry ?? createDynamicToolRegistry();

  // Register built-in tools
  registerBuiltinTools(registry, {
    webTools,
    memoryStore: options?.memoryStore,
    chatSessionStore: options?.chatSessionStore,
  });

  return {
    async execute(request, executionOptions) {
      if (request.toolName === "shell_exec") {
        return executeShellCommand(
          String(request.args.command ?? ""),
          executionOptions?.runContext,
        );
      }

      return registry.execute(request.toolName, request.args);
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
  },
) {
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
    async (args) => readLocalFile(String(args.path ?? "")),
    "built-in",
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
        name: "shell_exec",
        description: "执行 shell 命令。默认超时 30 秒。",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "要执行的完整 shell 命令" },
          },
          required: ["command"],
        },
      },
    },
    async (args) => executeShellCommand(String(args.command ?? "")),
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
  command: string,
  runContext?: AgentRunContext,
): Promise<AgentToolExecutionResult> {
  if (!command) {
    return { ok: false, error: "shell_exec requires a command." };
  }

  try {
    const result = await execAsync(command, {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      shell: "/bin/zsh",
      ...(runContext ? { cwd: runContext.workspaceRoot } : {}),
    });

    return {
      ok: true,
      result: {
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: 0,
      },
    };
  } catch (error) {
    const execError = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number;
    };

    return {
      ok: false,
      error: JSON.stringify({
        command,
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? execError.message,
        exitCode: execError.code ?? 1,
      }),
    };
  }
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
