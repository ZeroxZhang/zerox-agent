#!/usr/bin/env node

// This file is intentionally self-contained. A trusted invocation must execute
// a repository-external copy whose bytes are pinned by
// --expected-runner-digest. It must not import validation code from the
// candidate repository.

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REVIEW_SNAPSHOT_KIND = "conversation-disclosure-review-snapshot";
const REVIEW_RECEIPT_KIND = "conversation-disclosure-review-receipt";
const CLOSURE_MANIFEST_KIND = "conversation-disclosure-closure-manifest";
const EXTERNAL_ATTESTATION_KIND =
  "conversation-disclosure-external-closure-attestation";
const EXTERNAL_ANCHOR_KIND = "conversation-disclosure-external-anchor";
const PUBLICATION_TRANSACTION_KIND =
  "conversation-disclosure-external-publication-transaction";
const FREEZE_TRANSACTION_KIND =
  "conversation-disclosure-review-freeze-transaction";
const FREEZE_TRANSACTION_KEYS = [
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
const CLOSURE_STATUS_PENDING = "review_passed_pending_external_anchor";
const CLOSURE_STATUS_ATTESTED = "externally_attested";
const REVIEW_ALGORITHM = "sha256-canonical-json-v1";
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
const REQUIRED_REVIEW_LANES = ["contract", "runtime", "governance"];
const REQUIRED_EXECUTABLE_CLOSURE = {
  package: "package.json",
  checker: "scripts/check-conversation-disclosure-program.mjs",
  harness: "scripts/check-harness-state.mjs",
};
const REQUIRED_EXTERNAL_RUNNER =
  "scripts/verify-conversation-disclosure-closure.mjs";
const REQUIRED_STAGED_SUPPORT = [
  "scripts/conversation-disclosure-review-contract.mjs",
];
const CANONICAL_CONTROL_INPUTS = {
  program: ".zerox/conversation-disclosure-program.json",
  featureList: ".zerox/feature_list.json",
  artifact: ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json",
};
const HARNESS_CONTROL_PATHS = [
  "AGENTS.md",
  "init.sh",
  ".zerox/progress.md",
  ".zerox/golden-principles.md",
  ".zerox/runtime-convergence-program.json",
  ".zerox/runtime-convergence-program.md",
  ".zerox/kernel-migration-program.json",
  ".zerox/kernel-migration-program.md",
  ".zerox/storage-convergence-program.json",
  ".zerox/storage-convergence-program.md",
  ".zerox/release-program.json",
  ".zerox/conversation-disclosure-program.json",
  ".zerox/conversation-disclosure-program.md",
  CANONICAL_CONTROL_INPUTS.artifact,
  "docs/superpowers/specs/2026-06-09-harness-engineering-iteration-spec.md",
  "docs/superpowers/plans/2026-06-09-harness-engineering-iteration.md",
];
const SNAPSHOT_KEYS = [
  "algorithm",
  "claimsDigest",
  "completionContractDigest",
  "digest",
  "featureFileSetDigest",
  "featureId",
  "files",
  "kind",
  "programId",
  "round",
  "safetyContractDigest",
  "schemaVersion",
  "workstreamId",
];
const RECEIPT_KEYS = [
  "challenge",
  "completedAt",
  "completionContractDigest",
  "featureId",
  "findingCounts",
  "findings",
  "kind",
  "lane",
  "programId",
  "reviewAgentId",
  "reviewTaskPath",
  "round",
  "safetyContractDigest",
  "schemaVersion",
  "snapshotDigest",
  "snapshotFileCount",
  "transport",
  "verdict",
  "workstreamId",
];
const MANIFEST_KEYS = [
  "digest",
  "executableClosure",
  "externalAttestation",
  "externalRunner",
  "featureId",
  "kind",
  "programId",
  "reviewReceipts",
  "round",
  "schemaVersion",
  "snapshot",
  "status",
  "workstreamId",
];
const EXTERNAL_ATTESTATION_KEYS = [
  "candidateResults",
  "completedAt",
  "digest",
  "kind",
  "pendingManifestDigest",
  "repositoryRealpath",
  "reviewReceiptDigests",
  "runnerDigest",
  "schemaVersion",
  "snapshotDigest",
  "status",
  "subjectIdentityAssurance",
  "trustLevel",
];
const EXTERNAL_ANCHOR_KEYS = [
  "attestationDigest",
  "completedAt",
  "digest",
  "kind",
  "repositoryRealpath",
  "reviewReceipts",
  "runnerDigest",
  "schemaVersion",
  "snapshotDigest",
  "subjectIdentityAssurance",
  "trustLevel",
];

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const invokedRunnerPath = path.resolve(process.argv[1]);
  const invokedRunnerEntry = await lstat(invokedRunnerPath);
  if (invokedRunnerEntry.isSymbolicLink() || !invokedRunnerEntry.isFile()
    || invokedRunnerEntry.nlink !== 1) {
    throw new Error("external closure runner must be an invoked unique regular file");
  }
  const runnerPath = await realpath(invokedRunnerPath);
  const runnerBytes = await readNoFollowFile(runnerPath, "external closure runner");
  const runnerDigest = sha256Bytes(runnerBytes);
  requireEqual(
    runnerDigest,
    options.expectedRunnerDigest,
    "external closure runner digest does not match the expected digest",
  );
  const repositoryRealpath = await realpath(path.resolve(options.repo));
  const requestedAnchorOutput = path.resolve(options.externalAnchorOutput);
  const anchorOutputPath = path.join(
    await realpath(path.dirname(requestedAnchorOutput)),
    path.basename(requestedAnchorOutput),
  );
  if (pathIsWithin(repositoryRealpath, anchorOutputPath)) {
    throw new Error("external anchor output must stay outside the candidate repository");
  }
  const runnerRealpath = await realpath(runnerPath);
  const runnerFromRepository = path.relative(
    repositoryRealpath,
    runnerRealpath,
  );
  if (
    runnerFromRepository === ""
    || (
      runnerFromRepository !== ".."
      && !runnerFromRepository.startsWith(`..${path.sep}`)
      && !path.isAbsolute(runnerFromRepository)
    )
  ) {
    throw new Error(
      "external closure runner must be invoked from outside the candidate repository",
    );
  }
  requireEqual(
    repositoryRealpath,
    options.expectedRepoRealpath,
    "repository realpath does not match the expected realpath",
  );

  // Everything above and below this line until preflightErrors is checked is
  // read-only validation. Candidate checker/harness processes must not start.
  const preflightErrors = [];
  const capturedControlFiles = new Map();
  const completedMarkerCaptures = [];
  const manifest = await readRepositoryJson(
    repositoryRealpath,
    options.closureManifest,
    "closure manifest",
    preflightErrors,
    capturedControlFiles,
  );
  const transactionPath = publicationTransactionPath(anchorOutputPath);
  const publicationTransaction = await readOptionalAbsoluteJson(
      transactionPath,
      "external publication transaction",
      preflightErrors,
      true,
      true,
      true,
    );
  validateManifest(manifest, preflightErrors, {
    allowAttested: Boolean(publicationTransaction)
      || manifest?.status === CLOSURE_STATUS_ATTESTED,
  });
  if (manifest?.status === CLOSURE_STATUS_ATTESTED) {
    await readFrozenRepositoryFile(
      repositoryRealpath,
      options.closureManifest,
      "externally attested closure manifest permissions",
      preflightErrors,
      true,
    );
  }
  if (manifest?.externalRunner?.sha256 !== runnerDigest) {
    preflightErrors.push("closure manifest external runner digest does not match the invoked runner");
  }
  const existingAttestation = await readOptionalRepositoryJson(
    repositoryRealpath,
    manifest?.externalAttestation?.path,
    "external attestation output",
    preflightErrors,
    true,
  );
  const existingExternalAnchor = await readOptionalAbsoluteJson(
    anchorOutputPath,
    "external anchor output",
    preflightErrors,
    true,
  );
  if (!publicationTransaction && manifest?.status === CLOSURE_STATUS_PENDING
    && (existingAttestation || existingExternalAnchor)) {
    preflightErrors.push(
      "pending closure without a recovery transaction must not have publication outputs",
    );
  }

  let snapshot;
  if (manifest) {
    snapshot = await readRepositoryJson(
      repositoryRealpath,
      manifest.snapshot?.path,
      "review snapshot",
      preflightErrors,
      capturedControlFiles,
    );
    validateSnapshot(snapshot, preflightErrors);
    if (snapshot?.digest !== options.expectedSnapshotDigest) {
      preflightErrors.push("review snapshot digest does not match the external anchor");
    }
    if (manifest.snapshot?.digest !== options.expectedSnapshotDigest) {
      preflightErrors.push("closure manifest snapshot digest does not match the external anchor");
    }
    for (const key of ["programId", "workstreamId", "featureId", "round"]) {
      if (manifest[key] !== snapshot?.[key]) {
        preflightErrors.push(`closure manifest ${key} does not match the review snapshot`);
      }
    }
  }

  const snapshotPathSet = new Set();
  if (snapshot && Array.isArray(snapshot.files)) {
    for (const [index, entry] of snapshot.files.entries()) {
      if (!repositoryPath(entry?.path) || !sha256Digest(entry?.sha256)) continue;
      snapshotPathSet.add(entry.path);
      const bytes = await readFrozenRepositoryFile(
        repositoryRealpath,
        entry.path,
        `review snapshot files[${index}]`,
        preflightErrors,
      );
      if (bytes && sha256Bytes(bytes) !== entry.sha256) {
        preflightErrors.push(`review snapshot frozen file hash drift: ${entry.path}`);
      }
      if (bytes) rememberCapturedFile(
        capturedControlFiles,
        entry.path,
        bytes,
        preflightErrors,
      );
    }
    for (const entry of manifest?.executableClosure ?? []) {
      if (!repositoryPath(entry?.path) || !sha256Digest(entry?.sha256)) continue;
      if (!snapshotPathSet.has(entry.path)) {
        preflightErrors.push(`executable closure path is absent from the review snapshot: ${entry.path}`);
      }
      const frozenEntry = snapshot.files.find((candidate) => candidate.path === entry.path);
      if (frozenEntry?.sha256 !== entry.sha256) {
        preflightErrors.push(`executable closure digest disagrees with the review snapshot: ${entry.path}`);
      }
    }
    const runnerSnapshotEntry = snapshot.files.find(
      (candidate) => candidate.path === REQUIRED_EXTERNAL_RUNNER,
    );
    if (runnerSnapshotEntry?.sha256 !== manifest?.externalRunner?.sha256) {
      preflightErrors.push(
        "closure manifest external runner digest disagrees with the review snapshot",
      );
    }
    for (const relativePath of [
      REQUIRED_EXECUTABLE_CLOSURE.checker,
      REQUIRED_EXECUTABLE_CLOSURE.harness,
      ...REQUIRED_STAGED_SUPPORT,
    ]) {
      if (!capturedControlFiles.has(relativePath)) {
        preflightErrors.push(
          `trusted staged closure path is absent from the frozen snapshot: ${relativePath}`,
        );
      }
    }
  }

  const receipts = [];
  const receiptDigests = new Map();
  const manifestReceiptEntries = Array.isArray(manifest?.reviewReceipts)
    ? manifest.reviewReceipts
    : [];
  for (const entry of manifestReceiptEntries) {
    const receipt = await readRepositoryJson(
      repositoryRealpath,
      entry?.path,
      `review receipt ${entry?.lane ?? "unknown"}`,
      preflightErrors,
      capturedControlFiles,
    );
    if (!receipt) continue;
    receipts.push(receipt);
    if (receipt.lane !== entry.lane) {
      preflightErrors.push(`review receipt lane disagrees with its manifest entry: ${entry.lane}`);
    }
    const digest = hashCanonical(receipt);
    receiptDigests.set(entry.lane, digest);
    if (entry.canonicalDigest !== digest) {
      preflightErrors.push(`closure manifest review receipt digest is stale: ${entry.lane}`);
    }
    if (options.expectedReceiptDigests.get(entry.lane) !== digest) {
      preflightErrors.push(`review receipt digest does not match the external anchor: ${entry.lane}`);
    }
    if (options.expectedChallenges.get(entry.lane) !== receipt.challenge) {
      preflightErrors.push(`review receipt challenge does not match the external anchor: ${entry.lane}`);
    }
  }
  validateReviewSet(receipts, snapshot, preflightErrors);
  for (const lane of REQUIRED_REVIEW_LANES) {
    if (!receiptDigests.has(lane)) {
      preflightErrors.push(`missing review receipt lane: ${lane}`);
    }
  }

  const program = await readRepositoryJson(
    repositoryRealpath,
    CANONICAL_CONTROL_INPUTS.program,
    "conversation disclosure program control input",
    preflightErrors,
    capturedControlFiles,
  );
  await readRepositoryJson(
    repositoryRealpath,
    CANONICAL_CONTROL_INPUTS.featureList,
    "feature list control input",
    preflightErrors,
    capturedControlFiles,
  );
  await readRepositoryJson(
    repositoryRealpath,
    CANONICAL_CONTROL_INPUTS.artifact,
    "CD03 artifact control input",
    preflightErrors,
    capturedControlFiles,
  );
  if (manifest && snapshot) {
    const freezeMarkerCapture = await captureCompletedFreezeMarker({
      repositoryRealpath,
      snapshot,
      snapshotPath: manifest.snapshot?.path,
      snapshotBytes: capturedControlFiles.get(manifest.snapshot?.path),
      preflightErrors,
      capturedControlFiles,
    });
    if (freezeMarkerCapture) completedMarkerCaptures.push(freezeMarkerCapture);
  }

  const checkerDependencyPaths = collectCheckerDependencyPaths(program);
  for (const relativePath of new Set([
    ...HARNESS_CONTROL_PATHS,
    ...checkerDependencyPaths,
  ])) {
    await captureRepositoryFile(
      repositoryRealpath,
      relativePath,
      `candidate control input ${relativePath}`,
      preflightErrors,
      capturedControlFiles,
    );
  }

  if (preflightErrors.length > 0) {
    throw new Error(
      `Conversation disclosure external closure preflight failed:\n${preflightErrors
        .map((error) => `- ${error}`).join("\n")}`,
    );
  }

  if (publicationTransaction || manifest?.status === CLOSURE_STATUS_ATTESTED) {
    const recoveredAttestation = await recoverExternalPublication({
      repositoryRealpath,
      runnerDigest,
      manifestPath: options.closureManifest,
      manifest,
      snapshot,
      receipts,
      expectedReceiptDigests: options.expectedReceiptDigests,
      expectedChallenges: options.expectedChallenges,
      anchorOutputPath,
      existingAttestation,
      existingExternalAnchor,
      transactionPath,
      transaction: publicationTransaction,
    });
    console.log(canonicalJson(recoveredAttestation));
    return;
  }

  // Candidate execution begins only after every external-anchor and frozen-byte
  // preflight above has succeeded.
  const executableByKind = new Map(
    manifest.executableClosure.map((entry) => [entry.kind, entry]),
  );
  const candidateResults = [];
  for (const kind of ["checker", "harness"]) {
    const entry = executableByKind.get(kind);
    const result = await executeCandidateInFreshControlTree({
      kind,
      entry,
      repositoryRealpath,
      capturedControlFiles,
      completedMarkerCaptures,
      expectedSnapshotDigest: options.expectedSnapshotDigest,
    });
    const receipt = requireCandidateReceipt(
      result.stdout,
      kind,
      options.expectedSnapshotDigest,
    );
    candidateResults.push({
      kind,
      path: entry.path,
      receipt,
      receiptDigest: hashCanonical(receipt),
      stdoutDigest: sha256Bytes(result.stdout),
      stderrDigest: sha256Bytes(result.stderr),
      status: "passed",
    });
  }

  const postflightErrors = await validatePostflightControlInputs({
    repositoryRealpath,
    capturedControlFiles,
    completedMarkerCaptures,
    manifestPath: options.closureManifest,
    snapshotPath: manifest.snapshot.path,
    receiptPaths: manifest.reviewReceipts.map((entry) => entry.path),
    snapshotPathSet,
    expectedSnapshotDigest: options.expectedSnapshotDigest,
  });
  if (postflightErrors.length > 0) {
    throw new Error(
      `Conversation disclosure external closure postflight failed:\n${postflightErrors
        .map((error) => `- ${error}`).join("\n")}`,
    );
  }

  const attestationWithoutDigest = {
    schemaVersion: 1,
    kind: EXTERNAL_ATTESTATION_KIND,
    trustLevel: "external-anchor-consistency",
    subjectIdentityAssurance: "not-signed",
    status: "passed",
    repositoryRealpath,
    runnerDigest,
    snapshotDigest: options.expectedSnapshotDigest,
    pendingManifestDigest: manifest.digest,
    reviewReceiptDigests: REQUIRED_REVIEW_LANES.map((lane) => ({
      lane,
      canonicalDigest: receiptDigests.get(lane),
    })),
    candidateResults,
    completedAt: new Date().toISOString(),
  };
  const attestation = {
    ...attestationWithoutDigest,
    digest: hashCanonical(attestationWithoutDigest),
  };
  const finalManifestWithoutDigest = {
    ...manifest,
    status: CLOSURE_STATUS_ATTESTED,
    externalAttestation: {
      path: manifest.externalAttestation.path,
      canonicalDigest: attestation.digest,
    },
  };
  delete finalManifestWithoutDigest.digest;
  const finalManifest = {
    ...finalManifestWithoutDigest,
    digest: hashCanonical(finalManifestWithoutDigest),
  };
  const attestationErrors = validateExactExternalAttestation(attestation, {
    manifest: finalManifest,
    snapshot,
    receipts,
    repositoryRealpath,
    runnerDigest,
  });
  if (attestationErrors.length > 0) {
    throw new Error(
      `Generated external attestation failed exact validation:\n${attestationErrors
        .map((error) => `- ${error}`).join("\n")}`,
    );
  }
  const externalAnchorWithoutDigest = {
    schemaVersion: 1,
    kind: EXTERNAL_ANCHOR_KIND,
    trustLevel: "external-caller-pinned-consistency",
    subjectIdentityAssurance: "not-signed",
    repositoryRealpath,
    runnerDigest,
    snapshotDigest: options.expectedSnapshotDigest,
    attestationDigest: attestation.digest,
    reviewReceipts: REQUIRED_REVIEW_LANES.map((lane) => ({
      lane,
      canonicalDigest: receiptDigests.get(lane),
      challenge: options.expectedChallenges.get(lane),
    })),
    completedAt: attestation.completedAt,
  };
  // The external file is an unsigned caller-custody consistency anchor, not
  // proof of reviewer identity. Completion later requires both this file and
  // its independently supplied canonical digest.
  const externalAnchor = {
    ...externalAnchorWithoutDigest,
    digest: hashCanonical(externalAnchorWithoutDigest),
  };
  const externalAnchorErrors = validateExactExternalAnchor(externalAnchor, {
    attestation,
    snapshot,
    receipts,
    repositoryRealpath,
    runnerDigest,
  });
  if (externalAnchorErrors.length > 0) {
    throw new Error(
      `Generated external anchor failed exact validation:\n${externalAnchorErrors
        .map((error) => `- ${error}`).join("\n")}`,
    );
  }
  await publishExternalAttestation({
    repositoryRealpath,
    manifestPath: options.closureManifest,
    expectedManifestBytes: capturedControlFiles.get(options.closureManifest),
    attestationPath: manifest.externalAttestation.path,
    attestation,
    finalManifest,
    externalAnchor,
    anchorOutputPath,
  });
  console.log(canonicalJson(attestation));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function captureCompletedFreezeMarker({
  repositoryRealpath,
  snapshot,
  snapshotPath,
  snapshotBytes,
  preflightErrors,
  capturedControlFiles,
}) {
  if (!repositoryPath(snapshotPath) || !Buffer.isBuffer(snapshotBytes)) {
    preflightErrors.push("completed freeze marker bindings are unavailable");
    return null;
  }
  const transactionPath = `${snapshotPath}.freeze-transaction.json`;
  const tombstonePath = `${transactionPath}.remove.tombstone`;
  const absoluteTransactionPath = path.join(repositoryRealpath, transactionPath);
  let parentCapture;
  try {
    parentCapture = await captureAbsoluteParentIdentity(
      absoluteTransactionPath,
      "completed freeze marker parent",
    );
    for (const candidatePath of [transactionPath, tombstonePath]) {
      try {
        await lstat(path.join(repositoryRealpath, candidatePath));
        preflightErrors.push(
          "freeze publication transaction must be recovered before external closure",
        );
      } catch (error) {
        if (error?.code !== "ENOENT") {
          preflightErrors.push("freeze publication transaction could not be inspected safely");
        }
      }
    }
    const markerBase = path.basename(tombstonePath);
    const markerNames = (await readdir(path.dirname(path.join(
      repositoryRealpath,
      tombstonePath,
    ))))
      .filter((entry) => entry.startsWith(`${markerBase}.completed-`)
        && entry.endsWith(".marker"))
      .sort();
    if (markerNames.length !== 1) {
      preflightErrors.push(
        "freeze publication transaction must have exactly one immutable completed marker",
      );
      return null;
    }
    const markerName = markerNames[0];
    const markerPath = path.posix.join(path.posix.dirname(tombstonePath), markerName);
    const capture = await readFrozenRepositoryFile(
      repositoryRealpath,
      markerPath,
      "freeze publication transaction completed marker",
      preflightErrors,
      true,
      true,
    );
    if (!capture) return null;
    const suffix = markerName.slice(
      `${markerBase}.completed-`.length,
      -".marker".length,
    );
    const match = suffix.match(/^([0-9a-f]{64})-([0-9]+)-([0-9]+)$/);
    if (!match || match[1] !== sha256Bytes(capture.bytes).slice("sha256:".length)
      || match[2] !== `${capture.dev}` || match[3] !== `${capture.ino}`) {
      preflightErrors.push("freeze publication transaction completed marker identity is stale");
      return null;
    }
    let transaction;
    try {
      transaction = JSON.parse(capture.bytes.toString("utf8"));
    } catch {
      preflightErrors.push("freeze publication transaction completed marker must be valid JSON");
      return null;
    }
    for (const transactionError of validateCompletedFreezeTransaction(transaction, {
      round: snapshot.round,
      snapshotPath,
      artifactPath: CANONICAL_CONTROL_INPUTS.artifact,
      targetSnapshotDigest: sha256Bytes(snapshotBytes),
    })) {
      preflightErrors.push(
        `freeze publication transaction completed marker ${transactionError}`,
      );
    }
    await assertAbsoluteParentIdentity(parentCapture, "completed freeze marker parent");
    rememberCapturedFile(
      capturedControlFiles,
      markerPath,
      capture.bytes,
      preflightErrors,
    );
    return {
      relativePath: markerPath,
      markerBaseRelativePath: tombstonePath,
      bytes: capture.bytes,
      dev: capture.dev,
      ino: capture.ino,
    };
  } catch {
    preflightErrors.push("freeze publication transaction completed marker could not be inspected");
    return null;
  }
}

function validateCompletedFreezeTransaction(transaction, bindings) {
  if (!plainObject(transaction)
    || !exactKeys(transaction, FREEZE_TRANSACTION_KEYS)
    || transaction.schemaVersion !== 1
    || transaction.kind !== FREEZE_TRANSACTION_KIND
    || transaction.status !== "prepared") {
    return ["must contain the exact prepared v1 schema"];
  }
  const transactionErrors = [];
  if (!["created", "replaced_pending"].includes(transaction.mode)) {
    transactionErrors.push("mode is invalid");
  }
  if (transaction.round !== bindings.round
    || transaction.snapshotPath !== bindings.snapshotPath
    || transaction.artifactPath !== bindings.artifactPath) {
    transactionErrors.push("identity/path bindings are stale");
  }
  if (!sha256Digest(transaction.targetSnapshotDigest)
    || !sha256Digest(transaction.targetArtifactDigest)
    || (transaction.originalSnapshotDigest !== null
      && !sha256Digest(transaction.originalSnapshotDigest))
    || !sha256Digest(transaction.originalArtifactDigest)) {
    transactionErrors.push("digest fields are invalid");
  }
  if (transaction.targetSnapshotDigest !== bindings.targetSnapshotDigest) {
    transactionErrors.push("targetSnapshotDigest binding is stale");
  }
  const withoutDigest = { ...transaction };
  delete withoutDigest.digest;
  if (transaction.digest !== hashCanonical(withoutDigest)) {
    transactionErrors.push("canonical digest is stale");
  }
  return transactionErrors;
}

async function executeCandidateInFreshControlTree({
  kind,
  entry,
  repositoryRealpath,
  capturedControlFiles,
  completedMarkerCaptures,
  expectedSnapshotDigest,
}) {
  let stageRoot;
  try {
    stageRoot = await mkdtemp(
      path.join(os.tmpdir(), `zerox-cd03-${kind}-control-`),
    );
    const controlRoot = await realpath(stageRoot);
    if (pathIsWithin(repositoryRealpath, controlRoot)) {
      throw new Error(
        "trusted closure staging directory must stay outside the candidate repository",
      );
    }
    const completedMarkerPaths = new Set(
      completedMarkerCaptures.map((capture) => capture.relativePath),
    );
    const stagedControlFiles = new Map();
    for (const [relativePath, bytes] of capturedControlFiles) {
      if (completedMarkerPaths.has(relativePath)) continue;
      const target = path.join(controlRoot, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
      stagedControlFiles.set(relativePath, bytes);
    }
    for (const markerCapture of completedMarkerCaptures) {
      const stagedMarkerPath = await stageCompletedMarker(controlRoot, markerCapture);
      stagedControlFiles.set(stagedMarkerPath, markerCapture.bytes);
    }
    const preExecutionErrors = await validateStagedTrustSet(
      controlRoot,
      stagedControlFiles,
      `${kind} pre-execution`,
    );
    if (preExecutionErrors.length > 0) {
      throw new Error(
        `Conversation disclosure staged trust-set validation failed:\n${preExecutionErrors
          .map((error) => `- ${error}`).join("\n")}`,
      );
    }

    let result;
    let executionError;
    try {
      result = await execFileAsync(
        process.execPath,
        [
          path.join(controlRoot, entry.path),
          "--closure",
          "--expected-snapshot-digest",
          expectedSnapshotDigest,
        ],
        {
          cwd: controlRoot,
          encoding: "utf8",
          env: {
            PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
            NODE_OPTIONS: "",
          },
          maxBuffer: 4 * 1024 * 1024,
          timeout: 120_000,
        },
      );
    } catch (error) {
      executionError = error;
    }

    const postExecutionErrors = await validateStagedTrustSet(
      controlRoot,
      stagedControlFiles,
      `${kind} post-execution`,
    );
    if (postExecutionErrors.length > 0) {
      throw new Error(
        `Conversation disclosure staged trust-set mutation detected:\n${postExecutionErrors
          .map((error) => `- ${error}`).join("\n")}`,
      );
    }
    if (executionError) throw executionError;
    return result;
  } finally {
    if (stageRoot) await rm(stageRoot, { recursive: true, force: true });
  }
}

async function stageCompletedMarker(controlRoot, markerCapture) {
  const markerBasePath = path.join(controlRoot, markerCapture.markerBaseRelativePath);
  await mkdir(path.dirname(markerBasePath), { recursive: true });
  const sourcePath = `${markerBasePath}.stage-source`;
  const handle = await open(
    sourcePath,
    constants.O_WRONLY
      | constants.O_CREAT
      | constants.O_EXCL
      | constants.O_NOFOLLOW,
    0o600,
  );
  let sourceStat;
  try {
    await handle.writeFile(markerCapture.bytes);
    await handle.sync();
    sourceStat = await handle.stat();
    if (!sourceStat.isFile() || sourceStat.nlink !== 1
      || sourceStat.uid !== process.geteuid()
      || (sourceStat.mode & 0o777) !== 0o600
      || sourceStat.size !== markerCapture.bytes.length) {
      throw new Error("staged completed marker source metadata is invalid");
    }
  } finally {
    await handle.close();
  }
  const markerName = `${path.basename(markerBasePath)}.completed-${
    sha256Bytes(markerCapture.bytes).slice("sha256:".length)
  }-${sourceStat.dev}-${sourceStat.ino}.marker`;
  const markerPath = path.join(path.dirname(markerBasePath), markerName);
  await rename(sourcePath, markerPath);
  return path.relative(controlRoot, markerPath).split(path.sep).join(path.posix.sep);
}

async function validateStagedTrustSet(root, capturedControlFiles, phase) {
  const errors = [];
  for (const [relativePath, expectedBytes] of capturedControlFiles) {
    const isCompletedMarker = relativePath.includes(
      ".freeze-transaction.json.remove.tombstone.completed-",
    ) && relativePath.endsWith(".marker");
    const capture = await readFrozenRepositoryFile(
      root,
      relativePath,
      `${phase} staged trust file ${relativePath}`,
      errors,
      isCompletedMarker,
      isCompletedMarker,
    );
    const bytes = isCompletedMarker ? capture?.bytes : capture;
    if (bytes && !bytes.equals(expectedBytes)) {
      errors.push(`${phase} staged trust file byte drift: ${relativePath}`);
    }
    if (isCompletedMarker && capture) {
      const markerName = path.basename(relativePath);
      const match = markerName.match(/\.completed-([0-9a-f]{64})-([0-9]+)-([0-9]+)\.marker$/);
      if (!match || match[1] !== sha256Bytes(capture.bytes).slice("sha256:".length)
        || match[2] !== `${capture.dev}` || match[3] !== `${capture.ino}`) {
        errors.push(`${phase} staged completed marker identity/digest is stale`);
      }
    }
  }
  return errors;
}

async function publishExternalAttestation({
  repositoryRealpath,
  manifestPath,
  expectedManifestBytes,
  attestationPath,
  attestation,
  finalManifest,
  externalAnchor,
  anchorOutputPath,
}) {
  if (!Buffer.isBuffer(expectedManifestBytes)) {
    throw new Error("captured pending closure manifest bytes are unavailable");
  }
  const attestationBytes = Buffer.from(`${canonicalJson(attestation)}\n`, "utf8");
  const manifestBytes = Buffer.from(`${canonicalJson(finalManifest)}\n`, "utf8");
  const anchorBytes = Buffer.from(`${canonicalJson(externalAnchor)}\n`, "utf8");
  const transactionPath = publicationTransactionPath(anchorOutputPath);
  const transactionWithoutDigest = {
    schemaVersion: 1,
    kind: PUBLICATION_TRANSACTION_KIND,
    status: "prepared",
    manifestPath,
    attestationPath,
    anchorOutputPath,
    originalManifestDigest: sha256Bytes(expectedManifestBytes),
    targetManifestDigest: sha256Bytes(manifestBytes),
    targetAttestationDigest: sha256Bytes(attestationBytes),
    targetAnchorDigest: sha256Bytes(anchorBytes),
    attestation,
    finalManifest,
    externalAnchor,
  };
  const transaction = {
    ...transactionWithoutDigest,
    digest: hashCanonical(transactionWithoutDigest),
  };
  const transactionErrors = validatePublicationTransaction(transaction, {
    manifestPath,
    attestationPath,
    anchorOutputPath,
  });
  if (transactionErrors.length > 0) {
    throw new Error(
      `Generated external publication transaction is invalid:\n${transactionErrors
        .map((error) => `- ${error}`).join("\n")}`,
    );
  }
  const transactionBytes = Buffer.from(`${canonicalJson(transaction)}\n`, "utf8");
  await atomicPublishAbsoluteFile({
    absolutePath: transactionPath,
    originalDigest: "absent",
    replacementBytes: transactionBytes,
    label: "external publication transaction",
  });
  await resumeExternalPublicationTransaction({
    repositoryRealpath,
    transactionPath,
    transaction,
    transactionBytes,
    expectedManifestBytes,
  });
}

async function recoverExternalPublication({
  repositoryRealpath,
  runnerDigest,
  manifestPath,
  manifest,
  snapshot,
  receipts,
  anchorOutputPath,
  existingAttestation,
  existingExternalAnchor,
  transactionPath,
  transaction,
}) {
  if (transaction) {
    const transactionErrors = validatePublicationTransaction(transaction, {
      manifestPath,
      attestationPath: manifest?.externalAttestation?.path,
      anchorOutputPath,
    });
    const attestationErrors = validateExactExternalAttestation(
      transaction.attestation,
      {
        manifest: transaction.finalManifest,
        snapshot,
        receipts,
        repositoryRealpath,
        runnerDigest,
      },
    );
    const anchorErrors = validateExactExternalAnchor(
      transaction.externalAnchor,
      {
        attestation: transaction.attestation,
        snapshot,
        receipts,
        repositoryRealpath,
        runnerDigest,
      },
    );
    const errors = [...transactionErrors, ...attestationErrors, ...anchorErrors];
    if (errors.length > 0) {
      throw new Error(
        `External publication recovery state is invalid:\n${errors
          .map((error) => `- ${error}`).join("\n")}`,
      );
    }
    const transactionBytes = Buffer.from(`${canonicalJson(transaction)}\n`, "utf8");
    await resumeExternalPublicationTransaction({
      repositoryRealpath,
      transactionPath,
      transaction,
      transactionBytes,
    });
    return transaction.attestation;
  }

  if (manifest?.status !== CLOSURE_STATUS_ATTESTED
    || !existingAttestation || !existingExternalAnchor) {
    throw new Error("completed external publication requires exact attestation and anchor outputs");
  }
  const errors = [
    ...validateExactExternalAttestation(existingAttestation, {
      manifest,
      snapshot,
      receipts,
      repositoryRealpath,
      runnerDigest,
    }),
    ...validateExactExternalAnchor(existingExternalAnchor, {
      attestation: existingAttestation,
      snapshot,
      receipts,
      repositoryRealpath,
      runnerDigest,
    }),
  ];
  if (errors.length > 0) {
    throw new Error(
      `Existing external publication is invalid:\n${errors
        .map((error) => `- ${error}`).join("\n")}`,
    );
  }
  return existingAttestation;
}

function publicationTransactionPath(anchorOutputPath) {
  return `${anchorOutputPath}.publication-transaction.json`;
}

function validatePublicationTransaction(transaction, bindings) {
  const keys = [
    "anchorOutputPath",
    "attestation",
    "attestationPath",
    "digest",
    "externalAnchor",
    "finalManifest",
    "kind",
    "manifestPath",
    "originalManifestDigest",
    "schemaVersion",
    "status",
    "targetAnchorDigest",
    "targetAttestationDigest",
    "targetManifestDigest",
  ];
  const errors = [];
  if (!plainObject(transaction)
    || !exactKeys(transaction, keys)
    || transaction.schemaVersion !== 1
    || transaction.kind !== PUBLICATION_TRANSACTION_KIND
    || transaction.status !== "prepared") {
    return ["external publication transaction must contain the exact prepared v1 schema"];
  }
  if (transaction.manifestPath !== bindings.manifestPath
    || transaction.attestationPath !== bindings.attestationPath
    || transaction.anchorOutputPath !== bindings.anchorOutputPath) {
    errors.push("external publication transaction output paths are stale");
  }
  const attestationBytes = Buffer.from(
    `${canonicalJson(transaction.attestation)}\n`,
    "utf8",
  );
  const manifestBytes = Buffer.from(
    `${canonicalJson(transaction.finalManifest)}\n`,
    "utf8",
  );
  const anchorBytes = Buffer.from(
    `${canonicalJson(transaction.externalAnchor)}\n`,
    "utf8",
  );
  for (const [key, expected] of [
    ["targetAttestationDigest", sha256Bytes(attestationBytes)],
    ["targetManifestDigest", sha256Bytes(manifestBytes)],
    ["targetAnchorDigest", sha256Bytes(anchorBytes)],
  ]) {
    if (transaction[key] !== expected) {
      errors.push(`external publication transaction ${key} is stale`);
    }
  }
  if (!sha256Digest(transaction.originalManifestDigest)) {
    errors.push("external publication transaction original manifest digest is invalid");
  }
  const withoutDigest = { ...transaction };
  delete withoutDigest.digest;
  if (transaction.digest !== hashCanonical(withoutDigest)) {
    errors.push("external publication transaction canonical digest is stale");
  }
  return errors;
}

async function resumeExternalPublicationTransaction({
  repositoryRealpath,
  transactionPath,
  transaction,
  transactionBytes,
}) {
  const attestationBytes = Buffer.from(
    `${canonicalJson(transaction.attestation)}\n`,
    "utf8",
  );
  const manifestBytes = Buffer.from(
    `${canonicalJson(transaction.finalManifest)}\n`,
    "utf8",
  );
  const anchorBytes = Buffer.from(
    `${canonicalJson(transaction.externalAnchor)}\n`,
    "utf8",
  );
  await assertAbsoluteBytesAtCanonicalOrTombstone(
    transactionPath,
    transactionBytes,
    "external publication transaction",
  );
  maybeInjectPublicationFault("after-transaction");
  await convergeRepositoryPublication({
    root: repositoryRealpath,
    relativePath: transaction.attestationPath,
    originalDigest: null,
    targetBytes: attestationBytes,
    label: "external attestation publication",
  });
  maybeInjectPublicationFault("after-attestation");
  maybeInjectPublicationFault("before-manifest-commit");
  await convergeRepositoryPublication({
    root: repositoryRealpath,
    relativePath: transaction.manifestPath,
    originalDigest: transaction.originalManifestDigest,
    targetBytes: manifestBytes,
    label: "externally attested manifest publication",
  });
  maybeInjectPublicationFault("after-manifest");
  await convergeAbsolutePublication({
    absolutePath: transaction.anchorOutputPath,
    originalDigest: null,
    targetBytes: anchorBytes,
    label: "external anchor publication",
  });
  maybeInjectPublicationFault("after-anchor");
  await Promise.all([
    assertRepositoryBytes(
      repositoryRealpath,
      transaction.attestationPath,
      attestationBytes,
      "published external attestation",
    ),
    assertRepositoryBytes(
      repositoryRealpath,
      transaction.manifestPath,
      manifestBytes,
      "published externally attested manifest",
    ),
    assertAbsoluteBytes(
      transaction.anchorOutputPath,
      anchorBytes,
      "published external anchor",
    ),
  ]);
  await atomicRetireAbsoluteFile(
    transactionPath,
    transactionBytes,
    "completed external publication transaction",
  );
}

function maybeInjectPublicationFault(point) {
  if (process.env.ZEROX_CD03_RUNNER_TEST_FAULT === point) {
    throw new Error(`injected external publication fault: ${point}`);
  }
}

function parseOptions(args) {
  const scalar = new Map();
  const receiptDigests = new Map();
  const challenges = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--expected-review-receipt"
      || argument === "--expected-review-challenge") {
      const value = args[index + 1];
      index += 1;
      const parsed = parseLaneValue(value, argument);
      const target = argument === "--expected-review-receipt"
        ? receiptDigests
        : challenges;
      if (target.has(parsed.lane)) {
        throw new Error(`${argument} lane may be specified only once: ${parsed.lane}`);
      }
      target.set(parsed.lane, parsed.value);
      continue;
    }
    const known = new Set([
      "--repo",
      "--expected-repo-realpath",
      "--closure-manifest",
      "--expected-runner-digest",
      "--expected-snapshot-digest",
      "--external-anchor-output",
    ]);
    if (!known.has(argument)) {
      throw new Error(`Unknown external closure option: ${argument}`);
    }
    if (scalar.has(argument)) {
      throw new Error(`External closure option may be specified only once: ${argument}`);
    }
    scalar.set(argument, args[index + 1]);
    index += 1;
  }
  for (const option of [
    "--repo",
    "--expected-repo-realpath",
    "--closure-manifest",
    "--expected-runner-digest",
    "--expected-snapshot-digest",
    "--external-anchor-output",
  ]) {
    if (!nonEmpty(scalar.get(option))) {
      throw new Error(`Missing required external closure option: ${option}`);
    }
  }
  if (!path.isAbsolute(scalar.get("--expected-repo-realpath"))) {
    throw new Error("--expected-repo-realpath must be absolute");
  }
  if (!repositoryPath(scalar.get("--closure-manifest"))) {
    throw new Error("--closure-manifest must be repository-relative");
  }
  if (!path.isAbsolute(scalar.get("--external-anchor-output"))) {
    throw new Error("--external-anchor-output must be absolute");
  }
  if (!sha256Digest(scalar.get("--expected-runner-digest"))
    || !sha256Digest(scalar.get("--expected-snapshot-digest"))) {
    throw new Error("Expected runner and snapshot digests must be SHA-256 digests");
  }
  for (const lane of REQUIRED_REVIEW_LANES) {
    if (!sha256Digest(receiptDigests.get(lane))) {
      throw new Error(`Missing or invalid expected review receipt digest: ${lane}`);
    }
    if (!sha256Digest(challenges.get(lane))) {
      throw new Error(`Missing or invalid expected review challenge: ${lane}`);
    }
  }
  if (receiptDigests.size !== REQUIRED_REVIEW_LANES.length
    || challenges.size !== REQUIRED_REVIEW_LANES.length) {
    throw new Error("Expected review anchors must use the exact three review lanes");
  }
  return {
    repo: scalar.get("--repo"),
    expectedRepoRealpath: scalar.get("--expected-repo-realpath"),
    closureManifest: scalar.get("--closure-manifest"),
    expectedRunnerDigest: scalar.get("--expected-runner-digest"),
    expectedSnapshotDigest: scalar.get("--expected-snapshot-digest"),
    expectedReceiptDigests: receiptDigests,
    expectedChallenges: challenges,
    externalAnchorOutput: scalar.get("--external-anchor-output"),
  };
}

