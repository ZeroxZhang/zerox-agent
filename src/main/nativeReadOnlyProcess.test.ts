import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runReadOnlyNativeProcess } from "./nativeReadOnlyProcess";
import {
  buildMinimalProcessEnv,
  type ProcessSandboxPolicy,
  type ProcessSandboxProvider,
} from "./processSandbox";

describe("read-only native process adapter", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "zerox-read-only-native-"),
    );
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("uses an owned process with a minimal child environment", async () => {
    const secretKey = "ZEROX_NATIVE_PROCESS_SECRET_FIXTURE";
    const previous = process.env[secretKey];
    process.env[secretKey] = "must-not-leak";
    try {
      const result = await runReadOnlyNativeProcess({
        argv: [
          process.execPath,
          "-e",
          `process.stdout.write(process.env.${secretKey} ?? "missing")`,
        ],
        workspaceRoot,
      });

      expect(result).toMatchObject({
        terminal: "exit",
        exitCode: 0,
        stdout: "missing",
      });
    } finally {
      if (previous === undefined) {
        delete process.env[secretKey];
      } else {
        process.env[secretKey] = previous;
      }
    }
  });

  it("confines execution as read-only without network and cleans the lease", async () => {
    const policies: ProcessSandboxPolicy[] = [];
    let cleanupCount = 0;
    const processSandbox = passthroughSandbox(policies, async () => {
      cleanupCount += 1;
    });

    const result = await runReadOnlyNativeProcess({
      argv: [
        process.execPath,
        "-e",
        'process.stdout.write(process.env.VISIBLE_FIXTURE ?? "missing")',
      ],
      workspaceRoot,
      processSandbox,
      additionalEnv: { VISIBLE_FIXTURE: "visible" },
    });

    expect(result).toMatchObject({
      terminal: "exit",
      exitCode: 0,
      stdout: "visible",
    });
    expect(policies).toEqual([
      {
        mode: "read_only",
        workspaceRoot,
        network: "none",
      },
    ]);
    expect(cleanupCount).toBe(1);
  });

  it("propagates abort and cleans only after the process is drained", async () => {
    let cleanupCount = 0;
    const processSandbox = passthroughSandbox([], async () => {
      cleanupCount += 1;
    });
    const controller = new AbortController();
    const execution = runReadOnlyNativeProcess({
      argv: [process.execPath, "-e", "setInterval(() => {}, 1_000)"],
      workspaceRoot,
      processSandbox,
      signal: controller.signal,
      timeoutMs: 5_000,
    });

    setTimeout(() => controller.abort(new Error("abort fixture")), 25);

    await expect(execution).resolves.toMatchObject({
      terminal: "canceled",
      killed: true,
    });
    expect(cleanupCount).toBe(1);
  });
});

function passthroughSandbox(
  policies: ProcessSandboxPolicy[],
  cleanup: () => Promise<void>,
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
      policies.push(structuredClone(policy));
      return {
        argv,
        backend: "seatbelt",
        enforcement: "read-write-and-network-policy",
        denialSignatures: ["operation not permitted"],
        readableRoots: [policy.workspaceRoot],
        writableRoots: [],
        network: policy.network,
        privateTempDir: policy.workspaceRoot,
        buildChildEnv(parentEnv, configuredEnv = {}) {
          return buildMinimalProcessEnv(parentEnv, configuredEnv);
        },
        cleanup,
      };
    },
  };
}
