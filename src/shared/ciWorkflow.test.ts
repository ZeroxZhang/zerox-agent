import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

type WorkflowStep = {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};

type VerifyWorkflow = {
  name?: string;
  on?: {
    pull_request?: unknown;
    push?: {
      branches?: string[];
    };
  };
  jobs?: {
    verify?: {
      "runs-on"?: string;
      steps?: WorkflowStep[];
    };
  };
};

type ReleaseWorkflow = {
  name?: string;
  on?: {
    push?: {
      tags?: string[];
    };
  };
  permissions?: {
    contents?: string;
  };
  jobs?: {
    "macos-arm64"?: {
      if?: string;
      "runs-on"?: string;
      steps?: WorkflowStep[];
    };
  };
};

describe("GitHub verify workflow", () => {
  it("runs deterministic verification on pull requests and main pushes", () => {
    const workflowPath = path.join(process.cwd(), ".github/workflows/verify.yml");

    expect(existsSync(workflowPath)).toBe(true);
    if (!existsSync(workflowPath)) return;

    const workflow = parse(readFileSync(workflowPath, "utf8")) as VerifyWorkflow;
    const steps = workflow.jobs?.verify?.steps ?? [];

    expect(workflow.name).toBe("verify");
    expect(workflow.on).toEqual({
      pull_request: null,
      push: {
        branches: ["main"],
      },
    });
    expect(workflow.jobs?.verify?.["runs-on"]).toBe("ubuntu-latest");
    expect(steps).toContainEqual({ uses: "actions/checkout@v4" });
    expect(steps).toContainEqual({
      uses: "actions/setup-node@v4",
      with: {
        "node-version": 22,
        cache: "npm",
      },
    });
    expect(steps[2]?.run).toBe("npm ci");
    const developmentStep = steps.find(
      (step) => step.name === "Verify development change",
    );
    const sealedMainStep = steps.find(
      (step) => step.name === "Verify sealed main",
    );
    expect(developmentStep).toMatchObject({
      if: "github.event_name == 'pull_request'",
      run: "npm run verify",
    });
    expect(sealedMainStep).toMatchObject({
      if: "github.event_name == 'push'",
      env: {
        ZEROX_V392_RELEASE_ATTESTATION_DIGEST: "$" + "{{ secrets.ZEROX_V392_RELEASE_ATTESTATION_DIGEST }}",
      },
    });
    const sealedCommands = (sealedMainStep?.run ?? "")
      .split(/\r?\n/)
      .map((command) => command.trim())
      .filter(Boolean);
    expect(sealedCommands).toEqual([
      "npm run harness:check",
      "npm run typecheck:tests",
      "npm run stress:runtime",
      "npm run build",
      "npm run eval:agent:built",
      "npm run eval:memory:built",
    ]);
    expect(sealedCommands.join("\n")).not.toContain("npm run verify");
    expect(sealedCommands.join("\n")).not.toContain("npm test");
  });

  it("keeps display-dependent smoke commands out of CI", () => {
    const workflowPath = path.join(process.cwd(), ".github/workflows/verify.yml");
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(existsSync(workflowPath)).toBe(true);
    if (!existsSync(workflowPath)) return;

    const workflowSource = readFileSync(workflowPath, "utf8");

    expect(workflowSource).not.toContain("smoke:prod");
    expect(workflowSource).not.toContain("xvfb-run");
    expect(packageJson.scripts.verify).not.toContain("electron");
  });

  it("runs strict test types, stress, and real smoke before tagged release packaging", () => {
    const workflow = parse(readFileSync(
      path.join(process.cwd(), ".github", "workflows", "release.yml"),
      "utf8",
    )) as ReleaseWorkflow;
    const job = workflow.jobs?.["macos-arm64"];
    const steps = job?.steps ?? [];
    const verifyStepIndex = steps.findIndex(
      (step) => step.name === "Verify source tree",
    );
    const releaseStepIndex = steps.findIndex(
      (step) => step.run === "npm run release:mac",
    );
    const publishStep = steps.find(
      (step) =>
        step.run ===
        'npm run release:publish -- "${GITHUB_WORKSPACE}/.github/release-notes/${GITHUB_REF_NAME}.md"',
    );
    const signingStep = steps.find(
      (step) => step.name === "Materialize update signing key",
    );

    expect(workflow.name).toBe("release");
    expect(workflow.on?.push?.tags).toEqual(["v*.*.*"]);
    expect(workflow.permissions).toEqual({ contents: "write" });
    expect(job).toMatchObject({
      if: "github.repository == 'ZeroxZhang/zerox-agent'",
      "runs-on": "macos-14",
    });
    expect(verifyStepIndex).toBeGreaterThanOrEqual(0);
    expect(releaseStepIndex).toBeGreaterThan(verifyStepIndex);
    const verifyCommands = (steps[verifyStepIndex]?.run ?? "")
      .split(/\r?\n/)
      .map((command) => command.trim())
      .filter((command) => command && !command.startsWith("#"));
    expect(verifyCommands).toEqual([
      "npm run harness:check",
      "npm run typecheck:tests",
      "npm run stress:runtime",
      "npm run build",
      "npm run eval:agent:built",
      "npm run eval:memory:built",
      "npm run smoke:prod:built",
    ]);
    expect(verifyCommands.join("\n")).not.toContain("npm test");
    expect(signingStep?.env?.UPDATE_SIGNING_PRIVATE_KEY).toBe(
      "${{ secrets.ZEROX_UPDATE_SIGNING_PRIVATE_KEY }}",
    );
    expect(publishStep?.env).toMatchObject({
      GH_TOKEN: "${{ github.token }}",
    });
  });
});
