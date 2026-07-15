import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import type { VerifiedUpdateManifest } from "./appUpdateManifest";

const maximumStateBytes = 2 * 1024;
const lockWaitMs = 10_000;
const staleLockMs = 30_000;

export type UpdateHighWater = {
  schema: 1;
  keyId: string;
  sequence: number;
  version: string;
  tag: string;
  acceptedAt: string;
};

export type UpdateHighWaterStore = {
  load(): Promise<UpdateHighWater | null>;
  save(manifest: VerifiedUpdateManifest, acceptedAt: string): Promise<void>;
};

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function parseHighWater(value: unknown): UpdateHighWater {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("本地更新防重放状态格式无效");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      "acceptedAt,keyId,schema,sequence,tag,version" ||
    record.schema !== 1 ||
    typeof record.keyId !== "string" ||
    !/^[a-f0-9]{32}$/.test(record.keyId) ||
    !Number.isSafeInteger(record.sequence) ||
    Number(record.sequence) <= 0 ||
    typeof record.version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(record.version) ||
    record.tag !== `v${record.version}` ||
    !isCanonicalTimestamp(record.acceptedAt)
  ) {
    throw new Error("本地更新防重放状态格式无效");
  }
  return record as UpdateHighWater;
}

export function createUpdateHighWaterStore(filePath: string): UpdateHighWaterStore {
  if (!path.isAbsolute(filePath)) {
    throw new Error("更新防重放状态必须使用绝对路径");
  }

  async function load(): Promise<UpdateHighWater | null> {
    try {
      const stat = await lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumStateBytes) {
        throw new Error("本地更新防重放状态文件不安全");
      }
      return parseHighWater(JSON.parse(await readFile(filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (error instanceof SyntaxError) {
        throw new Error("本地更新防重放状态格式无效");
      }
      throw error;
    }
  }

  const directory = path.dirname(filePath);
  const lockPath = `${filePath}.lock`;
  let saveQueue: Promise<void> = Promise.resolve();

  async function withExclusiveLock(operation: () => Promise<void>): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const deadline = Date.now() + lockWaitMs;
    let lockHandle: Awaited<ReturnType<typeof open>> | null = null;
    let lockIdentity: { dev: number; ino: number } | null = null;
    while (!lockHandle) {
      try {
        lockHandle = await open(lockPath, "wx", 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const stat = await lstat(lockPath).catch((statError) => {
          if ((statError as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw statError;
        });
        if (stat) {
          if (!stat.isFile() || stat.isSymbolicLink()) {
            throw new Error("更新防重放锁文件不安全");
          }
          if (Date.now() - stat.mtimeMs > staleLockMs) {
            let ownerPid = 0;
            try {
              const value = JSON.parse(await readFile(lockPath, "utf8"));
              ownerPid = Number(value?.pid);
            } catch {
              ownerPid = 0;
            }
            if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
              throw new Error("陈旧更新防重放锁缺少有效所有者");
            }
            let ownerAlive = true;
            try {
              process.kill(ownerPid, 0);
            } catch (ownerError) {
              ownerAlive = (ownerError as NodeJS.ErrnoException).code !== "ESRCH";
            }
            if (!ownerAlive) {
              await rm(lockPath, { force: true });
              continue;
            }
          }
        }
        if (Date.now() >= deadline) {
          throw new Error("等待更新防重放独占锁超时");
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    try {
      lockIdentity = await lockHandle.stat();
      await lockHandle.writeFile(
        `${JSON.stringify({ pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() })}\n`,
        "utf8",
      );
      await lockHandle.sync();
      await operation();
    } finally {
      await lockHandle.close().catch(() => undefined);
      const currentLock = await lstat(lockPath).catch(() => null);
      if (
        lockIdentity &&
        currentLock &&
        currentLock.dev === lockIdentity.dev &&
        currentLock.ino === lockIdentity.ino
      ) {
        await rm(lockPath, { force: true }).catch(() => undefined);
      }
    }
  }

  async function saveUnlocked(
    manifest: VerifiedUpdateManifest,
    acceptedAt: string,
  ): Promise<void> {
    const existing = await load();
    if (existing) {
      if (existing.keyId !== manifest.keyId) {
        throw new Error("更新签名密钥与本地防重放状态不一致");
      }
      if (manifest.sequence < existing.sequence) {
        throw new Error("已签名更新序号低于本地已接受版本");
      }
      if (manifest.sequence === existing.sequence) return;
    }

    const next = parseHighWater({
      schema: 1,
      keyId: manifest.keyId,
      sequence: manifest.sequence,
      version: manifest.version,
      tag: manifest.tag,
      acceptedAt,
    });
    const temporaryPath = path.join(
      directory,
      `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, filePath);
      const directoryHandle = await open(directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } finally {
      await handle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  function save(
    manifest: VerifiedUpdateManifest,
    acceptedAt: string,
  ): Promise<void> {
    const operation = saveQueue.then(() =>
      withExclusiveLock(() => saveUnlocked(manifest, acceptedAt)),
    );
    saveQueue = operation.catch(() => undefined);
    return operation;
  }

  return { load, save };
}
