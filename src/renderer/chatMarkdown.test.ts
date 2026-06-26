import { describe, expect, it } from "vitest";
import { parseInlineMarkdown, parseMarkdownBlocks } from "./chatMarkdown";

describe("chat markdown", () => {
  it("parses common assistant markdown into readable blocks", () => {
    expect(
      parseMarkdownBlocks(
        [
          "## 执行结果",
          "",
          "我完成了这些事：",
          "- 检索记忆",
          "- 调用 skill",
          "",
          "```json",
          "{\"ok\": true}",
          "```",
        ].join("\n"),
      ),
    ).toEqual([
      { type: "heading", depth: 2, text: "执行结果" },
      { type: "paragraph", text: "我完成了这些事：" },
      { type: "unorderedList", items: ["检索记忆", "调用 skill"] },
      { type: "code", language: "json", code: "{\"ok\": true}" },
    ]);
  });

  it("parses inline emphasis and code spans without using raw HTML", () => {
    expect(
      parseInlineMarkdown(
        "请看 **重点**、`task.json` 和 [报告](https://example.com/report)",
      ),
    ).toEqual([
      { type: "text", text: "请看 " },
      { type: "strong", text: "重点" },
      { type: "text", text: "、" },
      { type: "code", text: "task.json" },
      { type: "text", text: " 和 " },
      {
        type: "link",
        text: "报告",
        href: "https://example.com/report",
      },
    ]);
  });

  it("parses bare web URLs as links while leaving local paths as text", () => {
    expect(
      parseInlineMarkdown("报告在 /Volumes/out/report.md，来源 https://example.com"),
    ).toEqual([
      { type: "text", text: "报告在 /Volumes/out/report.md，来源 " },
      {
        type: "link",
        text: "https://example.com",
        href: "https://example.com",
      },
    ]);
  });
});
