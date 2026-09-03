#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  lstat,
  open,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  captureStableFileV12,
  publishPrivateExactV12,
} from "./conversation-disclosure-continuation-runtime-io-v12.mjs";

import {
  CD04_DELTA_MANIFEST_PATH,
  CD04_DELTA_RECEIPT_PATHS,
  CD04_DELTA_REVIEW_LANES,
  CD04_DELTA_REVIEW_OUTPUT_PATHS,
  CD04_DELTA_REVIEW_PATH,
  CD04_DELTA_SNAPSHOT_PATH,
  sha256BytesV13,
  validateCd04DeltaAnchorV13,
  validateCd04DeltaManifestV13,
  validateCd04DeltaSnapshotV13,
  validateCd04ReviewArtifactV13,
  validateCd04ReviewOutputV13,
  validateCd04ReviewReceiptV13,
} from "./conversation-disclosure-delta-contract-v13.mjs";
import {
  checkConversationDisclosureProgramV13,
} from "./check-conversation-disclosure-program-v13.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function applyCd04DeltaV13(options) {
  const [snapshot, manifest, anchor] = await Promise.all([
    readJson(path.join(root, CD04_DELTA_SNAPSHOT_PATH), true),
    readJson(path.join(root, CD04_DELTA_MANIFEST_PATH), true),
    readJson(path.resolve(options.deltaAnchor), true),
  ]);
  const receipts = Object.fromEntries(await Promise.all(
    CD04_DELTA_REVIEW_LANES.map(async (lane) => [
      lane,
      await readJson(
        path.join(root, CD04_DELTA_RECEIPT_PATHS[lane]),
        true,
      ),
    ]),
  ));
  const reviewBytes = (
    await readStableBytes(path.join(root, CD04_DELTA_REVIEW_PATH))
  ).bytes;
  const reviewOutputs = Object.fromEntries(await Promise.all(
    CD04_DELTA_REVIEW_LANES.map(async (lane) => [
      lane,
      await readJsonCapture(path.join(
        root,
        CD04_DELTA_REVIEW_OUTPUT_PATHS[lane],
      )),
    ]),
  ));
  const errors = [
    ...validateCd04DeltaSnapshotV13(snapshot),
    ...CD04_DELTA_REVIEW_LANES.flatMap((lane) =>
      validateCd04ReviewOutputV13(
        reviewOutputs[lane].value,
        snapshot,
        lane,
      )),
    ...CD04_DELTA_REVIEW_LANES.flatMap((lane) =>
      validateCd04ReviewReceiptV13(
        receipts[lane],
        snapshot,
        lane,
        reviewOutputs[lane].value,
      )),
    ...validateCd04DeltaManifestV13(manifest, snapshot, receipts),
    ...validateCd04DeltaAnchorV13(anchor, manifest, snapshot),
    ...validateCd04ReviewArtifactV13(
      reviewBytes.toString("utf8"),
      snapshot,
      receipts,
    ),
  ];
  if (manifest.reviewArtifactSha256 !== sha256BytesV13(reviewBytes)) {
    errors.push("CD04 review artifact differs from the manifest");
  }
  for (const lane of CD04_DELTA_REVIEW_LANES) {
    if (
      reviewOutputs[lane].sha256 !== receipts[lane].reviewOutputSha256
    ) {
      errors.push(`${lane} receipt is not bound to its review output`);
    }
  }
  if (
    anchor.digest !== options.expectedDeltaAnchorDigest
    || anchor.repositoryRealpath !== root
  ) {
    errors.push("caller-pinned CD04 delta anchor is invalid");
  }
  if (errors.length > 0) {
    throw new Error(`CD04 delta admission failed: ${errors.join("; ")}`);
  }
  await preflightCd04TransitionV13({
    repositoryRoot: root,
    snapshot,
  });
  const journalPath = `${path.resolve(options.deltaAnchor)}.transition.json`;
  const journal = {
    schemaVersion: 13,
    kind: "conversation-disclosure-cd04-delta-transition",
    snapshotDigest: snapshot.digest,
    manifestDigest: manifest.digest,
    anchorDigest: anchor.digest,
    repositoryRealpath: root,
    status: "applying",
  };
  await publishOrReplaceJournalV13(journalPath, journal);
  await applyCd04TransitionFilesV13({
    repositoryRoot: root,
    snapshot,
    failAfterTransition: options.failAfterTransition,
  });
  const receipt = await checkConversationDisclosureProgramV13({
    diagnosticOnly: false,
    deltaAnchor: options.deltaAnchor,
    expectedDeltaAnchorDigest: options.expectedDeltaAnchorDigest,
  });
  await preflightCd04TransitionV13({
    repositoryRoot: root,
    snapshot,
  });
  await publishOrReplaceJournalV13(journalPath, {
    ...journal,
    status: "completed",
    checkerReceiptDigest: receipt.digest,
  });
  return receipt;
}

