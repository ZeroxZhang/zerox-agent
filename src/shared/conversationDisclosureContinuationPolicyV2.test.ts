import {
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
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

const builder = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/build-conversation-disclosure-continuation-policy-v2.mjs"
);
const contract = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-continuation-contract-v2.mjs"
);

const sourceRoot = await realpath(process.cwd());
const temporaryRoots: string[] = [];
const verificationDirectory = ".zerox/verification/conversation-disclosure";
const round1PolicyPath = `${verificationDirectory}/CD03A-successor-evolution-policy.json`;
const archivePath = contract.CONTINUATION_V2_BASELINE_ARCHIVE_PATH;
const featureListPath = ".zerox/feature_list.json";
const programPath = ".zerox/conversation-disclosure-program.json";
const targetPathByLivePath: Record<string, string> = {
  "package.json": `${verificationDirectory}/CD03A-round2-package.target.json`,
  "scripts/check-harness-state.mjs":
    `${verificationDirectory}/CD03A-round2-harness.target.mjs`,
  "src/shared/conversationDisclosureProgram.test.ts":
    `${verificationDirectory}/CD03A-round2-program-test.target.ts`,
  "src/shared/packageScripts.test.ts":
    `${verificationDirectory}/CD03A-round2-package-scripts-test.target.ts`,
};
const executablePathByKind: Record<string, string> = {
  checker: "scripts/check-conversation-disclosure-continuation-v2.mjs",
  contract: "scripts/conversation-disclosure-continuation-contract-v2.mjs",
  freezer: "scripts/freeze-conversation-disclosure-continuation-v2.mjs",
  governance: "scripts/conversation-disclosure-program-governance-v2.mjs",
  runner: "scripts/verify-conversation-disclosure-continuation-v2.mjs",
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((entry) =>
    rm(entry, { recursive: true, force: true })));
});

