#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
  realpath,
  rename,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import {
  hashCanonical,
  repositoryPath,
  REVIEW_ALGORITHM,
  REVIEW_SNAPSHOT_KIND,
  sha256Bytes,
  validateReviewSnapshot,
} from "./conversation-disclosure-review-contract.mjs";

const PROGRAM_PATH = ".zerox/conversation-disclosure-program.json";
const FEATURE_LIST_PATH = ".zerox/feature_list.json";
const CD03_ID = "CD03";
const CD03_ARTIFACT_ID = "CD03-causal-shadow";
const CANONICAL_ARTIFACT_PATH =
  ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json";
const CLAIM_KEYS = [
  "implementationBoundary",
  "sources",
  "characterizations",
  "verification",
  "safety",
  "rollback",
];
const SYSTEM_PYTHON = "/usr/bin/python3";
const ANCHORED_FS_BRIDGE = String.raw`
import ctypes, errno, hashlib, json, os, stat, sys

op, target, temp, original, replacement, expected_dev, expected_ino, fault = sys.argv[1:]
dir_fd = 3
private_mode = 0o600
libc = ctypes.CDLL(None, use_errno=True)

def fail(message):
    raise RuntimeError(message)

def check_dir():
    current = os.fstat(dir_fd)
    if not stat.S_ISDIR(current.st_mode):
        fail("inherited descriptor is not a directory")
    if str(current.st_dev) != expected_dev or str(current.st_ino) != expected_ino:
        fail("inherited directory identity changed")
    return current

def call_renameatx(function_name, source, destination, flag):
    function = getattr(libc, function_name, None)
    if function is None:
        fail("required atomic leaf primitive is unavailable: " + function_name)
    function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    function.restype = ctypes.c_int
    result = function(dir_fd, os.fsencode(source), dir_fd, os.fsencode(destination), flag)
    if result != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), source + " -> " + destination)

def atomic_exchange(source, destination):
    if sys.platform == "darwin":
        call_renameatx("renameatx_np", source, destination, 0x00000002)
    elif sys.platform.startswith("linux"):
        call_renameatx("renameat2", source, destination, 0x00000002)
    else:
        fail("atomic leaf exchange is unsupported on this platform")

def atomic_noreplace(source, destination):
    if sys.platform == "darwin":
        call_renameatx("renameatx_np", source, destination, 0x00000004)
    elif sys.platform.startswith("linux"):
        call_renameatx("renameat2", source, destination, 0x00000001)
    else:
        fail("atomic no-replace rename is unsupported on this platform")

def inspect_file(name):
    entry = os.lstat(name, dir_fd=dir_fd)
    if not stat.S_ISREG(entry.st_mode) or entry.st_nlink != 1:
        fail("anchored file must be regular with exactly one hard link: " + name)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(name, flags, dir_fd=dir_fd)
    try:
        opened = os.fstat(fd)
        if (opened.st_dev, opened.st_ino, opened.st_nlink) != (entry.st_dev, entry.st_ino, 1):
            fail("anchored file identity changed while opening: " + name)
        digest = hashlib.sha256()
        chunks = []
        size = 0
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            chunks.append(chunk)
            size += len(chunk)
        after = os.fstat(fd)
        if (after.st_dev, after.st_ino, after.st_nlink, after.st_size, after.st_uid, stat.S_IMODE(after.st_mode)) != (opened.st_dev, opened.st_ino, 1, size, opened.st_uid, stat.S_IMODE(opened.st_mode)):
            fail("anchored file changed while reading: " + name)
        return {
            "dev": str(opened.st_dev),
            "ino": str(opened.st_ino),
            "uid": opened.st_uid,
            "mode": stat.S_IMODE(opened.st_mode),
            "size": size,
            "digest": "sha256:" + digest.hexdigest(),
            "bytes": b"".join(chunks),
        }
    finally:
        os.close(fd)

def inspect_optional(name):
    try:
        return inspect_file(name)
    except FileNotFoundError:
        return None

def entry_exists(name):
    try:
        os.lstat(name, dir_fd=dir_fd)
        return True
    except FileNotFoundError:
        return False

def same_identity(left, right):
    return left is not None and right is not None and (left["dev"], left["ino"]) == (right["dev"], right["ino"])

def require_private(state, name):
    if state["uid"] != os.geteuid() or state["mode"] != private_mode:
        fail("anchored governance file must be owned by the effective user with mode 0600: " + name)
    return state

def make_private(name, state):
    if state["uid"] != os.geteuid():
        fail("anchored target must be owned by the effective user: " + name)
    if state["mode"] == private_mode:
        return state
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(name, flags, dir_fd=dir_fd)
    try:
        opened = os.fstat(fd)
        if (str(opened.st_dev), str(opened.st_ino)) != (state["dev"], state["ino"]):
            fail("anchored target changed before permission normalization: " + name)
        os.fchmod(fd, private_mode)
        os.fsync(fd)
    finally:
        os.close(fd)
    current = inspect_file(name)
    if not same_identity(current, state):
        fail("anchored target changed during permission normalization: " + name)
    return require_private(current, name)

def is_recoverable_prefix(state, payload):
    return 0 <= state["size"] < len(payload) and state["bytes"] == payload[:state["size"]]

def capture_private_temp_fd(fd, name):
    before = os.fstat(fd)
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_uid != os.geteuid() or stat.S_IMODE(before.st_mode) != private_mode:
        fail("anchored governance file must be regular, singly linked, owned by the effective user, and mode 0600: " + name)
    os.lseek(fd, 0, os.SEEK_SET)
    digest = hashlib.sha256()
    chunks = []
    size = 0
    while True:
        chunk = os.read(fd, 1024 * 1024)
        if not chunk:
            break
        digest.update(chunk)
        chunks.append(chunk)
        size += len(chunk)
    after = os.fstat(fd)
    if (after.st_dev, after.st_ino, after.st_nlink, after.st_uid, stat.S_IMODE(after.st_mode), after.st_size) != (before.st_dev, before.st_ino, 1, os.geteuid(), private_mode, size):
        fail("anchored temporary changed during descriptor capture: " + name)
    return {
        "dev": str(before.st_dev),
        "ino": str(before.st_ino),
        "uid": before.st_uid,
        "mode": stat.S_IMODE(before.st_mode),
        "size": size,
        "digest": "sha256:" + digest.hexdigest(),
        "bytes": b"".join(chunks),
    }

def complete_recoverable_prefix(name, state, payload):
    if state["size"] > len(payload) or state["bytes"] != payload[:state["size"]]:
        fail("anchored temporary file is not a recoverable partial write")
    flags = os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(name, flags, dir_fd=dir_fd)
    try:
        opened = capture_private_temp_fd(fd, name)
        if not same_identity(opened, state) or opened["size"] != state["size"] or opened["digest"] != state["digest"] or opened["bytes"] != state["bytes"]:
            fail("anchored temporary identity or bytes changed before continuation: " + name)
        recovered_exact = opened["size"] == len(payload)
        remaining = payload[opened["size"]:]
        limit = max(1, len(remaining) // 2) if remaining and fault == "partial-append-write" else len(remaining)
        os.lseek(fd, opened["size"], os.SEEK_SET)
        view = memoryview(remaining)[:limit]
        while view:
            written = os.write(fd, view)
            view = view[written:]
        if len(remaining) == limit and len(remaining) > 0:
            maybe_exit("after-final-write-before-fsync", 104)
        os.fsync(fd)
        after = capture_private_temp_fd(fd, name)
        expected_size = opened["size"] + limit
        if not same_identity(after, opened) or after["size"] != expected_size or after["bytes"] != payload[:expected_size]:
            fail("anchored temporary changed during continuation or fsync: " + name)
        if recovered_exact:
            maybe_exit("after-recovered-exact-fsync", 105)
        if fault == "partial-append-write":
            os._exit(102)
    finally:
        os.close(fd)
    current = require_private(inspect_file(name), name)
    if not same_identity(current, state) or current["digest"] != replacement:
        fail("anchored partial temporary continuation did not converge: " + name)
    return current

def maybe_exit(point, code):
    if fault == point:
        os._exit(code)

def inject_leaf_swap(name, hardlink=False):
    held = name + ".leaf-held"
    preserved = name + ".leaf-preserved"
    entry_preserved = name + ".leaf-entry-preserved"
    if inspect_optional(held) is not None or inspect_optional(preserved) is not None or inspect_optional(entry_preserved) is not None:
        fail("leaf-swap test state is not clean")
    os.rename(name, held, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), private_mode, dir_fd=dir_fd)
    try:
        os.write(fd, b"descriptor leaf swap sentinel\n")
        os.fsync(fd)
    finally:
        os.close(fd)
    if hardlink:
        os.link(name, preserved, src_dir_fd=dir_fd, dst_dir_fd=dir_fd, follow_symlinks=False)
    os.fsync(dir_fd)
    return {"held": held, "preserved": preserved, "entry_preserved": entry_preserved, "hardlink": hardlink}

def restore_injected_swap(name, injected):
    atomic_noreplace(name, injected["entry_preserved"] if injected["hardlink"] else injected["preserved"])
    atomic_noreplace(injected["held"], name)
    os.fsync(dir_fd)

def completed_markers(name, digest):
    prefix = name + ".completed-" + digest[7:] + "-"
    suffix = ".marker"
    matches = []
    for entry in os.listdir(dir_fd):
        if entry.startswith(prefix) and entry.endswith(suffix):
            state = require_private(inspect_file(entry), entry)
            if state["digest"] != digest:
                fail("anchored completed marker bytes are stale: " + entry)
            identity = entry[len(prefix):-len(suffix)].split("-")
            if len(identity) != 2 or not identity[0].isdigit() or not identity[1].isdigit() or identity != [state["dev"], state["ino"]]:
                fail("anchored completed marker filename identity is stale: " + entry)
            matches.append((entry, state))
    if len(matches) > 1:
        fail("anchored completed marker is ambiguous: " + name)
    return matches

def completed_marker(name, state):
    return name + ".completed-" + state["digest"][7:] + "-" + state["dev"] + "-" + state["ino"] + ".marker"

def retire_tombstone(tombstone, expected_state):
    marker = completed_marker(tombstone, expected_state)
    current = inspect_optional(tombstone)
    existing = inspect_optional(marker)
    if current is None:
        if existing is None:
            fail("anchored tombstone retirement state disappeared: " + tombstone)
        existing = require_private(existing, marker)
        if not same_identity(existing, expected_state) or existing["digest"] != expected_state["digest"]:
            fail("anchored completed marker identity is stale: " + marker)
        return existing
    current = require_private(current, tombstone)
    if not same_identity(current, expected_state) or current["digest"] != expected_state["digest"]:
        fail("anchored tombstone identity changed before retirement: " + tombstone)
    if existing is not None:
        fail("anchored tombstone and completed marker coexist: " + tombstone)
    injected = None
    if fault == "leaf-tombstone-swap":
        injected = inject_leaf_swap(tombstone)
    elif fault == "leaf-tombstone-hardlink-swap":
        injected = inject_leaf_swap(tombstone, hardlink=True)
    try:
        atomic_noreplace(tombstone, marker)
        os.fsync(dir_fd)
        moved = require_private(inspect_file(marker), marker)
    except BaseException:
        if entry_exists(marker) and not entry_exists(tombstone):
            atomic_noreplace(marker, tombstone)
        if injected is not None and entry_exists(tombstone):
            restore_injected_swap(tombstone, injected)
        raise
    if not same_identity(moved, expected_state) or moved["digest"] != expected_state["digest"]:
        atomic_noreplace(marker, tombstone)
        if injected is not None:
            restore_injected_swap(tombstone, injected)
        fail("anchored tombstone leaf changed during atomic retirement: " + tombstone)
    maybe_exit("after-completed-marker", 101)
    return moved

def move_to_tombstone_and_retire(name, expected_state, tombstone, fault_point):
    current = require_private(inspect_file(name), name)
    if not same_identity(current, expected_state) or current["digest"] != expected_state["digest"]:
        fail("anchored leaf changed before tombstoning: " + name)
    existing_tombstone = inspect_optional(tombstone)
    if existing_tombstone is not None:
        fail("anchored tombstone unexpectedly exists while source remains: " + tombstone)
    injected = inject_leaf_swap(name) if fault == fault_point else None
    atomic_noreplace(name, tombstone)
    os.fsync(dir_fd)
    try:
        moved = require_private(inspect_file(tombstone), tombstone)
    except BaseException:
        if entry_exists(tombstone) and not entry_exists(name):
            atomic_noreplace(tombstone, name)
        if injected is not None and entry_exists(name):
            restore_injected_swap(name, injected)
        raise
    if not same_identity(moved, expected_state) or moved["digest"] != expected_state["digest"]:
        atomic_noreplace(tombstone, name)
        if injected is not None:
            restore_injected_swap(name, injected)
        fail("anchored leaf changed during tombstone move: " + name)
    maybe_exit("after-retire-tombstone", 100)
    retire_tombstone(tombstone, moved)

def recover_discard(discard, payload):
    state = inspect_optional(discard)
    if state is None:
        return
    require_private(state, discard)
    if state["digest"] != original and not is_recoverable_prefix(state, payload):
        fail("anchored discard does not match a recoverable publication state")
    retire_tombstone(discard, state)

check_dir()
if os.path.basename(target) != target or not target or target in (".", ".."):
    fail("anchored target basename is invalid")

if op == "replace":
    if temp != target + ".atomic-" + replacement[7:31] + ".tmp":
        fail("anchored temporary basename is not deterministic")
    payload = sys.stdin.buffer.read()
    if "sha256:" + hashlib.sha256(payload).hexdigest() != replacement:
        fail("replacement payload digest is stale")
    discard = temp + ".discard"
    recover_discard(discard, payload)
    target_state = inspect_optional(target)
    temp_state = inspect_optional(temp)

    if target_state is not None and target_state["digest"] == replacement:
        require_private(target_state, target)
        if temp_state is None:
            result = target_state
        else:
            require_private(temp_state, temp)
            if original == "absent" or temp_state["digest"] != original:
                fail("committed replacement has an invalid displaced leaf")
            move_to_tombstone_and_retire(temp, temp_state, discard, "leaf-unlink-swap")
            result = require_private(inspect_file(target), target)
    else:
        if original == "absent":
            if target_state is not None:
                fail("anchored absent target unexpectedly exists")
        elif target_state is None or target_state["digest"] != original:
            fail("anchored target is neither the recorded original nor replacement")
        else:
            target_state = make_private(target, target_state)

        if temp_state is not None:
            require_private(temp_state, temp)
            temp_state = complete_recoverable_prefix(temp, temp_state, payload)
        if temp_state is None:
            flags = os.O_RDWR | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
            temp_fd = os.open(temp, flags, private_mode, dir_fd=dir_fd)
            try:
                maybe_exit("after-temp-create", 103)
                limit = max(1, len(payload) // 2) if fault == "partial-write" else len(payload)
                view = memoryview(payload)[:limit]
                while view:
                    written = os.write(temp_fd, view)
                    view = view[written:]
                if limit == len(payload):
                    maybe_exit("after-final-write-before-fsync", 104)
                os.fsync(temp_fd)
                created = capture_private_temp_fd(temp_fd, temp)
                if created["size"] != limit or created["bytes"] != payload[:limit]:
                    fail("anchored temporary changed during initial write or fsync: " + temp)
                if fault == "partial-write":
                    os._exit(97)
            except BaseException:
                os.close(temp_fd)
                raise
            else:
                os.close(temp_fd)
            temp_state = require_private(inspect_file(temp), temp)
        if temp_state["digest"] != replacement:
            fail("anchored temporary bytes are stale")
        maybe_exit("after-temp-ready", 98)

        injected_temp = inject_leaf_swap(temp) if fault == "leaf-temp-swap" else None
        injected_target = inject_leaf_swap(target) if fault == "leaf-target-swap" and target_state is not None else None
        if original == "absent":
            try:
                atomic_noreplace(temp, target)
            except OSError as error:
                if injected_temp is not None:
                    restore_injected_swap(temp, injected_temp)
                raise error
        else:
            atomic_exchange(temp, target)
        os.fsync(dir_fd)
        committed_target = require_private(inspect_file(target), target)
        displaced = inspect_optional(temp)
        valid_target = same_identity(committed_target, temp_state) and committed_target["digest"] == replacement
        valid_displaced = (original == "absent" and displaced is None) or (
            original != "absent" and displaced is not None and same_identity(displaced, target_state) and displaced["digest"] == original
        )
        if not valid_target or not valid_displaced:
            if original == "absent":
                atomic_noreplace(target, temp)
            else:
                atomic_exchange(temp, target)
            os.fsync(dir_fd)
            if injected_temp is not None:
                restore_injected_swap(temp, injected_temp)
            if injected_target is not None:
                restore_injected_swap(target, injected_target)
            fail("anchored leaf identity changed during atomic replacement")
        maybe_exit("after-replace-commit", 99)
        if displaced is not None:
            displaced = require_private(displaced, temp)
            move_to_tombstone_and_retire(temp, displaced, discard, "leaf-unlink-swap")
        result = require_private(inspect_file(target), target)

    if result["digest"] != replacement or inspect_optional(temp) is not None or inspect_optional(discard) is not None:
        fail("anchored atomic replacement verification failed")
elif op == "retire":
    tombstone = target + ".remove.tombstone"
    target_state = inspect_optional(target)
    tombstone_state = inspect_optional(tombstone)
    completed = completed_markers(tombstone, original)
    if target_state is None:
        if tombstone_state is None:
            if len(completed) != 1:
                fail("anchored retirement completed marker is missing")
            result = None
        else:
            require_private(tombstone_state, tombstone)
            if tombstone_state["digest"] != original:
                fail("anchored unlink tombstone bytes are stale")
            retire_tombstone(tombstone, tombstone_state)
            result = None
    else:
        require_private(target_state, target)
        if target_state["digest"] != original:
            fail("anchored unlink target bytes changed")
        if tombstone_state is not None or len(completed) > 0:
            fail("anchored retirement states coexist")
        move_to_tombstone_and_retire(target, target_state, tombstone, "leaf-unlink-swap")
        result = None
    if inspect_optional(target) is not None or inspect_optional(tombstone) is not None or len(completed_markers(tombstone, original)) != 1:
        fail("anchored retirement verification failed")
else:
    fail("unknown anchored filesystem operation")

directory = check_dir()
if result is not None:
    result = {key: value for key, value in result.items() if key != "bytes"}
print(json.dumps({"directoryDev": str(directory.st_dev), "directoryIno": str(directory.st_ino), "target": result}, separators=(",", ":")))
`;

