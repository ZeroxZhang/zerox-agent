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
  "../../scripts/build-conversation-disclosure-review-rejection-v11.mjs"
);
const policyBuilder = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/build-conversation-disclosure-continuation-policy-v11.mjs"
);
const contract = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-continuation-contract-v11.mjs"
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
    ".zerox/verification/conversation-disclosure/CD03A-round10-baseline-archive.json",
  );
  const value = {
    ...source,
    schemaVersion: 11,
    kind: contract.CONTINUATION_V11_BASELINE_ARCHIVE_KIND,
    round: 11,
  };
  delete value.digest;
  value.digest = contract.hashCanonicalV11(value);
  return value;
}

function makePolicyInput(rejection: any) {
  const program = readJson(".zerox/conversation-disclosure-program.json");
  const featureList = readJson(".zerox/feature_list.json");
  const parentPolicy = readJson(
    ".zerox/verification/conversation-disclosure/CD03A-round10-successor-evolution-policy.json",
  );
  const feature = featureList.features.find(
    (entry: any) => entry.id === contract.CONTINUATION_V11_FEATURE_ID,
  );
  feature.files = [...new Set([
    ...feature.files,
    ...policyBuilder.CONTINUATION_POLICY_V11_REQUIRED_ROSTER_PATHS,
  ])];
  const continuationExecutables =
    contract.CONTINUATION_V11_EXECUTABLE_KINDS.map(
      (kind: string, index: number) => ({
        kind,
        path: contract.CONTINUATION_V11_EXECUTABLE_PATH_BY_KIND[kind],
        sha256: `sha256:${String(index + 1).repeat(64).slice(0, 64)}`,
      }),
    );
  return {
    program,
    featureList,
    parentPolicy,
    round10ReviewRejection: rejection,
    baselineArchive: makeArchive(),
    pathAuthorities: structuredClone(parentPolicy.pathAuthorities),
    continuationExecutables,
  };
}

describe("conversation disclosure continuation policy v11 builder", () => {
  test("builds one exact six-class policy from stable live definitions", async () => {
    const rejection =
      (await rejectionBuilder.buildConversationDisclosureReviewRejectionV11({
        repositoryRoot: root,
      })).witness;
    const input = makePolicyInput(rejection);
    const policy =
      policyBuilder.createConversationDisclosureContinuationPolicyV11(input);

    expect(contract.validateContinuationPolicyV11(policy, {
      expectedDigest: policy.digest,
      baselineArchive: input.baselineArchive,
    })).toEqual([]);
    expect(policy.admissionClassSet).toEqual(
      contract.CONTINUATION_V11_ADMISSION_CLASSES,
    );
    expect(new Set(policy.admissionCoverage.map((entry: any) => entry.class)))
      .toEqual(new Set(contract.CONTINUATION_V11_ADMISSION_CLASSES));
    expect(policy.round10ReviewRejection.digest).toBe(rejection.digest);
    expect(policy.reviewAssurancePolicy).toEqual({
      callerDispatchAssurance: "caller-attested-not-signed",
      identityAssurance: "not-signed",
      independenceClaim: "caller-attested-distinct-review-contexts",
      localIdentityProof: false,
    });
    expect(policy.successor.featureDefinition.verification).toContain(
      policyBuilder.CONTINUATION_POLICY_V11_SUCCESSOR_CHECKER_VERIFICATION,
    );
    expect(policy.successor.featureDefinition.verification.some(
      (entry: string) =>
        entry.includes("check-conversation-disclosure-continuation-v10.mjs"),
    )).toBe(false);
  });

  test("rejects an incomplete finalized roster before policy construction", async () => {
    const rejection =
      (await rejectionBuilder.buildConversationDisclosureReviewRejectionV11({
        repositoryRoot: root,
      })).witness;
    const input = makePolicyInput(rejection);
    const feature = input.featureList.features.find(
      (entry: any) => entry.id === contract.CONTINUATION_V11_FEATURE_ID,
    );
    feature.files = feature.files.filter(
      (entry: string) => entry !== contract.CONTINUATION_V11_POLICY_PATH,
    );

    expect(() =>
      policyBuilder.createConversationDisclosureContinuationPolicyV11(input))
      .toThrow(`P107A V11 roster misses required path: ${
        contract.CONTINUATION_V11_POLICY_PATH
      }`);
  });

  test("rebinds exactly six present and three absent bookkeeping paths", async () => {
    const source = readJson(
      ".zerox/verification/conversation-disclosure/CD03A-round10-successor-evolution-policy.json",
    ).pathAuthorities;
    const present: string[] = [];
    const absent: string[] = [];
    const rebound = await policyBuilder.rebindRound11BookkeepingBaselinesV11(
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
      ...policyBuilder.CONTINUATION_POLICY_V11_PRESENT_BOOKKEEPING_PATHS,
    ].sort());
    expect(absent.sort()).toEqual([
      ...policyBuilder.CONTINUATION_POLICY_V11_ABSENT_BOOKKEEPING_PATHS,
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
    const fixture = await createRound10Fixture();
    const outputPath =
      contract.CONTINUATION_V11_ROUND10_REVIEW_REJECTION_PATH;
    const first =
      await rejectionBuilder.buildConversationDisclosureReviewRejectionV11({
        repositoryRoot: fixture,
        outputPath,
      });
    const publishedPath = path.join(fixture, outputPath);
    const firstStat = await stat(publishedPath);
    const second =
      await rejectionBuilder.buildConversationDisclosureReviewRejectionV11({
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

  test("rejects Round10 receipt byte drift before creating a witness", async () => {
    const fixture = await createRound10Fixture();
    const receiptPath = path.join(
      fixture,
      contract.CONTINUATION_V11_ROUND10_RECEIPT_TRUST_ROOTS[0].path,
    );
    await appendFile(receiptPath, "\n");

    await expect(
      rejectionBuilder.buildConversationDisclosureReviewRejectionV11({
        repositoryRoot: fixture,
      }),
    ).rejects.toThrow("bytes differ from the hard rejection root");
  });
});

async function createRound10Fixture() {
  const created = await mkdtemp(path.join(os.tmpdir(), "zerox-r4-policy-test."));
  temporaryRoots.push(created);
  const fixture = await realpath(created);
  const required = [
    contract.CONTINUATION_V11_ROUND10_POLICY_TRUST_ROOT.path,
    contract.CONTINUATION_V11_ROUND10_SNAPSHOT_TRUST_ROOT.path,
    ...contract.CONTINUATION_V11_ROUND10_RECEIPT_TRUST_ROOTS.map(
      (entry: any) => entry.path,
    ),
    ".zerox/verification/conversation-disclosure/CD03A-round10-baseline-archive.json",
  ];
  for (const relativePath of required) {
    const destination = path.join(fixture, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(root, relativePath), destination);
  }
  for (const relativePath of [
    contract.CONTINUATION_V11_ROUND10_POLICY_TRUST_ROOT.path,
    contract.CONTINUATION_V11_ROUND10_SNAPSHOT_TRUST_ROOT.path,
    ...contract.CONTINUATION_V11_ROUND10_RECEIPT_TRUST_ROOTS.map(
      (entry: any) => entry.path,
    ),
    ".zerox/verification/conversation-disclosure/CD03A-round10-baseline-archive.json",
  ]) {
    await chmod(path.join(fixture, relativePath), 0o600);
  }
  return fixture;
}
