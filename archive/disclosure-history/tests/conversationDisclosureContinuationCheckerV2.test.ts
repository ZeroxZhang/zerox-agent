import { mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

const checker = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/check-conversation-disclosure-continuation-v2.mjs"
);
const contract = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-continuation-contract-v2.mjs"
);

const temporaryRoots: string[] = [];
const digest = (character: string) => `sha256:${character.repeat(64)}`;

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("conversation disclosure continuation checker v2", () => {
  it("rejects an unknown workstream and an unknown completed Feature", () => {
    const profile = {
      workstreamStates: [{ id: "CD01", state: "completed" }],
      featureStates: [{ id: "P105", presence: "present", status: "done" }],
    };
    const errors = checker.validateLiveInventoryProjectionV2({
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
    const errors = checker.validateLiveInventoryProjectionV2({
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

    expect(checker.validateLiveInventoryProjectionV2({
      workstreams: [{ id: "CD01" }],
      features: [
        { id: "P106", status: "done" },
        { id: "P105", status: "done" },
      ],
    }, profile, 1)).toContain("unknown or missing live Feature");
  });

  it("rejects a forged P107A file-set digest", () => {
    const feature = {
      id: contract.CONTINUATION_V2_FEATURE_ID,
      priority: 1,
      title: "Admission",
      files: ["package.json"],
      definitionOfDone: ["reviewed"],
      verification: ["focused tests"],
      status: "in_progress",
    };
    const stable = contract.stableFeatureDefinitionV2(feature);
    const admission = {
      featureDefinitionDigest: contract.hashCanonicalV2(stable),
      featureFileSetDigest: contract.hashCanonicalV2(stable.files),
    };
    const snapshot = {
      admissionFeatureDefinitionDigest: admission.featureDefinitionDigest,
      admissionFeatureFileSetDigest: digest("f"),
    };

    expect(checker.validateAdmissionFileSetV2(
      admission,
      feature,
      snapshot,
      [],
    )).toContain("live P107A definition/file-set digest is stale");
  });

  it("rejects a baseline archive with an omitted coverage entry", () => {
    const bytes = Buffer.from("baseline", "utf8");
    const archive = {
      entries: [{
        path: "a.ts",
        source: "round23_review_snapshot",
        sha256: contract.sha256BytesV2(bytes),
        encoding: "gzip-base64-v1",
        bytes: gzipSync(bytes, { level: 9, mtime: 0 } as any).toString("base64"),
      }],
    };
    const errors: string[] = [];
    const decoded = checker.decodeBaselineArchiveEntriesV2(archive, errors);
    checker.validateArchiveCoverageV2(decoded, ["a.ts", "b.ts"], errors);

    expect(errors).toContain(
      "baseline archive decoded coverage is incomplete or contains extra paths",
    );
  });

  it("rejects corrupt or non-deterministic gzip archive bytes", () => {
    const errors: string[] = [];
    checker.decodeBaselineArchiveEntriesV2({
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

    expect(contract.validateGovernanceTransitionStateV2(
      transitions,
      "review_post_transition",
      live,
      staged,
    )).toContain(
      "governance live digest is invalid for review_post_transition: package.json",
    );
  });

  it("rejects a create authority preplanted before authorization", () => {
    expect(checker.validateAuthorityPhaseValueV2({
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

  it("rejects future-dated review or attestation evidence", () => {
    const now = Date.now();
    const errors = checker.validateEvidenceTimesV2([
      { completedAt: new Date(now + 1).toISOString() },
    ], now, []);

    expect(errors).toContain(
      "review/attestation/anchor evidence timestamp is invalid or future-dated",
    );
  });

  it("detects a same-byte new inode during postflight", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "cd03a-checker-v2-postflight-"),
    );
    const root = await realpath(temporaryRoot);
    temporaryRoots.push(root);
    const subject = path.join(root, "subject.json");
    const replacement = path.join(root, "replacement.json");
    await writeFile(subject, "{}", { mode: 0o600 });
    const captures: unknown[] = [];
    await checker.captureStableFileV2(subject, "postflight subject", { captures });
    await writeFile(replacement, "{}", { mode: 0o600 });
    await rename(replacement, subject);

    await expect(checker.postflightCapturesV2(captures)).rejects.toThrow(
      "postflight subject changed identity before postflight",
    );
  });

  it("requires a caller-pinned continuation anchor in every ordinary phase", () => {
    for (const mode of [
      "anchored_planned",
      "authorized_active",
    ]) {
      expect(checker.requireContinuationAnchorForModeV2({ mode }, [])).toContain(
        "ordinary continuation mode requires a caller-pinned continuation anchor",
      );
    }
  });

  it("rejects completed_pending_delta until CD04 defines a next-version delta head", () => {
    expect(checker.validateRequestedContinuationModeV2(
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
    const definition = contract.stableProgramRootDefinitionV2(program);
    const closedWorld = {
      programRootDefinition: definition,
      programRootDefinitionDigest: contract.hashCanonicalV2(definition),
    };
    const replacement = structuredClone(program);
    replacement.scenarioMatrix[0].expected[0] = "candidate replacement";

    expect(checker.validateCheckerProgramRootV2(
      replacement,
      closedWorld,
    )).toContain("live program stable root differs from the frozen program root");
  });
});

function createTransitions() {
  return Object.entries(contract.CONTINUATION_V2_GOVERNANCE_TRANSITIONS)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([livePath, kind], index) => ({
      path: livePath,
      kind,
      stagedTargetPath: `.zerox/verification/conversation-disclosure/target-${index}`,
      fromSha256: digest(String(index + 1)),
      toSha256: digest(String(index + 5)),
    }));
}
