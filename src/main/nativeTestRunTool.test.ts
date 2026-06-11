import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runNativeTestCommand } from "./nativeTestRunTool";

describe("native test run tool", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "zerox-test-run-"));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("returns structured output for a successful test command", async () => {
    const command = `${JSON.stringify(process.execPath)} -e "console.log('pass')"`;

    await expect(
      runNativeTestCommand({ workspaceRoot, command, timeoutMs: 5000 }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        command,
        cwd: workspaceRoot,
        exitCode: 0,
        stdout: "pass\n",
        stderr: "",
      },
    });
  });

  it("returns structured diagnostics for a failing test command", async () => {
    const command = `${JSON.stringify(process.execPath)} -e "console.error('fail'); process.exit(2)"`;

    await expect(
      runNativeTestCommand({ workspaceRoot, command, timeoutMs: 5000 }),
    ).resolves.toMatchObject({
      ok: false,
      error: "test_run failed with exit code 2.",
      errorDetails: {
        kind: "exit",
        command,
        exitCode: 2,
        stderr: "fail\n",
      },
    });
  });
});
