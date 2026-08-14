import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const readmePath = path.join(process.cwd(), "README.md");

function readReadme(): string {
  return readFileSync(readmePath, "utf8");
}

describe("README", () => {
  it("describes the current product instead of a historical release log", () => {
    const readme = readReadme();

    expect(readme).toContain("当前版本是 **v3.8.2**");
    expect(readme).toContain("The current release: v3.8.2");
    expect(readme).toContain("local-first desktop control plane");
    expect(readme).toContain("recoverable agent runs");
    expect(readme).toContain("workspace");
    expect(readme).toContain("parent/child multi-agent sessions");
    expect(readme).toContain("user-reviewed learning");
    expect(readme).toContain("会话");
    expect(readme).toContain("任务记录");
    expect(readme).toContain("任务");
    expect(readme).toContain("设置");
    expect(readme).toContain(
      "The primary app flow is Chat, Runs, Tasks, and Settings",
    );
    expect(readme).toContain(
      "Diagnostics, skills, tools, memory, learning, and evals live under Settings",
    );
    expect(readme.match(/^# 中文$/gm)).toHaveLength(1);
    expect(readme.match(/^# English$/gm)).toHaveLength(1);
    expect(readme.split("\n").length).toBeLessThan(800);
    expect(readme).not.toContain("v3.2.2 interface system");
    expect(readme).not.toContain("25 built-in tools");
    expect(readme).not.toContain("A fixed local resource budget");
  });

  it("documents the current Goal-Plan contract, Direct/Debate compatibility, and completion truth", () => {
    const readme = readReadme();
    const featureList = JSON.parse(
      readFileSync(path.join(process.cwd(), ".zerox/feature_list.json"), "utf8"),
    ) as {
      features: Array<{
        id: string;
        status: string;
        definitionOfDone: string[];
      }>;
    };

    expect(readme).toContain(
      "Goal 定义要达到什么结果，Plan 定义当前如何达到这个结果",
    );
    expect(readme).toContain("GoalContractSnapshot");
    expect(readme).toContain(
      "调查 → direct 生成 → 独立冷审 → quality",
    );
    expect(readme).toContain(
      "调查 → A1 → B1 → A2 → B2 → C → quality",
    );
    expect(readme).toContain("Planning 阶段是只读的");
    expect(readme).toContain("Plan Agent 可以调查工作区");
    expect(readme).toContain("GoalContract r1");
    expect(readme).toContain("Plan v1 · Debate · A1/B1/A2/B2/C");
    expect(readme).toContain("Plan v2 · Direct");
    expect(readme).toContain("初始 Debate → 当前 Direct v2");
    expect(readme).toContain("运行期结构性重规划统一使用 Direct");
    expect(readme).toContain("Plan = steps_completed");
    expect(readme).toContain("Goal = achieved");
    expect(readme).toContain("有效验收证书");
    expect(readme).toContain("finishReason=stop");
    expect(readme).toContain("手动重试从失败深度继续");
    expect(readme).toContain(
      "Only user-confirmed Ready plans create writable Goal runs",
    );

    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P70-goal-plan-contract-lineage",
        status: "done",
      }),
    );
    expect(featureList.features).toContainEqual(
      expect.objectContaining({
        id: "P71-debate-first-pass-reliability",
        status: "done",
      }),
    );
  });

  it("explains state projection, context accounting, permissions, and local data boundaries", () => {
    const readme = readReadme();

    expect(readme).toContain("session-work projection");
    expect(readme).toContain("已达成 Goal 优先显示“已完成”");
    expect(readme).toContain("累计 Token");
    expect(readme).toContain("当前占用");
    expect(readme).toContain(
      "累计 Token 可能远大于当前上下文窗口",
    );
    expect(readme).toContain("ToolAuthorizationService");
    expect(readme).toContain("极高风险、不可逆或超出既有权限");
    expect(readme).toContain("renderer 的按钮状态不构成授权");
    expect(readme).toContain("正式本地数据模式");
    expect(readme).toContain("浏览器演示数据模式");
    expect(readme).toContain("Electron userData/config");
    expect(readme).toContain("JSON/JSONL");
    expect(readme).toContain("safeStorage");
    expect(readme).toContain("agent-validation.json");
    expect(readme).toContain(
      "调用外部模型时，完成请求所需的对话与上下文仍会发送给用户选择的服务商",
    );
  });

  it("documents current providers, installation, verification, and release operations", () => {
    const readme = readReadme();

    for (const provider of [
      "OpenAI",
      "Claude（Anthropic）",
      "Gemini",
      "AWS Bedrock",
      "Vertex AI",
      "DeepSeek",
      "Kimi",
      "阿里云百炼 Coding Plan",
      "Ollama",
      "自定义 OpenAI Chat Completions",
    ]) {
      expect(readme).toContain(provider);
    }

    for (const command of [
      "./init.sh",
      "npm ci",
      "npm run doctor",
      "npm run start:prod",
      "npm run smoke:llm",
      "npm run smoke:providers",
      "npm run smoke:prod",
      "npm run validate:agent",
      "npm run harness:check",
      "npm run harness:score",
      "npm run episode:export",
      "--latest-validation",
      "npm run pack:mac",
      "npm run dist:mac",
      "npm run release:mac",
      "npm run release:publish",
    ]) {
      expect(readme).toContain(command);
    }

    expect(readme).toContain("Zerox-Agent-3.8.2-arm64.dmg");
    expect(readme).toContain("xattr -dr com.apple.quarantine");
    expect(readme).toContain("legacy-adhoc");
    expect(readme).toContain("未经过 Apple Developer ID 签名与公证");
    expect(readme).toContain("run-graph.json");
    expect(readme).toContain("eval-candidate.json");
    expect(readme).toContain("trajectory.jsonl");
    expect(readme).toContain("AGENTS.md");
    expect(readme).toContain(".api_info.md");
  });

  it("links every current product and architecture reference", () => {
    const readme = readReadme();
    const references = [
      "docs/product/zerox-positioning.md",
      "docs/architecture/agent-goal-mode.md",
      "docs/architecture/agent-runtime.md",
      "docs/architecture/agent-workspaces.md",
      "docs/architecture/agent-learning-loop.md",
      "docs/design/zerox-agent-3-8-0-plan-debate.md",
      "docs/design/zerox-agent-3-8-0-debate-user-path-acceptance.md",
      "docs/design/zerox-agent-3-8-1-model-and-conversation-ux.md",
    ];

    for (const reference of references) {
      expect(readme).toContain(reference);
      expect(existsSync(path.join(process.cwd(), reference))).toBe(true);
    }

    const positioning = readFileSync(
      path.join(process.cwd(), "docs/product/zerox-positioning.md"),
      "utf8",
    );
    expect(positioning).toContain("Decision Matrix");
    expect(positioning).toContain("The durable advantage is trust");
    expect(positioning).toContain(
      "Zerox does not run unbounded autonomous loops",
    );
  });

  it("keeps the README product OnePage aligned with the current release", () => {
    const readme = readReadme();
    const imagePath = path.join(
      process.cwd(),
      "docs/product/zerox-agent-product-intro.jpg",
    );
    const sourcePath = path.join(
      process.cwd(),
      "docs/product/zerox-agent-A1-B9-20260803.html",
    );

    expect(readme).toContain("docs/product/zerox-agent-product-intro.jpg");
    expect(existsSync(imagePath)).toBe(true);
    expect(existsSync(sourcePath)).toBe(true);

    const source = readFileSync(sourcePath, "utf8");
    expect(source).toContain("Zerox Agent v3.8.1");
    expect(source).toContain("GoalContract r1");
    expect(source).toContain("Direct");
    expect(source).toContain("Debate");
    expect(source).toContain("Plan steps_completed ≠ Goal achieved");
    expect(source).toContain("19</div>");
    expect(source).not.toContain("v3.6.1");
  });
});
