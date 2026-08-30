import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  link,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const freezeSourcePath = path.join(
  repositoryRoot,
  "scripts",
  "freeze-conversation-disclosure-review.mjs",
);
const reviewContractSourcePath = path.join(
  repositoryRoot,
  "scripts",
  "conversation-disclosure-review-contract.mjs",
);
const round = 18;
const snapshotPath =
  ".zerox/verification/conversation-disclosure/CD03-round18-review-snapshot.json";
const artifactPath =
  ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json";
const programPath = ".zerox/conversation-disclosure-program.json";
const featureListPath = ".zerox/feature_list.json";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("conversation disclosure review freezer", () => {
  it("hashes the original ordered Feature array while sorting only immutable files", async () => {
    const fixture = await createFixture();
    const output = await runFreezer(fixture.root);
    const receipt = JSON.parse(output.trim()) as Record<string, unknown>;
    const [snapshot, artifact] = await Promise.all([
      readJson(path.join(fixture.root, snapshotPath)),
      readJson(path.join(fixture.root, artifactPath)),
    ]);

    expect(receipt).toMatchObject({
      kind: "cd03-review-snapshot-freeze-receipt",
      status: "created",
      round,
      snapshotPath,
      snapshotDigest: snapshot.digest,
    });
    expect(snapshot.featureFileSetDigest).toBe(hashCanonical(fixture.featureFiles));
    expect(snapshot.featureFileSetDigest).not.toBe(
      hashCanonical(
        (snapshot.files as Array<{ path: string }>).map((entry) => entry.path),
      ),
    );
    expect((snapshot.files as Array<{ path: string }>).map((entry) => entry.path))
      .toEqual(fixture.immutablePaths);
    expect(snapshot.claimsDigest).toBe(hashCanonical(fixture.claims));
    expect(artifact.reviewSnapshot).toEqual(snapshot);
  });

  it("keeps one completed marker and treats unchanged explicit replacement as idempotent", async () => {
    const fixture = await createFixture();
    await runFreezer(fixture.root);

    await expect(runFreezer(fixture.root)).resolves.toContain('"recovered":true');
    await expect(runFreezer(fixture.root, ["--replace-pending"]))
      .resolves.toContain('"recovered":true');
    const transactionMarkerPrefix = `${path.basename(snapshotPath)}.freeze-transaction.json.remove.tombstone.completed-`;
    expect((await readdir(path.dirname(path.join(fixture.root, snapshotPath))))
      .filter((entry) => entry.startsWith(transactionMarkerPrefix))).toHaveLength(1);

    await writeFile(
      path.join(
        fixture.root,
        ".zerox/verification/conversation-disclosure/CD03-round18-contract-review.json",
      ),
      "{}\n",
      "utf8",
    );
    await expect(runFreezer(fixture.root, ["--replace-pending"]))
      .rejects.toContain("cannot be replaced after downstream evidence exists");
  });

  it("rejects changed same-round replacement instead of accumulating completed markers", async () => {
    const fixture = await createFixture();
    await runFreezer(fixture.root);
    await writeFile(path.join(fixture.root, "alpha.txt"), "changed immutable bytes\n");

    await expect(runFreezer(fixture.root, ["--replace-pending"]))
      .rejects.toContain("freeze publication transaction schema/bindings are invalid");
    const transactionMarkerPrefix = `${path.basename(snapshotPath)}.freeze-transaction.json.remove.tombstone.completed-`;
    expect((await readdir(path.dirname(path.join(fixture.root, snapshotPath))))
      .filter((entry) => entry.startsWith(transactionMarkerPrefix))).toHaveLength(1);
  });

  it("rejects a completed freeze marker whose filename inode binding is stale", async () => {
    const fixture = await createFixture();
    await runFreezer(fixture.root);
    const markerDirectory = path.dirname(path.join(fixture.root, snapshotPath));
    const markerName = (await readdir(markerDirectory)).find(
      (entry) => entry.startsWith(
        `${path.basename(snapshotPath)}.freeze-transaction.json.remove.tombstone.completed-`,
      ),
    )!;
    const staleName = markerName.replace(/-([0-9]+)\.marker$/, (_match, ino) =>
      `-${BigInt(ino) + 1n}.marker`);
    await rename(
      path.join(markerDirectory, markerName),
      path.join(markerDirectory, staleName),
    );

    await expect(runFreezer(fixture.root)).rejects.toContain(
      "completed freeze publication marker identity/digest is stale",
    );
  });

  it("refuses pending replacement when the embedded and standalone snapshots diverge", async () => {
    const fixture = await createFixture();
    await runFreezer(fixture.root);
    const artifact = await readJson(path.join(fixture.root, artifactPath));
    (artifact.reviewSnapshot as Record<string, unknown>).digest =
      `sha256:${"f".repeat(64)}`;
    await writeJson(path.join(fixture.root, artifactPath), artifact);

    await expect(runFreezer(fixture.root, ["--replace-pending"]))
      .rejects.toContain(
        "existing snapshot and embedded pending artifact snapshot must be exact and valid",
      );
  });

  it.each([
    {
      name: "wrong active Feature",
      mutate(fixture: FreezeFixture) {
        fixture.program.activeFeatureId = "P999-forged";
      },
      expected: "CD03 must be the active in_progress workstream before freeze",
    },
    {
      name: "completed Feature status",
      mutate(fixture: FreezeFixture) {
        fixture.featureList.features[0]!.status = "done";
      },
      expected: "active CD03 Feature status/files schema is invalid",
    },
    {
      name: "program schema drift",
      mutate(fixture: FreezeFixture) {
        fixture.program.schemaVersion = 2;
      },
      expected: "conversation disclosure program schema/status is invalid",
    },
    {
      name: "artifact review round drift",
      mutate(fixture: FreezeFixture) {
        fixture.artifact.independentReview.round = 17;
      },
      expected: "artifact review round/path must exactly match the requested round",
    },
    {
      name: "artifact closure path drift",
      mutate(fixture: FreezeFixture) {
        fixture.artifact.independentReview.closureManifestPath =
          ".zerox/verification/conversation-disclosure/CD03-round17-closure-manifest.json";
      },
      expected: "artifact review round/path must exactly match the requested round",
    },
  ])("fails closed on $name", async ({ mutate, expected }) => {
    const fixture = await createFixture();
    mutate(fixture);
    await persistFixtureGovernance(fixture);
    await expect(runFreezer(fixture.root)).rejects.toContain(expected);
    await expect(fileExists(path.join(fixture.root, snapshotPath))).resolves.toBe(false);
  });

  it("rejects a requested snapshot path from another round", async () => {
    const fixture = await createFixture();
    await expect(runFreezer(fixture.root, [
      "--snapshot-path",
      ".zerox/verification/conversation-disclosure/CD03-round17-review-snapshot.json",
    ])).rejects.toContain("snapshot path must exactly match the requested round");
  });

  it("rejects symlinked immutable Feature bytes", async () => {
    const fixture = await createFixture();
    const alphaPath = path.join(fixture.root, "alpha.txt");
    await rm(alphaPath);
    await symlink("zeta.txt", alphaPath);

    await expect(runFreezer(fixture.root)).rejects.toContain(
      "must not contain symbolic links: alpha.txt",
    );
    await expect(fileExists(path.join(fixture.root, snapshotPath))).resolves.toBe(false);
  });

  it.each([
    "after-transaction",
    "after-snapshot",
    "before-artifact-commit",
    "partial-artifact-write",
    "after-artifact",
  ])("recovers idempotently from an atomic publication fault at %s", async (fault) => {
    const fixture = await createFixture();
    await expect(runFreezer(fixture.root, [], fault)).rejects.toContain(
      `injected freeze publication fault: ${fault}`,
    );

    const artifactDirectory = path.dirname(path.join(fixture.root, artifactPath));
    const artifactTempPrefix = `${path.basename(artifactPath)}.atomic-`;
    if (fault === "partial-artifact-write") {
      const partialTemps = (await readdir(artifactDirectory))
        .filter((entry) => entry.startsWith(artifactTempPrefix) && entry.endsWith(".tmp"));
      expect(partialTemps).toHaveLength(1);
      expect((await readFile(path.join(artifactDirectory, partialTemps[0]!))).length)
        .toBeGreaterThan(0);
    }

    const output = await runFreezer(fixture.root);
    expect(output).toContain('"recovered":true');
    const snapshot = await readJson(path.join(fixture.root, snapshotPath));
    const artifact = await readJson(path.join(fixture.root, artifactPath));
    expect(artifact.reviewSnapshot).toEqual(snapshot);
    await expect(fileExists(path.join(
      fixture.root,
      `${snapshotPath}.freeze-transaction.json`,
    ))).resolves.toBe(false);
    expect((await readdir(artifactDirectory))
      .filter((entry) => entry.startsWith(artifactTempPrefix) && entry.endsWith(".tmp")))
      .toEqual([]);
  });

  it("recovers a private zero-byte artifact temp created before the first write", async () => {
    const fixture = await createFixture();
    await expect(runFreezer(fixture.root, [], "artifact-after-temp-create"))
      .rejects.toContain(
        "injected freeze publication fault: artifact-after-temp-create",
      );
    const artifactDirectory = path.dirname(path.join(fixture.root, artifactPath));
    const [tempName] = (await readdir(artifactDirectory)).filter(
      (entry) => entry.startsWith(`${path.basename(artifactPath)}.atomic-`)
        && entry.endsWith(".tmp"),
    );
    expect(tempName).toBeDefined();
    const tempPath = path.join(artifactDirectory, tempName!);
    const tempStat = await lstat(tempPath);
    expect([
      tempStat.size,
      tempStat.nlink,
      tempStat.uid,
      tempStat.mode & 0o777,
    ]).toEqual([0, 1, process.geteuid!(), 0o600]);

    await expect(runFreezer(fixture.root)).resolves.toContain('"recovered":true');
    await expect(fileExists(tempPath)).resolves.toBe(false);
  });

  it("re-fsyncs a recovered exact artifact temp before committing it", async () => {
    const fixture = await createFixture();
    await expect(runFreezer(
      fixture.root,
      [],
      "artifact-after-final-write-before-fsync",
    )).rejects.toContain(
      "injected freeze publication fault: artifact-after-final-write-before-fsync",
    );
    const artifactDirectory = path.dirname(path.join(fixture.root, artifactPath));
    const [tempName] = (await readdir(artifactDirectory)).filter(
      (entry) => entry.startsWith(`${path.basename(artifactPath)}.atomic-`)
        && entry.endsWith(".tmp"),
    );
    expect(tempName).toBeDefined();
    const tempPath = path.join(artifactDirectory, tempName!);
    const before = await lstat(tempPath);
    expect(before.size).toBeGreaterThan(0);

    await expect(runFreezer(
      fixture.root,
      [],
      "artifact-after-recovered-exact-fsync",
    )).rejects.toContain(
      "injected freeze publication fault: artifact-after-recovered-exact-fsync",
    );
    const afterRefsync = await lstat(tempPath);
    expect([afterRefsync.dev, afterRefsync.ino, afterRefsync.size])
      .toEqual([before.dev, before.ino, before.size]);

    await expect(runFreezer(fixture.root)).resolves.toContain('"recovered":true');
    await expect(fileExists(tempPath)).resolves.toBe(false);
  });

  it("does not delete unrelated bytes at the deterministic partial-temp name", async () => {
    const fixture = await createFixture();
    await expect(runFreezer(fixture.root, [], "partial-artifact-write"))
      .rejects.toContain("injected freeze publication fault: partial-artifact-write");
    const artifactDirectory = path.dirname(path.join(fixture.root, artifactPath));
    const [tempName] = (await readdir(artifactDirectory)).filter(
      (entry) => entry.startsWith(`${path.basename(artifactPath)}.atomic-`)
        && entry.endsWith(".tmp"),
    );
    expect(tempName).toBeDefined();
    const tempPath = path.join(artifactDirectory, tempName!);
    const unrelatedBytes = Buffer.from("unrelated deterministic-name bytes\n");
    await writeFile(tempPath, unrelatedBytes);

    await expect(runFreezer(fixture.root)).rejects.toContain(
      "anchored temporary file is not a recoverable partial write",
    );
    await expect(readFile(tempPath)).resolves.toEqual(unrelatedBytes);
  });

  it("does not remove a partial temp that has an outside hardlink alias", async () => {
    const fixture = await createFixture();
    await expect(runFreezer(fixture.root, [], "partial-artifact-write"))
      .rejects.toContain("injected freeze publication fault: partial-artifact-write");
    const artifactDirectory = path.dirname(path.join(fixture.root, artifactPath));
    const [tempName] = (await readdir(artifactDirectory)).filter(
      (entry) => entry.startsWith(`${path.basename(artifactPath)}.atomic-`)
        && entry.endsWith(".tmp"),
    );
    const tempPath = path.join(artifactDirectory, tempName!);
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "zerox-cd03-temp-alias-"));
    roots.push(outsideRoot);
    const aliasPath = path.join(outsideRoot, "partial-temp-alias");
    await link(tempPath, aliasPath);
    const partialBytes = await readFile(aliasPath);

    await expect(runFreezer(fixture.root)).rejects.toContain(
      "anchored file must be regular with exactly one hard link",
    );
    await expect(readFile(aliasPath)).resolves.toEqual(partialBytes);
    await expect(readFile(tempPath)).resolves.toEqual(partialBytes);
    await rm(aliasPath);
    await expect(runFreezer(fixture.root)).resolves.toContain('"recovered":true');
    await expect(fileExists(tempPath)).resolves.toBe(false);
  });

  it("rejects a weak-mode exact temp, preserves it, and converges after repair", async () => {
    const fixture = await createFixture();
    await expect(runFreezer(fixture.root, [], "artifact-after-temp-ready"))
      .rejects.toContain("injected freeze publication fault: artifact-after-temp-ready");
    const artifactDirectory = path.dirname(path.join(fixture.root, artifactPath));
    const [tempName] = (await readdir(artifactDirectory)).filter(
      (entry) => entry.startsWith(`${path.basename(artifactPath)}.atomic-`)
        && entry.endsWith(".tmp"),
    );
    const tempPath = path.join(artifactDirectory, tempName!);
    const exactBytes = await readFile(tempPath);
    await chmod(tempPath, 0o666);

    await expect(runFreezer(fixture.root)).rejects.toContain(
      "anchored governance file must be owned by the effective user with mode 0600",
    );
    await expect(readFile(tempPath)).resolves.toEqual(exactBytes);

    await chmod(tempPath, 0o600);
    await expect(runFreezer(fixture.root)).resolves.toContain('"recovered":true');
    await expect(fileExists(tempPath)).resolves.toBe(false);
  });

  it("resumes a strict-prefix temp in place across repeated partial-append crashes", async () => {
    const fixture = await createFixture();
    await expect(runFreezer(fixture.root, [], "partial-artifact-write"))
      .rejects.toContain("injected freeze publication fault: partial-artifact-write");
    const artifactDirectory = path.dirname(path.join(fixture.root, artifactPath));
    const [tempName] = (await readdir(artifactDirectory)).filter(
      (entry) => entry.startsWith(`${path.basename(artifactPath)}.atomic-`)
        && entry.endsWith(".tmp"),
    );
    const tempPath = path.join(artifactDirectory, tempName!);
    const firstSize = (await readFile(tempPath)).length;
    await expect(runFreezer(fixture.root, [], "artifact-partial-append-write"))
      .rejects.toContain(
        "injected freeze publication fault: artifact-partial-append-write",
      );
    expect((await readFile(tempPath)).length).toBeGreaterThan(firstSize);
    expect((await readdir(artifactDirectory)).filter((entry) =>
      entry.startsWith(`${path.basename(artifactPath)}.atomic-`)
        && entry.includes(".tmp.discard.completed-")
    )).toEqual([]);

    await expect(runFreezer(fixture.root)).resolves.toContain('"recovered":true');
    await expect(fileExists(tempPath)).resolves.toBe(false);
  });

  it.each([
    "snapshot-after-temp-ready",
    "snapshot-after-replace-commit",
    "artifact-after-temp-ready",
    "artifact-after-replace-commit",
    "artifact-after-displaced-tombstone",
    "transaction-unlink-after-tombstone",
    "transaction-unlink-after-completed-marker",
  ])("recovers the leaf-bound state machine after %s", async (fault) => {
    const fixture = await createFixture();
    await expect(runFreezer(fixture.root, [], fault)).rejects.toContain(
      `injected freeze publication fault: ${fault}`,
    );

    await expect(runFreezer(fixture.root)).resolves.toContain('"recovered":true');
    await expect(fileExists(path.join(
      fixture.root,
      `${snapshotPath}.freeze-transaction.json`,
    ))).resolves.toBe(false);
    await expect(fileExists(path.join(
      fixture.root,
      `${snapshotPath}.freeze-transaction.json.remove.tombstone`,
    ))).resolves.toBe(false);
  });

  it.each([
    ["artifact-leaf-temp-swap", `${path.basename(artifactPath)}.atomic-`],
    ["artifact-leaf-target-swap", `${path.basename(artifactPath)}.leaf-preserved`],
    [
      "transaction-unlink-leaf-swap",
      `${path.basename(snapshotPath)}.freeze-transaction.json.leaf-preserved`,
    ],
  ] as const)(
    "preserves both inodes and converges after the real leaf swap %s",
    async (fault, preservedPattern) => {
      const fixture = await createFixture();
      const originalArtifactBytes = await readFile(path.join(fixture.root, artifactPath));
      await expect(runFreezer(fixture.root, [], fault)).rejects.toContain(
        "descriptor-anchored operation failed",
      );

      const governanceDirectory = path.dirname(path.join(fixture.root, artifactPath));
      const preserved = (await readdir(governanceDirectory)).filter((entry) =>
        preservedPattern.endsWith(".leaf-preserved")
          ? entry === preservedPattern
          : entry.startsWith(preservedPattern) && entry.endsWith(".tmp.leaf-preserved")
      );
      expect(preserved).toHaveLength(1);
      await expect(readFile(path.join(governanceDirectory, preserved[0]!)))
        .resolves.toEqual(Buffer.from("descriptor leaf swap sentinel\n"));
      if (fault.startsWith("artifact-")) {
        await expect(readFile(path.join(fixture.root, artifactPath)))
          .resolves.toEqual(originalArtifactBytes);
      }

      await expect(runFreezer(fixture.root)).resolves.toContain('"recovered":true');
    },
  );

  it("retires no swapped-in leaf and preserves both A and C", async () => {
    const fixture = await createFixture();
    await expect(runFreezer(
      fixture.root,
      [],
      "transaction-unlink-leaf-tombstone-swap",
    )).rejects.toContain("atomic retirement");
    const tombstonePath = path.join(
      fixture.root,
      `${snapshotPath}.freeze-transaction.json.remove.tombstone`,
    );
    const transaction = await readJson(tombstonePath);
    expect(transaction.kind).toBe("conversation-disclosure-review-freeze-transaction");
    const preservedPath = `${tombstonePath}.leaf-preserved`;
    await expect(readFile(preservedPath)).resolves.toEqual(
      Buffer.from("descriptor leaf swap sentinel\n"),
    );

    await expect(runFreezer(fixture.root)).resolves.toContain('"recovered":true');
    await expect(fileExists(tombstonePath)).resolves.toBe(false);
    await expect(readFile(preservedPath)).resolves.toEqual(
      Buffer.from("descriptor leaf swap sentinel\n"),
    );
  });

  it("preserves swapped-in C and its hardlink alias across retirement and retry", async () => {
    const fixture = await createFixture();
    await expect(runFreezer(
      fixture.root,
      [],
      "transaction-unlink-leaf-tombstone-hardlink-swap",
    )).rejects.toContain("exactly one hard link");
    const tombstonePath = path.join(
      fixture.root,
      `${snapshotPath}.freeze-transaction.json.remove.tombstone`,
    );
    const aBefore = await lstat(tombstonePath);
    const aBytes = await readFile(tombstonePath);
    expect((await readJson(tombstonePath)).kind)
      .toBe("conversation-disclosure-review-freeze-transaction");
    const cAlias = `${tombstonePath}.leaf-preserved`;
    const cEntry = `${tombstonePath}.leaf-entry-preserved`;
    const initial = await Promise.all([lstat(cAlias), lstat(cEntry)]);
    expect(initial[0].ino).toBe(initial[1].ino);
    expect(initial.map((entry) => entry.nlink)).toEqual([2, 2]);
    await expect(readFile(cAlias)).resolves.toEqual(
      Buffer.from("descriptor leaf swap sentinel\n"),
    );
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "zerox-cd03-freeze-swapped-c-"));
    roots.push(outsideRoot);
    const outsideAlias = path.join(outsideRoot, "swapped-c-external-alias");
    await link(cAlias, outsideAlias);
    const before = await Promise.all([lstat(cAlias), lstat(cEntry), lstat(outsideAlias)]);
    expect(new Set(before.map((entry) => entry.ino)).size).toBe(1);
    expect(before.map((entry) => entry.nlink)).toEqual([3, 3, 3]);
    const cBytes = await readFile(outsideAlias);

    await expect(runFreezer(fixture.root)).resolves.toContain('"recovered":true');
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

  it("anchors snapshot replace to the opened parent when the pathname is swapped", async () => {
    const fixture = await createFixture();
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "zerox-cd03-freeze-outside-"));
    roots.push(outsideRoot);
    const outsideTarget = path.join(outsideRoot, path.basename(snapshotPath));
    const sentinel = Buffer.from("outside snapshot sentinel\n");
    await writeFile(outsideTarget, sentinel);

    await expect(runFreezer(fixture.root, [], undefined, {
      ZEROX_CD03_FREEZE_TEST_PARENT_SWAP: outsideRoot,
    })).rejects.toContain("review snapshot publication parent directory identity changed");
    await expect(readFile(outsideTarget)).resolves.toEqual(sentinel);
  });

  it("anchors transaction unlink to the opened parent when the pathname is swapped", async () => {
    const fixture = await createFixture();
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "zerox-cd03-freeze-unlink-"));
    roots.push(outsideRoot);
    const transactionName = `${path.basename(snapshotPath)}.freeze-transaction.json`;
    const outsideTarget = path.join(outsideRoot, transactionName);
    const sentinel = Buffer.from("outside transaction sentinel\n");
    await writeFile(outsideTarget, sentinel);

    await expect(runFreezer(fixture.root, [], undefined, {
      ZEROX_CD03_FREEZE_TEST_REMOVE_PARENT_SWAP: outsideRoot,
    })).rejects.toContain(
      "completed freeze publication transaction parent directory identity changed",
    );
    await expect(readFile(outsideTarget)).resolves.toEqual(sentinel);
  });

  it("rejects a real outside hardlink without mutating its alias", async () => {
    const fixture = await createFixture();
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "zerox-cd03-hardlink-"));
    roots.push(outsideRoot);
    const outsideAlias = path.join(outsideRoot, "artifact-alias.json");
    const originalBytes = await readFile(path.join(fixture.root, artifactPath));
    await link(path.join(fixture.root, artifactPath), outsideAlias);

    await expect(runFreezer(fixture.root)).rejects.toContain(
      "CD03 artifact must have exactly one hard link",
    );
    await expect(readFile(outsideAlias)).resolves.toEqual(originalBytes);
    await expect(fileExists(path.join(fixture.root, snapshotPath))).resolves.toBe(false);
  });
});

