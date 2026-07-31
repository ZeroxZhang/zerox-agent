import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAT_CHECKPOINT_INTERVAL,
  MAX_CHECKPOINT_INTERVAL,
  PER_MILESTONE_CHECKPOINT_TURNS,
  deriveRuntimeCheckpointInterval,
} from "./resilience";

describe("deriveRuntimeCheckpointInterval", () => {
  it("uses the chat default without an override", () => {
    expect(deriveRuntimeCheckpointInterval({ mode: "chat" })).toBe(
      DEFAULT_CHAT_CHECKPOINT_INTERVAL,
    );
  });

  it("lets chat overrides win while bounding checkpoint frequency", () => {
    expect(
      deriveRuntimeCheckpointInterval({ mode: "chat", userOverride: 12 }),
    ).toBe(12);
    expect(deriveRuntimeCheckpointInterval({
      mode: "chat",
      userOverride: 120,
      maxCheckpointInterval: 40,
    })).toBe(40);
  });

  it("derives a goal checkpoint interval from milestone count", () => {
    expect(deriveRuntimeCheckpointInterval({
      mode: "goal",
      milestoneCount: 5,
    })).toBe(5 * PER_MILESTONE_CHECKPOINT_TURNS);
  });

  it("caps only the checkpoint interval", () => {
    expect(deriveRuntimeCheckpointInterval({
      mode: "goal",
      milestoneCount: 20,
    })).toBe(MAX_CHECKPOINT_INTERVAL);
  });

  it("gives zero-milestone goals one checkpoint interval", () => {
    expect(deriveRuntimeCheckpointInterval({
      mode: "goal",
      milestoneCount: 0,
    })).toBe(PER_MILESTONE_CHECKPOINT_TURNS);
  });
});
