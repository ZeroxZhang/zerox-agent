import { readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { describe, expect, test } from "vitest";

const contract = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-continuation-contract-v8.mjs"
);
const runtimeIo = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-continuation-runtime-io-v8.mjs"
);

const root = path.resolve(__dirname, "../..");
const zeroDigest = `sha256:${"0".repeat(64)}`;

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

function rehash<T extends Record<string, unknown>>(value: T): T & { digest: string } {
  const copy = structuredClone(value) as T & { digest?: string };
  delete copy.digest;
  copy.digest = contract.hashCanonicalV8(copy);
  return copy as T & { digest: string };
}

function makeRound7Rejection() {
  return contract.withCanonicalDigestV8({
    schemaVersion: 8,
    kind: contract.CONTINUATION_V8_REVIEW_REJECTION_KIND,
    algorithm: contract.CONTINUATION_V8_ALGORITHM,
    programId: "conversation-progressive-disclosure-v3.9.2-2026-08",
    workstreamId: contract.CONTINUATION_V8_WORKSTREAM_ID,
    featureId: contract.CONTINUATION_V8_FEATURE_ID,
    rejectedRound: contract.CONTINUATION_V8_REJECTED_ROUND,
    recoveryRound: contract.CONTINUATION_V8_ROUND,
    status: "rejected_after_review",
    sourcePolicy: structuredClone(
      contract.CONTINUATION_V8_ROUND7_POLICY_TRUST_ROOT,
    ),
    sourceSnapshot: structuredClone(
      contract.CONTINUATION_V8_ROUND7_SNAPSHOT_TRUST_ROOT,
    ),
    completedReceipts: contract.CONTINUATION_V8_ROUND7_RECEIPT_TRUST_ROOTS.map(
      (entry: Record<string, unknown>) => structuredClone(entry),
    ),
    findingIds: [...contract.CONTINUATION_V8_ROUND7_FINDING_IDS],
    findingSetDigest: contract.CONTINUATION_V8_ROUND7_FINDING_SET_DIGEST,
    aggregateFindingCounts: structuredClone(
      contract.CONTINUATION_V8_ROUND7_AGGREGATE_FINDING_COUNTS,
    ),
    repositoryForbiddenOutputs: [
      ...contract.CONTINUATION_V8_ROUND7_REPOSITORY_FORBIDDEN_OUTPUT_PATHS,
    ],
    externalAnchorRule: contract.expectedRejectedRound7AnchorRuleV8(),
    priorRejections: {
      round1CanonicalDigest: contract.CONTINUATION_V8_ROUND1_REJECTION_DIGEST,
      round2: structuredClone(
        contract.CONTINUATION_V8_ROUND2_REJECTION_TRUST_ROOT,
      ),
    },
  });
}

function makeArchive() {
  const source = readJson(
    ".zerox/verification/conversation-disclosure/CD03A-round7-baseline-archive.json",
  );
  return rehash({
    ...source,
    schemaVersion: 8,
    kind: contract.CONTINUATION_V8_BASELINE_ARCHIVE_KIND,
    round: 8,
  });
}

