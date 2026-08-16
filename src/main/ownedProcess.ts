import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";

export type OwnedProcessTerminal =
  | "exit"
  | "spawn_error"
  | "timeout"
  | "canceled";

export type OwnedProcessResult = Readonly<{
  terminal: OwnedProcessTerminal;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  killed: boolean;
  error?: Error;
}>;

export async function runOwnedProcess(options: {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  shell?: SpawnOptions["shell"];
  timeoutMs: number;
  signal?: AbortSignal;
  maxOutputBytes: number;
}): Promise<OwnedProcessResult> {
  return new Promise((resolve) => {
    let child: ChildProcess | undefined;
    let stdout = "";
    let stderr = "";
    let timeoutHandle: NodeJS.Timeout | undefined;
    let abortHandler: (() => void) | undefined;
    let finishing = false;
    let termination: Promise<void> | undefined;

    const terminate = () => {
      termination ??= child
        ? terminateOwnedProcessTree(child)
        : Promise.resolve();
      return termination;
    };
    const finish = (terminal: {
      terminal: OwnedProcessTerminal;
      exitCode?: number | null;
      signal?: NodeJS.Signals | null;
      error?: Error;
    }) => {
      if (finishing) return;
      finishing = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (abortHandler) {
        options.signal?.removeEventListener("abort", abortHandler);
      }
      void terminate().then(() => {
        resolve({
          terminal: terminal.terminal,
          exitCode: terminal.exitCode ?? child?.exitCode ?? null,
          signal: terminal.signal ?? child?.signalCode ?? null,
          stdout,
          stderr,
          killed:
            terminal.terminal === "timeout" ||
            terminal.terminal === "canceled",
          ...(terminal.error ? { error: terminal.error } : {}),
        });
      });
    };

    try {
      child = spawn(options.command, [...(options.args ?? [])], {
        cwd: options.cwd,
        env: options.env,
        shell: options.shell ?? false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      finish({
        terminal: "spawn_error",
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return;
    }

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout = appendCappedOutput(
        stdout,
        chunk,
        options.maxOutputBytes,
      );
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = appendCappedOutput(
        stderr,
        chunk,
        options.maxOutputBytes,
      );
    });
    child.once("error", (error) => {
      finish({ terminal: "spawn_error", error });
    });
    child.once("close", (exitCode, signal) => {
      finish({
        terminal: "exit",
        exitCode,
        signal,
      });
    });

    timeoutHandle = setTimeout(() => {
      finish({ terminal: "timeout" });
    }, options.timeoutMs);
    abortHandler = () => {
      finish({ terminal: "canceled" });
    };
    options.signal?.addEventListener("abort", abortHandler, { once: true });
    if (options.signal?.aborted) {
      abortHandler();
    }
  });
}

export async function terminateOwnedProcessTree(
  child: ChildProcess,
  graceMs = 250,
): Promise<void> {
  const pid = child.pid;
  if (process.platform === "win32") {
    if (pid) {
      await runWindowsTreeKill(pid);
    } else if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await waitForChildExit(child);
    return;
  }

  if (!pid) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await waitForChildExit(child);
    return;
  }

  if (!processGroupExists(pid)) {
    await waitForChildExit(child);
    return;
  }

  signalProcessGroup(pid, "SIGTERM");
  await delay(graceMs);
  if (processGroupExists(pid)) {
    signalProcessGroup(pid, "SIGKILL");
    await waitForProcessGroupExit(pid);
  }
  await waitForChildExit(child);
}

function appendCappedOutput(
  current: string,
  chunk: Buffer | string,
  maxOutputBytes: number,
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

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // The complete process group has already exited.
  }
}

async function waitForProcessGroupExit(
  pid: number,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(pid) && Date.now() < deadline) {
    await delay(10);
  }
}

async function waitForChildExit(
  child: ChildProcess,
  timeoutMs = 1_000,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    const finish = () => {
      clearTimeout(timeout);
      resolve();
    };
    child.once("exit", finish);
  });
}

async function runWindowsTreeKill(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const killer = spawn(
      "taskkill",
      ["/pid", String(pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    killer.once("error", () => resolve());
    killer.once("close", () => resolve());
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
