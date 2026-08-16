import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  runProductionSmoke,
  type ProductionSmokeCommand,
} from "./productionSmokeRunner";
import {
  productionStorageAuthorityDomains,
  type ProductionStorageSmokeEvidence,
} from "./productionSmoke";

const validEvidence: ProductionStorageSmokeEvidence = {
  schemaVersion: 2,
  kind: "production_storage_smoke",
  requestedBackend: "sqlite",
  resolvedBackend: "sqlite",
  nativeRuntime: {
    runtime: "electron",
    electronVersion: "42.9.0",
    modulesAbi: "146",
    nodeVersion: "24.14.0",
  },
  sqlite: {
    foreignKeys: 1,
    journalMode: "wal",
    migrationCount: 7,
    taskRowPersisted: true,
    taskId: "smoke_task",
    taskName: "Production SQLite smoke",
  },
  authority: {
    domains: [...productionStorageAuthorityDomains],
    markerCount: 8,
    recordIds: {
      goal: "goal_smoke",
      execution_checkpoint: "run_smoke",
      memory: "memory_smoke",
      workspace: "workspace_smoke",
      multi_agent_session: "session_smoke",
      learning_candidate: "learning_smoke",
      eval_candidate: "candidate_smoke",
      promoted_eval_fixture: "fixture_smoke",
    },
    domainRowsPersisted: true,
    legacyJsonShadowsAbsent: true,
  },
};

function createDependencies(options: {
  statuses?: Partial<Record<ProductionSmokeCommand["stage"], number>>;
  evidence?: unknown;
} = {}) {
  const commands: ProductionSmokeCommand[] = [];
  const copies: Array<[string, string]> = [];
  return {
    commands,
    copies,
    dependencies: {
      copyFile: vi.fn(async (source: string, destination: string) => {
        copies.push([source, destination]);
      }),
      createTempDir: vi.fn(async () => "/tmp/zerox-production-smoke-test"),
      hashFile: vi.fn(
        async (filePath: string): Promise<string> =>
          filePath.endsWith("package-lock.json")
            ? "package-lock-hash"
            : "native-module-hash",
      ),
      pathExists: vi.fn((_filePath: string) => true),
      readEvidence: vi.fn(async () => options.evidence ?? validEvidence),
      removeTempDir: vi.fn(async () => undefined),
      runCommand: vi.fn(
        (
          command: ProductionSmokeCommand,
        ): { status: number } | Promise<{ status: number }> => {
          commands.push(command);
          return {
            status: options.statuses?.[command.stage] ?? 0,
          };
        },
      ),
    },
  };
}

