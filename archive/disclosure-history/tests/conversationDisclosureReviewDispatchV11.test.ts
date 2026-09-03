import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const builder = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/build-conversation-disclosure-review-dispatch-v11.mjs"
);

const source = readFileSync(path.join(
  process.cwd(),
  "scripts/build-conversation-disclosure-review-dispatch-v11.mjs",
), "utf8");
const digest = (character: string) => `sha256:${character.repeat(64)}`;

function fixture() {
  return {
    policy: {
      digest: digest("a"),
      round10ReviewRejection: { digest: digest("b") },
    },
    snapshot: {
      digest: digest("c"),
      policyDigest: digest("a"),
    },
    challenges: [
      ["contract", digest("1")],
      ["runtime", digest("2")],
      ["governance", digest("3")],
    ],
  };
}

describe("conversation disclosure review dispatch v11", () => {
  test("hashes the exact published instruction bytes including final newline", () => {
    const result = builder.buildReviewDispatchArtifactsV11(fixture());

    expect(result.entries).toHaveLength(3);
    expect(result.instructions).toHaveLength(3);
    for (const instruction of result.instructions) {
      const entry = result.entries.find(
        (candidate: { lane: string }) => candidate.lane === instruction.lane,
      );
      const byteDigest = `sha256:${createHash("sha256")
        .update(instruction.bytes).digest("hex")}`;
      expect(instruction.bytes.at(-1)).toBe(0x0a);
      expect(instruction.sha256).toBe(byteDigest);
      expect(entry.instructionDigest).toBe(byteDigest);
      expect(`sha256:${createHash("sha256")
        .update(instruction.bytes.subarray(0, -1)).digest("hex")}`)
        .not.toBe(byteDigest);
    }
  });

  test("rejects missing, malformed, or duplicate challenges", () => {
    const valid = fixture();
    for (const challenges of [
      valid.challenges.slice(1),
      valid.challenges.map(([lane]) => [lane, "not-a-digest"]),
      valid.challenges.map(([lane]) => [lane, digest("1")]),
    ]) {
      expect(() => builder.buildReviewDispatchArtifactsV11({
        ...valid,
        challenges,
      })).toThrow("three unique lane challenges");
    }
  });

  test("publishes every instruction and the dispatch set through private no-replace I/O", () => {
    expect(source).toContain("publishPrivateExactV11(");
    expect(source).toContain("postflightCaptureLedgerV11(ledger)");
    expect(source.indexOf("postflightCaptureLedgerV11(ledger)"))
      .toBeLessThan(source.indexOf("publishPrivateExactV11("));
    expect(source).toContain("repository-external");
    expect(source).toContain("current-user-owned and private");
  });
});
