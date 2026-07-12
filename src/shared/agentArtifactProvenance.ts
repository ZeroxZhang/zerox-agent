import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const maximumProvenanceSidecarBytes = 1024 * 1024;

export type AgentArtifactProvenanceManifest = {
  schemaVersion: 1;
  kind: "zerox.artifactProvenance";
  runId: string;
  goalId?: string;
  milestoneId?: string;
  artifactId: string;
  artifactRef: string;
  source: { type: string; path?: string; sha256?: string };
  destination: { path: string; sha256: string; sizeBytes: number };
  generatedAt: string;
};

export type WriteArtifactProvenanceInput = {
  artifactPath: string;
  artifactId: string;
  artifactRef: string;
  runId: string;
  goalId?: string;
  milestoneId?: string;
  source: { type: string; path?: string; sha256?: string };
  generatedAt?: string;
};

export type VerifyArtifactProvenanceInput = {
  artifactPath: string;
  artifactId?: string;
  artifactRef?: string;
  runId?: string;
  goalId?: string;
  milestoneId?: string;
  signal?: AbortSignal;
};

export class ArtifactProvenanceAbortError extends Error {
  readonly code = "ABORT_ERR";

  constructor() {
    super("Artifact provenance operation was aborted.");
    this.name = "AbortError";
  }
}

export type ArtifactProvenanceVerification =
  | {
      ok: true;
      manifest: AgentArtifactProvenanceManifest;
      provenancePath: string;
      sidecarSha256: string;
    }
  | { ok: false; reason: string; provenancePath: string };

export function getArtifactProvenancePath(artifactPath: string): string {
  return `${artifactPath}.provenance.json`;
}

export async function assertArtifactPathHasNoSymlinks(
  artifactPath: string,
): Promise<void> {
  await assertNoSymlinkPathSegments(
    artifactPath,
    "Artifact path must not be a symlink.",
    "Artifact path parents must not contain symlinks.",
  );
}

export async function assertArtifactParentPathHasNoSymlinks(
  artifactPath: string,
  reason: string,
): Promise<void> {
  await assertNoSymlinkPathSegments(artifactPath, reason, reason);
}

export async function writeArtifactProvenance(
  input: WriteArtifactProvenanceInput,
): Promise<string> {
  await assertArtifactPathHasNoSymlinks(input.artifactPath);
  const destination = await describeArtifactDestination(input.artifactPath);
  const manifest: AgentArtifactProvenanceManifest = {
    schemaVersion: 1,
    kind: "zerox.artifactProvenance",
    runId: input.runId,
    ...(input.goalId ? { goalId: input.goalId } : {}),
    ...(input.milestoneId ? { milestoneId: input.milestoneId } : {}),
    artifactId: input.artifactId,
    artifactRef: input.artifactRef,
    source: input.source,
    destination,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
  const provenancePath = getArtifactProvenancePath(input.artifactPath);
  await safeWriteFile(
    provenancePath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "Artifact provenance sidecar must not be a symlink.",
  );
  return provenancePath;
}

export async function verifyArtifactProvenance(
  input: VerifyArtifactProvenanceInput,
): Promise<ArtifactProvenanceVerification> {
  throwIfProvenanceAborted(input.signal);
  const provenancePath = getArtifactProvenancePath(input.artifactPath);
  const pathCheck = await verifyArtifactPathsHaveNoSymlinks(
    input.artifactPath,
    provenancePath,
  );
  throwIfProvenanceAborted(input.signal);
  if (pathCheck) {
    return { ok: false, reason: pathCheck, provenancePath };
  }
  let manifest: unknown;
  let sidecarContent: string;
  try {
    sidecarContent = await readProvenanceSidecar(
      provenancePath,
      input.signal,
    );
    manifest = JSON.parse(sidecarContent);
  } catch (error) {
    if (input.signal?.aborted || isAbortError(error)) {
      throw new ArtifactProvenanceAbortError();
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, reason: "Artifact provenance sidecar is missing.", provenancePath };
    }
    if (error instanceof InvalidProvenanceSidecarError) {
      return { ok: false, reason: error.message, provenancePath };
    }
    return {
      ok: false,
      reason: `Artifact provenance sidecar is invalid JSON: ${(error as Error).message}`,
      provenancePath,
    };
  }

  if (!isArtifactProvenanceManifest(manifest)) {
    return { ok: false, reason: "Artifact provenance sidecar has an invalid schema.", provenancePath };
  }

  const expectedDestinationPath = path.resolve(input.artifactPath);
  if (manifest.destination.path !== expectedDestinationPath) {
    return {
      ok: false,
      reason: "Artifact provenance destination path does not match the requested path.",
      provenancePath,
    };
  }

  const mismatch = findIdentityMismatch(manifest, input);
  if (mismatch) {
    return { ok: false, reason: mismatch, provenancePath };
  }

  let destination: AgentArtifactProvenanceManifest["destination"];
  try {
    destination = await describeArtifactDestination(
      input.artifactPath,
      input.signal,
    );
  } catch (error) {
    if (error instanceof NonRegularArtifactError) {
      return { ok: false, reason: error.message, provenancePath };
    }
    throw error;
  }
  if (
    manifest.destination.sha256 !== destination.sha256 ||
    manifest.destination.sizeBytes !== destination.sizeBytes
  ) {
    return {
      ok: false,
      reason: "Artifact provenance destination hash does not match current content.",
      provenancePath,
    };
  }

  return {
    ok: true,
    manifest,
    provenancePath,
    sidecarSha256: createHash("sha256").update(sidecarContent).digest("hex"),
  };
}

