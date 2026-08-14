import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("production process sandbox boundary", () => {
  it("injects one provider into command tools and stdio MCP", () => {
    const container = read("src/main/container.ts");

    expect(container).toContain("createProcessSandboxProvider");
    expect(container).toContain(
      "processSandbox: processSandboxProvider()",
    );
    expect(container).toContain(
      "processSandbox: processSandboxProvider(),",
    );
    expect(container).toContain('"mcp-process-sandbox"');
    expect(container).toContain("sandboxPolicy:");
  });

  it("confines every arbitrary model-reachable process before spawn", () => {
    const executor = read("src/main/agentToolExecutor.ts");
    const testRunner = read("src/main/nativeTestRunTool.ts");
    const mcp = read("src/main/mcpClient.ts");

    expect(executor).toContain("processSandbox.confine(");
    expect(executor).toContain("execFileAsync(confined.argv[0]!");
    expect(executor).toContain("shell: false");
    expect(testRunner).toContain("args.processSandbox.confine(");
    expect(testRunner).toContain("spawn(confined.argv[0]!");
    expect(testRunner).toContain("shell: false");
    expect(mcp).toContain("config.processSandbox.confine(");
    expect(mcp).toContain("const proc = spawn(command, commandArgs");
  });

  it("has no production unconfined feature mode", () => {
    const flags = read("src/shared/featureFlags.ts");
    const decision = read(".zerox/decisions/RC04-os-process-sandbox.md");

    expect(flags).toContain(
      'ZEROX_PROCESS_SANDBOX: "required" | "deny"',
    );
    expect(flags).toContain('ZEROX_PROCESS_SANDBOX: "required"');
    expect(flags).not.toMatch(
      /ZEROX_PROCESS_SANDBOX:[^\n]*(?:off|unconfined|permissive)/,
    );
    expect(decision).toContain("There is no production `unconfined` mode.");
  });

  it("keeps script-backed model tools disabled pending their own sandbox activation", () => {
    const container = read("src/main/container.ts");

    expect(container).toContain(
      "Script-backed manifest tools are intentionally not registered here.",
    );
    expect(container).toContain(
      "They require a separate activation that maps each manifest permission",
    );
  });
});

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}
