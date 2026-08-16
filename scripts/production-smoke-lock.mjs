import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const incompleteLockGraceMs = 30_000;

function defaultProcessExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

export function getProductionSmokeLockPath(
  rootDir,
  tempRoot = os.tmpdir(),
) {
  const rootHash = createHash("sha256")
    .update(canonicalWorkspaceRoot(rootDir))
    .digest("hex")
    .slice(0, 24);
  return path.join(tempRoot, `zerox-production-smoke-${rootHash}.lock`);
}

export async function acquireProductionSmokeLock(options) {
  const rootDir = canonicalWorkspaceRoot(options.rootDir);
  const pid = options.pid ?? process.pid;
  const now = options.now ?? Date.now;
  const processExists = options.processExists ?? defaultProcessExists;
  const lockPath =
    options.lockPath ??
    getProductionSmokeLockPath(rootDir, options.tempRoot);
  const ownerPath = path.join(lockPath, "owner.json");
  const token = randomUUID();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      try {
        await writeFile(
          ownerPath,
          `${JSON.stringify({
            schemaVersion: 1,
            pid,
            rootDir,
            token,
            createdAt: new Date(now()).toISOString(),
          })}\n`,
          { encoding: "utf8", flag: "wx", mode: 0o600 },
        );
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true });
        throw error;
      }

      let released = false;
      return {
        path: lockPath,
        async release() {
          if (released) {
            return;
          }
          const owner = JSON.parse(await readFile(ownerPath, "utf8"));
          if (owner?.token !== token || owner?.pid !== pid) {
            throw new Error(
              `Production smoke lock ownership changed: ${lockPath}`,
            );
          }
          await rm(lockPath, { recursive: true, force: false });
          released = true;
        },
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
    }

    let owner = null;
    try {
      owner = JSON.parse(await readFile(ownerPath, "utf8"));
    } catch {
      const metadata = await stat(lockPath).catch(() => null);
      if (metadata && now() - metadata.mtimeMs < incompleteLockGraceMs) {
        throw new Error(
          `Production smoke lock is being initialized: ${lockPath}`,
        );
      }
    }

    if (
      Number.isInteger(owner?.pid) &&
      owner.pid > 0 &&
      processExists(owner.pid)
    ) {
      throw new Error(
        `Production smoke is already running for this workspace (pid ${owner.pid}).`,
      );
    }

    await rm(lockPath, { recursive: true, force: true });
  }

  throw new Error(`Unable to acquire production smoke lock: ${lockPath}`);
}

function canonicalWorkspaceRoot(rootDir) {
  const resolved = path.resolve(rootDir);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}