try {
  const options = parseOptions(process.argv.slice(2));
  const root = await realpath(process.cwd());
  const programCapture = await readRepositoryJson(root, PROGRAM_PATH, "program");
  const featureListCapture = await readRepositoryJson(
    root,
    FEATURE_LIST_PATH,
    "Feature list",
  );
  const { workstream, feature, contract } = validateActivePendingState(
    programCapture.value,
    featureListCapture.value,
    options,
  );
  const artifactCapture = await readRepositoryJson(
    root,
    contract.primaryArtifact,
    "CD03 artifact",
  );
  validateArtifact(
    artifactCapture.value,
    programCapture.value,
    workstream,
    feature,
    options,
  );

  const featureFiles = feature.files;
  const immutablePaths = featureFiles
    .filter((relativePath) => !contract.postReviewMutablePaths.includes(relativePath))
    .slice()
    .sort();
  if (immutablePaths.length === 0) {
    throw new Error("CD03 immutable review snapshot must contain at least one file");
  }
  const files = [];
  const immutableCaptures = new Map();
  for (const relativePath of immutablePaths) {
    const bytes = await readFrozenRegularFile(
      root,
      relativePath,
      `immutable Feature file ${relativePath}`,
    );
    immutableCaptures.set(relativePath, bytes);
    files.push({ path: relativePath, sha256: sha256Bytes(bytes) });
  }

  const claims = Object.fromEntries(
    CLAIM_KEYS.map((key) => [key, artifactCapture.value[key]]),
  );
  const snapshotWithoutDigest = {
    schemaVersion: 1,
    kind: REVIEW_SNAPSHOT_KIND,
    algorithm: REVIEW_ALGORITHM,
    programId: programCapture.value.programId,
    workstreamId: workstream.id,
    featureId: feature.id,
    round: options.round,
    completionContractDigest: hashCanonical(contract),
    safetyContractDigest: hashCanonical(contract.requiredSafety),
    // Feature ordering is governance authority. Sorting belongs only to the
    // immutable file projection below and must never feed this digest.
    featureFileSetDigest: hashCanonical(featureFiles),
    claimsDigest: hashCanonical(claims),
    files,
  };
  const snapshot = {
    ...snapshotWithoutDigest,
    digest: hashCanonical(snapshotWithoutDigest),
  };
  const snapshotErrors = validateReviewSnapshot(snapshot);
  if (snapshotErrors.length > 0) {
    throw new Error(
      `Generated CD03 review snapshot is invalid:\n${snapshotErrors
        .map((error) => `- ${error}`).join("\n")}`,
    );
  }

  const snapshotBytes = jsonBytes(snapshot);
  const artifactBytes = jsonBytes({
    ...artifactCapture.value,
    reviewSnapshot: snapshot,
  });
  const transactionPath = `${options.snapshotPath}.freeze-transaction.json`;
  if (options.replacePending) {
    await assertNoDownstreamEvidence(root, options.round);
  }
  const recoveredPublication = await readOptionalTransaction(
    root,
    transactionPath,
  );
  const recoveredTransaction = recoveredPublication?.transaction ?? null;
  const existingSnapshot = recoveredTransaction
    ? recoveredPublication.completed
      ? await inspectSnapshotTarget(
          root,
          options,
          programCapture.value,
          workstream,
          feature,
          artifactCapture.value,
          true,
        )
      : null
    : await inspectSnapshotTarget(
        root,
        options,
        programCapture.value,
        workstream,
        feature,
        artifactCapture.value,
      );
  const transaction = recoveredTransaction ?? createFreezeTransaction({
    options,
    artifactPath: contract.primaryArtifact,
    originalArtifactBytes: artifactCapture.bytes,
    originalSnapshotBytes: existingSnapshot?.bytes ?? null,
    snapshotBytes,
    artifactBytes,
    mode: existingSnapshot ? "replaced_pending" : "created",
  });
  validateFreezeTransaction(transaction, {
    options,
    artifactPath: contract.primaryArtifact,
    snapshotBytes,
    artifactBytes,
  });
  const unchangedAuthorityCaptures = new Map([
    [PROGRAM_PATH, programCapture.bytes],
    [FEATURE_LIST_PATH, featureListCapture.bytes],
    ...immutableCaptures,
  ]);
  await assertCapturedFilesUnchanged(root, unchangedAuthorityCaptures, "pre-publication");
  const transactionBytes = jsonBytes(transaction);
  if (!recoveredTransaction) {
    await atomicPublishRepositoryFile({
      root,
      relativePath: transactionPath,
      originalDigest: "absent",
      replacementBytes: transactionBytes,
      label: "freeze publication transaction",
    });
  }
  await resumeFreezePublication({
    root,
    transactionPath,
    transaction,
    transactionBytes,
    snapshotBytes,
    artifactBytes,
  });
  await assertCapturedFilesUnchanged(
    root,
    unchangedAuthorityCaptures,
    "post-publication",
  );

  console.log(JSON.stringify({
    kind: "cd03-review-snapshot-freeze-receipt",
    status: transaction.mode,
    recovered: Boolean(recoveredTransaction),
    round: options.round,
    snapshotPath: options.snapshotPath,
    snapshotDigest: snapshot.digest,
    featureFileSetDigest: snapshot.featureFileSetDigest,
    snapshotFileCount: snapshot.files.length,
  }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseOptions(args) {
  let round;
  let snapshotPath;
  let replacePending = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--replace-pending") {
      if (replacePending) {
        throw new Error("--replace-pending may be specified only once");
      }
      replacePending = true;
      continue;
    }
    if (argument !== "--round" && argument !== "--snapshot-path") {
      throw new Error(`Unknown freeze option: ${argument}`);
    }
    const value = args[index + 1];
    index += 1;
    if (argument === "--round") {
      if (round !== undefined || !/^[1-9][0-9]*$/.test(value ?? "")) {
        throw new Error("--round requires one positive integer");
      }
      round = Number(value);
    } else {
      if (snapshotPath !== undefined || !repositoryPath(value)) {
        throw new Error("--snapshot-path requires one repository-relative path");
      }
      snapshotPath = value;
    }
  }
  if (!Number.isSafeInteger(round) || snapshotPath === undefined) {
    throw new Error("freeze requires --round and --snapshot-path");
  }
  const expectedSnapshotPath = snapshotPathForRound(round);
  if (snapshotPath !== expectedSnapshotPath) {
    throw new Error(
      `snapshot path must exactly match the requested round: ${expectedSnapshotPath}`,
    );
  }
  return { round, snapshotPath, replacePending };
}

function validateActivePendingState(program, featureList, options) {
  if (!plainObject(program) || program.schemaVersion !== 1
    || !nonEmpty(program.programId) || program.status !== "active"
    || !Array.isArray(program.workstreams)) {
    throw new Error("conversation disclosure program schema/status is invalid");
  }
  const matches = program.workstreams.filter(
    (candidate) => candidate?.id === CD03_ID,
  );
  if (matches.length !== 1) {
    throw new Error("program must contain exactly one CD03 workstream");
  }
  const workstream = matches[0];
  if (workstream.state !== "in_progress"
    || program.activeFeatureId !== workstream.featureId
    || program.nextFeatureId !== workstream.featureId) {
    throw new Error("CD03 must be the active in_progress workstream before freeze");
  }
  if (!plainObject(featureList) || featureList.schemaVersion !== 1
    || !Array.isArray(featureList.features)) {
    throw new Error("Feature list schema is invalid");
  }
  const featureMatches = featureList.features.filter(
    (candidate) => candidate?.id === workstream.featureId,
  );
  if (featureMatches.length !== 1) {
    throw new Error("Feature list must contain exactly one active CD03 Feature");
  }
  const feature = featureMatches[0];
  if (feature.status !== "in_progress" || !nonEmpty(feature.id)
    || !Array.isArray(feature.files) || feature.files.length === 0
    || feature.files.some((relativePath) => !repositoryPath(relativePath))
    || new Set(feature.files).size !== feature.files.length) {
    throw new Error("active CD03 Feature status/files schema is invalid");
  }
  const contract = workstream.completionContract;
  if (!plainObject(contract) || contract.schemaVersion !== 1
    || contract.kind !== "reviewed_shadow"
    || contract.primaryArtifact !== CANONICAL_ARTIFACT_PATH
    || !plainObject(contract.requiredSafety)
    || !Array.isArray(contract.postReviewMutablePaths)
    || contract.postReviewMutablePaths.some(
      (relativePath) => !repositoryPath(relativePath),
    )
    || !contract.postReviewMutablePaths.includes(options.snapshotPath)
    || !contract.postReviewMutablePaths.includes(contract.primaryArtifact)
    || !contract.postReviewMutablePaths.includes(PROGRAM_PATH)
    || !contract.postReviewMutablePaths.includes(FEATURE_LIST_PATH)) {
    throw new Error("CD03 completion contract schema/path is invalid for the requested round");
  }
  return { workstream, feature, contract };
}

function validateArtifact(artifact, program, workstream, feature, options) {
  if (!plainObject(artifact) || artifact.schemaVersion !== 1
    || artifact.artifactId !== CD03_ARTIFACT_ID
    || artifact.programId !== program.programId
    || artifact.featureId !== feature.id
    || artifact.status !== "review_pending") {
    throw new Error("CD03 artifact identity/schema/status is invalid for pending freeze");
  }
  if (!plainObject(artifact.independentReview)
    || artifact.independentReview.status !== "pending"
    || artifact.independentReview.round !== options.round
    || artifact.independentReview.closureManifestPath
      !== closureManifestPathForRound(options.round)
    || !Array.isArray(artifact.independentReview.history)) {
    throw new Error("CD03 artifact review round/path must exactly match the requested round");
  }
  for (const key of CLAIM_KEYS) {
    if (!Object.hasOwn(artifact, key)) {
      throw new Error(`CD03 artifact is missing exact claim source: ${key}`);
    }
  }
  if (hashCanonical(artifact.safety)
    !== hashCanonical(workstream.completionContract.requiredSafety)) {
    throw new Error("CD03 artifact safety does not match the completion contract");
  }
}

async function inspectSnapshotTarget(
  root,
  options,
  program,
  workstream,
  feature,
  artifact,
  allowRecovered = false,
) {
  let entry;
  try {
    entry = await lstat(path.join(root, options.snapshotPath));
  } catch (error) {
    if (error?.code === "ENOENT" && !allowRecovered) return null;
    if (error?.code === "ENOENT") {
      throw new Error(
        "completed freeze transaction requires an exact standalone pending snapshot",
      );
    }
    throw error;
  }
  if (!options.replacePending && !allowRecovered) {
    throw new Error(
      "review snapshot already exists; explicit --replace-pending is required",
    );
  }
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error("existing pending review snapshot must be a regular non-symlink file");
  }
  if (options.replacePending) await assertNoDownstreamEvidence(root, options.round);
  const bytes = await readFrozenRegularFile(
    root,
    options.snapshotPath,
    "existing pending review snapshot",
  );
  let existing;
  try {
    existing = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("existing pending review snapshot must contain valid JSON");
  }
  const validationErrors = validateReviewSnapshot(existing);
  if (validationErrors.length > 0
    || existing.programId !== program.programId
    || existing.workstreamId !== workstream.id
    || existing.featureId !== feature.id
    || existing.round !== options.round
    || hashCanonical(existing) !== hashCanonical(artifact.reviewSnapshot)) {
    throw new Error(
      "existing snapshot and embedded pending artifact snapshot must be exact and valid before replacement",
    );
  }
  return { bytes };
}