function parseLaneValue(value, option) {
  if (typeof value !== "string") throw new Error(`${option} requires lane=sha256:<hex>`);
  const separator = value.indexOf("=");
  const lane = value.slice(0, separator);
  const digest = value.slice(separator + 1);
  if (!REQUIRED_REVIEW_LANES.includes(lane) || !sha256Digest(digest)) {
    throw new Error(`${option} requires a valid lane=sha256:<hex>`);
  }
  return { lane, value: digest };
}

function requireCandidateReceipt(stdout, kind, expectedSnapshotDigest) {
  const expectedKind = kind === "checker"
    ? "cd03-checker-receipt"
    : "cd03-harness-receipt";
  const receipts = String(stdout).split(/\r?\n/).flatMap((line) => {
    if (!line.trim().startsWith("{")) return [];
    try {
      const value = JSON.parse(line);
      return plainObject(value) && value.kind === expectedKind ? [value] : [];
    } catch {
      return [];
    }
  });
  if (
    receipts.length !== 1
    || !exactKeys(receipts[0], ["kind", "snapshotDigest", "status"])
    || receipts[0].status !== "passed"
    || receipts[0].snapshotDigest !== expectedSnapshotDigest
  ) {
    throw new Error(
      `${kind} must emit one exact externally digest-bound JSON receipt`,
    );
  }
  return receipts[0];
}

