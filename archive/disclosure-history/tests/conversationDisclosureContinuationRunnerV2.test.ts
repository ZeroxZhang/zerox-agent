import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const runnerSource = path.join(
  repositoryRoot,
  "scripts/verify-conversation-disclosure-continuation-v2.mjs",
);
const policyPath =
  ".zerox/verification/conversation-disclosure/CD03A-round2-successor-evolution-policy.json";
const snapshotPath =
  ".zerox/verification/conversation-disclosure/CD03A-round2-review-snapshot.json";
const archivePath =
  ".zerox/verification/conversation-disclosure/CD03A-round2-baseline-archive.json";
const manifestPath =
  ".zerox/verification/conversation-disclosure/CD03A-round2-closure-manifest.json";
const checkerPath = "scripts/check-conversation-disclosure-continuation-v2.mjs";
const runnerRepoPath = "scripts/verify-conversation-disclosure-continuation-v2.mjs";
const attestationPath =
  ".zerox/verification/conversation-disclosure/CD03A-round2-external-attestation.json";
const lanes = ["contract", "runtime", "governance"] as const;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe("CD03A external continuation runner v2", () => {
  it("requires the caller to pin the exact external runner bytes", async () => {
    const fixture = await createFixture();
    const args = replaceOption(
      fixture.args,
      "--expected-runner-digest",
      digest("f"),
    );

    await expect(runRunner(fixture, { args })).rejects.toContain(
      "external runner digest does not match the caller pin",
    );
    await expect(pathExists(fixture.journal)).resolves.toBe(false);
    await expect(readLiveDigests(fixture)).resolves.toEqual(fixture.originalDigests);
  });

  it("leaves repository and publication outputs untouched when a candidate fails before journal", async () => {
    const fixture = await createFixture({ checkerFails: true });
    const repositoryIdentity = await stat(fixture.repo);

    await expect(runRunner(fixture)).rejects.toContain("candidate process failed");
    expect((await stat(fixture.repo)).ino).toBe(repositoryIdentity.ino);
    await expect(readLiveDigests(fixture)).resolves.toEqual(fixture.originalDigests);
    await expect(pathExists(fixture.journal)).resolves.toBe(false);
    await expect(pathExists(fixture.anchorOutput)).resolves.toBe(false);
    await expect(pathExists(path.join(fixture.repo, attestationPath))).resolves.toBe(false);
    await expect(pathExists(fixture.externalRoot)).resolves.toBe(true);
  });

  it("resumes a partial governance-transition write from the prepared journal", async () => {
    const fixture = await createFixture();

    await expect(runRunner(fixture, { fault: "partial-transition-2" }))
      .rejects.toContain("did not converge to target bytes");
    await expect(pathExists(fixture.journal)).resolves.toBe(true);
    expect(await sha256File(path.join(fixture.repo, fixture.transitions[0]!.path)))
      .toBe(fixture.transitions[0]!.toSha256);

    const receipt = await runRunner(fixture);

    expect(receipt).toContain('"status":"passed"');
    expect(receipt).toContain('"recovered":true');
    await expect(readLiveDigests(fixture)).resolves.toEqual(fixture.targetDigests);
    await expect(pathExists(fixture.journal)).resolves.toBe(false);
    expect(await completedMarkers(fixture)).toHaveLength(1);
  });

  it("forward-recovers a crash after attestation publication", async () => {
    const fixture = await createFixture();

    await expect(runRunner(fixture, { fault: "after-attestation" }))
      .rejects.toContain("injected runner v2 fault: after-attestation");
    await expect(pathExists(path.join(fixture.repo, attestationPath))).resolves.toBe(true);
    await expect(pathExists(fixture.anchorOutput)).resolves.toBe(false);

    await expect(runRunner(fixture)).resolves.toContain('"recovered":true');
    await expect(pathExists(fixture.anchorOutput)).resolves.toBe(true);
    await expect(pathExists(fixture.journal)).resolves.toBe(false);
    expect(await completedMarkers(fixture)).toHaveLength(1);
  });

  it("fails closed on third-state live bytes during recovery", async () => {
    const fixture = await createFixture();

    await expect(runRunner(fixture, { fault: "after-transition-1" }))
      .rejects.toContain("injected runner v2 fault: after-transition-1");
    const second = fixture.transitions[1]!;
    await writeFile(path.join(fixture.repo, second.path), "unreviewed third bytes\n");

    await expect(runRunner(fixture)).rejects.toContain("contains third-state bytes");
    expect(await readFile(path.join(fixture.repo, second.path), "utf8"))
      .toBe("unreviewed third bytes\n");
    await expect(pathExists(fixture.anchorOutput)).resolves.toBe(false);
    await expect(pathExists(fixture.journal)).resolves.toBe(true);
  });

  it("rejects preload and loader environment injection before any file capture or write", async () => {
    const fixture = await createFixture();

    await expect(runRunner(fixture, { extraEnv: { NODE_PATH: "/tmp/forbidden" } }))
      .rejects.toContain("preload, loader, require, import, inspect, and eval injection");
    await expect(pathExists(fixture.journal)).resolves.toBe(false);
    await expect(readLiveDigests(fixture)).resolves.toEqual(fixture.originalDigests);
  });

  it("rejects review snapshot schema drift that omits reviewOutputAbsentPaths", async () => {
    const fixture = await createFixture({ omitReviewOutputAbsentPaths: true });

    await expect(runRunner(fixture)).rejects.toContain(
      "continuation review snapshot binding is stale",
    );
    await expect(pathExists(fixture.journal)).resolves.toBe(false);
    await expect(readLiveDigests(fixture)).resolves.toEqual(fixture.originalDigests);
  });

  it("rejects a preplanted review output whose role is not recognized", async () => {
    const fixture = await createFixture({ preplantUnknownReviewOutput: true });

    await expect(runRunner(fixture)).rejects.toContain(
      "snapshot contains an unknown review output role",
    );
    await expect(pathExists(fixture.journal)).resolves.toBe(false);
    await expect(readLiveDigests(fixture)).resolves.toEqual(fixture.originalDigests);
  });

  it("rejects non-transaction control drift after the prepared journal is durable", async () => {
    const fixture = await createFixture();

    await expect(runRunner(fixture, { fault: "after-journal" }))
      .rejects.toContain("injected runner v2 fault: after-journal");
    await writeFile(
      path.join(fixture.repo, "control/existing.txt"),
      "unreviewed control mutation\n",
    );

    await expect(runRunner(fixture)).rejects.toContain(
      "non-transaction control drift: control/existing.txt",
    );
    await expect(pathExists(fixture.anchorOutput)).resolves.toBe(false);
    await expect(pathExists(fixture.journal)).resolves.toBe(true);
  });

  it("rejects non-transaction mode, addition, and deletion drift after prepare", async () => {
    const cases = [
      {
        name: "mode",
        mutate: async (fixture: Fixture) => chmod(
          path.join(fixture.repo, "control/existing.txt"),
          0o600,
        ),
        expected: "non-transaction control drift: control/existing.txt",
      },
      {
        name: "addition",
        mutate: async (fixture: Fixture) => writeFile(
          path.join(fixture.repo, "control/unreviewed.txt"),
          "unreviewed addition\n",
        ),
        expected: "repository contains an unauthorized added path: control/unreviewed.txt",
      },
      {
        name: "deletion",
        mutate: async (fixture: Fixture) => rm(
          path.join(fixture.repo, "control/existing.txt"),
        ),
        expected: "non-transaction control drift: control/existing.txt",
      },
    ];
    for (const testCase of cases) {
      const fixture = await createFixture();
      await expect(runRunner(fixture, { fault: "after-journal" }), testCase.name)
        .rejects.toContain("injected runner v2 fault: after-journal");
      await testCase.mutate(fixture);
      await expect(runRunner(fixture), testCase.name).rejects.toContain(testCase.expected);
      await expect(pathExists(fixture.anchorOutput), testCase.name).resolves.toBe(false);
    }
  });

  it("rejects a self-consistent preplanted journal whose policy transition payload changed", async () => {
    const fixture = await createFixture();

    await expect(runRunner(fixture, { fault: "after-journal" }))
      .rejects.toContain("injected runner v2 fault: after-journal");
    const journal = JSON.parse(await readFile(fixture.journal, "utf8")) as any;
    const maliciousBytes = Buffer.from("self-consistent malicious target\n");
    journal.governanceTransitions[0].target = {
      sha256: sha256(maliciousBytes),
      mode: journal.governanceTransitions[0].target.mode,
      bytesBase64: maliciousBytes.toString("base64"),
    };
    journal.finalSetDigest = hashCanonical({
      transitions: journal.governanceTransitions.map((entry: any) => [
        entry.path,
        entry.target.sha256,
      ]),
      publications: journal.publications.map((entry: any) => [
        entry.kind,
        entry.target.sha256,
      ]),
    });
    await writeJson(fixture.journal, resign(journal), 0o600);

    await expect(runRunner(fixture)).rejects.toContain(
      "prepared journal policy transition binding is stale: package.json",
    );
    await expect(readLiveDigests(fixture)).resolves.toEqual(fixture.originalDigests);
    await expect(pathExists(fixture.anchorOutput)).resolves.toBe(false);
  });

  it("reruns staged candidates and rejects a resigned candidate-result forgery", async () => {
    const fixture = await createFixture();

    await expect(runRunner(fixture, { fault: "after-journal" }))
      .rejects.toContain("injected runner v2 fault: after-journal");
    const journal = JSON.parse(await readFile(fixture.journal, "utf8")) as any;
    journal.candidateResults[0].stdoutDigest = digest("a");
    await writeJson(fixture.journal, resign(journal), 0o600);

    await expect(runRunner(fixture)).rejects.toContain(
      "prepared journal candidate results do not revalidate",
    );
    await expect(pathExists(fixture.anchorOutput)).resolves.toBe(false);
  });

  it("preserves exact transition modes when the caller umask is 077", async () => {
    const fixture = await createFixture();
    const originalModes = Object.fromEntries(await Promise.all(
      fixture.transitions.map(async (entry) => [
        entry.path,
        (await stat(path.join(fixture.repo, entry.path))).mode & 0o777,
      ]),
    ));
    const previousUmask = process.umask(0o077);
    try {
      await expect(runRunner(fixture)).resolves.toContain('"status":"passed"');
    } finally {
      process.umask(previousUmask);
    }

    const targetModes = Object.fromEntries(await Promise.all(
      fixture.transitions.map(async (entry) => [
        entry.path,
        (await stat(path.join(fixture.repo, entry.path))).mode & 0o777,
      ]),
    ));
    expect(targetModes).toEqual(originalModes);
    expect((await stat(fixture.anchorOutput)).mode & 0o777).toBe(0o600);
  });

  it("forward-recovers a crash after target rename but before directory fsync", async () => {
    const fixture = await createFixture();

    await expect(runRunner(fixture, { fault: "commit-transition-2" }))
      .rejects.toContain("injected runner v2 fault: commit-transition-2");
    await expect(pathExists(fixture.journal)).resolves.toBe(true);

    await expect(runRunner(fixture)).resolves.toContain('"recovered":true');
    await expect(readLiveDigests(fixture)).resolves.toEqual(fixture.targetDigests);
    await expect(pathExists(fixture.journal)).resolves.toBe(false);
    expect(await completedMarkers(fixture)).toHaveLength(1);
  });

  it("revalidates caller sources and the complete control set from a completed marker", async () => {
    const fixture = await createFixture();

    await expect(runRunner(fixture)).resolves.toContain('"recovered":false');
    await expect(runRunner(fixture)).resolves.toContain('"recovered":true');
    await expect(readLiveDigests(fixture)).resolves.toEqual(fixture.targetDigests);
    await expect(pathExists(fixture.journal)).resolves.toBe(false);
    expect(await completedMarkers(fixture)).toHaveLength(1);
  });
});

