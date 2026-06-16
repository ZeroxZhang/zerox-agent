import { describe, expect, it } from "vitest";
import {
  ABSOLUTE_MAX_TURNS,
  DEFAULT_CHAT_MAX_TURNS,
  PER_MILESTONE_TURNS,
  deriveRuntimeMaxTurns,
} from "./resilience";

describe("deriveRuntimeMaxTurns", () => {
  it("uses the chat default without an override", () => {
    expect(deriveRuntimeMaxTurns({ mode: "chat" })).toBe(DEFAULT_CHAT_MAX_TURNS);
  });

  it("lets chat overrides win while respecting the hard maximum", () => {
    expect(deriveRuntimeMaxTurns({ mode: "chat", userOverride: 12 })).toBe(12);
    expect(deriveRuntimeMaxTurns({
      mode: "chat",
      userOverride: 120,
      absoluteMaxTurns: 40,
    })).toBe(40);
  });

  it("derives goal turns from milestone count", () => {
    expect(deriveRuntimeMaxTurns({
      mode: "goal",
      milestoneCount: 5,
    })).toBe(5 * PER_MILESTONE_TURNS);
  });

  it("caps goal turns at the absolute maximum", () => {
    expect(deriveRuntimeMaxTurns({
      mode: "goal",
      milestoneCount: 20,
    })).toBe(ABSOLUTE_MAX_TURNS);
  });

  it("gives zero-milestone goals one milestone budget", () => {
    expect(deriveRuntimeMaxTurns({
      mode: "goal",
      milestoneCount: 0,
    })).toBe(PER_MILESTONE_TURNS);
  });
});
