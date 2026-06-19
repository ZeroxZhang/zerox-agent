import { describe, expect, it } from "vitest";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createToolWorker } from "./toolWorker";
import type { ToolHandler } from "./toolWorkerProtocol";
import { getToolWorkerOptions } from "./toolWorkerOptions";
import type { AgentSandboxPolicy } from "../../shared/agentWorkspace";

const sandbox: AgentSandboxPolicy = {
  mode: "workspace_write",
  network: "none",
  shell: "workspace_only",
  allowWorkspaceEscape: false,
  extraReadRoots: [],
  extraWriteRoots: [],
};

describe("ToolWorker inproc mode", () => {
  it("dispatches to a registered handler and returns the result", async () => {
    const handlers: Record<string, ToolHandler> = {
      add: async (args) => {
        const { a, b } = args as { a: number; b: number };
        return a + b;
      },
    };
    const worker = createToolWorker({ mode: "inproc", handlers });
    const res = await worker.execute("add", { a: 2, b: 3 }, {
      sandboxPolicy: sandbox, workspaceRoot: "/tmp", runId: "r1",
    });
    expect(res.ok).toBe(true);
    expect(res.result).toBe(5);
    worker.close();
  });

  it("returns a structured error for an unknown tool", async () => {
    const worker = createToolWorker({ mode: "inproc", handlers: {} });
    const res = await worker.execute("nope", {}, { sandboxPolicy: sandbox, workspaceRoot: "/tmp", runId: "r1" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("no handler");
    worker.close();
  });

  it("catches handler throws and returns a structured error", async () => {
    const handlers: Record<string, ToolHandler> = {
      boom: async () => { throw new Error("kaboom"); },
    };
    const worker = createToolWorker({ mode: "inproc", handlers });
    const res = await worker.execute("boom", {}, { sandboxPolicy: sandbox, workspaceRoot: "/tmp", runId: "r1" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("kaboom");
    worker.close();
  });
});

describe("ToolWorker subprocess mode", () => {
  it("round-trips an execute request over IPC to a forked entry", async () => {
    // Write a minimal JS entry that speaks the WorkerRequest/Response protocol.
    const dir = join(tmpdir(), `zerox-worker-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const entry = join(dir, "entry.mjs");
    const entrySrc = `
      process.on("message", (msg) => {
        if (msg.kind === "ping") { process.send({ kind: "result", id: msg.id, ok: true, result: "pong" }); return; }
        if (msg.kind === "shutdown") { process.exit(0); }
        if (msg.kind === "execute") {
          const { toolName, args } = msg.ctx;
          if (toolName === "echo") { process.send({ kind: "result", id: msg.id, ok: true, result: { echoed: args } }); }
          else { process.send({ kind: "result", id: msg.id, ok: false, error: "no handler for " + toolName }); }
        }
      });
    `;
    writeFileSync(entry, entrySrc, "utf8");

    const worker = createToolWorker({ mode: "subprocess", entryModulePath: entry, timeoutMs: 5000 });
    try {
      const res = await worker.execute("echo", { hello: "world" }, {
        sandboxPolicy: sandbox, workspaceRoot: "/tmp", runId: "r1",
      });
      expect(res.ok).toBe(true);
      expect(res.result).toEqual({ echoed: { hello: "world" } });
    } finally {
      worker.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});

describe("toolWorkerOptions", () => {
  it("defaults to subprocess + shadow", () => {
    const opts = getToolWorkerOptions({});
    expect(opts.worker).toBe("subprocess");
    expect(opts.shellAnalyzer).toBe("shadow");
  });

  it("respects ZEROX_TOOL_WORKER and the BUILDING_AGENT_ legacy alias", () => {
    expect(getToolWorkerOptions({ ZEROX_TOOL_WORKER: "inproc" }).worker).toBe("inproc");
    expect(getToolWorkerOptions({ BUILDING_AGENT_TOOL_WORKER: "inproc" }).worker).toBe("inproc");
  });

  it("respects ZEROX_SHELL_ANALYZER", () => {
    expect(getToolWorkerOptions({ ZEROX_SHELL_ANALYZER: "legacy" }).shellAnalyzer).toBe("legacy");
    expect(getToolWorkerOptions({ ZEROX_SHELL_ANALYZER: "plan" }).shellAnalyzer).toBe("plan");
  });
});
