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
    expect(readme).toContain("Zerox-Agent-3.4.0-arm64.dmg");
    expect(readme).toContain("npm run harness:check");
    expect(readme).toContain("npm run harness:score");
    expect(readme).toContain("npm run episode:export");
    expect(readme).toContain("--latest-validation");
    expect(readme).toContain("run-graph.json");
    expect(readme).toContain("首次启动引导");
    expect(readme).toContain("一键验收");
    expect(readme).toContain("桌面端完整验收");
    expect(readme).toContain(".api_info.md");
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
    expect(readme).toContain("session-native Goal Mode");
    expect(readme).toContain("Chat Session mode");
    expect(readme).toContain("v3.4.0");
    expect(readme).toContain("v3.2.2 interface system");
    expect(readme).toContain("docs/design/zerox-agent-3-2-2-design-system-spec.md");
    expect(readme).toContain("Soft Blue Desktop Control Surface");
    expect(readme).toContain("docs/design/guidelines_0708.html");
    expect(readme).toContain("B · Obsidian");
    expect(readme).toContain("B · 曜石 Obsidian");
    expect(readme).toContain(
      "The primary app flow is Chat, Runs, Tasks, and Settings",
    );
    expect(readme).toContain(
      "diagnostics, skills, tools, memory, learning, and evals live under Settings",
    );
  });

  it("documents Goal Mode architecture and eval coverage", () => {
    const readme = readFileSync(path.join(process.cwd(), "README.md"), "utf8");
    const architecturePath = path.join(
      process.cwd(),
      "docs/architecture/agent-goal-mode.md",
    );
    const runtimeArchitecturePath = path.join(
      process.cwd(),
      "docs/architecture/agent-runtime.md",
    );
    const featureList = JSON.parse(
      readFileSync(path.join(process.cwd(), ".zerox/feature_list.json"), "utf8"),
    ) as {
      features: Array<{ id: string; status: string; verification: string[] }>;
    };

    expect(existsSync(architecturePath)).toBe(true);
    expect(existsSync(runtimeArchitecturePath)).toBe(true);
    const architecture = existsSync(architecturePath)
      ? readFileSync(architecturePath, "utf8")
      : "";
    const runtimeArchitecture = existsSync(runtimeArchitecturePath)
      ? readFileSync(runtimeArchitecturePath, "utf8")
      : "";

    expect(readme).toContain("docs/architecture/agent-goal-mode.md");
    expect(readme).toContain("26 deterministic agent eval fixtures");
    expect(readme).toContain("goal-mode pass rate");
    expect(readme).toContain("Agent Runtime Kernel");
    expect(readme).toContain("kernel event replay");
    expect(readme).toContain("permission-rule behavior");
    expect(readme).toContain("session-native Goal Mode");
    expect(readme).toContain("Chat Session mode");
    expect(readme).not.toContain("Goals UI");
    expect(readme).toContain("artifact evidence");
    expect(readme).toContain("location/resource canonicalization");
    expect(readme).toContain("provenance-backed acceptance");
    expect(readme).toContain("independent packaged-app acceptance");
    expect(readme).toContain("独立 packaged-app 验收");
    expect(readme).not.toContain("pending final independent acceptance");
    expect(readme).not.toContain("待最终独立验收");
    expect(readme).toContain("transcript-backed goal judge");
    expect(readme).toContain("goal-judge pass rate");
    expect(readme).toContain("goal-mode-first");
    expect(readme).toContain("ExecutionContextPackage");
    expect(readme).toContain("AgentRuntimeContextSnapshot");
    expect(readme).toContain("runtime context spine");
    expect(readme).toContain("goal acceptance status");
    expect(readme).toContain("subagent context rail");
    expect(readme).toContain("actor tool parent run context");
    expect(readme).toContain("skill_load");
    expect(readme).toContain("tool invocation ledger");
    expect(readme).toContain("raw history search");
    expect(architecture).toContain("Chat Session Goal Mode");
    expect(architecture).toContain("Goal State Machine");
    expect(architecture).toContain("Termination And Suspension Conditions");
    expect(architecture).toContain("Deterministic-first Acceptance");
    expect(architecture).toContain("Review Policies");
    expect(architecture).toContain("Goal Continuity Checkpoint");
    expect(architecture).toContain("Recovery Guarantees");
    expect(runtimeArchitecture).toContain("Agent Runtime Kernel");
    expect(runtimeArchitecture).toContain("Kernel Event Bridge");
    expect(runtimeArchitecture).toContain("Permission Rule Engine");
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P5.8-goal-mode-evals-docs",
        status: "done",
        verification: expect.arrayContaining(["npm run harness:score"]),
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P7-mimo-inspired-agent-harness",
        status: "done",
        verification: expect.arrayContaining(["npm run harness:score"]),
      }),
    );
  });
});
