import { describe, expect, it } from "vitest";
import type { AgentTrajectoryEvent } from "./agentTrajectory";
import { assessUnknownTrajectoryCoverage } from "./unknownTrajectoryCoverage";

describe("unknown trajectory coverage", () => {
  it("derives degraded/reset state from a required unknown envelope", () => {
    const events = [
      event("next_optional_presenter", "optional", 1),
      event("next_required_owner", "required", 2),
    ];
    expect(assessUnknownTrajectoryCoverage(events)).toEqual({
      optionalCount: 1,
      requiredCount: 1,
      state: "degraded",
      resetRequired: true,
    });
    expect(events[1]?.payload).not.toHaveProperty("coverage");
    expect(events[1]?.payload).not.toHaveProperty("resetRequired");
  });

  it("does not classify a registered event as unknown from its payload alone", () => {
    expect(assessUnknownTrajectoryCoverage([
      event("tool_result", "required", 1),
    ])).toEqual({
      optionalCount: 0,
      requiredCount: 0,
      state: "complete",
      resetRequired: false,
    });
  });

  it("fails an unknown envelope closed when requiredness is missing", () => {
    const unknown = event("vendor_next_event", "required", 1);
    delete unknown.payload.requiredness;

    expect(assessUnknownTrajectoryCoverage([unknown])).toMatchObject({
      requiredCount: 1,
      state: "degraded",
      resetRequired: true,
    });
  });
});

function event(
  type: string,
  requiredness: "optional" | "required",
  sequence: number,
): AgentTrajectoryEvent {
  return {
    id: `event_${sequence}`,
    runId: "run_unknown",
    type: type as AgentTrajectoryEvent["type"],
    sequence,
    payload: { requiredness },
    redaction: {
      containsApiKey: false,
      containsFileContent: false,
      containsUserText: false,
    },
    createdAt: "2026-08-31T00:00:00.000Z",
  };
}
