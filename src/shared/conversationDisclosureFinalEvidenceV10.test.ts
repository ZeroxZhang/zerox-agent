import { describe, expect, test } from "vitest";

const contract = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-continuation-contract-v10.mjs"
);

const digest = (character: string) =>
  `sha256:${character.repeat(64).slice(0, 64)}`;

function buildFixture() {
  const policy = {
    programId: "conversation-progressive-disclosure-v3.9.2-2026-08",
    digest: digest("1"),
    parentEvidence: { bundleDigest: digest("2") },
    round9ReviewRejection: { digest: digest("3") },
    successor: {
      workstreamDefinitionDigest: digest("4"),
      featureDefinitionDigest: digest("5"),
    },
    continuationExecutables: [{
      kind: "checker",
      path: "scripts/check-conversation-disclosure-continuation-v10.mjs",
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
      taskPath: `round10/${lane}`,
      agentLabel: `round10-${lane}-reviewer`,
      transport: "codex-collaboration",
    }),
  );
  const policyReference = {
    path: contract.CONTINUATION_V10_POLICY_PATH,
    byteSha256: digest("a"),
    canonicalDigest: policy.digest,
  };
  const snapshotReference = {
    path: contract.CONTINUATION_V10_REVIEW_SNAPSHOT_PATH,
    byteSha256: digest("b"),
    canonicalDigest: snapshot.digest,
  };
  const rejectionReference = {
    path: contract.CONTINUATION_V10_ROUND9_REVIEW_REJECTION_PATH,
    byteSha256: digest("c"),
    canonicalDigest: rejection.digest,
  };
  const reviewReferences = receipts.map((receipt, index) => ({
    lane: receipt.lane,
    path:
      `.zerox/verification/conversation-disclosure/CD03A-round10-${receipt.lane}-review.json`,
    challenge: dispatchSet[index].challenge,
    canonicalDigest: digest(String(index + 1)),
  }));
  const validatorReference = {
    path: "scripts/check-conversation-disclosure-continuation-v10.mjs",
    sha256: digest("6"),
  };
  const runnerReference = {
    path: "scripts/verify-conversation-disclosure-continuation-v10.mjs",
    sha256: digest("d"),
  };
  const pendingBase = {
    schemaVersion: 10,
    kind: contract.CONTINUATION_V10_MANIFEST_KIND,
    programId: "conversation-progressive-disclosure-v3.9.2-2026-08",
    workstreamId: contract.CONTINUATION_V10_WORKSTREAM_ID,
    featureId: contract.CONTINUATION_V10_FEATURE_ID,
    round: contract.CONTINUATION_V10_ROUND,
    status: "review_passed_pending_external_transaction",
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    policy: policyReference,
    snapshot: snapshotReference,
    round9ReviewRejection: rejectionReference,
    reviewReceipts: reviewReferences,
    callerDispatchSet: dispatchSet,
    validator: validatorReference,
    externalRunner: runnerReference,
    externalAttestation: {
      path: contract.CONTINUATION_V10_EXTERNAL_ATTESTATION_PATH,
      canonicalDigest: null,
    },
  };
  const pendingManifestDigest =
    contract.pendingManifestDigestV10(pendingBase);
  const pendingManifest = contract.withCanonicalDigestV10({
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
  const attestation = contract.withCanonicalDigestV10({
    schemaVersion: 10,
    kind: contract.CONTINUATION_V10_ATTESTATION_KIND,
    status: "passed",
    governancePhase: "review_post_transition",
    identityAssurance: contract.CONTINUATION_V10_IDENTITY_ASSURANCE,
    reviewAssurance: contract.CONTINUATION_V10_CALLER_DISPATCH_ASSURANCE,
    repositoryRealpath: "/tmp/round10-subject",
    completedAt: "2026-08-24T12:10:00.000Z",
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    pendingManifestDigest,
    policyDigest: policy.digest,
    snapshotDigest: snapshot.digest,
    round9ReviewRejectionDigest: rejection.digest,
    validatorDigest: validatorReference.sha256,
    runnerDigest: runnerReference.sha256,
    callerDispatchSet: dispatchSet,
    candidateResults,
  });
  const finalManifest = contract.withCanonicalDigestV10(
    contract.finalManifestProjectionV10(pendingManifest, attestation.digest),
  );
  const anchor = contract.withCanonicalDigestV10({
    schemaVersion: 10,
    kind: contract.CONTINUATION_V10_ANCHOR_KIND,
    identityAssurance: contract.CONTINUATION_V10_IDENTITY_ASSURANCE,
    reviewAssurance: contract.CONTINUATION_V10_CALLER_DISPATCH_ASSURANCE,
    repositoryRealpath: "/tmp/round10-subject",
    completedAt: "2026-08-24T12:11:00.000Z",
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    policyDigest: policy.digest,
    snapshotDigest: snapshot.digest,
    round9ReviewRejectionDigest: rejection.digest,
    validatorDigest: validatorReference.sha256,
    runnerDigest: runnerReference.sha256,
    attestationDigest: attestation.digest,
    callerDispatchSet: dispatchSet,
    candidateResults,
    head: {
      kind: "successor-admission",
      status: "externally_attested",
      workstreamId: contract.CONTINUATION_V10_WORKSTREAM_ID,
      featureId: contract.CONTINUATION_V10_FEATURE_ID,
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
    round9ReviewRejectionReference: rejectionReference,
    reviewReferences,
    callerDispatchSet: dispatchSet,
    validatorReference,
    runnerReference,
  };
  const attestationBindings = {
    policy,
    snapshot,
    round9ReviewRejection: rejection,
    pendingManifest,
    callerDispatchSet: dispatchSet,
    receipts,
    candidateResults,
    repositoryRealpath: "/tmp/round10-subject",
    verifierNow: Date.parse("2026-08-24T12:12:00.000Z"),
  };
  const anchorBindings = {
    expectedDigest: anchor.digest,
    attestation,
    policy,
    snapshot,
    round9ReviewRejection: rejection,
    callerDispatchSet: dispatchSet,
    repositoryRealpath: "/tmp/round10-subject",
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
  clone.digest = contract.hashCanonicalV10(clone);
  return clone as T & { digest: string };
}

describe("conversation disclosure final evidence v10", () => {
  test("accepts one completely bound pending/final/attestation/anchor chain", () => {
    const fixture = buildFixture();
    expect(contract.validateContinuationClosureManifestV10(
      fixture.pendingManifest,
      fixture.manifestBindings,
    )).toEqual([]);
    expect(contract.validateContinuationExternalAttestationV10(
      fixture.attestation,
      fixture.attestationBindings,
    )).toEqual([]);
    expect(contract.validateContinuationClosureManifestV10(
      fixture.finalManifest,
      {
        ...fixture.manifestBindings,
        pendingManifest: fixture.pendingManifest,
        externalAttestation: fixture.attestation,
      },
    )).toEqual([]);
    expect(contract.validateContinuationExternalAnchorV10(
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
      expect(contract.validateContinuationExternalAttestationV10(
        attestation,
        { ...fixture.attestationBindings, candidateResults },
      )).not.toEqual([]);
    }
    const forged = rehash({
      ...fixture.attestation,
      candidateResults: fixture.candidateResults.map((entry, index) =>
        index === 0 ? { ...entry, receiptDigest: digest("a") } : entry),
    });
    expect(contract.validateContinuationExternalAttestationV10(
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
      expect(contract.validateContinuationExternalAttestationV10(
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
      "round9ReviewRejectionDigest",
      "runnerDigest",
      "snapshotDigest",
      "validatorDigest",
    ]) {
      const attestation = rehash({
        ...fixture.attestation,
        [key]: digest("0"),
      });
      expect(contract.validateContinuationExternalAttestationV10(
        attestation,
        fixture.attestationBindings,
      )).not.toEqual([]);
    }
    const dispatch = structuredClone(fixture.attestation.callerDispatchSet);
    dispatch[0].taskPath = "round10/other";
    const attestation = rehash({
      ...fixture.attestation,
      callerDispatchSet: dispatch,
    });
    expect(contract.validateContinuationExternalAttestationV10(
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
        round9ReviewRejection: {
          ...fixture.finalManifest.round9ReviewRejection,
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
      expect(contract.validateContinuationClosureManifestV10(manifest, {
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
      expect(contract.validateContinuationExternalAnchorV10(
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
      "round9ReviewRejectionDigest",
      "runnerDigest",
      "snapshotDigest",
      "validatorDigest",
    ]) {
      const rootMutant = rehash({
        ...fixture.anchor,
        [key]: digest("0"),
      });
      expect(contract.validateContinuationExternalAnchorV10(rootMutant, {
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
    expect(contract.validateContinuationExternalAnchorV10(dispatchMutant, {
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
    expect(contract.validateContinuationExternalAnchorV10(candidateMutant, {
      ...fixture.anchorBindings,
      expectedDigest: candidateMutant.digest,
    })).toContain(
      "external anchor candidate results differ from attestation",
    );
    const future = rehash({
      ...fixture.anchor,
      completedAt: "2999-01-01T00:00:00.000Z",
    });
    expect(contract.validateContinuationExternalAnchorV10(future, {
      ...fixture.anchorBindings,
      expectedDigest: future.digest,
    })).not.toEqual([]);
    expect(contract.validateContinuationExternalAttestationV10(
      fixture.attestation,
    )).not.toEqual([]);
    expect(contract.validateContinuationExternalAnchorV10(
      fixture.anchor,
      { expectedDigest: fixture.anchor.digest },
    )).not.toEqual([]);
  });
});
