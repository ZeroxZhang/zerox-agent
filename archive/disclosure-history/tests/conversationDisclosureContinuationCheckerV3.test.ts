import { mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

const checker = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/check-conversation-disclosure-continuation-v3.mjs"
);
const contract = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-continuation-contract-v3.mjs"
);

const temporaryRoots: string[] = [];
const digest = (character: string) => `sha256:${character.repeat(64)}`;

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("conversation disclosure continuation checker v3", () => {
  it("rejects an unknown workstream and an unknown completed Feature", () => {
    const profile = {
      workstreamStates: [{ id: "CD01", state: "completed" }],
      featureStates: [{ id: "P105", presence: "present", status: "done" }],
    };
    const errors = checker.validateLiveInventoryProjectionV3({
      workstreams: [{ id: "CD01" }, { id: "CD99" }],
      features: [
        { id: "P105", status: "done" },
        { id: "P999", status: "done" },
      ],
    }, profile, 1);

    expect(errors).toEqual(expect.arrayContaining([
      "unknown or missing live workstream",
      "unknown or missing live Feature",
    ]));
    expect(errors).not.toContain(
      "unfinished Feature count exceeds the closed-world maximum",
    );
  });

  it("rejects an unknown unfinished Feature", () => {
    const profile = {
      workstreamStates: [{ id: "CD01", state: "completed" }],
      featureStates: [{ id: "P105", presence: "present", status: "in_progress" }],
    };
    const errors = checker.validateLiveInventoryProjectionV3({
      workstreams: [{ id: "CD01" }],
      features: [
        { id: "P105", status: "in_progress" },
        { id: "P999", status: "in_progress" },
      ],
    }, profile, 1);

    expect(errors).toEqual(expect.arrayContaining([
      "unknown or missing live Feature",
      "unfinished Feature count exceeds the closed-world maximum",
    ]));
  });

  it("rejects Feature roster ordering drift", () => {
    const profile = {
      workstreamStates: [{ id: "CD01", state: "completed" }],
      featureStates: [
        { id: "P105", presence: "present", status: "done" },
        { id: "P106", presence: "present", status: "done" },
      ],
    };

    expect(checker.validateLiveInventoryProjectionV3({
      workstreams: [{ id: "CD01" }],
      features: [
        { id: "P106", status: "done" },
        { id: "P105", status: "done" },
      ],
    }, profile, 1)).toContain("unknown or missing live Feature");
  });

  it("rejects a forged P107A file-set digest", () => {
    const feature = {
      id: contract.CONTINUATION_V3_FEATURE_ID,
      priority: 1,
      title: "Admission",
      files: ["package.json"],
      definitionOfDone: ["reviewed"],
      verification: ["focused tests"],
      status: "in_progress",
    };
    const stable = contract.stableFeatureDefinitionV3(feature);
    const admission = {
      featureDefinitionDigest: contract.hashCanonicalV3(stable),
      featureFileSetDigest: contract.hashCanonicalV3(stable.files),
    };
    const snapshot = {
      admissionFeatureDefinitionDigest: admission.featureDefinitionDigest,
      admissionFeatureFileSetDigest: digest("f"),
    };

    expect(checker.validateAdmissionFileSetV3(
      { admission, admissionCoverage: [] },
      feature,
      snapshot,
      [],
    )).toContain("live P107A definition/file-set digest is stale");
  });

  it("keeps Round1 absence outside rejected admission coverage and rejects an overlap mutant", () => {
    const frozenPath = "src/frozen.ts";
    const round1AbsentPath =
      ".zerox/verification/conversation-disclosure/CD03A-round1-closure-manifest.json";
    const payloadPaths = contract.CONTINUATION_V3_ROUND3_GOVERNANCE_TRANSITION_TRUST_ROOTS
      .map((entry: { stagedTargetPath: string }) => entry.stagedTargetPath);
    const rejectedPaths = [...contract.CONTINUATION_V3_ROUND2_FORBIDDEN_OUTPUT_PATHS];
    const makeState = (includeRound1InCoverage: boolean) => {
      const files = [
        frozenPath,
        ...payloadPaths,
        ...rejectedPaths,
        ...(includeRound1InCoverage ? [round1AbsentPath] : []),
      ].sort();
      const feature = {
        id: contract.CONTINUATION_V3_FEATURE_ID,
        priority: 1,
        title: "Admission",
        files,
        definitionOfDone: ["reviewed"],
        verification: ["focused tests"],
        status: "in_progress",
      };
      const stable = contract.stableFeatureDefinitionV3(feature);
      const admission = {
        featureDefinitionDigest: contract.hashCanonicalV3(stable),
        featureFileSetDigest: contract.hashCanonicalV3(stable.files),
      };
      const admissionCoverage = files.map((entryPath) => ({
        path: entryPath,
        class: payloadPaths.includes(entryPath)
          ? "transition_payload"
          : rejectedPaths.includes(entryPath) || entryPath === round1AbsentPath
            ? "rejected_output_absent"
            : "frozen_file",
      }));
      const snapshot = {
        admissionFeatureDefinitionDigest: admission.featureDefinitionDigest,
        admissionFeatureFileSetDigest: admission.featureFileSetDigest,
        frozenFiles: [{ path: frozenPath, sha256: digest("a") }],
        transitionPayloadFiles: payloadPaths.map((entryPath: string) => ({
          path: entryPath,
          sha256: digest("b"),
        })),
        baselineFiles: [],
        absentPaths: [round1AbsentPath, ...rejectedPaths].sort(),
        reviewOutputAbsentPaths: [],
      };
      return {
        feature,
        policy: {
          admission,
          admissionCoverage,
          round1Rejection: { forbiddenRepositoryOutputs: [round1AbsentPath] },
          round2PrefreezeRejection: { verifiedAbsentPaths: rejectedPaths },
        },
        snapshot,
      };
    };

    const valid = makeState(false);
    expect(checker.validateAdmissionFileSetV3(
      valid.policy,
      valid.feature,
      valid.snapshot,
      [],
    )).toEqual([]);

    const overlapMutant = makeState(true);
    expect(checker.validateAdmissionFileSetV3(
      overlapMutant.policy,
      overlapMutant.feature,
      overlapMutant.snapshot,
      [],
    )).toContain(
      "snapshot frozen/payload roster differs from authoritative policy admissionCoverage",
    );
  });

  it("rejects a baseline archive with an omitted coverage entry", () => {
    const bytes = Buffer.from("baseline", "utf8");
    const archive = {
      entries: [{
        path: "a.ts",
        source: "round23_review_snapshot",
        sha256: contract.sha256BytesV3(bytes),
        encoding: "gzip-base64-v1",
        bytes: gzipSync(bytes, { level: 9, mtime: 0 } as any).toString("base64"),
      }],
    };
    const errors: string[] = [];
    const decoded = checker.decodeBaselineArchiveEntriesV3(archive, errors);
    checker.validateArchiveCoverageV3(decoded, ["a.ts", "b.ts"], errors);

    expect(errors).toContain(
      "baseline archive decoded coverage is incomplete or contains extra paths",
    );
  });

  it("rejects corrupt or non-deterministic gzip archive bytes", () => {
    const errors: string[] = [];
    checker.decodeBaselineArchiveEntriesV3({
      entries: [{
        path: "a.ts",
        source: "round23_review_snapshot",
        sha256: digest("a"),
        encoding: "gzip-base64-v1",
        bytes: Buffer.from("not gzip", "utf8").toString("base64"),
      }],
    }, errors);

    expect(errors).toContain("baseline archive entry is corrupt: a.ts");
  });

  it("rejects a mixed four-file governance transition state", () => {
    const transitions = createTransitions();
    const live = new Map<string, string>();
    const staged = new Map<string, string>();
    transitions.forEach((entry, index) => {
      live.set(entry.path, index === 0 ? entry.fromSha256 : entry.toSha256);
      staged.set(entry.stagedTargetPath, entry.toSha256);
    });

    expect(contract.validateGovernanceTransitionStateV3(
      transitions,
      "review_post_transition",
      live,
      staged,
    )).toContain(
      "governance live digest is invalid for review_post_transition: package.json",
    );
  });

  it("rejects a create authority preplanted before authorization", () => {
    expect(checker.validateAuthorityPhaseValueV3({
      class: "create",
      path: "src/main/new-adapter.ts",
      baseline: { source: "cd03a_review_absence", sha256: null },
    }, "anchored_planned", {
      present: true,
      digest: digest("a"),
    })).toContain(
      "create authority was preplanted before authorization: src/main/new-adapter.ts",
    );
  });

  it("rejects a reviewed baseline byte tamper", () => {
    const baselinePath = ".zerox/feature_list.json";
    const snapshot = {
      baselineFiles: [{ path: baselinePath, sha256: digest("a") }],
    };
    const liveDigests = new Map([[baselinePath, digest("b")]]);

    expect(checker.validateSnapshotBaselineDigestsV3(
      snapshot,
      liveDigests,
      "review_pre_transition",
      [],
    )).toContain(`snapshot baseline hash drift: ${baselinePath}`);
    expect(checker.validateSnapshotBaselineDigestsV3(
      snapshot,
      liveDigests,
      "authorized_active",
      [],
    )).toEqual([]);
  });

  it("rejects future-dated review or attestation evidence", () => {
    const now = Date.now();
    const errors = checker.validateEvidenceTimesV3([
      { completedAt: new Date(now + 1).toISOString() },
    ], now, []);

    expect(errors).toContain(
      "review/attestation/anchor evidence timestamp is invalid or future-dated",
    );
  });

  it("detects a same-byte new inode during postflight", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "cd03a-checker-v3-postflight-"),
    );
    const root = await realpath(temporaryRoot);
    temporaryRoots.push(root);
    const subject = path.join(root, "subject.json");
    const replacement = path.join(root, "replacement.json");
    await writeFile(subject, "{}", { mode: 0o600 });
    const captures: unknown[] = [];
    await checker.captureStableFileV3(subject, "postflight subject", { captures });
    await writeFile(replacement, "{}", { mode: 0o600 });
    await rename(replacement, subject);

    await expect(checker.postflightCapturesV3(captures)).rejects.toThrow(
      "postflight subject changed identity before postflight",
    );
  });

  it("requires a caller-pinned continuation anchor in every ordinary phase", () => {
    for (const mode of [
      "anchored_planned",
      "authorized_active",
    ]) {
      expect(checker.requireContinuationAnchorForModeV3({ mode }, [])).toContain(
        "ordinary continuation mode requires a caller-pinned continuation anchor",
      );
    }
  });

  it("rejects completed_pending_delta until CD04 defines a next-version delta head", () => {
    expect(checker.validateRequestedContinuationModeV3(
      "completed_pending_delta",
      [],
    )).toContain(
      "completed_pending_delta is not authorized by the P107A trust head; "
        + "P108 done requires a CD04 next-version independently reviewed delta trust head",
    );
  });

  it("rejects replacement of a checker-captured stable Program root", () => {
    const program = {
      schemaVersion: 1,
      programId: "fixture-program",
      status: "active",
      activeFeatureId: "P107A",
      nextFeatureId: "P107A",
      invariants: ["stable invariant"],
      scenarioMatrix: [{
        id: "S1",
        expected: ["stable result"],
        acceptanceEvidence: [],
      }],
      workstreams: [{
        id: "CD03A",
        featureId: "P107A",
        state: "in_progress",
      }],
    };
    const definition = contract.stableProgramRootDefinitionV3(program);
    const closedWorld = {
      programRootDefinition: definition,
      programRootDefinitionDigest: contract.hashCanonicalV3(definition),
    };
    const replacement = structuredClone(program);
    replacement.scenarioMatrix[0].expected[0] = "candidate replacement";

    expect(checker.validateCheckerProgramRootV3(
      replacement,
      closedWorld,
    )).toContain("live program stable root differs from the frozen program root");
  });
});

function createTransitions() {
  return Object.entries(contract.CONTINUATION_V3_GOVERNANCE_TRANSITIONS)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([livePath, kind], index) => ({
      path: livePath,
      kind,
      stagedTargetPath: `.zerox/verification/conversation-disclosure/target-${index}`,
      fromSha256: digest(String(index + 1)),
      toSha256: digest(String(index + 5)),
    }));
}
