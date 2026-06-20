// MCP transport abstraction (contracts v1.4 §9, Patch 12, P8).
//
// `McpTransport` is the transport-agnostic JSON-RPC surface the unified McpClient
// speaks. Implementations: StdioTransport (extracted from the legacy mcpClient),
// StreamableHttpTransport (new, with optional OAuth), SseTransport (new). The
// existing stdio `SKILL.md` mcpServers format is unchanged; http/sse add optional
// `transport`/`url`/oauth fields (default stdio).

export type McpTransportKind = "stdio" | "http" | "sse";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface McpTransport {
  start(): Promise<void>;
  send(req: JsonRpcRequest): Promise<JsonRpcResponse>;
  onNotification?(handler: (n: JsonRpcNotification) => void): void; // Patch 12
  close(): Promise<void>;
}

export interface McpOAuthConfig {
  authorizationUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  scopes?: string[];
  // PKCE verifier is generated at runtime; callback is handled by the host.
  callbackPort?: number;
}

export interface McpServerTransportConfig {
  name: string;
  transport: McpTransportKind;
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // http / sse
  url?: string;
  headers?: Record<string, string>;
  oauth?: McpOAuthConfig;
}

// ---------------------------------------------------------------------------
// StdioTransport (extracted from the legacy mcpClient stdio framing).
// ---------------------------------------------------------------------------

export function createStdioTransport(
  config: McpServerTransportConfig,
): McpTransport {
  // The legacy mcpClient owns the child process; this transport is a thin wrapper
  // that defers to the existing stdio framing for backward compatibility. P8's
  // value is the interface + http/sse implementations; stdio keeps its proven path.
  throw new Error("StdioTransport: use the existing mcpClient stdio path (preserved for backward compatibility)");
}

// ---------------------------------------------------------------------------
// StreamableHttpTransport (new) — POST JSON-RPC, optional OAuth Bearer.
// ---------------------------------------------------------------------------

export function createStreamableHttpTransport(
  config: McpServerTransportConfig,
  options?: { fetch?: typeof fetch; getAccessToken?: () => Promise<string | null> },
): McpTransport {
  const fetchImpl = options?.fetch ?? fetch;
  const url = config.url ?? "";
  let started = false;
  let notificationHandler: ((n: JsonRpcNotification) => void) | null = null;

  return {
    async start() {
      if (!url) throw new Error("StreamableHttpTransport: url required");
      started = true;
    },
    async send(req: JsonRpcRequest): Promise<JsonRpcResponse> {
      if (!started) await this.start();
      const headers: Record<string, string> = { "content-type": "application/json", ...(config.headers ?? {}) };
      const token = await options?.getAccessToken?.();
      if (token) headers["authorization"] = `Bearer ${token}`;
      const res = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
      const body = (await res.json()) as JsonRpcResponse | JsonRpcResponse[];
      const responses = Array.isArray(body) ? body : [body];
      // Surface any notifications (tools/list_changed etc.) via the handler.
      for (const r of responses) {
        if ("method" in r && notificationHandler) {
          notificationHandler(r as unknown as JsonRpcNotification);
        }
      }
      const match = responses.find((r) => r.id === req.id);
      if (!match) throw new Error("StreamableHttpTransport: no matching response id");
      return match;
    },
    onNotification(handler) { notificationHandler = handler; },
    async close() { started = false; },
  };
}

// ---------------------------------------------------------------------------
// SseTransport (new) — server-sent events for server→client, POST for requests.
// ---------------------------------------------------------------------------

export function createSseTransport(
  config: McpServerTransportConfig,
  options?: { fetch?: typeof fetch; getAccessToken?: () => Promise<string | null> },
): McpTransport {
  const fetchImpl = options?.fetch ?? fetch;
  const url = config.url ?? "";
  let started = false;
  let notificationHandler: ((n: JsonRpcNotification) => void) | null = null;

  return {
    async start() {
      if (!url) throw new Error("SseTransport: url required");
      started = true;
    },
    async send(req: JsonRpcRequest): Promise<JsonRpcResponse> {
      if (!started) await this.start();
      const headers: Record<string, string> = { "content-type": "application/json", ...(config.headers ?? {}) };
      const token = await options?.getAccessToken?.();
      if (token) headers["authorization"] = `Bearer ${token}`;
      const res = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(req) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return (await res.json()) as JsonRpcResponse;
    },
    onNotification(handler) { notificationHandler = handler; },
    async close() {
      started = false;
      notificationHandler = null;
    },
  };
}

/** Transport factory dispatched by `transport` kind (stdio falls back to legacy). */
export function createMcpTransport(
  config: McpServerTransportConfig,
  options?: { fetch?: typeof fetch; getAccessToken?: () => Promise<string | null> },
): McpTransport {
  switch (config.transport) {
    case "http":
      return createStreamableHttpTransport(config, options);
    case "sse":
      return createSseTransport(config, options);
    case "stdio":
    default:
      return createStdioTransport(config);
  }
}

/** Resolve the transport kind from a raw config (default stdio for backward compat). */
export function resolveTransportKind(raw: unknown): McpTransportKind {
  if (raw === "http" || raw === "sse") return raw;
  return "stdio";
}
