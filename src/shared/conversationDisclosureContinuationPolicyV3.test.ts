import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { afterEach, describe, expect, test } from "vitest";

import {
  buildConversationDisclosureContinuationPolicyV3,
  CONTINUATION_POLICY_V3_ABSENT_BOOKKEEPING_PATHS,
  CONTINUATION_POLICY_V3_ADMISSION_FEATURE_DEFINITION_DIGEST,
  CONTINUATION_POLICY_V3_ADMISSION_FILE_COUNT,
  CONTINUATION_POLICY_V3_ADMISSION_FILE_SET_DIGEST,
  CONTINUATION_POLICY_V3_ADMISSION_WORKSTREAM_DEFINITION_DIGEST,
  CONTINUATION_POLICY_V3_PRESENT_BOOKKEEPING_PATHS,
  rebindRound3BookkeepingBaselinesV3,
// @ts-expect-error -- governance scripts are runtime-checked .mjs modules.
} from "../../scripts/build-conversation-disclosure-continuation-policy-v3.mjs";
import { buildConversationDisclosurePrefreezeRejectionV3 } from
  // @ts-expect-error -- governance scripts are runtime-checked .mjs modules.
  "../../scripts/build-conversation-disclosure-prefreeze-rejection-v3.mjs";
import {
  CONTINUATION_V3_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V3_FEATURE_ID,
  CONTINUATION_V3_POLICY_PATH,
  CONTINUATION_V3_PROGRAM_ROOT_DEFINITION_DIGEST,
  CONTINUATION_V3_ROUND2_EXECUTABLE_TRUST_ROOTS,
  CONTINUATION_V3_ROUND2_FORBIDDEN_OUTPUT_PATHS,
  CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH,
  CONTINUATION_V3_ROUND2_TRANSITION_TRUST_ROOTS,
  CONTINUATION_V3_ROUND3_GOVERNANCE_TRANSITION_TRUST_ROOTS,
  CONTINUATION_V3_WORKSTREAM_ID,
  hashCanonicalV3,
  sha256BytesV3,
  stableFeatureDefinitionV3,
  stableProgramRootDefinitionV3,
  stableWorkstreamDefinitionV3,
  validateBaselineArchiveV3,
  validateContinuationPolicyV3,
  validateLifecycleStateV3,
// @ts-expect-error -- governance scripts are runtime-checked .mjs modules.
} from "../../scripts/conversation-disclosure-continuation-contract-v3.mjs";

const root = path.resolve(__dirname, "../..");
const baseAnchorPath =
  "/private/tmp/zerox-cd03-r23.YkhhKk/CD03-round23-external-anchor.json";
const baseAnchorDigest =
  "sha256:e81f0afb3d10b12976b74d1499870b837595ffbc3b452c7f1f78fff67be8f102";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((entry) =>
    rm(entry, { recursive: true, force: true })));
});

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

function materializeLifecycle(policy: any, phase: string) {
  const profile = policy.closedWorld.lifecycleProfiles.find(
    (entry: any) => entry.phase === phase,
  );
  const definitions = new Map<string, any>([
    ...policy.closedWorld.historicalFeatures.map((entry: any) => [
      entry.id,
      entry.stableDefinition,
    ]),
    [policy.admission.featureDefinition.id, policy.admission.featureDefinition],
    [policy.successor.featureDefinition.id, policy.successor.featureDefinition],
  ]);
  return {
    phase: profile.phase,
    activeFeatureId: profile.activeFeatureId,
    nextFeatureId: profile.nextFeatureId,
    workstreams: policy.closedWorld.workstreams.map((entry: any) => ({
      ...entry.stableDefinition,
      state: profile.workstreamStates.find(
        (state: any) => state.id === entry.id,
      ).state,
    })),
    features: profile.featureStates
      .filter((state: any) => state.presence === "present")
      .map((state: any) => ({
        ...definitions.get(state.id),
        status: state.status,
      })),
  };
}

