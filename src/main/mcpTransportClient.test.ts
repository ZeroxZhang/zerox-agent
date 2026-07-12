import { describe, expect, it } from "vitest";
import { createMcpTransportClient } from "./mcpTransportClient";
import type { McpServerTransportConfig } from "./mcpTransport";

function mockFetch(responses: Record<string, unknown>): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const response = responses[body.method] ?? { jsonrpc: "2.0", id: body.id, result: {} };
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

const resolvePublicHostname = async () => ["93.184.216.34"];

describe("createMcpTransportClient (P8 http/sse MCP activation)", () => {
  it("connects, lists tools, and calls a tool over the http transport", async () => {
    const config: McpServerTransportConfig = {
      name: "svc",
      transport: "http",
      url: "https://mcp.example.com/rpc",
    };
    const fetchImpl = mockFetch({
      "tools/list": { jsonrpc: "2.0", id: 1, result: { tools: [{ name: "search", description: "search the web", inputSchema: { type: "object", properties: { q: { type: "string" } } } }] } },
      "tools/call": { jsonrpc: "2.0", id: 2, result: { results: ["hit1", "hit2"] } },
    });
    const client = createMcpTransportClient(config, {
      fetch: fetchImpl,
      resolveHostname: resolvePublicHostname,
    });
    await client.connect();
    expect(client.isConnected()).toBe(true);

    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.function.name).toBe("search");
    expect(tools[0]!.function.parameters).toMatchObject({ type: "object" });

    const result = await client.callTool("search", { q: "quantum" });
    expect(result.ok).toBe(true);
    expect((result as { result: { results: string[] } }).result.results).toEqual(["hit1", "hit2"]);

    await client.disconnect();
    expect(client.isConnected()).toBe(false);
  });

  it("returns a structured error when tools/call responds with an RPC error", async () => {
    const config: McpServerTransportConfig = { name: "svc", transport: "http", url: "https://mcp.example.com/rpc" };
    const fetchImpl = mockFetch({
      "tools/call": { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "invalid params" } },
    });
    const client = createMcpTransportClient(config, {
      fetch: fetchImpl,
      resolveHostname: resolvePublicHostname,
    });
    await client.connect();
    const result = await client.callTool("bad", {});
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toBe("invalid params");
  });

  it("sse transport routes through the sse transport factory", async () => {
    const config: McpServerTransportConfig = { name: "svc", transport: "sse", url: "https://mcp.example.com/sse" };
    const fetchImpl = mockFetch({
      "tools/list": { jsonrpc: "2.0", id: 1, result: { tools: [] } },
    });
    const client = createMcpTransportClient(config, {
      fetch: fetchImpl,
      resolveHostname: resolvePublicHostname,
    });
    await client.connect();
    const tools = await client.listTools();
    expect(tools).toEqual([]);
  });

  it("revalidates DNS before each MCP request and blocks rebinding", async () => {
    let resolutions = 0;
    let fetchCalls = 0;
    const client = createMcpTransportClient(
      {
        name: "rebind",
        transport: "http",
        url: "https://mcp.example.com/rpc",
      },
      {
        resolveHostname: async () => {
          resolutions += 1;
          return resolutions === 1 ? ["93.184.216.34"] : ["127.0.0.1"];
        },
        fetch: (async () => {
          fetchCalls += 1;
          return new Response("{}");
        }) as typeof fetch,
      },
    );

    await client.connect();
    await expect(client.listTools()).rejects.toThrow(/non-public/);
    expect(fetchCalls).toBe(0);
  });

  it("propagates tool cancellation to the active HTTP request", async () => {
    let observedSignal: AbortSignal | undefined;
    const client = createMcpTransportClient(
      {
        name: "cancelable",
        transport: "http",
        url: "https://mcp.example.com/rpc",
      },
      {
        resolveHostname: resolvePublicHostname,
        fetch: (async (_url, init) => {
          observedSignal = init?.signal as AbortSignal;
          return new Promise<Response>((_resolve, reject) => {
            observedSignal.addEventListener("abort", () => {
              reject(observedSignal?.reason);
            }, { once: true });
          });
        }) as typeof fetch,
      },
    );
    await client.connect();
    const controller = new AbortController();
    const completion = client.callTool("slow", {}, { signal: controller.signal });
    await Promise.resolve();

    controller.abort(new Error("stop MCP side effect"));

    await expect(completion).rejects.toThrow("aborted by external signal");
    expect(observedSignal?.aborted).toBe(true);
  });
});