function validateManifest(manifest, errors, options = {}) {
  if (!plainObject(manifest) || !exactKeys(manifest, MANIFEST_KEYS)) {
    errors.push("closure manifest must contain the exact v1 keys");
    return;
  }
  const allowedStatuses = options.allowAttested
    ? [CLOSURE_STATUS_PENDING, CLOSURE_STATUS_ATTESTED]
    : [CLOSURE_STATUS_PENDING];
  if (manifest.schemaVersion !== 1 || manifest.kind !== CLOSURE_MANIFEST_KIND
    || !allowedStatuses.includes(manifest.status)) {
    errors.push("closure manifest identity/status is invalid");
  }
  validateSharedIdentity(manifest, "closure manifest", errors);
  if (!plainObject(manifest.snapshot)
    || !exactKeys(manifest.snapshot, ["digest", "path"])
    || !repositoryPath(manifest.snapshot.path)
    || !sha256Digest(manifest.snapshot.digest)) {
    errors.push("closure manifest snapshot reference is invalid");
  }
  if (!Array.isArray(manifest.reviewReceipts)
    || manifest.reviewReceipts.length !== REQUIRED_REVIEW_LANES.length) {
    errors.push("closure manifest must reference exactly three review receipts");
  } else {
    const lanes = [];
    for (const [index, entry] of manifest.reviewReceipts.entries()) {
      if (!plainObject(entry)
        || !exactKeys(entry, ["canonicalDigest", "lane", "path"])
        || !REQUIRED_REVIEW_LANES.includes(entry.lane)
        || !repositoryPath(entry.path)
        || !sha256Digest(entry.canonicalDigest)) {
        errors.push(`closure manifest reviewReceipts[${index}] is invalid`);
      }
      lanes.push(entry?.lane);
    }
    if (!sameStringSet(REQUIRED_REVIEW_LANES, lanes)) {
      errors.push("closure manifest review receipt lanes must be unique and complete");
    }
  }
  if (!Array.isArray(manifest.executableClosure)
    || manifest.executableClosure.length !== 3) {
    errors.push("closure manifest executableClosure must contain package/checker/harness");
  } else {
    const kinds = [];
    for (const [index, entry] of manifest.executableClosure.entries()) {
      if (!plainObject(entry) || !exactKeys(entry, ["kind", "path", "sha256"])
        || REQUIRED_EXECUTABLE_CLOSURE[entry.kind] !== entry.path
        || !sha256Digest(entry.sha256)) {
        errors.push(`closure manifest executableClosure[${index}] is invalid`);
      }
      kinds.push(entry?.kind);
    }
    if (!sameStringSet(Object.keys(REQUIRED_EXECUTABLE_CLOSURE), kinds)) {
      errors.push("closure manifest executableClosure kinds must be unique and complete");
    }
  }
  if (!plainObject(manifest.externalRunner)
    || !exactKeys(manifest.externalRunner, ["path", "sha256"])
    || manifest.externalRunner.path !== REQUIRED_EXTERNAL_RUNNER
    || !sha256Digest(manifest.externalRunner.sha256)) {
    errors.push("closure manifest externalRunner is invalid");
  }
  if (!plainObject(manifest.externalAttestation)
    || !exactKeys(manifest.externalAttestation, ["canonicalDigest", "path"])
    || !repositoryPath(manifest.externalAttestation.path)
    || (manifest.status === CLOSURE_STATUS_PENDING
      ? manifest.externalAttestation.canonicalDigest !== null
      : !sha256Digest(manifest.externalAttestation.canonicalDigest))) {
    errors.push("pending closure manifest externalAttestation reference is invalid");
  }
  if (!sha256Digest(manifest.digest)) {
    errors.push("closure manifest digest is invalid");
  } else {
    const withoutDigest = { ...manifest };
    delete withoutDigest.digest;
    if (manifest.digest !== hashCanonical(withoutDigest)) {
      errors.push("closure manifest digest is stale");
    }
  }
}

