import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const manifestBuilder = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/build-conversation-disclosure-continuation-manifest-v5.mjs"
);
const contract = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-continuation-contract-v5.mjs"
);

const source = readFileSync(path.join(
  process.cwd(),
  "scripts/build-conversation-disclosure-continuation-manifest-v5.mjs",
), "utf8");

describe("conversation disclosure continuation manifest v5", () => {
  test("requires external dispatch, policy, and snapshot caller pins", async () => {
    await expect(
      manifestBuilder.buildConversationDisclosureContinuationManifestV5({
        repositoryRoot: process.cwd(),
      }),
    ).rejects.toThrow(
      "caller must pin dispatch set, policy, and snapshot digests",
    );
  });

  test("derives one pending digest across pending and final forms", () => {
    const base = {
      schemaVersion: 5,
      status: "review_passed_pending_external_transaction",
      externalAttestation: { path: "attestation.json", canonicalDigest: null },
    };
    const pendingDigest = contract.pendingManifestDigestV5(base);
    const final = {
      ...base,
      status: "externally_attested",
      pendingManifestDigest: pendingDigest,
      digest: `sha256:${"0".repeat(64)}`,
      externalAttestation: {
        path: "attestation.json",
        canonicalDigest: `sha256:${"1".repeat(64)}`,
      },
    };
    expect(contract.pendingManifestDigestV5(final)).toBe(pendingDigest);
  });

  test("captures the private external dispatch set and postflights before publish", () => {
    expect(source).toContain("dispatch set must be canonical and repository-external");
    expect(source).toContain("capturePrivateEvidenceV5(");
    expect(source).toContain("validateContinuationReviewSetV5(");
    expect(source).toContain("postflightCaptureLedgerV5(ledger)");
    expect(source.indexOf("postflightCaptureLedgerV5(ledger)"))
      .toBeLessThan(source.indexOf("publishPrivateExactV5("));
  });
});
