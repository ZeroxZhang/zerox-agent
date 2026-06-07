import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { env as nodeEnv } from "node:process";
import type { ToolDefinition } from "./openAiCompatibleClient";

export type McpServerConfig = {
  name: string;
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type McpToolResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string };

export type McpClient = {
  connect(): Promise<void>;
  disconnect(): void;
  listTools(): Promise<ToolDefinition[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult>;
  isConnected(): boolean;
};

export function createMcpClient(config: McpServerConfig): McpClient {
  let childProcess: ReturnType<typeof spawn> | null = null;
  let nextId = 1;
  const pendingRequests = new Map<
    number,
    {
      resolve: (value: JsonRpcResponse) => void;
      reject: (error: Error) => void;
    }
  >();
  let connected = false;

  function getProcess(): ReturnType<typeof spawn> {
    if (!childProcess || !childProcess.stdin) {
      throw new Error("MCP client is not connected.");
    }
    return childProcess;
  }

  function sendRequest(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    const proc = getProcess();
    const id = nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params ? { params } : {}),
    };

    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });

      const timeout = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`MCP request "${method}" timed out.`));
      }, 30000);

      const originalResolve = resolve;
      pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          originalResolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      proc.stdin!.write(JSON.stringify(request) + "\n");
    });
  }

  function sendNotification(
    method: string,
    params?: Record<string, unknown>,
  ) {
    if (!childProcess || !childProcess.stdin) return;

    const notification = {
      jsonrpc: "2.0" as const,
      method,
      ...(params ? { params } : {}),
    };

    childProcess.stdin.write(JSON.stringify(notification) + "\n");
  }

  return {
    async connect() {
      if (connected) return;

      const proc = spawn(config.command, config.args ?? [], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...nodeEnv, ...(config.env ?? {}) },
        shell: true,
      });

      childProcess = proc;

      const rl = createInterface({
        input: proc.stdout!,
        crlfDelay: Infinity,
      });

      rl.on("line", (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        try {
          const response = JSON.parse(trimmed) as JsonRpcResponse;
          if (response.id !== undefined) {
            const pending = pendingRequests.get(response.id);
            if (pending) {
              pendingRequests.delete(response.id);
              pending.resolve(response);
            }
          }
        } catch {
          // Skip non-JSON lines (stderr output, etc.)
        }
      });

      proc.stderr?.on("data", (_data: Buffer) => {
        // Stderr is for logging, not protocol messages
      });

      proc.on("error", (error) => {
        connected = false;
        for (const [, pending] of pendingRequests) {
          pending.reject(
            new Error(`MCP process error: ${error.message}`),
          );
        }
        pendingRequests.clear();
      });

      proc.on("exit", (code) => {
        connected = false;
        if (code !== 0 && code !== null) {
          for (const [, pending] of pendingRequests) {
            pending.reject(
              new Error(`MCP process exited with code ${code}`),
            );
          }
          pendingRequests.clear();
        }
      });

      try {
        const initResponse = await sendRequest("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "zerox-agent",
            version: "1.0.0",
          },
        });

        if (initResponse.error) {
          throw new Error(
            `MCP initialize failed: ${initResponse.error.message}`,
          );
        }

        sendNotification("notifications/initialized");
        connected = true;
      } catch (error) {
        proc.kill();
        childProcess = null;
        throw error;
      }
    },

    disconnect() {
      connected = false;

      for (const [, pending] of pendingRequests) {
        pending.reject(new Error("MCP client disconnected."));
      }
      pendingRequests.clear();

      if (childProcess) {
        childProcess.kill();
        childProcess = null;
      }
    },

    async listTools() {
      const response = await sendRequest("tools/list", {});

      if (response.error) {
        throw new Error(
          `MCP tools/list failed: ${response.error.message}`,
        );
      }

      const result = response.result as {
        tools?: Array<{
          name: string;
          description?: string;
          inputSchema?: Record<string, unknown>;
        }>;
      };

      if (!result?.tools?.length) return [];

      return result.tools.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description ?? `MCP tool: ${tool.name}`,
          parameters: tool.inputSchema ?? {
            type: "object",
            properties: {},
          },
        },
      }));
    },

    async callTool(name, args) {
      const response = await sendRequest("tools/call", {
        name,
        arguments: args,
      });

      if (response.error) {
        return {
          ok: false,
          error: `MCP tool "${name}" failed: ${response.error.message}`,
        };
      }

      const result = response.result as {
        content?: Array<{ type: string; text?: string }>;
      };

      if (result?.content?.length) {
        const textContent = result.content
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n");

        return {
          ok: true,
          result: { tool: name, content: textContent, raw: result },
        };
      }

      return {
        ok: true,
        result: { tool: name, raw: result },
      };
    },

    isConnected() {
      return connected;
    },
  };
}