function validateSnapshot(snapshot, errors) {
  if (!plainObject(snapshot) || !exactKeys(snapshot, SNAPSHOT_KEYS)) {
    errors.push("review snapshot must contain the exact v1 keys");
    return;
  }
  if (snapshot.schemaVersion !== 1 || snapshot.kind !== REVIEW_SNAPSHOT_KIND
    || snapshot.algorithm !== REVIEW_ALGORITHM) {
    errors.push("review snapshot identity/algorithm is invalid");
  }
  validateSharedIdentity(snapshot, "review snapshot", errors);
  for (const key of [
    "claimsDigest",
    "completionContractDigest",
    "featureFileSetDigest",
    "safetyContractDigest",
    "digest",
  ]) {
    if (!sha256Digest(snapshot[key])) errors.push(`review snapshot ${key} is invalid`);
  }
  if (!Array.isArray(snapshot.files) || snapshot.files.length === 0) {
    errors.push("review snapshot files must be a non-empty array");
  } else {
    const paths = [];
    for (const [index, entry] of snapshot.files.entries()) {
      if (!plainObject(entry) || !exactKeys(entry, ["path", "sha256"])
        || !repositoryPath(entry.path) || !sha256Digest(entry.sha256)) {
        errors.push(`review snapshot files[${index}] is invalid`);
      }
      paths.push(entry?.path);
    }
    if (new Set(paths).size !== paths.length
      || !sameOrderedStrings(paths, paths.slice().sort())) {
      errors.push("review snapshot file paths must be unique and sorted");
    }
  }
  const withoutDigest = { ...snapshot };
  delete withoutDigest.digest;
  if (sha256Digest(snapshot.digest) && snapshot.digest !== hashCanonical(withoutDigest)) {
    errors.push("review snapshot digest is stale");
  }
}

