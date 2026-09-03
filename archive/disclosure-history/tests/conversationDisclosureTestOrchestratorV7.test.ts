import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const scriptPath = path.join(
  process.cwd(),
  "scripts/run-conversation-disclosure-tests-v7.mjs",
);
const source = readFileSync(scriptPath, "utf8");

describe("conversation disclosure test orchestrator v7", () => {
  test("runs focused passthrough requests without recursive npm dispatch", async () => {
    const result = await execFileAsync(process.execPath, [
      scriptPath,
      "--run",
      "src/shared/conversationDisclosureContinuationManifestV7.test.ts",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    expect(result.stdout).toContain("3 passed");
  });

  test("executes immutable V3 and V4 tests in reconstructed historical states", () => {
    expect(source).toContain("restoreRound3Semantics");
    expect(source).toContain("restoreRound4Semantics");
    expect(source).toContain("CD03A-round3-successor-evolution-policy.json");
    expect(source).toContain("CD03A-round3-baseline-archive.json");
    expect(source).toContain("historicalV3PolicyTest");
    expect(source).toContain("historicalV4Tests");
    expect(source).toContain(
      "conversationDisclosureContinuationPolicyV4.test.ts",
    );
    expect(source).toContain("--testNamePattern");
    expect(source).toContain(
      "validates the exact production policy in both pre-publish and published post-transition states",
    );
    expect(source).toContain("gunzipSync");
    expect(source).not.toContain("writeFile(path.join(root");
  });

  test("executes Program and package tests against all four Round7 targets", () => {
    expect(source).toContain("applyRound7Targets");
    expect(source).toContain("CD03A-round7-package.target.json");
    expect(source).toContain("CD03A-round7-harness.target.mjs");
    expect(source).toContain("CD03A-round7-program-test.target.ts");
    expect(source).toContain("CD03A-round7-package-scripts-test.target.ts");
  });
});