type FreezeFixture = {
  root: string;
  program: Record<string, any>;
  featureList: { schemaVersion: number; features: Array<Record<string, any>> };
  artifact: Record<string, any>;
  featureFiles: string[];
  immutablePaths: string[];
  claims: Record<string, unknown>;
};

async function createFixture(): Promise<FreezeFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "zerox-cd03-freeze-"));
  roots.push(root);
  await Promise.all([
    mkdir(path.join(root, ".zerox", "verification", "conversation-disclosure"), {
      recursive: true,
    }),
    mkdir(path.join(root, "scripts"), { recursive: true }),
  ]);
  const featureId = "P107-freeze-fixture";
  const featureFiles = [
    "zeta.txt",
    artifactPath,
    programPath,
    featureListPath,
    "scripts/freeze-conversation-disclosure-review.mjs",
    "scripts/conversation-disclosure-review-contract.mjs",
    "alpha.txt",
  ];
  const mutablePaths = [
    artifactPath,
    programPath,
    featureListPath,
    snapshotPath,
  ];
  const contract = {
    schemaVersion: 1,
    kind: "reviewed_shadow",
    primaryArtifact: artifactPath,
    requiredSafety: {
      featureArrayAuthorityPreserved: true,
      immutableProjectionUsedAsFeatureDigest: false,
    },
    postReviewMutablePaths: mutablePaths,
  };
  const program = {
    schemaVersion: 1,
    programId: "conversation-disclosure-freeze-fixture",
    status: "active",
    activeFeatureId: featureId,
    nextFeatureId: featureId,
    workstreams: [{
      id: "CD03",
      featureId,
      state: "in_progress",
      completionContract: contract,
    }],
  };
  const featureList = {
    schemaVersion: 1,
    features: [{ id: featureId, status: "in_progress", files: featureFiles }],
  };
  const claims = {
    implementationBoundary: { mode: "fixture", disclosureProjectionCutover: false },
    sources: ["alpha.txt", "zeta.txt"],
    characterizations: [{ id: "C01", result: "passed", evidence: "fixture" }],
    verification: [{ id: "focused", result: "passed", command: "fixture" }],
    safety: contract.requiredSafety,
    rollback: "fixture rollback",
  };
  const artifact = {
    schemaVersion: 1,
    artifactId: "CD03-causal-shadow",
    programId: program.programId,
    featureId,
    status: "review_pending",
    ...claims,
    reviewSnapshot: { round: 17, digest: hashCanonical("old snapshot") },
    independentReview: {
      status: "pending",
      round,
      closureManifestPath:
        ".zerox/verification/conversation-disclosure/CD03-round18-closure-manifest.json",
      history: [],
    },
  };
  const immutableContents = new Map([
    ["alpha.txt", "alpha immutable bytes\n"],
    ["zeta.txt", "zeta immutable bytes\n"],
    [
      "scripts/freeze-conversation-disclosure-review.mjs",
      await readFile(freezeSourcePath, "utf8"),
    ],
    [
      "scripts/conversation-disclosure-review-contract.mjs",
      await readFile(reviewContractSourcePath, "utf8"),
    ],
  ]);
  await Promise.all(
    [...immutableContents].map(([relativePath, content]) =>
      writeFile(path.join(root, relativePath), content, "utf8")
    ),
  );
  const fixture = {
    root,
    program,
    featureList,
    artifact,
    featureFiles,
    immutablePaths: [...immutableContents.keys()].sort(),
    claims,
  };
  await persistFixtureGovernance(fixture);
  return fixture;
}

