import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const runnerPath = path.join(
  process.cwd(),
  "scripts/verify-conversation-disclosure-continuation-v12.mjs",
);
const source = readFileSync(runnerPath, "utf8");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((entry) =>
    rm(entry, { recursive: true, force: true })));
});

describe("conversation disclosure continuation runner v12", () => {
  test("is self-contained and rejects unpinned execution", async () => {
    expect(source).not.toMatch(/from ["']\.\//);
    await expect(execFileAsync(process.execPath, [runnerPath], {
      env: { PATH: process.env.PATH },
    })).rejects.toMatchObject({
      stderr: expect.stringContaining("missing required runner v12 option"),
    });
  });

  test("uses one forward-only transaction path for fresh, recovery, and replay", () => {
    expect(source).toContain("convergePreparedTransaction(fresh");
    expect(source).toContain("convergePreparedTransaction(prepared");
    expect(source).toContain("convergePreparedTransaction(completedJournal");
    expect(source).not.toContain("rollback");
    expect(source).toContain("completedMarkerPathFor");
  });

  test("rejects preload state and binds V12 assurance fields", () => {
    expect(source).toContain("rejectPreloadEnvironment()");
    expect(source).toContain("ZEROX_CD03A_RUNNER_V12_TEST_FAULT");
    expect(source).toContain('identityAssurance: "not-signed"');
    expect(source).toContain(
      'reviewAssurance: "caller-attested-not-signed"',
    );
    expect(source).toContain("callerDispatchSet: manifest.callerDispatchSet");
    expect(source).not.toContain("platform-signed");
    expect(source).not.toContain("cryptographically-proven-independent");
  });

  test("hard-roots all six classes and the rejected Round11 subject", () => {
    expect(source).toContain('"rejected_output_absent"');
    expect(source).toContain("ROUND11_POLICY_ROOT");
    expect(source).toContain("ROUND11_SNAPSHOT_ROOT");
    expect(source).toContain("ROUND11_RECEIPT_ROOTS");
    expect(source).toContain("ROUND11_FINDING_SET_DIGEST");
  });

  test("uses V12 round constants and atomic no-replace for absent publications", () => {
    expect(source).toContain("policy.round !== 12");
    expect(source).toContain("snapshot.round !== 12");
    expect(source).toContain("manifest.round !== 12");
    expect(source).toContain("archive.round !== 12");
    expect(source).toContain("rejection.rejectedRound !== 11");
    expect(source).toContain("receipt.round !== 12");
    expect(source).toContain("def atomic_noreplace(source, destination):");
    expect(source).toContain("atomic_noreplace(temp, target)");
    expect(source).not.toContain(
      'if original == "absent":\n    os.rename(temp, target',
    );
    expect(source).toContain("atomic_exchange(temp, target)");
    expect(source).toContain("target original identity is stale");
    expect(source).toContain("finalizePreparedJournal(");
    expect(source).toContain(
      "completed marker inode does not match its filename binding",
    );
    expect(source).toContain("candidateResults");
    expect(source).toContain(
      "canonicalJson(anchor.candidateResults)",
    );
  });

  test("recovers only the exact two-link journal and marker inode", () => {
    expect(source).toContain("allowedLinkCounts: [1, 2]");
    expect(source).toContain(
      "journal/marker recovery pair is not one exact two-link inode",
    );
    expect(source).toContain(
      "prepared journal has an unpaired multi-link state",
    );
    expect(source).toContain(
      "await finalizePreparedJournal(\n      options.journalOutput,\n      existingMarker.absolutePath",
    );
    expect(source).not.toContain("retireExactFile");
  });

  test("enforces journal-recorded publication parent identity", () => {
    expect(source).toContain(
      "expectedParentIdentityDigest: publication.parentIdentityDigest",
    );
    expect(source).toContain(
      "parent identity differs from the prepared journal",
    );
    expect(source).toContain(
      "assertParentIdentityDigest(parent.capture, expectedParentIdentityDigest",
    );
  });

  test("pins Node identity before and after every candidate", () => {
    for (const field of [
      "nodeExecDev",
      "nodeExecIno",
      "nodeExecMode",
      "nodeExecNlink",
      "nodeExecUid",
    ]) {
      expect(source).toContain(field);
    }
    expect(source).toContain(
      'await assertNodeExecutableIdentity("candidate Node preflight")',
    );
    expect(source).toContain(
      'await assertNodeExecutableIdentity("candidate Node postflight")',
    );
    expect(source).toContain(
      'await assertNodeExecutableIdentity("failed candidate Node postflight")',
    );
    expect(source).toContain(
      "execFile(nodeExecRealpath, [scriptPath, ...args]",
    );
  });

  test("converges the real two-link journal and marker crash state", async () => {
    const root = await createPrivateRoot("zerox-v12-two-link-");
    const journal = path.join(root, "continuation.journal.json");
    const bytes = Buffer.from('{"status":"prepared"}\n');
    await writeFile(journal, bytes, { mode: 0o600 });
    const journalStat = await stat(journal);
    const journalDigest = digest("a");
    const marker = `${journal}.completed-${journalDigest.slice(7)}-${
      journalStat.dev
    }-${journalStat.ino}.marker`;
    await link(journal, marker);

    const selfTest = await writeSelfTestRunner(root, `
const options = { journalOutput: process.argv[2] };
const repositoryRealpath = await realpath(process.argv[3]);
const selfCapture = await captureAbsoluteFile(SELF_PATH, "self-test runner");
const nodeExecRealpath = await realpath(process.execPath);
const nodeCapture = await captureAbsoluteFile(nodeExecRealpath, "self-test Node");
const journalCapture = await captureAbsoluteFile(
  options.journalOutput,
  "self-test journal",
  { requirePrivate: true, allowedLinkCounts: [1, 2] },
);
const markerCapture = await captureAbsoluteFile(
  process.argv[4],
  "self-test marker",
  { requirePrivate: true, allowedLinkCounts: [1, 2] },
);
const journal = { digest: process.argv[5] };
validateCompletedMarkerIdentity(
  { ...markerCapture, absolutePath: process.argv[4] },
  journal,
  journalCapture,
);
await finalizePreparedJournal(
  options.journalOutput,
  process.argv[4],
  journalCapture,
  journalCapture.bytes,
);
const completed = await captureAbsoluteFile(
  process.argv[4],
  "self-test completed marker",
  { requirePrivate: true },
);
console.log(JSON.stringify({ nlink: completed.nlink }));
`);

    const result = await execFileAsync(process.execPath, [
      selfTest,
      journal,
      root,
      marker,
      journalDigest,
    ], {
      env: cleanNodeEnvironment(),
      encoding: "utf8",
    });
    expect(JSON.parse(result.stdout)).toEqual({ nlink: 1 });
    await expect(pathExists(journal)).resolves.toBe(false);
    expect((await stat(marker)).nlink).toBe(1);
    expect(await readFile(marker)).toEqual(bytes);
  });

  test("rejects a publication after its recorded parent is replaced", async () => {
    const root = await createPrivateRoot("zerox-v12-parent-");
    const publicationParent = path.join(root, "publication");
    const displacedParent = path.join(root, "publication.displaced");
    const target = path.join(publicationParent, "attestation.json");
    await mkdir(publicationParent, { mode: 0o700 });
    const expectedParentDigest = await parentIdentityDigest(target);
    await rename(publicationParent, displacedParent);
    await mkdir(publicationParent, { mode: 0o700 });
    const selfTest = await writeSelfTestRunner(root, `
const options = {};
const repositoryRealpath = await realpath(process.argv[2]);
const selfCapture = await captureAbsoluteFile(SELF_PATH, "self-test runner");
const nodeExecRealpath = await realpath(process.execPath);
const nodeCapture = await captureAbsoluteFile(nodeExecRealpath, "self-test Node");
await convergeAbsoluteFile({
  absolutePath: process.argv[3],
  original: null,
  targetBytes: Buffer.from("reviewed bytes\\n"),
  targetMode: 0o600,
  label: "self-test publication",
  expectedParentIdentityDigest: process.argv[4],
});
`);

    await expect(execFileAsync(process.execPath, [
      selfTest,
      root,
      target,
      expectedParentDigest,
    ], {
      env: cleanNodeEnvironment(),
      encoding: "utf8",
    })).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "parent identity differs from the prepared journal",
      ),
    });
    await expect(pathExists(target)).resolves.toBe(false);
  });

  test("rejects a Node executable swapped by the candidate before postflight", async () => {
    const root = await createPrivateRoot("zerox-v12-node-");
    const nodeCopy = path.join(root, "node");
    const candidate = path.join(root, "candidate.mjs");
    const childHome = path.join(root, "home");
    const childTmp = path.join(root, "tmp");
    await copyFile(process.execPath, nodeCopy);
    await chmod(nodeCopy, 0o755);
    await mkdir(childHome, { mode: 0o700 });
    await mkdir(childTmp, { mode: 0o700 });
    await writeFile(candidate, `
import { chmodSync, renameSync, writeFileSync } from "node:fs";
renameSync(process.execPath, process.execPath + ".original");
writeFileSync(process.execPath, "replaced executable\\n");
chmodSync(process.execPath, 0o755);
`);
    const selfTest = await writeSelfTestRunner(root, `
const options = { timeoutMs: 10_000 };
const repositoryRealpath = await realpath(process.argv[2]);
const selfCapture = await captureAbsoluteFile(SELF_PATH, "self-test runner");
const nodeExecRealpath = await realpath(process.execPath);
const nodeCapture = await captureAbsoluteFile(nodeExecRealpath, "self-test Node");
await runNodeCandidate(
  process.argv[3],
  [],
  process.argv[2],
  process.argv[4],
  process.argv[5],
);
`);

    await expect(execFileAsync(nodeCopy, [
      selfTest,
      root,
      candidate,
      childHome,
      childTmp,
    ], {
      env: cleanNodeEnvironment(),
      encoding: "utf8",
      timeout: 30_000,
    })).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Node postflight identity differs from the caller-pinned startup capture",
      ),
    });
    await expect(pathExists(`${nodeCopy}.original`)).resolves.toBe(true);
  });
});

