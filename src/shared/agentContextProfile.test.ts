import { describe, expect, it } from "vitest";
import {
  createAgentContextProfile,
  createAgentContextProfileReport,
} from "./agentContextProfile";

describe("createAgentContextProfile", () => {
  it("prioritizes procedural, semantic, and episodic memory for code tasks", () => {
    const profile = createAgentContextProfile({ intent: "code" });

    expect(profile).toEqual({
      intent: "code",
      coreBudgetTokens: 2000,
      hotTurnCount: 6,
      coldSummaryBudgetTokens: 1200,
      memoryKinds: ["procedural", "semantic", "episodic"],
    });
  });

  it("prioritizes semantic, episodic, and procedural memory for research and writing", () => {
    expect(createAgentContextProfile({ intent: "research" }).memoryKinds).toEqual([
      "semantic",
      "episodic",
      "procedural",
    ]);
    expect(createAgentContextProfile({ intent: "writing" }).memoryKinds).toEqual([
      "semantic",
      "episodic",
      "procedural",
    ]);
  });

  it("includes all memory kinds and uses a shorter hot window for memory tasks", () => {
    const profile = createAgentContextProfile({ intent: "memory" });

    expect(profile.hotTurnCount).toBe(4);
    expect(profile.memoryKinds).toEqual([
      "core",
      "session",
      "semantic",
      "episodic",
      "procedural",
    ]);
  });

  it("prioritizes procedural and semantic memory for general tasks", () => {
    expect(createAgentContextProfile({ intent: "general" }).memoryKinds).toEqual([
      "procedural",
      "semantic",
    ]);
  });

  it("returns independent memory kind arrays for each profile", () => {
    const profile = createAgentContextProfile({ intent: "code" });
    profile.memoryKinds.push("core");

    expect(createAgentContextProfile({ intent: "code" }).memoryKinds).toEqual([
      "procedural",
      "semantic",
      "episodic",
    ]);
  });

  it("reports passing context profiles for each supported task intent", () => {
    const report = createAgentContextProfileReport();

    expect(report.passed).toBe(true);
    expect(Object.keys(report.profiles)).toEqual([
      "code",
      "research",
      "writing",
      "memory",
      "general",
    ]);
    for (const profile of Object.values(report.profiles)) {
      expect(profile.memoryKinds.length).toBeGreaterThan(0);
      expect(profile.coreBudgetTokens).toBeGreaterThan(0);
      expect(profile.hotTurnCount).toBeGreaterThan(0);
      expect(profile.coldSummaryBudgetTokens).toBeGreaterThan(0);
    }
  });
});
