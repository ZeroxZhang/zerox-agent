import { exec } from "node:child_process";
import type { AgentToolExecutionResult } from "./dynamicToolRegistry";

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
    const settle = (result: AgentToolExecutionResult) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    };
    const child = exec(
      command,
      {
        cwd: workspaceRoot,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 8,
      },
      (error, stdout, stderr) => {
        const execError = error as
          | (Error & { code?: number | string; killed?: boolean })
          | null;
        const exitCode =
          typeof execError?.code === "number" ? Number(execError.code) : 0;
        if (error) {
          settle({
            ok: false,
            error: execError?.killed
              ? `test_run timed out after ${timeoutMs} ms.`
              : `test_run failed with exit code ${exitCode}.`,
            errorDetails: {
              kind: execError?.killed
                ? "timeout"
                : "exit",
              command,
              cwd: workspaceRoot,
              exitCode,
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
      },
    );

    args.signal?.addEventListener(
      "abort",
      () => {
        child.kill();
        settle({
          ok: false,
          error: "test_run was canceled.",
          errorDetails: { kind: "canceled", command, cwd: workspaceRoot },
        });
      },
      { once: true },
    );
  });
}
