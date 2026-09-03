import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const freezer = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/freeze-conversation-disclosure-continuation-v7.mjs"
);

const source = readFileSync(path.join(
  process.cwd(),
  "scripts/freeze-conversation-disclosure-continuation-v7.mjs",
), "utf8");

describe("conversation disclosure continuation freezer v7", () => {
  test("requires a caller-fixed canonical freeze time", async () => {
    await expect(freezer.freezeConversationDisclosureContinuationV7({
      repositoryRoot: process.cwd(),
      expectedPolicyDigest: `sha256:${"0".repeat(64)}`,
    })).rejects.toThrow(
      "caller must supply one canonical --frozen-at timestamp",
    );
  });

  test("captures every admission category in one postflight ledger", () => {
    expect(source).toContain("createCaptureLedgerV7()");
    expect(source).toContain("capturePrivateEvidenceV7");
    expect(source).toContain("captureRequiredAbsentV7");
    expect(source).toContain("postflightCaptureLedgerV7(ledger)");
    expect(source.indexOf("postflightCaptureLedgerV7(ledger)"))
      .toBeLessThan(source.indexOf("publishPrivateExactV7(outputAbsolute"));
  });

  test("uses the shared transition and snapshot validators", () => {
    expect(source).toContain("validateGovernanceTransitionStateV7(");
    expect(source).toContain("validateContinuationReviewSnapshotV7(");
    expect(source).toContain(
      "output must be the exact Round7 review snapshot path",
    );
  });
});