export async function preflightCd04TransitionV13(options) {
  for (const entry of options.snapshot.frozenEntries) {
    const capture = await readStableBytes(
      path.join(options.repositoryRoot, entry.path),
    );
    if (sha256BytesV13(capture.bytes) !== entry.sha256) {
      throw new Error(`frozen P108 file drifted before transition: ${entry.path}`);
    }
  }
  for (const artifact of Object.values(options.snapshot.artifacts)) {
    const capture = await readStableBytes(
      path.join(options.repositoryRoot, artifact.path),
      true,
    );
    const value = JSON.parse(capture.bytes.toString("utf8"));
    if (
      sha256BytesV13(capture.bytes) !== artifact.sha256
      || value.digest !== artifact.canonicalDigest
      || value.accepted !== true
    ) {
      throw new Error(`reviewed artifact drifted before transition: ${artifact.path}`);
    }
  }
  for (const transition of options.snapshot.transitions) {
    const [live, target] = await Promise.all([
      readStableBytes(path.join(options.repositoryRoot, transition.path)),
      readStableBytes(path.join(options.repositoryRoot, transition.targetPath)),
    ]);
    const liveDigest = sha256BytesV13(live.bytes);
    if (
      liveDigest !== transition.fromSha256
      && liveDigest !== transition.toSha256
    ) {
      throw new Error(`transition live file is third-state: ${transition.path}`);
    }
    if (sha256BytesV13(target.bytes) !== transition.toSha256) {
      throw new Error(`transition target drifted: ${transition.targetPath}`);
    }
  }
}

export async function applyCd04TransitionFilesV13(options) {
  let appliedCount = 0;
  for (const transition of options.snapshot.transitions) {
    const livePath = path.join(options.repositoryRoot, transition.path);
    const targetPath = path.join(
      options.repositoryRoot,
      transition.targetPath,
    );
    const [live, target] = await Promise.all([
      readStableBytes(livePath),
      readStableBytes(targetPath),
    ]);
    const liveDigest = sha256BytesV13(live.bytes);
    if (sha256BytesV13(target.bytes) !== transition.toSha256) {
      throw new Error(`transition target drifted: ${transition.targetPath}`);
    }
    if (liveDigest === transition.toSha256) continue;
    if (liveDigest !== transition.fromSha256) {
      throw new Error(`transition live file is third-state: ${transition.path}`);
    }
    await replaceTransitionFileV13({
      livePath,
      bytes: target.bytes,
      fromSha256: transition.fromSha256,
      toSha256: transition.toSha256,
      expectedLive: live.stat,
      temporaryName:
        `.${path.basename(livePath)}.cd04-v13-${
          options.snapshot.digest.slice(-12)
        }`,
      beforeCommit: options.beforeTransitionCommit
        ? () => options.beforeTransitionCommit({
            transition,
            appliedCount,
          })
        : undefined,
    });
    const applied = await readStableBytes(livePath);
    if (sha256BytesV13(applied.bytes) !== transition.toSha256) {
      throw new Error(`transition postflight failed: ${transition.path}`);
    }
    appliedCount += 1;
    if (options.failAfterTransition === appliedCount) {
      throw new Error(`injected transition failure after ${appliedCount}`);
    }
  }
}