async function assertNoDownstreamEvidence(root, round) {
  for (const downstreamPath of downstreamPathsForRound(round)) {
    if (await pathExists(root, downstreamPath)) {
      throw new Error(
        `pending review snapshot cannot be replaced after downstream evidence exists: ${downstreamPath}`,
      );
    }
  }
}

function createFreezeTransaction({
  options,
  artifactPath,
  originalArtifactBytes,
  originalSnapshotBytes,
  snapshotBytes,
  artifactBytes,
  mode,
}) {
  const withoutDigest = {
    schemaVersion: 1,
    kind: "conversation-disclosure-review-freeze-transaction",
    status: "prepared",
    round: options.round,
    mode,
    snapshotPath: options.snapshotPath,
    artifactPath,
    originalSnapshotDigest: originalSnapshotBytes
      ? sha256Bytes(originalSnapshotBytes)
      : null,
    targetSnapshotDigest: sha256Bytes(snapshotBytes),
    originalArtifactDigest: sha256Bytes(originalArtifactBytes),
    targetArtifactDigest: sha256Bytes(artifactBytes),
  };
  return { ...withoutDigest, digest: hashCanonical(withoutDigest) };
}

function validateFreezeTransaction(transaction, bindings) {
  const keys = [
    "artifactPath",
    "digest",
    "kind",
    "mode",
    "originalArtifactDigest",
    "originalSnapshotDigest",
    "round",
    "schemaVersion",
    "snapshotPath",
    "status",
    "targetArtifactDigest",
    "targetSnapshotDigest",
  ];
  if (!plainObject(transaction)
    || !sameOrderedStrings(Object.keys(transaction).sort(), keys.slice().sort())
    || transaction.schemaVersion !== 1
    || transaction.kind !== "conversation-disclosure-review-freeze-transaction"
    || transaction.status !== "prepared"
    || !["created", "replaced_pending"].includes(transaction.mode)
    || transaction.round !== bindings.options.round
    || transaction.snapshotPath !== bindings.options.snapshotPath
    || transaction.artifactPath !== bindings.artifactPath
    || transaction.targetSnapshotDigest !== sha256Bytes(bindings.snapshotBytes)
    || transaction.targetArtifactDigest !== sha256Bytes(bindings.artifactBytes)
    || (transaction.originalSnapshotDigest !== null
      && !/^sha256:[0-9a-f]{64}$/.test(transaction.originalSnapshotDigest))
    || !/^sha256:[0-9a-f]{64}$/.test(transaction.originalArtifactDigest ?? "")) {
    throw new Error("freeze publication transaction schema/bindings are invalid");
  }
  const withoutDigest = { ...transaction };
  delete withoutDigest.digest;
  if (transaction.digest !== hashCanonical(withoutDigest)) {
    throw new Error("freeze publication transaction canonical digest is stale");
  }
}

