import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  open,
  realpath,
  unlink,
} from "node:fs/promises";
import path from "node:path";

export const PRIVATE_MODE_V8 = 0o600;

const LEDGER_KIND = "conversation-disclosure-runtime-capture-ledger-v8";

export class RuntimeIoV8Error extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RuntimeIoV8Error";
    this.code = code;
  }
}

export function createCaptureLedgerV8() {
  return {
    kind: LEDGER_KIND,
    entries: [],
    byAbsolutePath: new Map(),
  };
}

export function sha256BytesV8(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    throw failure("INVALID_ARGUMENT", "SHA-256 input must be a Buffer");
  }
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function captureStableFileV8(
  absolutePath,
  label = absolutePath,
  {
    expectedRoot,
    ledger,
    requirePrivate = false,
    expectedMode,
    expectedUid,
  } = {},
) {
  requireAbsolutePath(absolutePath, label);
  await assertExpectedRootV8(absolutePath, expectedRoot, label, true);
  const parents = await captureParentIdentitiesV8(absolutePath, label);
  let before;
  try {
    before = await lstat(absolutePath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw failure("MISSING", `${label} is missing`);
    }
    throw error;
  }
  requireRegularSingleLink(before, label);
  const requiredMode = requirePrivate ? PRIVATE_MODE_V8 : expectedMode;
  const requiredUid = requirePrivate ? process.geteuid() : expectedUid;
  requireModeAndOwner(before, requiredMode, requiredUid, label);

  const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    requireSameLeaf(before, opened, `${label} changed identity while opening`);
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    requireSameLeaf(opened, after, `${label} changed while reading`);
    if (after.size !== BigInt(bytes.length)) {
      throw failure("IDENTITY_DRIFT", `${label} size changed while reading`);
    }
    const finalLeaf = await lstat(absolutePath, { bigint: true });
    requireSameLeaf(opened, finalLeaf, `${label} pathname identity changed while reading`);
    await assertParentIdentitiesV8(parents, label);
    await assertExpectedRootV8(absolutePath, expectedRoot, label, true);
    const capture = {
      kind: "present",
      absolutePath,
      label,
      expectedRoot,
      requirePrivate,
      expectedMode: requiredMode,
      expectedUid: requiredUid,
      parents,
      identity: leafIdentity(opened),
      bytes,
      digest: sha256BytesV8(bytes),
      mode: Number(opened.mode & 0o777n),
      uid: Number(opened.uid),
    };
    recordCaptureV8(ledger, capture);
    return capture;
  } finally {
    await handle.close();
  }
}

export function capturePrivateEvidenceV8(
  absolutePath,
  label = absolutePath,
  options = {},
) {
  return captureStableFileV8(absolutePath, label, {
    ...options,
    requirePrivate: true,
  });
}

