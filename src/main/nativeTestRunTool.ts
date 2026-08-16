import type { AgentToolExecutionResult } from "./dynamicToolRegistry";
import type { AgentRunContext } from "../shared/agentWorkspace";
import {
  buildMinimalProcessEnv,
  isProcessSandboxUnavailableError,
  processSandboxPolicyFromRunContext,
  type ConfinedProcess,
  type ProcessSandboxProvider,
} from "./processSandbox";
import { runOwnedProcess } from "./ownedProcess";

const maxOutputBytes = 1024 * 1024 * 8;

export async function runNativeTestCommand(args: {
  workspaceRoot: string;
  command: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  processSandbox?: ProcessSandboxProvider;
  runContext?: AgentRunContext;
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

  let confined: ConfinedProcess | undefined;
  if (args.processSandbox) {
    if (!args.runContext) {
      return processSandboxUnavailable(
        "test_run requires a run context for process confinement.",
      );
    }
    try {
      confined = args.processSandbox.confine(
        [process.platform === "darwin" ? "/bin/zsh" : "/bin/sh", "-lc", command],
        processSandboxPolicyFromRunContext(args.runContext),
      );
    } catch (error) {
      return processSandboxUnavailable(
        error instanceof Error ? error.message : String(error),
        isProcessSandboxUnavailableError(error)
          ? error.backend
          : "unavailable",
      );
    }
  }

  const processResult = await runOwnedProcess({
    command: confined?.argv[0] ?? command,
    args: confined ? confined.argv.slice(1) : [],
    cwd: workspaceRoot,
    env: confined
      ? confined.buildChildEnv(process.env)
      : buildMinimalProcessEnv(process.env),
    shell: confined ? false : true,
    timeoutMs,
    signal: args.signal,
    maxOutputBytes,
  });

  let result: AgentToolExecutionResult;
  if (processResult.terminal === "spawn_error") {
    result = {
      ok: false,
      error: `test_run failed to start: ${
        processResult.error?.message ?? "unknown spawn error"
      }`,
      errorDetails: {
        kind: "spawn_error",
        command,
        cwd: workspaceRoot,
        exitCode: null,
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        timeoutMs,
        ...sandboxDetails(confined, processResult.stderr),
      },
    };
  } else if (processResult.terminal === "timeout") {
    result = {
      ok: false,
      error: `test_run timed out after ${timeoutMs} ms.`,
      errorDetails: {
        kind: "timeout",
        command,
        cwd: workspaceRoot,
        exitCode: 0,
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        timeoutMs,
        ...sandboxDetails(confined, processResult.stderr),
      },
    };
  } else if (processResult.terminal === "canceled") {
    result = {
      ok: false,
      error: "test_run was canceled.",
      errorDetails: {
        kind: "canceled",
        command,
        cwd: workspaceRoot,
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        ...sandboxDetails(confined, processResult.stderr),
      },
    };
  } else if (processResult.exitCode !== 0) {
    result = {
      ok: false,
      error: `test_run failed with exit code ${processResult.exitCode ?? 0}.`,
      errorDetails: {
        kind: isSandboxDenied(confined, processResult.stderr)
          ? "sandbox_denied"
          : "exit",
        command,
        cwd: workspaceRoot,
        exitCode: processResult.exitCode ?? 0,
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        timeoutMs,
        ...sandboxDetails(confined, processResult.stderr),
      },
    };
  } else {
    result = {
      ok: true,
      result: {
        command,
        cwd: workspaceRoot,
        exitCode: 0,
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        timeoutMs,
        ...sandboxDetails(confined, processResult.stderr),
      },
    };
  }

  if (confined) {
    try {
      await confined.cleanup();
    } catch (error) {
      return result.ok
        ? processSandboxCleanupFailure(error)
        : appendCleanupFailure(result, error);
    }
  }
  return result;
}

function processSandboxCleanupFailure(
  error: unknown,
): AgentToolExecutionResult {
  const reason = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: `Process sandbox cleanup failed: ${reason}`,
    errorDetails: {
      kind: "process_sandbox_cleanup_failed",
      reason,
    },
  };
}

function appendCleanupFailure(
  result: Extract<AgentToolExecutionResult, { ok: false }>,
  error: unknown,
): AgentToolExecutionResult {
  const reason = error instanceof Error ? error.message : String(error);
  return {
    ...result,
    errorDetails: {
      ...result.errorDetails,
      processSandboxCleanupFailure: reason,
    },
  };
}

function processSandboxUnavailable(
  reason: string,
  backend = "unavailable",
): AgentToolExecutionResult {
  return {
    ok: false,
    error: `Process sandbox unavailable: ${reason}`,
    errorDetails: {
      kind: "process_sandbox_unavailable",
      backend,
      reason,
    },
  };
}

function sandboxDetails(
  confined: ConfinedProcess | undefined,
  stderr: string,
): Record<string, unknown> {
  if (!confined) return {};
  return {
    sandboxBackend: confined.backend,
    sandboxEnforcement: confined.enforcement,
    sandboxDenied: isSandboxDenied(confined, stderr),
  };
}

function isSandboxDenied(
  confined: ConfinedProcess | undefined,
  stderr: string,
): boolean {
  return Boolean(
    confined?.denialSignatures.some((signature) =>
      stderr.toLowerCase().includes(signature),
    ),
  );
}
