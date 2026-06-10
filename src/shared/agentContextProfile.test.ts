import { describe, expect, it } from "vitest";
import { createAgentContextProfile } from "./agentContextProfile";

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
});
