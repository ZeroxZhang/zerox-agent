import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("production process sandbox boundary", () => {
  it("injects one provider into command tools and stdio MCP", () => {
    const container = read("src/main/container.ts");
    const skillMcpClient = read("src/main/skillMcpClient.ts");

    expect(container).toContain("createProcessSandboxProvider");
    expect(container).toContain(
      "processSandbox: processSandboxProvider()",
    );
    expect(container).toContain(
      "processSandbox: processSandboxProvider(),",
    );
    expect(container).toContain(
      "processSandbox: processSandboxProvider()",
    );
    expect(skillMcpClient).toContain('"mcp-process-sandbox"');
    expect(skillMcpClient).toContain(
      "processSandbox: options.processSandbox",
    );
    expect(skillMcpClient).toContain("sandboxPolicy:");
    expect(skillMcpClient).toContain("extraReadRoots: config.readRoots");
  });

  it("confines every arbitrary model-reachable process before spawn", () => {
    const executor = read("src/main/agentToolExecutor.ts");
    const testRunner = read("src/main/nativeTestRunTool.ts");
    const mcp = read("src/main/mcpClient.ts");
    const sandbox = read("src/main/processSandbox.ts");
    const ownedProcess = read("src/main/ownedProcess.ts");

    expect(executor).toContain("processSandbox.confine(");
    expect(executor).toContain("runOwnedProcess({");
    expect(executor).toContain("confined.buildChildEnv(process.env)");
    expect(testRunner).toContain("args.processSandbox.confine(");
    expect(testRunner).toContain("runOwnedProcess({");
    expect(testRunner).toContain("confined.buildChildEnv(process.env)");
    expect(mcp).toContain("config.processSandbox.confine(");
    expect(mcp).toContain("proc = spawn(command, commandArgs");
    expect(mcp).toContain("ownedProcesses.set(proc");
    expect(mcp).toContain("await releaseOwnedProcess(proc)");
    expect(executor).toContain("await confined.cleanup()");
    expect(testRunner).toContain("await confined.cleanup()");
    expect(ownedProcess).toContain("terminateOwnedProcessTree");
    expect(ownedProcess).toContain('signalProcessGroup(pid, "SIGKILL")');
    expect(sandbox).toContain("createPrivateTempDirectory(tempRoot)");
    expect(sandbox).toContain("privateTempDir");
    expect(sandbox).toContain("buildChildEnv");
    expect(sandbox).not.toContain("privateTempDir?: string");
    expect(sandbox).not.toContain('    "/tmp",');
  });

  it("routes native code and Git reads through one owned read-only adapter", () => {
    const adapter = read("src/main/nativeReadOnlyProcess.ts");
    const codeTools = read("src/main/nativeCodeTools.ts");
    const gitTools = read("src/main/nativeGitTools.ts");
    const executor = read("src/main/agentToolExecutor.ts");

    expect(adapter).toContain("runOwnedProcess({");
    expect(adapter).toContain("buildMinimalProcessEnv(process.env");
    expect(adapter).toContain('mode: "read_only"');
    expect(adapter).toContain('network: "none"');
    expect(adapter).toContain("signal: args.signal");
    expect(adapter).toContain("await confined.cleanup()");
    expect(codeTools).not.toContain("node:child_process");
    expect(gitTools).not.toContain("node:child_process");
    expect(codeTools).toMatch(
      /"-e",\s*query,\s*"--",\s*workspaceRoot/,
    );
    expect(gitTools).toContain('"core.hooksPath=/dev/null"');
    expect(gitTools).toContain('"core.fsmonitor=false"');
    expect(gitTools).toContain('"core.pager=cat"');
    expect(gitTools).toContain('"diff.external="');
    expect(gitTools).toContain('"--no-ext-diff"');
    expect(gitTools).toContain('"--no-textconv"');
    expect(executor).toMatch(
      /searchCode\(\{[\s\S]*?signal: executionOptions\?\.signal,[\s\S]*?processSandbox: options\.processSandbox/,
    );
    expect(executor).toMatch(
      /readGitStatus\(\{[\s\S]*?signal: executionOptions\?\.signal,[\s\S]*?processSandbox: options\.processSandbox/,
    );
    expect(executor).toMatch(
      /readGitDiff\(\{[\s\S]*?signal: executionOptions\?\.signal,[\s\S]*?processSandbox: options\.processSandbox/,
    );
  });

  it("keeps scoped tool-result refs behind committed metadata", () => {
    const offloadStore = read("src/main/toolResultOffloadStore.ts");
    const metadataCommit = offloadStore.indexOf(
      "await rename(metadataTempPath, metadataPath(absolutePath));",
    );
    const contentCommit = offloadStore.indexOf(
      "await rename(contentTempPath, absolutePath);",
    );

    expect(offloadStore).toContain("Promise.allSettled([");
    expect(offloadStore).toContain("contentSha256: hashContent(input.content)");
    expect(metadataCommit).toBeGreaterThan(-1);
    expect(contentCommit).toBeGreaterThan(metadataCommit);
    expect(offloadStore).toContain("return scope === undefined;");
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
