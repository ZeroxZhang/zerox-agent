import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  link,
  mkdir,
  mkdtemp,
  readFile,
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
import { afterEach, describe, expect, it } from "vitest";

type ReviewContractModule = {
  CLOSURE_MANIFEST_KIND: string;
  CLOSURE_STATUS_ATTESTED: string;
  EXTERNAL_ATTESTATION_KIND: string;
  EXTERNAL_ANCHOR_KIND: string;
  REQUIRED_EXTERNAL_RUNNER: string;
  REQUIRED_EXECUTABLE_CLOSURE: Record<"package" | "checker" | "harness", string>;
  REQUIRED_REVIEW_LANES: readonly string[];
  REVIEW_ALGORITHM: string;
  REVIEW_RECEIPT_KIND: string;
  REVIEW_SNAPSHOT_KIND: string;
  hashCanonical(value: unknown): string;
  sha256Bytes(value: string | Buffer): string;
  validateClosureManifest(manifest: unknown, snapshot?: unknown): string[];
  validateExternalAttestation(attestation: unknown, bindings?: unknown): string[];
  validateExternalAnchor(anchor: unknown, bindings?: unknown): string[];
  validateReviewReceipt(receipt: unknown, snapshot?: unknown): string[];
  validateReviewSet(receipts: unknown[], snapshot?: unknown): string[];
  validateReviewSnapshot(snapshot: unknown): string[];
};

// The production contract is intentionally an ESM JavaScript module so it can
// be copied and used by Node-only closure tooling without a build step.
const reviewContract = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-review-contract.mjs"
) as ReviewContractModule;
const {
  CLOSURE_MANIFEST_KIND,
  CLOSURE_STATUS_ATTESTED,
  EXTERNAL_ATTESTATION_KIND,
  EXTERNAL_ANCHOR_KIND,
  REQUIRED_EXTERNAL_RUNNER,
  REQUIRED_EXECUTABLE_CLOSURE,
  REQUIRED_REVIEW_LANES,
  REVIEW_ALGORITHM,
  REVIEW_RECEIPT_KIND,
  REVIEW_SNAPSHOT_KIND,
  hashCanonical,
  sha256Bytes,
  validateClosureManifest,
  validateExternalAttestation,
  validateExternalAnchor,
  validateReviewReceipt,
  validateReviewSet,
  validateReviewSnapshot,
} = reviewContract;

