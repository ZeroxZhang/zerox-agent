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
    expect(steps.map((step) => step.run).filter(Boolean)).toEqual([
      "npm ci",
      "npm run verify",
      "npm run harness:check",
    ]);
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
    expect(
      steps[verifyStepIndex]?.run
        ?.trim()
        .split(/\r?\n/)
        .map((command) => command.trim()),
    ).toEqual([
      "npm run typecheck:tests",
      "npm test -- --maxWorkers=1",
      "npm run stress:runtime",
      "npm run build",
      "npm run eval:agent:built",
      "npm run eval:memory:built",
      "npm run smoke:prod:built",
      "npm run harness:check",
    ]);
    expect(signingStep?.env?.UPDATE_SIGNING_PRIVATE_KEY).toBe(
      "${{ secrets.ZEROX_UPDATE_SIGNING_PRIVATE_KEY }}",
    );
    expect(publishStep?.env).toMatchObject({
      GH_TOKEN: "${{ github.token }}",
    });
  });
});
