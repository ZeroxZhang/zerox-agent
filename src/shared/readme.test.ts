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
    expect(readme).toContain("Zerox.Agent-2.8.2-arm64.dmg");
    expect(readme).toContain("npm run harness:check");
    expect(readme).toContain("npm run harness:score");
    expect(readme).toContain("npm run episode:export");
    expect(readme).toContain("--latest-validation");
    expect(readme).toContain("run-graph.json");
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
    expect(readme).toContain("session-native Goal Mode");
    expect(readme).toContain("Chat Session mode");
    expect(readme).toContain("current release is **v2.8.2**");
    expect(readme).toContain("当前版本是 **v2.8.2**");
  });

  it("documents Goal Mode architecture, eval coverage, and feature-list status", () => {
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
    expect(readme).toContain("Goal Mode 架构");
    expect(readme).toContain("artifact evidence contract");
    expect(readme).toContain("artifact evidence files");
    expect(readme).toContain("1185 tests");
    expect(readme).toContain("1185 个测试");
    expect(readme).toContain("Current version: v2.8.2.");
    expect(readme).toContain("当前版本：v2.8.2。");
    expect(readme).toContain("v2.8.2");
    expect(readme).toContain("ExecutionContextPackage");
    expect(readme).toContain("skill_load");
    expect(readme).toContain("tool invocation ledgers");
    expect(readme).toContain("raw history search");
    expect(readme).toContain("real-time thinking and tool preview rows");
    expect(readme).toContain("实时“思考 / 工具”预览");
    expect(readme).toContain("v2.7.0");
    expect(readme).toContain("Chat-first");
    expect(readme).toContain("streamed answers");
    expect(readme).toContain("guided skill input");
    expect(readme).toContain(
      "[x] v2.7.0 Chat-first interaction release",
    );
    expect(readme).toContain("[x] v2.7.0 Chat-first 交互发布");
    expect(readme).toContain(
      "[x] v2.8.0 runtime orchestration and memory overhaul",
    );
    expect(readme).toContain(
      "[x] v2.8.1 runtime surface polish",
    );
    expect(readme).toContain(
      "[x] v2.8.2 chat rename, transcript readability",
    );
    expect(readme).toContain("[x] v2.8.0 运行编排与记忆大版本");
    expect(readme).toContain("[x] v2.8.1 实时运行区域视觉修正");
    expect(readme).toContain("[x] v2.8.2 会话重命名");
    expect(readme).toContain("independent packaged-app acceptance");
    expect(readme).toContain("独立 packaged-app 验收");
    expect(readme).not.toContain("pending final independent acceptance");
    expect(readme).not.toContain("待最终独立验收");
    expect(readme).toContain("v2.6.0 is a hardening release");
    expect(readme).toContain("v2.6.0 是一次本地控制面的加固发布");
    expect(readme).toContain("v2.5.0 makes workspace a first-class execution boundary");
    expect(readme).toContain("v2.5.0 把 workspace 明确提升为聊天和技能运行的一等边界");
    expect(readme).toContain("v2.4.1 adds managed chat history");
    expect(readme).toContain("v2.4.1 新增历史会话管理");
    expect(readme).toContain(
      "v2.4.0 ships the iteration-roadmap P1–P8 activation",
    );
    expect(readme).toContain(
      "independent packaged-app computer-use acceptance gate that passed",
    );
    expect(readme).toContain("v2.4.1 passed the command-line verification gate");
    expect(readme).toContain("v2.4.1 已通过命令行验证 gate");
    expect(readme).toContain("location/resource canonicalization");
    expect(readme).toContain("provenance-backed acceptance");
    expect(readme).toContain("independent packaged-app computer-use acceptance");
    expect(readme).toContain("release metadata now matches the v2.4.1 app version");
    expect(readme).toContain("release metadata 现在已经匹配 v2.4.1 应用版本");
    expect(readme).not.toContain("release metadata remains intentionally pending");
    expect(readme).not.toContain("release metadata 会保持 pending");
    expect(readme).toContain("command-first agent stage");
    expect(readme).toContain("command-first agent release");
    expect(readme).toContain("transcript-backed goal judge");
    expect(readme).toContain("goal-judge pass rate");
    expect(readme).toContain("v2.3.1 desktop hotfix");
    expect(readme).toContain("v2.3.1 桌面热修");
    expect(readme).toContain("v2.3.5 adds Run Graph Harness");
    expect(readme).toContain("v2.3.5 新增 Run Graph Harness");
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
