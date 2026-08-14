import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

type WorkflowStep = {
  uses?: string;
  run?: string;
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

  it("runs the opt-in stress gate before tagged release packaging", () => {
    const workflowSource = readFileSync(
      path.join(process.cwd(), ".github", "workflows", "release.yml"),
      "utf8",
    );

    expect(workflowSource).toContain('tags:\n      - "v*.*.*"');
    expect(workflowSource).toContain(
      "secrets.ZEROX_UPDATE_SIGNING_PRIVATE_KEY",
    );
    expect(workflowSource).toContain("npm run stress:runtime");
    expect(workflowSource.indexOf("npm run stress:runtime")).toBeLessThan(
      workflowSource.indexOf("npm run release:mac"),
    );
    expect(workflowSource).toContain("npm run release:publish");
  });
});
