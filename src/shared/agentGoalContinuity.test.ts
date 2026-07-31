import { describe, expect, it } from "vitest";
import type { Goal, Milestone, SuccessCriterion } from "./agentGoal";
import { buildGoalContinuityCheckpoint } from "./agentGoalContinuity";

describe("goal continuity checkpoint", () => {
  it("renders all continuity sections from goal state and ledger evidence", () => {
    const checkpoint = buildGoalContinuityCheckpoint({
      goal: createGoal([
        {
          ...milestone("collect_sources", "accepted"),
          lastAcceptanceSummary: "Sources accepted with citation evidence.",
          runIds: ["run_sources"],
        },
        milestone("write_report", "running"),
      ]),
      ledgerEvents: [
        {
          at: "2026-06-16T00:00:00.000Z",
          kind: "goal_planned",
          summary: "Goal planned.",
        },
        {
          at: "2026-06-16T00:01:00.000Z",
          kind: "milestone_accepted",
          milestoneId: "collect_sources",
          summary: "Accepted sources.",
          evidenceRefs: ["citation:serenity"],
        },
      ],
      now: "2026-06-16T00:02:00.000Z",
    });

    for (const heading of [
      "§1 Active intent",
      "§2 Next concrete action",
      "§3 Directives",
      "§4 Task tree",
      "§5 Current work",
      "§6 Files and evidence",
      "§7 Discovered knowledge",
      "§8 Errors and fixes",
      "§9 Live resources",
      "§10 Design decisions",
      "§11 Open notes",
    ]) {
      expect(checkpoint).toContain(heading);
    }
    expect(checkpoint).toContain("> Build a citation-backed report.");
    expect(checkpoint).toContain("Continue running milestone write_report");
    expect(checkpoint).toContain("- collect_sources [accepted]");
    expect(checkpoint).toContain("- write_report [running]");
    expect(checkpoint).toContain("citation:serenity");
    expect(checkpoint).toContain("iterations=2; toolCalls=5");
    expect(checkpoint).not.toContain("iterations=2/8");
    expect(checkpoint).toContain("checkpointedAt=2026-06-16T00:02:00.000Z");
  });

  it("uses final acceptance as the next action after milestones are accepted", () => {
    const checkpoint = buildGoalContinuityCheckpoint({
      goal: createGoal([
        {
          ...milestone("collect_sources", "accepted"),
          lastAcceptanceSummary: "Sources accepted.",
        },
      ]),
    });

    expect(checkpoint).toContain("Run goal-level acceptance");
  });
});

const criterion: SuccessCriterion = {
  id: "criterion_report",
  description: "Report is accepted.",
  acceptanceChecks: [
    {
      id: "check_report",
      kind: "model_review",
      description: "Judge report evidence.",
      params: { evidenceRefs: ["artifact:goalEvidence"] },
      requiresEvidence: true,
    },
  ],
};

function createGoal(milestones: Milestone[]): Goal {
  return {
    id: "goal_continuity",
    description: "Build a citation-backed report.",
    successCriteria: [criterion],
    milestones,
    status: "executing",
    executionUsage: {
      iterations: 2,
      toolCalls: 5,
      wallClockMs: 3000,
      tokens: 1200,
      replans: 1,
    },
    reviewPolicy: "review_final_only",
    planVersion: 2,
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:01:00.000Z",
  };
}

function milestone(id: string, state: Milestone["state"]): Milestone {
  return {
    id,
    description: `Milestone ${id}`,
    dependsOn: [],
    successCriteria: [criterion],
    state,
    runIds: [],
    attempts: state === "pending" ? 0 : 1,
  };
}
