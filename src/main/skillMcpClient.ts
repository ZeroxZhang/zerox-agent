import { randomUUID } from "node:crypto";
import { chmod, mkdir, readdir, rm } from "node:fs/promises";
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
    const sandboxParent = path.join(options.configDir, "mcp-process-sandbox");
    await mkdir(sandboxParent, { recursive: true, mode: 0o700 });
    await chmod(sandboxParent, 0o700);
    await scrubLegacySandboxVerifiers(sandboxParent);
    // This identifier must remain independent of command/args/env. Those are
    // private runtime configuration and cannot participate in an unkeyed,
    // persistent value that can be used to test secret candidates offline.
    const sandboxRoot = path.join(sandboxParent, randomUUID());
    await mkdir(sandboxRoot, { mode: 0o700 });
    await chmod(sandboxRoot, 0o700);
    return (options.createStdioClient ?? createMcpClient)({
      name: config.name,
      transport: "stdio",
      command: config.command,
      args: config.args,
      env: config.env,
      processSandbox: options.processSandbox,
      sandboxPolicy: {
        mode: "workspace_write",
        workspaceRoot: sandboxRoot,
        extraReadRoots: config.readRoots,
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

async function scrubLegacySandboxVerifiers(sandboxParent: string) {
  const entries = await readdir(sandboxParent, { withFileTypes: true });
  await Promise.all(
    entries
      .filter(
        (entry) => entry.isDirectory() && /^[0-9a-f]{24}$/.test(entry.name),
      )
      .map((entry) =>
        rm(path.join(sandboxParent, entry.name), {
          recursive: true,
          force: true,
        })
      ),
  );
}
