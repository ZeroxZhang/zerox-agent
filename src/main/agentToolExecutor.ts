import { exec } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createWebTools, type WebTools } from "./webTools";
import { createDynamicToolRegistry, type DynamicToolRegistry } from "./dynamicToolRegistry";
import type { AgentRunContext } from "../shared/agentWorkspace";
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
}): AgentToolExecutor {
  const webTools = options?.webTools ?? createWebTools();
  const registry = options?.registry ?? createDynamicToolRegistry();

  // Register built-in tools
  registerBuiltinTools(registry, webTools);

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
  webTools: WebTools,
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
    async (args) => webTools.search(String(args.query ?? "")),
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
    async (args) => webTools.fetchPage(String(args.url ?? "")),
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
