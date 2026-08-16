import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { acquireProductionSmokeLock } from "./production-smoke-lock.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skipBuild = process.argv.includes("--skip-build");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const signalExitCodes = {
  SIGINT: 130,
  SIGTERM: 143,
};

let interruptedSignal = null;
let exitCode = 1;
let lock = null;
const interruption = new AbortController();

const handleSignal = (signal) => {
  interruptedSignal ??= signal;
  if (!interruption.signal.aborted) {
    interruption.abort(
      new Error(`Production smoke interrupted by ${signal}.`),
    );
  }
  console.error(
    `[smoke:runner] received ${signal}; waiting for native ABI cleanup.`,
  );
};
const signalHandlers = new Map(
  Object.keys(signalExitCodes).map((signal) => [
    signal,
    () => handleSignal(signal),
  ]),
);
for (const [signal, handler] of signalHandlers) {
  process.on(signal, handler);
}

try {
  lock = await acquireProductionSmokeLock({ rootDir });

  if (interruptedSignal) {
    throw new Error(
      `Production smoke interrupted by ${interruptedSignal} before build.`,
    );
  }

  if (!skipBuild) {
    const build = await runOwnedCommand(npmBin, ["run", "build"], {
      cwd: rootDir,
      env: process.env,
      signal: interruption.signal,
      timeoutMs: 10 * 60_000,
    });
    if (build.error) {
      throw new Error(`Production smoke build failed: ${build.error.message}`);
    }
    if (build.status !== 0 || build.signal) {
      exitCode = build.status ?? 1;
      throw new Error(
        build.signal
          ? `Production smoke build exited with signal ${build.signal}.`
          : `Production smoke build exited with status ${build.status}.`,
      );
    }
  }

  if (interruptedSignal) {
    throw new Error(
      `Production smoke interrupted by ${interruptedSignal} before native ABI mutation.`,
    );
  }

  const runnerUrl = pathToFileURL(
    resolve(rootDir, "dist-electron", "shared", "productionSmokeRunner.js"),
  ).href;
  const { runProductionSmoke } = await import(runnerUrl);
  const result = await runProductionSmoke({
    rootDir,
    env: process.env,
    signal: interruption.signal,
    temporaryRoot: lock.path,
  });

  if (result.ok) {
    console.log(
      `[smoke:runner] production smoke accepted ${JSON.stringify(result.evidence)}`,
    );
    exitCode = 0;
  } else {
    console.error(
      `[smoke:runner] production smoke rejected at ${result.primaryFailure?.stage}: ` +
        `${result.primaryFailure?.message}`,
    );
    for (const cleanupFailure of result.cleanupFailures) {
      console.error(
        `[smoke:runner] cleanup failure at ${cleanupFailure.stage}: ${cleanupFailure.message}`,
      );
    }
    exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  if (lock) {
    try {
      await lock.release();
    } catch (error) {
      console.error(
        `[smoke:runner] cleanup failure while releasing process lock: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      if (exitCode === 0) {
        exitCode = 1;
      }
    }
  }
  for (const [signal, handler] of signalHandlers) {
    process.off(signal, handler);
  }
}

if (interruptedSignal) {
  exitCode = signalExitCodes[interruptedSignal] ?? 1;
}
process.exitCode = exitCode;

async function runOwnedCommand(command, args, options) {
  if (options.signal.aborted) {
    return {
      status: 1,
      signal: null,
      error: options.signal.reason,
    };
  }

  return new Promise((resolve) => {
    let child = null;
    let timeout = null;
    let settled = false;
    const finish = (result, terminate) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      options.signal.removeEventListener("abort", abort);
      void drainOwnedProcess(child, terminate).then(() => resolve(result));
    };
    const abort = () => {
      finish(
        {
          status: 1,
          signal: null,
          error:
            options.signal.reason instanceof Error
              ? options.signal.reason
              : new Error(String(options.signal.reason ?? "aborted")),
        },
        true,
      );
    };

    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        detached: process.platform !== "win32",
        stdio: "inherit",
        windowsHide: true,
      });
    } catch (error) {
      finish({ status: 1, signal: null, error }, true);
      return;
    }
    child.once("error", (error) => {
      finish({ status: 1, signal: null, error }, true);
    });
    child.once("close", (status, signal) => {
      finish({ status: status ?? 1, signal, error: null }, false);
    });
    timeout = setTimeout(() => {
      finish(
        {
          status: 1,
          signal: null,
          error: new Error(
            `Command timed out after ${options.timeoutMs} ms: ${command}`,
          ),
        },
        true,
      );
    }, options.timeoutMs);
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
  });
}

async function drainOwnedProcess(child, terminate) {
  if (!child) return;
  const pid = child.pid;
  if (process.platform === "win32") {
    if (pid && (terminate || processAlive(pid))) {
      await new Promise((resolve) => {
        const killer = spawn(
          "taskkill",
          ["/pid", String(pid), "/T", "/F"],
          { stdio: "ignore", windowsHide: true },
        );
        killer.once("error", resolve);
        killer.once("close", resolve);
      });
    }
    return;
  }
  if (!pid || !processGroupAlive(pid)) return;
  signalGroup(pid, "SIGTERM");
  await delay(500);
  if (processGroupAlive(pid)) {
    signalGroup(pid, "SIGKILL");
    const deadline = Date.now() + 2_000;
    while (processGroupAlive(pid) && Date.now() < deadline) {
      await delay(10);
    }
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function processGroupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    // The owned process group has already exited.
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
