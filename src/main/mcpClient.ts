import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { env as nodeEnv } from "node:process";
import type { ToolDefinition } from "./openAiCompatibleClient";
import type {
  ConfinedProcess,
  ProcessSandboxPolicy,
  ProcessSandboxProvider,
} from "./processSandbox";
import { buildMinimalProcessEnv } from "./processSandbox";
import { terminateOwnedProcessTree } from "./ownedProcess";

export type McpServerConfig = {
  name: string;
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  processSandbox?: ProcessSandboxProvider;
  sandboxPolicy?: ProcessSandboxPolicy;
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

export function buildMcpChildEnv(
  parentEnv: NodeJS.ProcessEnv,
  configuredEnv: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return buildMinimalProcessEnv(parentEnv, configuredEnv);
}

export function createMcpClient(config: McpServerConfig): McpClient {
  if (Boolean(config.processSandbox) !== Boolean(config.sandboxPolicy)) {
    throw new Error(
      "MCP processSandbox and sandboxPolicy must be configured together.",
    );
  }
  let childProcess: ReturnType<typeof spawn> | null = null;
  const ownedProcesses = new WeakMap<
    ReturnType<typeof spawn>,
    {
      confined?: ConfinedProcess;
      release?: Promise<void>;
    }
  >();
  let nextId = 1;
  const pendingRequests = new Map<
    number,
    {
      resolve: (value: JsonRpcResponse) => void;
      reject: (error: Error) => void;
    }
  >();
  let connected = false;
  let lifecycleFailure: Error | null = null;
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
        }, proc);
        void terminateActiveProcess(
          reason instanceof Error ? reason : new Error("MCP request aborted."),
          { preserveError: true, expectedProcess: proc },
        );
      };

      const timeout = setTimeout(() => {
        const error = new Error(`MCP request "${method}" timed out.`);
        sendNotification("notifications/cancelled", {
          requestId: id,
          reason: error.message,
        }, proc);
        void terminateActiveProcess(error, {
          preserveError: true,
          expectedProcess: proc,
        });
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
      try {
        proc.stdin!.write(JSON.stringify(request) + "\n");
      } catch (error) {
        pendingRequests.delete(id);
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abortHandler);
        reject(error instanceof Error ? error : new Error(String(error)));
        void terminateActiveProcess(
          error instanceof Error ? error : new Error(String(error)),
          { preserveError: true, expectedProcess: proc },
        );
      }
    });
  }

  function sendNotification(
    method: string,
    params?: Record<string, unknown>,
    proc = childProcess,
  ) {
    if (!proc?.stdin) return;

    const notification = {
      jsonrpc: "2.0" as const,
      method,
      ...(params ? { params } : {}),
    };

    try {
      proc.stdin.write(JSON.stringify(notification) + "\n");
    } catch {
      // The owning request will observe and settle the process failure.
    }
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
  let lifecycleReleasePromise: Promise<void> | null = null;

  async function terminateActiveProcess(
    reason: Error,
    options?: {
      preserveError?: boolean;
      expectedProcess?: ReturnType<typeof spawn>;
    },
  ): Promise<void> {
    if (
      options?.expectedProcess &&
      childProcess !== options.expectedProcess
    ) {
      try {
        await releaseOwnedProcess(options.expectedProcess);
      } catch (error) {
        rememberLifecycleFailure(error);
        logCleanupFailure("stale request", error);
      }
      return;
    }
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
    let cleanupError: unknown;
    if (proc) {
      try {
        await releaseOwnedProcess(proc);
      } catch (error) {
        cleanupError = error;
        rememberLifecycleFailure(error);
      }
    }
    if (childProcess === proc) childProcess = null;
    for (const pending of pendingToReject) {
      pending.reject(reason);
    }
    const visibleCleanupError = normalizeError(
      cleanupError ?? lifecycleFailure,
    );
    if (visibleCleanupError && !options?.preserveError) {
      throw visibleCleanupError;
    }
    if (cleanupError) {
      logCleanupFailure("request termination", cleanupError);
    }
  }

  async function releaseOwnedProcess(
    proc: ReturnType<typeof spawn>,
  ): Promise<void> {
    const state = ownedProcesses.get(proc);
    if (!state) {
      await terminateOwnedProcessTree(proc);
      return;
    }
    state.release ??= (async () => {
      await terminateOwnedProcessTree(proc);
      await state.confined?.cleanup();
    })();
    await state.release;
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
    let command = config.command;
    let commandArgs = config.args ?? [];
    let confined: ConfinedProcess | undefined;
    if (config.processSandbox && config.sandboxPolicy) {
      confined = config.processSandbox.confine(
        [command, ...commandArgs],
        config.sandboxPolicy,
      );
      command = confined.argv[0]!;
      commandArgs = [...confined.argv.slice(1)];
    }
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(command, commandArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        env: confined
          ? confined.buildChildEnv(nodeEnv, config.env)
          : buildMcpChildEnv(nodeEnv, config.env),
        shell: false,
        detached: process.platform !== "win32",
      });
    } catch (error) {
      if (confined) {
        try {
          await confined.cleanup();
        } catch (cleanupError) {
          rememberLifecycleFailure(cleanupError);
          logCleanupFailure("spawn failure", cleanupError);
        }
      }
      throw error;
    }

    ownedProcesses.set(proc, {
      ...(confined ? { confined } : {}),
    });
    childProcess = proc;
    const processGeneration = reconnectGeneration;
    let reconnectScheduledForProcess = false;
    const reconnectAfterUnexpectedFailure = () => {
      if (reconnectScheduledForProcess || manuallyDisconnected) return;
      reconnectScheduledForProcess = true;
      const release = (async () => {
        let released = true;
        try {
          await releaseOwnedProcess(proc);
        } catch (error) {
          released = false;
          rememberLifecycleFailure(error);
          logCleanupFailure("unexpected process exit", error);
        }
        if (childProcess === proc) childProcess = null;
        if (released) {
          scheduleReconnect(processGeneration);
        }
      })();
      lifecycleReleasePromise = release;
      void release.finally(() => {
        if (lifecycleReleasePromise === release) {
          lifecycleReleasePromise = null;
        }
      });
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

    const handleProcessError = (error: Error) => {
      if (childProcess !== proc) return;
      const wasConnected = connected;
      connected = false;
      for (const [, pending] of pendingRequests) {
        pending.reject(error);
      }
      pendingRequests.clear();
      if (wasConnected) reconnectAfterUnexpectedFailure();
    };
    proc.on("error", (error) => {
      handleProcessError(new Error(`MCP process error: ${error.message}`));
    });
    proc.stdin?.on("error", (error) => {
      handleProcessError(new Error(`MCP stdin error: ${error.message}`));
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
      try {
        await releaseOwnedProcess(proc);
      } catch (cleanupError) {
        rememberLifecycleFailure(cleanupError);
        logCleanupFailure("failed initialization", cleanupError);
      }
      if (childProcess === proc) childProcess = null;
      throw error;
    }
  }

  async function connectClient(): Promise<void> {
    if (connected) return;
    if (lifecycleReleasePromise) {
      await lifecycleReleasePromise;
    }
    if (lifecycleFailure) {
      throw lifecycleFailure;
    }
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

  function logCleanupFailure(context: string, error: unknown): void {
    console.error(
      `[mcp] MCP server "${config.name}" cleanup failed after ${context}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  function rememberLifecycleFailure(error: unknown): void {
    lifecycleFailure ??= normalizeError(error) ??
      new Error("Unknown MCP lifecycle cleanup failure.");
  }

  function normalizeError(error: unknown): Error | null {
    if (error === undefined || error === null) return null;
    return error instanceof Error ? error : new Error(String(error));
  }
}
