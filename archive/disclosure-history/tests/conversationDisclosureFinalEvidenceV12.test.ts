import { describe, expect, test } from "vitest";

const contract = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-continuation-contract-v12.mjs"
);

const digest = (character: string) =>
  `sha256:${character.repeat(64).slice(0, 64)}`;

function buildFixture() {
  const policy = {
    programId: "conversation-progressive-disclosure-v3.9.2-2026-08",
    digest: digest("1"),
    parentEvidence: { bundleDigest: digest("2") },
    round11ReviewRejection: { digest: digest("3") },
    successor: {
      workstreamDefinitionDigest: digest("4"),
      featureDefinitionDigest: digest("5"),
    },
    continuationExecutables: [{
      kind: "checker",
      path: "scripts/check-conversation-disclosure-continuation-v12.mjs",
      sha256: digest("6"),
    }],
  };
  const snapshot = {
    digest: digest("7"),
    frozenAt: "2026-08-24T12:00:00.000Z",
  };
  const rejection = { digest: digest("3") };
  const receipts = ["contract", "runtime", "governance"].map((lane, index) => ({
    lane,
    completedAt: `2026-08-24T12:0${index + 1}:00.000Z`,
  }));
  const dispatchSet = ["contract", "runtime", "governance"].map(
    (lane, index) => ({
      lane,
      assurance: "caller-attested-not-signed",
      challenge: digest(String(index + 7)),
      instructionDigest: digest(String(index + 4)),
      reviewContextId: `review-${lane}`,
      taskPath: `round12/${lane}`,
      agentLabel: `round12-${lane}-reviewer`,
      transport: "codex-collaboration",
    }),
  );
  const policyReference = {
    path: contract.CONTINUATION_V12_POLICY_PATH,
    byteSha256: digest("a"),
    canonicalDigest: policy.digest,
  };
  const snapshotReference = {
    path: contract.CONTINUATION_V12_REVIEW_SNAPSHOT_PATH,
    byteSha256: digest("b"),
    canonicalDigest: snapshot.digest,
  };
  const rejectionReference = {
    path: contract.CONTINUATION_V12_ROUND11_REVIEW_REJECTION_PATH,
    byteSha256: digest("c"),
    canonicalDigest: rejection.digest,
  };
  const reviewReferences = receipts.map((receipt, index) => ({
    lane: receipt.lane,
    path:
      `.zerox/verification/conversation-disclosure/CD03A-round12-${receipt.lane}-review.json`,
    challenge: dispatchSet[index].challenge,
    canonicalDigest: digest(String(index + 1)),
  }));
  const validatorReference = {
    path: "scripts/check-conversation-disclosure-continuation-v12.mjs",
    sha256: digest("6"),
  };
  const runnerReference = {
    path: "scripts/verify-conversation-disclosure-continuation-v12.mjs",
    sha256: digest("d"),
  };
  const pendingBase = {
    schemaVersion: 12,
    kind: contract.CONTINUATION_V12_MANIFEST_KIND,
    programId: "conversation-progressive-disclosure-v3.9.2-2026-08",
    workstreamId: contract.CONTINUATION_V12_WORKSTREAM_ID,
    featureId: contract.CONTINUATION_V12_FEATURE_ID,
    round: contract.CONTINUATION_V12_ROUND,
    status: "review_passed_pending_external_transaction",
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    policy: policyReference,
    snapshot: snapshotReference,
    round11ReviewRejection: rejectionReference,
    reviewReceipts: reviewReferences,
    callerDispatchSet: dispatchSet,
    validator: validatorReference,
    externalRunner: runnerReference,
    externalAttestation: {
      path: contract.CONTINUATION_V12_EXTERNAL_ATTESTATION_PATH,
      canonicalDigest: null,
    },
  };
  const pendingManifestDigest =
    contract.pendingManifestDigestV12(pendingBase);
  const pendingManifest = contract.withCanonicalDigestV12({
    ...pendingBase,
    pendingManifestDigest,
  });
  const candidateResults = [
    {
      kind: "checker",
      path: validatorReference.path,
      status: "passed",
      receiptDigest: digest("e"),
      stdoutDigest: digest("f"),
      stderrDigest: digest("0"),
    },
    {
      kind: "harness",
      path: "scripts/check-harness-state.mjs",
      status: "passed",
      receiptDigest: digest("9"),
      stdoutDigest: digest("8"),
      stderrDigest: digest("0"),
    },
  ];
  const attestation = contract.withCanonicalDigestV12({
    schemaVersion: 12,
    kind: contract.CONTINUATION_V12_ATTESTATION_KIND,
    status: "passed",
    governancePhase: "review_post_transition",
    identityAssurance: contract.CONTINUATION_V12_IDENTITY_ASSURANCE,
    reviewAssurance: contract.CONTINUATION_V12_CALLER_DISPATCH_ASSURANCE,
    repositoryRealpath: "/tmp/round12-subject",
    completedAt: "2026-08-24T12:10:00.000Z",
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    pendingManifestDigest,
    policyDigest: policy.digest,
    snapshotDigest: snapshot.digest,
    round11ReviewRejectionDigest: rejection.digest,
    validatorDigest: validatorReference.sha256,
    runnerDigest: runnerReference.sha256,
    callerDispatchSet: dispatchSet,
    candidateResults,
  });
  const finalManifest = contract.withCanonicalDigestV12(
    contract.finalManifestProjectionV12(pendingManifest, attestation.digest),
  );
  const anchor = contract.withCanonicalDigestV12({
    schemaVersion: 12,
    kind: contract.CONTINUATION_V12_ANCHOR_KIND,
    identityAssurance: contract.CONTINUATION_V12_IDENTITY_ASSURANCE,
    reviewAssurance: contract.CONTINUATION_V12_CALLER_DISPATCH_ASSURANCE,
    repositoryRealpath: "/tmp/round12-subject",
    completedAt: "2026-08-24T12:11:00.000Z",
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    policyDigest: policy.digest,
    snapshotDigest: snapshot.digest,
    round11ReviewRejectionDigest: rejection.digest,
    validatorDigest: validatorReference.sha256,
    runnerDigest: runnerReference.sha256,
    attestationDigest: attestation.digest,
    callerDispatchSet: dispatchSet,
    candidateResults,
    head: {
      kind: "successor-admission",
      status: "externally_attested",
      workstreamId: contract.CONTINUATION_V12_WORKSTREAM_ID,
      featureId: contract.CONTINUATION_V12_FEATURE_ID,
      snapshotDigest: snapshot.digest,
      successorWorkstreamDefinitionDigest:
        policy.successor.workstreamDefinitionDigest,
      successorFeatureDefinitionDigest:
        policy.successor.featureDefinitionDigest,
    },
  });
  const manifestBindings = {
    policy,
    policyReference,
    snapshotReference,
    round11ReviewRejectionReference: rejectionReference,
    reviewReferences,
    callerDispatchSet: dispatchSet,
    validatorReference,
    runnerReference,
  };
  const attestationBindings = {
    policy,
    snapshot,
    round11ReviewRejection: rejection,
    pendingManifest,
    callerDispatchSet: dispatchSet,
    receipts,
    candidateResults,
    repositoryRealpath: "/tmp/round12-subject",
    verifierNow: Date.parse("2026-08-24T12:12:00.000Z"),
  };
  const anchorBindings = {
    expectedDigest: anchor.digest,
    attestation,
    policy,
    snapshot,
    round11ReviewRejection: rejection,
    callerDispatchSet: dispatchSet,
    repositoryRealpath: "/tmp/round12-subject",
    verifierNow: Date.parse("2026-08-24T12:12:00.000Z"),
  };
  return {
    policy,
    snapshot,
    rejection,
    receipts,
    dispatchSet,
    candidateResults,
    pendingManifest,
    finalManifest,
    attestation,
    anchor,
    manifestBindings,
    attestationBindings,
    anchorBindings,
  };
}