async function createPrivateRoot(prefix: string) {
  const created = await mkdtemp(path.join(os.tmpdir(), prefix));
  const root = await realpath(created);
  temporaryRoots.push(root);
  await chmod(root, 0o700);
  return root;
}

async function writeSelfTestRunner(root: string, bootstrap: string) {
  const start = source.indexOf("rejectPreloadEnvironment();");
  const end = source.indexOf("async function buildFreshTransaction()");
  if (start < 0 || end <= start) {
    throw new Error("runner entrypoint boundaries are unavailable");
  }
  const selfTestPath = path.join(root, "runner-self-test.mjs");
  await writeFile(
    selfTestPath,
    `${source.slice(0, start)}rejectPreloadEnvironment();\n${bootstrap}\n${
      source.slice(end)
    }`,
    { mode: 0o600 },
  );
  return selfTestPath;
}

async function parentIdentityDigest(absolutePath: string) {
  const parentPath = path.dirname(absolutePath);
  const parsed = path.parse(parentPath);
  const segments = parentPath
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean);
  let cursor = parsed.root;
  const entries = [];
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    const entry = await lstat(cursor);
    entries.push({ path: cursor, dev: entry.dev, ino: entry.ino });
  }
  return hashCanonical(entries);
}

async function pathExists(absolutePath: string) {
  try {
    await lstat(absolutePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function cleanNodeEnvironment() {
  const env = { ...process.env } as Record<string, string>;
  for (const key of ["NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD"]) delete env[key];
  for (const key of Object.keys(env)) {
    if (key.startsWith("DYLD_")) delete env[key];
  }
  return env;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashCanonical(value: unknown) {
  return `sha256:${
    createHash("sha256").update(canonicalJson(value)).digest("hex")
  }`;
}

function digest(character: string) {
  return `sha256:${character.repeat(64)}`;
}