async function readOptionalTransaction(root, relativePath) {
  const transactionExists = await repositoryEntryExists(root, relativePath);
  const tombstonePath = `${relativePath}.remove.tombstone`;
  const tombstoneExists = await repositoryEntryExists(root, tombstonePath);
  if (transactionExists && tombstoneExists) {
    throw new Error("freeze publication transaction and removal tombstone coexist");
  }
  if (transactionExists || tombstoneExists) {
    const capture = await readRepositoryJson(
      root,
      transactionExists ? relativePath : tombstonePath,
      "freeze publication transaction",
      true,
    );
    return { transaction: capture.value, completed: false };
  }
  const markerPaths = await listCompletedMarkerPaths(root, tombstonePath);
  if (markerPaths.length > 1) {
    throw new Error("completed freeze publication marker is ambiguous");
  }
  if (markerPaths.length === 0) return null;
  const capture = await readFrozenRegularFile(
    root,
    markerPaths[0],
    "completed freeze publication marker",
    true,
    true,
  );
  assertCompletedMarkerCapture(
    markerPaths[0],
    tombstonePath,
    capture,
    "completed freeze publication marker",
  );
  try {
    return {
      transaction: JSON.parse(capture.bytes.toString("utf8")),
      completed: true,
    };
  } catch {
    throw new Error(`completed freeze publication marker must contain valid JSON: ${markerPaths[0]}`);
  }
}

