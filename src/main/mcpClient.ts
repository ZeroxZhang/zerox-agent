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
  disconnect(): Promise<void>;
  listTools(): Promise<ToolDefinition[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<McpToolResult>;
  isConnected(): boolean;
};

const MCP_CHILD_ENV_ALLOWLIST = [
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "SHELL",
  "TMPDIR",
  "USER",
] as const;

export function buildMcpChildEnv(
  parentEnv: NodeJS.ProcessEnv,
  configuredEnv: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {};
  for (const key of MCP_CHILD_ENV_ALLOWLIST) {
    const value = parentEnv[key];
    if (value !== undefined) {
      childEnv[key] = value;
    }
  }
  return { ...childEnv, ...configuredEnv };
}

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
    signal?: AbortSignal,
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

      const abortHandler = () => {
        const reason = signal?.reason;
        sendNotification("notifications/cancelled", {
          requestId: id,
          reason: reason instanceof Error ? reason.message : String(reason ?? "aborted"),
        });
        void terminateActiveProcess(
          reason instanceof Error ? reason : new Error("MCP request aborted."),
        );
      };

      const timeout = setTimeout(() => {
        const error = new Error(`MCP request "${method}" timed out.`);
        sendNotification("notifications/cancelled", {
          requestId: id,
          reason: error.message,
        });
        void terminateActiveProcess(error);
      }, 30000);

      const originalResolve = resolve;
      pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", abortHandler);
          originalResolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", abortHandler);
          reject(error);
        },
      });

      if (signal?.aborted) {
        abortHandler();
        return;
      }
      signal?.addEventListener("abort", abortHandler, { once: true });
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
  // Invalidates delayed/in-flight reconnect work when an eager connect or
  // explicit disconnect takes ownership of the client lifecycle.
  let reconnectGeneration = 0;
  // Guard against concurrent connect() calls (manual + auto-restart race).
  let connectingPromise: Promise<void> | null = null;

  async function terminateProcess(
    proc: ReturnType<typeof spawn>,
  ): Promise<void> {
    if (proc.exitCode !== null || proc.signalCode !== null) return;

    await new Promise<void>((resolve) => {
      let settled = false;
      let forceKill: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (forceKill) clearTimeout(forceKill);
        resolve();
      };
      proc.once("exit", finish);
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (process.platform !== "win32" && proc.pid) {
            process.kill(-proc.pid, signal);
          } else {
            proc.kill(signal);
          }
        } catch {
          finish();
        }
      };
      forceKill = setTimeout(() => kill("SIGKILL"), 1_000);
      forceKill.unref?.();
      kill("SIGTERM");
    });
  }

  async function terminateActiveProcess(reason: Error): Promise<void> {
    manuallyDisconnected = true;
    reconnectGeneration += 1;
    connected = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const pendingToReject = [...pendingRequests.values()];
    pendingRequests.clear();

    const proc = childProcess;
    if (proc) await terminateProcess(proc);
    if (childProcess === proc) childProcess = null;
    for (const pending of pendingToReject) {
      pending.reject(reason);
    }
  }

  function scheduleReconnect(generation = reconnectGeneration) {
    if (manuallyDisconnected || generation !== reconnectGeneration) return;
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
    const timer = setTimeout(async () => {
      if (reconnectTimer === timer) reconnectTimer = null;
      if (
        manuallyDisconnected ||
        generation !== reconnectGeneration ||
        connected ||
        connectingPromise
      ) return;
      const attempt = connectInternal();
      connectingPromise = attempt;
      try {
        await attempt;
        if (generation !== reconnectGeneration || manuallyDisconnected) return;
        restartAttempts = 0;
        console.log(`[mcp] MCP server "${config.name}" reconnected.`);
      } catch {
        if (generation === reconnectGeneration && !manuallyDisconnected) {
          scheduleReconnect(generation);
        }
      } finally {
        if (connectingPromise === attempt) connectingPromise = null;
      }
    }, delay);
    reconnectTimer = timer;
  }

  async function connectInternal(): Promise<void> {
    const proc = spawn(config.command, config.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: buildMcpChildEnv(nodeEnv, config.env),
      shell: false,
      detached: process.platform !== "win32",
    });

    childProcess = proc;
    let reconnectScheduledForProcess = false;
    const reconnectAfterUnexpectedFailure = () => {
      if (reconnectScheduledForProcess || manuallyDisconnected) return;
      reconnectScheduledForProcess = true;
      scheduleReconnect();
    };

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
      if (childProcess !== proc) return;
      const wasConnected = connected;
      connected = false;
      for (const [, pending] of pendingRequests) {
        pending.reject(
          new Error(`MCP process error: ${error.message}`),
        );
      }
      pendingRequests.clear();
      if (wasConnected) reconnectAfterUnexpectedFailure();
    });

    proc.on("exit", (code) => {
      if (childProcess !== proc) return;
      const wasConnected = connected;
      connected = false;
      for (const [, pending] of pendingRequests) {
        pending.reject(
          new Error(`MCP process exited with code ${code ?? "signal"}`),
        );
      }
      pendingRequests.clear();
      // v3.6.0: Auto-restart on unexpected exit (when we were connected).
      if (wasConnected && !manuallyDisconnected) {
        reconnectAfterUnexpectedFailure();
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
      await terminateProcess(proc);
      if (childProcess === proc) childProcess = null;
      throw error;
    }
  }

  async function connectClient(): Promise<void> {
    if (connected) return;
    if (connectingPromise) {
      await connectingPromise;
      return;
    }

    manuallyDisconnected = false;
    reconnectGeneration += 1;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const attempt = connectInternal();
    connectingPromise = attempt;
    try {
      await attempt;
      restartAttempts = 0;
    } catch {
      throw new Error(`MCP server "${config.name}" failed to connect.`);
    } finally {
      if (connectingPromise === attempt) connectingPromise = null;
    }
  }

  return {
    async connect() {
      await connectClient();
    },

    async disconnect() {
      manuallyDisconnected = true;
      reconnectGeneration += 1;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      await terminateActiveProcess(new Error("MCP client disconnected."));
    },

    async listTools() {
      await connectClient();
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

    async callTool(name, args, options) {
      await connectClient();
      const response = await sendRequest("tools/call", {
        name,
        arguments: args,
      }, options?.signal);

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
