import { describe, expect, it } from "vitest";
import {
  createAgentHandoffContract,
  createHandoffReviewDecision,
  summarizeHandoffReviewCards,
} from "./agentHandoff";
import type { AgentTrajectoryEvent } from "./agentTrajectory";
import { buildPrimaryRunContext } from "./agentWorkspace";

describe("agent handoff contracts", () => {
  const parentContext = buildPrimaryRunContext({
    workspaceId: "workspace_1",
    workspaceRoot: "/tmp/workspace",
    sessionId: "session_1",
  });

  it("creates a one-level researcher handoff contract with a review gate", () => {
    const contract = createAgentHandoffContract(parentContext, {
      handoffId: "handoff_1",
      parentRunId: "run_parent",
      childRole: "researcher",
      objective: "Collect two source citations.",
      allowedTools: ["web_fetch_document", "citation_record"],
      budget: { toolCallBudget: 4, wallClockBudgetMs: 120_000 },
      expectedArtifacts: ["tool_result"],
      reviewGate: {
        required: true,
        reviewerRole: "primary",
        checklist: ["Every sourced fact has a citation."],
      },
    });

    expect(contract).toMatchObject({
      handoffId: "handoff_1",
      parentRunId: "run_parent",
      childRole: "researcher",
      workspaceRoot: "/tmp/workspace",
      reviewGate: { required: true, reviewerRole: "primary" },
    });
  });

  it("rejects non-handoff roles and empty objective/tool budgets", () => {
    expect(() =>
      createAgentHandoffContract(parentContext, {
        handoffId: "handoff_bad",
        parentRunId: "run_parent",
        childRole: "planner",
        objective: "Plan broadly.",
        allowedTools: ["file_read"],
        budget: { toolCallBudget: 1 },
        expectedArtifacts: ["text"],
        reviewGate: { required: true, reviewerRole: "primary", checklist: [] },
      }),
    ).toThrow("childRole must be researcher, executor, or reviewer.");

    expect(() =>
      createAgentHandoffContract(parentContext, {
        handoffId: "handoff_empty",
        parentRunId: "run_parent",
        childRole: "executor",
        objective: "",
        allowedTools: [],
        budget: { toolCallBudget: 0 },
        expectedArtifacts: [],
        reviewGate: { required: true, reviewerRole: "primary", checklist: [] },
      }),
    ).toThrow("handoff objective is required.");
  });

  it("rejects handoffs from child contexts to keep P2 one-level", () => {
    expect(() =>
      createAgentHandoffContract(
        { ...parentContext, parentRunId: "run_root", depth: 1 },
        {
          handoffId: "handoff_nested",
          parentRunId: "run_child",
          childRole: "reviewer",
          objective: "Review child output.",
          allowedTools: ["git_diff"],
          budget: { toolCallBudget: 1 },
          expectedArtifacts: ["text"],
          reviewGate: { required: true, reviewerRole: "primary", checklist: [] },
        },
      ),
    ).toThrow("P2 handoff supports one child level.");
  });

  it("normalizes review decisions", () => {
    expect(
      createHandoffReviewDecision({
        handoffId: "handoff_1",
        parentRunId: "run_parent",
        childRunId: "run_child",
        decision: "accepted",
        reviewerRole: "primary",
        notes: "Sources are complete.",
        createdAt: "2026-06-10T00:00:00.000Z",
      }),
    ).toEqual({
      handoffId: "handoff_1",
      parentRunId: "run_parent",
      childRunId: "run_child",
      decision: "accepted",
      reviewerRole: "primary",
      notes: "Sources are complete.",
      createdAt: "2026-06-10T00:00:00.000Z",
    });
  });

  it("summarizes handoff review cards from trajectory events", () => {
    const cards = summarizeHandoffReviewCards([
      trajectory("child_handoff_created", {
        handoff: {
          handoffId: "handoff_1",
          parentRunId: "run_parent",
          childRole: "researcher",
          objective: "Collect sources.",
          allowedTools: ["web_fetch_document"],
          workspaceRoot: "/tmp/workspace",
          budget: { toolCallBudget: 2 },
          expectedArtifacts: ["tool_result"],
          reviewGate: {
            required: true,
            reviewerRole: "primary",
            checklist: ["Citations recorded."],
          },
        },
      }),
      trajectory("child_handoff_completed", {
        output: {
          handoffId: "handoff_1",
          childRunId: "run_child",
          status: "succeeded",
          summary: "Collected sources.",
          artifacts: [{ id: "artifact_1", label: "sources.json" }],
          trajectoryEventIds: ["event_1"],
          openQuestions: [],
          recommendedNextAction: "accept",
        },
      }),
      trajectory("child_handoff_reviewed", {
        decision: {
          handoffId: "handoff_1",
          parentRunId: "run_parent",
          childRunId: "run_child",
          decision: "accepted",
          reviewerRole: "primary",
          notes: "Accepted.",
          createdAt: "2026-06-10T00:00:00.000Z",
        },
      }),
    ]);

    expect(cards).toEqual([
      expect.objectContaining({
        handoffId: "handoff_1",
        childRole: "researcher",
        objective: "Collect sources.",
        status: "accepted",
        childRunId: "run_child",
        reviewDecision: "accepted",
        artifactLabels: ["sources.json"],
      }),
    ]);
  });
});

function trajectory(
  type: AgentTrajectoryEvent["type"],
  payload: Record<string, unknown>,
): AgentTrajectoryEvent {
  return {
    id: `event_${type}`,
    runId: "run_parent",
    type,
    sequence: 1,
    payload,
    redaction: {
      containsApiKey: false,
      containsFileContent: false,
      containsUserText: false,
    },
    createdAt: "2026-06-10T00:00:00.000Z",
  };
}
