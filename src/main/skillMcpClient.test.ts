import {
  lstat,
  mkdtemp,
  readdir,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpClient, McpServerConfig } from "./mcpClient";
import type { McpServerTransportConfig } from "./mcpTransport";
import type { ProcessSandboxProvider } from "./processSandbox";
import { createSkillMcpClient } from "./skillMcpClient";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Skill MCP client activation", () => {
  it("confines trusted stdio servers to declared reads and explicit network policy", async () => {
    const configDir = await tempDir();
    const createStdioClient = vi.fn((_config: McpServerConfig) => client());

    await createSkillMcpClient(
      {
        sourceSkill: "research",
        name: "local-index",
        transport: "stdio",
        command: "node",
        args: ["server.js"],
        readRoots: ["/trusted/skill", "/trusted/data"],
        network: false,
      },
      {
        configDir,
        processSandbox: sandbox(),
        createStdioClient,
      },
    );

    expect(createStdioClient).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "local-index",
        transport: "stdio",
        command: "node",
        sandboxPolicy: {
          mode: "workspace_write",
          workspaceRoot: expect.stringContaining("mcp-process-sandbox"),
          extraReadRoots: ["/trusted/skill", "/trusted/data"],
          network: "none",
        },
      }),
    );
    const stateParent = path.join(configDir, "mcp-process-sandbox");
    const stateRoots = await readdir(stateParent);
    expect(stateRoots).toHaveLength(1);
    expect(
      (await lstat(path.join(stateParent, stateRoots[0]!))).mode & 0o777,
    ).toBe(0o700);
  });

  it("routes trusted HTTP manifests to the remote transport client", async () => {
    const configDir = await tempDir();
    const createRemoteClient = vi.fn(
      (_config: McpServerTransportConfig) => client(),
    );

    await createSkillMcpClient(
      {
        sourceSkill: "research",
        name: "remote-http",
        transport: "http",
        url: "https://mcp.example.test/http",
        headers: { "x-client": "zerox" },
      },
      {
        configDir,
        processSandbox: sandbox(),
        createRemoteClient,
      },
    );

    expect(createRemoteClient).toHaveBeenCalledWith({
      name: "remote-http",
      transport: "http",
      url: "https://mcp.example.test/http",
      headers: { "x-client": "zerox" },
    });
    expect(await readdir(configDir)).toEqual([]);
  });

  it("rejects SSE manifests before creating a remote client", async () => {
    const configDir = await tempDir();
    const createRemoteClient = vi.fn(
      (_config: McpServerTransportConfig) => client(),
    );

    await expect(
      createSkillMcpClient(
        {
          sourceSkill: "research",
          name: "remote-sse",
          transport: "sse",
          url: "https://mcp.example.test/sse",
        },
        {
          configDir,
          processSandbox: sandbox(),
          createRemoteClient,
        },
      ),
    ).rejects.toThrow(/MCP SSE transport is not implemented/);

    expect(createRemoteClient).not.toHaveBeenCalled();
    expect(await readdir(configDir)).toEqual([]);
  });
});

async function tempDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "zerox-skill-mcp-"));
  roots.push(root);
  return root;
}

function client(): McpClient {
  return {
    async connect() {},
    async disconnect() {},
    async listTools() {
      return [];
    },
    async callTool() {
      return { ok: true, result: {} };
    },
    isConnected() {
      return false;
    },
  };
}

function sandbox(): ProcessSandboxProvider {
  return {
    status() {
      return {
        available: true,
        backend: "seatbelt",
        enforcement: "read-write-and-network-policy",
      };
    },
    confine() {
      throw new Error("client factory should own sandbox invocation");
    },
  };
}