describe("production smoke runner", () => {
  it("prepares Electron ABI, requires evidence, then restores and probes Node ABI", async () => {
    const fixture = createDependencies();

    const result = await runProductionSmoke({
      rootDir: "/repo",
      env: {
        ELECTRON_RENDERER_URL: "http://127.0.0.1:5173",
      },
      dependencies: fixture.dependencies,
    });

    expect(result).toMatchObject({
      ok: true,
      primaryFailure: null,
      cleanupFailures: [],
      evidence: validEvidence,
    });
    expect(fixture.commands.map((command) => command.stage)).toEqual([
      "node_preflight",
      "electron_rebuild",
      "electron_preflight",
      "electron_app",
      "node_restore_probe",
    ]);
    expect(fixture.copies).toEqual([
      [
        "/repo/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
        "/tmp/zerox-production-smoke-test/better_sqlite3.node.original",
      ],
      [
        "/tmp/zerox-production-smoke-test/better_sqlite3.node.original",
        "/repo/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
      ],
    ]);
    const electronPreflight = fixture.commands.find(
      (command) => command.stage === "electron_preflight",
    );
    const electronApp = fixture.commands.find(
      (command) => command.stage === "electron_app",
    );
    expect(electronPreflight).toMatchObject({
      env: {
        ELECTRON_RUN_AS_NODE: "1",
      },
      timeoutMs: 30_000,
    });
    expect(electronApp?.env).toMatchObject({
      BUILDING_AGENT_SMOKE: "1",
      ZEROX_PRODUCTION_SMOKE_REQUIRE_SQLITE: "1",
      ZEROX_STORAGE_BACKEND: "sqlite",
    });
    expect(electronApp).toMatchObject({
      timeoutMs: 15_000,
    });
    expect(electronApp?.abortSignal).toBeUndefined();
    expect(electronApp?.env?.ELECTRON_RENDERER_URL).toBeUndefined();
  });

  it("still verifies Node ABI when an Electron prerequisite is missing", async () => {
    const fixture = createDependencies();
    fixture.dependencies.pathExists = vi.fn(
      (filePath: string) => !filePath.endsWith("/electron-rebuild"),
    );

    const result = await runProductionSmoke({
      rootDir: "/repo",
      env: {},
      dependencies: fixture.dependencies,
    });

    expect(result.primaryFailure).toEqual({
      stage: "backup",
      message:
        "Production smoke prerequisite is missing: /repo/node_modules/.bin/electron-rebuild",
    });
    expect(fixture.commands.map((command) => command.stage)).toEqual([
      "node_restore_probe",
    ]);
  });

  it("rejects Electron success when the evidence reports JSON fallback", async () => {
    const fixture = createDependencies({
      evidence: {
        ...validEvidence,
        resolvedBackend: "json",
      },
    });

    const result = await runProductionSmoke({
      rootDir: "/repo",
      env: {},
      dependencies: fixture.dependencies,
    });

    expect(result.ok).toBe(false);
    expect(result.primaryFailure).toMatchObject({
      stage: "evidence",
    });
    expect(fixture.commands.map((command) => command.stage)).toContain(
      "node_restore_probe",
    );
  });

  it("restores Node ABI after Electron failure without hiding the original failure", async () => {
    const fixture = createDependencies({
      statuses: {
        electron_app: 7,
        node_restore_probe: 1,
      },
    });

    const result = await runProductionSmoke({
      rootDir: "/repo",
      env: {},
      dependencies: fixture.dependencies,
    });

    expect(result.ok).toBe(false);
    expect(result.primaryFailure).toEqual({
      stage: "electron_app",
      message: "electron_app exited with status 7.",
    });
    expect(result.cleanupFailures).toEqual([
      {
        stage: "node_restore_probe",
        message: "node_restore_probe exited with status 1.",
      },
    ]);
    expect(
      fixture.commands
        .filter((command) => command.stage.startsWith("node_restore"))
        .map((command) => command.stage),
    ).toEqual([
      "node_restore_probe",
      "node_restore_rebuild",
      "node_restore_probe",
    ]);
  });

  it("normalizes a stale native module to Node ABI before saving the restore copy", async () => {
    const fixture = createDependencies({
      statuses: {
        node_preflight: 1,
      },
    });

    const result = await runProductionSmoke({
      rootDir: "/repo",
      env: {},
      dependencies: fixture.dependencies,
    });

    expect(result.ok).toBe(true);
    expect(fixture.commands.map((command) => command.stage)).toEqual([
      "node_preflight",
      "node_rebuild",
      "node_rebuild_confirmation",
      "electron_rebuild",
      "electron_preflight",
      "electron_app",
      "node_restore_probe",
    ]);
    expect(fixture.copies).toEqual([
      [
        "/repo/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
        "/tmp/zerox-production-smoke-test/better_sqlite3.node.original",
      ],
      [
        "/repo/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
        "/tmp/zerox-production-smoke-test/better_sqlite3.node.node-abi",
      ],
      [
        "/tmp/zerox-production-smoke-test/better_sqlite3.node.node-abi",
        "/repo/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
      ],
    ]);
  });

  it("uses a second rebuild and final probe when initial Node normalization fails", async () => {
    const fixture = createDependencies({
      statuses: {
        node_preflight: 1,
        node_rebuild: 2,
      },
    });

    const result = await runProductionSmoke({
      rootDir: "/repo",
      env: {},
      dependencies: fixture.dependencies,
    });

    expect(result.primaryFailure).toEqual({
      stage: "node_rebuild",
      message: "node_rebuild exited with status 2.",
    });
    expect(fixture.commands.map((command) => command.stage)).toEqual([
      "node_preflight",
      "node_rebuild",
      "node_restore_rebuild",
      "node_restore_probe",
    ]);
    expect(fixture.copies).toEqual([
      [
        "/repo/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
        "/tmp/zerox-production-smoke-test/better_sqlite3.node.original",
      ],
    ]);
    expect(result.cleanupFailures).toEqual([]);
    for (const command of fixture.commands.filter((candidate) =>
      candidate.stage === "node_rebuild" ||
      candidate.stage === "node_restore_rebuild",
    )) {
      expect(command).toMatchObject({
        command: process.execPath,
        args: ["/repo/scripts/rebuild-native-sqlite.mjs"],
        timeoutMs: 300_000,
      });
    }
  });

  it("does not trust the original backup when Node rebuild confirmation fails", async () => {
    const fixture = createDependencies({
      statuses: {
        node_preflight: 1,
        node_rebuild_confirmation: 2,
      },
    });

    const result = await runProductionSmoke({
      rootDir: "/repo",
      env: {},
      dependencies: fixture.dependencies,
    });

    expect(result.primaryFailure).toEqual({
      stage: "node_rebuild_confirmation",
      message: "node_rebuild_confirmation exited with status 2.",
    });
    expect(result.cleanupFailures).toEqual([]);
    expect(fixture.commands.map((command) => command.stage)).toEqual([
      "node_preflight",
      "node_rebuild",
      "node_rebuild_confirmation",
      "node_restore_rebuild",
      "node_restore_probe",
    ]);
    expect(fixture.copies).toHaveLength(1);
  });

  it("reports cleanup failure without hiding initial rebuild failure when Node remains unusable", async () => {
    const fixture = createDependencies({
      statuses: {
        node_preflight: 1,
        node_rebuild: 2,
        node_restore_rebuild: 3,
        node_restore_probe: 4,
      },
    });

    const result = await runProductionSmoke({
      rootDir: "/repo",
      env: {},
      dependencies: fixture.dependencies,
    });

    expect(result.primaryFailure).toEqual({
      stage: "node_rebuild",
      message: "node_rebuild exited with status 2.",
    });
    expect(result.cleanupFailures).toEqual([
      {
        stage: "node_restore_rebuild",
        message: "node_restore_rebuild exited with status 3.",
      },
      {
        stage: "node_restore_probe",
        message: "node_restore_probe exited with status 4.",
      },
    ]);
    expect(fixture.commands.map((command) => command.stage)).toEqual([
      "node_preflight",
      "node_rebuild",
      "node_restore_rebuild",
      "node_restore_probe",
    ]);
    expect(fixture.copies).toHaveLength(1);
  });

  it("reports fallback rebuild failure even when the mandatory final probe succeeds", async () => {
    const fixture = createDependencies({
      statuses: {
        node_preflight: 1,
        node_rebuild: 2,
        node_restore_rebuild: 3,
      },
    });

    const result = await runProductionSmoke({
      rootDir: "/repo",
      env: {},
      dependencies: fixture.dependencies,
    });

    expect(result.primaryFailure).toEqual({
      stage: "node_rebuild",
      message: "node_rebuild exited with status 2.",
    });
    expect(result.cleanupFailures).toEqual([
      {
        stage: "node_restore_rebuild",
        message: "node_restore_rebuild exited with status 3.",
      },
    ]);
    expect(fixture.commands.at(-1)?.stage).toBe("node_restore_probe");
  });

  it("attempts Node restoration when Electron rebuild itself fails", async () => {
    const fixture = createDependencies({
      statuses: {
        electron_rebuild: 1,
      },
    });

    const result = await runProductionSmoke({
      rootDir: "/repo",
      env: {},
      dependencies: fixture.dependencies,
    });

    expect(result.primaryFailure?.stage).toBe("electron_rebuild");
    expect(fixture.commands.map((command) => command.stage)).toEqual([
      "node_preflight",
      "electron_rebuild",
      "node_restore_probe",
    ]);
    expect(fixture.copies).toHaveLength(2);
  });

  it("attempts Node restoration when the Electron ABI probe fails", async () => {
    const fixture = createDependencies({
      statuses: {
        electron_preflight: 1,
      },
    });

    const result = await runProductionSmoke({
      rootDir: "/repo",
      env: {},
      dependencies: fixture.dependencies,
    });

    expect(result.primaryFailure?.stage).toBe("electron_preflight");
    expect(fixture.commands.map((command) => command.stage)).toEqual([
      "node_preflight",
      "electron_rebuild",
      "electron_preflight",
      "node_restore_probe",
    ]);
  });

  it("treats an Electron process signal as failure and still restores Node ABI", async () => {
    const fixture = createDependencies();
    fixture.dependencies.runCommand = vi.fn(
      (command: ProductionSmokeCommand) => {
        fixture.commands.push(command);
        if (command.stage === "electron_app") {
          return {
            status: 1,
            signal: "SIGTERM" as const,
          };
        }
        return { status: 0 };
      },
    );

    const result = await runProductionSmoke({
      rootDir: "/repo",
      env: {},
      dependencies: fixture.dependencies,
    });

    expect(result.primaryFailure).toEqual({
      stage: "electron_app",
      message: "electron_app exited with signal SIGTERM.",
    });
    expect(fixture.commands.at(-1)?.stage).toBe("node_restore_probe");
  });

  it("treats an Electron process timeout as failure and still restores Node ABI", async () => {
    const fixture = createDependencies();
    fixture.dependencies.runCommand = vi.fn(
      (command: ProductionSmokeCommand) => {
        fixture.commands.push(command);
        if (command.stage === "electron_app") {
          return {
            status: 1,
            signal: "SIGKILL" as const,
            error: new Error("spawnSync electron ETIMEDOUT"),
          };
        }
        return { status: 0 };
      },
    );

    const result = await runProductionSmoke({
      rootDir: "/repo",
      env: { BUILDING_AGENT_SMOKE_TIMEOUT_MS: "2500" },
      dependencies: fixture.dependencies,
    });

    expect(result.primaryFailure).toEqual({
      stage: "electron_app",
      message: "spawnSync electron ETIMEDOUT",
    });
    expect(
      fixture.commands.find((command) => command.stage === "electron_app")
        ?.timeoutMs,
    ).toBe(7_500);
    expect(fixture.commands.at(-1)?.stage).toBe("node_restore_probe");
  });

  it("restores Node ABI when an unexpected command exception occurs", async () => {
    const fixture = createDependencies();
    fixture.dependencies.runCommand = vi.fn(
      (command: ProductionSmokeCommand) => {
        fixture.commands.push(command);
        if (command.stage === "electron_app") {
          throw new Error("command adapter crashed");
        }
        return { status: 0 };
      },
    );

    const result = await runProductionSmoke({
      rootDir: "/repo",
      env: {},
      dependencies: fixture.dependencies,
    });

    expect(result.primaryFailure).toEqual({
      stage: "electron_app",
      message: "command adapter crashed",
    });
    expect(fixture.commands.map((command) => command.stage)).toContain(
      "node_restore_probe",
    );
    expect(fixture.copies).toHaveLength(2);
  });

  it("reports restore-copy failure even when rebuild recovers Node ABI", async () => {
    const fixture = createDependencies();
    let copyCalls = 0;
    fixture.dependencies.copyFile = vi.fn(
      async (source: string, destination: string) => {
        copyCalls += 1;
        fixture.copies.push([source, destination]);
        if (copyCalls === 2) {
          throw new Error("restore copy failed");
        }
      },
    );

    const result = await runProductionSmoke({
      rootDir: "/repo",
      env: {},
      dependencies: fixture.dependencies,
    });

    expect(result.ok).toBe(false);
    expect(result.primaryFailure).toEqual({
      stage: "backup",
      message: "Unable to restore the saved native module: restore copy failed",
    });
    expect(
      fixture.commands
        .filter((command) => command.stage.startsWith("node_restore"))
        .map((command) => command.stage),
    ).toEqual(["node_restore_rebuild", "node_restore_probe"]);
  });

  it("fails a successful smoke when temporary cleanup fails", async () => {
    const fixture = createDependencies();
    fixture.dependencies.removeTempDir = vi.fn(async () => {
      throw new Error("temp cleanup failed");
    });

    const result = await runProductionSmoke({
      rootDir: "/repo",
      env: {},
      dependencies: fixture.dependencies,
    });

    expect(result.ok).toBe(false);
    expect(result.primaryFailure).toEqual({
      stage: "temp_cleanup",
      message:
        "Unable to remove production smoke temporary directory: temp cleanup failed",
    });
    expect(result.cleanupFailures).toEqual([result.primaryFailure]);
  });

  it("rebuilds Node ABI when the restored backup fails its first probe", async () => {
    const fixture = createDependencies();
    let restoreProbeCalls = 0;
    fixture.dependencies.runCommand = vi.fn(
      (command: ProductionSmokeCommand) => {
        fixture.commands.push(command);
        if (command.stage === "node_restore_probe") {
          restoreProbeCalls += 1;
          return { status: restoreProbeCalls === 1 ? 1 : 0 };
        }
        return { status: 0 };
      },
    );

    const result = await runProductionSmoke({
      rootDir: "/repo",
      env: {},
      dependencies: fixture.dependencies,
    });

    expect(result.ok).toBe(true);
    expect(
      fixture.commands
        .filter((command) => command.stage.startsWith("node_restore"))
        .map((command) => command.stage),
    ).toEqual([
      "node_restore_probe",
      "node_restore_rebuild",
      "node_restore_probe",
    ]);
  });

  it("rejects a restore hash mismatch even when fallback rebuild recovers Node", async () => {
    const fixture = createDependencies();
    let nativeModuleHashReads = 0;
    fixture.dependencies.hashFile = vi.fn(async (filePath: string) => {
      if (filePath.endsWith("package-lock.json")) {
        return "package-lock-hash";
      }
      if (filePath.endsWith("better_sqlite3.node")) {
        nativeModuleHashReads += 1;
        return nativeModuleHashReads === 2
          ? "corrupt-restored-hash"
          : "native-module-hash";
      }
      return "native-module-hash";
    });

    const result = await runProductionSmoke({
      rootDir: "/repo",
      env: {},
      dependencies: fixture.dependencies,
    });

    expect(result.ok).toBe(false);
    expect(result.primaryFailure).toEqual({
      stage: "backup",
      message:
        "Unable to restore the saved native module: Restored native module hash does not match the verified Node backup.",
    });
    expect(
      fixture.commands
        .filter((command) => command.stage.startsWith("node_restore"))
        .map((command) => command.stage),
    ).toEqual(["node_restore_rebuild", "node_restore_probe"]);
  });

  it("rejects any package-lock mutation caused by native rebuild commands", async () => {
    const fixture = createDependencies();
    let packageLockReads = 0;
    fixture.dependencies.hashFile = vi.fn(async (filePath: string) => {
      if (filePath.endsWith("package-lock.json")) {
        packageLockReads += 1;
        return packageLockReads === 1 ? "before" : "after";
      }
      return "native-module-hash";
    });

    const result = await runProductionSmoke({
      rootDir: "/repo",
      env: {},
      dependencies: fixture.dependencies,
    });

    expect(result.ok).toBe(false);
    expect(result.primaryFailure).toEqual({
      stage: "lockfile_integrity",
      message:
        "Production smoke changed package-lock.json while rebuilding native code.",
    });
  });

  it("aborts the active command tree but still restores and probes Node ABI", async () => {
    const fixture = createDependencies();
    const controller = new AbortController();
    let electronStarted!: () => void;
    const electronRunning = new Promise<void>((resolve) => {
      electronStarted = resolve;
    });
    fixture.dependencies.runCommand = vi.fn(
      async (command: ProductionSmokeCommand) => {
        fixture.commands.push(command);
        if (command.stage !== "electron_app") {
          return { status: 0 };
        }
        electronStarted();
        return new Promise<{ status: number; error?: Error }>((resolve) => {
          command.abortSignal?.addEventListener(
            "abort",
            () =>
              resolve({
                status: 1,
                error: new Error("electron_app canceled by SIGTERM"),
              }),
            { once: true },
          );
        });
      },
    );

    const running = runProductionSmoke({
      rootDir: "/repo",
      env: {},
      signal: controller.signal,
      dependencies: fixture.dependencies,
    });
    await electronRunning;
    controller.abort(new Error("SIGTERM"));
    const result = await running;

    expect(result.primaryFailure).toEqual({
      stage: "electron_app",
      message: "electron_app canceled by SIGTERM",
    });
    expect(fixture.commands.at(-1)?.stage).toBe("node_restore_probe");
    expect(
      fixture.commands
        .filter((command) => command.stage.startsWith("node_restore"))
        .every((command) => command.abortSignal === undefined),
    ).toBe(true);
  });

  it("resolves the offline rebuild toolchain from installed packages and current Node headers", () => {
    const rootDir = process.cwd();
    const output = execFileSync(
      process.execPath,
      [
        path.join(rootDir, "scripts", "rebuild-native-sqlite.mjs"),
        "--check",
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        env: {
          ...process.env,
          HTTP_PROXY: "http://127.0.0.1:1",
          HTTPS_PROXY: "http://127.0.0.1:1",
          npm_config_offline: "true",
        },
      },
    );

    expect(output).toContain('"networkRequired":false');
    expect(output).toContain(
      `"moduleDir":"${path.join(
        rootDir,
        "node_modules",
        "better-sqlite3",
      )}"`,
    );
    expect(output).toContain('"nodeGypBin":');
    expect(output).toContain('"nodeHeadersRoot":');
  });
});
