import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const orchestrator = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/run-conversation-disclosure-tests-v13.mjs"
);

describe("conversation disclosure test orchestrator v13", () => {
  it("classifies every V2-V12 continuation test as historical", async () => {
    const tests = await orchestrator.listVersionedHistoricalTests();

    for (const version of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      expect(tests.some((entry: string) =>
        entry.includes(`V${version}.test.ts`))).toBe(true);
    }
    expect(tests.some((entry: string) =>
      entry.includes("V13.test.ts"))).toBe(false);
  });

  it("restores earlier admission inputs without deleting their evidence files", () => {
    const source = readFileSync(path.join(
      process.cwd(),
      "scripts/run-conversation-disclosure-tests-v13.mjs",
    ), "utf8");

    expect(source).toContain("restoreRoundAdmission(fixture, round)");
    expect(source).toContain("2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12");
    expect(source).toContain("postRound12FeatureIds.has(entry.id)");
    expect(source).toContain(
      "policy.closedWorld?.programRootDefinition",
    );
    expect(source).toContain("structuredClone(historicalProgramRoot)");
    expect(source).toContain("acceptanceEvidence: []");
    expect(source).toContain("{ testTimeoutMs: 15_000 }");
    expect(source).toContain(
      "validates the exact production policy in both pre-publish and published post-transition states",
    );
    expect(source).toContain('["--testTimeout", String(options.testTimeoutMs)]');
    expect(source).not.toMatch(
      /historicalTests[\s\S]{0,300}\.map\(\(entry\) => rm/,
    );
  });

  it("keeps historical fixtures inside the caller-provided temporary root", () => {
    const source = readFileSync(path.join(
      process.cwd(),
      "scripts/run-conversation-disclosure-tests-v13.mjs",
    ), "utf8");
    expect(source).toContain("const fixtureBase = os.tmpdir()");
    expect(source).not.toContain(
      'process.platform === "darwin" ? "/private/tmp"',
    );
  });

  it("skips only real nested Seatbelt effects under the outer acceptance sandbox", () => {
    for (const relativePath of [
      "src/main/agentToolExecutor.test.ts",
      "src/main/mcpClient.test.ts",
      "src/main/nativeTestRunTool.test.ts",
      "src/main/processSandbox.e2e.test.ts",
    ]) {
      const source = readFileSync(
        path.join(process.cwd(), relativePath),
        "utf8",
      );
      expect(source).toContain(
        'process.env.ZEROX_V392_OUTER_SANDBOX === "1"',
      );
    }
  });
});