describe("conversation disclosure continuation policy v2 builder", () => {
  it("builds a deterministic contract-valid real-shape policy", async () => {
    const fixture = await createRealShapeFixture();
    const first = await buildFixture(fixture);
    const second = await buildFixture(fixture);

    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.policy.digest).toBe(second.policy.digest);
    expect(contract.validateContinuationPolicyV2(first.policy, {
      expectedDigest: first.policy.digest,
      baselineArchive: fixture.archive,
    })).toEqual([]);
    expect(first.policy.parentEvidence.repositoryEvidence).toHaveLength(17);
    expect(first.policy.parentEvidence.externalEvidence.map(
      (entry: { role: string }) => entry.role,
    )).toEqual(contract.CONTINUATION_V2_EXTERNAL_EVIDENCE_ROLES);
    expect(first.policy.closedWorld.workstreams).toHaveLength(10);
    expect(first.policy.closedWorld.historicalFeatures).toHaveLength(149);
    expect(first.policy.closedWorld.lifecycleProfiles.map(
      (entry: { phase: string }) => entry.phase,
    )).toEqual(contract.CONTINUATION_V2_LIFECYCLE_PHASES);
    expect(first.policy.closedWorld.programRootDefinitionDigest).toBe(
      contract.hashCanonicalV2(first.policy.closedWorld.programRootDefinition),
    );
    expect(first.policy.successor.featureDefinition.files).toHaveLength(38);
    expect(first.policy.successor.featureDefinition.verification).toEqual(
      expect.arrayContaining([
        builder.CONTINUATION_POLICY_V2_SUCCESSOR_CHECKER_VERIFICATION,
        builder.CONTINUATION_POLICY_V2_SUCCESSOR_HARNESS_VERIFICATION,
      ]),
    );
    expect(first.policy.successor.featureDefinition.verification.some(
      (entry: string) =>
        entry.includes("scripts/check-conversation-disclosure-continuation.mjs"),
    )).toBe(false);
    expect(countAuthorities(first.policy.pathAuthorities)).toEqual({
      modify: 17,
      create: 12,
      bookkeeping: 9,
    });
    expect(first.policy.admission.featureDefinition.files).toEqual(
      fixture.featureList.features.find(
        (entry: { id: string }) => entry.id === contract.CONTINUATION_V2_FEATURE_ID,
      ).files,
    );
  });

  it("rejects an unknown Feature instead of self-authorizing the roster", async () => {
    const fixture = await createRealShapeFixture();
    fixture.featureList.features.push({
      id: "P999-unknown-completed",
      priority: 999,
      title: "Unknown",
      files: ["src/unknown.ts"],
      definitionOfDone: ["unknown"],
      verification: ["unknown"],
      status: "done",
    });
    await writeJson(path.join(fixture.root, featureListPath), fixture.featureList);

    await expect(buildFixture(fixture)).rejects.toThrow(
      "historical Feature roster/order differs from the builder trust root",
    );
  });

  it("rejects P107A ordered-path and full-definition drift against hard constants", async () => {
    const extraPathFixture = await createRealShapeFixture();
    const extraPathAdmission = extraPathFixture.featureList.features.find(
      (entry: { id: string }) => entry.id === contract.CONTINUATION_V2_FEATURE_ID,
    );
    extraPathAdmission.files.push("src/shared/unreviewed-authority.ts");
    await writeJson(
      path.join(extraPathFixture.root, featureListPath),
      extraPathFixture.featureList,
    );
    await expect(buildFixture(extraPathFixture)).rejects.toThrow(
      "live P107A admission differs from the closed-world builder trust root",
    );

    const definitionFixture = await createRealShapeFixture();
    const definitionAdmission = definitionFixture.featureList.features.find(
      (entry: { id: string }) => entry.id === contract.CONTINUATION_V2_FEATURE_ID,
    );
    definitionAdmission.title = `${definitionAdmission.title} drift`;
    await writeJson(
      path.join(definitionFixture.root, featureListPath),
      definitionFixture.featureList,
    );
    await expect(buildFixture(definitionFixture)).rejects.toThrow(
      "live P107A admission differs from the closed-world builder trust root",
    );
  });

  it("rejects Round1 receipt byte drift and forbidden PASS-output preplanting", async () => {
    const receiptFixture = await createRealShapeFixture();
    const receiptPath = path.join(
      receiptFixture.root,
      verificationDirectory,
      "CD03A-round1-contract-review.json",
    );
    await appendBytes(receiptPath, "\n");
    await expect(buildFixture(receiptFixture)).rejects.toThrow(
      "Round1 contract receipt differs from the failed trust root",
    );

    const forbiddenFixture = await createRealShapeFixture();
    const forbiddenPath = contract.CONTINUATION_V2_ROUND1_FORBIDDEN_OUTPUT_PATHS[0];
    await writeJson(path.join(forbiddenFixture.root, forbiddenPath), {
      planted: true,
    });
    await expect(buildFixture(forbiddenFixture)).rejects.toThrow(
      `forbidden Round1 output is present: ${forbiddenPath}`,
    );
  });

  it("rejects archive omission and successor path-coverage drift", async () => {
    const omittedArchive = await createRealShapeFixture();
    omittedArchive.archive.entries = omittedArchive.archive.entries.filter(
      (entry: { source: string; path: string }) => entry.source === "governance_transition"
        || entry.path !== omittedArchive.archive.entries.find(
          (candidate: { source: string; path: string }) =>
            candidate.source !== "governance_transition",
        ).path,
    );
    resignArchive(omittedArchive.archive);
    await writeJson(path.join(omittedArchive.root, archivePath), omittedArchive.archive);
    await expect(buildFixture(omittedArchive)).rejects.toThrow(
      "Round2 archive must bind exactly 17 modify paths",
    );

    const badCoverage = await createRealShapeFixture();
    const round1 = JSON.parse(await readFile(
      path.join(badCoverage.root, round1PolicyPath),
      "utf8",
    ));
    round1.successor.featureDefinition.files.pop();
    round1.successor.featureDefinitionDigest = contract.hashCanonicalV2(
      round1.successor.featureDefinition,
    );
    resign(round1);
    await writeJson(path.join(badCoverage.root, round1PolicyPath), round1);
    await expect(buildFixture(badCoverage)).rejects.toThrow(
      "Round1 policy/snapshot differs from the rejection trust root",
    );
  });

  it("rejects a missing or duplicate Round1 v1 verification command", async () => {
    const fixture = await createRealShapeFixture();
    const round1 = await readJson(path.join(fixture.root, round1PolicyPath));
    const verification = round1.successor.featureDefinition.verification as string[];
    const missing = verification.filter((entry) =>
      !entry.startsWith("node scripts/check-conversation-disclosure-continuation.mjs "));
    expect(() => builder.projectSuccessorVerificationV2(missing)).toThrow(
      "exactly one v1 checker and one v1 harness command",
    );

    const oldChecker = verification.find(
      (entry: string) =>
        entry.startsWith("node scripts/check-conversation-disclosure-continuation.mjs "),
    );
    expect(() => builder.projectSuccessorVerificationV2([
      ...verification,
      oldChecker,
    ])).toThrow(
      "exactly one v1 checker and one v1 harness command",
    );
  });

  it("binds target and executable drift into a different policy trust root", async () => {
    const fixture = await createRealShapeFixture();
    const before = await buildFixture(fixture);
    const targetPath = targetPathByLivePath["src/shared/conversationDisclosureProgram.test.ts"];
    await appendBytes(path.join(fixture.root, targetPath), "\n// target drift\n");
    await appendBytes(
      path.join(fixture.root, executablePathByKind.governance),
      "\n// executable drift\n",
    );
    const after = await buildFixture(fixture);

    expect(after.policy.digest).not.toBe(before.policy.digest);
    expect(after.policy.governanceTransitions.find(
      (entry: { path: string }) =>
        entry.path === "src/shared/conversationDisclosureProgram.test.ts",
    ).toSha256).not.toBe(before.policy.governanceTransitions.find(
      (entry: { path: string }) =>
        entry.path === "src/shared/conversationDisclosureProgram.test.ts",
    ).toSha256);
    expect(after.policy.continuationExecutables.find(
      (entry: { kind: string }) => entry.kind === "governance",
    ).sha256).not.toBe(before.policy.continuationExecutables.find(
      (entry: { kind: string }) => entry.kind === "governance",
    ).sha256);
  });

  it("binds Program/scenario semantics but excludes lifecycle and acceptance evidence", async () => {
    const semanticFixture = await createRealShapeFixture();
    const beforeSemantic = await buildFixture(semanticFixture);
    const semanticProgram = await readJson(path.join(semanticFixture.root, programPath));
    semanticProgram.nonGoals[0] = "candidate replacement semantics";
    await writeJson(path.join(semanticFixture.root, programPath), semanticProgram);
    const afterSemantic = await buildFixture(semanticFixture);
    expect(afterSemantic.policy.closedWorld.programRootDefinitionDigest).not.toBe(
      beforeSemantic.policy.closedWorld.programRootDefinitionDigest,
    );

    const lifecycleFixture = await createRealShapeFixture();
    const beforeLifecycle = await buildFixture(lifecycleFixture);
    const lifecycleProgram = await readJson(path.join(lifecycleFixture.root, programPath));
    lifecycleProgram.updatedAt = "2026-08-25T00:00:00.000Z";
    lifecycleProgram.scenarioMatrix[0].acceptanceEvidence.push("new bounded evidence");
    await writeJson(path.join(lifecycleFixture.root, programPath), lifecycleProgram);
    const afterLifecycle = await buildFixture(lifecycleFixture);
    expect(afterLifecycle.policy.closedWorld.programRootDefinitionDigest).toBe(
      beforeLifecycle.policy.closedWorld.programRootDefinitionDigest,
    );
  });

  it("rejects drift in the caller-pinned Round23 evidence chain", async () => {
    const fixture = await createRealShapeFixture();
    const receiptPath = `${verificationDirectory}/CD03-round23-runtime-review.json`;
    const receipt = JSON.parse(await readFile(path.join(fixture.root, receiptPath), "utf8"));
    receipt.reviewAgentId = "drifted-agent";
    await writeJson(path.join(fixture.root, receiptPath), receipt);

    await expect(buildFixture(fixture)).rejects.toThrow(
      "Round23 runtime review chain is stale",
    );
  });

  it("publishes with O_EXCL mode 0600 and permits exact idempotence only", async () => {
    const fixture = await createRealShapeFixture();
    const outputPath = ".zerox/fixture-policy-v2.json";
    const first = await builder.buildConversationDisclosureContinuationPolicyV2({
      repositoryRoot: fixture.root,
      baseAnchorPath: fixture.baseAnchorPath,
      expectedBaseAnchorDigest: fixture.baseAnchor.digest,
      outputPath,
    });
    const second = await builder.buildConversationDisclosureContinuationPolicyV2({
      repositoryRoot: fixture.root,
      baseAnchorPath: fixture.baseAnchorPath,
      expectedBaseAnchorDigest: fixture.baseAnchor.digest,
      outputPath,
    });
    const output = path.join(fixture.root, outputPath);

    expect(second.bytes.equals(first.bytes)).toBe(true);
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    await writeFile(output, "different\n", { mode: 0o600 });
    await expect(builder.buildConversationDisclosureContinuationPolicyV2({
      repositoryRoot: fixture.root,
      baseAnchorPath: fixture.baseAnchorPath,
      expectedBaseAnchorDigest: fixture.baseAnchor.digest,
      outputPath,
    })).rejects.toThrow("--output already exists with different bytes");
  });
});

