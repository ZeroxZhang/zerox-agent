import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  version?: string;
  scripts?: Record<string, string>;
};

describe("package scripts", () => {
  it("sets release metadata to v2.3.0", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;
    const packageLock = JSON.parse(
      readFileSync(path.join(process.cwd(), "package-lock.json"), "utf8"),
    ) as { version?: string; packages?: Record<string, { version?: string }> };

    expect(packageJson.version).toBe("2.3.0");
    expect(packageLock.version).toBe("2.3.0");
    expect(packageLock.packages?.[""]?.version).toBe("2.3.0");
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