async function resumeFreezePublication({
  root,
  transactionPath,
  transaction,
  transactionBytes,
  snapshotBytes,
  artifactBytes,
}) {
  await assertFileBytesAtCanonicalOrTombstone(
    root,
    transactionPath,
    transactionBytes,
    "freeze publication transaction",
  );
  maybeInjectPublicationFault("after-transaction");
  await convergeRepositoryFile({
    root,
    relativePath: transaction.snapshotPath,
    originalDigest: transaction.originalSnapshotDigest,
    targetBytes: snapshotBytes,
    label: "review snapshot publication",
  });
  maybeInjectPublicationFault("after-snapshot");
  maybeInjectPublicationFault("before-artifact-commit");
  await convergeRepositoryFile({
    root,
    relativePath: transaction.artifactPath,
    originalDigest: transaction.originalArtifactDigest,
    targetBytes: artifactBytes,
    label: "CD03 artifact publication",
  });
  maybeInjectPublicationFault("after-artifact");
  await assertFileBytes(
    root,
    transaction.snapshotPath,
    snapshotBytes,
    "published review snapshot",
  );
  await assertFileBytes(
    root,
    transaction.artifactPath,
    artifactBytes,
    "published CD03 artifact",
  );
  await atomicRetireRepositoryFile(
    root,
    transactionPath,
    transactionBytes,
    "completed freeze publication transaction",
  );
}

