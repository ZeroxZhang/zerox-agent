import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
const contract = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-delta-contract-v13.mjs"
);
const {
  CD04_DELTA_FEATURE_ID,
  CD04_DELTA_PROGRAM_ID,
  CD04_DELTA_REVIEW_LANES,
  CD04_DELTA_REVIEW_OUTPUT_PATHS,
  CD04_DELTA_SCHEMA_VERSION,
  CD04_DELTA_SUCCESSOR_FEATURE_ID,
  CD04_DELTA_SUCCESSOR_WORKSTREAM_ID,
  CD04_DELTA_TRANSITIONS,
  CD04_DELTA_WORKSTREAM_ID,
  hashCanonicalV13,
  validateCd04DeltaAnchorV13,
  validateCd04DeltaManifestV13,
  validateCd04DeltaSnapshotV13,
  validateCd04ReviewArtifactV13,
  validateCd04ReviewOutputV13,
  validateCd04ReviewReceiptV13,
  withCanonicalDigestV13,
} = contract;
const transitionRunner = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/apply-conversation-disclosure-delta-v13.mjs"
);

describe("conversation disclosure CD04 delta V13", () => {
  it("accepts one exact reviewed delta chain", () => {
    const snapshot = makeSnapshot();
    const outputs = Object.fromEntries(
      CD04_DELTA_REVIEW_LANES.map(
        (lane: string) => [lane, makeReviewOutput(snapshot, lane)],
      ),
    );
    const receipts = Object.fromEntries(
      CD04_DELTA_REVIEW_LANES.map(
        (lane: string) => [
          lane,
          makeReceipt(snapshot, lane, outputs[lane]!),
        ],
      ),
    );
    const manifest = makeManifest(snapshot, receipts);
    const anchor = makeAnchor(snapshot, manifest);
    const reviewArtifact = makeReviewArtifact(snapshot, receipts);

    expect(validateCd04DeltaSnapshotV13(snapshot)).toEqual([]);
    for (const lane of CD04_DELTA_REVIEW_LANES) {
      expect(validateCd04ReviewOutputV13(
        outputs[lane],
        snapshot,
        lane,
      )).toEqual([]);
      expect(validateCd04ReviewReceiptV13(
        receipts[lane],
        snapshot,
        lane,
        outputs[lane],
      )).toEqual([]);
    }
    expect(validateCd04DeltaManifestV13(
      manifest,
      snapshot,
      receipts,
    )).toEqual([]);
    expect(validateCd04ReviewArtifactV13(
      reviewArtifact,
      snapshot,
      receipts,
    )).toEqual([]);
    expect(validateCd04DeltaAnchorV13(anchor, manifest, snapshot)).toEqual([]);
  });

  it("rejects finding, transition, parent, and digest drift", () => {
    const snapshot = makeSnapshot();
    const securityOutput = makeReviewOutput(snapshot, "security");
    const failedReceipt = {
      ...makeReceipt(snapshot, "security", securityOutput),
      counts: { critical: 0, major: 1, minor: 0 },
    };
    failedReceipt.digest = hashWithoutDigest(failedReceipt);
    expect(validateCd04ReviewReceiptV13(
      failedReceipt,
      snapshot,
      "security",
      securityOutput,
    )).toContain("security receipt finding counts are invalid");
    const contradictoryOutput = {
      ...securityOutput,
      rawOutput:
        `${snapshot.reviewChallenges.security}\n`
        + "FINAL_VERDICT: FAIL\nFINAL_COUNTS: 0C/1M/0m",
    };
    contradictoryOutput.digest = hashWithoutDigest(contradictoryOutput);
    expect(validateCd04ReviewOutputV13(
      contradictoryOutput,
      snapshot,
      "security",
    )).toContain(
      "security raw review trailer contradicts structured fields",
    );

    const driftedSnapshot = structuredClone(snapshot);
    driftedSnapshot.transitions[0].toSha256 = digest("changed");
    expect(validateCd04DeltaSnapshotV13(driftedSnapshot)).toContain(
      "snapshot digest is invalid",
    );

    const outputs = Object.fromEntries(
      CD04_DELTA_REVIEW_LANES.map(
        (lane: string) => [lane, makeReviewOutput(snapshot, lane)],
      ),
    );
    const receipts = Object.fromEntries(
      CD04_DELTA_REVIEW_LANES.map(
        (lane: string) => [
          lane,
          makeReceipt(snapshot, lane, outputs[lane]!),
        ],
      ),
    );
    const manifest = makeManifest(snapshot, receipts);
    const anchor = {
      ...makeAnchor(snapshot, manifest),
      parentAnchorDigest: digest("different-parent"),
    };
    anchor.digest = hashWithoutDigest(anchor);
    expect(validateCd04DeltaAnchorV13(anchor, manifest, snapshot)).toContain(
      "delta anchor identity is invalid",
    );
    const staleManifest = {
      ...manifest,
      completedAt: "1999-01-01T00:00:00.000Z",
    };
    staleManifest.digest = hashWithoutDigest(staleManifest);
    expect(validateCd04DeltaManifestV13(
      staleManifest,
      snapshot,
      receipts,
    )).toContain("delta manifest chronology is invalid");
    const staleAnchor = {
      ...makeAnchor(snapshot, manifest),
      completedAt: "2000-01-01T00:00:00.000Z",
    };
    staleAnchor.digest = hashWithoutDigest(staleAnchor);
    expect(validateCd04DeltaAnchorV13(
      staleAnchor,
      manifest,
      snapshot,
    )).toContain("delta anchor chronology is invalid");
    expect(validateCd04ReviewArtifactV13(
      "# Rejected\nFINAL_VERDICT: FAIL\nFINAL_COUNTS: 0C/1M/0m",
      snapshot,
      receipts,
    )).toEqual(expect.arrayContaining([
      "CD04 review artifact snapshot binding is invalid",
      "CD04 review artifact final verdict is invalid",
    ]));
  });

  it("keeps the freezer, checker, and transition runner fail-closed", async () => {
    const sources = await Promise.all([
      "scripts/freeze-conversation-disclosure-delta-v13.mjs",
      "scripts/check-conversation-disclosure-program-v13.mjs",
      "scripts/build-conversation-disclosure-delta-anchor-v13.mjs",
      "scripts/apply-conversation-disclosure-delta-v13.mjs",
    ].map((relativePath) =>
      readFile(path.join(process.cwd(), relativePath), "utf8")));
    const combined = sources.join("\n");

    expect(combined).toContain("captureStableFileV12");
    expect(combined).toContain("publishPrivateExactV12");
    expect(combined).toContain("caller-pinned CD04 delta anchor");
    expect(combined).toContain("requiredAbsentPaths");
    expect(combined).toContain("transition live file is third-state");
    expect(combined).toContain("Round12 parent evidence differs");
    expect(combined).toContain("refusing to replace frozen snapshot");
    expect(combined).toContain(
      "receipt is not bound to its review output",
    );
    expect(sources[0]).toContain(
      "node scripts/check-conversation-disclosure-program-v13.mjs && ",
    );
    expect(sources[0]).toContain("node scripts/check-harness-state.mjs");
    expect(sources[0]).not.toContain(
      "check-conversation-disclosure-program-v13.mjs --diagnostic-only",
    );
    expect(combined).toContain("ZEROX_CD04_DELTA_ANCHOR");
    expect(combined).toContain("ZEROX_CD04_DELTA_ANCHOR_DIGEST");
    expect(sources[1]).toContain("postflightCaptureLedgerV12");
    expect(sources[2]).toContain("validateCd04ReviewArtifactV13");
    expect(sources[3]).toContain("src_dir_fd=dir_fd");
    expect(sources[3]).toContain("dst_dir_fd=dir_fd");
    expect(sources[2]).not.toContain(
      "publishPrivateJson(path.resolve(options.deltaAnchor)",
    );
    expect(combined).not.toMatch(
      /^\s*identityAssurance:\s*"platform-signed"/m,
    );
  });

  it("resumes an exact mixed transition after an injected interruption", async () => {
    const repositoryRoot = await realpath(await mkdtemp(
      path.join(os.tmpdir(), "zerox-cd04-v13-transition-"),
    ));
    try {
      const transitions = await Promise.all(
        CD04_DELTA_TRANSITIONS.map(async (
          entry: { path: string; targetPath: string },
          index: number,
        ) => {
          const livePath = path.join(repositoryRoot, entry.path);
          const targetPath = path.join(repositoryRoot, entry.targetPath);
          await Promise.all([
            mkdir(path.dirname(livePath), { recursive: true }),
            mkdir(path.dirname(targetPath), { recursive: true }),
          ]);
          const source = `source-${index}\n`;
          const target = `target-${index}\n`;
          await Promise.all([
            writeFile(livePath, source),
            writeFile(targetPath, target),
          ]);
          return {
            ...entry,
            fromSha256: contract.sha256BytesV13(source),
            toSha256: contract.sha256BytesV13(target),
          };
        }),
      );
      const snapshot = {
        digest: digest("transition-snapshot"),
        frozenEntries: [],
        artifacts: {},
        transitions,
      };
      const finalTarget = path.join(
        repositoryRoot,
        transitions.at(-1)!.targetPath,
      );
      await writeFile(finalTarget, "drifted-target\n");
      await expect(transitionRunner.preflightCd04TransitionV13({
        repositoryRoot,
        snapshot,
      })).rejects.toThrow("transition target drifted");
      expect(await readFile(
        path.join(repositoryRoot, transitions[0]!.path),
        "utf8",
      )).toBe("source-0\n");
      await writeFile(finalTarget, `target-${transitions.length - 1}\n`);
      await expect(transitionRunner.preflightCd04TransitionV13({
        repositoryRoot,
        snapshot,
      })).resolves.toBeUndefined();

      await expect(transitionRunner.applyCd04TransitionFilesV13({
        repositoryRoot,
        snapshot,
        failAfterTransition: 2,
      })).rejects.toThrow("injected transition failure after 2");

      await expect(transitionRunner.applyCd04TransitionFilesV13({
        repositoryRoot,
        snapshot,
      })).resolves.toBeUndefined();
      for (const transition of transitions) {
        expect(contract.sha256BytesV13(
          await readFile(path.join(repositoryRoot, transition.path)),
        )).toBe(transition.toSha256);
      }
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
    }
  });

  it("rejects a parent pathname swap before a descriptor-relative transition", async () => {
    const repositoryRoot = await realpath(await mkdtemp(
      path.join(os.tmpdir(), "zerox-cd04-v13-parent-swap-"),
    ));
    const liveParent = path.join(repositoryRoot, "live");
    const displacedParent = path.join(repositoryRoot, "live-displaced");
    try {
      await Promise.all([
        mkdir(liveParent, { recursive: true }),
        mkdir(path.join(repositoryRoot, "payload"), { recursive: true }),
      ]);
      const source = "source\n";
      const target = "target\n";
      await Promise.all([
        writeFile(path.join(liveParent, "state"), source),
        writeFile(path.join(repositoryRoot, "payload/state"), target),
      ]);
      const snapshot = {
        digest: digest("parent-swap"),
        frozenEntries: [],
        artifacts: {},
        transitions: [{
          path: "live/state",
          targetPath: "payload/state",
          fromSha256: contract.sha256BytesV13(source),
          toSha256: contract.sha256BytesV13(target),
        }],
      };

      await expect(transitionRunner.applyCd04TransitionFilesV13({
        repositoryRoot,
        snapshot,
        async beforeTransitionCommit() {
          await rename(liveParent, displacedParent);
          await mkdir(liveParent);
          await writeFile(path.join(liveParent, "state"), source);
        },
      })).rejects.toThrow("transition parent identity changed");
      expect(await readFile(path.join(liveParent, "state"), "utf8"))
        .toBe(source);
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
    }
  });

  it("rejects a non-canonical applying journal instead of cleaning it", async () => {
    const directory = await realpath(await mkdtemp(
      path.join(os.tmpdir(), "zerox-cd04-v13-journal-"),
    ));
    const journalPath = path.join(directory, "transition.json");
    const identity = {
      schemaVersion: 13,
      kind: "conversation-disclosure-cd04-delta-transition",
      snapshotDigest: digest("journal-snapshot"),
      manifestDigest: digest("journal-manifest"),
      anchorDigest: digest("journal-anchor"),
      repositoryRealpath: directory,
    };
    const completed = {
      ...identity,
      status: "completed",
      checkerReceiptDigest: digest("journal-checker"),
    };
    try {
      await writeFile(journalPath, `${JSON.stringify({
        ...identity,
        status: "applying",
        injected: true,
      }, null, 2)}\n`, { mode: 0o600 });
      await chmod(journalPath, 0o600);

      await expect(
        transitionRunner.publishOrReplaceJournalV13(journalPath, completed),
      ).rejects.toThrow("journal contains third-state bytes");

      await writeFile(journalPath, `${JSON.stringify({
        ...identity,
        status: "applying",
      }, null, 2)}\n`, { mode: 0o600 });
      await expect(
        transitionRunner.publishOrReplaceJournalV13(journalPath, completed),
      ).resolves.toBeUndefined();
      expect(JSON.parse(await readFile(journalPath, "utf8"))).toEqual(completed);
      await expect(
        transitionRunner.publishOrReplaceJournalV13(journalPath, completed),
      ).resolves.toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function makeSnapshot() {
  return withCanonicalDigestV13({
    schemaVersion: CD04_DELTA_SCHEMA_VERSION,
    kind: "conversation-disclosure-cd04-delta-review-snapshot",
    programId: CD04_DELTA_PROGRAM_ID,
    featureId: CD04_DELTA_FEATURE_ID,
    workstreamId: CD04_DELTA_WORKSTREAM_ID,
    frozenAt: "2026-08-25T09:00:00.000Z",
    parent: {
      anchorPath: "/private/tmp/parent.json",
      anchorDigest: makeParentEvidence().digest,
      policyDigest: digest("policy"),
      snapshotDigest: digest("parent-snapshot"),
    },
    artifacts: {
      performance: {
        path: "performance.json",
        canonicalDigest: digest("performance-canonical"),
        sha256: digest("performance-bytes"),
      },
      parity: {
        path: "parity.json",
        canonicalDigest: digest("parity-canonical"),
        sha256: digest("parity-bytes"),
      },
    },
    frozenEntries: [{
      path: "src/main/example.ts",
      sha256: digest("source"),
    }],
    transitions: CD04_DELTA_TRANSITIONS.map((
      entry: { path: string; targetPath: string },
      index: number,
    ) => ({
      ...entry,
      fromSha256: digest(`from-${index}`),
      toSha256: digest(`to-${index}`),
    })),
    reviewLanes: [...CD04_DELTA_REVIEW_LANES],
    reviewChallenges: Object.fromEntries(
      CD04_DELTA_REVIEW_LANES.map(
        (lane: string) => [lane, digest(`challenge-${lane}`)],
      ),
    ),
    requiredAbsentPaths: [
      ".zerox/reviews/CD04-integration-review-output.json",
      ".zerox/reviews/CD04-replay-review-output.json",
      ".zerox/reviews/CD04-security-review-output.json",
      ".zerox/reviews/CD04-shadow-parity-review.md",
      ".zerox/verification/conversation-disclosure/CD04-integration-review.json",
      ".zerox/verification/conversation-disclosure/CD04-replay-review.json",
      ".zerox/verification/conversation-disclosure/CD04-reviewed-delta-manifest.json",
      ".zerox/verification/conversation-disclosure/CD04-security-review.json",
    ],
  });
}

function makeReviewOutput(
  snapshot: ReturnType<typeof makeSnapshot>,
  lane: string,
) {
  return withCanonicalDigestV13({
    schemaVersion: CD04_DELTA_SCHEMA_VERSION,
    kind: "conversation-disclosure-cd04-review-output",
    lane,
    challenge: snapshot.reviewChallenges[lane],
    snapshotDigest: snapshot.digest,
    verdict: "PASS",
    counts: { critical: 0, major: 0, minor: 0 },
    findings: [],
    rawOutput:
      `${snapshot.reviewChallenges[lane]}\n`
      + "FINAL_VERDICT: PASS\nFINAL_COUNTS: 0C/0M/0m",
  });
}

function makeReceipt(
  snapshot: ReturnType<typeof makeSnapshot>,
  lane: string,
  output: ReturnType<typeof makeReviewOutput>,
) {
  return withCanonicalDigestV13({
    schemaVersion: CD04_DELTA_SCHEMA_VERSION,
    kind: "conversation-disclosure-cd04-review-receipt",
    lane,
    assurance: "caller-attested-not-signed",
    challenge: snapshot.reviewChallenges[lane],
    snapshotDigest: snapshot.digest,
    completedAt: "2026-08-25T09:01:00.000Z",
    verdict: "PASS",
    counts: { critical: 0, major: 0, minor: 0 },
    reviewOutputPath: CD04_DELTA_REVIEW_OUTPUT_PATHS[lane],
    reviewOutputDigest: output.digest,
    reviewOutputSha256: digest(`output-bytes-${lane}`),
  });
}

function makeReviewArtifact(
  snapshot: ReturnType<typeof makeSnapshot>,
  receipts: Record<string, ReturnType<typeof makeReceipt>>,
): string {
  return [
    "# CD04 Shadow Parity Review",
    "",
    `Snapshot: ${snapshot.digest}`,
    ...CD04_DELTA_REVIEW_LANES.flatMap((lane: string) => [
      `${lane}: ${receipts[lane]!.digest}`,
      `challenge: ${snapshot.reviewChallenges[lane]}`,
    ]),
    "",
    "FINAL_VERDICT: PASS",
    "FINAL_COUNTS: 0C/0M/0m",
  ].join("\n");
}

function makeManifest(
  snapshot: ReturnType<typeof makeSnapshot>,
  receipts: Record<string, ReturnType<typeof makeReceipt>>,
) {
  const parentEvidence = makeParentEvidence();
  return withCanonicalDigestV13({
    schemaVersion: CD04_DELTA_SCHEMA_VERSION,
    kind: "conversation-disclosure-cd04-reviewed-delta-manifest",
    programId: CD04_DELTA_PROGRAM_ID,
    featureId: CD04_DELTA_FEATURE_ID,
    workstreamId: CD04_DELTA_WORKSTREAM_ID,
    completedAt: "2026-08-25T09:02:00.000Z",
    snapshotDigest: snapshot.digest,
    parentAnchorDigest: snapshot.parent.anchorDigest,
    parentEvidence,
    receiptDigests: Object.fromEntries(
      CD04_DELTA_REVIEW_LANES.map(
        (lane: string) => [lane, receipts[lane]!.digest],
      ),
    ),
    reviewArtifactSha256: digest("review"),
    transitionDigest: hashCanonicalV13(snapshot.transitions),
    head: {
      kind: "reviewed-delta",
      status: "externally_attested",
      completedFeatureId: CD04_DELTA_FEATURE_ID,
      successorFeatureId: CD04_DELTA_SUCCESSOR_FEATURE_ID,
      successorWorkstreamId: CD04_DELTA_SUCCESSOR_WORKSTREAM_ID,
    },
  });
}

function makeParentEvidence() {
  return withCanonicalDigestV13({
    schemaVersion: 12,
    kind: "conversation-disclosure-continuation-external-anchor",
    identityAssurance: "not-signed",
    reviewAssurance: "caller-attested-not-signed",
    repositoryRealpath: process.cwd(),
    completedAt: "2026-08-25T08:00:00.000Z",
    policyDigest: digest("policy"),
    snapshotDigest: digest("parent-snapshot"),
  });
}

function makeAnchor(
  snapshot: ReturnType<typeof makeSnapshot>,
  manifest: ReturnType<typeof makeManifest>,
) {
  return withCanonicalDigestV13({
    schemaVersion: CD04_DELTA_SCHEMA_VERSION,
    kind: "conversation-disclosure-cd04-external-delta-anchor",
    identityAssurance: "not-signed",
    reviewAssurance: "caller-attested-not-signed",
    repositoryRealpath: process.cwd(),
    completedAt: "2026-08-25T09:02:00.000Z",
    snapshotDigest: snapshot.digest,
    manifestDigest: manifest.digest,
    parentAnchorDigest: snapshot.parent.anchorDigest,
    head: manifest.head,
  });
}

function digest(value: string) {
  return hashCanonicalV13(value);
}

function hashWithoutDigest(value: Record<string, unknown>) {
  const { digest: _digest, ...withoutDigest } = value;
  return hashCanonicalV13(withoutDigest);
}
