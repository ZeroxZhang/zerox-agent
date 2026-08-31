import { describe, expect, it } from "vitest";
import { highestAgentTrajectorySequence } from "./agentTrajectorySequence";

describe("agent trajectory sequence", () => {
  it("finds the highest safe sequence without spreading large trajectories", () => {
    const events = Array.from({ length: 150_000 }, (_, index) => ({
      sequence: index + 1,
    }));

    expect(highestAgentTrajectorySequence(events)).toBe(150_000);
  });

  it("ignores malformed persisted sequence values", () => {
    expect(highestAgentTrajectorySequence([
      { sequence: -1 },
      { sequence: Number.NaN },
      { sequence: 2.5 },
      { sequence: 4 },
    ])).toBe(4);
  });
});
