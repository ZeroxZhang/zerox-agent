import type { AgentLearningCandidateInput } from "../shared/agentLearning";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";

export function extractLearningCandidatesFromTrajectory(
  run: AgentRunRecord,
  events: AgentTrajectoryEvent[],
): AgentLearningCandidateInput[] {
  const candidates: AgentLearningCandidateInput[] = [];

  if (run.status === "succeeded") {
    const procedural = extractProceduralMemory(run, events);
    if (procedural) {
      candidates.push(procedural);
    }
  }

  const failureEvent = events.find(
    (event) => event.type === "failure_classified",
  );
  const failureClass = String(
    failureEvent?.payload.failureClass ?? run.failureClass ?? "",
  );

  if (failureClass === "permission_denied" && failureEvent) {
    candidates.push({
      type: "failure_lesson",
      sourceRunId: run.id,
      sourceTrajectoryEventIds: [failureEvent.id],
      claim:
        "Run failed because a requested tool action was outside approved permissions.",
      recommendedAction:
        "Before retrying, choose a path inside the task permission policy or ask the user for approval.",
      risk:
        "Medium: overly broad permission recovery advice could encourage unnecessary access.",
    });
  }

  if (failureClass === "invalid_model_output" && failureEvent) {
    candidates.push({
      type: "skill_improvement",
      sourceRunId: run.id,
      sourceTrajectoryEventIds: [failureEvent.id],
      claim: "Model output was invalid and needs stricter response constraints.",
      recommendedAction:
        "Tighten the skill or runtime prompt to require valid JSON/function-call output at the failing boundary.",
      risk:
        "Low: stricter output constraints may reduce flexibility but improve recoverability.",
    });
  }

  const repeatedFailure = findRepeatedToolFailure(events);
  if (repeatedFailure) {
    candidates.push({
      type: "failure_lesson",
      sourceRunId: run.id,
      sourceTrajectoryEventIds: repeatedFailure.eventIds,
      claim: `Run repeated failing tool ${repeatedFailure.toolName} ${repeatedFailure.count} times.`,
      recommendedAction:
        "Before retrying the same tool call, inspect arguments, permissions, and the latest observation tail.",
      risk:
        "Low: this advice reduces repeated calls and encourages evidence-driven recovery.",
    });
  }

  return candidates;
}

function extractProceduralMemory(
  run: AgentRunRecord,
  events: AgentTrajectoryEvent[],
): AgentLearningCandidateInput | null {
  const toolCalls = events.filter((event) => event.type === "tool_call");
  const toolNames = toolCalls
    .map((event) => String(event.payload.toolName ?? ""))
    .filter(Boolean);

  if (toolNames.length < 2) {
    return null;
  }

  return {
    type: "procedural_memory",
    sourceRunId: run.id,
    sourceTrajectoryEventIds: toolCalls.map((event) => event.id),
    claim: `Successful run used tool sequence: ${toolNames.join(" -> ")}.`,
    recommendedAction:
      "Create a procedural memory that offers this tool sequence as planning context for similar future tasks.",
    risk:
      "Low: the memory is advisory and should be retrieved only for similar skills or task names.",
  };
}

function findRepeatedToolFailure(events: AgentTrajectoryEvent[]): {
  count: number;
  eventIds: string[];
  toolName: string;
} | null {
  const failedByTool = new Map<string, AgentTrajectoryEvent[]>();

  for (const event of events) {
    if (event.type !== "tool_result" || event.payload.ok !== false) {
      continue;
    }

    const toolName = String(event.payload.toolName ?? "unknown");
    failedByTool.set(toolName, [...(failedByTool.get(toolName) ?? []), event]);
  }

  for (const [toolName, failures] of failedByTool) {
    if (failures.length >= 2) {
      return {
        count: failures.length,
        eventIds: failures.map((event) => event.id),
        toolName,
      };
    }
  }

  return null;
}