async function readProvenanceSidecar(
  provenancePath: string,
  signal?: AbortSignal,
): Promise<string> {
  throwIfProvenanceAborted(signal);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      provenancePath,
      constants.O_RDONLY |
        (constants.O_NONBLOCK ?? 0) |
        (constants.O_NOFOLLOW ?? 0),
    );
    throwIfProvenanceAborted(signal);
    const stats = await handle.stat();
    throwIfProvenanceAborted(signal);
    if (!stats.isFile()) {
      throw new InvalidProvenanceSidecarError(
        "Artifact provenance sidecar must be a regular file.",
      );
    }
    if (stats.size > maximumProvenanceSidecarBytes) {
      throw new InvalidProvenanceSidecarError(
        "Artifact provenance sidecar exceeds the size limit.",
      );
    }

    const chunks: Buffer[] = [];
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let totalBytes = 0;
    while (true) {
      throwIfProvenanceAborted(signal);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      throwIfProvenanceAborted(signal);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maximumProvenanceSidecarBytes) {
        throw new InvalidProvenanceSidecarError(
          "Artifact provenance sidecar exceeds the size limit.",
        );
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks, totalBytes).toString("utf8");
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      throw new ArtifactProvenanceAbortError();
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function describeArtifactDestination(
  artifactPath: string,
  signal?: AbortSignal,
): Promise<AgentArtifactProvenanceManifest["destination"]> {
  throwIfProvenanceAborted(signal);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      artifactPath,
      constants.O_RDONLY |
        (constants.O_NONBLOCK ?? 0) |
        (constants.O_NOFOLLOW ?? 0),
    );
    throwIfProvenanceAborted(signal);
    const stats = await handle.stat();
    throwIfProvenanceAborted(signal);
    if (!stats.isFile()) {
      throw new NonRegularArtifactError();
    }

    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let sizeBytes = 0;
    while (true) {
      throwIfProvenanceAborted(signal);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      throwIfProvenanceAborted(signal);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      sizeBytes += bytesRead;
    }
    return {
      path: path.resolve(artifactPath),
      sha256: hash.digest("hex"),
      sizeBytes,
    };
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      throw new ArtifactProvenanceAbortError();
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

