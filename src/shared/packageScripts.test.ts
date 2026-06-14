import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  version?: string;
  scripts?: Record<string, string>;
};
type PackageLockJson = {
  version?: string;
  packages?: Record<string, { version?: string }>;
};

describe("package scripts", () => {
  it("ships the 2.0.1 Kimi Work release version in package metadata", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;
    const packageLockJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package-lock.json"), "utf8"),
    ) as PackageLockJson;

    expect(packageJson.version).toBe("2.0.1");
    expect(packageLockJson.version).toBe("2.0.1");
    expect(packageLockJson.packages?.[""]?.version).toBe("2.0.1");
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

  it("exposes macOS packaging commands for local app distribution", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;

    expect(packageJson.scripts).toMatchObject({
      "pack:mac":
        "npm run build && CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac --dir",
      "dist:mac":
        "npm run build && CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac dmg zip",
    });
  });

  it("exposes harness engineering commands", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;

    expect(packageJson.scripts).toMatchObject({
      "harness:check": "node scripts/check-harness-state.mjs",
      "harness:score": "npm run build && node scripts/run-harness-score.mjs",
      "episode:export": "node scripts/export-agent-episode.mjs",
    });
  });
});
