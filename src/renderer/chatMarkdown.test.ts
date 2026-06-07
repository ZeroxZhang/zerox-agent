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
    expect(parseInlineMarkdown("请看 **重点** 和 `task.json`")).toEqual([
      { type: "text", text: "请看 " },
      { type: "strong", text: "重点" },
      { type: "text", text: " 和 " },
      { type: "code", text: "task.json" },
    ]);
  });
});