async function replaceTransitionFileV13(options) {
  const parentPath = path.dirname(options.livePath);
  const parentBefore = await lstat(parentPath);
  if (!parentBefore.isDirectory() || parentBefore.isSymbolicLink()) {
    throw new Error(`transition parent is unsafe: ${options.livePath}`);
  }
  const directoryHandle = await open(
    parentPath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const openedParent = await directoryHandle.stat();
    if (
      !openedParent.isDirectory()
      || openedParent.dev !== parentBefore.dev
      || openedParent.ino !== parentBefore.ino
    ) {
      throw new Error(`transition parent identity changed: ${options.livePath}`);
    }
    await options.beforeCommit?.();
    const script = String.raw`
import hashlib, json, os, stat, sys
target, temporary, from_digest, to_digest, parent_dev, parent_ino, live_dev, live_ino, expected_uid, expected_mode = sys.argv[1:]
dir_fd = 3
payload = sys.stdin.buffer.read()

def die(message):
    sys.stderr.write(message + "\n")
    raise SystemExit(2)

def inspect(name):
    try:
        entry = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(entry.st_mode) or entry.st_nlink != 1:
        die("transition leaf metadata is invalid: " + name)
    fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=dir_fd)
    try:
        opened = os.fstat(fd)
        if (opened.st_dev, opened.st_ino, opened.st_nlink) != (entry.st_dev, entry.st_ino, entry.st_nlink):
            die("transition leaf changed while opening: " + name)
        chunks = []
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
        data = b"".join(chunks)
        after = os.fstat(fd)
        final = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
        identity = (opened.st_dev, opened.st_ino, opened.st_nlink, opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns)
        if identity != (after.st_dev, after.st_ino, after.st_nlink, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            die("transition leaf changed while reading: " + name)
        if identity != (final.st_dev, final.st_ino, final.st_nlink, final.st_size, final.st_mtime_ns, final.st_ctime_ns):
            die("transition pathname changed while reading: " + name)
        return {"entry": entry, "data": data}
    finally:
        os.close(fd)

directory = os.fstat(dir_fd)
if not stat.S_ISDIR(directory.st_mode) or str(directory.st_dev) != parent_dev or str(directory.st_ino) != parent_ino:
    die("transition parent descriptor changed")
if "sha256:" + hashlib.sha256(payload).hexdigest() != to_digest:
    die("transition payload digest is stale")

current = inspect(target)
if current is None:
    die("transition live file disappeared")
current_digest = "sha256:" + hashlib.sha256(current["data"]).hexdigest()
if current_digest == to_digest:
    print(json.dumps({"status": "idempotent"}))
    raise SystemExit(0)
if current_digest != from_digest:
    die("transition live file is third-state")
entry = current["entry"]
if str(entry.st_dev) != live_dev or str(entry.st_ino) != live_ino or str(entry.st_uid) != expected_uid or str(stat.S_IMODE(entry.st_mode)) != expected_mode:
    die("transition live identity changed")

prepared = inspect(temporary)
if prepared is None:
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), int(expected_mode), dir_fd=dir_fd)
    try:
        os.fchmod(fd, int(expected_mode))
        view = memoryview(payload)
        while view:
            written = os.write(fd, view)
            view = view[written:]
        os.fsync(fd)
    finally:
        os.close(fd)
else:
    prepared_digest = "sha256:" + hashlib.sha256(prepared["data"]).hexdigest()
    if prepared_digest != to_digest or str(prepared["entry"].st_uid) != expected_uid or str(stat.S_IMODE(prepared["entry"].st_mode)) != expected_mode:
        die("transition temporary is not recoverable")

current = inspect(target)
if current is None or "sha256:" + hashlib.sha256(current["data"]).hexdigest() != from_digest:
    die("transition live file changed before commit")
entry = current["entry"]
if str(entry.st_dev) != live_dev or str(entry.st_ino) != live_ino:
    die("transition live inode changed before commit")
os.replace(temporary, target, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
os.fsync(dir_fd)
published = inspect(target)
if published is None or "sha256:" + hashlib.sha256(published["data"]).hexdigest() != to_digest:
    die("transition descriptor-relative commit failed")
print(json.dumps({"status": "created"}))
`;
    const child = spawn("/usr/bin/python3", [
      "-I",
      "-c",
      script,
      path.basename(options.livePath),
      options.temporaryName,
      options.fromSha256,
      options.toSha256,
      String(openedParent.dev),
      String(openedParent.ino),
      String(options.expectedLive.dev),
      String(options.expectedLive.ino),
      String(options.expectedLive.uid),
      String(options.expectedLive.mode & 0o777),
    ], {
      env: { PATH: "/usr/bin:/bin" },
      stdio: ["pipe", "pipe", "pipe", directoryHandle.fd],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.stdin.end(options.bytes);
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (code !== 0) {
      throw new Error(
        `descriptor-relative transition failed: ${
          Buffer.concat(stderr).toString("utf8").trim() || `exit ${code}`
        }`,
      );
    }
    JSON.parse(Buffer.concat(stdout).toString("utf8"));
    const openedAfter = await directoryHandle.stat();
    const parentAfter = await lstat(parentPath);
    if (
      openedAfter.dev !== openedParent.dev
      || openedAfter.ino !== openedParent.ino
      || !parentAfter.isDirectory()
      || parentAfter.isSymbolicLink()
      || parentAfter.dev !== openedParent.dev
      || parentAfter.ino !== openedParent.ino
    ) {
      throw new Error(`transition parent identity changed: ${options.livePath}`);
    }
  } finally {
    await directoryHandle.close();
  }
}

async function readJson(filePath, requirePrivate) {
  return JSON.parse(
    (await readStableBytes(filePath, requirePrivate)).bytes.toString("utf8"),
  );
}

async function readJsonCapture(filePath, requirePrivate = false) {
  const capture = await readStableBytes(filePath, requirePrivate);
  return {
    value: JSON.parse(capture.bytes.toString("utf8")),
    sha256: sha256BytesV13(capture.bytes),
  };
}

async function readStableBytes(filePath, requirePrivate = false) {
  const expectedRoot = filePath === root || filePath.startsWith(`${root}${path.sep}`)
    ? root
    : undefined;
  const capture = await captureStableFileV12(filePath, filePath, {
    expectedRoot,
    requirePrivate,
  });
  return {
    bytes: capture.bytes,
    stat: {
      dev: capture.identity.dev,
      ino: capture.identity.ino,
      uid: capture.identity.uid,
      mode: capture.mode,
    },
  };
}

export async function publishOrReplaceJournalV13(filePath, value) {
  const identity = {
    schemaVersion: 13,
    kind: "conversation-disclosure-cd04-delta-transition",
    snapshotDigest: value.snapshotDigest,
    manifestDigest: value.manifestDigest,
    anchorDigest: value.anchorDigest,
    repositoryRealpath: value.repositoryRealpath,
  };
  const applying = { ...identity, status: "applying" };
  const expected = value.status === "applying"
    ? applying
    : value.status === "completed"
      && /^sha256:[0-9a-f]{64}$/.test(value.checkerReceiptDigest ?? "")
      ? {
          ...identity,
          status: "completed",
          checkerReceiptDigest: value.checkerReceiptDigest,
        }
      : null;
  if (
    !expected
    || JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify(Object.keys(expected).sort())
    || JSON.stringify(value) !== JSON.stringify(expected)
  ) {
    throw new Error("CD04 transition journal value is not canonical");
  }
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const applyingBytes = Buffer.from(`${JSON.stringify(applying, null, 2)}\n`);
  let existing;
  try {
    existing = await readStableBytes(filePath, true);
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "RUNTIME_IO_V12_MISSING") {
      throw error;
    }
  }
  if (!existing) {
    await publishPrivateExactV12(filePath, bytes, {
      label: "CD04 transition journal",
    });
    return;
  }
  if (existing.bytes.equals(bytes)) return;
  if (
    value.status !== "completed"
    || !existing.bytes.equals(applyingBytes)
  ) {
    throw new Error("CD04 transition journal contains third-state bytes");
  }
  await replaceTransitionFileV13({
    livePath: filePath,
    bytes,
    fromSha256: sha256BytesV13(existing.bytes),
    toSha256: sha256BytesV13(bytes),
    expectedLive: existing.stat,
    temporaryName:
      `.${path.basename(filePath)}.completed-${
        sha256BytesV13(bytes).slice(-12)
      }`,
  });
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[++index];
    if (key === "--delta-anchor") options.deltaAnchor = value;
    else if (key === "--expected-delta-anchor-digest") {
      options.expectedDeltaAnchorDigest = value;
    } else throw new Error(`unknown argument: ${key}`);
  }
  if (
    !path.isAbsolute(options.deltaAnchor ?? "")
    || !/^sha256:[0-9a-f]{64}$/.test(
      options.expectedDeltaAnchorDigest ?? "",
    )
  ) {
    throw new Error("caller-pinned CD04 delta anchor is required");
  }
  return options;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const receipt = await applyCd04DeltaV13(
      parseArguments(process.argv.slice(2)),
    );
    console.log(JSON.stringify(receipt, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
