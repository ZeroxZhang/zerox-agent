import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  version?: string;
  scripts?: Record<string, string>;
};

describe("package scripts", () => {
  it("sets release metadata to v3.2.2", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as PackageJson;
    const packageLock = JSON.parse(
      readFileSync(path.join(process.cwd(), "package-lock.json"), "utf8"),
    ) as { version?: string; packages?: Record<string, { version?: string }> };

    expect(packageJson.version).toBe("3.2.2");
    expect(packageLock.version).toBe("3.2.2");
    expect(packageLock.packages?.[""]?.version).toBe("3.2.2");
  });

  it("keeps release gates tracked through v3.2.2", () => {
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

    const openFeatureIds = featureList.features
      .filter((feature) => feature.status !== "done")
      .map((feature) => feature.id);
    const p32 = featureList.features.find(
      (feature) => feature.id === "P32-v3.2.0-goal-mode-memory-ingestion-settings-glass",
    );
    const p33 = featureList.features.find(
      (feature) => feature.id === "P33-v3.2.1-ui-ux-design-system-settings-ia",
    );
    const p34 = featureList.features.find(
      (feature) => feature.id === "P34-v3.2.2-soft-blue-visual-system",
    );
    const p31 = featureList.features.find(
      (feature) => feature.id === "P31-v3.1.2-window-controls-and-settings-icon",
    );
    const p30 = featureList.features.find(
      (feature) => feature.id === "P30-v3.1.1-composer-multiline-hotfix",
    );
    const p29 = featureList.features.find(
      (feature) => feature.id === "P29-v3.1.0-goal-acceptance-subagent-runtime",
    );
    const p28 = featureList.features.find(
      (feature) => feature.id === "P28-v3.0.0-execution-context-spine",
    );

    expect(packageJson.version).toBe("3.2.2");
    expect(
      openFeatureIds.filter((id) => id !== "P34-v3.2.2-soft-blue-visual-system"),
    ).toEqual([]);
    expect(openFeatureIds.length).toBeLessThanOrEqual(1);
    expect(p34?.status === "in_progress" || p34?.status === "done").toBe(true);
    expect(p34).toEqual(
      expect.objectContaining({
        id: "P34-v3.2.2-soft-blue-visual-system",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("Soft Blue Desktop Control Surface"),
          expect.stringContaining("Renderer visual tokens implement"),
          expect.stringContaining("Figma-inspired light blue/white system"),
          expect.stringContaining("raw visual magic values outside tokens"),
          expect.stringContaining("Independent Principal Design Architect adversarial review"),
          expect.stringContaining("package metadata reports version 3.2.2"),
        ]),
      }),
    );
    expect(p33?.status).toBe("done");
    expect(p33).toEqual(
      expect.objectContaining({
        id: "P33-v3.2.1-ui-ux-design-system-settings-ia",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("Product designer, interaction designer, and UX designer"),
          expect.stringContaining("comprehensive UI/UX design-system file"),
          expect.stringContaining("Settings information architecture is reordered"),
          expect.stringContaining("Design director and UX expert review"),
          expect.stringContaining("package metadata reports version 3.2.1"),
        ]),
      }),
    );
    expect(p32?.status).toBe("done");
    expect(p32).toEqual(
      expect.objectContaining({
        id: "P32-v3.2.0-goal-mode-memory-ingestion-settings-glass",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("Composer shows the four bottom controls"),
          expect.stringContaining("Goal Mode and legacy /目标 create a typed GoalDraft"),
          expect.stringContaining("Memory records support manual_required"),
          expect.stringContaining("Memory ingestion scans recent reviewed local history"),
          expect.stringContaining("Visual tokens cool the app away from beige/yellow"),
          expect.stringContaining("package metadata reports version 3.2.0"),
        ]),
      }),
    );
    expect(p31?.status).toBe("done");
    expect(p31).toEqual(
      expect.objectContaining({
        id: "P31-v3.1.2-window-controls-and-settings-icon",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("sidebar reserves a sticky macOS window-control safe area"),
          expect.stringContaining("Settings primary navigation gear renders from a bounded SVG path"),
          expect.stringContaining("package metadata reports version 3.1.2"),
          expect.stringContaining("local test package is opened for user acceptance before the release build"),
        ]),
      }),
    );
    expect(p30?.status).toBe("done");
    expect(p30).toEqual(
      expect.objectContaining({
        id: "P30-v3.1.1-composer-multiline-hotfix",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("Chat composer inserts line breaks with Shift+Enter and Option+Enter"),
          expect.stringContaining("authored newlines are preserved"),
          expect.stringContaining("package metadata reports version 3.1.1"),
          expect.stringContaining("macOS DMG, ZIP, blockmaps, and latest-mac.yml artifacts are regenerated for v3.1.1"),
        ]),
      }),
    );
    expect(p29?.status).toBe("done");
    expect(p29).toEqual(
      expect.objectContaining({
        id: "P29-v3.1.0-goal-acceptance-subagent-runtime",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("Slash Goal commands with selected skills persist"),
          expect.stringContaining("right-side context rail shows decomposed task progress"),
          expect.stringContaining("actor tool launches real subagent work with parent run context"),
          expect.stringContaining("Independent adversarial review subagent"),
          expect.stringContaining("package metadata reports version 3.1.0"),
          expect.stringContaining("GitHub Release v3.1.0"),
        ]),
      }),
    );
    expect(p28?.status === "in_progress" || p28?.status === "done").toBe(true);
    expect(p28).toEqual(
      expect.objectContaining({
        id: "P28-v3.0.0-execution-context-spine",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("AgentRuntimeContextSnapshot"),
          expect.stringContaining("Chat agent-loop runs append"),
          expect.stringContaining("Goal milestone runs append"),
          expect.stringContaining("Recoverable scheduled task runs append"),
          expect.stringContaining("package metadata reports version 3.0.0"),
          expect.stringContaining("GitHub Release v3.0.0"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P27-v2.9.5-scheduled-task-session-recovery-release",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("package metadata reports version 2.9.5"),
          expect.stringContaining("GitHub Release v2.9.5"),
          expect.stringContaining("Saved scheduled tasks can be edited"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P26-v2.9.4-scheduled-task-automation-release",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("package metadata reports version 2.9.4"),
          expect.stringContaining("GitHub Release v2.9.4"),
          expect.stringContaining("Scheduled task creation supports prompt-only automation"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P25-v2.9.3-goal-performance-release",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("package metadata reports version 2.9.3"),
          expect.stringContaining("GitHub Release v2.9.3"),
          expect.stringContaining("Production performance smoke expands archived sessions"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P23-v2.9.0-output-rendering",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("approved Evidence-Linked Answer plus Run Ledger"),
          expect.stringContaining("typed shared output parts cover text, tables, code blocks"),
          expect.stringContaining("restored sessions render rich output structure"),
          expect.stringContaining("package metadata reports version 2.9.2"),
        ]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P22-v2.8.5-reasoning-finalization-hotfix",
        status: "done",
        definitionOfDone: expect.arrayContaining([
          expect.stringContaining("non-empty reasoningContent"),
          expect.stringContaining("persisted into the assistant message history"),
          expect.stringContaining("package metadata reports version 2.8.5"),
        ]),
      }),
    );
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