function validateReviewSet(receipts, snapshot, errors) {
  if (receipts.length !== REQUIRED_REVIEW_LANES.length) {
    errors.push("review set must contain exactly three receipts");
    return;
  }
  const lanes = [];
  const tasks = [];
  const agents = [];
  const challenges = [];
  for (const [index, receipt] of receipts.entries()) {
    if (!plainObject(receipt) || !exactKeys(receipt, RECEIPT_KEYS)) {
      errors.push(`review receipt[${index}] must contain the exact v1 keys`);
      continue;
    }
    if (receipt.schemaVersion !== 1 || receipt.kind !== REVIEW_RECEIPT_KIND
      || receipt.transport !== "codex-collaboration") {
      errors.push(`review receipt[${index}] identity/transport is invalid`);
    }
    validateSharedIdentity(receipt, `review receipt[${index}]`, errors);
    lanes.push(receipt.lane);
    tasks.push(receipt.reviewTaskPath);
    agents.push(receipt.reviewAgentId);
    challenges.push(receipt.challenge);
    if (!REQUIRED_REVIEW_LANES.includes(receipt.lane)
      || !nonEmpty(receipt.reviewTaskPath) || !nonEmpty(receipt.reviewAgentId)
      || !sha256Digest(receipt.challenge)) {
      errors.push(`review receipt[${index}] lane/task/agent/challenge is invalid`);
    }
    if (receipt.verdict !== "passed") {
      errors.push(`review receipt ${receipt.lane} must pass`);
    }
    validateFindingCounts(receipt, index, errors);
    if (receipt.findingCounts?.critical !== 0 || receipt.findingCounts?.major !== 0) {
      errors.push(`review receipt ${receipt.lane} must have zero Critical/Major findings`);
    }
    if (!isoTimestamp(receipt.completedAt)) {
      errors.push(`review receipt[${index}] completedAt is invalid`);
    } else if (Date.parse(receipt.completedAt) > Date.now()) {
      errors.push(`review receipt[${index}] completedAt must not be in the future`);
    }
    if (snapshot) {
      for (const key of ["programId", "workstreamId", "featureId", "round"]) {
        if (receipt[key] !== snapshot[key]) {
          errors.push(`review receipt ${receipt.lane} ${key} does not match snapshot`);
        }
      }
      if (receipt.snapshotDigest !== snapshot.digest
        || receipt.snapshotFileCount !== snapshot.files?.length
        || receipt.completionContractDigest !== snapshot.completionContractDigest
        || receipt.safetyContractDigest !== snapshot.safetyContractDigest) {
        errors.push(`review receipt ${receipt.lane} digest/file-count binding is invalid`);
      }
    }
  }
  if (!sameStringSet(REQUIRED_REVIEW_LANES, lanes)) {
    errors.push("review lanes must be unique and complete");
  }
  for (const [values, label] of [
    [tasks, "task"],
    [agents, "agent"],
    [challenges, "challenge"],
  ]) {
    if (values.length !== new Set(values).size) {
      errors.push(`review ${label} identities must be unique`);
    }
  }
}

function validateFindingCounts(receipt, index, errors) {
  if (!plainObject(receipt.findingCounts)
    || !exactKeys(receipt.findingCounts, ["critical", "major", "minor"])
    || Object.values(receipt.findingCounts).some(
      (value) => !Number.isInteger(value) || value < 0,
    )
    || !Array.isArray(receipt.findings)) {
    errors.push(`review receipt[${index}] finding contract is invalid`);
    return;
  }
  const counts = { critical: 0, major: 0, minor: 0 };
  const ids = new Set();
  for (const [findingIndex, finding] of receipt.findings.entries()) {
    if (!plainObject(finding)
      || !exactKeys(finding, ["evidence", "id", "severity", "summary"])
      || !nonEmpty(finding.id) || ids.has(finding.id)
      || !Object.hasOwn(counts, finding.severity)
      || !nonEmpty(finding.summary)
      || !Array.isArray(finding.evidence)
      || finding.evidence.some((item) => !nonEmpty(item))) {
      errors.push(`review receipt[${index}] findings[${findingIndex}] is invalid`);
      continue;
    }
    ids.add(finding.id);
    counts[finding.severity] += 1;
  }
  for (const severity of Object.keys(counts)) {
    if (receipt.findingCounts[severity] !== counts[severity]) {
      errors.push(`review receipt[${index}] ${severity} count is stale`);
    }
  }
}

