import { createHash } from "node:crypto";
import { lstat, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

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
};

export type ArtifactProvenanceVerification =
  | { ok: true; manifest: AgentArtifactProvenanceManifest; provenancePath: string }
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
  const provenancePath = getArtifactProvenancePath(input.artifactPath);
  const pathCheck = await verifyArtifactPathsHaveNoSymlinks(
    input.artifactPath,
    provenancePath,
  );
  if (pathCheck) {
    return { ok: false, reason: pathCheck, provenancePath };
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(provenancePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, reason: "Artifact provenance sidecar is missing.", provenancePath };
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

  const destination = await describeArtifactDestination(input.artifactPath);
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

  return { ok: true, manifest, provenancePath };
}

async function describeArtifactDestination(
  artifactPath: string,
): Promise<AgentArtifactProvenanceManifest["destination"]> {
  const content = await readFile(artifactPath);
  const stats = await stat(artifactPath);
  return {
    path: path.resolve(artifactPath),
    sha256: sha256(content),
    sizeBytes: stats.size,
  };
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

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
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
