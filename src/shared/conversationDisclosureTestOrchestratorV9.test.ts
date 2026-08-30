import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const orchestrator = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/run-conversation-disclosure-tests-v9.mjs"
);
const scriptPath = path.join(
  process.cwd(),
  "scripts/run-conversation-disclosure-tests-v9.mjs",
);
const source = readFileSync(scriptPath, "utf8");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((entry) =>
    rm(entry, { recursive: true, force: true })));
});

describe("conversation disclosure test orchestrator v9", () => {
  test("runs focused passthrough requests without recursive npm dispatch", async () => {
    const result = await execFileAsync(process.execPath, [
      scriptPath,
      "--run",
      "src/shared/conversationDisclosureContinuationManifestV9.test.ts",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    expect(result.stdout).toContain("3 passed");
  });

  test("executes immutable V3, V4, V7, and V8 tests in reconstructed historical states", () => {
    expect(source).toContain("restoreRound3Semantics");
    expect(source).toContain("restoreRound4Semantics");
    expect(source).toContain("restoreRound7Semantics");
    expect(source).toContain("restoreRound8Semantics");
    expect(source).toContain("CD03A-round3-successor-evolution-policy.json");
    expect(source).toContain("CD03A-round3-baseline-archive.json");
    expect(source).toContain("historicalV3PolicyTest");
    expect(source).toContain("historicalV4Tests");
    expect(source).toContain("historicalV8Tests");
    expect(source).toContain("historicalV7Tests");
    expect(source).toContain(
      "conversationDisclosureContinuationPolicyV4.test.ts",
    );
    expect(source).toContain(
      "conversationDisclosureContinuationProgramGovernanceV8.test.ts",
    );
    expect(source).toContain("--testNamePattern");
    expect(source).toContain(
      "validates the exact production policy in both pre-publish and published post-transition states",
    );
    expect(source).toContain(
      'process.platform === "darwin" ? "/private/tmp" : os.tmpdir()',
    );
    expect(source).toContain("gunzipSync");
    expect(source).not.toContain("writeFile(path.join(root");
  });

  test("executes Program and package tests against all four Round9 targets", () => {
    expect(source).toContain("applyRound9Targets");
    expect(source).toContain("CD03A-round9-package.target.json");
    expect(source).toContain("CD03A-round9-harness.target.mjs");
    expect(source).toContain("CD03A-round9-program-test.target.ts");
    expect(source).toContain("CD03A-round9-package-scripts-test.target.ts");
  });

  test("reconstructs the all-from current lane when invoked from all-to", async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), "zerox-r9-state-"));
    temporaryRoots.push(fixture);
    const archivePath =
      ".zerox/verification/conversation-disclosure/CD03A-round8-baseline-archive.json";
    await copyFixtureFile(archivePath, fixture);

    for (const transition of orchestrator.ROUND9_TRANSITION_MAPPINGS) {
      await copyFixtureFile(transition.source, fixture);
      await copyFixtureFile(transition.destination, fixture);
    }
    await expect(
      orchestrator.detectRound9TransitionState(fixture),
    ).resolves.toBe("source");

    for (const transition of orchestrator.ROUND9_TRANSITION_MAPPINGS) {
      await writeFile(
        path.join(fixture, transition.destination),
        await readFile(path.join(fixture, transition.source)),
      );
    }
    await expect(
      orchestrator.detectRound9TransitionState(fixture),
    ).resolves.toBe("target");

    await orchestrator.restoreCurrentRound9Sources(fixture);
    await expect(
      orchestrator.detectRound9TransitionState(fixture),
    ).resolves.toBe("source");
  });
});

async function copyFixtureFile(relativePath: string, fixture: string) {
  const destination = path.join(fixture, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(path.join(process.cwd(), relativePath)));
}
