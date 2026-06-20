// Transport-backed MCP client (contracts v1.4 §9, P8 activation).
//
// A unified McpClient that speaks JSON-RPC over any McpTransport (http/sse).
// Exposes the same McpClient shape as the stdio mcpClient, so initializeMcpTools
// can register http/sse MCP servers' tools identically. stdio keeps its existing
// process-based path; this handles the http/sse transports.

import type { ToolDefinition } from "./openAiCompatibleClient";
import type {
  McpTransport,
  JsonRpcRequest,
  JsonRpcResponse,
  McpServerTransportConfig,
} from "./mcpTransport";
import {
  createStreamableHttpTransport,
  createSseTransport,
} from "./mcpTransport";
import type { McpClient, McpToolResult } from "./mcpClient";

export interface McpTransportClientOptions {
  fetch?: typeof fetch;
  getAccessToken?: () => Promise<string | null>;
}

export function createMcpTransportClient(
  config: McpServerTransportConfig,
  options: McpTransportClientOptions = {},
): McpClient {
  const transport: McpTransport =
    config.transport === "sse"
      ? createSseTransport(config, options)
      : createStreamableHttpTransport(config, options);

  let connected = false;
  let nextId = 1;

  async function sendRequest(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    const req: JsonRpcRequest = { jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) };
    return transport.send(req);
  }

  return {
    async connect() {
      await transport.start();
      connected = true;
    },
    disconnect() {
      connected = false;
      void transport.close();
    },
    async listTools(): Promise<ToolDefinition[]> {
      const response = await sendRequest("tools/list", {});
      if (response.error) {
        throw new Error(`MCP tools/list failed: ${response.error.message}`);
      }
      const result = response.result as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> } | undefined;
      const tools = result?.tools ?? [];
      return tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description ?? t.name,
          parameters: t.inputSchema ?? { type: "object", properties: {} },
        },
      }));
    },
    async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
      const response = await sendRequest("tools/call", { name, arguments: args });
      if (response.error) {
        return { ok: false, error: response.error.message };
      }
      const result = response.result as Record<string, unknown> | undefined;
      return { ok: true, result: result ?? {} };
    },
    isConnected() {
      return connected;
    },
  };
}
