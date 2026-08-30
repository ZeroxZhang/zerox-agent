import {
  spawn,
  type ChildProcess,
} from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isProductionStorageSmokeEvidence } from "./productionSmoke";

export type ProductionSmokeCommandStage =
  | "node_preflight"
  | "node_rebuild"
  | "node_rebuild_confirmation"
  | "electron_rebuild"
  | "electron_preflight"
  | "electron_app"
  | "node_restore_rebuild"
  | "node_restore_probe";

export type ProductionSmokeFailure = {
  stage:
    | ProductionSmokeCommandStage
    | "backup"
    | "evidence"
    | "lockfile_integrity"
    | "temp_cleanup";
  message: string;
};

export type ProductionSmokeCommand = {
  stage: ProductionSmokeCommandStage;
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
};

export type ProductionSmokeRunResult = {
  ok: boolean;
  primaryFailure: ProductionSmokeFailure | null;
  cleanupFailures: ProductionSmokeFailure[];
  evidence: unknown;
};

type CommandResult = {
  status: number;
  signal?: NodeJS.Signals | null;
  error?: Error;
};

type ProductionSmokeDependencies = {
  copyFile: (source: string, destination: string) => Promise<void>;
  createTempDir: (temporaryRoot?: string) => Promise<string>;
  hashFile: (filePath: string) => Promise<string>;
  pathExists: (filePath: string) => boolean;
  readEvidence: (filePath: string) => Promise<unknown>;
  removeTempDir: (directory: string) => Promise<void>;
  runCommand: (
    input: ProductionSmokeCommand,
  ) => CommandResult | Promise<CommandResult>;
};

const defaultDependencies: ProductionSmokeDependencies = {
  copyFile: (source, destination) => copyFile(source, destination),
  createTempDir: (temporaryRoot = os.tmpdir()) =>
    mkdtemp(path.join(temporaryRoot, "zerox-production-smoke-")),
  async hashFile(filePath) {
    return createHash("sha256")
      .update(await readFile(filePath))
      .digest("hex");
  },
  pathExists: existsSync,
  async readEvidence(filePath) {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  },
  removeTempDir: (directory) =>
    rm(directory, { recursive: true, force: true }),
  runCommand: runOwnedSmokeCommand,
};

const nativeProbeTimeoutMs = 30_000;
const nativeRebuildTimeoutMs = 5 * 60_000;
const electronAppTimeoutGraceMs = 5_000;

function resolveElectronAppTimeoutMs(env: NodeJS.ProcessEnv): number {
  const configured = Number(env.BUILDING_AGENT_SMOKE_TIMEOUT_MS);
  const smokeTimeoutMs =
    Number.isFinite(configured) && configured > 0 ? configured : 10_000;
  return smokeTimeoutMs + electronAppTimeoutGraceMs;
}

