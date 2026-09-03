import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const freezer = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/freeze-conversation-disclosure-continuation-v10.mjs"
);

const source = readFileSync(path.join(
  process.cwd(),
  "scripts/freeze-conversation-disclosure-continuation-v10.mjs",
), "utf8");

describe("conversation disclosure continuation freezer v10", () => {
  test("requires a caller-fixed canonical freeze time", async () => {
    await expect(freezer.freezeConversationDisclosureContinuationV10({
      repositoryRoot: process.cwd(),
      expectedPolicyDigest: `sha256:${"0".repeat(64)}`,
    })).rejects.toThrow(
      "caller must supply one canonical --frozen-at timestamp",
    );
  });

  test("captures every admission category in one postflight ledger", () => {
    expect(source).toContain("createCaptureLedgerV10()");
    expect(source).toContain("capturePrivateEvidenceV10");
    expect(source).toContain("captureRequiredAbsentV10");
    expect(source).toContain("postflightCaptureLedgerV10(ledger)");
    expect(source.indexOf("postflightCaptureLedgerV10(ledger)"))
      .toBeLessThan(source.indexOf("publishPrivateExactV10(outputAbsolute"));
  });

  test("uses the shared transition and snapshot validators", () => {
    expect(source).toContain("validateGovernanceTransitionStateV10(");
    expect(source).toContain("validateContinuationReviewSnapshotV10(");
    expect(source).toContain(
      "output must be the exact Round10 review snapshot path",
    );
  });
});