function makePolicy() {
  const source = readJson(
    ".zerox/verification/conversation-disclosure/CD03A-round7-successor-evolution-policy.json",
  );
  const rejection = makeRound7Rejection();
  const archive = makeArchive();
  const admission = structuredClone(source.admission);
  const transitions = contract.CONTINUATION_V8_GOVERNANCE_TRANSITION_TRUST_ROOTS
    .map((entry: Record<string, unknown>) => structuredClone(entry));
  admission.reviewOutputPaths = [
    ...contract.CONTINUATION_V8_REVIEW_OUTPUT_PATHS,
  ];
  admission.featureDefinition.files = [...new Set([
    ...admission.featureDefinition.files,
    contract.CONTINUATION_V8_ROUND7_REVIEW_REJECTION_PATH,
    contract.CONTINUATION_V8_BASELINE_ARCHIVE_PATH,
    contract.CONTINUATION_V8_POLICY_PATH,
    ...Object.values(
      contract.CONTINUATION_V8_EXECUTABLE_PATH_BY_KIND as Record<string, string>,
    ),
    ...transitions.map((entry: any) => entry.stagedTargetPath),
    ...contract.CONTINUATION_V8_REVIEW_OUTPUT_PATHS,
    ...contract.CONTINUATION_V8_REJECTED_OUTPUT_ABSENT_PATHS,
  ])].sort();
  admission.featureDefinitionDigest = contract.hashCanonicalV8(
    admission.featureDefinition,
  );
  admission.featureFileSetDigest = contract.hashCanonicalV8(
    admission.featureDefinition.files,
  );
  const admissionCoverage = contract.buildAdmissionCoverageV8(
    admission,
    transitions,
  );
  admission.reviewCoverageDigest = contract.hashCanonicalV8(admissionCoverage);
  const continuationExecutables = contract.CONTINUATION_V8_EXECUTABLE_KINDS.map(
    (kind: string, index: number) => ({
      kind,
      path: contract.CONTINUATION_V8_EXECUTABLE_PATH_BY_KIND[kind],
      sha256: `sha256:${String(index + 1).repeat(64).slice(0, 64)}`,
    }),
  );
  const trustRoots = [
    ...transitions.map((entry: any) => ({
      path: entry.path,
      sha256: entry.toSha256,
    })),
    ...continuationExecutables.map((entry: any) => ({
      path: entry.path,
      sha256: entry.sha256,
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));
  return contract.withCanonicalDigestV8({
    schemaVersion: 8,
    kind: contract.CONTINUATION_V8_POLICY_KIND,
    algorithm: contract.CONTINUATION_V8_ALGORITHM,
    policyId: contract.CONTINUATION_V8_POLICY_ID,
    programId: source.programId,
    workstreamId: contract.CONTINUATION_V8_WORKSTREAM_ID,
    featureId: contract.CONTINUATION_V8_FEATURE_ID,
    round: contract.CONTINUATION_V8_ROUND,
    status: "frozen",
    parentEvidence: structuredClone(source.parentEvidence),
    round1Rejection: structuredClone(source.round1Rejection),
    round2PrefreezeRejection: structuredClone(source.round2PrefreezeRejection),
    round7ReviewRejection: rejection,
    closedWorld: structuredClone(source.closedWorld),
    admission,
    admissionClassSet: [...contract.CONTINUATION_V8_ADMISSION_CLASSES],
    admissionClassSetDigest:
      contract.CONTINUATION_V8_ADMISSION_CLASS_SET_DIGEST,
    admissionCoverage,
    successor: structuredClone(source.successor),
    pathAuthorities: structuredClone(source.pathAuthorities),
    trustRoots,
    governanceTransitions: transitions,
    continuationExecutables,
    baselineArchive: {
      path: contract.CONTINUATION_V8_BASELINE_ARCHIVE_PATH,
      digest: archive.digest,
      entrySetDigest: archive.entrySetDigest,
    },
    reviewSnapshot: { path: contract.CONTINUATION_V8_REVIEW_SNAPSHOT_PATH },
    reviewAssurancePolicy: {
      callerDispatchAssurance:
        contract.CONTINUATION_V8_CALLER_DISPATCH_ASSURANCE,
      identityAssurance: contract.CONTINUATION_V8_IDENTITY_ASSURANCE,
      independenceClaim: contract.CONTINUATION_V8_INDEPENDENCE_CLAIM,
      localIdentityProof: false,
    },
    externalAnchorPolicy: contract.expectedRejectedRound7AnchorRuleV8(),
    timePolicy: { futureToleranceMs: 0 },
  });
}

function makeSnapshot(policy: any) {
  const frozenFiles = policy.admissionCoverage
    .filter((entry: any) => entry.class === "frozen_file")
    .map((entry: any) => ({ path: entry.path, sha256: zeroDigest }));
  const frozen = new Map<string, { path: string; sha256: string }>(
    frozenFiles.map((entry: any) => [entry.path, entry]),
  );
  for (const reference of [
    contract.CONTINUATION_V8_ROUND7_POLICY_TRUST_ROOT,
    contract.CONTINUATION_V8_ROUND7_SNAPSHOT_TRUST_ROOT,
    ...contract.CONTINUATION_V8_ROUND7_RECEIPT_TRUST_ROOTS,
  ]) {
    frozen.get(reference.path)!.sha256 = reference.byteSha256;
  }
  frozen.get(
    contract.CONTINUATION_V8_ROUND7_REVIEW_REJECTION_PATH,
  )!.sha256 = contract.sha256BytesV8(
    contract.serializeRound7ReviewRejectionV8(
      policy.round7ReviewRejection,
    ),
  );
  const baselineFiles: Array<{ path: string; sha256: string }> = [];
  const absentPaths = new Set<string>(
    contract.CONTINUATION_V8_REJECTED_OUTPUT_ABSENT_PATHS,
  );
  for (const authority of policy.pathAuthorities) {
    if (
      authority.class === "modify"
      && authority.baseline.source === "cd03a_review_snapshot"
    ) {
      baselineFiles.push({
        path: authority.path,
        sha256: authority.baseline.sha256,
      });
    } else if (authority.class === "create") {
      absentPaths.add(authority.path);
    } else if (authority.class === "bookkeeping") {
      if (authority.baseline.presence === "present") {
        baselineFiles.push({
          path: authority.path,
          sha256: authority.baseline.sha256,
        });
      } else {
        absentPaths.add(authority.path);
      }
    }
  }
  frozenFiles.sort((left: any, right: any) =>
    left.path.localeCompare(right.path));
  baselineFiles.sort((left, right) => left.path.localeCompare(right.path));
  return contract.withCanonicalDigestV8({
    schemaVersion: 8,
    kind: contract.CONTINUATION_V8_SNAPSHOT_KIND,
    algorithm: contract.CONTINUATION_V8_ALGORITHM,
    programId: policy.programId,
    workstreamId: contract.CONTINUATION_V8_WORKSTREAM_ID,
    featureId: contract.CONTINUATION_V8_FEATURE_ID,
    round: contract.CONTINUATION_V8_ROUND,
    frozenAt: "2026-08-24T00:00:00.000Z",
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    policyDigest: policy.digest,
    closedWorldDigest: policy.closedWorld.digest,
    pathAuthorityDigest: contract.hashCanonicalV8(policy.pathAuthorities),
    admissionClassSetDigest: policy.admissionClassSetDigest,
    admissionFeatureDefinitionDigest:
      policy.admission.featureDefinitionDigest,
    admissionFeatureFileSetDigest: policy.admission.featureFileSetDigest,
    successorWorkstreamDefinitionDigest:
      policy.successor.workstreamDefinitionDigest,
    successorFeatureDefinitionDigest:
      policy.successor.featureDefinitionDigest,
    round7ReviewRejectionDigest: policy.round7ReviewRejection.digest,
    baselineArchive: policy.baselineArchive,
    frozenFiles,
    transitionPayloadFiles: policy.governanceTransitions
      .map((entry: any) => ({
        path: entry.stagedTargetPath,
        sha256: entry.toSha256,
      }))
      .sort((left: any, right: any) =>
        left.path.localeCompare(right.path)),
    baselineFiles,
    absentPaths: [...absentPaths].sort(),
    reviewOutputAbsentPaths: [...policy.admission.reviewOutputPaths],
    governanceTransitions: policy.governanceTransitions,
  });
}

function makeReceipt(policy: any, snapshot: any) {
  const dispatchEntry = {
    lane: "contract",
    assurance: contract.CONTINUATION_V8_CALLER_DISPATCH_ASSURANCE,
    challenge: `sha256:${"a".repeat(64)}`,
    instructionDigest: `sha256:${"b".repeat(64)}`,
    reviewContextId: "review-context-contract",
    taskPath: "caller/contract",
    agentLabel: "claimed-reviewer",
    transport: "codex-collaboration",
  };
  const dispatchSet = [
    dispatchEntry,
    { ...dispatchEntry, lane: "runtime", challenge: `sha256:${"c".repeat(64)}` },
    { ...dispatchEntry, lane: "governance", challenge: `sha256:${"d".repeat(64)}` },
  ];
  return {
    schemaVersion: 8,
    kind: contract.CONTINUATION_V8_RECEIPT_KIND,
    programId: policy.programId,
    workstreamId: contract.CONTINUATION_V8_WORKSTREAM_ID,
    featureId: contract.CONTINUATION_V8_FEATURE_ID,
    round: contract.CONTINUATION_V8_ROUND,
    lane: "contract",
    reviewedPhase: "review_pre_transition",
    challenge: dispatchEntry.challenge,
    callerDispatchEntryDigest: contract.hashCanonicalV8(dispatchEntry),
    callerDispatchSetDigest: contract.hashCanonicalV8(dispatchSet),
    claimedReviewOrigin: {
      taskPath: "caller/contract",
      agentLabel: "claimed-reviewer",
      transport: "codex-collaboration",
    },
    identityAssurance: contract.CONTINUATION_V8_IDENTITY_ASSURANCE,
    independenceClaim: contract.CONTINUATION_V8_INDEPENDENCE_CLAIM,
    completedAt: "2026-08-24T00:00:01.000Z",
    verdict: "passed",
    findingCounts: { critical: 0, major: 0, minor: 0 },
    findings: [],
    snapshotDigest: snapshot.digest,
    snapshotFileCount:
      snapshot.frozenFiles.length
      + snapshot.transitionPayloadFiles.length
      + snapshot.baselineFiles.length,
    policyDigest: policy.digest,
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    closedWorldDigest: policy.closedWorld.digest,
    pathAuthorityDigest: contract.hashCanonicalV8(policy.pathAuthorities),
    admissionFeatureDefinitionDigest:
      policy.admission.featureDefinitionDigest,
    admissionFeatureFileSetDigest: policy.admission.featureFileSetDigest,
    successorWorkstreamDefinitionDigest:
      policy.successor.workstreamDefinitionDigest,
    successorFeatureDefinitionDigest:
      policy.successor.featureDefinitionDigest,
    round7ReviewRejectionDigest: policy.round7ReviewRejection.digest,
    validatorDigest: policy.continuationExecutables[0].sha256,
  };
}

describe("conversation disclosure continuation contract v8", () => {
  test("binds the real runtime I/O API instead of the abandoned adapter", () => {
    expect(contract.validateRuntimeIoCaptureAdapterV8(runtimeIo)).toEqual([]);
    expect(contract.CONTINUATION_V8_RUNTIME_IO_INTERFACE.methods).not.toContain(
      "capturePresent",
    );
  });

  test("validates the exact Round7 rejection and both roots of every source", () => {
    const witness = makeRound7Rejection();
    expect(contract.validateRound7ReviewRejectionV8(witness)).toEqual([]);
    const references = [
      ["sourcePolicy", "byteSha256"],
      ["sourcePolicy", "canonicalDigest"],
      ["sourceSnapshot", "byteSha256"],
      ["sourceSnapshot", "canonicalDigest"],
      ...witness.completedReceipts.flatMap((_: unknown, index: number) => [
        ["completedReceipts", index, "byteSha256"],
        ["completedReceipts", index, "canonicalDigest"],
      ]),
    ];
    for (const reference of references) {
      const mutant = structuredClone(witness);
      let cursor: any = mutant;
      for (const segment of reference.slice(0, -1)) cursor = cursor[segment];
      cursor[reference.at(-1)!] = zeroDigest;
      expect(contract.validateRound7ReviewRejectionV8(rehash(mutant)))
        .not.toEqual([]);
    }
  });

  test("hard-roots the exact ordered six-class set", () => {
    const policy = makePolicy();
    expect(contract.validateContinuationPolicyV8(policy)).toEqual([]);
    for (const classSet of [
      policy.admissionClassSet.slice(1),
      [...policy.admissionClassSet, "candidate_extra"],
      [...policy.admissionClassSet, policy.admissionClassSet[0]],
    ]) {
      const mutant = structuredClone(policy);
      mutant.admissionClassSet = classSet;
      mutant.admissionClassSetDigest = contract.hashCanonicalV8(classSet);
      expect(contract.validateContinuationPolicyV8(rehash(mutant)))
        .toContain("continuation policy admission class set is invalid or stale");
    }
  });

  test("preserves every prior-round rejected output absence", () => {
    const policy = makePolicy();
    const classes = new Map(
      policy.admissionCoverage.map((entry: any) => [entry.path, entry.class]),
    );

    for (const relativePath of [
      ".zerox/verification/conversation-disclosure/CD03A-round1-closure-manifest.json",
      ".zerox/verification/conversation-disclosure/CD03A-round1-external-anchor.json",
      ".zerox/verification/conversation-disclosure/CD03A-round1-external-attestation.json",
      ".zerox/verification/conversation-disclosure/CD03A-round3-closure-manifest.json",
      ".zerox/verification/conversation-disclosure/CD03A-round3-external-attestation.json",
      ".zerox/verification/conversation-disclosure/CD03A-round4-contract-review.json",
      ".zerox/verification/conversation-disclosure/CD03A-round4-runtime-review.json",
      ".zerox/verification/conversation-disclosure/CD03A-round4-closure-manifest.json",
      ".zerox/verification/conversation-disclosure/CD03A-round4-external-attestation.json",
      ".zerox/verification/conversation-disclosure/CD03A-round5-contract-review.json",
      ".zerox/verification/conversation-disclosure/CD03A-round5-runtime-review.json",
      ".zerox/verification/conversation-disclosure/CD03A-round5-closure-manifest.json",
      ".zerox/verification/conversation-disclosure/CD03A-round5-external-attestation.json",
      ".zerox/verification/conversation-disclosure/CD03A-round7-contract-review.json",
      ".zerox/verification/conversation-disclosure/CD03A-round7-closure-manifest.json",
      ".zerox/verification/conversation-disclosure/CD03A-round7-external-attestation.json",
    ]) {
      expect(classes.get(relativePath), relativePath)
        .toBe("rejected_output_absent");
    }
  });

  test("rejects policy key omission and extension", () => {
    const policy = makePolicy();
    const omitted = structuredClone(policy);
    delete omitted.admissionClassSet;
    expect(contract.validateContinuationPolicyV8(omitted))
      .toContain("continuation policy must contain the exact V8 keys");
    const extended = { ...policy, candidateField: true };
    expect(contract.validateContinuationPolicyV8(extended))
      .toContain("continuation policy must contain the exact V8 keys");
  });

  test("validates the V8 archive and snapshot bindings", () => {
    const policy = makePolicy();
    const archive = makeArchive();
    const snapshot = makeSnapshot(policy);
    expect(contract.validateBaselineArchiveV8(archive, policy)).toEqual([]);
    expect(contract.validateContinuationReviewSnapshotV8(snapshot, policy, {
      verifierNow: Date.parse(snapshot.frozenAt),
    })).toEqual([]);
    const mutant = rehash({
      ...snapshot,
      round7ReviewRejectionDigest: zeroDigest,
    });
    expect(contract.validateContinuationReviewSnapshotV8(mutant, policy, {
      verifierNow: Date.parse(snapshot.frozenAt),
    })).toContain(
      "continuation review snapshot round7ReviewRejectionDigest binding is stale",
    );
  });

  test("rejects stronger identity assurance in policy and receipts", () => {
    const policy = makePolicy();
    const policyMutant = structuredClone(policy);
    policyMutant.reviewAssurancePolicy.identityAssurance = "platform-signed";
    expect(contract.validateContinuationPolicyV8(rehash(policyMutant)))
      .toContain(
        "review assurance policy must be honest caller-attested/not-signed",
      );

    const snapshot = makeSnapshot(policy);
    const receipt = makeReceipt(policy, snapshot);
    const callerPin = {
      challenge: receipt.challenge,
      dispatchEntryDigest: receipt.callerDispatchEntryDigest,
      dispatchSetDigest: receipt.callerDispatchSetDigest,
    };
    expect(contract.validateContinuationReviewReceiptV8(
      receipt,
      snapshot,
      policy,
      { callerPin },
    )).toEqual([]);
    const receiptMutant = {
      ...receipt,
      identityAssurance: "platform-signed",
    };
    expect(contract.validateContinuationReviewReceiptV8(
      receiptMutant,
      snapshot,
      policy,
      {
        callerPin: {
          challenge: receiptMutant.challenge,
          dispatchEntryDigest: receiptMutant.callerDispatchEntryDigest,
          dispatchSetDigest: receiptMutant.callerDispatchSetDigest,
        },
      },
    )).toContain(
      "continuation review receipt V8 identity/assurance is invalid",
    );
  });

  test("uses canonical deterministic gzip archive entries", () => {
    const bytes = Buffer.from("round8 baseline\n", "utf8");
    const entry = {
      path: "package.json",
      source: "governance_transition",
      sha256: contract.sha256BytesV8(bytes),
      encoding: "gzip-base64-v1",
      bytes: gzipSync(bytes, { level: 9 } as any).toString("base64"),
    };
    const archive = contract.withCanonicalDigestV8({
      schemaVersion: 8,
      kind: contract.CONTINUATION_V8_BASELINE_ARCHIVE_KIND,
      algorithm: contract.CONTINUATION_V8_ALGORITHM,
      programId: "conversation-progressive-disclosure-v3.9.2-2026-08",
      workstreamId: contract.CONTINUATION_V8_WORKSTREAM_ID,
      featureId: contract.CONTINUATION_V8_FEATURE_ID,
      round: contract.CONTINUATION_V8_ROUND,
      entries: [entry],
      entrySetDigest: contract.hashCanonicalV8([entry]),
    });
    expect(contract.validateBaselineArchiveV8(archive)).toEqual([]);
    const mutant = structuredClone(archive);
    mutant.entries[0].bytes = gzipSync(bytes, { level: 1 } as any)
      .toString("base64");
    expect(contract.validateBaselineArchiveV8(rehash(mutant)).join("\n"))
      .toContain("bytes are invalid or stale");
  });
});
