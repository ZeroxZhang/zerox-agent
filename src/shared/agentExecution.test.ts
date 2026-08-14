import { describe, expect, it } from "vitest";
import {
  assertExecutionTransition,
  canTransitionExecutionStatus,
  isTerminalExecutionStatus,
  type AgentExecutionCheckpoint,
  type AgentExecutionStep,
} from "./agentExecution";
import { CONTEXT_SURFACE_VERSION } from "./contextSurface";

describe("agent execution model", () => {
  it("allows expected non-terminal and terminal status transitions", () => {
    expect(canTransitionExecutionStatus("queued", "running")).toBe(true);
    expect(canTransitionExecutionStatus("running", "waiting_for_approval")).toBe(true);
    expect(canTransitionExecutionStatus("waiting_for_approval", "running")).toBe(true);
    expect(canTransitionExecutionStatus("running", "paused")).toBe(true);
    expect(canTransitionExecutionStatus("paused", "running")).toBe(true);
    expect(canTransitionExecutionStatus("running", "succeeded")).toBe(true);
    expect(canTransitionExecutionStatus("running", "failed")).toBe(true);
    expect(canTransitionExecutionStatus("running", "canceled")).toBe(true);
  });

  it("rejects transitions out of terminal statuses", () => {
    expect(canTransitionExecutionStatus("succeeded", "running")).toBe(false);
    expect(canTransitionExecutionStatus("failed", "running")).toBe(false);
    expect(canTransitionExecutionStatus("canceled", "running")).toBe(false);

    expect(() => assertExecutionTransition("succeeded", "running")).toThrow(
      'Cannot transition agent execution from "succeeded" to "running".',
    );
  });

  it("identifies terminal statuses", () => {
    expect(isTerminalExecutionStatus("queued")).toBe(false);
    expect(isTerminalExecutionStatus("running")).toBe(false);
    expect(isTerminalExecutionStatus("waiting_for_approval")).toBe(false);
    expect(isTerminalExecutionStatus("paused")).toBe(false);
    expect(isTerminalExecutionStatus("succeeded")).toBe(true);
    expect(isTerminalExecutionStatus("failed")).toBe(true);
    expect(isTerminalExecutionStatus("canceled")).toBe(true);
  });

  it("supports durable checkpoint records with steps and model messages", () => {
    const step: AgentExecutionStep = {
      id: "step-1",
      description: "List files",
      expectedTool: "file_list",
      expectedOutcome: "Directory entries are known",
      state: "pending",
      attempts: 0,
    };
    const checkpoint: AgentExecutionCheckpoint = {
      id: "checkpoint-1",
      runId: "run-1",
      taskId: "task-1",
      goalId: "goal-1",
      milestoneId: "milestone-1",
      status: "queued",
      currentStepId: "step-1",
      steps: [step],
      messages: [
        {
          role: "user",
          content: "Organize Downloads",
        },
      ],
      contextSurface: {
        version: CONTEXT_SURFACE_VERSION,
        runId: "run-1",
        nextSequence: 2,
        events: [
          {
            kind: "source",
            id: "surface:run-1:source:1",
            sequence: 1,
            message: {
              role: "user",
              content: "Organize Downloads",
            },
            estimatedTokens: 8,
            createdAt: "2026-06-07T00:00:00.000Z",
          },
        ],
      },
      toolCallCount: 0,
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    };

    expect(checkpoint.steps[0]).toEqual(step);
    expect(checkpoint.messages[0]?.content).toBe("Organize Downloads");
    expect(checkpoint.contextSurface?.events).toHaveLength(1);
    expect(checkpoint.goalId).toBe("goal-1");
    expect(checkpoint.milestoneId).toBe("milestone-1");
  });
});
