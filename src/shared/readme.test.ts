import { readFileSync } from "node:fs";
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
    expect(readme).toContain("首次启动引导");
    expect(readme).toContain("一键验收运行");
    expect(readme).toContain("桌面端完整验收");
    expect(readme).toContain(".api_info.md");
    expect(readme).toContain("本地数据与启动");
    expect(readme).toContain("正式本地数据模式");
    expect(readme).toContain("浏览器演示数据模式");
    expect(readme).toContain("agent-validation.json");
  });
});
