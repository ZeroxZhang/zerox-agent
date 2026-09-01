import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
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
          mode: "read_only",
          workspaceRoot: "/trusted/skill",
          extraReadRoots: ["/trusted/data"],
          network: "none",
        },
      }),
    );
    expect(await readdir(configDir)).toEqual([]);
  });

  it("removes every legacy verifier type without retaining private arguments", async () => {
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
    await writeFile(path.join(stateParent, legacyCandidateB), "legacy", "utf8");
    const outside = await tempDir();
    await writeFile(path.join(outside, "preserved.txt"), "preserved", "utf8");
    await symlink(outside, path.join(stateParent, "abcdefabcdefabcdefabcdef"));
    const createStdioClient = vi.fn((_config: McpServerConfig) => client());

    for (const secret of secretCandidates) {
      await createSkillMcpClient(
        {
          sourceSkill: "research",
          name: "local-index",
          transport: "stdio",
          command: "node",
          args: ["server.js", `--token=${secret}`],
          readRoots: ["/trusted/skill"],
          network: false,
        },
        { configDir, processSandbox: sandbox(), createStdioClient },
      );
    }

    expect(await readdir(configDir)).toEqual([]);
    expect(await readdir(outside)).toEqual(["preserved.txt"]);
    expect(JSON.stringify(
      createStdioClient.mock.calls.map(([observed]) => observed.sandboxPolicy),
    )).not.toContain("skill-mcp-private-arg-candidate");
  });

  it("unlinks a legacy parent symlink without traversing its target", async () => {
    const configDir = await tempDir();
    const outside = await tempDir();
    await mkdir(path.join(outside, "0123456789abcdef01234567"));
    await writeFile(path.join(outside, "preserved.txt"), "preserved", "utf8");
    await symlink(outside, path.join(configDir, "mcp-process-sandbox"));

    await createSkillMcpClient(
      {
        sourceSkill: "research",
        name: "local-index",
        transport: "stdio",
        command: "node",
        args: ["server.js", "private-candidate"],
        readRoots: ["/trusted/skill"],
        network: false,
      },
      {
        configDir,
        processSandbox: sandbox(),
        createStdioClient: () => client(),
      },
    );

    expect(await readdir(configDir)).toEqual([]);
    expect((await readdir(outside)).sort()).toEqual([
      "0123456789abcdef01234567",
      "preserved.txt",
    ]);
  });

  it("fails closed when stdio activation has no trusted read root", async () => {
    const configDir = await tempDir();
    const createStdioClient = vi.fn((_config: McpServerConfig) => client());

    await expect(
      createSkillMcpClient(
        {
          sourceSkill: "research",
          name: "local-index",
          transport: "stdio",
          command: "node",
          args: ["server.js"],
          readRoots: [],
          network: false,
        },
        { configDir, processSandbox: sandbox(), createStdioClient },
      ),
    ).rejects.toThrow("requires a trusted read root");
    expect(createStdioClient).not.toHaveBeenCalled();
    expect(await readdir(configDir)).toEqual([]);
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