function rehash<T extends Record<string, any>>(
  value: T,
): T & { digest: string } {
  const clone = structuredClone(value) as T & { digest?: string };
  delete clone.digest;
  clone.digest = contract.hashCanonicalV12(clone);
  return clone as T & { digest: string };
}

describe("conversation disclosure final evidence v12", () => {
  test("accepts one completely bound pending/final/attestation/anchor chain", () => {
    const fixture = buildFixture();
    expect(contract.validateContinuationClosureManifestV12(
      fixture.pendingManifest,
      fixture.manifestBindings,
    )).toEqual([]);
    expect(contract.validateContinuationExternalAttestationV12(
      fixture.attestation,
      fixture.attestationBindings,
    )).toEqual([]);
    expect(contract.validateContinuationClosureManifestV12(
      fixture.finalManifest,
      {
        ...fixture.manifestBindings,
        pendingManifest: fixture.pendingManifest,
        externalAttestation: fixture.attestation,
      },
    )).toEqual([]);
    expect(contract.validateContinuationExternalAnchorV12(
      fixture.anchor,
      fixture.anchorBindings,
    )).toEqual([]);
  });

  test("rejects empty reordered extra failed and wrong-path candidate results", () => {
    const fixture = buildFixture();
    const mutations = [
      [],
      [...fixture.candidateResults].reverse(),
      [...fixture.candidateResults, fixture.candidateResults[0]],
      fixture.candidateResults.map((entry, index) =>
        index === 0 ? { ...entry, status: "failed" } : entry),
      fixture.candidateResults.map((entry, index) =>
        index === 1 ? { ...entry, path: "scripts/other.mjs" } : entry),
    ];
    for (const candidateResults of mutations) {
      const attestation = rehash({
        ...fixture.attestation,
        candidateResults,
      });
      expect(contract.validateContinuationExternalAttestationV12(
        attestation,
        { ...fixture.attestationBindings, candidateResults },
      )).not.toEqual([]);
    }
    const forged = rehash({
      ...fixture.attestation,
      candidateResults: fixture.candidateResults.map((entry, index) =>
        index === 0 ? { ...entry, receiptDigest: digest("a") } : entry),
    });
    expect(contract.validateContinuationExternalAttestationV12(
      forged,
      fixture.attestationBindings,
    )).toContain(
      "external attestation candidate results differ from runner evidence",
    );
  });

  test("rejects future and pre-review attestation time", () => {
    const fixture = buildFixture();
    for (const completedAt of [
      "2999-01-01T00:00:00.000Z",
      "2026-08-24T12:00:30.000Z",
    ]) {
      const attestation = rehash({ ...fixture.attestation, completedAt });
      expect(contract.validateContinuationExternalAttestationV12(
        attestation,
        fixture.attestationBindings,
      )).not.toEqual([]);
    }
  });

  test("rejects every stale attestation semantic root", () => {
    const fixture = buildFixture();
    for (const key of [
      "parentEvidenceBundleDigest",
      "pendingManifestDigest",
      "policyDigest",
      "round11ReviewRejectionDigest",
      "runnerDigest",
      "snapshotDigest",
      "validatorDigest",
    ]) {
      const attestation = rehash({
        ...fixture.attestation,
        [key]: digest("0"),
      });
      expect(contract.validateContinuationExternalAttestationV12(
        attestation,
        fixture.attestationBindings,
      )).not.toEqual([]);
    }
    const dispatch = structuredClone(fixture.attestation.callerDispatchSet);
    dispatch[0].taskPath = "round12/other";
    const attestation = rehash({
      ...fixture.attestation,
      callerDispatchSet: dispatch,
    });
    expect(contract.validateContinuationExternalAttestationV12(
      attestation,
      fixture.attestationBindings,
    )).not.toEqual([]);
  });

  test("rejects any final-manifest change outside status and attestation digest", () => {
    const fixture = buildFixture();
    for (const mutation of [
      { policy: { ...fixture.finalManifest.policy, canonicalDigest: digest("0") } },
      {
        snapshot: {
          ...fixture.finalManifest.snapshot,
          canonicalDigest: digest("0"),
        },
      },
      {
        round11ReviewRejection: {
          ...fixture.finalManifest.round11ReviewRejection,
          canonicalDigest: digest("0"),
        },
      },
      { reviewReceipts: fixture.finalManifest.reviewReceipts.slice(1) },
      { callerDispatchSet: fixture.finalManifest.callerDispatchSet.slice(1) },
      {
        validator: {
          ...fixture.finalManifest.validator,
          sha256: digest("0"),
        },
      },
      {
        externalRunner: {
          ...fixture.finalManifest.externalRunner,
          sha256: digest("0"),
        },
      },
      {
        externalAttestation: {
          ...fixture.finalManifest.externalAttestation,
          canonicalDigest: digest("0"),
        },
      },
      { pendingManifestDigest: digest("0") },
      { programId: "other-program" },
      {
        validator: {
          path: "scripts/other-validator.mjs",
          sha256: fixture.finalManifest.validator.sha256,
        },
      },
      {
        externalRunner: {
          path: "scripts/other-runner.mjs",
          sha256: fixture.finalManifest.externalRunner.sha256,
        },
      },
      {
        externalAttestation: {
          ...fixture.finalManifest.externalAttestation,
          path: ".zerox/verification/conversation-disclosure/other.json",
        },
      },
    ]) {
      const manifest = rehash({ ...fixture.finalManifest, ...mutation });
      expect(contract.validateContinuationClosureManifestV12(manifest, {
        ...fixture.manifestBindings,
        pendingManifest: fixture.pendingManifest,
        externalAttestation: fixture.attestation,
      })).not.toEqual([]);
    }
  });

  test("rejects each arbitrary or completion-claiming anchor head field", () => {
    const fixture = buildFixture();
    const mutations = {
      kind: "completion",
      status: "completed",
      workstreamId: "CD04",
      featureId: "P108-conversation-disclosure-evidence-foundation",
      snapshotDigest: digest("0"),
      successorWorkstreamDefinitionDigest: digest("0"),
      successorFeatureDefinitionDigest: digest("0"),
    };
    for (const [key, value] of Object.entries(mutations)) {
      const anchor = rehash({
        ...fixture.anchor,
        head: { ...fixture.anchor.head, [key]: value },
      });
      expect(contract.validateContinuationExternalAnchorV12(
        anchor,
        { ...fixture.anchorBindings, expectedDigest: anchor.digest },
      )).toContain(
        "external anchor head is not the exact P107A successor-admission head",
      );
    }
  });

  test("rejects stale anchor roots, future time, and missing bindings", () => {
    const fixture = buildFixture();
    for (const key of [
      "attestationDigest",
      "parentEvidenceBundleDigest",
      "policyDigest",
      "round11ReviewRejectionDigest",
      "runnerDigest",
      "snapshotDigest",
      "validatorDigest",
    ]) {
      const rootMutant = rehash({
        ...fixture.anchor,
        [key]: digest("0"),
      });
      expect(contract.validateContinuationExternalAnchorV12(rootMutant, {
        ...fixture.anchorBindings,
        expectedDigest: rootMutant.digest,
      })).not.toEqual([]);
    }
    const dispatch = structuredClone(fixture.anchor.callerDispatchSet);
    dispatch[0].reviewContextId = "other";
    const dispatchMutant = rehash({
      ...fixture.anchor,
      callerDispatchSet: dispatch,
    });
    expect(contract.validateContinuationExternalAnchorV12(dispatchMutant, {
      ...fixture.anchorBindings,
      expectedDigest: dispatchMutant.digest,
    })).not.toEqual([]);
    const candidateMutant = rehash({
      ...fixture.anchor,
      candidateResults: fixture.anchor.candidateResults.map(
        (entry: Record<string, unknown>, index: number) =>
          index === 0 ? { ...entry, receiptDigest: digest("0") } : entry,
      ),
    });
    expect(contract.validateContinuationExternalAnchorV12(candidateMutant, {
      ...fixture.anchorBindings,
      expectedDigest: candidateMutant.digest,
    })).toContain(
      "external anchor candidate results differ from attestation",
    );
    const future = rehash({
      ...fixture.anchor,
      completedAt: "2999-01-01T00:00:00.000Z",
    });
    expect(contract.validateContinuationExternalAnchorV12(future, {
      ...fixture.anchorBindings,
      expectedDigest: future.digest,
    })).not.toEqual([]);
    expect(contract.validateContinuationExternalAttestationV12(
      fixture.attestation,
    )).not.toEqual([]);
    expect(contract.validateContinuationExternalAnchorV12(
      fixture.anchor,
      { expectedDigest: fixture.anchor.digest },
    )).not.toEqual([]);
  });
});