async function persistFixtureGovernance(fixture: FreezeFixture): Promise<void> {
  await Promise.all([
    writeJson(path.join(fixture.root, programPath), fixture.program),
    writeJson(path.join(fixture.root, featureListPath), fixture.featureList),
    writeJson(path.join(fixture.root, artifactPath), fixture.artifact),
  ]);
}

async function runFreezer(
  root: string,
  extraArgs: string[] = [],
  fault?: string,
  environment: Record<string, string> = {},
): Promise<string> {
  const args = [
    path.join(root, "scripts", "freeze-conversation-disclosure-review.mjs"),
    ...(extraArgs.includes("--round") ? [] : ["--round", String(round)]),
    ...(extraArgs.includes("--snapshot-path")
      ? []
      : ["--snapshot-path", snapshotPath]),
    ...extraArgs,
  ];
  try {
    const result = await execFileAsync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        ...environment,
        ...(fault ? { ZEROX_CD03_FREEZE_TEST_FAULT: fault } : {}),
      },
    });
    return result.stdout;
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw `${failure.stdout ?? ""}${failure.stderr ?? ""}${failure.message}`;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, any>;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

function hashCanonical(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "boolean" || typeof value === "number"
    || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  throw new TypeError(`unsupported canonical JSON value: ${typeof value}`);
}
