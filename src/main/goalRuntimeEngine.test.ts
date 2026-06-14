import { describe, expect, it } from "vitest";
import type { Goal, Milestone } from "../shared/agentGoal";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import { createDynamicToolRegistry } from "./dynamicToolRegistry";
import { createGoalRuntimeEngine } from "./goalRuntimeEngine";
import { createAgentGoalContext } from "./agentGoalContext";
import type { AgentLoopResult } from "./agentLoop";
import type { ChatMessage } from "./openAiCompatibleClient";

describe("goal runtime engine", () => {
  it("runs a goal milestone through the agent loop and records the run", async () => {
    const runs: AgentRunRecord[] = [];
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const loopInputs: Array<{
      messages: ChatMessage[];
      taskId: string | undefined;
      systemPrompt: string | undefined;
    }> = [];
    const goal = createGoal();
    const milestone = goal.milestones[0]!;
    const goalContext = createAgentGoalContext();
    const engine = createGoalRuntimeEngine({
      workspaceRoot: "/Users/example",
      chatClient: {
        async complete() {
          throw new Error("fake loop should be used");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      toolExecutor: {
        async execute() {
          return { ok: true, result: {} };
        },
        getRegistry() {
          return createDynamicToolRegistry();
        },
        hasTool() {
          return true;
        },
      },
      runStore: {
        async append(run) {
          runs.push(run);
          return run;
        },
      },
      trajectoryStore: {
        async append(_runId, event) {
          trajectoryEvents.push(event);
          return event;
        },
      },
      goalContext,
      createId: () => "goal_run_1",
      now: () => "2026-06-13T10:00:00.000Z",
      runAgentLoop: async (messages, _profile, options): Promise<AgentLoopResult> => {
        loopInputs.push({
          messages,
          taskId: options.taskId,
          systemPrompt: options.systemPrompt,
        });
        return {
          summary: "已完成 Serenity 投资方法论调研摘要。",
          status: "succeeded",
          turns: 2,
          messages,
          toolCallsExecuted: 3,
        };
      },
    });

    const result = await engine.runMilestone(goal, milestone);

    expect(result).toMatchObject({
      runId: "goal_run_1",
      toolCallCount: 3,
      status: "succeeded",
      summary: "已完成 Serenity 投资方法论调研摘要。",
    });
    expect(result.tokens).toBeGreaterThan(0);
    expect(loopInputs).toHaveLength(1);
    expect(loopInputs[0]?.taskId).toBe("goal:goal_1");
    expect(loopInputs[0]?.systemPrompt).toContain("长期目标执行");
    expect(loopInputs[0]?.messages.at(-1)).toEqual({
      role: "user",
      content: expect.stringContaining("Milestone: 调研 Serenity 投资方法论"),
    });
    expect(loopInputs[0]?.messages.some((message) =>
      message.content.includes("[Goal anchors - never compact]")
    )).toBe(true);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: "goal_run_1",
      taskId: "goal:goal_1",
      taskName: "深度调研 Serenity",
      skillName: "goal-milestone",
      status: "succeeded",
      summary: "已完成 Serenity 投资方法论调研摘要。",
    });
    expect(runs[0]?.events.map((event) => event.message)).toContain(
      "Goal milestone agent loop completed.",
    );
    expect(trajectoryEvents.map((event) => event.type)).toContain("final_summary");
    expect(trajectoryEvents.map((event) => event.type)).toContain("checkpoint_written");
  });
});

function createGoal(): Goal {
  const milestone: Milestone = {
    id: "milestone_1",
    description: "调研 Serenity 投资方法论",
    dependsOn: [],
    successCriteria: [],
    state: "ready",
    runIds: [],
    attempts: 0,
  };

  return {
    id: "goal_1",
    chatSessionId: "chat_1",
    description: "深度调研 Serenity",
    successCriteria: [],
    milestones: [milestone],
    status: "executing",
    budget: {
      maxIterations: 8,
      maxToolCalls: 64,
      maxWallClockMs: 45 * 60 * 1000,
      maxReplans: 3,
    },
    budgetUsage: {
      iterations: 0,
      toolCalls: 0,
      wallClockMs: 0,
      tokens: 0,
      replans: 0,
    },
    reviewPolicy: "review_each_milestone",
    planVersion: 1,
    createdAt: "2026-06-13T10:00:00.000Z",
    updatedAt: "2026-06-13T10:00:00.000Z",
  };
}