export async function runProductionSmoke(options: {
  rootDir: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  temporaryRoot?: string;
  dependencies?: Partial<ProductionSmokeDependencies>;
}): Promise<ProductionSmokeRunResult> {
  const dependencies = {
    ...defaultDependencies,
    ...options.dependencies,
  };
  const env = { ...process.env, ...options.env };
  const binSuffix = process.platform === "win32" ? ".cmd" : "";
  const electronBin = path.join(
    options.rootDir,
    "node_modules",
    ".bin",
    `electron${binSuffix}`,
  );
  const electronRebuildBin = path.join(
    options.rootDir,
    "node_modules",
    ".bin",
    `electron-rebuild${binSuffix}`,
  );
  const nativeModulePath = path.join(
    options.rootDir,
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node",
  );
  const nativeProbeScript = path.join(
    options.rootDir,
    "scripts",
    "probe-native-sqlite.mjs",
  );
  const nativeRebuildScript = path.join(
    options.rootDir,
    "scripts",
    "rebuild-native-sqlite.mjs",
  );
  const packageLockPath = path.join(options.rootDir, "package-lock.json");

  let tempDir: string | null = null;
  let initialBackupPath: string | null = null;
  let initialBackupHash: string | null = null;
  let nodeBackupPath: string | null = null;
  let nodeBackupHash: string | null = null;
  let packageLockHash: string | null = null;
  let nativeProbeAvailable = false;
  let nativeMayNeedRestore = false;
  let primaryFailure: ProductionSmokeFailure | null = null;
  const cleanupFailures: ProductionSmokeFailure[] = [];
  let evidence: unknown = null;

  const fail = (
    stage: ProductionSmokeFailure["stage"],
    message: string,
  ): void => {
    primaryFailure ??= { stage, message };
  };
  const run = async (
    stage: ProductionSmokeCommandStage,
    command: string,
    args: string[],
    commandEnv: NodeJS.ProcessEnv = env,
    timeoutMs?: number,
  ): Promise<boolean> => {
    const result = await executeCommand({
      stage,
      command,
      args,
      cwd: options.rootDir,
      env: commandEnv,
      abortSignal: options.signal,
      timeoutMs,
    });
    if (commandSucceeded(result)) {
      return true;
    }
    fail(stage, commandFailureMessage(stage, result));
    return false;
  };

  async function executeCommand(
    input: ProductionSmokeCommand,
  ): Promise<CommandResult> {
    try {
      return await dependencies.runCommand(input);
    } catch (error) {
      return {
        status: 1,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  try {
    for (const requiredPath of [
      electronBin,
      electronRebuildBin,
      nativeModulePath,
      nativeProbeScript,
      nativeRebuildScript,
      packageLockPath,
    ]) {
      const exists = dependencies.pathExists(requiredPath);
      if (requiredPath === nativeProbeScript) {
        nativeProbeAvailable = exists;
      }
      if (!exists) {
        fail(
          "backup",
          `Production smoke prerequisite is missing: ${requiredPath}`,
        );
      }
    }
  } catch (error) {
    fail("backup", error instanceof Error ? error.message : String(error));
  }

  if (!primaryFailure) {
    try {
      tempDir = await dependencies.createTempDir(options.temporaryRoot);
      initialBackupPath = path.join(
        tempDir,
        "better_sqlite3.node.original",
      );
      packageLockHash = await dependencies.hashFile(packageLockPath);
      const sourceHash = await dependencies.hashFile(nativeModulePath);
      await dependencies.copyFile(nativeModulePath, initialBackupPath);
      const backupHash = await dependencies.hashFile(initialBackupPath);
      if (backupHash !== sourceHash) {
        throw new Error(
          "Initial native module backup hash does not match its source.",
        );
      }
      initialBackupHash = backupHash;
    } catch (error) {
      fail("backup", error instanceof Error ? error.message : String(error));
    }
  }

  if (!primaryFailure && tempDir && initialBackupPath) {
    const nodeReady = await run(
      "node_preflight",
      process.execPath,
      [nativeProbeScript, "--expect-runtime=node"],
      env,
      nativeProbeTimeoutMs,
    );
    if (nodeReady) {
      nodeBackupPath = initialBackupPath;
    } else {
      primaryFailure = null;
      nativeMayNeedRestore = true;
      const rebuilt = await run(
        "node_rebuild",
        process.execPath,
        [nativeRebuildScript],
        env,
        nativeRebuildTimeoutMs,
      );
      const confirmed =
        rebuilt &&
        await run(
          "node_rebuild_confirmation",
          process.execPath,
          [nativeProbeScript, "--expect-runtime=node"],
          env,
          nativeProbeTimeoutMs,
        );
      if (confirmed) {
        try {
          nodeBackupPath = path.join(
            tempDir,
            "better_sqlite3.node.node-abi",
          );
          await dependencies.copyFile(nativeModulePath, nodeBackupPath);
          const sourceHash = await dependencies.hashFile(nativeModulePath);
          const backupHash = await dependencies.hashFile(nodeBackupPath);
          if (sourceHash !== backupHash) {
            throw new Error(
              "Normalized Node native module backup hash does not match its source.",
            );
          }
          nodeBackupHash = backupHash;
        } catch (error) {
          nodeBackupPath = null;
          fail(
            "backup",
            `Unable to save the normalized Node native module: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
    if (nodeReady) {
      nodeBackupHash = initialBackupHash;
    }
  }

  if (!primaryFailure && tempDir && nodeBackupPath) {
    const electronProbeEnv = {
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
    };
    const evidencePath = path.join(tempDir, "storage-evidence.json");
    const appEnv: NodeJS.ProcessEnv = {
      ...env,
      BUILDING_AGENT_SMOKE: "1",
      BUILDING_AGENT_USER_DATA_DIR: path.join(tempDir, "user-data"),
      ZEROX_AGENT_USER_DATA_DIR: path.join(tempDir, "user-data"),
      ZEROX_PRODUCTION_SMOKE_EVIDENCE_FILE: evidencePath,
      ZEROX_PRODUCTION_SMOKE_REQUIRE_SQLITE: "1",
      ZEROX_STORAGE_BACKEND: "sqlite",
    };
    delete appEnv.ELECTRON_RUN_AS_NODE;
    delete appEnv.ELECTRON_RENDERER_URL;

    nativeMayNeedRestore = true;
    if (
      await run(
        "electron_rebuild",
        electronRebuildBin,
        ["-f", "-w", "better-sqlite3"],
        env,
        nativeRebuildTimeoutMs,
      ) &&
      await run(
        "electron_preflight",
        electronBin,
        [nativeProbeScript, "--expect-runtime=electron"],
        electronProbeEnv,
        nativeProbeTimeoutMs,
      ) &&
      await run(
        "electron_app",
        electronBin,
        [
          ...(env.ZEROX_V392_OUTER_SANDBOX === "1"
            ? ["--no-sandbox"]
            : []),
          ".",
        ],
        appEnv,
        resolveElectronAppTimeoutMs(appEnv),
      )
    ) {
      try {
        evidence = await dependencies.readEvidence(evidencePath);
        if (!isProductionStorageSmokeEvidence(evidence)) {
          fail(
            "evidence",
            "Electron exited successfully without valid native SQLite authority evidence.",
          );
        }
      } catch (error) {
        fail(
          "evidence",
          `Unable to read production storage evidence: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  if (nativeProbeAvailable) {
    let restoredFromBackup = false;
    if (nodeBackupPath) {
      try {
        await dependencies.copyFile(nodeBackupPath, nativeModulePath);
        const restoredHash = await dependencies.hashFile(nativeModulePath);
        if (!nodeBackupHash || restoredHash !== nodeBackupHash) {
          throw new Error(
            "Restored native module hash does not match the verified Node backup.",
          );
        }
        restoredFromBackup = true;
      } catch (error) {
        cleanupFailures.push({
          stage: "backup",
          message: `Unable to restore the saved native module: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }

    const probeNodeRestore = (): Promise<CommandResult> =>
      executeCommand({
        stage: "node_restore_probe",
        command: process.execPath,
        args: [nativeProbeScript, "--expect-runtime=node"],
        cwd: options.rootDir,
        env,
        timeoutMs: nativeProbeTimeoutMs,
      });
    const rebuildNodeRestore = (): Promise<CommandResult> =>
      executeCommand({
        stage: "node_restore_rebuild",
        command: process.execPath,
        args: [nativeRebuildScript],
        cwd: options.rootDir,
        env,
        timeoutMs: nativeRebuildTimeoutMs,
      });

    let finalProbe: CommandResult | null = null;
    let recoveryRebuild: CommandResult | null = null;

    if (restoredFromBackup || !nativeMayNeedRestore) {
      finalProbe = await probeNodeRestore();
    }
    if (!finalProbe || !commandSucceeded(finalProbe)) {
      recoveryRebuild = await rebuildNodeRestore();
      finalProbe = await probeNodeRestore();
    }

    if (recoveryRebuild && !commandSucceeded(recoveryRebuild)) {
      cleanupFailures.push({
        stage: "node_restore_rebuild",
        message: commandFailureMessage(
          "node_restore_rebuild",
          recoveryRebuild,
        ),
      });
    }
    if (!finalProbe || !commandSucceeded(finalProbe)) {
      cleanupFailures.push({
        stage: "node_restore_probe",
        message: finalProbe
          ? commandFailureMessage("node_restore_probe", finalProbe)
          : "Final Node ABI probe did not execute.",
      });
    } else if (nodeBackupHash) {
      try {
        const finalHash = await dependencies.hashFile(nativeModulePath);
        if (finalHash !== nodeBackupHash) {
          cleanupFailures.push({
            stage: "backup",
            message:
              "Final Node native module is functional but does not match " +
              "the verified backup hash.",
          });
        }
      } catch (error) {
        cleanupFailures.push({
          stage: "backup",
          message: `Unable to verify the final Node native module hash: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }
  }

  if (packageLockHash) {
    try {
      const finalPackageLockHash =
        await dependencies.hashFile(packageLockPath);
      if (finalPackageLockHash !== packageLockHash) {
        cleanupFailures.push({
          stage: "lockfile_integrity",
          message:
            "Production smoke changed package-lock.json while rebuilding native code.",
        });
      }
    } catch (error) {
      cleanupFailures.push({
        stage: "lockfile_integrity",
        message: `Unable to verify package-lock.json after native rebuild: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  if (tempDir) {
    try {
      await dependencies.removeTempDir(tempDir);
    } catch (error) {
      cleanupFailures.push({
        stage: "temp_cleanup",
        message: `Unable to remove production smoke temporary directory: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  if (!primaryFailure && cleanupFailures.length > 0) {
    primaryFailure = cleanupFailures[0] ?? null;
  }

  return {
    ok: !primaryFailure,
    primaryFailure,
    cleanupFailures,
    evidence,
  };
}

function commandSucceeded(result: CommandResult): boolean {
  return result.status === 0 && !result.signal && !result.error;
}

function commandFailureMessage(
  stage: ProductionSmokeCommandStage,
  result: CommandResult,
): string {
  return (
    result.error?.message ??
    (result.signal
      ? `${stage} exited with signal ${result.signal}.`
      : `${stage} exited with status ${result.status}.`)
  );
}

async function runOwnedSmokeCommand(
  input: ProductionSmokeCommand,
): Promise<CommandResult> {
  console.log(`[smoke:runner] ${input.stage}`);
  if (input.abortSignal?.aborted) {
    return {
      status: 1,
      error: abortError(input.stage, input.abortSignal),
    };
  }

  return new Promise((resolve) => {
    let child: ChildProcess | null = null;
    let timeout: NodeJS.Timeout | null = null;
    let abortHandler: (() => void) | null = null;
    let settling = false;

    const cleanupListeners = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (abortHandler) {
        input.abortSignal?.removeEventListener("abort", abortHandler);
        abortHandler = null;
      }
    };
    const finish = (
      result: CommandResult,
      terminate: boolean,
    ) => {
      if (settling) {
        return;
      }
      settling = true;
      cleanupListeners();
      void (terminate && child
        ? terminateSmokeProcessTree(child)
        : drainSmokeProcessTree(child)
      ).then(() => resolve(result));
    };

    try {
      child = spawn(input.command, input.args, {
        cwd: input.cwd,
        env: input.env ?? process.env,
        detached: process.platform !== "win32",
        stdio: "inherit",
        windowsHide: true,
      });
    } catch (error) {
      finish(
        {
          status: 1,
          error: error instanceof Error ? error : new Error(String(error)),
        },
        true,
      );
      return;
    }

    child.once("error", (error) => {
      finish({ status: 1, error }, true);
    });
    child.once("close", (status, signal) => {
      finish(
        {
          status: status ?? 1,
          signal,
        },
        false,
      );
    });

    if (input.timeoutMs) {
      timeout = setTimeout(() => {
        finish(
          {
            status: 1,
            error: new Error(
              `${input.stage} timed out after ${input.timeoutMs} ms.`,
            ),
          },
          true,
        );
      }, input.timeoutMs);
    }
    abortHandler = () => {
      finish(
        {
          status: 1,
          error: abortError(input.stage, input.abortSignal),
        },
        true,
      );
    };
    input.abortSignal?.addEventListener("abort", abortHandler, {
      once: true,
    });
    if (input.abortSignal?.aborted) {
      abortHandler();
    }
  });
}

function abortError(
  stage: ProductionSmokeCommandStage,
  signal: AbortSignal | undefined,
): Error {
  const reason = signal?.reason;
  return new Error(
    `${stage} canceled: ${
      reason instanceof Error ? reason.message : String(reason ?? "aborted")
    }`,
  );
}

async function drainSmokeProcessTree(
  child: ChildProcess | null,
): Promise<void> {
  if (!child?.pid || !smokeProcessGroupExists(child.pid)) {
    await waitForSmokeChildExit(child);
    return;
  }
  await terminateSmokeProcessTree(child);
}

async function terminateSmokeProcessTree(
  child: ChildProcess,
): Promise<void> {
  const pid = child.pid;
  if (process.platform === "win32") {
    if (pid) {
      await runWindowsTreeKill(pid);
    } else if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await waitForSmokeChildExit(child);
    return;
  }

  if (!pid) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await waitForSmokeChildExit(child);
    return;
  }

  if (smokeProcessGroupExists(pid)) {
    signalSmokeProcessGroup(pid, "SIGTERM");
    await delay(500);
    if (smokeProcessGroupExists(pid)) {
      signalSmokeProcessGroup(pid, "SIGKILL");
      await waitForSmokeProcessGroupExit(pid);
    }
  }
  await waitForSmokeChildExit(child);
}

function smokeProcessGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function signalSmokeProcessGroup(
  pid: number,
  signal: NodeJS.Signals,
): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // The owned process group has already exited.
  }
}

async function waitForSmokeProcessGroupExit(
  pid: number,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (smokeProcessGroupExists(pid) && Date.now() < deadline) {
    await delay(10);
  }
}

async function waitForSmokeChildExit(
  child: ChildProcess | null,
  timeoutMs = 2_000,
): Promise<void> {
  if (
    !child ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
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