async function createRealShapeFixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "cd03a-policy-v2-"));
  const temporaryRoot = await realpath(temporary);
  temporaryRoots.push(temporaryRoot);
  const root = path.join(temporaryRoot, "repository");
  const externalRoot = path.join(temporaryRoot, "external");
  await mkdir(root, { recursive: true });
  await mkdir(externalRoot, { recursive: true, mode: 0o700 });

  const evidenceNames = await readdir(path.join(sourceRoot, verificationDirectory));
  const sourceArchive = await readJson(path.join(sourceRoot, archivePath));
  const markerPaths = evidenceNames.filter((name) =>
    (name.startsWith("CD03-causal-shadow.json.atomic-")
      || name.startsWith("CD03-round23-review-snapshot.json.freeze-transaction.json.remove.tombstone.completed-")
      || name.startsWith("CD03-round23-closure-manifest.json.atomic-"))
      && name.endsWith(".marker"))
    .map((name) => `${verificationDirectory}/${name}`);
  const copyPaths = new Set<string>([
    archivePath,
    round1PolicyPath,
    contract.CONTINUATION_V2_ROUND1_SNAPSHOT_PATH,
    ...contract.CONTINUATION_V2_REVIEW_LANES.map(
      (lane: string) =>
        `${verificationDirectory}/CD03A-round1-${lane}-review.json`,
    ),
    featureListPath,
    programPath,
    ...contract.CONTINUATION_V2_REQUIRED_PARENT_REPOSITORY_PATHS,
    ...markerPaths,
    ...Object.keys(contract.CONTINUATION_V2_BOOKKEEPING_VALIDATORS),
    ...Object.keys(contract.CONTINUATION_V2_GOVERNANCE_TRANSITIONS),
    ...sourceArchive.entries.map((entry: { path: string }) => entry.path),
    ...Object.values(targetPathByLivePath),
    ...Object.values(executablePathByKind),
  ]);
  for (const relativePath of copyPaths) {
    try {
      await copyRepositoryFile(relativePath, root);
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  // The live repository now carries the Round3 recovery definition. V2 is a
  // historical contract test, so reconstruct its admission input from the
  // immutable rejected Round2 policy instead of asking the V2 builder to
  // authorize the later live roster.
  const round2Policy = await readJson(path.join(
    sourceRoot,
    contract.CONTINUATION_V2_POLICY_PATH,
  ));
  const historicalFeatureList = await readJson(path.join(root, featureListPath));
  const historicalAdmissionFeature = historicalFeatureList.features.find(
    (entry: { id: string }) => entry.id === contract.CONTINUATION_V2_FEATURE_ID,
  );
  Object.assign(
    historicalAdmissionFeature,
    round2Policy.admission.featureDefinition,
  );
  await writeJson(path.join(root, featureListPath), historicalFeatureList);

  const historicalProgram = await readJson(path.join(root, programPath));
  const historicalAdmissionWorkstream = historicalProgram.workstreams.find(
    (entry: { id: string }) => entry.id === contract.CONTINUATION_V2_WORKSTREAM_ID,
  );
  Object.assign(
    historicalAdmissionWorkstream,
    round2Policy.admission.workstreamDefinition,
  );
  await writeJson(path.join(root, programPath), historicalProgram);
  for (const entry of sourceArchive.entries.filter(
    (candidate: { source: string }) => candidate.source === "governance_transition",
  )) {
    const target = path.join(root, entry.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, gunzipSync(Buffer.from(entry.bytes, "base64")));
  }

  const snapshot = await readJson(path.join(root,
    `${verificationDirectory}/CD03-round23-review-snapshot.json`));
  const attestationPath = path.join(root,
    `${verificationDirectory}/CD03-round23-external-attestation.json`);
  const attestation = await readJson(attestationPath);
  attestation.repositoryRealpath = root;
  resign(attestation);
  await writeJson(attestationPath, attestation);

  const manifestPath = path.join(root,
    `${verificationDirectory}/CD03-round23-closure-manifest.json`);
  const manifest = await readJson(manifestPath);
  manifest.externalAttestation.canonicalDigest = attestation.digest;
  resign(manifest);
  await writeJson(manifestPath, manifest);
  const receipts = await Promise.all(contract.CONTINUATION_V2_REVIEW_LANES.map(
    (lane: string) => readJson(path.join(root,
      `${verificationDirectory}/CD03-round23-${lane}-review.json`)),
  ));
  const baseAnchor = resign({
    schemaVersion: 1,
    kind: "conversation-disclosure-external-anchor",
    trustLevel: "external-caller-pinned-consistency",
    subjectIdentityAssurance: "not-signed",
    repositoryRealpath: root,
    completedAt: attestation.completedAt,
    snapshotDigest: snapshot.digest,
    runnerDigest: manifest.externalRunner.sha256,
    attestationDigest: attestation.digest,
    reviewReceipts: receipts.map((receipt: Record<string, string>) => ({
      lane: receipt.lane,
      canonicalDigest: contract.hashCanonicalV2(receipt),
      challenge: receipt.challenge,
    })),
  });
  const baseAnchorPath = path.join(externalRoot, "CD03-round23-external-anchor.json");
  await writeJson(baseAnchorPath, baseAnchor, 0o600);
  const publication = resign({
    schemaVersion: 1,
    kind: "conversation-disclosure-publication-transaction",
    status: "completed",
    anchorOutputPath: baseAnchorPath,
    externalAnchor: baseAnchor,
    attestation,
    finalManifest: manifest,
  });
  await writeJson(
    `${baseAnchorPath}.publication-transaction.json.remove.tombstone.completed-fixture.marker`,
    publication,
    0o600,
  );
  await copyFile(
    path.join(root, "scripts/verify-conversation-disclosure-closure.mjs"),
    path.join(externalRoot, "verify-conversation-disclosure-closure.mjs"),
  );
  const archive = await readJson(path.join(root, archivePath));
  const featureList = await readJson(path.join(root, featureListPath));
  return { root, baseAnchorPath, baseAnchor, archive, featureList };
}

async function buildFixture(fixture: Record<string, any>) {
  return builder.buildConversationDisclosureContinuationPolicyV2({
    repositoryRoot: fixture.root,
    baseAnchorPath: fixture.baseAnchorPath,
    expectedBaseAnchorDigest: fixture.baseAnchor.digest,
  });
}

async function copyRepositoryFile(relativePath: string, root: string) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(sourceRoot, relativePath), target);
}

async function readJson(absolutePath: string) {
  return JSON.parse(await readFile(absolutePath, "utf8"));
}

async function writeJson(absolutePath: string, value: unknown, mode = 0o644) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, { mode });
}

async function appendBytes(absolutePath: string, suffix: string) {
  const bytes = await readFile(absolutePath);
  await writeFile(absolutePath, Buffer.concat([bytes, Buffer.from(suffix)]));
}

function resign<T extends Record<string, any>>(value: T): T & { digest: string } {
  delete value.digest;
  return Object.assign(value, { digest: contract.hashCanonicalV2(value) });
}

function resignArchive(archive: Record<string, any>) {
  archive.entrySetDigest = contract.hashCanonicalV2(archive.entries);
  resign(archive);
}

function countAuthorities(entries: Array<{ class: string }>) {
  return Object.fromEntries(["modify", "create", "bookkeeping"].map((kind) => [
    kind,
    entries.filter((entry) => entry.class === kind).length,
  ]));
}
