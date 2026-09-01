import { createHash } from "node:crypto";
import {
  mkdir,
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

  it("uses opaque sandbox ids and removes legacy private-argument verifiers", async () => {
    const configDir = await tempDir();
    const stateParent = path.join(configDir, "mcp-process-sandbox");
    const secretCandidates = [
      "skill-mcp-private-arg-candidate-a",
      "skill-mcp-private-arg-candidate-b",
    ];
    const [legacyCandidateA, legacyCandidateB] = secretCandidates.map((secret) =>
      createHash("sha256")
        .update(JSON.stringify([
          "research",
          "local-index",
          "node",
          ["server.js", `--token=${secret}`],
        ]))
        .digest("hex")
        .slice(0, 24)
    );
    await mkdir(path.join(stateParent, legacyCandidateA), { recursive: true });
    await mkdir(path.join(stateParent, legacyCandidateB), { recursive: true });
    const observedRoots: string[] = [];
    const createStdioClient = vi.fn((config: McpServerConfig) => {
      observedRoots.push(config.sandboxPolicy?.workspaceRoot ?? "");
      return client();
    });

    for (const secret of secretCandidates) {
      await createSkillMcpClient(
        {
          sourceSkill: "research",
          name: "local-index",
          transport: "stdio",
          command: "node",
          args: ["server.js", `--token=${secret}`],
          readRoots: [],
          network: false,
        },
        { configDir, processSandbox: sandbox(), createStdioClient },
      );
    }

    const stateRoots = (await readdir(stateParent)).sort();
    expect(stateRoots).toHaveLength(2);
    expect(stateRoots).not.toContain(legacyCandidateA);
    expect(stateRoots).not.toContain(legacyCandidateB);
    expect(stateRoots).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      ]),
    );
    expect(new Set(stateRoots).size).toBe(2);
    expect(observedRoots.map((root) => path.basename(root)).sort()).toEqual(
      stateRoots,
    );
    expect(JSON.stringify({ stateRoots, observedRoots })).not.toContain(
      "skill-mcp-private-arg-candidate",
    );
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
