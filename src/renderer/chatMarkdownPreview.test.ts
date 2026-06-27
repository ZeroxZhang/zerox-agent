import { describe, expect, it } from "vitest";
import {
  LONG_MARKDOWN_PREVIEW_CHAR_LIMIT,
  LONG_MARKDOWN_PREVIEW_LINE_LIMIT,
  createMarkdownPreview,
  shouldRenderMarkdownPreview,
} from "./chatMarkdownPreview";

describe("chatMarkdownPreview", () => {
  it("does not preview short markdown", () => {
    expect(shouldRenderMarkdownPreview("## Short\n\nReadable text.")).toBe(
      false,
    );
  });

  it("previews markdown that is too long by character count", () => {
    const markdown = "a".repeat(LONG_MARKDOWN_PREVIEW_CHAR_LIMIT + 250);
    const preview = createMarkdownPreview(markdown);

    expect(shouldRenderMarkdownPreview(markdown)).toBe(true);
    expect(preview.length).toBeLessThan(markdown.length);
    expect(preview.startsWith("a".repeat(LONG_MARKDOWN_PREVIEW_CHAR_LIMIT))).toBe(
      true,
    );
    expect(preview).toContain("preview");
  });

  it("previews markdown that is too long by line count", () => {
    const markdown = Array.from(
      { length: LONG_MARKDOWN_PREVIEW_LINE_LIMIT + 20 },
      (_, index) => `- item ${index + 1}`,
    ).join("\n");
    const preview = createMarkdownPreview(markdown);

    expect(shouldRenderMarkdownPreview(markdown)).toBe(true);
    expect(preview.split("\n").length).toBeLessThan(markdown.split("\n").length);
    expect(preview).toContain("- item 1");
  });
});