const execFileAsync = promisify(execFile);
const runnerPath = path.join(
  process.cwd(),
  "scripts",
  "verify-conversation-disclosure-closure.mjs",
);
const canonicalControlInputs = {
  program: ".zerox/conversation-disclosure-program.json",
  featureList: ".zerox/feature_list.json",
  artifact: ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json",
};
const harnessControlPaths = [
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
  canonicalControlInputs.program,
  ".zerox/conversation-disclosure-program.md",
  canonicalControlInputs.artifact,
  "docs/superpowers/specs/2026-06-09-harness-engineering-iteration-spec.md",
  "docs/superpowers/plans/2026-06-09-harness-engineering-iteration.md",
];
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("conversation disclosure external closure contract", () => {
  it("enforces exact snapshot, receipt, and closure-manifest schemas", async () => {
    const fixture = await createFixture();
    expect(validateReviewSnapshot({ ...fixture.snapshot, unexpected: true }))
      .toContain("review snapshot must contain the exact v1 keys");

    const missingReceiptKey = structuredClone(fixture.receipts[0]) as Record<string, unknown>;
    delete missingReceiptKey.completedAt;
    expect(validateReviewReceipt(missingReceiptKey, fixture.snapshot))
      .toContain("review receipt must contain the exact v1 keys");

    expect(validateClosureManifest({
      ...fixture.manifest,
      repositoryAttestation: { status: "passed" },
    }, fixture.snapshot)).toContain("closure manifest must contain the exact v1 keys");
  });

  it("publishes one exact unsigned external attestation and transitions the manifest", async () => {
    const fixture = await createFixture();
    expect(validateReviewSnapshot(fixture.snapshot)).toEqual([]);
    expect(validateReviewSet(fixture.receipts, fixture.snapshot)).toEqual([]);
    expect(validateClosureManifest(fixture.manifest, fixture.snapshot)).toEqual([]);

    const output = await runExternalRunner(fixture);
    const attestation = JSON.parse(output.trim()) as {
      digest: string;
      kind: string;
      trustLevel: string;
      subjectIdentityAssurance: string;
      status: string;
      candidateResults: Array<{ kind: string; status: string }>;
    };
    expect(attestation).toMatchObject({
      kind: EXTERNAL_ATTESTATION_KIND,
      trustLevel: "external-anchor-consistency",
      subjectIdentityAssurance: "not-signed",
      status: "passed",
    });
    expect(validateExternalAttestation(attestation)).toEqual([]);
    expect(attestation.candidateResults.map((entry) => [entry.kind, entry.status]))
      .toEqual([["checker", "passed"], ["harness", "passed"]]);
    const persistedAttestation = JSON.parse(
      await readFile(path.join(fixture.root, fixture.attestationPath), "utf8"),
    );
    expect(persistedAttestation).toEqual(attestation);
    const transitionedManifest = JSON.parse(
      await readFile(path.join(fixture.root, fixture.manifestPath), "utf8"),
    );
    expect(transitionedManifest).toMatchObject({
      status: CLOSURE_STATUS_ATTESTED,
      externalAttestation: {
        path: fixture.attestationPath,
        canonicalDigest: attestation.digest,
      },
    });
    expect(validateClosureManifest(transitionedManifest, fixture.snapshot)).toEqual([]);
    expect(validateExternalAttestation(attestation, {
      manifest: transitionedManifest,
      snapshot: fixture.snapshot,
      receipts: fixture.receipts,
      repositoryRealpath: await realpath(fixture.root),
      runnerDigest: fixture.manifest.externalRunner.sha256,
    })).toEqual([]);
    const externalAnchor = JSON.parse(
      await readFile(fixture.externalAnchorOutput, "utf8"),
    );
    expect(externalAnchor).toMatchObject({
      kind: EXTERNAL_ANCHOR_KIND,
      subjectIdentityAssurance: "not-signed",
      attestationDigest: attestation.digest,
    });
    expect(validateExternalAnchor(externalAnchor, {
      attestation,
      snapshot: fixture.snapshot,
      receipts: fixture.receipts,
      repositoryRealpath: await realpath(fixture.root),
      runnerDigest: fixture.manifest.externalRunner.sha256,
    })).toEqual([]);
    await Promise.all([
      lstat(path.join(fixture.root, fixture.attestationPath)),
      lstat(path.join(fixture.root, fixture.manifestPath)),
      lstat(fixture.externalAnchorOutput),
    ]).then((entries) => {
      expect(entries.map((entry) => entry.mode & 0o777)).toEqual([
        0o600,
        0o600,
        0o600,
      ]);
    });
    await expect(lstat(fixture.checkerMarker)).resolves.toBeDefined();
    await expect(lstat(fixture.harnessMarker)).resolves.toBeDefined();
  });

  it("rejects an external completed marker whose filename inode binding is stale", async () => {
    const fixture = await createFixture();
    await runExternalRunner(fixture);
    const markerBase = `${path.basename(fixture.externalAnchorOutput)}.publication-transaction.json.remove.tombstone`;
    const markerDirectory = path.dirname(fixture.externalAnchorOutput);
    const markerName = (await readdir(markerDirectory)).find(
      (entry) => entry.startsWith(`${markerBase}.completed-`),
    )!;
    const staleName = markerName.replace(/-([0-9]+)\.marker$/, (_match, ino) =>
      `-${BigInt(ino) + 1n}.marker`);
    await rename(
      path.join(markerDirectory, markerName),
      path.join(markerDirectory, staleName),
    );

    await expect(runExternalRunner(fixture)).rejects.toContain(
      "external publication transaction completed marker identity/digest is stale",
    );
  });

  it.each([
    ["harness", REQUIRED_EXECUTABLE_CLOSURE.harness],
    ["review contract support", "scripts/conversation-disclosure-review-contract.mjs"],
    ["checker self", REQUIRED_EXECUTABLE_CLOSURE.checker],
    ["program control input", canonicalControlInputs.program],
  ] as const)(
    "rejects a malicious checker that replaces staged %s bytes",
    async (_label, stagedMutationTarget) => {
      const fixture = await createFixture({ stagedMutationTarget });
      await expect(runExternalRunner(fixture)).rejects.toContain(
        `checker post-execution staged trust file byte drift: ${stagedMutationTarget}`,
      );
      await expect(fileExists(fixture.checkerMarker)).resolves.toBe(true);
      await expect(fileExists(fixture.harnessMarker)).resolves.toBe(false);
      await expect(fileExists(path.join(fixture.root, fixture.attestationPath)))
        .resolves.toBe(false);
    },
  );

  it("never shares checker-created stage pollution with the harness stage", async () => {
    const fixture = await createFixture({ checkerCreatesStageSentinel: true });
    await expect(runExternalRunner(fixture)).resolves.toContain(
      EXTERNAL_ATTESTATION_KIND,
    );
    await expect(fileExists(fixture.checkerMarker)).resolves.toBe(true);
    await expect(fileExists(fixture.harnessMarker)).resolves.toBe(true);
  });

  it("executes staged frozen bytes and rejects checker-time candidate TOCTOU drift", async () => {
    const fixture = await createFixture({ checkerMutatesCandidateHarness: true });

    await expect(runExternalRunner(fixture)).rejects.toContain(
      `postflight review snapshot hash drift: ${REQUIRED_EXECUTABLE_CLOSURE.harness}`,
    );
    await expect(fileExists(fixture.checkerMarker)).resolves.toBe(true);
    await expect(fileExists(fixture.harnessMarker)).resolves.toBe(true);
  });

  it("rejects a same-bytes new-inode live completed marker at postflight", async () => {
    const fixture = await createFixture({
      checkerReplacesLiveFreezeMarkerSameBytes: true,
    });
    const before = await lstat(fixture.freezeMarkerPath);
    const expectedBytes = await readFile(fixture.freezeMarkerPath);

    await expect(runExternalRunner(fixture)).rejects.toContain(
      "postflight completed marker inode changed",
    );
    const after = await lstat(fixture.freezeMarkerPath);
    expect(after.ino).not.toBe(before.ino);
    await expect(readFile(fixture.freezeMarkerPath)).resolves.toEqual(expectedBytes);
    await expect(fileExists(path.join(fixture.root, fixture.attestationPath)))
      .resolves.toBe(false);
    await expect(fileExists(fixture.externalAnchorOutput)).resolves.toBe(false);
  });

  it("rejects a zero-exit checker that omits the exact digest-bound receipt", async () => {
    const fixture = await createFixture({ checkerOmitsReceipt: true });

    await expect(runExternalRunner(fixture)).rejects.toContain(
      "checker must emit one exact externally digest-bound JSON receipt",
    );
    await expect(fileExists(fixture.checkerMarker)).resolves.toBe(true);
    await expect(fileExists(fixture.harnessMarker)).resolves.toBe(false);
  });

  it.each([
    ["receipt", "receipt"],
    ["closure manifest", "manifest"],
    ["external snapshot", "snapshot"],
    ["artifact", "artifact"],
    ["program", "program"],
    ["feature list", "featureList"],
  ] as const)(
    "rejects checker-time mutation of the live %s while frozen controls execute",
    async (_label, checkerMutationTarget) => {
      const fixture = await createFixture({ checkerMutationTarget });
      const mutationPath = fixture.mutationPaths[checkerMutationTarget];

      await expect(runExternalRunner(fixture)).rejects.toContain(
        `postflight candidate control input byte drift: ${mutationPath}`,
      );
      await expect(fileExists(fixture.checkerMarker)).resolves.toBe(true);
      await expect(fileExists(fixture.harnessMarker)).resolves.toBe(true);
    },
  );

  it("rejects a changed receipt even after the repository manifest is recomputed", async () => {
    const fixture = await createFixture();
    const changedReceipt = structuredClone(fixture.receipts[0]);
    changedReceipt.reviewAgentId = "forged-agent-id";
    fixture.receipts[0] = changedReceipt;
    await writeJson(fixture.root, fixture.receiptPaths[0], changedReceipt);

    fixture.manifest.reviewReceipts[0].canonicalDigest = hashCanonical(changedReceipt);
    refreshManifestDigest(fixture.manifest);
    await writeJson(fixture.root, fixture.manifestPath, fixture.manifest);

    await expect(runExternalRunner(fixture)).rejects.toContain(
      "review receipt digest does not match the external anchor: contract",
    );
    await expect(fileExists(fixture.checkerMarker)).resolves.toBe(false);
    await expect(fileExists(fixture.harnessMarker)).resolves.toBe(false);
  });

  it("rejects package, checker, and harness replacement before either marker executes", async () => {
    const fixture = await createFixture();
    const oldSnapshotDigest = fixture.externalSnapshotDigest;
    const oldReceiptDigests = new Map(fixture.externalReceiptDigests);

    const packageContent = JSON.stringify({ scripts: { forged: "true" } });
    const checkerContent = markerScript(fixture.checkerMarker, "forged checker executed");
    const harnessContent = markerScript(fixture.harnessMarker, "forged harness executed");
    await Promise.all([
      writeFile(path.join(fixture.root, "package.json"), packageContent, "utf8"),
      writeFile(path.join(fixture.root, REQUIRED_EXECUTABLE_CLOSURE.checker), checkerContent, "utf8"),
      writeFile(path.join(fixture.root, REQUIRED_EXECUTABLE_CLOSURE.harness), harnessContent, "utf8"),
      writeFile(
        path.join(fixture.root, ".zerox", "forged-external-attestation.json"),
        JSON.stringify({ status: "passed", trustLevel: "forged-repository-object" }),
        "utf8",
      ),
    ]);

    const replacementBytes = new Map([
      ["package.json", packageContent],
      [REQUIRED_EXECUTABLE_CLOSURE.checker, checkerContent],
      [REQUIRED_EXECUTABLE_CLOSURE.harness, harnessContent],
    ]);
    for (const entry of fixture.snapshot.files) {
      const replacement = replacementBytes.get(entry.path);
      if (replacement !== undefined) entry.sha256 = sha256Bytes(replacement);
    }
    refreshSnapshotDigest(fixture.snapshot);
    await writeJson(fixture.root, fixture.snapshotPath, fixture.snapshot);

    for (let index = 0; index < fixture.receipts.length; index += 1) {
      const receipt = fixture.receipts[index];
      receipt.snapshotDigest = fixture.snapshot.digest;
      await writeJson(fixture.root, fixture.receiptPaths[index], receipt);
      fixture.manifest.reviewReceipts[index].canonicalDigest = hashCanonical(receipt);
    }
    fixture.manifest.snapshot.digest = fixture.snapshot.digest;
    for (const entry of fixture.manifest.executableClosure) {
      entry.sha256 = sha256Bytes(replacementBytes.get(entry.path) ?? "");
    }
    refreshManifestDigest(fixture.manifest);
    await writeJson(fixture.root, fixture.manifestPath, fixture.manifest);

    await expect(runExternalRunner(fixture, {
      expectedSnapshotDigest: oldSnapshotDigest,
      expectedReceiptDigests: oldReceiptDigests,
    })).rejects.toContain("review snapshot digest does not match the external anchor");
    await expect(fileExists(fixture.checkerMarker)).resolves.toBe(false);
    await expect(fileExists(fixture.harnessMarker)).resolves.toBe(false);
  });

  it("rejects symlinked evidence and traversal before candidate execution", async () => {
    const symlinkFixture = await createFixture();
    const realReceiptPath = ".zerox/reviews/contract-real.json";
    await writeJson(symlinkFixture.root, realReceiptPath, symlinkFixture.receipts[0]);
    await rm(path.join(symlinkFixture.root, symlinkFixture.receiptPaths[0]));
    await symlink(
      "contract-real.json",
      path.join(symlinkFixture.root, symlinkFixture.receiptPaths[0]),
    );
    await expect(runExternalRunner(symlinkFixture)).rejects.toContain(
      "must not contain symbolic links",
    );
    await expect(fileExists(symlinkFixture.checkerMarker)).resolves.toBe(false);

    const traversalFixture = await createFixture();
    traversalFixture.manifest.snapshot.path = "../outside-snapshot.json";
    refreshManifestDigest(traversalFixture.manifest);
    await writeJson(
      traversalFixture.root,
      traversalFixture.manifestPath,
      traversalFixture.manifest,
    );
    await expect(runExternalRunner(traversalFixture)).rejects.toContain(
      "closure manifest snapshot reference is invalid",
    );
    await expect(fileExists(traversalFixture.checkerMarker)).resolves.toBe(false);
  });

  it("does not treat a repository-local attestation as an external anchor", async () => {
    const fixture = await createFixture();
    await writeFile(
      path.join(fixture.root, ".zerox", "external-attestation.json"),
      JSON.stringify({
        status: "passed",
        trustLevel: "external-anchor-consistency",
        expectedReceiptDigests: fixture.externalReceiptDigests,
      }),
      "utf8",
    );
    const wrongReceiptDigests = new Map(fixture.externalReceiptDigests);
    wrongReceiptDigests.set("governance", `sha256:${"f".repeat(64)}`);
    await expect(runExternalRunner(fixture, {
      expectedReceiptDigests: wrongReceiptDigests,
    })).rejects.toContain(
      "review receipt digest does not match the external anchor: governance",
    );
    await expect(fileExists(fixture.checkerMarker)).resolves.toBe(false);
    await expect(fileExists(fixture.harnessMarker)).resolves.toBe(false);
  });

  it.each([
    "after-transaction",
    "after-attestation",
    "before-manifest-commit",
    "partial-manifest-write",
    "after-manifest",
    "after-anchor",
  ])("recovers the exact multi-output publication after %s", async (fault) => {
    const fixture = await createFixture();
    await expect(runExternalRunner(fixture, { fault })).rejects.toContain(
      `injected external publication fault: ${fault}`,
    );

    const manifestDirectory = path.dirname(path.join(fixture.root, fixture.manifestPath));
    const manifestTempPrefix = `${path.basename(fixture.manifestPath)}.atomic-`;
    if (fault === "partial-manifest-write") {
      const partialTemps = (await readdir(manifestDirectory))
        .filter((entry) => entry.startsWith(manifestTempPrefix) && entry.endsWith(".tmp"));
      expect(partialTemps).toHaveLength(1);
      expect((await readFile(path.join(manifestDirectory, partialTemps[0]!))).length)
        .toBeGreaterThan(0);
    }

    const output = await runExternalRunner(fixture);
    const attestation = JSON.parse(output.trim());
    const manifest = JSON.parse(
      await readFile(path.join(fixture.root, fixture.manifestPath), "utf8"),
    );
    const anchor = JSON.parse(await readFile(fixture.externalAnchorOutput, "utf8"));
    expect(manifest.externalAttestation.canonicalDigest).toBe(attestation.digest);
    expect(anchor.attestationDigest).toBe(attestation.digest);
    await expect(fileExists(
      `${fixture.externalAnchorOutput}.publication-transaction.json`,
    )).resolves.toBe(false);
    expect((await readdir(manifestDirectory))
      .filter((entry) => entry.startsWith(manifestTempPrefix) && entry.endsWith(".tmp")))
      .toEqual([]);
  });

  it("recovers a private zero-byte manifest temp created before the first write", async () => {
    const fixture = await createFixture();
    await expect(runExternalRunner(fixture, {
      fault: "manifest-after-temp-create",
    })).rejects.toContain(
      "injected external publication fault: manifest-after-temp-create",
    );
    const manifestDirectory = path.dirname(path.join(fixture.root, fixture.manifestPath));
    const [tempName] = (await readdir(manifestDirectory)).filter(
      (entry) => entry.startsWith(`${path.basename(fixture.manifestPath)}.atomic-`)
        && entry.endsWith(".tmp"),
    );
    expect(tempName).toBeDefined();
    const tempPath = path.join(manifestDirectory, tempName!);
    const tempStat = await lstat(tempPath);
    expect([
      tempStat.size,
      tempStat.nlink,
      tempStat.uid,
      tempStat.mode & 0o777,
    ]).toEqual([0, 1, process.geteuid!(), 0o600]);

    await expect(runExternalRunner(fixture)).resolves.toContain(EXTERNAL_ATTESTATION_KIND);
    await expect(fileExists(tempPath)).resolves.toBe(false);
  });

  it("re-fsyncs a recovered exact manifest temp before committing it", async () => {
    const fixture = await createFixture();
    await expect(runExternalRunner(fixture, {
      fault: "manifest-after-final-write-before-fsync",
    })).rejects.toContain(
      "injected external publication fault: manifest-after-final-write-before-fsync",
    );
    const manifestDirectory = path.dirname(path.join(fixture.root, fixture.manifestPath));
    const [tempName] = (await readdir(manifestDirectory)).filter(
      (entry) => entry.startsWith(`${path.basename(fixture.manifestPath)}.atomic-`)
        && entry.endsWith(".tmp"),
    );
    expect(tempName).toBeDefined();
    const tempPath = path.join(manifestDirectory, tempName!);
    const before = await lstat(tempPath);
    expect(before.size).toBeGreaterThan(0);

    await expect(runExternalRunner(fixture, {
      fault: "manifest-after-recovered-exact-fsync",
    })).rejects.toContain(
      "injected external publication fault: manifest-after-recovered-exact-fsync",
    );
    const afterRefsync = await lstat(tempPath);
    expect([afterRefsync.dev, afterRefsync.ino, afterRefsync.size])
      .toEqual([before.dev, before.ino, before.size]);

    await expect(runExternalRunner(fixture)).resolves.toContain(EXTERNAL_ATTESTATION_KIND);
    await expect(fileExists(tempPath)).resolves.toBe(false);
  });

  it("does not delete unrelated bytes at the runner deterministic partial-temp name", async () => {
    const fixture = await createFixture();
    await expect(runExternalRunner(fixture, { fault: "partial-manifest-write" }))
      .rejects.toContain("injected external publication fault: partial-manifest-write");
    const manifestDirectory = path.dirname(path.join(fixture.root, fixture.manifestPath));
    const [tempName] = (await readdir(manifestDirectory)).filter(
      (entry) => entry.startsWith(`${path.basename(fixture.manifestPath)}.atomic-`)
        && entry.endsWith(".tmp"),
    );
    expect(tempName).toBeDefined();
    const tempPath = path.join(manifestDirectory, tempName!);
    const unrelatedBytes = Buffer.from("unrelated runner deterministic-name bytes\n");
    await writeFile(tempPath, unrelatedBytes);

    await expect(runExternalRunner(fixture)).rejects.toContain(
      "anchored temporary file is not a recoverable partial write",
    );
    await expect(readFile(tempPath)).resolves.toEqual(unrelatedBytes);
  });

  it("does not remove a runner partial temp that has an outside hardlink alias", async () => {
    const fixture = await createFixture();
    await expect(runExternalRunner(fixture, { fault: "partial-manifest-write" }))
      .rejects.toContain("injected external publication fault: partial-manifest-write");
    const manifestDirectory = path.dirname(path.join(fixture.root, fixture.manifestPath));
    const [tempName] = (await readdir(manifestDirectory)).filter(
      (entry) => entry.startsWith(`${path.basename(fixture.manifestPath)}.atomic-`)
        && entry.endsWith(".tmp"),
    );
    const tempPath = path.join(manifestDirectory, tempName!);
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "zerox-cd03-runner-temp-alias-"));
    temporaryRoots.push(outsideRoot);
    const aliasPath = path.join(outsideRoot, "runner-partial-temp-alias");
    await link(tempPath, aliasPath);
    const partialBytes = await readFile(aliasPath);

    await expect(runExternalRunner(fixture)).rejects.toContain(
      "anchored file must be regular with exactly one hard link",
    );
    await expect(readFile(aliasPath)).resolves.toEqual(partialBytes);
    await expect(readFile(tempPath)).resolves.toEqual(partialBytes);
    await rm(aliasPath);
    await expect(runExternalRunner(fixture)).resolves.toContain(EXTERNAL_ATTESTATION_KIND);
    await expect(fileExists(tempPath)).resolves.toBe(false);
  });

  it("rejects a weak-mode exact manifest temp, preserves it, and converges after repair", async () => {
    const fixture = await createFixture();
    await expect(runExternalRunner(fixture, { fault: "manifest-after-temp-ready" }))
      .rejects.toContain(
        "injected external publication fault: manifest-after-temp-ready",
      );
    const manifestDirectory = path.dirname(path.join(fixture.root, fixture.manifestPath));
    const [tempName] = (await readdir(manifestDirectory)).filter(
      (entry) => entry.startsWith(`${path.basename(fixture.manifestPath)}.atomic-`)
        && entry.endsWith(".tmp"),
    );
    const tempPath = path.join(manifestDirectory, tempName!);
    const exactBytes = await readFile(tempPath);
    await chmod(tempPath, 0o666);

    await expect(runExternalRunner(fixture)).rejects.toContain(
      "anchored governance file must be owned by the effective user with mode 0600",
    );
    await expect(readFile(tempPath)).resolves.toEqual(exactBytes);

    await chmod(tempPath, 0o600);
    await expect(runExternalRunner(fixture)).resolves.toContain(EXTERNAL_ATTESTATION_KIND);
    await expect(fileExists(tempPath)).resolves.toBe(false);
  });

  it("resumes a runner strict-prefix temp across repeated partial-append crashes", async () => {
    const fixture = await createFixture();
    await expect(runExternalRunner(fixture, { fault: "partial-manifest-write" }))
      .rejects.toContain("injected external publication fault: partial-manifest-write");
    const manifestDirectory = path.dirname(path.join(fixture.root, fixture.manifestPath));
    const [tempName] = (await readdir(manifestDirectory)).filter(
      (entry) => entry.startsWith(`${path.basename(fixture.manifestPath)}.atomic-`)
        && entry.endsWith(".tmp"),
    );
    const tempPath = path.join(manifestDirectory, tempName!);
    const firstSize = (await readFile(tempPath)).length;
    await expect(runExternalRunner(fixture, {
      fault: "manifest-partial-append-write",
    })).rejects.toContain(
      "injected external publication fault: manifest-partial-append-write",
    );
    expect((await readFile(tempPath)).length).toBeGreaterThan(firstSize);
    expect((await readdir(manifestDirectory)).filter((entry) =>
      entry.startsWith(`${path.basename(fixture.manifestPath)}.atomic-`)
        && entry.includes(".tmp.discard.completed-")
    )).toEqual([]);

    await expect(runExternalRunner(fixture)).resolves.toContain(EXTERNAL_ATTESTATION_KIND);
    await expect(fileExists(tempPath)).resolves.toBe(false);
  });

  it.each([
    "attestation-after-temp-ready",
    "attestation-after-replace-commit",
    "manifest-after-temp-ready",
    "manifest-after-replace-commit",
    "manifest-after-displaced-tombstone",
    "transaction-unlink-after-tombstone",
    "transaction-unlink-after-completed-marker",
  ])("recovers the multi-output leaf state machine after %s", async (fault) => {
    const fixture = await createFixture();
    await expect(runExternalRunner(fixture, { fault })).rejects.toContain(
      `injected external publication fault: ${fault}`,
    );

    await expect(runExternalRunner(fixture)).resolves.toContain(EXTERNAL_ATTESTATION_KIND);
    const transactionPath = `${fixture.externalAnchorOutput}.publication-transaction.json`;
    await expect(fileExists(transactionPath)).resolves.toBe(false);
    await expect(fileExists(`${transactionPath}.remove.tombstone`)).resolves.toBe(false);
  });

  it.each([
    ["attestation-leaf-temp-swap", "attestation-temp"],
    ["manifest-leaf-target-swap", "manifest-target"],
    ["transaction-unlink-leaf-swap", "transaction-target"],
  ] as const)(
    "preserves both inodes and converges after the real runner leaf swap %s",
    async (fault, location) => {
      const fixture = await createFixture();
      const originalManifestBytes = await readFile(
        path.join(fixture.root, fixture.manifestPath),
      );
      await expect(runExternalRunner(fixture, { fault })).rejects.toContain(
        "descriptor-anchored operation failed",
      );

      const transactionName = `${path.basename(fixture.externalAnchorOutput)}.publication-transaction.json`;
      const searchDirectory = location.startsWith("transaction-")
        ? path.dirname(fixture.externalAnchorOutput)
        : path.dirname(path.join(fixture.root, fixture.manifestPath));
      const preserved = (await readdir(searchDirectory)).filter((entry) => {
        if (location === "attestation-temp") {
          return entry.startsWith(`${path.basename(fixture.attestationPath)}.atomic-`)
            && entry.endsWith(".tmp.leaf-preserved");
        }
        if (location === "manifest-target") {
          return entry === `${path.basename(fixture.manifestPath)}.leaf-preserved`;
        }
        if (location === "transaction-target") {
          return entry === `${transactionName}.leaf-preserved`;
        }
        return entry === `${transactionName}.remove.tombstone.leaf-preserved`;
      });
      expect(preserved).toHaveLength(1);
      await expect(readFile(path.join(searchDirectory, preserved[0]!)))
        .resolves.toEqual(Buffer.from("descriptor leaf swap sentinel\n"));
      if (fault === "manifest-leaf-target-swap") {
        await expect(readFile(path.join(fixture.root, fixture.manifestPath)))
          .resolves.toEqual(originalManifestBytes);
      }

      await expect(runExternalRunner(fixture)).resolves.toContain(EXTERNAL_ATTESTATION_KIND);
    },
  );

  it("retires no runner swapped-in leaf and preserves both A and C", async () => {
    const fixture = await createFixture();
    await expect(runExternalRunner(fixture, {
      fault: "transaction-unlink-leaf-tombstone-swap",
    })).rejects.toContain("atomic retirement");
    const tombstonePath = `${fixture.externalAnchorOutput}.publication-transaction.json.remove.tombstone`;
    const transaction = JSON.parse(await readFile(tombstonePath, "utf8"));
    expect(transaction.kind).toBe(
      "conversation-disclosure-external-publication-transaction",
    );
    const preservedPath = `${tombstonePath}.leaf-preserved`;
    await expect(readFile(preservedPath)).resolves.toEqual(
      Buffer.from("descriptor leaf swap sentinel\n"),
    );

    await expect(runExternalRunner(fixture)).resolves.toContain(EXTERNAL_ATTESTATION_KIND);
    await expect(fileExists(tombstonePath)).resolves.toBe(false);
    await expect(readFile(preservedPath)).resolves.toEqual(
      Buffer.from("descriptor leaf swap sentinel\n"),
    );
  });

  it("preserves runner swapped-in C and its external hardlink across retry", async () => {
    const fixture = await createFixture();
    await expect(runExternalRunner(fixture, {
      fault: "transaction-unlink-leaf-tombstone-hardlink-swap",
    })).rejects.toContain("exactly one hard link");
    const tombstonePath = `${fixture.externalAnchorOutput}.publication-transaction.json.remove.tombstone`;
    const aBefore = await lstat(tombstonePath);
    const aBytes = await readFile(tombstonePath);
    expect(JSON.parse(await readFile(tombstonePath, "utf8")).kind).toBe(
      "conversation-disclosure-external-publication-transaction",
    );
    const cAlias = `${tombstonePath}.leaf-preserved`;
    const cEntry = `${tombstonePath}.leaf-entry-preserved`;
    const initial = await Promise.all([lstat(cAlias), lstat(cEntry)]);
    expect(initial[0].ino).toBe(initial[1].ino);
    expect(initial.map((entry) => entry.nlink)).toEqual([2, 2]);
    await expect(readFile(cAlias)).resolves.toEqual(
      Buffer.from("descriptor leaf swap sentinel\n"),
    );
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "zerox-cd03-swapped-c-"));
    temporaryRoots.push(outsideRoot);
    const outsideAlias = path.join(outsideRoot, "swapped-c-external-alias");
    await link(cAlias, outsideAlias);
    const before = await Promise.all([lstat(cAlias), lstat(cEntry), lstat(outsideAlias)]);
    expect(new Set(before.map((entry) => entry.ino)).size).toBe(1);
    expect(before.map((entry) => entry.nlink)).toEqual([3, 3, 3]);
    const cBytes = await readFile(outsideAlias);

    await expect(runExternalRunner(fixture)).resolves.toContain(EXTERNAL_ATTESTATION_KIND);
    const markerNames = (await readdir(path.dirname(tombstonePath))).filter(
      (entry) => entry.startsWith(`${path.basename(tombstonePath)}.completed-`)
        && entry.endsWith(".marker"),
    );
    expect(markerNames).toHaveLength(1);
    const markerPath = path.join(path.dirname(tombstonePath), markerNames[0]!);
    const aAfter = await lstat(markerPath);
    expect([aAfter.ino, aAfter.nlink]).toEqual([aBefore.ino, aBefore.nlink]);
    await expect(readFile(markerPath)).resolves.toEqual(aBytes);
    const after = await Promise.all([lstat(cAlias), lstat(cEntry), lstat(outsideAlias)]);
    expect(after.map((entry) => [entry.ino, entry.nlink]))
      .toEqual(before.map((entry) => [entry.ino, entry.nlink]));
    await expect(readFile(outsideAlias)).resolves.toEqual(cBytes);
  });

  it("anchors manifest replace to the opened parent when the pathname is swapped", async () => {
    const fixture = await createFixture();
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "zerox-cd03-runner-outside-"));
    temporaryRoots.push(outsideRoot);
    const outsideTarget = path.join(outsideRoot, path.basename(fixture.manifestPath));
    const sentinel = Buffer.from("outside manifest sentinel\n");
    await writeFile(outsideTarget, sentinel);

    await expect(runExternalRunner(fixture, {
      environment: { ZEROX_CD03_RUNNER_TEST_PARENT_SWAP: outsideRoot },
    })).rejects.toContain(
      "externally attested manifest publication parent directory identity changed",
    );
    await expect(readFile(outsideTarget)).resolves.toEqual(sentinel);
  });

  it("anchors publication-journal unlink when its parent pathname is swapped", async () => {
    const fixture = await createFixture();
    const anchorParent = path.dirname(fixture.externalAnchorOutput);
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "zerox-cd03-runner-unlink-"));
    temporaryRoots.push(outsideRoot);
    const transactionName = `${path.basename(fixture.externalAnchorOutput)}.publication-transaction.json`;
    const outsideTarget = path.join(outsideRoot, transactionName);
    const sentinel = Buffer.from("outside runner transaction sentinel\n");
    await writeFile(outsideTarget, sentinel);

    await expect(runExternalRunner(fixture, {
      environment: { ZEROX_CD03_RUNNER_TEST_REMOVE_PARENT_SWAP: outsideRoot },
    })).rejects.toContain(
      "completed external publication transaction parent directory identity changed",
    );
    await expect(readFile(outsideTarget)).resolves.toEqual(sentinel);

    const anchorParentContainer = path.dirname(anchorParent);
    const heldPrefix = `${path.basename(anchorParent)}.descriptor-held-`;
    for (const entry of await readdir(anchorParentContainer)) {
      if (entry.startsWith(heldPrefix)) {
        temporaryRoots.push(path.join(anchorParentContainer, entry));
      }
    }
  });

  it("rejects a future review receipt before any publication output", async () => {
    const fixture = await createFixture();
    fixture.receipts[0].completedAt = "2999-01-01T00:00:00.000Z";
    await writeJson(fixture.root, fixture.receiptPaths[0], fixture.receipts[0]);
    const digest = hashCanonical(fixture.receipts[0]);
    fixture.externalReceiptDigests.set("contract", digest);
    fixture.manifest.reviewReceipts[0].canonicalDigest = digest;
    refreshManifestDigest(fixture.manifest);
    await writeJson(fixture.root, fixture.manifestPath, fixture.manifest);

    await expect(runExternalRunner(fixture)).rejects.toContain(
      "completedAt must not be in the future",
    );
    await expect(fileExists(path.join(fixture.root, fixture.attestationPath)))
      .resolves.toBe(false);
    await expect(fileExists(fixture.externalAnchorOutput)).resolves.toBe(false);
    await expect(fileExists(fixture.checkerMarker)).resolves.toBe(false);
    await expect(fileExists(fixture.harnessMarker)).resolves.toBe(false);
  });

  it("rejects a real outside hardlink without mutating the alias", async () => {
    const fixture = await createFixture();
    const aliasPath = path.join(path.dirname(fixture.externalAnchorOutput), "manifest-alias.json");
    const manifestTarget = path.join(fixture.root, fixture.manifestPath);
    const originalBytes = await readFile(manifestTarget);
    await link(manifestTarget, aliasPath);

    await expect(runExternalRunner(fixture)).rejects.toContain(
      "closure manifest must have exactly one hard link",
    );
    await expect(readFile(aliasPath)).resolves.toEqual(originalBytes);
    await expect(fileExists(path.join(fixture.root, fixture.attestationPath)))
      .resolves.toBe(false);
  });

  it("rejects a closure runner invoked from inside the candidate repository", async () => {
    const fixture = await createFixture();
    const localRunnerPath = path.join(fixture.root, "scripts", "local-closure-runner.mjs");
    await writeFile(localRunnerPath, await readFile(runnerPath));

    await expect(runExternalRunner(fixture, {
      invokedRunnerPath: localRunnerPath,
    })).rejects.toContain(
      "external closure runner must be invoked from outside the candidate repository",
    );
    await expect(fileExists(fixture.checkerMarker)).resolves.toBe(false);
    await expect(fileExists(fixture.harnessMarker)).resolves.toBe(false);
  });
});

