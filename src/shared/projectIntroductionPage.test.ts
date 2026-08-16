import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

describe("Archived Zerox project introduction page", () => {
  const root = process.cwd();
  const pagePath = path.join(
    root,
    "docs/product/archive/zerox-agent-introduction.html",
  );
  const page = readFileSync(pagePath, "utf8");

  it("presents the source-backed product boundary and trust model", () => {
    expect(page).toContain("让本地 Agent 真正可控");
    expect(page).toContain("个人 Agent 的桌面控制平面");
    expect(page).toContain("本地优先");
    expect(page).toContain("权限明确");
    expect(page).toContain("中断可恢复");
    expect(page).toContain("过程可查");
    expect(page).toContain("ToolAuthorizationService");
    expect(page).toContain("JSON 与 JSONL 是完整默认数据源");
    expect(page).toContain("不执行没有预算和终止条件的无限自治任务");
  });

  it("keeps quantitative claims aligned with shared source contracts", () => {
    const providerFactory = readFileSync(
      path.join(root, "src/main/providers/providerFactory.ts"),
      "utf8",
    );
    const executions = readFileSync(
      path.join(root, "src/shared/agentExecution.ts"),
      "utf8",
    );
    const schedules = readFileSync(
      path.join(root, "src/shared/scheduledTasks.ts"),
      "utf8",
    );

    for (const provider of ["anthropic", "gemini", "openai-compatible"]) {
      expect(providerFactory).toContain(`case \"${provider}\"`);
      expect(page.toLowerCase()).toContain(provider);
    }

    for (const status of [
      "queued",
      "running",
      "waiting_for_approval",
      "paused",
      "succeeded",
      "failed",
      "canceled",
    ]) {
      expect(executions).toContain(`\"${status}\"`);
    }
    expect(page).toContain("可恢复执行状态");

    for (const kind of [
      "manual",
      "daily",
      "weekdays",
      "weekly",
      "interval",
      "cron",
    ]) {
      expect(schedules).toContain(`kind: \"${kind}\"`);
      expect(page.toLowerCase()).toContain(kind);
    }
  });

  it("contains accessible responsive interactions without external runtime dependencies", () => {
    expect(page).toContain('lang="zh-CN"');
    expect(page).toContain('<base href="../../../">');
    expect(page).toContain('href="#main-content"');
    expect(page).toContain('aria-label="页面导航"');
    expect(page.match(/role="tab"/g)).toHaveLength(6);
    expect(page.match(/role="tabpanel"/g)).toHaveLength(6);
    expect(page).toContain("prefers-color-scheme: dark");
    expect(page).toContain("prefers-reduced-motion: reduce");
    expect(page).toContain("@media (max-width: 760px)");
    expect(page).toContain("IntersectionObserver");
    expect(page).not.toContain('addEventListener("scroll"');
    expect(page).not.toContain("fonts.googleapis.com");
    expect(page).not.toContain("<script src=");
    expect(page).not.toMatch(/[—–]/);
  });

  it("references existing brand assets and code-map files", () => {
    const localReferences = [
      "build/icon.svg",
      "build/zerox-logo.svg",
      "src/main/main.ts",
      "src/main/container.ts",
      "src/main/agentLoop.ts",
      "src/main/toolAuthorizationService.ts",
      "src/preload/index.ts",
      "src/renderer/App.tsx",
      "src/main/storage/backendResolver.ts",
    ];

    for (const reference of localReferences) {
      expect(page).toContain(reference);
      expect(existsSync(path.join(root, reference))).toBe(true);
    }
  });

  it("keeps every inline script syntactically valid", () => {
    const scripts = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);

    scripts.forEach((script, index) => {
      expect(() => new vm.Script(script[1], { filename: `onepage-inline-${index}.js` })).not.toThrow();
    });
  });
});