type Transition = {
  path: string;
  stagedTargetPath: string;
  kind: string;
  fromSha256: string;
  toSha256: string;
};

type Fixture = {
  root: string;
  repo: string;
  externalRoot: string;
  externalRunner: string;
  baseAnchor: string;
  anchorOutput: string;
  journal: string;
  args: string[];
  transitions: Transition[];
  originalDigests: Record<string, string>;
  targetDigests: Record<string, string>;
};

async function createFixture(options: {
  checkerFails?: boolean;
  omitReviewOutputAbsentPaths?: boolean;
  preplantUnknownReviewOutput?: boolean;
} = {}): Promise<Fixture> {
  const createdRoot = await mkdtemp(path.join(os.tmpdir(), "cd03a-runner-v2-test-"));
  const root = await realpath(createdRoot);
  roots.push(root);
  const repo = path.join(root, "repo");
  const externalRoot = path.join(root, "external");
  await mkdir(repo, { recursive: true, mode: 0o700 });
  await mkdir(externalRoot, { mode: 0o700 });

  const externalRunner = path.join(externalRoot, "runner-v2.mjs");
  await copyFile(runnerSource, externalRunner);
  await chmod(externalRunner, 0o600);
  await writeRepoFile(repo, runnerRepoPath, await readFile(runnerSource));
  const runnerDigest = await sha256File(externalRunner);
  const nodeDigest = await sha256File(process.execPath);
  const repositoryRealpath = await pathRealpath(repo);

  const baseAnchor = path.join(externalRoot, "round23-anchor.json");
  const baseSnapshotDigest = digest("1");
  const baseAnchorObject = resign({
    schemaVersion: 1,
    kind: "conversation-disclosure-external-anchor",
    repositoryRealpath,
    snapshotDigest: baseSnapshotDigest,
  });
  await writeJson(baseAnchor, baseAnchorObject, 0o600);

  const checkerSource = options.checkerFails
    ? "process.stderr.write('candidate rejected\\n'); process.exit(9);\n"
    : candidateScript("cd03a-continuation-checker-v2-receipt");
  await writeRepoFile(repo, checkerPath, checkerSource);

  const transitionSources = [
    { path: "package.json", stagedTargetPath: ".targets/package.json", kind: "package-structure-migration", original: "{\"name\":\"before\"}\n", target: "{\"name\":\"after\"}\n" },
    { path: "scripts/check-harness-state.mjs", stagedTargetPath: ".targets/check-harness-state.mjs", kind: "harness-delegation-migration", original: "process.exit(91);\n", target: candidateScript("cd03a-continuation-harness-v2-receipt") },
    { path: "src/shared/conversationDisclosureProgram.test.ts", stagedTargetPath: ".targets/conversationDisclosureProgram.test.ts", kind: "program-test-migration", original: "export const state = 'before';\n", target: "export const state = 'after';\n" },
    { path: "src/shared/packageScripts.test.ts", stagedTargetPath: ".targets/packageScripts.test.ts", kind: "package-test-migration", original: "export const packageState = 'before';\n", target: "export const packageState = 'after';\n" },
  ];
  const transitions: Transition[] = [];
  for (const source of transitionSources) {
    await writeRepoFile(repo, source.path, source.original);
    await writeRepoFile(repo, source.stagedTargetPath, source.target);
    transitions.push({
      path: source.path,
      stagedTargetPath: source.stagedTargetPath,
      kind: source.kind,
      fromSha256: sha256(source.original),
      toSha256: sha256(source.target),
    });
  }
  await writeRepoFile(repo, "control/existing.txt", "reviewed existing bytes\n");

  const archiveEntries = [
    {
      path: "control/existing.txt",
      source: "round23_review_snapshot",
      bytes: Buffer.from("reviewed existing bytes\n"),
    },
    ...transitionSources.map((entry) => ({
      path: entry.path,
      source: "governance_transition",
      bytes: Buffer.from(entry.original),
    })),
  ].sort((left, right) => left.path.localeCompare(right.path)).map((entry) => ({
    path: entry.path,
    source: entry.source,
    sha256: sha256(entry.bytes),
    encoding: "gzip-base64-v1",
    bytes: gzipSync(entry.bytes, { level: 9, mtime: 0 } as any).toString("base64"),
  }));
  const archive = resign({
    schemaVersion: 2,
    kind: "conversation-disclosure-continuation-baseline-archive",
    algorithm: "sha256-canonical-json-v1",
    programId: "fixture-program",
    workstreamId: "CD03A",
    featureId: "P107A-conversation-disclosure-successor-admission",
    round: 2,
    entrySetDigest: hashCanonical(archiveEntries),
    entries: archiveEntries,
  });
  await writeRepoJson(repo, archivePath, archive);

  const checkerDigest = await sha256File(path.join(repo, checkerPath));
  const unknownReviewOutputPath =
    ".zerox/verification/conversation-disclosure/unknown-review-output.json";
  const reviewOutputPaths = [
    snapshotPath,
    ...(options.preplantUnknownReviewOutput ? [unknownReviewOutputPath] : []),
  ].sort();
  if (options.preplantUnknownReviewOutput) {
    await writeRepoFile(repo, unknownReviewOutputPath, "preplanted output\n");
  }
  const policy = resign({
    schemaVersion: 2,
    kind: "conversation-disclosure-continuation-policy",
    algorithm: "sha256-canonical-json-v1",
    policyId: "CD03A-round2-P108-admission-v2",
    programId: "fixture-program",
    workstreamId: "CD03A",
    featureId: "P107A-conversation-disclosure-successor-admission",
    round: 2,
    status: "frozen",
    parentEvidence: {
      externalAnchor: { digest: baseAnchorObject.digest },
      snapshot: { digest: baseSnapshotDigest },
      bundleDigest: digest("2"),
    },
    round1Rejection: createRound1Rejection(),
    admission: { reviewOutputPaths },
    successor: {
      workstreamDefinitionDigest: digest("3"),
      featureDefinitionDigest: digest("4"),
    },
    closedWorld: {},
    pathAuthorities: [{
      path: "control/existing.txt",
      class: "modify",
      baseline: {
        source: "round23_review_snapshot",
        sha256: sha256("reviewed existing bytes\n"),
      },
    }],
    trustRoots: [],
    governanceTransitions: transitions,
    continuationExecutables: [
      { kind: "checker", path: checkerPath, sha256: checkerDigest },
      { kind: "runner", path: runnerRepoPath, sha256: runnerDigest },
    ],
    reviewSnapshot: { path: snapshotPath },
    baselineArchive: {
      path: archivePath,
      digest: archive.digest,
      entrySetDigest: archive.entrySetDigest,
    },
    timePolicy: { futureToleranceMs: 0 },
  });
  await writeRepoJson(repo, policyPath, policy);

  const baselineFiles = archiveEntries.map((entry) => ({
    path: entry.path,
    sha256: entry.sha256,
  }));
  const snapshotDraft: Record<string, unknown> = {
    schemaVersion: 2,
    kind: "conversation-disclosure-continuation-review-snapshot",
    algorithm: "sha256-canonical-json-v1",
    programId: "fixture-program",
    workstreamId: "CD03A",
    featureId: "P107A-conversation-disclosure-successor-admission",
    round: 2,
    frozenAt: "2026-08-24T00:00:00.000Z",
    policyDigest: policy.digest,
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    closedWorldDigest: digest("5"),
    pathAuthorityDigest: digest("6"),
    admissionFeatureDefinitionDigest: digest("7"),
    admissionFeatureFileSetDigest: digest("8"),
    successorWorkstreamDefinitionDigest: policy.successor.workstreamDefinitionDigest,
    successorFeatureDefinitionDigest: policy.successor.featureDefinitionDigest,
    baselineArchive: policy.baselineArchive,
    governanceTransitions: transitions,
    frozenFiles: [
      { path: checkerPath, sha256: checkerDigest },
      { path: runnerRepoPath, sha256: runnerDigest },
    ].sort((left, right) => left.path.localeCompare(right.path)),
    baselineFiles,
    absentPaths: [attestationPath],
    reviewOutputAbsentPaths: reviewOutputPaths,
  };
  if (options.omitReviewOutputAbsentPaths) {
    delete snapshotDraft.reviewOutputAbsentPaths;
  }
  const snapshot = resign(snapshotDraft);
  await writeRepoJson(repo, snapshotPath, snapshot);

  const receiptReferences = [];
  const receiptPins: Array<{ lane: string; digest: string; challenge: string }> = [];
  for (const [index, lane] of lanes.entries()) {
    const receipt = {
      lane,
      verdict: "passed",
      findingCounts: { critical: 0, major: 0, minor: 0 },
      findings: [],
      challenge: digest(String(index + 7)),
      reviewTaskPath: `/root/review_${lane}`,
      reviewAgentId: `agent-${lane}`,
      reviewedPhase: "review_pre_transition",
      policyDigest: policy.digest,
      snapshotDigest: snapshot.digest,
      validatorDigest: checkerDigest,
    };
    const receiptPath = `.zerox/verification/conversation-disclosure/review-${lane}.json`;
    await writeRepoJson(repo, receiptPath, receipt);
    const canonicalDigest = hashCanonical(receipt);
    receiptReferences.push({ lane, path: receiptPath, canonicalDigest, challenge: receipt.challenge });
    receiptPins.push({ lane, digest: canonicalDigest, challenge: receipt.challenge });
  }

  const manifest = resign({
    schemaVersion: 2,
    kind: "conversation-disclosure-continuation-closure-manifest",
    programId: "fixture-program",
    workstreamId: "CD03A",
    featureId: "P107A-conversation-disclosure-successor-admission",
    round: 2,
    status: "review_passed_pending_external_anchor",
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    policy: { path: policyPath, digest: policy.digest },
    snapshot: { path: snapshotPath, digest: snapshot.digest },
    reviewReceipts: receiptReferences,
    validator: { path: checkerPath, sha256: checkerDigest },
    externalRunner: { path: runnerRepoPath, sha256: runnerDigest },
    externalAttestation: { path: attestationPath, canonicalDigest: null },
  });
  await writeRepoJson(repo, manifestPath, manifest, 0o600);

  const anchorOutput = path.join(externalRoot, "round2-anchor.json");
  const journal = `${anchorOutput}.closure-v2.journal.json`;
  const args = [
    "--repo", repo,
    "--expected-repo-realpath", repositoryRealpath,
    "--base-anchor", baseAnchor,
    "--expected-base-anchor-digest", baseAnchorObject.digest,
    "--expected-policy-digest", policy.digest,
    "--expected-snapshot-digest", snapshot.digest,
    "--expected-baseline-archive-digest", archive.digest,
    "--pending-manifest", manifestPath,
    "--expected-pending-manifest-digest", manifest.digest,
    "--expected-runner-digest", runnerDigest,
    "--expected-node-exec-digest", nodeDigest,
    "--external-anchor-output", anchorOutput,
    "--journal-output", journal,
    "--candidate-timeout-ms", "10000",
    ...receiptPins.flatMap((entry) => [
      "--expected-review-receipt", `${entry.lane}=${entry.digest}`,
      "--expected-review-challenge", `${entry.lane}=${entry.challenge}`,
    ]),
    ...transitions.flatMap((entry) => [
      "--transition-target", `${entry.path}=${entry.stagedTargetPath}`,
    ]),
  ];
  return {
    root,
    repo,
    externalRoot,
    externalRunner,
    baseAnchor,
    anchorOutput,
    journal,
    args,
    transitions,
    originalDigests: Object.fromEntries(transitions.map((entry) => [entry.path, entry.fromSha256])),
    targetDigests: Object.fromEntries(transitions.map((entry) => [entry.path, entry.toSha256])),
  };
}