async function makeRound2Fixture() {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "zerox-r2-rejection-v3-test."));
  temporaryRoots.push(fixture);
  const archive = readJson(CONTINUATION_V3_BASELINE_ARCHIVE_PATH);
  const policy = readJson(
    ".zerox/verification/conversation-disclosure/CD03A-round2-successor-evolution-policy.json",
  );
  const historicalTransitionByPath = new Map<string, any>(
    archive.entries
      .filter((entry: any) => entry.source === "governance_transition")
      .map((entry: any) => [entry.path, entry]),
  );
  const required = new Set<string>([
    ".zerox/verification/conversation-disclosure/CD03A-round2-successor-evolution-policy.json",
    ".zerox/verification/conversation-disclosure/CD03A-round2-baseline-archive.json",
    ...CONTINUATION_V3_ROUND2_EXECUTABLE_TRUST_ROOTS.map((entry: any) => entry.path),
    ...CONTINUATION_V3_ROUND2_TRANSITION_TRUST_ROOTS.flatMap((entry: any) => [
      entry.path,
      entry.stagedTargetPath,
    ]),
    ...policy.admission.featureDefinition.files,
  ]);
  for (const relativePath of required) {
    if (CONTINUATION_V3_ROUND2_FORBIDDEN_OUTPUT_PATHS.includes(relativePath)
      || !existsSync(path.join(root, relativePath))) continue;
    const destination = path.join(fixture, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    const transition = CONTINUATION_V3_ROUND2_TRANSITION_TRUST_ROOTS.find(
      (entry: any) => entry.path === relativePath,
    );
    if (transition) {
      const archived = historicalTransitionByPath.get(relativePath);
      if (!archived || archived.encoding !== "gzip-base64-v1"
        || archived.sha256 !== transition.fromSha256) {
        throw new Error(`Round3 archive does not bind historical live bytes: ${relativePath}`);
      }
      const historicalBytes = gunzipSync(Buffer.from(archived.bytes, "base64"));
      if (sha256BytesV3(historicalBytes) !== transition.fromSha256) {
        throw new Error(`Round3 archive historical bytes drifted: ${relativePath}`);
      }
      await writeFile(destination, historicalBytes);
    } else {
      await copyFile(path.join(root, relativePath), destination);
    }
  }
  return realpath(fixture);
}

async function assertPublishedPostTransitionPolicy() {
  const policyPath = path.join(root, CONTINUATION_V3_POLICY_PATH);
  const policyBytes = await readFile(policyPath);
  const policy = JSON.parse(policyBytes.toString("utf8"));
  const archive = readJson(CONTINUATION_V3_BASELINE_ARCHIVE_PATH);
  const featureList = readJson(".zerox/feature_list.json");
  const program = readJson(".zerox/conversation-disclosure-program.json");
  const witness = readJson(CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH);
  const policyStat = await stat(policyPath);

  expect(policyStat.mode & 0o777).toBe(0o600);
  expect(policyBytes).toEqual(Buffer.from(`${JSON.stringify(policy, null, 2)}\n`, "utf8"));
  expect(policy.admission.featureDefinition.files)
    .toHaveLength(CONTINUATION_POLICY_V3_ADMISSION_FILE_COUNT);
  expect(policy.admission.featureFileSetDigest)
    .toBe(CONTINUATION_POLICY_V3_ADMISSION_FILE_SET_DIGEST);
  expect(policy.admission.featureDefinitionDigest)
    .toBe(CONTINUATION_POLICY_V3_ADMISSION_FEATURE_DEFINITION_DIGEST);
  expect(policy.admission.workstreamDefinitionDigest)
    .toBe(CONTINUATION_POLICY_V3_ADMISSION_WORKSTREAM_DEFINITION_DIGEST);
  expect(policy.closedWorld.programRootDefinitionDigest)
    .toBe(CONTINUATION_V3_PROGRAM_ROOT_DEFINITION_DIGEST);
  expect(policy.governanceTransitions)
    .toEqual(CONTINUATION_V3_ROUND3_GOVERNANCE_TRANSITION_TRUST_ROOTS);
  expect(policy.round2PrefreezeRejection).toEqual(witness);
  expect(policy.baselineArchive).toEqual({
    path: CONTINUATION_V3_BASELINE_ARCHIVE_PATH,
    digest: archive.digest,
    entrySetDigest: archive.entrySetDigest,
  });

  for (const transition of CONTINUATION_V3_ROUND3_GOVERNANCE_TRANSITION_TRUST_ROOTS) {
    expect(sha256BytesV3(await readFile(path.join(root, transition.path))))
      .toBe(transition.toSha256);
    expect(sha256BytesV3(await readFile(path.join(root, transition.stagedTargetPath))))
      .toBe(transition.toSha256);
  }
  for (const executable of policy.continuationExecutables) {
    expect(sha256BytesV3(await readFile(path.join(root, executable.path))))
      .toBe(executable.sha256);
  }

  const postTransitionLifecycle = materializeLifecycle(
    policy,
    "review_post_transition",
  );
  expect(validateLifecycleStateV3(postTransitionLifecycle, policy)).toEqual([]);
  expect(validateContinuationPolicyV3(policy, {
    expectedDigest: policy.digest,
    baselineArchive: archive,
    liveAdmissionFeature: featureList.features.find(
      (entry: any) => entry.id === CONTINUATION_V3_FEATURE_ID,
    ),
    liveAdmissionWorkstream: program.workstreams.find(
      (entry: any) => entry.id === CONTINUATION_V3_WORKSTREAM_ID,
    ),
    liveProgram: program,
    lifecycleState: postTransitionLifecycle,
  })).toEqual([]);
  expect(validateBaselineArchiveV3(archive, policy)).toEqual([]);
}

