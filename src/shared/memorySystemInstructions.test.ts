import { describe, expect, it } from "vitest";
import { buildMemoryInstructions } from "./memorySystemInstructions";

describe("buildMemoryInstructions", () => {
  it("returns non-empty Chinese text", () => {
    const text = buildMemoryInstructions();
    expect(text.length).toBeGreaterThan(100);
    // Contains Chinese characters
    expect(text).toMatch(/记忆/);
  });

  it("references real tool names", () => {
    const text = buildMemoryInstructions();
    expect(text).toContain("memory_search");
    expect(text).toContain("conversation_search");
  });

  it("includes memory search protocol", () => {
    const text = buildMemoryInstructions();
    expect(text).toContain("何时主动检索记忆");
    expect(text).toContain("memory_search 使用规范");
    expect(text).toContain("每轮对话最多调用");
  });

  it("includes MEMORY.md guidance", () => {
    const text = buildMemoryInstructions();
    expect(text).toContain("MEMORY.md");
    expect(text).toContain("file_read");
  });

  it("includes procedural memory section", () => {
    const text = buildMemoryInstructions();
    expect(text).toContain("程序性记忆");
    expect(text).toContain("procedural");
  });

  it("includes anti-patterns", () => {
    const text = buildMemoryInstructions();
    expect(text).toContain("反模式");
    expect(text).toContain("不要");
  });

  it("fits within 500 token budget (Chinese chars ~1.5/token)", () => {
    const text = buildMemoryInstructions();
    // Rough estimate: Chinese chars ~1.5 chars/token, ASCII ~4 chars/token
    const cjkChars = (text.match(/[一-鿿]/g) || []).length;
    const asciiChars = text.length - cjkChars;
    const estimatedTokens = Math.ceil(cjkChars / 1.5 + asciiChars / 4);
    expect(estimatedTokens).toBeLessThanOrEqual(500);
  });
});
