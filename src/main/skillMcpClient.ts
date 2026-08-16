import { createHash } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
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
import type { McpServerTransportConfig } from "./mcpTransport";

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
  if (config.transport === "stdio") {
    const sandboxRoot = path.join(
      options.configDir,
      "mcp-process-sandbox",
      createHash("sha256")
        .update(
          JSON.stringify([
            config.sourceSkill,
            config.name,
            config.command,
            config.args ?? [],
          ]),
        )
        .digest("hex")
        .slice(0, 24),
    );
    await mkdir(sandboxRoot, { recursive: true, mode: 0o700 });
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
