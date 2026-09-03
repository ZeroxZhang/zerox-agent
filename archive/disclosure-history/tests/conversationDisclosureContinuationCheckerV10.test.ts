import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const checker = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/check-conversation-disclosure-continuation-v10.mjs"
);

const source = readFileSync(path.join(
  process.cwd(),
  "scripts/check-conversation-disclosure-continuation-v10.mjs",
), "utf8");

describe("conversation disclosure continuation checker v10", () => {
  test("rejects an unpinned or unknown mode before reading evidence", async () => {
    await expect(
      checker.runConversationDisclosureContinuationCheckerV10([]),
    ).rejects.toThrow("checker option is required");
    await expect(
      checker.runConversationDisclosureContinuationCheckerV10([
        "--mode", "candidate_self_authorized",
      ]),
    ).rejects.toThrow("checker V10 --mode is invalid");
  });

  test("keeps review-post and externally anchored evidence states distinct", () => {
    expect(source).toContain(
      'options.mode === "review_post_transition"',
    );
    expect(source).toContain(
      "review_post_transition requires the pending manifest",
    );
    expect(source).toContain(
      "ordinary mode requires an externally attested manifest",
    );
    expect(source).toContain(
      "ordinary mode requires a caller-pinned continuation anchor",
    );
  });

  test("postflights every captured authority before returning a receipt", () => {
    expect(source).toContain("createCaptureLedgerV10()");
    expect(source).toContain("postflightCaptureLedgerV10(ledger)");
    expect(source).toContain("authoritative: true");
    expect(source.indexOf("postflightCaptureLedgerV10(ledger)"))
      .toBeLessThan(source.indexOf("const receiptWithoutDigest"));
  });

  test("derives final evidence from canonical roots and caller-held runner results", () => {
    expect(source).toContain(
      'captureControl(CHECKER_PATH, "Round10 manifest validator")',
    );
    expect(source).toContain(
      'captureControl(RUNNER_PATH, "Round10 manifest runner")',
    );
    expect(source).toContain("buildExpectedPendingManifestV10({");
    expect(source).toContain("candidateResults: anchor?.candidateResults");
    expect(source).not.toContain(
      'captureControl(manifest.validator?.path, "Round10 manifest validator")',
    );
    expect(source).not.toContain("reconstructPendingManifestV10(manifest)");
  });
});