type JsonRecord = Record<string, any>;

type Fixture = {
  root: string;
  snapshotPath: string;
  manifestPath: string;
  attestationPath: string;
  receiptPaths: string[];
  snapshot: JsonRecord;
  receipts: JsonRecord[];
  manifest: JsonRecord;
  externalSnapshotDigest: string;
  externalReceiptDigests: Map<string, string>;
  externalChallenges: Map<string, string>;
  checkerMarker: string;
  harnessMarker: string;
  mutationPaths: Record<ControlMutationTarget, string>;
  externalAnchorOutput: string;
  freezeMarkerPath: string;
};

type ControlMutationTarget =
  | "receipt"
  | "manifest"
  | "snapshot"
  | "artifact"
  | "program"
  | "featureList";

async function createFixture(options: {
  checkerMutatesCandidateHarness?: boolean;
  checkerOmitsReceipt?: boolean;
  checkerMutationTarget?: ControlMutationTarget;
  stagedMutationTarget?: string;
  checkerCreatesStageSentinel?: boolean;
  checkerReplacesLiveFreezeMarkerSameBytes?: boolean;
} = {}): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "zerox-cd03-external-closure-"));
  temporaryRoots.push(root);
  const externalAnchorRoot = await mkdtemp(
    path.join(os.tmpdir(), "zerox-cd03-external-anchor-"),
  );
  temporaryRoots.push(externalAnchorRoot);
  const externalAnchorOutput = path.join(externalAnchorRoot, "anchor.json");
  const snapshotPath = ".zerox/CD03-round17-snapshot.json";
  const manifestPath = ".zerox/CD03-round17-closure.json";
  const attestationPath = ".zerox/CD03-round17-external-attestation.json";
  const receiptPaths = REQUIRED_REVIEW_LANES.map(
    (lane) => `.zerox/reviews/${lane}.review.json`,
  );
  const checkerMarker = path.join(root, ".zerox", "checker-executed.marker");
  const harnessMarker = path.join(root, ".zerox", "harness-executed.marker");
  const mutationPaths: Record<ControlMutationTarget, string> = {
    receipt: receiptPaths[0],
    manifest: manifestPath,
    snapshot: snapshotPath,
    artifact: canonicalControlInputs.artifact,
    program: canonicalControlInputs.program,
    featureList: canonicalControlInputs.featureList,
  };
  const checkerMutationPath = options.checkerMutationTarget
    ? path.join(root, mutationPaths[options.checkerMutationTarget])
    : undefined;
  await Promise.all([
    mkdir(path.join(root, ".zerox", "reviews"), { recursive: true }),
    mkdir(path.join(root, "scripts"), { recursive: true }),
    mkdir(path.join(root, "src"), { recursive: true }),
  ]);

  const fileContents = new Map<string, string>([
    ["package.json", JSON.stringify({ name: "closure-fixture" })],
    [
      REQUIRED_EXECUTABLE_CLOSURE.checker,
      closureEntryScript({
        markerPath: checkerMarker,
        receiptKind: "cd03-checker-receipt",
        snapshotPath,
        ...(options.stagedMutationTarget
          ? {
              mutatePath: options.stagedMutationTarget,
              mutateContent: "// malicious staged replacement\n",
            }
          : options.checkerMutatesCandidateHarness || checkerMutationPath
          ? {
              mutatePath: options.checkerMutatesCandidateHarness
                ? path.join(root, REQUIRED_EXECUTABLE_CLOSURE.harness)
                : checkerMutationPath,
              mutateContent: options.checkerMutatesCandidateHarness
                ? "// candidate harness changed during checker execution\n"
                : '{"mutatedDuringChecker":true}\n',
            }
          : {}),
        omitReceipt: options.checkerOmitsReceipt,
        createPath: options.checkerCreatesStageSentinel
          ? ".checker-stage-pollution"
          : undefined,
        replaceCompletedMarkerBase: options.checkerReplacesLiveFreezeMarkerSameBytes
          ? path.join(root, `${snapshotPath}.freeze-transaction.json.remove.tombstone`)
          : undefined,
      }),
    ],
    [
      REQUIRED_EXECUTABLE_CLOSURE.harness,
      closureEntryScript({
        markerPath: harnessMarker,
        receiptKind: "cd03-harness-receipt",
        snapshotPath,
        rejectIfPathExists: options.checkerCreatesStageSentinel
          ? ".checker-stage-pollution"
          : undefined,
      }),
    ],
    [
      "scripts/conversation-disclosure-review-contract.mjs",
      "export const stagedReviewContract = true;\n",
    ],
    [REQUIRED_EXTERNAL_RUNNER, await readFile(runnerPath, "utf8")],
    ["src/candidate.ts", "export const candidate = true;\n"],
  ]);
  await Promise.all(
    [...fileContents].map(async ([relativePath, content]) => {
      const target = path.join(root, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }),
  );

  const controlFileContents = new Map<string, string>(
    harnessControlPaths.map((relativePath) => [relativePath, `fixture ${relativePath}\n`]),
  );
  controlFileContents.set(
    canonicalControlInputs.program,
    JSON.stringify({
      sourceReview: ".zerox/conversation-disclosure-program.md",
      operatingGuide: ".zerox/conversation-disclosure-program.md",
      architectureDecision: ".zerox/conversation-disclosure-program.md",
      workstreams: [],
    }),
  );
  controlFileContents.set(
    canonicalControlInputs.featureList,
    JSON.stringify({ schemaVersion: 1, features: [] }),
  );
  controlFileContents.set(
    canonicalControlInputs.artifact,
    JSON.stringify({ schemaVersion: 1, artifactId: "fixture" }),
  );
  await Promise.all(
    [...controlFileContents]
      .filter(([relativePath]) => !fileContents.has(relativePath))
      .map(async ([relativePath, content]) => {
        const target = path.join(root, relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
      }),
  );

  const snapshotWithoutDigest = {
    schemaVersion: 1,
    kind: REVIEW_SNAPSHOT_KIND,
    algorithm: REVIEW_ALGORITHM,
    programId: "conversation-progressive-disclosure-v3.9.2-2026-08",
    workstreamId: "CD03",
    featureId: "P107-conversation-disclosure-domain-adapters",
    round: 17,
    completionContractDigest: hashCanonical({ contract: "fixture" }),
    safetyContractDigest: hashCanonical({ exactSafety: true }),
    featureFileSetDigest: hashCanonical([...fileContents.keys()].sort()),
    claimsDigest: hashCanonical({ claims: "fixture" }),
    files: [...fileContents]
      .map(([relativePath, content]) => ({
        path: relativePath,
        sha256: sha256Bytes(content),
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
  const snapshot: JsonRecord = {
    ...snapshotWithoutDigest,
    digest: hashCanonical(snapshotWithoutDigest),
  };
  await writeJson(root, snapshotPath, snapshot);

  const receipts = REQUIRED_REVIEW_LANES.map((lane, index) => ({
    schemaVersion: 1,
    kind: REVIEW_RECEIPT_KIND,
    programId: snapshot.programId,
    workstreamId: snapshot.workstreamId,
    featureId: snapshot.featureId,
    round: snapshot.round,
    lane,
    transport: "codex-collaboration",
    reviewTaskPath: `/root/p107_r17_${lane}_review`,
    reviewAgentId: `agent-${index + 1}`,
    challenge: hashCanonical(`challenge-${lane}`),
    snapshotDigest: snapshot.digest,
    snapshotFileCount: snapshot.files.length,
    completionContractDigest: snapshot.completionContractDigest,
    safetyContractDigest: snapshot.safetyContractDigest,
    verdict: "passed",
    findingCounts: { critical: 0, major: 0, minor: 0 },
    findings: [],
    completedAt: `2026-08-23T00:00:0${index}.000Z`,
  }));
  await Promise.all(
    receipts.map((receipt, index) => writeJson(root, receiptPaths[index], receipt)),
  );

  const executableClosure = Object.entries(REQUIRED_EXECUTABLE_CLOSURE).map(
    ([kind, relativePath]) => ({
      kind,
      path: relativePath,
      sha256: sha256Bytes(fileContents.get(relativePath) ?? ""),
    }),
  );
  const manifestWithoutDigest = {
    schemaVersion: 1,
    kind: CLOSURE_MANIFEST_KIND,
    programId: snapshot.programId,
    workstreamId: snapshot.workstreamId,
    featureId: snapshot.featureId,
    round: snapshot.round,
    status: "review_passed_pending_external_anchor",
    snapshot: { path: snapshotPath, digest: snapshot.digest },
    reviewReceipts: receipts.map((receipt, index) => ({
      lane: receipt.lane,
      path: receiptPaths[index],
      canonicalDigest: hashCanonical(receipt),
    })),
    executableClosure,
    externalRunner: {
      path: REQUIRED_EXTERNAL_RUNNER,
      sha256: sha256Bytes(fileContents.get(REQUIRED_EXTERNAL_RUNNER) ?? ""),
    },
    externalAttestation: {
      path: attestationPath,
      canonicalDigest: null,
    },
  };
  const manifest: JsonRecord = {
    ...manifestWithoutDigest,
    digest: hashCanonical(manifestWithoutDigest),
  };
  await writeJson(root, manifestPath, manifest);
  const freezeMarkerPath = await writeExactFreezeCompletedMarker(
    root,
    snapshotPath,
    snapshot,
  );

  return {
    root,
    snapshotPath,
    manifestPath,
    attestationPath,
    receiptPaths,
    snapshot,
    receipts,
    manifest,
    externalSnapshotDigest: snapshot.digest,
    externalReceiptDigests: new Map(
      receipts.map((receipt) => [receipt.lane, hashCanonical(receipt)]),
    ),
    externalChallenges: new Map(
      receipts.map((receipt) => [receipt.lane, receipt.challenge]),
    ),
    checkerMarker,
    harnessMarker,
    mutationPaths,
    externalAnchorOutput,
    freezeMarkerPath,
  };
}

async function runExternalRunner(
  fixture: Fixture,
  overrides: {
    expectedSnapshotDigest?: string;
    expectedReceiptDigests?: Map<string, string>;
    invokedRunnerPath?: string;
    fault?: string;
    environment?: Record<string, string>;
  } = {},
): Promise<string> {
  const invokedRunnerPath = overrides.invokedRunnerPath ?? runnerPath;
  const runnerDigest = `sha256:${createHash("sha256")
    .update(await readFile(invokedRunnerPath))
    .digest("hex")}`;
  const repositoryRealpath = await realpath(fixture.root);
  const receiptDigests = overrides.expectedReceiptDigests
    ?? fixture.externalReceiptDigests;
  const args = [
    invokedRunnerPath,
    "--repo",
    fixture.root,
    "--expected-repo-realpath",
    repositoryRealpath,
    "--closure-manifest",
    fixture.manifestPath,
    "--expected-runner-digest",
    runnerDigest,
    "--expected-snapshot-digest",
    overrides.expectedSnapshotDigest ?? fixture.externalSnapshotDigest,
    "--external-anchor-output",
    fixture.externalAnchorOutput,
  ];
  for (const lane of REQUIRED_REVIEW_LANES) {
    args.push(
      "--expected-review-receipt",
      `${lane}=${receiptDigests.get(lane)}`,
      "--expected-review-challenge",
      `${lane}=${fixture.externalChallenges.get(lane)}`,
    );
  }
  try {
    const result = await execFileAsync(process.execPath, args, {
      cwd: fixture.root,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        ...overrides.environment,
        ...(overrides.fault
          ? { ZEROX_CD03_RUNNER_TEST_FAULT: overrides.fault }
          : {}),
      },
    });
    return result.stdout;
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw `${failure.stdout ?? ""}${failure.stderr ?? ""}${failure.message}`;
  }
}

function markerScript(markerPath: string, output: string): string {
  return [
    'import { writeFile } from "node:fs/promises";',
    `await writeFile(${JSON.stringify(markerPath)}, "executed", "utf8");`,
    `process.stdout.write(${JSON.stringify(`${output}\n`)});`,
    "",
  ].join("\n");
}

function closureEntryScript(options: {
  markerPath: string;
  receiptKind: "cd03-checker-receipt" | "cd03-harness-receipt";
  snapshotPath: string;
  mutatePath?: string;
  mutateContent?: string;
  omitReceipt?: boolean;
  createPath?: string;
  rejectIfPathExists?: string;
  replaceCompletedMarkerBase?: string;
}): string {
  return [
    'import { lstat, readFile, readdir, rename, writeFile } from "node:fs/promises";',
    `const snapshot = JSON.parse(await readFile(${JSON.stringify(options.snapshotPath)}, "utf8"));`,
    ...(options.rejectIfPathExists
      ? [
          `try { await lstat(${JSON.stringify(options.rejectIfPathExists)}); process.exit(23); } catch (error) { if (error?.code !== "ENOENT") throw error; }`,
        ]
      : []),
    `await writeFile(${JSON.stringify(options.markerPath)}, "executed", "utf8");`,
    ...(options.createPath
      ? [
          `await writeFile(${JSON.stringify(options.createPath)}, "pollution", "utf8");`,
        ]
      : []),
    ...(options.mutatePath
      ? [
          `await writeFile(${JSON.stringify(options.mutatePath)}, ${JSON.stringify(options.mutateContent)}, "utf8");`,
        ]
      : []),
    ...(options.replaceCompletedMarkerBase
      ? [
          `const markerDirectory = ${JSON.stringify(path.dirname(options.replaceCompletedMarkerBase))};`,
          `const markerPrefix = ${JSON.stringify(`${path.basename(options.replaceCompletedMarkerBase)}.completed-`)};`,
          'const markerNames = (await readdir(markerDirectory)).filter((entry) => entry.startsWith(markerPrefix) && entry.endsWith(".marker"));',
          'if (markerNames.length !== 1) throw new Error("live completed marker fixture is ambiguous");',
          'const markerPath = `${markerDirectory}/${markerNames[0]}`;',
          'const replacementPath = `${markerPath}.same-bytes-new-inode`;',
          'await writeFile(replacementPath, await readFile(markerPath), { mode: 0o600 });',
          'await rename(replacementPath, markerPath);',
        ]
      : []),
    ...(options.omitReceipt
      ? ['process.stdout.write("checker completed without receipt\\n");']
      : [
          `process.stdout.write(JSON.stringify({ kind: ${JSON.stringify(options.receiptKind)}, status: "passed", snapshotDigest: snapshot.digest }) + "\\n");`,
        ]),
    "",
  ].join("\n");
}

function refreshSnapshotDigest(snapshot: JsonRecord): void {
  const withoutDigest = { ...snapshot };
  delete withoutDigest.digest;
  snapshot.digest = hashCanonical(withoutDigest);
}

function refreshManifestDigest(manifest: JsonRecord): void {
  const withoutDigest = { ...manifest };
  delete withoutDigest.digest;
  manifest.digest = hashCanonical(withoutDigest);
}

async function writeJson(root: string, relativePath: string, value: unknown): Promise<void> {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(value, null, 2), "utf8");
}

async function writeExactFreezeCompletedMarker(
  root: string,
  snapshotPath: string,
  snapshot: JsonRecord,
): Promise<string> {
  const withoutDigest = {
    schemaVersion: 1,
    kind: "conversation-disclosure-review-freeze-transaction",
    status: "prepared",
    round: snapshot.round,
    mode: "created",
    snapshotPath,
    artifactPath: canonicalControlInputs.artifact,
    originalSnapshotDigest: null,
    targetSnapshotDigest: sha256Bytes(await readFile(path.join(root, snapshotPath))),
    originalArtifactDigest: sha256Bytes("fixture original artifact bytes"),
    targetArtifactDigest: sha256Bytes("fixture freeze-time pending artifact bytes"),
  };
  const transaction = {
    ...withoutDigest,
    digest: hashCanonical(withoutDigest),
  };
  const bytes = Buffer.from(JSON.stringify(transaction), "utf8");
  const markerBasePath = path.join(
    root,
    `${snapshotPath}.freeze-transaction.json.remove.tombstone`,
  );
  const sourcePath = `${markerBasePath}.marker-source`;
  await writeFile(sourcePath, bytes, { mode: 0o600 });
  const entry = await lstat(sourcePath);
  const markerPath = `${markerBasePath}.completed-${
    createHash("sha256").update(bytes).digest("hex")
  }-${entry.dev}-${entry.ino}.marker`;
  await rename(sourcePath, markerPath);
  return markerPath;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}
