import { rm } from "node:fs/promises";
import path from "node:path";
import type { McpServerInitConfig } from "./skillRegistry";
import {
  createMcpClient,
  type McpClient,
  type McpServerConfig,
} from "./mcpClient";
import type { ProcessSandboxProvider } from "./processSandbox";
import {
  createMcpTransportClient,
  type McpTransportClientOptions,
} from "./mcpTransportClient";
import {
  MCP_SSE_UNSUPPORTED_MESSAGE,
  type McpServerTransportConfig,
} from "./mcpTransport";

export async function createSkillMcpClient(
  config: McpServerInitConfig,
  options: {
    configDir: string;
    processSandbox: ProcessSandboxProvider;
    createStdioClient?: (config: McpServerConfig) => McpClient;
    createRemoteClient?: (
      config: McpServerTransportConfig,
      options?: McpTransportClientOptions,
    ) => McpClient;
  },
): Promise<McpClient> {
  if (config.transport === "sse") {
    throw new Error(MCP_SSE_UNSUPPORTED_MESSAGE);
  }

  if (config.transport === "stdio") {
    // Retire the former persistent workspace as one namespace operation. rm
    // unlinks a top-level symlink instead of traversing it and recursively
    // removes nested files/symlinks without following their targets. No
    // readdir-to-child-delete window remains.
    await rm(path.join(options.configDir, "mcp-process-sandbox"), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 10,
    });
    const [workspaceRoot, ...extraReadRoots] = config.readRoots;
    if (!workspaceRoot) {
      throw new Error("Skill MCP stdio activation requires a trusted read root.");
    }
    return (options.createStdioClient ?? createMcpClient)({
      name: config.name,
      transport: "stdio",
      command: config.command,
      args: config.args,
      env: config.env,
      processSandbox: options.processSandbox,
      sandboxPolicy: {
        // The process sandbox owns an ephemeral 0700 private temp capability
        // and exposes it through TMPDIR/TMP/TEMP. The Skill roots remain
        // read-only, so MCP writes never need a persistent configDir workspace.
        mode: "read_only",
        workspaceRoot,
        extraReadRoots,
        network: config.network ? "allow" : "none",
      },
    });
  }

  return (options.createRemoteClient ?? createMcpTransportClient)({
    name: config.name,
    transport: config.transport,
    url: config.url,
    headers: config.headers,
  });
}
