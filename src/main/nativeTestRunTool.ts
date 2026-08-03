import { spawn, type ChildProcess } from "node:child_process";
import type { AgentToolExecutionResult } from "./dynamicToolRegistry";

const maxOutputBytes = 1024 * 1024 * 8;

export async function runNativeTestCommand(args: {
  workspaceRoot: string;
  command: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<AgentToolExecutionResult> {
  const workspaceRoot = String(args.workspaceRoot ?? "");
  const command = String(args.command ?? "").trim();
  const timeoutMs = Math.max(
    1000,
    Math.min(Number(args.timeoutMs ?? 120000), 600000),
  );

  if (!workspaceRoot) {
    return { ok: false, error: "test_run requires workspaceRoot." };
  }
  if (!command) {
    return { ok: false, error: "test_run command is required." };
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let stdout = "";
    let stderr = "";
    let abortHandler: (() => void) | null = null;
    const settle = (result: AgentToolExecutionResult) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (abortHandler) {
        args.signal?.removeEventListener("abort", abortHandler);
      }
      resolve(result);
    };
    const child = spawn(command, {
      cwd: workspaceRoot,
      shell: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout = appendCappedOutput(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = appendCappedOutput(stderr, chunk);
    });
    child.once("error", (error) => {
      settle({
        ok: false,
        error: `test_run failed to start: ${error.message}`,
        errorDetails: {
          kind: "spawn_error",
          command,
          cwd: workspaceRoot,
          exitCode: null,
          stdout,
          stderr,
          timeoutMs,
        },
      });
    });
    child.once("close", (exitCode) => {
      if (exitCode !== 0) {
        settle({
          ok: false,
          error: `test_run failed with exit code ${exitCode ?? 0}.`,
          errorDetails: {
            kind: "exit",
            command,
            cwd: workspaceRoot,
            exitCode: exitCode ?? 0,
            stdout,
            stderr,
            timeoutMs,
          },
        });
        return;
      }
      settle({
        ok: true,
        result: {
          command,
          cwd: workspaceRoot,
          exitCode: 0,
          stdout,
          stderr,
          timeoutMs,
        },
      });
    });

    timeoutHandle = setTimeout(() => {
      terminateProcessTree(child);
      settle({
        ok: false,
        error: `test_run timed out after ${timeoutMs} ms.`,
        errorDetails: {
          kind: "timeout",
          command,
          cwd: workspaceRoot,
          exitCode: 0,
          stdout,
          stderr,
          timeoutMs,
        },
      });
    }, timeoutMs);

    abortHandler = () => {
      terminateProcessTree(child);
      settle({
        ok: false,
        error: "test_run was canceled.",
        errorDetails: {
          kind: "canceled",
          command,
          cwd: workspaceRoot,
          stdout,
          stderr,
        },
      });
    };
    args.signal?.addEventListener("abort", abortHandler, { once: true });
    if (args.signal?.aborted) {
      abortHandler();
    }
  });
}

function appendCappedOutput(
  current: string,
  chunk: Buffer | string,
): string {
  if (Buffer.byteLength(current) >= maxOutputBytes) {
    return current;
  }
  const next = current + chunk.toString();
  if (Buffer.byteLength(next) <= maxOutputBytes) {
    return next;
  }
  return Buffer.from(next).subarray(0, maxOutputBytes).toString();
}

function terminateProcessTree(
  child: ChildProcess,
): void {
  const pid = child.pid;
  if (!pid) {
    child.kill("SIGKILL");
    return;
  }
  if (process.platform === "win32") {
    child.kill("SIGKILL");
    const treeKiller = spawn(
      "taskkill",
      ["/pid", String(pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    treeKiller.unref();
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }

  const forceKillHandle = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // The process group already exited.
    }
  }, 250);
  forceKillHandle.unref();
}