function candidateScript(kind: string) {
  return `const args = process.argv.slice(2);\n`
    + `const get = (name) => args[args.indexOf(name) + 1];\n`
    + `if (get("--mode") !== "review_post_transition" || !get("--control-root") || !get("--subject-repository-realpath")) process.exit(41);\n`
    + `console.log(JSON.stringify({kind:${JSON.stringify(kind)},status:"passed",policyDigest:get("--expected-policy-digest"),snapshotDigest:get("--expected-snapshot-digest"),baselineArchiveDigest:get("--expected-baseline-archive-digest"),mode:get("--mode")}));\n`;
}

async function runRunner(
  fixture: Fixture,
  options: { args?: string[]; fault?: string; extraEnv?: Record<string, string> } = {},
) {
  const env = { ...process.env } as Record<string, string>;
  for (const key of ["NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD"]) delete env[key];
  for (const key of Object.keys(env)) if (key.startsWith("DYLD_")) delete env[key];
  if (options.fault) env.ZEROX_CD03A_RUNNER_V2_TEST_FAULT = options.fault;
  Object.assign(env, options.extraEnv ?? {});
  try {
    const result = await execFileAsync(
      process.execPath,
      [fixture.externalRunner, ...(options.args ?? fixture.args)],
      { cwd: fixture.repo, env, encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    );
    return result.stdout;
  } catch (error) {
    const value = error as { message?: string; stdout?: string; stderr?: string };
    throw [value.message, value.stdout, value.stderr].filter(Boolean).join("\n");
  }
}

function replaceOption(args: string[], option: string, value: string) {
  const copy = [...args];
  const index = copy.indexOf(option);
  copy[index + 1] = value;
  return copy;
}

async function readLiveDigests(fixture: Fixture) {
  return Object.fromEntries(await Promise.all(fixture.transitions.map(async (entry) =>
    [entry.path, await sha256File(path.join(fixture.repo, entry.path))])));
}

async function completedMarkers(fixture: Fixture) {
  const prefix = `${path.basename(fixture.journal)}.completed-`;
  return (await readdir(path.dirname(fixture.journal)))
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith(".marker"));
}