function validateExactExternalAttestation(attestation, bindings) {
  const errors = [];
  if (!plainObject(attestation) || !exactKeys(attestation, EXTERNAL_ATTESTATION_KEYS)) {
    return ["external attestation must contain the exact v1 keys"];
  }
  if (attestation.schemaVersion !== 1
    || attestation.kind !== EXTERNAL_ATTESTATION_KIND
    || attestation.status !== "passed") {
    errors.push("external attestation identity/status is invalid");
  }
  if (attestation.trustLevel !== "external-anchor-consistency"
    || attestation.subjectIdentityAssurance !== "not-signed") {
    errors.push("external attestation must honestly declare unsigned consistency assurance");
  }
  if (!path.isAbsolute(attestation.repositoryRealpath)) {
    errors.push("external attestation repositoryRealpath must be absolute");
  }
  for (const key of [
    "runnerDigest",
    "snapshotDigest",
    "pendingManifestDigest",
    "digest",
  ]) {
    if (!sha256Digest(attestation[key])) {
      errors.push(`external attestation ${key} must be a SHA-256 digest`);
    }
  }
  if (!isoTimestamp(attestation.completedAt)) {
    errors.push("external attestation completedAt must be an exact ISO timestamp");
  } else if (Date.parse(attestation.completedAt) > Date.now()) {
    errors.push("external attestation completedAt must not be in the future");
  }
  if (!Array.isArray(attestation.reviewReceiptDigests)
    || attestation.reviewReceiptDigests.length !== REQUIRED_REVIEW_LANES.length) {
    errors.push("external attestation must bind exactly three review receipt digests");
  } else {
    validateExactLaneEntries(
      attestation.reviewReceiptDigests,
      ["canonicalDigest", "lane"],
      errors,
      "external attestation review receipt",
      (entry) => sha256Digest(entry.canonicalDigest),
    );
  }
  if (!Array.isArray(attestation.candidateResults)
    || attestation.candidateResults.length !== 2) {
    errors.push("external attestation must contain checker and harness candidate results");
  } else {
    const kinds = [];
    for (const [index, result] of attestation.candidateResults.entries()) {
      if (!plainObject(result) || !exactKeys(result, [
        "kind",
        "path",
        "receipt",
        "receiptDigest",
        "status",
        "stderrDigest",
        "stdoutDigest",
      ])) {
        errors.push(`external attestation candidateResults[${index}] has invalid keys`);
        continue;
      }
      kinds.push(result.kind);
      const receiptKind = result.kind === "checker"
        ? "cd03-checker-receipt"
        : result.kind === "harness"
          ? "cd03-harness-receipt"
          : null;
      if (!receiptKind || result.path !== REQUIRED_EXECUTABLE_CLOSURE[result.kind]
        || result.status !== "passed"
        || !plainObject(result.receipt)
        || !exactKeys(result.receipt, ["kind", "snapshotDigest", "status"])
        || result.receipt.kind !== receiptKind
        || result.receipt.status !== "passed"
        || result.receipt.snapshotDigest !== attestation.snapshotDigest
        || result.receiptDigest !== hashCanonical(result.receipt)
        || !sha256Digest(result.stdoutDigest)
        || !sha256Digest(result.stderrDigest)) {
        errors.push(`external attestation candidateResults[${index}] is invalid`);
      }
    }
    if (!sameStringSet(["checker", "harness"], kinds)) {
      errors.push("external attestation candidate result kinds must be exact");
    }
  }
  const withoutDigest = { ...attestation };
  delete withoutDigest.digest;
  if (attestation.digest !== hashCanonical(withoutDigest)) {
    errors.push("external attestation canonical digest is stale");
  }
  const { manifest, snapshot, receipts, repositoryRealpath, runnerDigest } = bindings;
  validateManifest(manifest, errors, { allowAttested: true });
  if (manifest?.status !== CLOSURE_STATUS_ATTESTED
    || manifest?.externalAttestation?.canonicalDigest !== attestation.digest) {
    errors.push("external attestation is not exactly bound by the final manifest");
  }
  const pendingManifest = toPendingManifest(manifest);
  if (attestation.pendingManifestDigest !== pendingManifest?.digest) {
    errors.push("external attestation pending manifest digest is stale");
  }
  if (attestation.repositoryRealpath !== repositoryRealpath
    || attestation.runnerDigest !== runnerDigest
    || attestation.snapshotDigest !== snapshot?.digest) {
    errors.push("external attestation repository/runner/snapshot binding is stale");
  }
  const receiptMap = new Map((receipts ?? []).map((receipt) => [
    receipt?.lane,
    hashCanonical(receipt),
  ]));
  for (const entry of attestation.reviewReceiptDigests ?? []) {
    if (receiptMap.get(entry?.lane) !== entry?.canonicalDigest) {
      errors.push(`external attestation receipt binding is stale: ${entry?.lane}`);
    }
  }
  const latestReceiptTime = Math.max(
    ...(receipts ?? []).map((receipt) => Date.parse(receipt?.completedAt)),
  );
  if (Number.isFinite(latestReceiptTime)
    && Date.parse(attestation.completedAt) < latestReceiptTime) {
    errors.push("external attestation completedAt predates a bound review receipt");
  }
  return errors;
}

function validateExactExternalAnchor(anchor, bindings) {
  const errors = [];
  if (!plainObject(anchor) || !exactKeys(anchor, EXTERNAL_ANCHOR_KEYS)) {
    return ["external anchor must contain the exact v1 keys"];
  }
  if (anchor.schemaVersion !== 1 || anchor.kind !== EXTERNAL_ANCHOR_KIND
    || anchor.trustLevel !== "external-caller-pinned-consistency"
    || anchor.subjectIdentityAssurance !== "not-signed") {
    errors.push("external anchor identity/assurance is invalid");
  }
  for (const key of [
    "attestationDigest",
    "runnerDigest",
    "snapshotDigest",
    "digest",
  ]) {
    if (!sha256Digest(anchor[key])) errors.push(`external anchor ${key} is invalid`);
  }
  if (!isoTimestamp(anchor.completedAt)
    || Date.parse(anchor.completedAt) > Date.now()) {
    errors.push("external anchor completedAt is invalid or in the future");
  }
  if (!Array.isArray(anchor.reviewReceipts)
    || anchor.reviewReceipts.length !== REQUIRED_REVIEW_LANES.length) {
    errors.push("external anchor must bind exactly three review receipts");
  } else {
    validateExactLaneEntries(
      anchor.reviewReceipts,
      ["canonicalDigest", "challenge", "lane"],
      errors,
      "external anchor review receipt",
      (entry) => sha256Digest(entry.canonicalDigest)
        && sha256Digest(entry.challenge),
    );
  }
  const withoutDigest = { ...anchor };
  delete withoutDigest.digest;
  if (anchor.digest !== hashCanonical(withoutDigest)) {
    errors.push("external anchor canonical digest is stale");
  }
  const { attestation, snapshot, receipts, repositoryRealpath, runnerDigest } = bindings;
  if (anchor.attestationDigest !== attestation?.digest
    || anchor.completedAt !== attestation?.completedAt
    || anchor.repositoryRealpath !== repositoryRealpath
    || anchor.runnerDigest !== runnerDigest
    || anchor.snapshotDigest !== snapshot?.digest) {
    errors.push("external anchor attestation/repository/runner/snapshot binding is stale");
  }
  const receiptMap = new Map((receipts ?? []).map((receipt) => [
    receipt?.lane,
    { digest: hashCanonical(receipt), challenge: receipt?.challenge },
  ]));
  for (const entry of anchor.reviewReceipts ?? []) {
    const expected = receiptMap.get(entry?.lane);
    if (expected?.digest !== entry?.canonicalDigest) {
      errors.push(`external anchor receipt digest is stale: ${entry?.lane}`);
    }
    if (expected?.challenge !== entry?.challenge) {
      errors.push(`external anchor review challenge is stale: ${entry?.lane}`);
    }
  }
  return errors;
}

function validateExactLaneEntries(entries, keys, errors, label, validateEntry) {
  const lanes = [];
  for (const [index, entry] of entries.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, keys)) {
      errors.push(`${label}[${index}] has invalid keys`);
      continue;
    }
    lanes.push(entry.lane);
    if (!REQUIRED_REVIEW_LANES.includes(entry.lane) || !validateEntry(entry)) {
      errors.push(`${label}[${index}] is invalid`);
    }
  }
  if (!sameStringSet(REQUIRED_REVIEW_LANES, lanes)) {
    errors.push(`${label} lanes must be unique and complete`);
  }
}

function toPendingManifest(manifest) {
  if (!plainObject(manifest)) return null;
  const withoutDigest = {
    ...manifest,
    status: CLOSURE_STATUS_PENDING,
    externalAttestation: {
      ...manifest.externalAttestation,
      canonicalDigest: null,
    },
  };
  delete withoutDigest.digest;
  return { ...withoutDigest, digest: hashCanonical(withoutDigest) };
}

async function readRepositoryJson(
  root,
  relativePath,
  label,
  errors,
  capturedFiles,
) {
  if (!repositoryPath(relativePath)) {
    errors.push(`${label} path must be repository-relative`);
    return undefined;
  }
  const bytes = await readFrozenRepositoryFile(root, relativePath, label, errors);
  if (!bytes) return undefined;
  if (capturedFiles) {
    rememberCapturedFile(capturedFiles, relativePath, bytes, errors);
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    errors.push(`${label} must contain valid JSON`);
    return undefined;
  }
}

async function readOptionalRepositoryJson(
  root,
  relativePath,
  label,
  errors,
  requirePrivate = false,
) {
  if (!repositoryPath(relativePath)) {
    errors.push(`${label} path must be repository-relative`);
    return null;
  }
  try {
    await lstat(path.join(root, relativePath));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    errors.push(`${label} could not be inspected`);
    return null;
  }
  const bytes = await readFrozenRepositoryFile(
    root,
    relativePath,
    label,
    errors,
    requirePrivate,
  );
  if (!bytes) return null;
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    errors.push(`${label} must contain valid JSON`);
    return null;
  }
}

async function readOptionalAbsoluteJson(
  absolutePath,
  label,
  errors,
  requirePrivate = false,
  allowRemovalTombstone = false,
  allowCompletedMarker = false,
) {
  const tombstonePath = `${absolutePath}.remove.tombstone`;
  const existingPaths = [];
  for (const candidatePath of [
    absolutePath,
    ...(allowRemovalTombstone ? [tombstonePath] : []),
  ]) {
    try {
      await lstat(candidatePath);
      existingPaths.push(candidatePath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        errors.push(`${label} could not be inspected`);
        return null;
      }
    }
  }
  if (allowCompletedMarker) {
    existingPaths.push(...await listAbsoluteCompletedMarkerPaths(tombstonePath));
  }
  if (existingPaths.length === 0) return null;
  if (existingPaths.length !== 1) {
    errors.push(`${label} and removal tombstone must not coexist`);
    return null;
  }
  const selectedPath = existingPaths[0];
  const isCompletedMarker = allowCompletedMarker
    && selectedPath !== absolutePath
    && selectedPath !== tombstonePath;
  const capture = await readFrozenAbsoluteFile(
    selectedPath,
    label,
    errors,
    requirePrivate,
    isCompletedMarker,
  );
  const bytes = isCompletedMarker ? capture?.bytes : capture;
  if (!bytes) return null;
  if (isCompletedMarker && !completedMarkerCaptureMatches(
    selectedPath,
    tombstonePath,
    capture,
  )) {
    errors.push(`${label} completed marker identity/digest is stale`);
    return null;
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    errors.push(`${label} must contain valid JSON`);
    return null;
  }
}

async function captureRepositoryFile(
  root,
  relativePath,
  label,
  errors,
  capturedFiles,
) {
  if (capturedFiles.has(relativePath)) return capturedFiles.get(relativePath);
  const bytes = await readFrozenRepositoryFile(root, relativePath, label, errors);
  if (bytes) rememberCapturedFile(capturedFiles, relativePath, bytes, errors);
  return bytes;
}

function rememberCapturedFile(capturedFiles, relativePath, bytes, errors) {
  const existing = capturedFiles.get(relativePath);
  if (existing && !existing.equals(bytes)) {
    errors.push(`candidate control input changed during preflight: ${relativePath}`);
    return;
  }
  capturedFiles.set(relativePath, bytes);
}

function collectCheckerDependencyPaths(program) {
  const paths = new Set();
  if (!plainObject(program)) return paths;
  for (const relativePath of [
    program.sourceReview,
    program.operatingGuide,
    program.architectureDecision,
  ]) {
    if (repositoryPath(relativePath)) paths.add(relativePath);
  }
  for (const workstream of program.workstreams ?? []) {
    if (
      workstream?.state !== "planned"
      && repositoryPath(workstream?.architectureDecision)
    ) {
      paths.add(workstream.architectureDecision);
    }
    if (workstream?.state === "completed") {
      for (const relativePath of workstream.completionArtifacts ?? []) {
        if (repositoryPath(relativePath)) paths.add(relativePath);
      }
    }
  }
  return paths;
}

