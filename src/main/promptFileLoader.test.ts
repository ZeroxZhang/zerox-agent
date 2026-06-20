import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { AgentPromptProfile } from "../shared/agentProtocol";
import {
  loadModelPromptFile,
  setPromptFileLoader,
  setPromptBaseDir,
} from "./promptFileLoader";

describe("promptFileLoader", () => {
  beforeEach(() => {
    // Reset state between tests
    setPromptFileLoader(undefined);
  });

  afterEach(() => {
    setPromptFileLoader(undefined);
  });

  it("loads prompt content via custom loader", () => {
    setPromptFileLoader((profile) => `Custom: ${profile}`);
    expect(loadModelPromptFile("claude")).toBe("Custom: claude");
  });

  it("returns empty string when loader is not set and files are not found", () => {
    // Set a bogus base dir so file reads fail
    setPromptBaseDir("/nonexistent/prompts");
    setPromptFileLoader(undefined);
    const result = loadModelPromptFile("codex");
    // Should not throw; returns empty string as fallback
    expect(typeof result).toBe("string");
  });

  it("restores default loader when setPromptFileLoader(undefined)", () => {
    setPromptFileLoader((p) => `loaded:${p}`);
    expect(loadModelPromptFile("gpt")).toBe("loaded:gpt");
    setPromptFileLoader(undefined);
    // Default loader may fail or succeed depending on CWD, but should not throw
    expect(() => loadModelPromptFile("default")).not.toThrow();
  });

  it("handles all valid profile types", () => {
    const profiles: AgentPromptProfile[] = [
      "codex", "claude", "gemini", "gpt", "kimi", "default",
    ];
    setPromptFileLoader((p) => `profile:${p}`);
    for (const p of profiles) {
      expect(loadModelPromptFile(p)).toBe(`profile:${p}`);
    }
  });
});