async function writeRepoFile(root: string, relativePath: string, bytes: string | Buffer) {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
}

async function writeRepoJson(
  root: string,
  relativePath: string,
  value: unknown,
  mode = 0o644,
) {
  await writeJson(path.join(root, relativePath), value, mode);
}

async function writeJson(absolutePath: string, value: unknown, mode: number) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await chmod(absolutePath, mode);
}

async function sha256File(absolutePath: string) {
  return sha256(await readFile(absolutePath));
}

function sha256(value: string | Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function digest(character: string) {
  return `sha256:${character.repeat(64)}`;
}

function createRound1Rejection() {
  const trustRoot = {
    policy: {
      byteSha256: "sha256:e1701afcd0f8cf0e43924e6d307520e78eb7ce0e995e19f2ed7a795794fd11cf",
      canonicalDigest: "sha256:e8493e3ad8cb5ce250d6bb7e9d0c9c8cc58fba460bb0f940a25f546a1d18f050",
    },
    snapshot: {
      byteSha256: "sha256:9bf3ae4a69caf816481af725fbf1230769a5247d14112a9991a42a01be779002",
      digest: "sha256:e8f82a943cae4e6c06732936986229a2e85f7783e6b283cf0b6b431b4f1ff7e5",
      fileCount: 19,
    },
    receipts: {
      contract: {
        byteSha256: "sha256:702d8c1ae706f3f48253926a268d3f67e7df0c9665f24914ca87d21e601ecf1e",
        canonicalDigest: "sha256:5062cd1e4482ab2fffedc56d667fc23aaa56a9ef75ea1226fcb1d8d2dc44de25",
        findingCounts: { critical: 1, major: 4, minor: 0 },
      },
      runtime: {
        byteSha256: "sha256:a8f35271528760a90a856c4be6c7491b3cf9b5cccceb583263d855e4f878b847",
        canonicalDigest: "sha256:d5a05396d2c27dc1c9d1d67ddbe9cbd141906cca0f4e9826b8eebb3e8ac4cf87",
        findingCounts: { critical: 2, major: 5, minor: 0 },
      },
      governance: {
        byteSha256: "sha256:c9265b41cdf58101b0683608cfa4d7765d3a3c55f3a7ece0ccf9eccd51175e87",
        canonicalDigest: "sha256:39ad365204a7e2334ad3d030bcf99445404456a1fd8fbf76c68b11d49968a104",
        findingCounts: { critical: 3, major: 9, minor: 0 },
      },
    },
  } as const;
  const lanes = ["contract", "runtime", "governance"] as const;
  const withoutDigest = {
    round: 1,
    status: "rejected",
    policy: {
      path: ".zerox/verification/conversation-disclosure/CD03A-successor-evolution-policy.json",
      ...trustRoot.policy,
    },
    snapshot: {
      path: ".zerox/verification/conversation-disclosure/CD03A-round1-review-snapshot.json",
      ...trustRoot.snapshot,
    },
    receipts: lanes.map((lane) => ({
      lane,
      path: `.zerox/verification/conversation-disclosure/CD03A-round1-${lane}-review.json`,
      verdict: "failed",
      findingCounts: trustRoot.receipts[lane].findingCounts,
      canonicalDigest: trustRoot.receipts[lane].canonicalDigest,
      byteSha256: trustRoot.receipts[lane].byteSha256,
    })),
    forbiddenRepositoryOutputs: [
      ".zerox/verification/conversation-disclosure/CD03A-round1-closure-manifest.json",
      ".zerox/verification/conversation-disclosure/CD03A-round1-external-anchor.json",
      ".zerox/verification/conversation-disclosure/CD03A-round1-external-attestation.json",
    ],
  };
  return { ...withoutDigest, digest: hashCanonical(withoutDigest) };
}

function resign<T extends Record<string, unknown>>(value: T): T & { digest: string } {
  const withoutDigest = { ...value } as Record<string, unknown>;
  delete withoutDigest.digest;
  return { ...withoutDigest, digest: hashCanonical(withoutDigest) } as T & { digest: string };
}

function hashCanonical(value: unknown) {
  return sha256(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function pathExists(absolutePath: string) {
  try { await stat(absolutePath); return true; } catch { return false; }
}

async function pathRealpath(value: string) {
  return realpath(value);
}