class NonRegularArtifactError extends Error {
  constructor() {
    super("Artifact destination must be a regular file.");
    this.name = "NonRegularArtifactError";
  }
}

class InvalidProvenanceSidecarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProvenanceSidecarError";
  }
}

function throwIfProvenanceAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ArtifactProvenanceAbortError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function safeWriteFile(
  targetPath: string,
  content: string,
  symlinkReason: string,
): Promise<void> {
  await assertNoSymlinkPathSegments(targetPath, symlinkReason, symlinkReason);
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, targetPath);
}

async function verifyArtifactPathsHaveNoSymlinks(
  artifactPath: string,
  provenancePath: string,
): Promise<string | null> {
  try {
    await assertArtifactPathHasNoSymlinks(artifactPath);
    await assertNoSymlinkPathSegments(
      provenancePath,
      "Artifact provenance sidecar must not be a symlink.",
      "Artifact provenance sidecar parents must not contain symlinks.",
    );
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

async function assertNoSymlinkPathSegments(
  targetPath: string,
  leafReason: string,
  parentReason: string,
): Promise<void> {
  const resolved = path.resolve(targetPath);
  const parsed = path.parse(resolved);
  const parts = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;

  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        if (await isAllowedSystemPathAlias(current)) {
          continue;
        }
        throw new Error(index === parts.length - 1 ? leafReason : parentReason);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

async function isAllowedSystemPathAlias(segmentPath: string): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }
  const normalized = segmentPath.replace(/\/+$/, "");
  if (normalized !== "/var" && normalized !== "/tmp") {
    return false;
  }
  try {
    const target = await realpath(segmentPath);
    return (
      (normalized === "/var" && target === "/private/var") ||
      (normalized === "/tmp" && target === "/private/tmp")
    );
  } catch {
    return false;
  }
}

function findIdentityMismatch(
  manifest: AgentArtifactProvenanceManifest,
  input: VerifyArtifactProvenanceInput,
): string | null {
  if (input.runId !== undefined && manifest.runId !== input.runId) {
    return "Artifact provenance runId does not match.";
  }
  if (input.goalId !== undefined && manifest.goalId !== input.goalId) {
    return "Artifact provenance goalId does not match.";
  }
  if (input.milestoneId !== undefined && manifest.milestoneId !== input.milestoneId) {
    return "Artifact provenance milestoneId does not match.";
  }
  if (input.artifactId !== undefined && manifest.artifactId !== input.artifactId) {
    return "Artifact provenance artifactId does not match.";
  }
  if (input.artifactRef !== undefined && manifest.artifactRef !== input.artifactRef) {
    return "Artifact provenance artifactRef does not match.";
  }
  return null;
}

function isArtifactProvenanceManifest(
  value: unknown,
): value is AgentArtifactProvenanceManifest {
  if (!isRecord(value)) {
    return false;
  }
  if (value.schemaVersion !== 1 || value.kind !== "zerox.artifactProvenance") {
    return false;
  }
  return (
    isNonEmptyString(value.runId) &&
    optionalString(value.goalId) &&
    optionalString(value.milestoneId) &&
    isNonEmptyString(value.artifactId) &&
    isNonEmptyString(value.artifactRef) &&
    isSource(value.source) &&
    isDestination(value.destination) &&
    isNonEmptyString(value.generatedAt)
  );
}

function isSource(value: unknown): value is AgentArtifactProvenanceManifest["source"] {
  return (
    isRecord(value) &&
    isNonEmptyString(value.type) &&
    optionalString(value.path) &&
    optionalString(value.sha256)
  );
}

function isDestination(
  value: unknown,
): value is AgentArtifactProvenanceManifest["destination"] {
  return (
    isRecord(value) &&
    isNonEmptyString(value.path) &&
    /^[a-f0-9]{64}$/.test(String(value.sha256)) &&
    typeof value.sizeBytes === "number" &&
    Number.isFinite(value.sizeBytes) &&
    value.sizeBytes >= 0
  );
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
