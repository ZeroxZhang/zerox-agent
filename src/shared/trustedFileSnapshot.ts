import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  normalizeLocationEnvironment,
  validatePathInsideLocationRoots,
  type LocationResourceEnvironment,
} from "./locationResource";

const readChunkBytes = 64 * 1024;

export type TrustedFileSnapshotHooks = {
  afterPrecheck?(filePath: string): Promise<void>;
  afterChunk?(filePath: string, chunk: Buffer): Promise<void>;
};

export type ReadTrustedFileInput = {
  filePath: string;
  trustedRoots?: string[];
  locationEnv?: LocationResourceEnvironment;
  signal?: AbortSignal;
  collectBytes?: boolean;
  maxBytes?: number;
  hooks?: TrustedFileSnapshotHooks;
  afterClose?(filePath: string): Promise<void>;
};

export type TrustedFileSnapshot = {
  path: string;
  sizeBytes: number;
  modifiedAt: string;
  sha256: string;
  bytes?: Buffer;
};

export class TrustedFileSnapshotAbortError extends Error {
  readonly code = "ABORT_ERR";

  constructor() {
    super("Trusted file snapshot was aborted.");
    this.name = "AbortError";
  }
}

export class TrustedFileSnapshotValidationError extends Error {
  readonly code?: string;

  constructor(
    message = "Trusted file snapshot validation failed.",
    code?: string,
  ) {
    super(message);
    this.name = "TrustedFileSnapshotValidationError";
    this.code = code;
  }
}

export async function readTrustedRegularFile(
  input: ReadTrustedFileInput,
): Promise<TrustedFileSnapshot> {
  throwIfAborted(input.signal);
  const env = normalizeLocationEnvironment(input.locationEnv);
  const resolvedPath = path.resolve(input.filePath);
  const roots = input.trustedRoots?.length
    ? input.trustedRoots
    : [path.dirname(resolvedPath)];
  const precheck = validatePathInsideLocationRoots(resolvedPath, roots, env);
  if (!precheck.ok) throw new TrustedFileSnapshotValidationError(precheck.reason);
  const canonicalRoots = await Promise.all(
    roots.map(async (root) => {
      try {
        return await realpath(root);
      } catch {
        return path.resolve(root);
      }
    }),
  );
  await abortableHook(input.hooks?.afterPrecheck?.(precheck.path), input.signal);
  throwIfAborted(input.signal);

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      precheck.path,
      constants.O_RDONLY |
        (constants.O_NONBLOCK ?? 0) |
        (constants.O_NOFOLLOW ?? 0),
    );
    throwIfAborted(input.signal);
    const openedStats = await handle.stat();
    assertRegularFile(openedStats.isFile());
    await bindOpenedDescriptor(
      precheck.path,
      roots,
      canonicalRoots,
      env,
      openedStats,
    );
    if (
      input.maxBytes !== undefined &&
      Number.isFinite(input.maxBytes) &&
      openedStats.size > input.maxBytes
    ) {
      throw new TrustedFileSnapshotValidationError(
        "Trusted file exceeds the permitted size.",
      );
    }

    const hash = createHash("sha256");
    const chunks: Buffer[] = [];
    const buffer = Buffer.allocUnsafe(readChunkBytes);
    let sizeBytes = 0;
    while (true) {
      throwIfAborted(input.signal);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      throwIfAborted(input.signal);
      if (bytesRead === 0) break;
      const chunk = Buffer.from(buffer.subarray(0, bytesRead));
      sizeBytes += bytesRead;
      if (input.maxBytes !== undefined && sizeBytes > input.maxBytes) {
        throw new TrustedFileSnapshotValidationError(
          "Trusted file exceeds the permitted size.",
        );
      }
      hash.update(chunk);
      if (input.collectBytes) chunks.push(chunk);
      await abortableHook(input.hooks?.afterChunk?.(precheck.path, chunk), input.signal);
    }
    throwIfAborted(input.signal);

    const finalStats = await handle.stat();
    if (
      !sameFileIdentity(openedStats, finalStats) ||
      finalStats.size !== sizeBytes
    ) {
      throw new TrustedFileSnapshotValidationError();
    }
    await bindOpenedDescriptor(
      precheck.path,
      roots,
      canonicalRoots,
      env,
      finalStats,
    );
    throwIfAborted(input.signal);
    return {
      path: precheck.path,
      sizeBytes,
      modifiedAt: finalStats.mtime.toISOString(),
      sha256: hash.digest("hex"),
      ...(input.collectBytes ? { bytes: Buffer.concat(chunks, sizeBytes) } : {}),
    };
  } catch (error) {
    if (input.signal?.aborted || isAbortError(error)) {
      throw new TrustedFileSnapshotAbortError();
    }
    if (error instanceof TrustedFileSnapshotValidationError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    throw new TrustedFileSnapshotValidationError(undefined, code);
  } finally {
    await handle?.close();
    await input.afterClose?.(precheck.path);
  }
}

async function bindOpenedDescriptor(
  filePath: string,
  roots: string[],
  canonicalRoots: string[],
  env: Required<LocationResourceEnvironment>,
  descriptorStats: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>,
): Promise<void> {
  const boundary = validatePathInsideLocationRoots(filePath, roots, env);
  if (!boundary.ok) throw new TrustedFileSnapshotValidationError(boundary.reason);
  const [leafStats, pathStats, canonicalPath] = await Promise.all([
    lstat(boundary.path),
    stat(boundary.path),
    realpath(boundary.path),
  ]);
  const canonicalBoundary = validatePathInsideLocationRoots(
    canonicalPath,
    canonicalRoots,
    env,
  );
  if (
    !canonicalBoundary.ok ||
    leafStats.isSymbolicLink() ||
    !leafStats.isFile() ||
    !pathStats.isFile() ||
    !sameFileIdentity(descriptorStats, leafStats) ||
    !sameFileIdentity(descriptorStats, pathStats) ||
    descriptorStats.size !== pathStats.size
  ) {
    const reason = !canonicalBoundary.ok
      ? "canonical_boundary"
      : leafStats.isSymbolicLink()
        ? "leaf_symlink"
        : !leafStats.isFile() || !pathStats.isFile()
          ? "not_regular"
          : !sameFileIdentity(descriptorStats, leafStats)
            ? "lstat_identity"
            : !sameFileIdentity(descriptorStats, pathStats)
              ? "stat_identity"
              : "size_identity";
    throw new TrustedFileSnapshotValidationError(`Trusted file binding failed: ${reason}.`);
  }
}

function sameFileIdentity(
  left: { dev: number | bigint; ino: number | bigint; isFile(): boolean },
  right: { dev: number | bigint; ino: number | bigint; isFile(): boolean },
): boolean {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino;
}

function assertRegularFile(isFile: boolean): void {
  if (!isFile) throw new TrustedFileSnapshotValidationError();
}

async function abortableHook(
  operation: Promise<void> | undefined,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!operation) return;
  if (!signal) {
    await operation;
    return;
  }
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new TrustedFileSnapshotAbortError());
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      () => {
        cleanup();
        resolve();
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new TrustedFileSnapshotAbortError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