async function convergeRepositoryFile({
  root,
  relativePath,
  originalDigest,
  targetBytes,
  label,
}) {
  const currentBytes = await readOptionalRepositoryFile(root, relativePath, label);
  const targetDigest = sha256Bytes(targetBytes);
  if (currentBytes === null) {
    if (originalDigest !== null) {
      throw new Error(`${label} disappeared during recoverable publication`);
    }
  } else if (sha256Bytes(currentBytes) !== originalDigest
    && sha256Bytes(currentBytes) !== targetDigest) {
    throw new Error(`${label} is neither the recorded original nor target bytes`);
  }
  await atomicPublishRepositoryFile({
    root,
    relativePath,
    originalDigest: originalDigest ?? "absent",
    replacementBytes: targetBytes,
    label,
  });
}

function maybeInjectPublicationFault(point) {
  if (process.env.ZEROX_CD03_FREEZE_TEST_FAULT === point) {
    throw new Error(`injected freeze publication fault: ${point}`);
  }
}

async function readRepositoryJson(root, relativePath, label, requirePrivate = false) {
  const bytes = await readFrozenRegularFile(root, relativePath, label, requirePrivate);
  try {
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch {
    throw new Error(`${label} must contain valid JSON: ${relativePath}`);
  }
}

async function assertCapturedFilesUnchanged(root, captures, phase) {
  for (const [relativePath, expectedBytes] of captures) {
    await assertFileBytes(
      root,
      relativePath,
      expectedBytes,
      `${phase} authority file ${relativePath}`,
    );
  }
}

async function assertFileBytes(root, relativePath, expectedBytes, label) {
  const currentBytes = await readFrozenRegularFile(root, relativePath, label);
  if (!currentBytes.equals(expectedBytes)) {
    throw new Error(`${label} changed during freeze`);
  }
}

async function assertFileBytesAtCanonicalOrTombstone(
  root,
  relativePath,
  expectedBytes,
  label,
) {
  const transactionExists = await repositoryEntryExists(root, relativePath);
  const tombstonePath = `${relativePath}.remove.tombstone`;
  const tombstoneExists = await repositoryEntryExists(root, tombstonePath);
  const markerPaths = await listCompletedMarkerPaths(
    root,
    tombstonePath,
    sha256Bytes(expectedBytes),
  );
  const locations = [
    ...(transactionExists ? [relativePath] : []),
    ...(tombstoneExists ? [tombstonePath] : []),
    ...markerPaths,
  ];
  if (locations.length !== 1) {
    throw new Error(`${label} must exist at exactly one recoverable location`);
  }
  await assertFileBytes(
    root,
    locations[0],
    expectedBytes,
    label,
  );
}

async function listCompletedMarkerPaths(root, relativePath, expectedDigest) {
  const directory = path.posix.dirname(relativePath);
  const basename = path.posix.basename(relativePath);
  const digestPrefix = expectedDigest
    ? `${basename}.completed-${expectedDigest.slice("sha256:".length)}-`
    : `${basename}.completed-`;
  return (await readdir(path.join(root, directory)))
    .filter((entry) => entry.startsWith(digestPrefix) && entry.endsWith(".marker"))
    .sort()
    .map((entry) => path.posix.join(directory, entry));
}

function assertCompletedMarkerCapture(
  markerPath,
  markerBasePath,
  capture,
  label,
) {
  const markerName = path.posix.basename(markerPath);
  const markerBase = path.posix.basename(markerBasePath);
  const match = markerName.match(new RegExp(
    `^${escapeRegExp(markerBase)}\\.completed-([0-9a-f]{64})-([0-9]+)-([0-9]+)\\.marker$`,
  ));
  if (!match
    || match[1] !== sha256Bytes(capture.bytes).slice("sha256:".length)
    || match[2] !== `${capture.dev}`
    || match[3] !== `${capture.ino}`) {
    throw new Error(`${label} identity/digest is stale`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readFrozenRegularFile(
  root,
  relativePath,
  label,
  requirePrivate = false,
  captureIdentity = false,
) {
  if (!repositoryPath(relativePath)) {
    throw new Error(`${label} path must be repository-relative`);
  }
  const parentCapture = await captureParentIdentity(root, relativePath, label);
  const segments = relativePath.split("/");
  let cursor = root;
  let pathStat;
  for (let index = 0; index < segments.length; index += 1) {
    cursor = path.join(cursor, segments[index]);
    let entry;
    try {
      entry = await lstat(cursor);
    } catch {
      throw new Error(`${label} does not exist or changed identity: ${relativePath}`);
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`${label} must not contain symbolic links: ${relativePath}`);
    }
    if (index < segments.length - 1 && !entry.isDirectory()) {
      throw new Error(`${label} parent must be a directory: ${relativePath}`);
    }
    if (index === segments.length - 1 && !entry.isFile()) {
      throw new Error(`${label} must be a regular file: ${relativePath}`);
    }
    if (index === segments.length - 1) {
      if (entry.nlink !== 1) {
        throw new Error(`${label} must have exactly one hard link: ${relativePath}`);
      }
      pathStat = entry;
    }
  }
  const handle = await open(
    path.join(root, relativePath),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new Error(`${label} must be a regular file: ${relativePath}`);
    }
    if (requirePrivate && (stat.uid !== process.geteuid()
      || (stat.mode & 0o777) !== 0o600)) {
      throw new Error(`${label} must be owned by the effective user with mode 0600`);
    }
    if (stat.dev !== pathStat.dev || stat.ino !== pathStat.ino) {
      throw new Error(`${label} changed identity while opening: ${relativePath}`);
    }
    const bytes = await handle.readFile();
    const afterStat = await handle.stat();
    if (afterStat.dev !== stat.dev || afterStat.ino !== stat.ino
      || afterStat.nlink !== 1 || afterStat.size !== bytes.length
      || (requirePrivate && (afterStat.uid !== process.geteuid()
        || (afterStat.mode & 0o777) !== 0o600))) {
      throw new Error(`${label} changed identity while reading: ${relativePath}`);
    }
    await assertParentIdentity(parentCapture, label);
    const finalPathStat = await lstat(path.join(root, relativePath));
    if (finalPathStat.isSymbolicLink() || !finalPathStat.isFile()
      || finalPathStat.nlink !== 1 || finalPathStat.dev !== stat.dev
      || finalPathStat.ino !== stat.ino
      || (requirePrivate && (finalPathStat.uid !== process.geteuid()
        || (finalPathStat.mode & 0o777) !== 0o600))) {
      throw new Error(`${label} changed path identity while reading: ${relativePath}`);
    }
    return captureIdentity
      ? { bytes, dev: stat.dev, ino: stat.ino }
      : bytes;
  } finally {
    await handle.close();
  }
}

async function captureParentIdentity(root, relativePath, label) {
  if (!repositoryPath(relativePath)) {
    throw new Error(`${label} path must be repository-relative`);
  }
  const segments = relativePath.split("/").slice(0, -1);
  let cursor = root;
  const entries = [];
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    const entry = await lstat(cursor);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`${label} parent must be a real directory: ${relativePath}`);
    }
    entries.push({ path: cursor, dev: entry.dev, ino: entry.ino });
  }
  return { entries, parentPath: path.dirname(path.join(root, relativePath)) };
}

