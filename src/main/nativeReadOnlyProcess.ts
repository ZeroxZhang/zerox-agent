import type { ProcessSandboxProvider } from "./processSandbox";
import {
  buildMinimalProcessEnv,
  type ConfinedProcess,
} from "./processSandbox";
import {
  runOwnedProcess,
  type OwnedProcessResult,
} from "./ownedProcess";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024 * 4;

export async function runReadOnlyNativeProcess(args: {
  argv: readonly string[];
  workspaceRoot: string;
  signal?: AbortSignal;
  processSandbox?: ProcessSandboxProvider;
  timeoutMs?: number;
  maxOutputBytes?: number;
  additionalEnv?: Readonly<Record<string, string>>;
}): Promise<OwnedProcessResult> {
  const argv = args.argv.map(String);
  if (!argv[0]?.trim()) {
    throw new Error("Read-only native process requires a non-empty argv.");
  }
  if (!args.workspaceRoot) {
    throw new Error("Read-only native process requires workspaceRoot.");
  }
  if (args.signal?.aborted) {
    return canceledProcessResult();
  }

  let confined: ConfinedProcess | undefined;
  if (args.processSandbox) {
    confined = args.processSandbox.confine(argv, {
      mode: "read_only",
      workspaceRoot: args.workspaceRoot,
      network: "none",
    });
  }

  let processResult: OwnedProcessResult | undefined;
  let processFailure: unknown;
  try {
    processResult = await runOwnedProcess({
      command: confined?.argv[0] ?? argv[0],
      args: confined ? confined.argv.slice(1) : argv.slice(1),
      cwd: args.workspaceRoot,
      env: confined
        ? confined.buildChildEnv(process.env, {
            ...args.additionalEnv,
          })
        : buildMinimalProcessEnv(process.env, {
            ...args.additionalEnv,
          }),
      shell: false,
      timeoutMs: positiveInteger(args.timeoutMs, DEFAULT_TIMEOUT_MS),
      signal: args.signal,
      maxOutputBytes: positiveInteger(
        args.maxOutputBytes,
        DEFAULT_MAX_OUTPUT_BYTES,
      ),
    });
  } catch (error) {
    processFailure = error;
  }

  let cleanupFailure: unknown;
  if (confined) {
    try {
      await confined.cleanup();
    } catch (error) {
      cleanupFailure = error;
    }
  }

  if (cleanupFailure) {
    const reason = errorMessage(cleanupFailure);
    const processReason = processFailure
      ? ` Process execution also failed: ${errorMessage(processFailure)}`
      : "";
    throw new Error(
      `Read-only native process sandbox cleanup failed: ${reason}.${processReason}`,
    );
  }
  if (processFailure) {
    throw processFailure;
  }
  return processResult!;
}

function canceledProcessResult(): OwnedProcessResult {
  return Object.freeze({
    terminal: "canceled",
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: "",
    killed: false,
  });
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  const parsed = Math.floor(Number(value ?? fallback));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
