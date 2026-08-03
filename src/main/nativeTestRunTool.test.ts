import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  it("distinguishes runner startup failure from an observed command exit", async () => {
    const missingRoot = path.join(workspaceRoot, "missing-root");

    await expect(
      runNativeTestCommand({
        workspaceRoot: missingRoot,
        command: `${JSON.stringify(process.execPath)} -e "process.exit(0)"`,
        timeoutMs: 5000,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("test_run failed to start"),
      errorDetails: {
        kind: "spawn_error",
        cwd: missingRoot,
        exitCode: null,
      },
    });
  });

  it("times out and terminates descendant processes that keep stdio open", async () => {
    if (process.platform === "win32") {
      return;
    }

    const descendantPidPath = path.join(workspaceRoot, "descendant.pid");
    const scriptPath = path.join(workspaceRoot, "spawn-descendant.mjs");
    await writeFile(
      scriptPath,
      [
        'import { spawn } from "node:child_process";',
        'import { writeFileSync } from "node:fs";',
        `const child = spawn(${JSON.stringify(process.execPath)}, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });`,
        `writeFileSync(${JSON.stringify(descendantPidPath)}, String(child.pid));`,
        "child.unref();",
      ].join("\n"),
      "utf8",
    );

    const startedAt = Date.now();
    await expect(
      runNativeTestCommand({
        workspaceRoot,
        command: `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`,
        timeoutMs: 1000,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: "test_run timed out after 1000 ms.",
      errorDetails: {
        kind: "timeout",
      },
    });
    expect(Date.now() - startedAt).toBeLessThan(5000);

    const descendantPid = Number(await readFile(descendantPidPath, "utf8"));
    await expectProcessToExit(descendantPid);
  });
});

async function expectProcessToExit(pid: number): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Descendant process ${pid} was not terminated.`);
}