async function assertParentIdentity(capture, label) {
  for (const expected of capture.entries) {
    const entry = await lstat(expected.path);
    if (entry.isSymbolicLink() || !entry.isDirectory()
      || entry.dev !== expected.dev || entry.ino !== expected.ino) {
      throw new Error(`${label} parent directory identity changed`);
    }
  }
}

async function atomicPublishRepositoryFile({
  root,
  relativePath,
  originalDigest,
  replacementBytes,
  label,
}) {
  const anchored = await openAnchoredParent(root, relativePath, label);
  try {
    const target = path.basename(relativePath);
    const replacementDigest = sha256Bytes(replacementBytes);
    const temp = `${target}.atomic-${replacementDigest.slice("sha256:".length, 31)}.tmp`;
    await maybeSwapParentForTest(
      anchored.capture.parentPath,
      label,
      "ZEROX_CD03_FREEZE_TEST_PARENT_SWAP",
      "review snapshot publication",
    );
    const fault = selectFreezeBridgeFault(label, "replace");
    await runAnchoredFilesystemBridge({
      operation: "replace",
      directoryHandle: anchored.handle,
      directoryStat: anchored.stat,
      target,
      temp,
      originalDigest,
      replacementDigest,
      replacementBytes,
      fault,
      label,
    });
    await assertDirectoryHandleIdentity(anchored, label);
    await assertParentIdentity(anchored.capture, label);
    await assertFileBytes(root, relativePath, replacementBytes, label);
  } finally {
    await anchored.handle.close();
  }
}

async function atomicRetireRepositoryFile(
  root,
  relativePath,
  expectedBytes,
  label,
) {
  const anchored = await openAnchoredParent(root, relativePath, label);
  try {
    await maybeSwapParentForTest(
      anchored.capture.parentPath,
      label,
      "ZEROX_CD03_FREEZE_TEST_REMOVE_PARENT_SWAP",
      "completed freeze publication transaction",
    );
    await runAnchoredFilesystemBridge({
      operation: "retire",
      directoryHandle: anchored.handle,
      directoryStat: anchored.stat,
      target: path.basename(relativePath),
      temp: "-",
      originalDigest: sha256Bytes(expectedBytes),
      replacementDigest: "-",
      replacementBytes: Buffer.alloc(0),
      fault: selectFreezeBridgeFault(label, "unlink"),
      label,
    });
    await assertDirectoryHandleIdentity(anchored, label);
    await assertParentIdentity(anchored.capture, label);
  } finally {
    await anchored.handle.close();
  }
}

