import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPrimaryRunContext } from "../shared/agentWorkspace";
import {
  createProcessSandboxProvider,
  type ProcessSandboxProvider,
} from "./processSandbox";
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
    let cleanupCount = 0;
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot,
    });

    await expect(
      runNativeTestCommand({
        workspaceRoot: missingRoot,
        command: `${JSON.stringify(process.execPath)} -e "process.exit(0)"`,
        timeoutMs: 5000,
        processSandbox: passthroughSandbox(() => {
          cleanupCount += 1;
        }),
        runContext,
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
    expect(cleanupCount).toBe(1);
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
        `const child = spawn(${JSON.stringify(process.execPath)}, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "inherit" });`,
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

  it("reports cleanup failure after success and preserves it beside command failure", async () => {
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot,
    });
    const processSandbox = passthroughSandbox(() => {
      throw new Error("native cleanup failed");
    });

    await expect(
      runNativeTestCommand({
        workspaceRoot,
        command: "exit 0",
        timeoutMs: 5_000,
        processSandbox,
        runContext,
      }),
    ).resolves.toMatchObject({
      ok: false,
      errorDetails: {
        kind: "process_sandbox_cleanup_failed",
        reason: "native cleanup failed",
      },
    });
    await expect(
      runNativeTestCommand({
        workspaceRoot,
        command: "exit 9",
        timeoutMs: 5_000,
        processSandbox,
        runContext,
      }),
    ).resolves.toMatchObject({
      ok: false,
      errorDetails: {
        kind: "exit",
        exitCode: 9,
        processSandboxCleanupFailure: "native cleanup failed",
      },
    });
  });

  it.skipIf(process.env.ZEROX_V392_OUTER_SANDBOX === "1")(
    "cleans private temps after real Seatbelt timeout and abort",
    async () => {
    if (process.platform !== "darwin") return;
    const privateTempRoot = await mkdtemp(
      path.join(os.tmpdir(), "zerox-test-private-root-"),
    );
    const processSandbox = createProcessSandboxProvider({
      tempRoot: privateTempRoot,
    });
    const runContext = buildPrimaryRunContext({
      workspaceId: "workspace_1",
      workspaceRoot,
    });

    try {
      await expect(
        runNativeTestCommand({
          workspaceRoot,
          command: "npm --version",
          timeoutMs: 5_000,
          processSandbox,
          runContext,
        }),
      ).resolves.toMatchObject({
        ok: true,
        result: {
          exitCode: 0,
          stdout: expect.stringMatching(/^\d+\.\d+\.\d+\s*$/),
        },
      });
      expect(await readdir(privateTempRoot)).toEqual([]);

      await expect(
        runNativeTestCommand({
          workspaceRoot,
          command: "sleep 5",
          timeoutMs: 1_000,
          processSandbox,
          runContext,
        }),
      ).resolves.toMatchObject({
        ok: false,
        errorDetails: { kind: "timeout" },
      });
      expect(await readdir(privateTempRoot)).toEqual([]);

      const controller = new AbortController();
      const execution = runNativeTestCommand({
        workspaceRoot,
        command: "sleep 5",
        timeoutMs: 5_000,
        signal: controller.signal,
        processSandbox,
        runContext,
      });
      setTimeout(() => controller.abort(new Error("abort fixture")), 25);
      await expect(execution).resolves.toMatchObject({
        ok: false,
        errorDetails: { kind: "canceled" },
      });
      expect(await readdir(privateTempRoot)).toEqual([]);
    } finally {
      await rm(privateTempRoot, { recursive: true, force: true });
    }
    },
  );
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

function passthroughSandbox(
  cleanup: () => void | Promise<void>,
): ProcessSandboxProvider {
  return {
    status() {
      return {
        available: true,
        backend: "seatbelt",
        enforcement: "read-write-and-network-policy",
      };
    },
    confine(argv, policy) {
      return {
        argv,
        backend: "seatbelt",
        enforcement: "read-write-and-network-policy",
        denialSignatures: ["operation not permitted"],
        readableRoots: [policy.workspaceRoot],
        writableRoots: [policy.workspaceRoot],
        network: policy.network,
        privateTempDir: policy.workspaceRoot,
        buildChildEnv(parentEnv, configuredEnv = {}) {
          return {
            ...parentEnv,
            ...configuredEnv,
            TMPDIR: policy.workspaceRoot,
            TMP: policy.workspaceRoot,
            TEMP: policy.workspaceRoot,
          };
        },
        async cleanup() {
          await cleanup();
        },
      };
    },
  };
}
