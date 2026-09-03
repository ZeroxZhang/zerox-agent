import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  lstat,
  open,
  realpath,
} from "node:fs/promises";
import path from "node:path";

export const PRIVATE_MODE_V9 = 0o600;

const LEDGER_KIND = "conversation-disclosure-runtime-capture-ledger-v9";

export class RuntimeIoV9Error extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RuntimeIoV9Error";
    this.code = code;
  }
}

export function createCaptureLedgerV9() {
  return {
    kind: LEDGER_KIND,
    entries: [],
    byAbsolutePath: new Map(),
  };
}

export function sha256BytesV9(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    throw failure("INVALID_ARGUMENT", "SHA-256 input must be a Buffer");
  }
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function captureStableFileV9(
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
  await assertExpectedRootV9(absolutePath, expectedRoot, label, true);
  const parents = await captureParentIdentitiesV9(absolutePath, label);
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
  const requiredMode = requirePrivate ? PRIVATE_MODE_V9 : expectedMode;
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
    await assertParentIdentitiesV9(parents, label);
    await assertExpectedRootV9(absolutePath, expectedRoot, label, true);
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
      digest: sha256BytesV9(bytes),
      mode: Number(opened.mode & 0o777n),
      uid: Number(opened.uid),
    };
    recordCaptureV9(ledger, capture);
    return capture;
  } finally {
    await handle.close();
  }
}

export function capturePrivateEvidenceV9(
  absolutePath,
  label = absolutePath,
  options = {},
) {
  return captureStableFileV9(absolutePath, label, {
    ...options,
    requirePrivate: true,
  });
}

export async function captureRequiredAbsentV9(
  absolutePath,
  label = absolutePath,
  { expectedRoot, ledger } = {},
) {
  requireAbsolutePath(absolutePath, label);
  await assertExpectedRootV9(absolutePath, expectedRoot, label, false);
  const parents = await captureParentIdentitiesV9(absolutePath, label);
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
    recordCaptureV9(ledger, capture);
    return capture;
  }
  throw failure("EXPECTED_ABSENT", `${label} must be absent`);
}

