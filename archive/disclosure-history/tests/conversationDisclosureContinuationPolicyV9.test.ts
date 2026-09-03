import {
  appendFile,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const rejectionBuilder = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/build-conversation-disclosure-review-rejection-v9.mjs"
);
const policyBuilder = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/build-conversation-disclosure-continuation-policy-v9.mjs"
);
const contract = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-continuation-contract-v9.mjs"
);

const root = path.resolve(__dirname, "../..");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((entry) =>
    rm(entry, { recursive: true, force: true })));
});

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

function makeArchive() {
  const source = readJson(
    ".zerox/verification/conversation-disclosure/CD03A-round8-baseline-archive.json",
  );
  const value = {
    ...source,
    schemaVersion: 9,
    kind: contract.CONTINUATION_V9_BASELINE_ARCHIVE_KIND,
    round: 9,
  };
  delete value.digest;
  value.digest = contract.hashCanonicalV9(value);
  return value;
}

function makePolicyInput(rejection: any) {
  const program = readJson(".zerox/conversation-disclosure-program.json");
  const featureList = readJson(".zerox/feature_list.json");
  const parentPolicy = readJson(
    ".zerox/verification/conversation-disclosure/CD03A-round8-successor-evolution-policy.json",
  );
  const feature = featureList.features.find(
    (entry: any) => entry.id === contract.CONTINUATION_V9_FEATURE_ID,
  );
  feature.files = [...new Set([
    ...feature.files,
    ...policyBuilder.CONTINUATION_POLICY_V9_REQUIRED_ROSTER_PATHS,
  ])];
  const continuationExecutables =
    contract.CONTINUATION_V9_EXECUTABLE_KINDS.map(
      (kind: string, index: number) => ({
        kind,
        path: contract.CONTINUATION_V9_EXECUTABLE_PATH_BY_KIND[kind],
        sha256: `sha256:${String(index + 1).repeat(64).slice(0, 64)}`,
      }),
    );
  return {
    program,
    featureList,
    parentPolicy,
    round8ReviewRejection: rejection,
    baselineArchive: makeArchive(),
    pathAuthorities: structuredClone(parentPolicy.pathAuthorities),
    continuationExecutables,
  };
}

