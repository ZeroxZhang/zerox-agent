import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("README", () => {
  it("documents how to verify, start, validate, and find local data", () => {
    const readme = readFileSync(path.join(process.cwd(), "README.md"), "utf8");

    expect(readme).toContain("npm run doctor");
    expect(readme).toContain("npm run start:prod");
    expect(readme).toContain("npm run smoke:llm");
    expect(readme).toContain("npm run smoke:prod");
    expect(readme).toContain("npm run validate:agent");
    expect(readme).toContain("npm run pack:mac");
    expect(readme).toContain("npm run dist:mac");
    expect(readme).toContain("xattr -dr com.apple.quarantine");
    expect(readme).toContain("Zerox.Agent-1.7.0-arm64.dmg");
    expect(readme).toContain("npm run harness:check");
    expect(readme).toContain("npm run harness:score");
    expect(readme).toContain("npm run episode:export");
    expect(readme).toContain("首次启动引导");
    expect(readme).toContain("一键验收运行");
    expect(readme).toContain("桌面端完整验收");
    expect(readme).toContain(".api_info.md");
    expect(readme).toContain("本地数据与启动");
    expect(readme).toContain("正式本地数据模式");
    expect(readme).toContain("浏览器演示数据模式");
    expect(readme).toContain("agent-validation.json");
    expect(readme).toContain("AGENTS.md");
    expect(readme).toContain("init.sh");
  });

  it("states the desktop control-plane positioning and links the decision matrix", () => {
    const readme = readFileSync(path.join(process.cwd(), "README.md"), "utf8");
    const positioning = readFileSync(
      path.join(process.cwd(), "docs/product/zerox-positioning.md"),
      "utf8",
    );

    expect(readme).toContain("local-first desktop control plane");
    expect(readme).toContain("recoverable agent runs");
    expect(readme).toContain("workspace-scoped runs");
    expect(readme).toContain("parent/child multi-agent sessions");
    expect(readme).toContain("user-reviewed learning");
    expect(readme).toContain("docs/product/zerox-positioning.md");
    expect(positioning).toContain("Decision Matrix");
    expect(positioning).toContain("Zerox is not a generic chat companion.");
    expect(positioning).toContain("The durable advantage is trust");
    expect(positioning).toContain("Autonomous goal run");
    expect(positioning).toContain("Zerox does not run unbounded autonomous loops");
    expect(readme).toContain("Goal Mode (bounded autonomy)");
    expect(readme).toContain("Goal Mode（有边界自治）");
  });

  it("documents Goal Mode architecture, eval coverage, and feature-list status", () => {
    const readme = readFileSync(path.join(process.cwd(), "README.md"), "utf8");
    const architecturePath = path.join(
      process.cwd(),
      "docs/architecture/agent-goal-mode.md",
    );
    const featureList = JSON.parse(
      readFileSync(path.join(process.cwd(), ".zerox/feature_list.json"), "utf8"),
    ) as {
      features: Array<{ id: string; status: string; verification: string[] }>;
    };

    expect(existsSync(architecturePath)).toBe(true);
    const architecture = existsSync(architecturePath)
      ? readFileSync(architecturePath, "utf8")
      : "";

    expect(readme).toContain("docs/architecture/agent-goal-mode.md");
    expect(readme).toContain("21 deterministic agent eval fixtures");
    expect(readme).toContain("goal-mode pass rate");
    expect(readme).toContain("Goal Mode foundation");
    expect(readme).toContain("Goal Mode 架构");
    expect(architecture).toContain("Goal State Machine");
    expect(architecture).toContain("Five Termination Conditions");
    expect(architecture).toContain("Deterministic-first Acceptance");
    expect(architecture).toContain("Review Policies");
    expect(architecture).toContain("Goal-aware Compaction Anchors");
    expect(architecture).toContain("Recovery Guarantees");
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P5.8-goal-mode-evals-docs",
        status: "done",
        verification: expect.arrayContaining(["npm run harness:score"]),
      }),
    );
  });
});
