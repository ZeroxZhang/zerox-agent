import { describe, expect, it } from "vitest";
import { createMcpTransportClient } from "./mcpTransportClient";
import type { McpServerTransportConfig } from "./mcpTransport";

function mockFetch(responses: Record<string, unknown>): typeof fetch {
  let call = 0;
  return (async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const response = responses[body.method] ?? { jsonrpc: "2.0", id: body.id, result: {} };
    call += 1;
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify(response),
      json: async () => response,
      body: null,
    } as Response;
  }) as unknown as typeof fetch;
}

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
    const client = createMcpTransportClient(config, { fetch: fetchImpl });
    await client.connect();
    expect(client.isConnected()).toBe(true);

    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.function.name).toBe("search");
    expect(tools[0]!.function.parameters).toMatchObject({ type: "object" });

    const result = await client.callTool("search", { q: "quantum" });
    expect(result.ok).toBe(true);
    expect((result as { result: { results: string[] } }).result.results).toEqual(["hit1", "hit2"]);

    client.disconnect();
    expect(client.isConnected()).toBe(false);
  });

  it("returns a structured error when tools/call responds with an RPC error", async () => {
    const config: McpServerTransportConfig = { name: "svc", transport: "http", url: "https://mcp.example.com/rpc" };
    const fetchImpl = mockFetch({
      "tools/call": { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "invalid params" } },
    });
    const client = createMcpTransportClient(config, { fetch: fetchImpl });
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
    const client = createMcpTransportClient(config, { fetch: fetchImpl });
    await client.connect();
    const tools = await client.listTools();
    expect(tools).toEqual([]);
  });
});