describe("conversation disclosure continuation policy v9 builder", () => {
  test("builds one exact six-class policy from stable live definitions", async () => {
    const rejection =
      (await rejectionBuilder.buildConversationDisclosureReviewRejectionV9({
        repositoryRoot: root,
      })).witness;
    const input = makePolicyInput(rejection);
    const policy =
      policyBuilder.createConversationDisclosureContinuationPolicyV9(input);

    expect(contract.validateContinuationPolicyV9(policy, {
      expectedDigest: policy.digest,
      baselineArchive: input.baselineArchive,
    })).toEqual([]);
    expect(policy.admissionClassSet).toEqual(
      contract.CONTINUATION_V9_ADMISSION_CLASSES,
    );
    expect(new Set(policy.admissionCoverage.map((entry: any) => entry.class)))
      .toEqual(new Set(contract.CONTINUATION_V9_ADMISSION_CLASSES));
    expect(policy.round8ReviewRejection.digest).toBe(rejection.digest);
    expect(policy.reviewAssurancePolicy).toEqual({
      callerDispatchAssurance: "caller-attested-not-signed",
      identityAssurance: "not-signed",
      independenceClaim: "caller-attested-distinct-review-contexts",
      localIdentityProof: false,
    });
    expect(policy.successor.featureDefinition.verification).toContain(
      policyBuilder.CONTINUATION_POLICY_V9_SUCCESSOR_CHECKER_VERIFICATION,
    );
    expect(policy.successor.featureDefinition.verification.some(
      (entry: string) =>
        entry.includes("check-conversation-disclosure-continuation-v8.mjs"),
    )).toBe(false);
  });

  test("rejects an incomplete finalized roster before policy construction", async () => {
    const rejection =
      (await rejectionBuilder.buildConversationDisclosureReviewRejectionV9({
        repositoryRoot: root,
      })).witness;
    const input = makePolicyInput(rejection);
    const feature = input.featureList.features.find(
      (entry: any) => entry.id === contract.CONTINUATION_V9_FEATURE_ID,
    );
    feature.files = feature.files.filter(
      (entry: string) => entry !== contract.CONTINUATION_V9_POLICY_PATH,
    );

    expect(() =>
      policyBuilder.createConversationDisclosureContinuationPolicyV9(input))
      .toThrow(`P107A V9 roster misses required path: ${
        contract.CONTINUATION_V9_POLICY_PATH
      }`);
  });

  test("rebinds exactly six present and three absent bookkeeping paths", async () => {
    const source = readJson(
      ".zerox/verification/conversation-disclosure/CD03A-round8-successor-evolution-policy.json",
    ).pathAuthorities;
    const present: string[] = [];
    const absent: string[] = [];
    const rebound = await policyBuilder.rebindRound9BookkeepingBaselinesV9(
      source,
      {
        readPresentDigest: async (relativePath: string) => {
          present.push(relativePath);
          return `sha256:${"a".repeat(64)}`;
        },
        assertAbsent: async (relativePath: string) => {
          absent.push(relativePath);
        },
      },
    );
    expect(present.sort()).toEqual([
      ...policyBuilder.CONTINUATION_POLICY_V9_PRESENT_BOOKKEEPING_PATHS,
    ].sort());
    expect(absent.sort()).toEqual([
      ...policyBuilder.CONTINUATION_POLICY_V9_ABSENT_BOOKKEEPING_PATHS,
    ].sort());
    for (const entry of rebound.filter(
      (candidate: any) => present.includes(candidate.path),
    )) {
      expect(entry.baseline).toMatchObject({
        source: "cd03a_review_snapshot",
        presence: "present",
      });
    }
  });

  test("publishes the deterministic rejection witness privately and idempotently", async () => {
    const fixture = await createRound8Fixture();
    const outputPath =
      contract.CONTINUATION_V9_ROUND8_REVIEW_REJECTION_PATH;
    const first =
      await rejectionBuilder.buildConversationDisclosureReviewRejectionV9({
        repositoryRoot: fixture,
        outputPath,
      });
    const publishedPath = path.join(fixture, outputPath);
    const firstStat = await stat(publishedPath);
    const second =
      await rejectionBuilder.buildConversationDisclosureReviewRejectionV9({
        repositoryRoot: fixture,
        outputPath,
      });
    const secondStat = await stat(publishedPath);

    expect(first.publicationStatus).toBe("created");
    expect(second.publicationStatus).toBe("idempotent");
    expect(first.witness.digest).toBe(second.witness.digest);
    expect(firstStat.mode & 0o777).toBe(0o600);
    expect(firstStat.nlink).toBe(1);
    expect(secondStat.ino).toBe(firstStat.ino);
    expect(await readFile(publishedPath)).toEqual(first.bytes);
  });

  test("rejects Round8 receipt byte drift before creating a witness", async () => {
    const fixture = await createRound8Fixture();
    const receiptPath = path.join(
      fixture,
      contract.CONTINUATION_V9_ROUND8_RECEIPT_TRUST_ROOTS[0].path,
    );
    await appendFile(receiptPath, "\n");

    await expect(
      rejectionBuilder.buildConversationDisclosureReviewRejectionV9({
        repositoryRoot: fixture,
      }),
    ).rejects.toThrow("bytes differ from the hard rejection root");
  });
});

async function createRound8Fixture() {
  const created = await mkdtemp(path.join(os.tmpdir(), "zerox-r4-policy-test."));
  temporaryRoots.push(created);
  const fixture = await realpath(created);
  const required = [
    contract.CONTINUATION_V9_ROUND8_POLICY_TRUST_ROOT.path,
    contract.CONTINUATION_V9_ROUND8_SNAPSHOT_TRUST_ROOT.path,
    ...contract.CONTINUATION_V9_ROUND8_RECEIPT_TRUST_ROOTS.map(
      (entry: any) => entry.path,
    ),
    ".zerox/verification/conversation-disclosure/CD03A-round8-baseline-archive.json",
  ];
  for (const relativePath of required) {
    const destination = path.join(fixture, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(root, relativePath), destination);
  }
  for (const relativePath of [
    contract.CONTINUATION_V9_ROUND8_POLICY_TRUST_ROOT.path,
    contract.CONTINUATION_V9_ROUND8_SNAPSHOT_TRUST_ROOT.path,
    ...contract.CONTINUATION_V9_ROUND8_RECEIPT_TRUST_ROOTS.map(
      (entry: any) => entry.path,
    ),
    ".zerox/verification/conversation-disclosure/CD03A-round8-baseline-archive.json",
  ]) {
    await chmod(path.join(fixture, relativePath), 0o600);
  }
  return fixture;
}