export async function captureRequiredAbsentV8(
  absolutePath,
  label = absolutePath,
  { expectedRoot, ledger } = {},
) {
  requireAbsolutePath(absolutePath, label);
  await assertExpectedRootV8(absolutePath, expectedRoot, label, false);
  const parents = await captureParentIdentitiesV8(absolutePath, label);
  try {
    await lstat(absolutePath, { bigint: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const capture = {
      kind: "absent",
      absolutePath,
      label,
      expectedRoot,
      parents,
    };
    recordCaptureV8(ledger, capture);
    return capture;
  }
  throw failure("EXPECTED_ABSENT", `${label} must be absent`);
}

export async function postflightCaptureLedgerV8(ledger) {
  requireLedgerV8(ledger);
  for (const capture of ledger.entries) {
    await assertParentIdentitiesV8(capture.parents, capture.label);
    await assertExpectedRootV8(
      capture.absolutePath,
      capture.expectedRoot,
      capture.label,
      capture.kind === "present",
    );
    if (capture.kind === "absent") {
      try {
        await lstat(capture.absolutePath, { bigint: true });
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      throw failure("APPEARED", `${capture.label} appeared after capture`);
    }
    const current = await captureStableFileV8(
      capture.absolutePath,
      capture.label,
      {
        expectedRoot: capture.expectedRoot,
        requirePrivate: capture.requirePrivate,
        expectedMode: capture.expectedMode,
        expectedUid: capture.expectedUid,
      },
    );
    if (!sameLeafIdentity(current.identity, capture.identity)
      || current.digest !== capture.digest
      || current.mode !== capture.mode
      || current.uid !== capture.uid
      || !current.bytes.equals(capture.bytes)) {
      throw failure("CAPTURE_DRIFT", `${capture.label} changed after capture`);
    }
  }
  return { status: "passed", captureCount: ledger.entries.length };
}

export async function publishPrivateExactV8(
  absolutePath,
  bytes,
  { expectedRoot, label = "private output" } = {},
) {
  requireAbsolutePath(absolutePath, label);
  if (!Buffer.isBuffer(bytes)) {
    throw failure("INVALID_ARGUMENT", `${label} publication bytes must be a Buffer`);
  }
  await assertExpectedRootV8(absolutePath, expectedRoot, label, false);
  const parents = await captureParentIdentitiesV8(absolutePath, label);
  const directory = path.dirname(absolutePath);
  const basename = path.basename(absolutePath);
  const temporaryPath = path.join(
    directory,
    `.${basename}.${sha256BytesV8(bytes).slice(7, 31)}.tmp`,
  );
  const expectedParent = parents.at(-1);
  const directoryHandle = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const openedDirectory = await directoryHandle.stat({ bigint: true });
    if (!expectedParent || !openedDirectory.isDirectory()
      || openedDirectory.dev !== expectedParent.dev
      || openedDirectory.ino !== expectedParent.ino) {
      throw failure("PARENT_DRIFT", `${label} parent changed while opening`);
    }
    const outputEntry = await optionalLstatV8(absolutePath);
    const temporaryEntry = await optionalLstatV8(temporaryPath);
    if (outputEntry && temporaryEntry) {
      const output = await captureRecoverablePrivateLeafV8(
        absolutePath,
        label,
        expectedRoot,
        2n,
      );
      const temporary = await captureRecoverablePrivateLeafV8(
        temporaryPath,
        `${label} recovery temporary output`,
        expectedRoot,
        2n,
      );
      if (output.identity.dev !== temporary.identity.dev
        || output.identity.ino !== temporary.identity.ino
        || !output.bytes.equals(bytes)
        || !temporary.bytes.equals(bytes)) {
        throw failure("THIRD_STATE", `${label} recovery link pair is invalid`);
      }
      await unlink(temporaryPath);
      await directoryHandle.sync();
      const recovered = await capturePrivateEvidenceV8(
        absolutePath,
        label,
        { expectedRoot },
      );
      return publicationReceipt("idempotent", recovered);
    }
    const existing = outputEntry
      ? await capturePrivateEvidenceV8(absolutePath, label, { expectedRoot })
      : null;
    if (existing) {
      if (!existing.bytes.equals(bytes)) {
        throw failure("THIRD_STATE", `${label} contains different existing bytes`);
      }
      await assertOpenedDirectoryV8(directoryHandle, expectedParent, label);
      await assertParentIdentitiesV8(parents, label);
      return publicationReceipt("idempotent", existing);
    }

    let temporaryCreated = temporaryEntry !== null;
    try {
      if (temporaryEntry) {
        const temporary = await captureRecoverablePrivateLeafV8(
          temporaryPath,
          `${label} recovery temporary output`,
          expectedRoot,
          1n,
        );
        if (!temporary.bytes.equals(bytes)) {
          await unlink(temporaryPath);
          temporaryCreated = false;
        }
      }
      if (!temporaryCreated) {
        const temporaryHandle = await open(
          temporaryPath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
          PRIVATE_MODE_V8,
        );
        temporaryCreated = true;
        try {
          await temporaryHandle.chmod(PRIVATE_MODE_V8);
          await temporaryHandle.writeFile(bytes);
          await temporaryHandle.sync();
          const temporary = await temporaryHandle.stat({ bigint: true });
          requireRegularSingleLink(temporary, `${label} temporary output`);
          requireModeAndOwner(
            temporary,
            PRIVATE_MODE_V8,
            process.geteuid(),
            `${label} temporary output`,
          );
          if (temporary.size !== BigInt(bytes.length)) {
            throw failure("PUBLICATION", `${label} temporary output size is stale`);
          }
        } finally {
          await temporaryHandle.close();
        }
      }

      await assertOpenedDirectoryV8(directoryHandle, expectedParent, label);
      await assertParentIdentitiesV8(parents, label);
      let status = "created";
      try {
        await link(temporaryPath, absolutePath);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const raced = await capturePrivateEvidenceV8(absolutePath, label, { expectedRoot });
        if (!raced.bytes.equals(bytes)) {
          throw failure("THIRD_STATE", `${label} appeared with different bytes`);
        }
        status = "idempotent";
      }
      await unlink(temporaryPath);
      temporaryCreated = false;
      await directoryHandle.sync();
      await assertOpenedDirectoryV8(directoryHandle, expectedParent, label);
      await assertParentIdentitiesV8(parents, label);
      const published = await capturePrivateEvidenceV8(absolutePath, label, { expectedRoot });
      if (!published.bytes.equals(bytes)) {
        throw failure("PUBLICATION", `${label} publication verification failed`);
      }
      return publicationReceipt(status, published);
    } finally {
      if (temporaryCreated) {
        try {
          await unlink(temporaryPath);
          await directoryHandle.sync();
        } catch {}
      }
    }
  } finally {
    await directoryHandle.close();
  }
}

async function optionalLstatV8(absolutePath) {
  try {
    return await lstat(absolutePath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function captureRecoverablePrivateLeafV8(
  absolutePath,
  label,
  expectedRoot,
  expectedLinks,
) {
  await assertExpectedRootV8(absolutePath, expectedRoot, label, true);
  const parents = await captureParentIdentitiesV8(absolutePath, label);
  const before = await lstat(absolutePath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()
    || before.nlink !== expectedLinks) {
    throw failure("INVALID_LEAF", `${label} recovery link count is invalid`);
  }
  requireModeAndOwner(before, PRIVATE_MODE_V8, process.geteuid(), label);
  const handle = await open(
    absolutePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev
      || opened.ino !== before.ino || opened.nlink !== expectedLinks) {
      throw failure("IDENTITY_DRIFT", `${label} changed while opening`);
    }
    const capturedBytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const finalLeaf = await lstat(absolutePath, { bigint: true });
    for (const current of [after, finalLeaf]) {
      if (!current.isFile() || current.isSymbolicLink()
        || current.dev !== opened.dev || current.ino !== opened.ino
        || current.nlink !== expectedLinks
        || current.size !== BigInt(capturedBytes.length)) {
        throw failure("IDENTITY_DRIFT", `${label} changed while reading`);
      }
    }
    await assertParentIdentitiesV8(parents, label);
    return {
      identity: leafIdentity(opened),
      bytes: capturedBytes,
      digest: sha256BytesV8(capturedBytes),
      mode: Number(opened.mode & 0o777n),
      uid: Number(opened.uid),
    };
  } finally {
    await handle.close();
  }
}

function publicationReceipt(status, capture) {
  return {
    status,
    digest: capture.digest,
    dev: Number(capture.identity.dev),
    ino: Number(capture.identity.ino),
    mode: capture.mode,
  };
}

function recordCaptureV8(ledger, capture) {
  if (ledger === undefined) return;
  requireLedgerV8(ledger);
  const existing = ledger.byAbsolutePath.get(capture.absolutePath);
  if (existing) {
    const compatible = existing.kind === capture.kind
      && (capture.kind === "absent"
        ? sameParentIdentities(existing.parents, capture.parents)
        : sameLeafIdentity(existing.identity, capture.identity)
          && existing.digest === capture.digest
          && existing.mode === capture.mode
          && existing.uid === capture.uid);
    if (!compatible) {
      throw failure(
        "LEDGER_CONFLICT",
        `${capture.label} conflicts with its earlier capture ledger entry`,
      );
    }
    return;
  }
  ledger.entries.push(capture);
  ledger.byAbsolutePath.set(capture.absolutePath, capture);
}

function requireLedgerV8(ledger) {
  if (!ledger || ledger.kind !== LEDGER_KIND || !Array.isArray(ledger.entries)
    || !(ledger.byAbsolutePath instanceof Map)) {
    throw failure("INVALID_LEDGER", "capture ledger is invalid");
  }
}

async function captureParentIdentitiesV8(absolutePath, label) {
  const parentPath = path.dirname(absolutePath);
  const parsed = path.parse(parentPath);
  const segments = parentPath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let cursor = parsed.root;
  const identities = [];
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    let entry;
    try {
      entry = await lstat(cursor, { bigint: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw failure("MISSING_PARENT", `${label} parent is missing: ${cursor}`);
      }
      throw error;
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw failure("PARENT_ALIAS", `${label} parent must not traverse symlinks`);
    }
    identities.push({ path: cursor, dev: entry.dev, ino: entry.ino });
  }
  return identities;
}

async function assertParentIdentitiesV8(identities, label) {
  for (const expected of identities) {
    let current;
    try {
      current = await lstat(expected.path, { bigint: true });
    } catch {
      throw failure("PARENT_DRIFT", `${label} parent identity changed`);
    }
    if (!current.isDirectory() || current.isSymbolicLink()
      || current.dev !== expected.dev || current.ino !== expected.ino) {
      throw failure("PARENT_DRIFT", `${label} parent identity changed`);
    }
  }
}

async function assertOpenedDirectoryV8(handle, expected, label) {
  const current = await handle.stat({ bigint: true });
  if (!current.isDirectory() || current.dev !== expected.dev || current.ino !== expected.ino) {
    throw failure("PARENT_DRIFT", `${label} opened parent identity changed`);
  }
}

async function assertExpectedRootV8(absolutePath, expectedRoot, label, leafExists) {
  if (expectedRoot === undefined) return;
  requireAbsolutePath(expectedRoot, `${label} expected root`);
  const canonicalRoot = await realpath(expectedRoot);
  if (canonicalRoot !== expectedRoot) {
    throw failure("ROOT_ALIAS", `${label} expected root must be canonical`);
  }
  const parentPath = path.dirname(absolutePath);
  const canonicalParent = await realpath(parentPath);
  if (canonicalParent !== parentPath || !isWithin(expectedRoot, canonicalParent)) {
    throw failure("ROOT_ESCAPE", `${label} escaped its expected root`);
  }
  if (leafExists) {
    const canonicalLeaf = await realpath(absolutePath);
    if (canonicalLeaf !== absolutePath || !isWithin(expectedRoot, canonicalLeaf)) {
      throw failure("ROOT_ESCAPE", `${label} escaped its expected root`);
    }
  }
}

function requireRegularSingleLink(entry, label) {
  if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1n) {
    throw failure("INVALID_LEAF", `${label} must be one non-symlink single-link regular file`);
  }
}

function requireModeAndOwner(entry, expectedMode, expectedUid, label) {
  if (expectedMode !== undefined && Number(entry.mode & 0o777n) !== expectedMode) {
    throw failure("MODE", `${label} mode must be ${expectedMode.toString(8).padStart(4, "0")}`);
  }
  if (expectedUid !== undefined && Number(entry.uid) !== expectedUid) {
    throw failure("OWNER", `${label} owner is invalid`);
  }
}

function leafIdentity(entry) {
  return {
    dev: entry.dev,
    ino: entry.ino,
    nlink: entry.nlink,
    uid: entry.uid,
    mode: entry.mode & 0o777n,
    size: entry.size,
    mtimeNs: entry.mtimeNs,
    ctimeNs: entry.ctimeNs,
  };
}

function requireSameLeaf(expected, current, message) {
  requireRegularSingleLink(current, message);
  if (!sameLeafIdentity(leafIdentity(expected), leafIdentity(current))) {
    throw failure("IDENTITY_DRIFT", message);
  }
}

function sameLeafIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino
    && left.nlink === right.nlink && left.uid === right.uid
    && left.mode === right.mode && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function sameParentIdentities(left, right) {
  return left.length === right.length && left.every((entry, index) =>
    entry.path === right[index].path
      && entry.dev === right[index].dev
      && entry.ino === right[index].ino);
}

function requireAbsolutePath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)
    || path.resolve(value) !== value) {
    throw failure("INVALID_ARGUMENT", `${label} path must be normalized and absolute`);
  }
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function failure(code, message) {
  return new RuntimeIoV8Error(`RUNTIME_IO_V8_${code}`, message);
}
