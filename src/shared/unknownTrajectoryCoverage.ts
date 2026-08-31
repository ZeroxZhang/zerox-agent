import {
  agentTrajectoryEventTypes,
  type AgentTrajectoryEvent,
} from "./agentTrajectory";

const knownTrajectoryEventTypes = new Set<string>(agentTrajectoryEventTypes);

export type UnknownTrajectoryCoverage = {
  optionalCount: number;
  requiredCount: number;
  state: "complete" | "degraded";
  resetRequired: boolean;
};

export function assessUnknownTrajectoryCoverage(
  events: readonly AgentTrajectoryEvent[],
): UnknownTrajectoryCoverage {
  let optionalCount = 0;
  let requiredCount = 0;
  for (const event of events) {
    if (knownTrajectoryEventTypes.has(String(event.type))) continue;
    if (event.payload.requiredness === "optional") {
      optionalCount += 1;
    } else {
      // Unknown persisted facts are authority-bearing unless the producer
      // explicitly marks them optional. Missing or malformed requiredness
      // must never silently restore complete coverage.
      requiredCount += 1;
    }
  }
  return {
    optionalCount,
    requiredCount,
    state: requiredCount > 0 ? "degraded" : "complete",
    resetRequired: requiredCount > 0,
  };
}