async function validatePostflightControlInputs({
  repositoryRealpath,
  capturedControlFiles,
  completedMarkerCaptures,
  manifestPath,
  snapshotPath,
  receiptPaths,
  snapshotPathSet,
  expectedSnapshotDigest,
}) {
  const errors = [];
  const postflightFiles = new Map();
  const completedMarkerByPath = new Map(
    completedMarkerCaptures.map((capture) => [capture.relativePath, capture]),
  );
  for (const [relativePath, expectedBytes] of capturedControlFiles) {
    const expectedMarker = completedMarkerByPath.get(relativePath);
    const capture = await readFrozenRepositoryFile(
      repositoryRealpath,
      relativePath,
      `postflight candidate control input ${relativePath}`,
      errors,
      Boolean(expectedMarker),
      Boolean(expectedMarker),
    );
    const bytes = expectedMarker ? capture?.bytes : capture;
    if (!bytes) continue;
    postflightFiles.set(relativePath, bytes);
    if (!expectedBytes.equals(bytes)) {
      errors.push(
        snapshotPathSet.has(relativePath)
          ? `postflight review snapshot hash drift: ${relativePath}`
          : `postflight candidate control input byte drift: ${relativePath}`,
      );
    }
    if (expectedMarker
      && (capture.dev !== expectedMarker.dev || capture.ino !== expectedMarker.ino)) {
      errors.push(`postflight completed marker inode changed: ${relativePath}`);
    }
  }

  for (const markerCapture of completedMarkerCaptures) {
    try {
      const markerBase = path.basename(markerCapture.markerBaseRelativePath);
      const markerDirectory = path.dirname(path.join(
        repositoryRealpath,
        markerCapture.markerBaseRelativePath,
      ));
      const markerNames = (await readdir(markerDirectory)).filter(
        (entry) => entry.startsWith(`${markerBase}.completed-`)
          && entry.endsWith(".marker"),
      );
      if (markerNames.length !== 1
        || markerNames[0] !== path.basename(markerCapture.relativePath)) {
        errors.push("postflight freeze publication completed marker became missing/ambiguous");
      }
    } catch {
      errors.push("postflight freeze publication completed marker could not be enumerated");
    }
  }

  const currentManifest = parsePostflightJson(
    postflightFiles,
    manifestPath,
    "postflight closure manifest",
    errors,
  );
  validateManifest(currentManifest, errors);
  const currentSnapshot = parsePostflightJson(
    postflightFiles,
    snapshotPath,
    "postflight external review snapshot",
    errors,
  );
  validateSnapshot(currentSnapshot, errors);
  if (currentSnapshot?.digest !== expectedSnapshotDigest) {
    errors.push("postflight review snapshot digest does not match the external anchor");
  }
  if (currentManifest?.snapshot?.path !== snapshotPath
    || currentManifest?.snapshot?.digest !== expectedSnapshotDigest) {
    errors.push("postflight closure manifest snapshot reference drifted");
  }
  for (const key of ["programId", "workstreamId", "featureId", "round"]) {
    if (currentManifest?.[key] !== currentSnapshot?.[key]) {
      errors.push(`postflight closure manifest ${key} does not match the review snapshot`);
    }
  }
  for (const markerCapture of completedMarkerCaptures) {
    const markerBytes = postflightFiles.get(markerCapture.relativePath);
    if (!markerBytes) continue;
    try {
      const transaction = JSON.parse(markerBytes.toString("utf8"));
      for (const transactionError of validateCompletedFreezeTransaction(transaction, {
        round: currentSnapshot?.round,
        snapshotPath,
        artifactPath: CANONICAL_CONTROL_INPUTS.artifact,
        targetSnapshotDigest: sha256Bytes(
          postflightFiles.get(snapshotPath) ?? Buffer.alloc(0),
        ),
      })) {
        errors.push(`postflight freeze completed marker ${transactionError}`);
      }
    } catch {
      errors.push("postflight freeze completed marker must contain valid JSON");
    }
  }

  const currentReceipts = receiptPaths.flatMap((relativePath) => {
    const receipt = parsePostflightJson(
      postflightFiles,
      relativePath,
      `postflight review receipt ${relativePath}`,
      errors,
    );
    return receipt ? [receipt] : [];
  });
  validateReviewSet(currentReceipts, currentSnapshot, errors);
  for (const entry of currentManifest?.reviewReceipts ?? []) {
    const receipt = currentReceipts.find((candidate) => candidate.lane === entry.lane);
    if (!receipt || entry.canonicalDigest !== hashCanonical(receipt)) {
      errors.push(`postflight closure manifest review receipt digest is stale: ${entry.lane}`);
    }
  }

  for (const [label, relativePath] of Object.entries(CANONICAL_CONTROL_INPUTS)) {
    const value = parsePostflightJson(
      postflightFiles,
      relativePath,
      `postflight ${label} control input`,
      errors,
    );
    if (!plainObject(value)) {
      errors.push(`postflight ${label} control input must remain a JSON object`);
    }
  }
  return errors;
}

function parsePostflightJson(files, relativePath, label, errors) {
  const bytes = files.get(relativePath);
  if (!bytes) return undefined;
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    errors.push(`${label} must contain valid JSON`);
    return undefined;
  }
}

async function requireRepositoryOutputAbsent(root, relativePath, label, errors) {
  if (!repositoryPath(relativePath)) {
    errors.push(`${label} path must be repository-relative`);
    return;
  }
  const segments = relativePath.split("/");
  let cursor = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    cursor = path.join(cursor, segments[index]);
    try {
      const entry = await lstat(cursor);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        errors.push(`${label} parent must be a real directory: ${relativePath}`);
        return;
      }
    } catch {
      errors.push(`${label} parent does not exist: ${relativePath}`);
      return;
    }
  }
  try {
    await lstat(path.join(root, relativePath));
    errors.push(`${label} must not already exist: ${relativePath}`);
  } catch {
    // The declared output is created only after both candidate executions and
    // the live-repository postflight have succeeded.
  }
}

async function readFrozenRepositoryFile(
  root,
  relativePath,
  label,
  errors,
  requirePrivate = false,
  captureIdentity = false,
) {
  if (!repositoryPath(relativePath)) {
    errors.push(`${label} path must be repository-relative`);
    return null;
  }
  const absolutePath = path.join(root, relativePath);
  try {
    const parentCapture = await captureAbsoluteParentIdentity(absolutePath, label);
    const pathStat = await lstat(absolutePath);
    if (pathStat.isSymbolicLink()) {
      errors.push(`${label} must not contain symbolic links: ${relativePath}`);
      return null;
    }
    if (!pathStat.isFile()) {
      errors.push(`${label} must be a regular file: ${relativePath}`);
      return null;
    }
    if (pathStat.nlink !== 1) {
      errors.push(`${label} must have exactly one hard link: ${relativePath}`);
      return null;
    }
    const handle = await open(
      absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const fileStat = await handle.stat();
      if (!fileStat.isFile() || fileStat.nlink !== 1) {
        errors.push(`${label} must be a regular file: ${relativePath}`);
        return null;
      }
      if (requirePrivate && (fileStat.uid !== process.geteuid()
        || (fileStat.mode & 0o777) !== 0o600)) {
        errors.push(`${label} must be owned by the effective user with mode 0600`);
        return null;
      }
      if (fileStat.dev !== pathStat.dev || fileStat.ino !== pathStat.ino) {
        errors.push(`${label} changed identity while opening: ${relativePath}`);
        return null;
      }
      const bytes = await handle.readFile();
      const afterStat = await handle.stat();
      if (afterStat.dev !== fileStat.dev || afterStat.ino !== fileStat.ino
        || afterStat.nlink !== 1 || afterStat.size !== bytes.length
        || afterStat.uid !== fileStat.uid
        || (afterStat.mode & 0o777) !== (fileStat.mode & 0o777)
        || (requirePrivate && (afterStat.uid !== process.geteuid()
          || (afterStat.mode & 0o777) !== 0o600))) {
        errors.push(`${label} changed identity while reading: ${relativePath}`);
        return null;
      }
      await assertAbsoluteParentIdentity(parentCapture, label);
      const finalPathStat = await lstat(absolutePath);
      if (finalPathStat.isSymbolicLink() || !finalPathStat.isFile()
        || finalPathStat.nlink !== 1 || finalPathStat.dev !== fileStat.dev
        || finalPathStat.ino !== fileStat.ino
        || (requirePrivate && (finalPathStat.uid !== process.geteuid()
          || (finalPathStat.mode & 0o777) !== 0o600))) {
        errors.push(`${label} changed path identity while reading: ${relativePath}`);
        return null;
      }
      return captureIdentity
        ? { bytes, dev: fileStat.dev, ino: fileStat.ino }
        : bytes;
    } finally {
      await handle.close();
    }
  } catch {
    errors.push(`${label} does not exist or changed identity: ${relativePath}`);
    return null;
  }
}

async function readFrozenAbsoluteFile(
  absolutePath,
  label,
  errors,
  requirePrivate = false,
  captureIdentity = false,
) {
  if (!path.isAbsolute(absolutePath)) {
    errors.push(`${label} path must be absolute`);
    return null;
  }
  try {
    const parentCapture = await captureAbsoluteParentIdentity(absolutePath, label);
    const pathStat = await lstat(absolutePath);
    if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
      errors.push(`${label} must be a regular non-symlink file`);
      return null;
    }
    if (pathStat.nlink !== 1) {
      errors.push(`${label} must have exactly one hard link`);
      return null;
    }
    if (requirePrivate && (pathStat.uid !== process.geteuid()
      || (pathStat.mode & 0o777) !== 0o600)) {
      errors.push(`${label} must be owned by the effective user with mode 0600`);
      return null;
    }
    const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const fileStat = await handle.stat();
      if (!fileStat.isFile() || fileStat.nlink !== 1
        || fileStat.dev !== pathStat.dev || fileStat.ino !== pathStat.ino) {
        errors.push(`${label} changed identity while opening`);
        return null;
      }
      const bytes = await handle.readFile();
      const afterStat = await handle.stat();
      if (afterStat.dev !== fileStat.dev || afterStat.ino !== fileStat.ino
        || afterStat.nlink !== 1 || afterStat.size !== bytes.length
        || afterStat.uid !== fileStat.uid
        || (afterStat.mode & 0o777) !== (fileStat.mode & 0o777)
        || (requirePrivate && (afterStat.uid !== process.geteuid()
          || (afterStat.mode & 0o777) !== 0o600))) {
        errors.push(`${label} changed identity while reading`);
        return null;
      }
      await assertAbsoluteParentIdentity(parentCapture, label);
      const finalPathStat = await lstat(absolutePath);
      if (finalPathStat.isSymbolicLink() || !finalPathStat.isFile()
        || finalPathStat.nlink !== 1 || finalPathStat.dev !== fileStat.dev
        || finalPathStat.ino !== fileStat.ino
        || (requirePrivate && (finalPathStat.uid !== process.geteuid()
          || (finalPathStat.mode & 0o777) !== 0o600))) {
        errors.push(`${label} changed path identity while reading`);
        return null;
      }
      return captureIdentity
        ? { bytes, dev: fileStat.dev, ino: fileStat.ino }
        : bytes;
    } finally {
      await handle.close();
    }
  } catch {
    errors.push(`${label} does not exist or changed identity`);
    return null;
  }
}