describe("conversation disclosure continuation policy v3 builder", () => {
  test("hard-roots the exact live P107A, CD03A, and stable Program definitions", () => {
    const featureList = readJson(".zerox/feature_list.json");
    const program = readJson(".zerox/conversation-disclosure-program.json");
    const feature = featureList.features.find(
      (entry: any) => entry.id === CONTINUATION_V3_FEATURE_ID,
    );
    const workstream = program.workstreams.find(
      (entry: any) => entry.id === CONTINUATION_V3_WORKSTREAM_ID,
    );
    const stableFeature = stableFeatureDefinitionV3(feature);
    expect(stableFeature.files).toHaveLength(CONTINUATION_POLICY_V3_ADMISSION_FILE_COUNT);
    expect(hashCanonicalV3(stableFeature.files))
      .toBe(CONTINUATION_POLICY_V3_ADMISSION_FILE_SET_DIGEST);
    expect(hashCanonicalV3(stableFeature))
      .toBe(CONTINUATION_POLICY_V3_ADMISSION_FEATURE_DEFINITION_DIGEST);
    expect(hashCanonicalV3(stableWorkstreamDefinitionV3(workstream)))
      .toBe(CONTINUATION_POLICY_V3_ADMISSION_WORKSTREAM_DEFINITION_DIGEST);
    expect(hashCanonicalV3(stableProgramRootDefinitionV3(program)))
      .toBe(CONTINUATION_V3_PROGRAM_ROOT_DEFINITION_DIGEST);
  });

  test("validates the exact production policy in both pre-publish and published post-transition states", async () => {
    const policyPath = path.join(root, CONTINUATION_V3_POLICY_PATH);
    if (existsSync(policyPath)) {
      await assertPublishedPostTransitionPolicy();
      return;
    }

    for (const transition of CONTINUATION_V3_ROUND3_GOVERNANCE_TRANSITION_TRUST_ROOTS) {
      expect(sha256BytesV3(await readFile(path.join(root, transition.path))))
        .toBe(transition.fromSha256);
    }
    const result = await buildConversationDisclosureContinuationPolicyV3({
      repositoryRoot: root,
      baseAnchorPath,
      expectedBaseAnchorDigest: baseAnchorDigest,
    });
    const archive = readJson(CONTINUATION_V3_BASELINE_ARCHIVE_PATH);
    expect(result.publicationStatus).toBe("not_requested");
    expect(result.policy.admissionCoverage).toHaveLength(84);
    expect(validateContinuationPolicyV3(result.policy, {
      expectedDigest: result.policy.digest,
      baselineArchive: archive,
    })).toEqual([]);
    expect(validateBaselineArchiveV3(archive, result.policy)).toEqual([]);
    expect(result.policy.governanceTransitions)
      .toEqual(CONTINUATION_V3_ROUND3_GOVERNANCE_TRANSITION_TRUST_ROOTS);
    expect(existsSync(policyPath)).toBe(false);
  });

  test("rebinds the exact present bookkeeping roster to current stable bytes", async () => {
    const source = readJson(
      ".zerox/verification/conversation-disclosure/CD03A-round2-successor-evolution-policy.json",
    ).pathAuthorities;
    const checkedAbsent: string[] = [];
    const rebound = await rebindRound3BookkeepingBaselinesV3(source, {
      readPresentDigest: async (relativePath: string) =>
        sha256BytesV3(await readFile(path.join(root, relativePath))),
      assertAbsent: async (relativePath: string) => {
        checkedAbsent.push(relativePath);
      },
    });
    const reboundByPath = new Map<string, any>(
      rebound.map((entry: any) => [entry.path, entry]),
    );
    for (const relativePath of CONTINUATION_POLICY_V3_PRESENT_BOOKKEEPING_PATHS) {
      expect(reboundByPath.get(relativePath).baseline.sha256)
        .toBe(sha256BytesV3(await readFile(path.join(root, relativePath))));
    }
    expect(reboundByPath.get(".zerox/conversation-disclosure-program.json").baseline.sha256)
      .not.toBe(source.find((entry: any) =>
        entry.path === ".zerox/conversation-disclosure-program.json").baseline.sha256);
    expect(checkedAbsent.sort())
      .toEqual([...CONTINUATION_POLICY_V3_ABSENT_BOOKKEEPING_PATHS].sort());
  });

  test("rejects a preplanted path from the exact absent bookkeeping roster", async () => {
    const source = readJson(
      ".zerox/verification/conversation-disclosure/CD03A-round2-successor-evolution-policy.json",
    ).pathAuthorities;
    await expect(rebindRound3BookkeepingBaselinesV3(source, {
      readPresentDigest: async (relativePath: string) =>
        sha256BytesV3(await readFile(path.join(root, relativePath))),
      assertAbsent: async (relativePath: string) => {
        if (relativePath === CONTINUATION_POLICY_V3_ABSENT_BOOKKEEPING_PATHS[0]) {
          throw new Error(`preplanted mutant: ${relativePath}`);
        }
      },
    })).rejects.toThrow("preplanted mutant");
  });

  test("publishes the deterministic rejection witness with O_EXCL 0600 idempotence", async () => {
    const fixture = await makeRound2Fixture();
    const outputPath = CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH;
    const first = await buildConversationDisclosurePrefreezeRejectionV3({
      repositoryRoot: fixture,
      outputPath,
    });
    const publishedPath = path.join(fixture, outputPath);
    const firstStat = await stat(publishedPath);
    const second = await buildConversationDisclosurePrefreezeRejectionV3({
      repositoryRoot: fixture,
      outputPath,
    });
    const secondStat = await stat(publishedPath);
    expect(first.publicationStatus).toBe("created");
    expect(second.publicationStatus).toBe("idempotent");
    expect(first.witness.digest).toBe(second.witness.digest);
    expect(firstStat.mode & 0o777).toBe(0o600);
    expect(secondStat.ino).toBe(firstStat.ino);
    expect(await readFile(publishedPath)).toEqual(first.bytes);
  });

  test("rejects any old executable byte drift before producing a witness", async () => {
    const fixture = await makeRound2Fixture();
    const executable = path.join(
      fixture,
      CONTINUATION_V3_ROUND2_EXECUTABLE_TRUST_ROOTS[0].path,
    );
    await writeFile(executable, Buffer.concat([
      await readFile(executable),
      Buffer.from("\n// drift\n"),
    ]));
    await expect(buildConversationDisclosurePrefreezeRejectionV3({
      repositoryRoot: fixture,
    })).rejects.toThrow("executable bytes drifted");
  });

  test("rejects a preplanted Round2 snapshot instead of converting absence into a receipt", async () => {
    const fixture = await makeRound2Fixture();
    const plantedPath = path.join(
      fixture,
      CONTINUATION_V3_ROUND2_FORBIDDEN_OUTPUT_PATHS[0],
    );
    await mkdir(path.dirname(plantedPath), { recursive: true });
    await writeFile(plantedPath, "{}\n", { mode: 0o600 });
    await chmod(plantedPath, 0o600);
    await expect(buildConversationDisclosurePrefreezeRejectionV3({
      repositoryRoot: fixture,
    })).rejects.toThrow("forbidden output is present");
  });
});
