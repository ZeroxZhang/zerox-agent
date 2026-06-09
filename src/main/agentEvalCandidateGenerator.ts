import type {
  AgentEvalCandidate,
  AgentEvalCandidateAssertion,
} from "../shared/agentEvalCandidate";
import type { AgentRunRecord } from "../shared/agentRuns";
import type {
  AgentTrajectoryEvent,
  AgentTrajectoryEventType,
} from "../shared/agentTrajectory";

export function createEvalCandidateFromEpisode(input: {
  run: AgentRunRecord;
  trajectory: AgentTrajectoryEvent[];
  createdAt: string;
}): AgentEvalCandidate {
  const requiredEventTypes = selectRequiredEventTypes(input.trajectory);
  const assertions = buildAssertions(input.trajectory);

  return {
    id: `eval_candidate_${input.run.id}`,
    sourceRunId: input.run.id,
    status: "pending_review",
    rationale:
      "Generated from an exported episode. Review before promoting to permanent eval fixtures.",
    createdAt: input.createdAt,
    fixture: {
      id: `episode-${slugify(input.run.id)}`,
      description: `Episode candidate from run ${input.run.id}: ${input.run.taskName}`,
      events: input.trajectory,
      requiredEventTypes,
      ...(assertions.length ? { assertions } : {}),
      recoverabilityRequired: input.run.status !== "succeeded",
    },
  };
}

function selectRequiredEventTypes(
  trajectory: AgentTrajectoryEvent[],
): AgentTrajectoryEventType[] {
  const ordered: AgentTrajectoryEventType[] = [
    "tool_call",
    "native_tool_invocation",
    "native_tool_observation",
    "tool_result",
    "reflection_added",
    "failure_classified",
    "final_summary",
  ];
  const available = new Set(trajectory.map((event) => event.type));
  return ordered.filter((type) => available.has(type));
}

function buildAssertions(
  trajectory: AgentTrajectoryEvent[],
): AgentEvalCandidateAssertion[] {
  const reflection = trajectory.find((event) => event.type === "reflection_added");
  if (!reflection) {
    return [];
  }

  return [
    {
      type: "reflection_added",
      payload: {
        failureClass: String(reflection.payload.failureClass ?? ""),
      },
      after: "tool_result",
    },
  ];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
