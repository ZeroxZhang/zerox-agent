import {
  access,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireProductionSmokeLock,
  getProductionSmokeLockPath,
} from "../../scripts/production-smoke-lock.mjs";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "zerox-production-smoke-lock-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("production smoke process lock", () => {
  it("uses one lock for canonical and symlinked workspace paths", async () => {
    const tempRoot = await createTempDir();
    const workspaceParent = await createTempDir();
    const workspace = path.join(workspaceParent, "workspace");
    const alias = path.join(workspaceParent, "workspace-alias");
    await mkdir(workspace);
    await symlink(workspace, alias);

    expect(getProductionSmokeLockPath(workspace, tempRoot)).toBe(
      getProductionSmokeLockPath(alias, tempRoot),
    );
  });

  it("rejects a concurrent smoke for the same workspace", async () => {
    const tempRoot = await createTempDir();
    const first = await acquireProductionSmokeLock({
      rootDir: "/repo",
      tempRoot,
      pid: 4101,
      processExists: (pid) => pid === 4101,
    });

    await expect(
      acquireProductionSmokeLock({
        rootDir: "/repo",
        tempRoot,
        pid: 4102,
        processExists: (pid) => pid === 4101,
      }),
    ).rejects.toThrow(/already running.*4101/);

    await first.release();
    const second = await acquireProductionSmokeLock({
      rootDir: "/repo",
      tempRoot,
      pid: 4102,
      processExists: () => false,
    });
    await second.release();
  });

  it("removes a dead owner's stale lock after an interrupted run", async () => {
    const tempRoot = await createTempDir();
    const lockPath = getProductionSmokeLockPath("/repo", tempRoot);
    await mkdir(lockPath);
    await writeFile(
      path.join(lockPath, "owner.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        pid: 4000,
        rootDir: "/repo",
        token: "stale",
        createdAt: "2026-08-16T00:00:00.000Z",
      })}\n`,
    );
    const staleBackup = path.join(
      lockPath,
      "zerox-production-smoke-stale",
      "better_sqlite3.node.original",
    );
    await mkdir(path.dirname(staleBackup));
    await writeFile(staleBackup, "stale native backup");

    const lock = await acquireProductionSmokeLock({
      rootDir: "/repo",
      tempRoot,
      pid: 4100,
      processExists: () => false,
    });

    expect(lock.path).toBe(lockPath);
    await expect(access(staleBackup)).rejects.toThrow();
    await lock.release();
  });

  it("does not steal a newly created lock whose owner file is incomplete", async () => {
    const tempRoot = await createTempDir();
    const lockPath = getProductionSmokeLockPath("/repo", tempRoot);
    await mkdir(lockPath);

    await expect(
      acquireProductionSmokeLock({
        rootDir: "/repo",
        tempRoot,
        pid: 4100,
        now: () => Date.now(),
        processExists: () => false,
      }),
    ).rejects.toThrow(/being initialized/);
  });
});
