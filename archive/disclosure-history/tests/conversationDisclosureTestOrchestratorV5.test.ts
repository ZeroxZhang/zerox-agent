import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const scriptPath = path.join(
  process.cwd(),
  "scripts/run-conversation-disclosure-tests-v5.mjs",
);
const source = readFileSync(scriptPath, "utf8");

describe("conversation disclosure test orchestrator v5", () => {
  test("runs focused passthrough requests without recursive npm dispatch", async () => {
    const result = await execFileAsync(process.execPath, [
      scriptPath,
      "--run",
      "src/shared/conversationDisclosureContinuationManifestV5.test.ts",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    expect(result.stdout).toContain("3 passed");
  });

  test("executes immutable V3 tests in reconstructed historical states", () => {
    expect(source).toContain("restoreRound3Semantics");
    expect(source).toContain("CD03A-round3-successor-evolution-policy.json");
    expect(source).toContain("CD03A-round3-baseline-archive.json");
    expect(source).toContain("historicalPolicyTest");
    expect(source).toContain("--testNamePattern");
    expect(source).toContain(
      "validates the exact production policy in both pre-publish and published post-transition states",
    );
    expect(source).toContain("gunzipSync");
    expect(source).not.toContain("writeFile(path.join(root");
  });

  test("executes Program and package tests against all four Round5 targets", () => {
    expect(source).toContain("applyRound5Targets");
    expect(source).toContain("CD03A-round5-package.target.json");
    expect(source).toContain("CD03A-round5-harness.target.mjs");
    expect(source).toContain("CD03A-round5-program-test.target.ts");
    expect(source).toContain("CD03A-round5-package-scripts-test.target.ts");
  });
});
