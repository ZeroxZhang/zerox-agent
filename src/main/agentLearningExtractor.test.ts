import { describe, expect, it } from "vitest";
import { extractLearningCandidatesFromTrajectory } from "./agentLearningExtractor";
import type { AgentRunRecord } from "../shared/agentRuns";
import type {
  AgentTrajectoryEvent,
  AgentTrajectoryEventType,
} from "../shared/agentTrajectory";

describe("agent learning extractor", () => {
  it("extracts procedural memory from successful repeated tool sequences", () => {
    const candidates = extractLearningCandidatesFromTrajectory(
      createRun("succeeded"),
      createEvents("run_1", [
        ["tool_call", { toolName: "file_list" }],
        ["tool_result", { toolName: "file_list", ok: true }],
        ["tool_call", { toolName: "file_read" }],
        ["tool_result", { toolName: "file_read", ok: true }],
        ["tool_call", { toolName: "file_write" }],
        ["tool_result", { toolName: "file_write", ok: true }],
        ["final_summary", {}],
      ]),
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        type: "procedural_memory",
        sourceRunId: "run_1",
        sourceTrajectoryEventIds: ["event_1", "event_3", "event_5"],
        claim: "Successful run used tool sequence: file_list -> file_read -> file_write.",
      }),
    ]);
  });

  it("extracts failure lessons from permission denied trajectories", () => {
    const candidates = extractLearningCandidatesFromTrajectory(
      createRun("failed", "permission_denied"),
      createEvents("run_1", [
        ["tool_call", { toolName: "file_write" }],
        ["failure_classified", { failureClass: "permission_denied" }],
        ["checkpoint_written", { status: "failed" }],
      ]),
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        type: "failure_lesson",
        claim: "Run failed because a requested tool action was outside approved permissions.",
        sourceTrajectoryEventIds: ["event_2"],
      }),
    ]);
  });

  it("extracts skill improvement proposals from invalid model output", () => {
    const candidates = extractLearningCandidatesFromTrajectory(
      createRun("failed", "invalid_model_output"),
      createEvents("run_1", [
        ["model_response", { invalid: true }],
        ["failure_classified", { failureClass: "invalid_model_output" }],
      ]),
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        type: "skill_improvement",
        claim: "Model output was invalid and needs stricter response constraints.",
        sourceTrajectoryEventIds: ["event_2"],
      }),
    ]);
  });

  it("extracts repeated tool failure lessons before another retry", () => {
    const candidates = extractLearningCandidatesFromTrajectory(
      createRun("failed"),
      createEvents("run_1", [
        ["tool_call", { toolName: "file_read", path: "/workspace/a.md" }],
        ["tool_result", { toolName: "file_read", ok: false }],
        ["tool_call", { toolName: "file_read", path: "/workspace/a.md" }],
        ["tool_result", { toolName: "file_read", ok: false }],
        ["failure_classified", { failureClass: "tool_error" }],
      ]),
    );

    expect(candidates).toContainEqual(
      expect.objectContaining({
        type: "failure_lesson",
        sourceTrajectoryEventIds: ["event_2", "event_4"],
        claim: "Run repeated failing tool file_read 2 times.",
      }),
    );
  });
});

function createRun(
  status: AgentRunRecord["status"],
  failureClass?: AgentRunRecord["failureClass"],
): AgentRunRecord {
  return {
    id: "run_1",
    taskId: "task_1",
    taskName: "Organize Downloads",
    skillName: "local-file-organizer",
    status,
    summary: status === "succeeded" ? "Done" : "Failed",
    events: [],
    ...(failureClass ? { failureClass } : {}),
    startedAt: "2026-06-07T00:00:00.000Z",
    finishedAt: "2026-06-07T00:01:00.000Z",
  };
}

function createEvents(
  runId: string,
  entries: Array<[AgentTrajectoryEventType, Record<string, unknown>]>,
): AgentTrajectoryEvent[] {
  return entries.map(([type, payload], index) => ({
    id: `event_${index + 1}`,
    runId,
    type,
    sequence: index + 1,
    payload,
    redaction: {
      containsApiKey: false,
      containsFileContent: false,
      containsUserText: false,
    },
    createdAt: "2026-06-07T00:00:00.000Z",
  }));
}
