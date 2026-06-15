import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Goal, Milestone } from "../shared/agentGoal";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import type { AgentToolExecutor } from "./agentToolExecutor";
import { createDynamicToolRegistry } from "./dynamicToolRegistry";
import { createGoalRuntimeEngine } from "./goalRuntimeEngine";
import { createAgentGoalContext } from "./agentGoalContext";
import type { AgentLoopResult } from "./agentLoop";
import type { ChatMessage } from "./openAiCompatibleClient";
import { createScheduledTaskStore } from "./taskStore";
import { createToolAuditLog } from "./toolAuditLog";
import { createToolAuthorizationService } from "./toolAuthorizationService";

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
    expect(loopInputs[0]?.systemPrompt).toContain("Model profile: default");
    expect(loopInputs[0]?.messages.at(-1)).toEqual({
      role: "user",
      content: expect.stringContaining("Milestone: 调研 Serenity 投资方法论"),
    });
    expect(loopInputs[0]?.messages.some((message) =>
      message.content.includes("[Goal continuity checkpoint - never compact]")
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
    expect(result.transcriptMessages?.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
    ]);
    expect(result.transcriptMessages?.at(-2)?.content).toContain(
      "Milestone: 调研 Serenity 投资方法论",
    );
    expect(result.transcriptMessages?.at(-1)?.content).toBe(
      "已完成 Serenity 投资方法论调研摘要。",
    );
    expect(runs[0]?.events.map((event) => event.message)).toContain(
      "Goal milestone agent loop completed.",
    );
    expect(trajectoryEvents.map((event) => event.type)).toContain("final_summary");
    expect(trajectoryEvents.map((event) => event.type)).toContain("checkpoint_written");
  });

  it("includes artifact evidence file contracts in milestone instructions", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "goal-workspace-"));
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "goal-output-"));

    try {
      const criterion = {
        id: "criterion_artifacts",
        description: "阶段成果必须落盘，供验收读取。",
        acceptanceChecks: [
          {
            id: "check_notes",
            kind: "model_review" as const,
            description: "评审确认研究笔记完整。",
            params: {
              condition: "研究笔记已经生成",
              evidenceRefs: ["artifact:research_notes", "artifact:report_outline"],
            },
            requiresEvidence: true,
          },
        ],
      };
      const goal = createGoal({
        description: `深度调研 Serenity，并把报告放在 ${outputRoot}`,
        milestoneSuccessCriteria: [criterion],
      });
      let milestoneInstruction = "";
      const engine = createGoalRuntimeEngine({
        workspaceRoot,
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
            return run;
          },
        },
        trajectoryStore: {
          async append(_runId, event) {
            return event;
          },
        },
        goalContext: createAgentGoalContext(),
        createId: () => "goal_run_1",
        now: () => "2026-06-13T10:00:00.000Z",
        runAgentLoop: async (messages): Promise<AgentLoopResult> => {
          milestoneInstruction = messages.at(-1)?.content ?? "";
          return {
            summary: "已写入 artifact 文件。",
            status: "succeeded",
            turns: 1,
            messages,
            toolCallsExecuted: 1,
          };
        },
      });

      await engine.runMilestone(goal, goal.milestones[0]!);

      expect(milestoneInstruction).toContain("Artifact evidence contract");
      expect(milestoneInstruction).toContain("artifact:research_notes");
      expect(milestoneInstruction).toContain(path.join(outputRoot, "research_notes.md"));
      expect(milestoneInstruction).toContain("artifact:report_outline");
      expect(milestoneInstruction).toContain(path.join(outputRoot, "report_outline.md"));
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it("authorizes milestone tools with a goal-scoped policy instead of a scheduled task record", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "goal-authz-"));
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "goal-workspace-"));

    try {
      const auditLog = createToolAuditLog({
        configDir,
        createId: () => "audit_goal_1",
        now: () => new Date("2026-06-13T10:00:01.000Z"),
      });
      const toolAuthorizationService = createToolAuthorizationService({
        taskStore: createScheduledTaskStore({ configDir }),
        auditLog,
      });
      const registry = createDynamicToolRegistry();
      const executedArgs: Record<string, unknown>[] = [];
      const executionWorkspaceRoots: Array<string | undefined> = [];
      registry.register(
        {
          type: "function",
          function: {
            name: "web_search",
            description: "Search the web",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
          },
        },
        async (args, options) => {
          executedArgs.push(args);
          executionWorkspaceRoots.push(options?.runContext?.workspaceRoot);
          return {
            ok: true,
            result: { results: [{ title: "Serenity", url: "https://x.com" }] },
          };
        },
        "native:web",
      );
      const toolExecutor: AgentToolExecutor = {
        execute(request, options) {
          return registry.execute(request.toolName, request.args, options);
        },
        getRegistry() {
          return registry;
        },
        hasTool(toolName) {
          return registry.has(toolName);
        },
      };
      let completions = 0;
      const observedToolMessages: string[] = [];
      const goal = createGoal();
      const milestone = goal.milestones[0]!;
      const engine = createGoalRuntimeEngine({
        workspaceRoot,
        chatClient: {
          async complete(request) {
            completions += 1;
            if (completions === 1) {
              return {
                content: null,
                finishReason: "tool_calls",
                toolCalls: [
                  {
                    id: "tool_call_1",
                    type: "function",
                    function: {
                      name: "web_search",
                      arguments: JSON.stringify({ query: "白发魔女Serenity" }),
                    },
                  },
                ],
              };
            }

            const toolMessage = request.messages.find(
              (message) => message.role === "tool",
            );
            observedToolMessages.push(toolMessage?.content ?? "");
            return {
              content: "已根据搜索结果完成。",
              finishReason: "stop",
              toolCalls: [],
            };
          },
        },
        getModelProfile: async () => ({
          baseUrl: "https://api.example.com/v1",
          apiKey: "secret",
          model: "agent-model",
          temperature: 0.2,
          maxTokens: 8192,
        }),
        toolExecutor,
        toolAuthorizationService,
        runStore: {
          async append(run) {
            return run;
          },
        },
        trajectoryStore: {
          async append(_runId, event) {
            return event;
          },
        },
        goalContext: createAgentGoalContext(),
        createId: () => "goal_run_1",
        now: () => "2026-06-13T10:00:00.000Z",
        maxTurns: 3,
      });

      const result = await engine.runMilestone(goal, milestone);

      expect(result.status).toBe("succeeded");
      expect(executedArgs).toEqual([{ query: "白发魔女Serenity" }]);
      expect(executionWorkspaceRoots).toEqual([workspaceRoot]);
      expect(observedToolMessages[0]).toContain('"ok":true');
      await expect(auditLog.list()).resolves.toMatchObject([
        {
          taskId: "goal:goal_1",
          decision: {
            allowed: true,
            reason: expect.stringContaining("goal milestone"),
          },
        },
      ]);
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("adds explicit goal output roots to the run context and runtime policy", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "goal-workspace-"));
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "goal-output-"));

    try {
      const outputPath = path.join(outputRoot, "serenity-raw-data.md");
      const criterion = {
        id: "criterion_output",
        description: "Report is written to the user-selected output directory.",
        acceptanceChecks: [
          {
            id: "check_output",
            kind: "file_exists" as const,
            description: "Report exists at the requested output path.",
            params: { path: outputPath },
            requiresEvidence: false,
          },
        ],
      };
      const goal = createGoal({
        description: `深度调研白发魔女 Serenity，并把报告放在 ${outputRoot}`,
        successCriteria: [criterion],
        milestoneSuccessCriteria: [criterion],
      });
      const observed: Array<{
        extraReadRoots: string[];
        extraWriteRoots: string[];
        policyReadRoots: string[];
        policyWriteRoots: string[];
        shellCommands: string[];
      }> = [];
      const engine = createGoalRuntimeEngine({
        workspaceRoot,
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
            return run;
          },
        },
        trajectoryStore: {
          async append(_runId, event) {
            return event;
          },
        },
        goalContext: createAgentGoalContext(),
        createId: () => "goal_run_1",
        now: () => "2026-06-13T10:00:00.000Z",
        runAgentLoop: async (messages, _profile, options): Promise<AgentLoopResult> => {
          observed.push({
            extraReadRoots: options.runContext?.sandbox.extraReadRoots ?? [],
            extraWriteRoots: options.runContext?.sandbox.extraWriteRoots ?? [],
            policyReadRoots: options.runtimeTask?.permissions.files.read ?? [],
            policyWriteRoots: options.runtimeTask?.permissions.files.write ?? [],
            shellCommands: options.runtimeTask?.permissions.shell.commands ?? [],
          });
          return {
            summary: "已写入用户指定目录。",
            status: "succeeded",
            turns: 1,
            messages,
            toolCallsExecuted: 1,
          };
        },
      });

      await engine.runMilestone(goal, goal.milestones[0]!);

      expect(observed).toEqual([
        {
          extraReadRoots: [outputRoot],
          extraWriteRoots: [outputRoot],
          policyReadRoots: [workspaceRoot, outputRoot],
          policyWriteRoots: [workspaceRoot, outputRoot],
          shellCommands: expect.arrayContaining([
            "npm test",
            "npm test -- *",
            "npm run harness:check",
            "npm run verify",
          ]),
        },
      ]);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
      await rm(outputRoot, { recursive: true, force: true });
    }
  });
});

function createGoal(overrides: {
  description?: string;
  successCriteria?: Goal["successCriteria"];
  milestoneSuccessCriteria?: Milestone["successCriteria"];
} = {}): Goal {
  const milestone: Milestone = {
    id: "milestone_1",
    description: "调研 Serenity 投资方法论",
    dependsOn: [],
    successCriteria: overrides.milestoneSuccessCriteria ?? [],
    state: "ready",
    runIds: [],
    attempts: 0,
  };

  return {
    id: "goal_1",
    chatSessionId: "chat_1",
    description: overrides.description ?? "深度调研 Serenity",
    successCriteria: overrides.successCriteria ?? [],
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