async function captureAbsoluteParentIdentity(absolutePath, label) {
  const parentPath = path.dirname(absolutePath);
  const parsed = path.parse(parentPath);
  const segments = parentPath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let cursor = parsed.root;
  const entries = [];
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    const entry = await lstat(cursor);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`${label} parent must be a real directory`);
    }
    entries.push({ path: cursor, dev: entry.dev, ino: entry.ino });
  }
  return { entries, parentPath };
}

async function assertAbsoluteParentIdentity(capture, label) {
  for (const expected of capture.entries) {
    const entry = await lstat(expected.path);
    if (entry.isSymbolicLink() || !entry.isDirectory()
      || entry.dev !== expected.dev || entry.ino !== expected.ino) {
      throw new Error(`${label} parent directory identity changed`);
    }
  }
}

async function readOptionalRepositoryBytes(root, relativePath, label) {
  try {
    await lstat(path.join(root, relativePath));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const errors = [];
  const bytes = await readFrozenRepositoryFile(root, relativePath, label, errors);
  if (!bytes || errors.length > 0) {
    throw new Error(errors.join("; ") || `${label} could not be read securely`);
  }
  return bytes;
}

async function readOptionalAbsoluteBytes(absolutePath, label) {
  try {
    await lstat(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const errors = [];
  const bytes = await readFrozenAbsoluteFile(absolutePath, label, errors);
  if (!bytes || errors.length > 0) {
    throw new Error(errors.join("; ") || `${label} could not be read securely`);
  }
  return bytes;
}

async function assertRepositoryBytes(root, relativePath, expectedBytes, label) {
  const current = await readOptionalRepositoryBytes(root, relativePath, label);
  if (!current?.equals(expectedBytes)) throw new Error(`${label} byte drift`);
}

async function assertAbsoluteBytes(absolutePath, expectedBytes, label) {
  const current = await readOptionalAbsoluteBytes(absolutePath, label);
  if (!current?.equals(expectedBytes)) throw new Error(`${label} byte drift`);
}

async function assertAbsoluteBytesAtCanonicalOrTombstone(
  absolutePath,
  expectedBytes,
  label,
) {
  const current = await readOptionalAbsoluteBytes(absolutePath, label);
  const tombstonePath = `${absolutePath}.remove.tombstone`;
  const tombstone = await readOptionalAbsoluteBytes(tombstonePath, `${label} removal tombstone`);
  const markerPaths = await listAbsoluteCompletedMarkerPaths(
    tombstonePath,
    sha256Bytes(expectedBytes),
  );
  const markerBytes = await Promise.all(markerPaths.map((markerPath) =>
    readOptionalAbsoluteBytes(markerPath, `${label} completed marker`)
  ));
  const locations = [current, tombstone, ...markerBytes].filter(
    (bytes) => bytes !== null,
  );
  if (locations.length !== 1) {
    throw new Error(`${label} must exist at exactly one recoverable location`);
  }
  if (!locations[0]?.equals(expectedBytes)) {
    throw new Error(`${label} byte drift`);
  }
}

async function listAbsoluteCompletedMarkerPaths(absolutePath, expectedDigest) {
  const basename = path.basename(absolutePath);
  const prefix = expectedDigest
    ? `${basename}.completed-${expectedDigest.slice("sha256:".length)}-`
    : `${basename}.completed-`;
  return (await readdir(path.dirname(absolutePath)))
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith(".marker"))
    .sort()
    .map((entry) => path.join(path.dirname(absolutePath), entry));
}

function completedMarkerCaptureMatches(markerPath, markerBasePath, capture) {
  const markerName = path.basename(markerPath);
  const prefix = `${path.basename(markerBasePath)}.completed-`;
  if (!markerName.startsWith(prefix) || !markerName.endsWith(".marker")) return false;
  const identity = markerName.slice(prefix.length, -".marker".length).split("-");
  return identity.length === 3
    && identity[0] === sha256Bytes(capture.bytes).slice("sha256:".length)
    && identity[1] === `${capture.dev}`
    && identity[2] === `${capture.ino}`;
}

async function convergeRepositoryPublication({
  root,
  relativePath,
  originalDigest,
  targetBytes,
  label,
}) {
  const current = await readOptionalRepositoryBytes(root, relativePath, label);
  const targetDigest = sha256Bytes(targetBytes);
  if ((current === null && originalDigest !== null)
    || (current !== null && sha256Bytes(current) !== originalDigest
      && sha256Bytes(current) !== targetDigest)) {
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

async function convergeAbsolutePublication({
  absolutePath,
  originalDigest,
  targetBytes,
  label,
}) {
  const current = await readOptionalAbsoluteBytes(absolutePath, label);
  const targetDigest = sha256Bytes(targetBytes);
  if ((current === null && originalDigest !== null)
    || (current !== null && sha256Bytes(current) !== originalDigest
      && sha256Bytes(current) !== targetDigest)) {
    throw new Error(`${label} is neither the recorded original nor target bytes`);
  }
  await atomicPublishAbsoluteFile({
    absolutePath,
    originalDigest: originalDigest ?? "absent",
    replacementBytes: targetBytes,
    label,
  });
}

async function atomicPublishRepositoryFile({
  root,
  relativePath,
  originalDigest,
  replacementBytes,
  label,
}) {
  if (!repositoryPath(relativePath)) {
    throw new Error(`${label} path must be repository-relative`);
  }
  await atomicPublishAbsoluteFile({
    absolutePath: path.join(root, relativePath),
    originalDigest,
    replacementBytes,
    label,
  });
}

async function atomicPublishAbsoluteFile({
  absolutePath,
  originalDigest,
  replacementBytes,
  label,
}) {
  const anchored = await openAnchoredAbsoluteParent(absolutePath, label);
  try {
    const target = path.basename(absolutePath);
    const replacementDigest = sha256Bytes(replacementBytes);
    const temp = `${target}.atomic-${replacementDigest.slice("sha256:".length, 31)}.tmp`;
    await maybeSwapAbsoluteParentForTest(
      anchored.capture.parentPath,
      label,
      "ZEROX_CD03_RUNNER_TEST_PARENT_SWAP",
      "externally attested manifest publication",
    );
    const fault = selectRunnerBridgeFault(label, "replace");
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
    await assertAbsoluteParentIdentity(anchored.capture, label);
    await assertAbsoluteBytes(absolutePath, replacementBytes, label);
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
  if (!repositoryPath(relativePath)) {
    throw new Error(`${label} path must be repository-relative`);
  }
  await atomicRetireAbsoluteFile(
    path.join(root, relativePath),
    expectedBytes,
    label,
  );
}

async function atomicRetireAbsoluteFile(absolutePath, expectedBytes, label) {
  const anchored = await openAnchoredAbsoluteParent(absolutePath, label);
  try {
    await maybeSwapAbsoluteParentForTest(
      anchored.capture.parentPath,
      label,
      "ZEROX_CD03_RUNNER_TEST_REMOVE_PARENT_SWAP",
      "completed external publication transaction",
    );
    await runAnchoredFilesystemBridge({
      operation: "retire",
      directoryHandle: anchored.handle,
      directoryStat: anchored.stat,
      target: path.basename(absolutePath),
      temp: "-",
      originalDigest: sha256Bytes(expectedBytes),
      replacementDigest: "-",
      replacementBytes: Buffer.alloc(0),
      fault: selectRunnerBridgeFault(label, "unlink"),
      label,
    });
    await assertDirectoryHandleIdentity(anchored, label);
    await assertAbsoluteParentIdentity(anchored.capture, label);
  } finally {
    await anchored.handle.close();
  }
}

async function openAnchoredAbsoluteParent(absolutePath, label) {
  if (!path.isAbsolute(absolutePath)) {
    throw new Error(`${label} path must be absolute`);
  }
  if (!["darwin", "linux"].includes(process.platform)
    || !Number.isInteger(constants.O_DIRECTORY)
    || !Number.isInteger(constants.O_NOFOLLOW)) {
    throw new Error(`${label} descriptor-anchored filesystem primitive is unavailable`);
  }
  const capture = await captureAbsoluteParentIdentity(absolutePath, label);
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
        `injected external publication fault: ${process.env.ZEROX_CD03_RUNNER_TEST_FAULT}`,
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
  if (operation === "replace" && result.target?.digest !== replacementDigest) {
    throw new Error(`${label} descriptor-anchored replacement digest is stale`);
  }
}

function selectRunnerBridgeFault(label, operation) {
  const requested = process.env.ZEROX_CD03_RUNNER_TEST_FAULT;
  if (requested === "partial-manifest-write"
    && label === "externally attested manifest publication") {
    return "partial-write";
  }
  const scope = new Map([
    ["external publication transaction", "transaction"],
    ["external attestation publication", "attestation"],
    ["externally attested manifest publication", "manifest"],
    ["external anchor publication", "anchor"],
    ["completed external publication transaction", "transaction-unlink"],
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

async function maybeSwapAbsoluteParentForTest(
  parentPath,
  label,
  envName,
  expectedLabel,
) {
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

async function readNoFollowFile(absolutePath, label) {
  const entry = await lstat(absolutePath);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) {
    throw new Error(`${label} must be an invoked regular file, not a symbolic link`);
  }
  const parentCapture = await captureAbsoluteParentIdentity(absolutePath, label);
  const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const handleStat = await handle.stat();
    if (handleStat.dev !== entry.dev || handleStat.ino !== entry.ino
      || handleStat.nlink !== 1) {
      throw new Error(`${label} changed identity while opening`);
    }
    const bytes = await handle.readFile();
    await assertAbsoluteParentIdentity(parentCapture, label);
    return bytes;
  } finally {
    await handle.close();
  }
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite canonical number");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  throw new TypeError(`unsupported canonical JSON type: ${typeof value}`);
}

function hashCanonical(value) {
  return sha256Bytes(canonicalJson(value));
}

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sha256Digest(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function repositoryPath(value) {
  if (typeof value !== "string" || !value.trim() || path.isAbsolute(value)
    || value.includes("\\")) return false;
  const normalized = path.posix.normalize(value);
  return normalized !== "." && normalized !== ".." && !normalized.startsWith("../")
    && normalized === value;
}

function validateSharedIdentity(value, subject, errors) {
  if (!nonEmpty(value.programId) || value.workstreamId !== "CD03"
    || !nonEmpty(value.featureId) || !Number.isInteger(value.round)
    || value.round <= 0) {
    errors.push(`${subject} program/workstream/feature/round identity is invalid`);
  }
}

function exactKeys(value, keys) {
  return sameOrderedStrings(Object.keys(value).sort(), keys.slice().sort());
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isoTimestamp(value) {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function sameOrderedStrings(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sameStringSet(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && new Set(left).size === left.length
    && new Set(right).size === right.length
    && left.every((value) => right.includes(value));
}

function requireEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(message);
}

function pathIsWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative));
}
