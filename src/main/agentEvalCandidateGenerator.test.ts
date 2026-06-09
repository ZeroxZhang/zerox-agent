import { describe, expect, it } from "vitest";
import { createEvalCandidateFromEpisode } from "./agentEvalCandidateGenerator";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";

describe("agent eval candidate generator", () => {
  it("creates a reviewable fixture candidate from native and reflection evidence", () => {
    const run: AgentRunRecord = {
      id: "run_eval",
      taskId: "task_eval",
      taskName: "Fix failing test",
      skillName: "code-engineering",
      status: "failed",
      summary: "test_run failed after reflection.",
      events: [],
      startedAt: "2026-06-10T00:00:00.000Z",
      finishedAt: "2026-06-10T00:01:00.000Z",
      failureClass: "tool_error",
    };
    const trajectory = createEvents("run_eval", [
      ["tool_call", { toolName: "test_run" }],
      ["native_tool_invocation", { toolName: "test_run", nativeKind: "test" }],
      ["native_tool_observation", { toolName: "test_run", ok: false }],
      ["tool_result", { toolName: "test_run", ok: false }],
      ["reflection_added", { toolName: "test_run", failureClass: "verification_failed" }],
      ["failure_classified", { failureClass: "tool_error" }],
    ]);

    const candidate = createEvalCandidateFromEpisode({
      run,
      trajectory,
      createdAt: "2026-06-10T00:02:00.000Z",
    });

    expect(candidate).toMatchObject({
      id: "eval_candidate_run_eval",
      status: "pending_review",
      sourceRunId: "run_eval",
      fixture: {
        id: "episode-run-eval",
        requiredEventTypes: [
          "tool_call",
          "native_tool_invocation",
          "native_tool_observation",
          "tool_result",
          "reflection_added",
          "failure_classified",
        ],
      },
    });
    expect(candidate.fixture.assertions).toContainEqual({
      type: "reflection_added",
      payload: { failureClass: "verification_failed" },
      after: "tool_result",
    });
  });
});

function createEvents(
  runId: string,
  entries: Array<[AgentTrajectoryEvent["type"], Record<string, unknown>]>,
): AgentTrajectoryEvent[] {
  return entries.map(([type, payload], index) => ({
    id: `${runId}_${index + 1}`,
    runId,
    type,
    sequence: index + 1,
    payload,
    redaction: {
      containsApiKey: false,
      containsFileContent: false,
      containsUserText: false,
    },
    createdAt: "2026-06-10T00:00:00.000Z",
  }));
}
