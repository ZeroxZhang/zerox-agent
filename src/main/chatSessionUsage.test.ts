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
        tokensEstimated: false,
        replans: 0,
      },
    } as Goal;

    expect(
      projectChatSessionTokenUsage({
        chatUsage: {
          totalTokens: 100,
          promptTokens: 70,
          completionTokens: 30,
          estimated: false,
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

  it("discloses when Goal token usage contains local estimates", () => {
    const goal = {
      executionUsage: {
        iterations: 1,
        toolCalls: 1,
        wallClockMs: 100,
        tokens: 80,
        tokensEstimated: true,
        replans: 0,
      },
    } as Goal;

    expect(
      projectChatSessionTokenUsage({ plans: [], goals: [goal] }),
    ).toMatchObject({ totalTokens: 80, estimated: true });
  });

  it("treats legacy Goal totals without provenance as estimated", () => {
    const goal = {
      executionUsage: {
        iterations: 1,
        toolCalls: 1,
        wallClockMs: 100,
        tokens: 80,
        replans: 0,
      },
    } as Goal;

    expect(
      projectChatSessionTokenUsage({ plans: [], goals: [goal] }),
    ).toMatchObject({ totalTokens: 80, estimated: true });
  });

  it("discloses estimated read-only Plan investigation usage", () => {
    const plan = {
      planningStages: [
        {
          runId: "plan_investigation_a",
          usage: { inputTokens: 0, outputTokens: 45, estimated: true },
        },
      ],
      rounds: [],
    } as unknown as PlanRecord;

    expect(
      projectChatSessionTokenUsage({ plans: [plan], goals: [] }),
    ).toMatchObject({
      totalTokens: 45,
      estimated: true,
      breakdown: { planTokens: 45 },
    });
  });
});
