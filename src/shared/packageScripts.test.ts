import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  version?: string;
  scripts?: Record<string, string>;
};

describe("package scripts", () => {
  it("sets release metadata to v2.8.4", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;
    const packageLock = JSON.parse(
      readFileSync(path.join(process.cwd(), "package-lock.json"), "utf8"),
    ) as { version?: string; packages?: Record<string, { version?: string }> };

    expect(packageJson.version).toBe("2.8.4");
    expect(packageLock.version).toBe("2.8.4");
    expect(packageLock.packages?.[""]?.version).toBe("2.8.4");
  });

  it("keeps release gates done through v2.8.4", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;
    const featureList = JSON.parse(
      readFileSync(path.join(process.cwd(), ".zerox/feature_list.json"), "utf8"),
    ) as {
      features: Array<{
        id: string;
        status: string;
        definitionOfDone?: string[];
      }>;
    };

    expect(packageJson.version).toBe("2.8.4");
    expect(featureList.features.filter((feature) => feature.status !== "done")).toEqual([]);
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P21-v2.8.4-empty-response-hotfix",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("agent loop remembers the latest tool failure"),
          expect.stringContaining("empty model follow-up responses"),
          expect.stringContaining("package metadata reports version 2.8.4"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P20-v2.8.3-time-semantics-hotfix",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("protected local date context"),
          expect.stringContaining("web_search tool descriptions require date-sensitive queries"),
          expect.stringContaining("package metadata reports version 2.8.3"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P19-v2.8.2-chat-rename-message-skill-polish",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("session more menu exposes rename"),
          expect.stringContaining("explicitly selected skills are preloaded"),
          expect.stringContaining("package metadata reports version 2.8.2"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P18-v2.8.1-runtime-surface-polish-release",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("package metadata reports version 2.8.1"),
          expect.stringContaining("real-time thinking and tool preview"),
          expect.stringContaining("@skill capsule remains in the lower composer"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P17-v2.8.0-runtime-orchestration-memory",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("ExecutionContextPackage"),
          expect.stringContaining("skill_load"),
          expect.stringContaining("tool invocation ledger"),
          expect.stringContaining("raw history"),
          expect.stringContaining("computer-use black-box acceptance"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P16-v2.7.0-ui-interaction",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("Chat supports first-class streamed answer output"),
          expect.stringContaining("Focused tests, full verification, production smoke, packaged smoke, black-box QA, and independent acceptance pass"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P15-hardening-release-2.6.0",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("sandbox escape paths hardened"),
          expect.stringContaining("package version bumped to 2.6.0"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P14-workspace-skill-execution-2.5.0",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("first-class workspace selection"),
          expect.stringContaining("package version bumped to 2.5.0"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P12.1-session-history-management-2.4.1",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("archive/delete session actions"),
          expect.stringContaining("package version bumped to 2.4.1"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P12-2.4.0-iteration-activation-and-release",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("iteration-roadmap P1-P8 activated"),
          expect.stringContaining("package version bumped to 2.4.0"),
        ]),
      }),
    );
    expect(featureList.features).not.toContainEqual(
      expect.objectContaining({
        id: "P12-2.4.0-iteration-activation-and-release",
        status: "in_progress",
      }),
    );
    // Prior release gate stays done (no regression).
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P11.7-v2.3.6-release-metadata-and-distribution",
        status: "done",
      }),
    );
  });

  it("exposes a production start command for the built Electron app", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;

    expect(packageJson.scripts).toMatchObject({
      start: "electron .",
      "start:prod": "npm run build && electron .",
    });
  });

  it("exposes a single verification command before local use", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;

    expect(packageJson.scripts).toMatchObject({
      verify:
        "npm test && npm run build && node scripts/run-agent-evals.mjs && node scripts/run-memory-evals.mjs",
      doctor: "npm run verify",
      "smoke:llm": "npm run build && node scripts/check-api-info.mjs",
      "smoke:prod": "npm run build && BUILDING_AGENT_SMOKE=1 electron .",
      "validate:agent":
        "npm run build && BUILDING_AGENT_VALIDATE=1 electron .",
    });
  });

  it("exposes deterministic memory evals", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;

    expect(packageJson.scripts).toMatchObject({
      "eval:memory": "npm run build && node scripts/run-memory-evals.mjs",
    });
  });

  it("exposes built-artifact variants for post-build verification workflows", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;

    expect(packageJson.scripts).toMatchObject({
      "eval:agent": "npm run build && node scripts/run-agent-evals.mjs",
      "eval:agent:built": "node scripts/run-agent-evals.mjs",
      "eval:memory": "npm run build && node scripts/run-memory-evals.mjs",
      "eval:memory:built": "node scripts/run-memory-evals.mjs",
      "harness:score": "npm run build && node scripts/run-harness-score.mjs",
      "harness:score:built": "node scripts/run-harness-score.mjs",
      "episode:export":
        "npm run build && node scripts/export-agent-episode.mjs",
      "episode:export:built": "node scripts/export-agent-episode.mjs",
      "smoke:prod": "npm run build && BUILDING_AGENT_SMOKE=1 electron .",
      "smoke:prod:built": "BUILDING_AGENT_SMOKE=1 electron .",
    });
  });

  it("exposes macOS packaging commands for local app distribution", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;

    expect(packageJson.scripts).toMatchObject({
      "pack:mac": "node scripts/package-mac.mjs --dir",
      "dist:mac": "node scripts/package-mac.mjs dmg zip",
    });
  });

  it("exposes harness engineering commands", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;

    expect(packageJson.scripts).toMatchObject({
      "harness:check": "node scripts/check-harness-state.mjs",
      "harness:score": "npm run build && node scripts/run-harness-score.mjs",
      "episode:export":
        "npm run build && node scripts/export-agent-episode.mjs",
    });
  });
});
