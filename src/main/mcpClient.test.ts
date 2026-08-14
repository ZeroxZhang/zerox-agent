import { describe, expect, it } from "vitest";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildMcpChildEnv, createMcpClient } from "./mcpClient";
import type {
  ProcessSandboxPolicy,
  ProcessSandboxProvider,
} from "./processSandbox";
import { createProcessSandboxProvider } from "./processSandbox";

describe("MCP child environment", () => {
  it("inherits only process essentials and explicitly configured values", () => {
    expect(
      buildMcpChildEnv(
        {
          HOME: "/Users/demo",
          PATH: "/usr/bin:/bin",
          LANG: "en_US.UTF-8",
          OPENAI_API_KEY: "parent-secret",
          GITHUB_TOKEN: "parent-token",
        },
        {
          MCP_EXPLICIT_TOKEN: "configured-secret",
          PATH: "/opt/mcp/bin:/usr/bin:/bin",
        },
      ),
    ).toEqual({
      HOME: "/Users/demo",
      LANG: "en_US.UTF-8",
      PATH: "/opt/mcp/bin:/usr/bin:/bin",
      MCP_EXPLICIT_TOKEN: "configured-secret",
    });
  });
});

describe("stdio MCP cancellation", () => {
  it("requires process sandbox provider and policy together", () => {
    expect(() =>
      createMcpClient({
        name: "invalid-sandbox-config",
        transport: "stdio",
        command: process.execPath,
        processSandbox: passthroughSandbox([]),
      }),
    ).toThrow("must be configured together");
  });

  it("does not spawn an MCP server when the process sandbox denies execution", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "zerox-mcp-denied-"));
    const marker = path.join(dir, "started.txt");
    const script = path.join(dir, "server.mjs");
    await writeFile(
      script,
      `import { writeFile } from "node:fs/promises"; await writeFile(${JSON.stringify(marker)}, "started");`,
      "utf8",
    );
    const client = createMcpClient({
      name: "denied-fixture",
      transport: "stdio",
      command: process.execPath,
      args: [script],
      processSandbox: createProcessSandboxProvider({
        mode: "deny",
        platform: "darwin",
      }),
      sandboxPolicy: {
        mode: "workspace_write",
        workspaceRoot: dir,
        network: "allow",
      },
    });

    try {
      await expect(client.connect()).rejects.toThrow(
        'MCP server "denied-fixture" failed to connect.',
      );
      await expect(access(marker)).rejects.toThrow();
    } finally {
      await client.disconnect();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reaps a child that ignores SIGTERM when initialization fails", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "zerox-mcp-init-failure-"));
    const script = path.join(dir, "server.mjs");
    const pidFile = path.join(dir, "server.pid");
    await writeFile(
      script,
      `import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
await writeFile(${JSON.stringify(pidFile)}, String(process.pid), "utf8");
process.on("SIGTERM", () => {});
setTimeout(() => process.exit(0), 3_000);
createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -1, message: "fixture rejected initialization" },
    }) + "\\n");
  }
});\n`,
      "utf8",
    );
    const client = createMcpClient({
      name: "init-failure-fixture",
      transport: "stdio",
      command: process.execPath,
      args: [script],
    });
    try {
      await expect(client.connect()).rejects.toThrow(
        'MCP server "init-failure-fixture" failed to connect.',
      );
      const pid = Number(await readFile(pidFile, "utf8"));
      expect(isProcessAlive(pid)).toBe(false);
    } finally {
      await client.disconnect();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("waits for termination and lazily reconnects after an aborted tool call", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "zerox-mcp-cancel-"));
    const script = path.join(dir, "server.mjs");
    await writeFile(
      script,
      `import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }) + "\\n");
  } else if (request.method === "tools/list") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [] } }) + "\\n");
  } else if (request.method === "tools/call" && request.params?.arguments?.hang !== true) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "reconnected" }] } }) + "\\n");
  }
});\n`,
      "utf8",
    );
    const sandboxPolicies: ProcessSandboxPolicy[] = [];
    const client = createMcpClient({
      name: "fixture",
      transport: "stdio",
      command: process.execPath,
      args: [script],
      processSandbox: passthroughSandbox(sandboxPolicies),
      sandboxPolicy: {
        mode: "workspace_write",
        workspaceRoot: dir,
        network: "allow",
      },
    });
    try {
      await client.connect();
      const controller = new AbortController();
      const hanging = client.callTool("fixture", { hang: true }, {
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(new Error("cancel fixture")), 25);
      await expect(hanging).rejects.toThrow("cancel fixture");

      await expect(client.callTool("fixture", {})).resolves.toMatchObject({
        ok: true,
        result: { content: "reconnected" },
      });
      expect(sandboxPolicies).toHaveLength(2);
    } finally {
      await client.disconnect();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cancels a pending reconnect timer when an eager call reconnects first", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "zerox-mcp-reconnect-"));
    const script = path.join(dir, "server.mjs");
    const countFile = path.join(dir, "starts.txt");
    await writeFile(
      script,
      `import { appendFile } from "node:fs/promises";
import { createInterface } from "node:readline";
await appendFile(${JSON.stringify(countFile)}, "start\\n");
createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }) + "\\n");
  else if (request.method === "tools/list") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [] } }) + "\\n");
  else if (request.method === "tools/call") process.exit(1);
});\n`,
      "utf8",
    );
    const client = createMcpClient({
      name: "reconnect-fixture",
      transport: "stdio",
      command: process.execPath,
      args: [script],
    });
    try {
      await client.connect();
      await expect(client.callTool("crash", {})).rejects.toThrow(/exited/);
      await expect(client.listTools()).resolves.toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      expect((await readFile(countFile, "utf8")).trim().split("\n")).toHaveLength(2);
    } finally {
      await client.disconnect();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses every bounded reconnect attempt when initialization keeps failing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "zerox-mcp-retry-budget-"));
    const script = path.join(dir, "server.mjs");
    const countFile = path.join(dir, "starts.txt");
    await writeFile(
      script,
      `import { appendFile, readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
let previous = "";
try { previous = await readFile(${JSON.stringify(countFile)}, "utf8"); } catch {}
const startNumber = previous.trim() ? previous.trim().split("\\n").length + 1 : 1;
await appendFile(${JSON.stringify(countFile)}, "start\\n");
createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method !== "initialize") return;
  if (startNumber === 1) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }) + "\\n");
    setTimeout(() => process.exit(1), 25);
    return;
  }
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    id: request.id,
    error: { code: -1, message: "retry fixture rejected initialization" },
  }) + "\\n");
});\n`,
      "utf8",
    );
    const client = createMcpClient({
      name: "retry-budget-fixture",
      transport: "stdio",
      command: process.execPath,
      args: [script],
    });
    try {
      await client.connect();
      await waitForLineCount(countFile, 4, 9_000);
      expect((await readFile(countFile, "utf8")).trim().split("\n")).toHaveLength(4);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect((await readFile(countFile, "utf8")).trim().split("\n")).toHaveLength(4);
    } finally {
      await client.disconnect();
      await rm(dir, { recursive: true, force: true });
    }
  }, 12_000);
});

function passthroughSandbox(
  policies: ProcessSandboxPolicy[],
): ProcessSandboxProvider {
  return {
    status() {
      return {
        available: true,
        backend: "seatbelt",
        enforcement: "write-and-network-none",
      };
    },
    confine(argv, policy) {
      policies.push(structuredClone(policy));
      return {
        argv,
        backend: "seatbelt",
        enforcement: "write-and-network-none",
        denialSignatures: ["operation not permitted"],
        writableRoots: [policy.workspaceRoot],
        network: policy.network,
      };
    },
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForLineCount(
  file: string,
  expected: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const count = (await readFile(file, "utf8")).trim().split("\n").length;
      if (count >= expected) return;
    } catch {
      // The fixture creates the count file on its first process start.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${expected} MCP process starts.`);
}
