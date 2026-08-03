import { describe, expect, it } from "vitest";
import type { Goal, Milestone, SuccessCriterion } from "../shared/agentGoal";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import type { ChatMessage } from "./openAiCompatibleClient";
import type { ProgressLedgerEvent } from "./agentGoalStore";
import { estimateMessageTokens } from "./contextManager";
import { createAgentGoalContext } from "./agentGoalContext";

describe("agent goal context", () => {
  it("retains never-compact goal anchors after compaction", () => {
    const events: AgentTrajectoryEvent[] = [];
    const goal = createGoal([
      {
        ...milestone("accepted_sources"),
        state: "accepted",
        runIds: ["run_sources"],
        attempts: 1,
        lastAcceptanceSummary: "Sources accepted with citation evidence.",
      },
      milestone("running_report", [], "running"),
    ]);
    const context = createAgentGoalContext({
      ledgerEvents: [
        ledger("goal_planned", "Goal planned."),
        ledger("milestone_accepted", "Sources accepted.", "accepted_sources", [
          "trajectory_sources",
        ]),
      ],
      trajectoryStore: createTrajectoryRecorder(events),
      runId: "run_goal_context",
      createId: () => "context_event_1",
      now: () => "2026-06-12T00:00:00.000Z",
    });

    const assembled = context.assemble(goal, noisyHistory(), 260);
    const combined = assembled.messages.map((message) => message.content).join("\n");

    expect(assembled.compacted).toBe(true);
    expect(combined).toContain("Goal: Build a citation-backed local report.");
    expect(combined).toContain("[Goal continuity checkpoint - never compact]");
    expect(combined).toContain("§1 Active intent");
    expect(combined).toContain("§4 Task tree");
    expect(combined).toContain("Goal-level success criterion");
    expect(combined).toContain("Current progress ledger");
    expect(combined).toContain("Sources accepted with citation evidence.");
    expect(combined).toContain("trajectory_sources");
    expect(events.map((event) => event.type)).toEqual(["context_compacted"]);
  });

  it("summarizes completed milestones while keeping running and pending details", () => {
    const goal = createGoal([
      {
        ...milestone("accepted_verbose", [], "accepted"),
        description: "ACCEPTED_FULL_DETAIL_SHOULD_NOT_SURVIVE",
        lastAcceptanceSummary: "Accepted conclusion survives.",
      },
      milestone("running_verbose", [], "running"),
      milestone("pending_verbose", ["running_verbose"], "pending"),
    ]);
    const context = createAgentGoalContext();

    const assembled = context.assemble(goal, noisyHistory(), 260);
    const combined = assembled.messages.map((message) => message.content).join("\n");

    expect(combined).toContain("Accepted conclusion survives.");
    expect(combined).not.toContain("ACCEPTED_FULL_DETAIL_SHOULD_NOT_SURVIVE");
    expect(combined).toContain("Milestone running_verbose");
    expect(combined).toContain("Milestone pending_verbose");
  });

  it("preserves offloaded tool-result refs instead of dropping large observations", () => {
    const goal = createGoal([milestone("running_report", [], "running")]);
    const context = createAgentGoalContext();
    const largeObservation = {
      type: "tool_result",
      tool: "file_read",
      ok: true,
      offloaded: true,
      result_ref: "tool-result-refs/run_call_file_read_ref.json",
      result_preview: { content: "x".repeat(2000) },
    };

    const assembled = context.assemble(
      goal,
      [
        { role: "user", content: "Read the large file." },
        {
          role: "assistant",
          content: "Reading it now.",
          tool_calls: [
            {
              id: "call_file_read",
              type: "function" as const,
              function: { name: "file_read", arguments: "{}" },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_file_read",
          content: JSON.stringify(largeObservation),
        },
        ...noisyHistory(),
      ],
      260,
    );
    const combined = assembled.messages.map((message) => message.content).join("\n");

    expect(combined).toContain("tool-result-refs/run_call_file_read_ref.json");
    expect(combined).not.toContain("x".repeat(200));
    expect(assembled.droppedRefs).not.toContain(
      "tool-result-refs/run_call_file_read_ref.json",
    );
  });

  it("stays within token budget while preserving anchors", () => {
    const goal = createGoal([milestone("running_report", [], "running")]);
    const context = createAgentGoalContext({
      ledgerEvents: [ledger("milestone_started", "Report milestone started.")],
    });

    const assembled = context.assemble(goal, noisyHistory(12), 220);
    const combined = assembled.messages.map((message) => message.content).join("\n");

    expect(estimateMessageTokens(assembled.messages)).toBeLessThanOrEqual(220);
    expect(combined).toContain("Build a citation-backed local report.");
    expect(combined).toContain("Goal-level success criterion");
    expect(combined).toContain("Report milestone started.");
  });

  it("preserves the real assistant and tool seam for runtime continuation", () => {
    const context = createAgentGoalContext();
    const assembled = context.assemble(
      createGoal([milestone("running_report", [], "running")]),
      [
        {
          role: "assistant",
          content: "Reading the current implementation.",
          tool_calls: [
            {
              id: "call_1",
              type: "function" as const,
              function: { name: "file_read", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "tool result" },
      ],
      600,
    );

    expect(assembled.messages).toEqual(
      expect.arrayContaining([
        {
          role: "assistant",
          content: "Reading the current implementation.",
          tool_calls: [
            {
              id: "call_1",
              type: "function" as const,
              function: { name: "file_read", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "tool result" },
      ]),
    );
  });
});

const criterion: SuccessCriterion = {
  id: "criterion_report",
  description: "Goal-level success criterion",
  acceptanceChecks: [
    {
      id: "check_report",
      kind: "file_exists",
      description: "Report exists.",
      params: { path: "report.md" },
      requiresEvidence: false,
    },
  ],
};

function createGoal(milestones: Milestone[]): Goal {
  return {
    id: "goal_context",
    description: "Build a citation-backed local report.",
    successCriteria: [criterion],
    milestones,
    status: "executing",
    budget: {
      maxIterations: 8,
      maxToolCalls: 24,
      maxWallClockMs: 600_000,
      maxReplans: 2,
    },
    executionUsage: {
      iterations: 1,
      toolCalls: 3,
      wallClockMs: 1000,
      tokens: 500,
      replans: 0,
    },
    reviewPolicy: "review_final_only",
    planVersion: 1,
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
  };
}

function milestone(
  id: string,
  dependsOn: string[] = [],
  state: Milestone["state"] = "pending",
): Milestone {
  return {
    id,
    description: `Milestone ${id}`,
    dependsOn,
    successCriteria: [criterion],
    state,
    runIds: [],
    attempts: 0,
  };
}

function ledger(
  kind: ProgressLedgerEvent["kind"],
  summary: string,
  milestoneId?: string,
  evidenceRefs?: string[],
): ProgressLedgerEvent {
  return {
    at: "2026-06-12T00:00:00.000Z",
    kind,
    summary,
    ...(milestoneId ? { milestoneId } : {}),
    ...(evidenceRefs ? { evidenceRefs } : {}),
  };
}

function noisyHistory(count = 8): ChatMessage[] {
  return Array.from({ length: count }).flatMap((_, index) => [
    {
      role: "user" as const,
      content: `Older request ${index} ${"a".repeat(160)}`,
    },
    {
      role: "assistant" as const,
      content: `Older answer ${index} ${"b".repeat(160)}`,
    },
  ]);
}

function createTrajectoryRecorder(events: AgentTrajectoryEvent[]) {
  return {
    async append(_runId: string, event: AgentTrajectoryEvent) {
      events.push(event);
      return event;
    },
  };
}