async function openAnchoredParent(root, relativePath, label) {
  const capture = await captureParentIdentity(root, relativePath, label);
  if (!["darwin", "linux"].includes(process.platform)
    || !Number.isInteger(constants.O_DIRECTORY)
    || !Number.isInteger(constants.O_NOFOLLOW)) {
    throw new Error(`${label} descriptor-anchored filesystem primitive is unavailable`);
  }
  const handle = await open(
    capture.parentPath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const directoryStat = await handle.stat();
    const expected = capture.entries.at(-1);
    if (!directoryStat.isDirectory() || !expected
      || directoryStat.dev !== expected.dev || directoryStat.ino !== expected.ino) {
      throw new Error(`${label} opened parent directory identity is stale`);
    }
    await validateSystemPython();
    return { capture, handle, stat: directoryStat };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function assertDirectoryHandleIdentity(anchored, label) {
  const current = await anchored.handle.stat();
  if (!current.isDirectory() || current.dev !== anchored.stat.dev
    || current.ino !== anchored.stat.ino) {
    throw new Error(`${label} opened directory handle identity changed`);
  }
}

var systemPythonValidation;
async function validateSystemPython() {
  systemPythonValidation ??= (async () => {
    const [entry, resolved, parent] = await Promise.all([
      lstat(SYSTEM_PYTHON),
      realpath(SYSTEM_PYTHON),
      lstat(path.dirname(SYSTEM_PYTHON)),
    ]);
    if (entry.uid !== 0 || parent.uid !== 0 || !parent.isDirectory()
      || (parent.mode & 0o022) !== 0) {
      throw new Error("descriptor-anchored filesystem bridge is not root-owned and immutable");
    }
    await validateRootOwnedExecutablePath(resolved);
    return true;
  })();
  return systemPythonValidation;
}

async function validateRootOwnedExecutablePath(absolutePath) {
  const parsed = path.parse(absolutePath);
  const segments = absolutePath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let cursor = parsed.root;
  for (const [index, segment] of segments.entries()) {
    cursor = path.join(cursor, segment);
    const entry = await lstat(cursor);
    const isTarget = index === segments.length - 1;
    if (entry.isSymbolicLink() || entry.uid !== 0 || (entry.mode & 0o022) !== 0
      || (isTarget ? !entry.isFile() : !entry.isDirectory())) {
      throw new Error("descriptor-anchored filesystem bridge resolved path is mutable");
    }
  }
}

async function runAnchoredFilesystemBridge({
  operation,
  directoryHandle,
  directoryStat,
  target,
  temp,
  originalDigest,
  replacementDigest,
  replacementBytes,
  fault,
  label,
}) {
  const child = spawn(SYSTEM_PYTHON, [
    "-I",
    "-c",
    ANCHORED_FS_BRIDGE,
    operation,
    target,
    temp,
    originalDigest,
    replacementDigest,
    String(directoryStat.dev),
    String(directoryStat.ino),
    fault,
  ], {
    env: { PATH: "/usr/bin:/bin" },
    stdio: ["pipe", "pipe", "pipe", directoryHandle.fd],
  });
  const stdout = [];
  const stderr = [];
  let stdinError;
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  child.stdin.on("error", (error) => {
    stdinError = error;
  });
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  child.stdin.end(replacementBytes);
  const code = await completion;
  if (code !== 0) {
    if ([97, 98, 99, 100, 101, 102, 103, 104, 105].includes(code)
      && fault !== "none") {
      throw new Error(
        `injected freeze publication fault: ${process.env.ZEROX_CD03_FREEZE_TEST_FAULT}`,
      );
    }
    throw new Error(
      `${label} descriptor-anchored operation failed: ${Buffer.concat(stderr)
        .toString("utf8").trim() || `exit ${code}`}`,
    );
  }
  if (stdinError) throw stdinError;
  let result;
  try {
    result = JSON.parse(Buffer.concat(stdout).toString("utf8"));
  } catch {
    throw new Error(`${label} descriptor-anchored bridge emitted invalid output`);
  }
  if (result.directoryDev !== String(directoryStat.dev)
    || result.directoryIno !== String(directoryStat.ino)) {
    throw new Error(`${label} descriptor-anchored bridge changed directory identity`);
  }
  if (operation === "replace"
    && result.target?.digest !== replacementDigest) {
    throw new Error(`${label} descriptor-anchored replacement digest is stale`);
  }
}

function selectFreezeBridgeFault(label, operation) {
  const requested = process.env.ZEROX_CD03_FREEZE_TEST_FAULT;
  if (requested === "partial-artifact-write" && label === "CD03 artifact publication") {
    return "partial-write";
  }
  const scope = new Map([
    ["freeze publication transaction", "transaction"],
    ["review snapshot publication", "snapshot"],
    ["CD03 artifact publication", "artifact"],
    ["completed freeze publication transaction", "transaction-unlink"],
  ]).get(label);
  if (!scope) return "none";
  const suffixes = operation === "replace"
    ? new Map([
      ["partial-write", "partial-write"],
      ["partial-append-write", "partial-append-write"],
      ["after-temp-create", "after-temp-create"],
      ["after-final-write-before-fsync", "after-final-write-before-fsync"],
      ["after-recovered-exact-fsync", "after-recovered-exact-fsync"],
      ["after-temp-ready", "after-temp-ready"],
      ["after-replace-commit", "after-replace-commit"],
      ["after-displaced-tombstone", "after-retire-tombstone"],
      ["leaf-temp-swap", "leaf-temp-swap"],
      ["leaf-target-swap", "leaf-target-swap"],
      ["leaf-displaced-swap", "leaf-unlink-swap"],
      ["leaf-tombstone-swap", "leaf-tombstone-swap"],
    ])
    : new Map([
      ["after-tombstone", "after-retire-tombstone"],
      ["after-completed-marker", "after-completed-marker"],
      ["leaf-swap", "leaf-unlink-swap"],
      ["leaf-tombstone-swap", "leaf-tombstone-swap"],
      ["leaf-tombstone-hardlink-swap", "leaf-tombstone-hardlink-swap"],
    ]);
  for (const [suffix, bridgeFault] of suffixes) {
    if (requested === `${scope}-${suffix}`) return bridgeFault;
  }
  return "none";
}

async function maybeSwapParentForTest(parentPath, label, envName, expectedLabel) {
  const outsidePath = process.env[envName];
  if (!outsidePath || label !== expectedLabel) return;
  const canonicalOutside = await realpath(outsidePath);
  const outsideStat = await lstat(canonicalOutside);
  if (!outsideStat.isDirectory() || outsideStat.isSymbolicLink()) {
    throw new Error(`${label} injected outside parent must be a real directory`);
  }
  const heldPath = `${parentPath}.descriptor-held-${process.pid}`;
  await rename(parentPath, heldPath);
  await symlink(canonicalOutside, parentPath, "dir");
}

async function readOptionalRepositoryFile(root, relativePath, label) {
  if (!await repositoryEntryExists(root, relativePath)) return null;
  return readFrozenRegularFile(root, relativePath, label);
}

async function repositoryEntryExists(root, relativePath) {
  try {
    await lstat(path.join(root, relativePath));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function pathExists(root, relativePath) {
  return repositoryEntryExists(root, relativePath);
}

function snapshotPathForRound(round) {
  return `.zerox/verification/conversation-disclosure/CD03-round${round}-review-snapshot.json`;
}

function closureManifestPathForRound(round) {
  return `.zerox/verification/conversation-disclosure/CD03-round${round}-closure-manifest.json`;
}

function downstreamPathsForRound(round) {
  const prefix = `.zerox/verification/conversation-disclosure/CD03-round${round}`;
  return [
    `${prefix}-contract-review.json`,
    `${prefix}-runtime-review.json`,
    `${prefix}-governance-review.json`,
    `${prefix}-closure-manifest.json`,
    `${prefix}-external-attestation.json`,
  ];
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function sameOrderedStrings(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}
