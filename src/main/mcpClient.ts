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
  // v3.6.0: Auto-restart state (NET-21).
  let restartAttempts = 0;
  const MAX_RESTART_ATTEMPTS = 3;

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

  // v3.6.0: Auto-restart with exponential backoff (NET-21).
  // On unexpected exit, attempt up to 3 restarts with 1s/2s/4s backoff.
  let manuallyDisconnected = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Guard against concurrent connect() calls (manual + auto-restart race).
  let connectingPromise: Promise<void> | null = null;

  function scheduleReconnect() {
    if (manuallyDisconnected) return;
    if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
      console.error(
        `[mcp] MCP server "${config.name}" exceeded max restart attempts (${MAX_RESTART_ATTEMPTS}).`,
      );
      return;
    }
    const delay = Math.pow(2, restartAttempts) * 1000; // 1s, 2s, 4s
    restartAttempts += 1;
    console.warn(
      `[mcp] MCP server "${config.name}" restarting in ${delay}ms (attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS})...`,
    );
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (manuallyDisconnected || connectingPromise) return;
      connectingPromise = connectInternal().then(() => {
        restartAttempts = 0;
        connectingPromise = null;
        console.log(`[mcp] MCP server "${config.name}" reconnected.`);
      });
      try {
        await connectingPromise;
      } catch {
        connectingPromise = null;
        // connectInternal already logs the error; scheduleReconnect
        // will be triggered on next exit if under max attempts.
      }
    }, delay);
  }

  async function connectInternal(): Promise<void> {
    const proc = spawn(config.command, config.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...nodeEnv, ...(config.env ?? {}) },
      shell: false,
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
      const wasConnected = connected;
      connected = false;
      if (code !== 0 && code !== null) {
        for (const [, pending] of pendingRequests) {
          pending.reject(
            new Error(`MCP process exited with code ${code}`),
          );
        }
        pendingRequests.clear();
      }
      // v3.6.0: Auto-restart on unexpected exit (when we were connected).
      if (wasConnected && code !== 0 && code !== null) {
        scheduleReconnect();
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
  }

  return {
    async connect() {
      if (connected) return;
      // v3.6.0: Guard against concurrent connect() calls (manual + auto-restart
      // race). If a connection attempt is already in-flight, wait for it.
      if (connectingPromise) {
        await connectingPromise;
        return;
      }

      manuallyDisconnected = false;
      connectingPromise = connectInternal().then(() => {
        restartAttempts = 0;
        connectingPromise = null;
      });
      try {
        await connectingPromise;
      } catch {
        connectingPromise = null;
        throw new Error(`MCP server "${config.name}" failed to connect.`);
      }
    },

    disconnect() {
      manuallyDisconnected = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
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
