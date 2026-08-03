import { describe, expect, it } from "vitest";
import type { Goal } from "../shared/agentGoal";
import type { PlanRecord } from "../shared/planMode";
import { projectChatSessionTokenUsage } from "./chatSessionUsage";

describe("chat session token usage projection", () => {
  it("aggregates chat, Plan, and Goal usage without double-counting a planning run", () => {
    const plan = {
      planningStages: [
        { runId: "plan_run_a", usage: { inputTokens: 20, outputTokens: 10 } },
      ],
      rounds: [
        { runId: "plan_run_a", usage: { inputTokens: 20, outputTokens: 10 } },
        { runId: "plan_run_b", usage: { inputTokens: 15, outputTokens: 5 } },
      ],
    } as PlanRecord;
    const goal = {
      executionUsage: {
        iterations: 1,
        toolCalls: 0,
        wallClockMs: 100,
        tokens: 40,
        replans: 0,
      },
    } as Goal;

    expect(
      projectChatSessionTokenUsage({
        chatUsage: {
          totalTokens: 100,
          promptTokens: 70,
          completionTokens: 30,
        },
        plans: [plan],
        goals: [goal],
      }),
    ).toEqual({
      totalTokens: 190,
      estimated: false,
      breakdown: {
        chatTokens: 100,
        planTokens: 50,
        goalTokens: 40,
      },
    });
  });

  it("returns no projection when the session has no recorded usage", () => {
    expect(
      projectChatSessionTokenUsage({ plans: [], goals: [] }),
    ).toBeUndefined();
  });
});