export async function postflightCaptureLedgerV9(ledger) {
  requireLedgerV9(ledger);
  for (const capture of ledger.entries) {
    await assertParentIdentitiesV9(capture.parents, capture.label);
    await assertExpectedRootV9(
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
    const current = await captureStableFileV9(
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

export async function publishPrivateExactV9(
  absolutePath,
  bytes,
  { expectedRoot, label = "private output" } = {},
) {
  requireAbsolutePath(absolutePath, label);
  if (!Buffer.isBuffer(bytes)) {
    throw failure("INVALID_ARGUMENT", `${label} publication bytes must be a Buffer`);
  }
  await assertExpectedRootV9(absolutePath, expectedRoot, label, false);
  const parents = await captureParentIdentitiesV9(absolutePath, label);
  const directory = path.dirname(absolutePath);
  const basename = path.basename(absolutePath);
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
    try {
      const existingEntry = await lstat(absolutePath, { bigint: true });
      if (existingEntry.nlink === 1n) {
        const existing = await capturePrivateEvidenceV9(
          absolutePath,
          label,
          { expectedRoot },
        );
        if (!existing.bytes.equals(bytes)) {
          throw failure("THIRD_STATE", `${label} contains different existing bytes`);
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const status = await runPrivatePublicationBridgeV9({
      directoryHandle,
      expectedParent,
      basename,
      bytes,
      label,
    });
    await assertOpenedDirectoryV9(directoryHandle, expectedParent, label);
    await assertParentIdentitiesV9(parents, label);
    const published = await capturePrivateEvidenceV9(
      absolutePath,
      label,
      { expectedRoot },
    );
    if (!published.bytes.equals(bytes)) {
      throw failure("PUBLICATION", `${label} publication verification failed`);
    }
    return publicationReceipt(status, published);
  } finally {
    await directoryHandle.close();
  }
}

async function runPrivatePublicationBridgeV9({
  directoryHandle,
  expectedParent,
  basename,
  bytes,
  label,
}) {
  const script = String.raw`
import hashlib, json, os, stat, sys
target, expected_digest, expected_dev, expected_ino = sys.argv[1:]
dir_fd = 3
payload = sys.stdin.buffer.read()
temp = "." + target + "." + expected_digest[7:31] + ".tmp"

def die(message):
    sys.stderr.write(message + "\n")
    raise SystemExit(2)

def inspect(name):
    try:
        entry = os.lstat(name, dir_fd=dir_fd)
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(entry.st_mode) or entry.st_uid != os.geteuid() or stat.S_IMODE(entry.st_mode) != 0o600:
        die("private publication leaf metadata is invalid: " + name)
    fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=dir_fd)
    try:
        opened = os.fstat(fd)
        if (opened.st_dev, opened.st_ino, opened.st_nlink) != (entry.st_dev, entry.st_ino, entry.st_nlink):
            die("private publication leaf changed while opening: " + name)
        data = b""
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            data += chunk
        after = os.fstat(fd)
        if (after.st_dev, after.st_ino, after.st_nlink, after.st_size) != (opened.st_dev, opened.st_ino, opened.st_nlink, len(data)):
            die("private publication leaf changed while reading: " + name)
        return {"dev": opened.st_dev, "ino": opened.st_ino, "nlink": opened.st_nlink, "data": data}
    finally:
        os.close(fd)

directory = os.fstat(dir_fd)
if not stat.S_ISDIR(directory.st_mode) or str(directory.st_dev) != expected_dev or str(directory.st_ino) != expected_ino:
    die("private publication parent identity changed")
if "sha256:" + hashlib.sha256(payload).hexdigest() != expected_digest:
    die("private publication payload digest is stale")

current = inspect(target)
temporary = inspect(temp)
if current is not None and temporary is not None:
    if (current["dev"], current["ino"], current["nlink"]) != (temporary["dev"], temporary["ino"], 2) or temporary["nlink"] != 2 or current["data"] != payload or temporary["data"] != payload:
        die("private publication recovery link pair is invalid")
    os.unlink(temp, dir_fd=dir_fd)
    os.fsync(dir_fd)
    print(json.dumps({"status": "idempotent"}))
    raise SystemExit(0)
if current is not None:
    if current["nlink"] != 1 or current["data"] != payload:
        die("private publication target contains third-state bytes")
    print(json.dumps({"status": "idempotent"}))
    raise SystemExit(0)
if temporary is not None:
    if temporary["nlink"] != 1 or not payload.startswith(temporary["data"]):
        die("private publication temporary is not recoverable")
    fd = os.open(temp, os.O_WRONLY | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0), dir_fd=dir_fd)
    try:
        view = memoryview(payload[len(temporary["data"]):])
        while view:
            written = os.write(fd, view)
            view = view[written:]
        os.fsync(fd)
    finally:
        os.close(fd)
else:
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600, dir_fd=dir_fd)
    try:
        os.fchmod(fd, 0o600)
        view = memoryview(payload)
        while view:
            written = os.write(fd, view)
            view = view[written:]
        os.fsync(fd)
    finally:
        os.close(fd)
temporary = inspect(temp)
if temporary is None or temporary["nlink"] != 1 or temporary["data"] != payload:
    die("private publication temporary did not converge")
try:
    os.link(temp, target, src_dir_fd=dir_fd, dst_dir_fd=dir_fd, follow_symlinks=False)
except FileExistsError:
    raced = inspect(target)
    if raced is None or raced["nlink"] != 1 or raced["data"] != payload:
        die("private publication target raced to a third state")
    os.unlink(temp, dir_fd=dir_fd)
    os.fsync(dir_fd)
    print(json.dumps({"status": "idempotent"}))
    raise SystemExit(0)
linked = inspect(target)
temporary = inspect(temp)
if linked is None or temporary is None or linked["nlink"] != 2 or temporary["nlink"] != 2 or (linked["dev"], linked["ino"]) != (temporary["dev"], temporary["ino"]) or linked["data"] != payload:
    die("private publication hard-link commit is invalid")
os.unlink(temp, dir_fd=dir_fd)
os.fsync(dir_fd)
print(json.dumps({"status": "created"}))
`;
  const child = spawn("/usr/bin/python3", [
    "-I",
    "-c",
    script,
    basename,
    sha256BytesV9(bytes),
    String(expectedParent.dev),
    String(expectedParent.ino),
  ], {
    env: { PATH: "/usr/bin:/bin" },
    stdio: ["pipe", "pipe", "pipe", directoryHandle.fd],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  child.stdin.end(bytes);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code !== 0) {
    throw failure(
      "PUBLICATION",
      `${label} anchored publication failed: ${
        Buffer.concat(stderr).toString("utf8").trim() || `exit ${code}`
      }`,
    );
  }
  const result = JSON.parse(Buffer.concat(stdout).toString("utf8"));
  return result.status;
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

function recordCaptureV9(ledger, capture) {
  if (ledger === undefined) return;
  requireLedgerV9(ledger);
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

function requireLedgerV9(ledger) {
  if (!ledger || ledger.kind !== LEDGER_KIND || !Array.isArray(ledger.entries)
    || !(ledger.byAbsolutePath instanceof Map)) {
    throw failure("INVALID_LEDGER", "capture ledger is invalid");
  }
}

async function captureParentIdentitiesV9(absolutePath, label) {
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

async function assertParentIdentitiesV9(identities, label) {
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

async function assertOpenedDirectoryV9(handle, expected, label) {
  const current = await handle.stat({ bigint: true });
  if (!current.isDirectory() || current.dev !== expected.dev || current.ino !== expected.ino) {
    throw failure("PARENT_DRIFT", `${label} opened parent identity changed`);
  }
}

async function assertExpectedRootV9(absolutePath, expectedRoot, label, leafExists) {
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
  return new RuntimeIoV9Error(`RUNTIME_IO_V9_${code}`, message);
}
