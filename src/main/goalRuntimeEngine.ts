import { randomUUID } from "node:crypto";
import type { Goal, Milestone } from "../shared/agentGoal";
import type { AgentRunEvent, AgentRunRecord } from "../shared/agentRuns";
import { buildPrimaryRunContext } from "../shared/agentWorkspace";
import {
  runAgentLoop,
  type AgentLoopOptions,
  type AgentLoopResult,
} from "./agentLoop";
import type { GoalRuntimeEngine } from "./agentGoalController";
import type { AgentGoalContext } from "./agentGoalContext";
import type { AgentRunStore } from "./agentRunStore";
import type { AgentToolExecutor } from "./agentToolExecutor";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import type { AgentWorkspaceService } from "./agentWorkspaceService";
import type { ChatClient, ChatMessage } from "./openAiCompatibleClient";
import type { ToolAuthorizationService } from "./toolAuthorizationService";
import type { ToolResultOffloadStore } from "./toolResultOffloadStore";
import { estimateMessageTokens } from "./contextManager";
import type { GoalProgressEvent } from "../shared/chat";

export type GoalRuntimeModelProfile = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
};

export function createGoalRuntimeEngine(options: {
  workspaceRoot?: string;
  workspaceService?: Pick<AgentWorkspaceService, "resolveRunContext">;
  chatClient: ChatClient;
  getModelProfile: () => Promise<GoalRuntimeModelProfile>;
  toolExecutor: AgentToolExecutor;
  runStore: Pick<AgentRunStore, "append">;
  trajectoryStore: Pick<AgentTrajectoryStore, "append">;
  goalContext: AgentGoalContext;
  toolAuthorizationService?: ToolAuthorizationService;
  toolResultOffloadStore?: ToolResultOffloadStore;
  toolResultOffloadThreshold?: number;
  runAgentLoop?: typeof runAgentLoop;
  createId?: () => string;
  now?: () => string;
  nextSequence?: () => number;
  maxTurns?: number;
  tokenBudget?: number;
  onProgress?: (event: GoalProgressEvent) => void;
}): GoalRuntimeEngine {
  const createId = options.createId ?? (() => `goal_run_${randomUUID()}`);
  const now = options.now ?? (() => new Date().toISOString());
  const runLoop = options.runAgentLoop ?? runAgentLoop;
  let sequence = 0;
  const nextSequence =
    options.nextSequence ??
    (() => {
      sequence += 1;
      return sequence;
    });

  function notifyProgress(
    event: GoalProgressEvent["event"],
    goal: Goal,
    message: string,
    milestoneId?: string,
  ) {
    options.onProgress?.({
      kind: "goal_progress",
      goalId: goal.id,
      sessionId: goal.chatSessionId,
      status: goal.status,
      milestoneId,
      event,
      message,
      timestamp: now(),
    });
  }

  function createEvent(
    level: AgentRunEvent["level"],
    phase: AgentRunEvent["phase"],
    message: string,
    data?: Record<string, unknown>,
  ): AgentRunEvent {
    return {
      level,
      phase,
      message,
      ...(data ? { data } : {}),
      createdAt: now(),
    };
  }

  async function appendTrajectory(
    runId: string,
    type: Parameters<AgentTrajectoryStore["append"]>[1]["type"],
    payload: Record<string, unknown>,
    containsUserText = true,
  ) {
    await options.trajectoryStore.append(runId, {
      id: `trajectory_${randomUUID()}`,
      runId,
      type,
      sequence: nextSequence(),
      payload,
      redaction: {
        containsApiKey: false,
        containsFileContent: false,
        containsUserText,
      },
      createdAt: now(),
    });
  }

  async function resolveRunContext(goal: Goal) {
    if (options.workspaceService) {
      return options.workspaceService.resolveRunContext({
        workspaceId: goal.workspaceId,
        ...(goal.chatSessionId ? { sessionId: goal.chatSessionId } : {}),
      });
    }

    // Legacy fallback for callers that still provide a fixed root.
    const workspaceRoot = options.workspaceRoot;
    if (!workspaceRoot) {
      throw new Error(
        "GoalRuntimeEngine requires workspaceService or workspaceRoot.",
      );
    }
    return buildPrimaryRunContext({
      workspaceId: goal.workspaceId ?? "local",
      workspaceRoot,
      ...(goal.chatSessionId ? { sessionId: goal.chatSessionId } : {}),
    });
  }

  return {
    async runMilestone(goal, milestone, runOptions) {
      const startedAt = now();
      const runId = createId();
      const taskId = `goal:${goal.id}`;
      const runContext = await resolveRunContext(goal);
      const payload = {
        goalId: goal.id,
        milestoneId: milestone.id,
        ...(goal.chatSessionId ? { chatSessionId: goal.chatSessionId } : {}),
      };
      const events: AgentRunEvent[] = [
        createEvent(
          "info",
          "executing",
          `Goal milestone started: ${milestone.description}`,
          payload,
        ),
      ];
      let observedToolCalls = 0;

      await appendTrajectory(runId, "run_context_created", {
        ...payload,
        runContext,
      });

      const tokenBudget =
        options.tokenBudget ??
        goal.budget.maxTokens ??
        (await options.getModelProfile()).maxTokens;
      const assembled = options.goalContext.assemble(goal, [], tokenBudget);
      const milestoneInstruction: ChatMessage = {
        role: "user",
        content: buildMilestoneInstruction(milestone),
      };
      const initialMessages: ChatMessage[] = [
        ...assembled.messages,
        milestoneInstruction,
      ];

      const loopResult = await runLoop(
        initialMessages,
        await options.getModelProfile(),
        {
          chatClient: options.chatClient,
          toolExecutor: options.toolExecutor,
          toolAuthorizationService: options.toolAuthorizationService,
          taskId,
          systemPrompt: buildGoalSystemPrompt(),
          maxTurns: options.maxTurns ?? 8,
          tools: options.toolExecutor.getRegistry().getDefinitions(),
          toolResultOffloadStore: options.toolResultOffloadStore,
          toolResultOffloadThreshold: options.toolResultOffloadThreshold,
          pauseOnFailureLoop: true,
          ...(runOptions?.signal ? { signal: runOptions.signal } : {}),
          onTurn(turn, phase) {
            void appendTrajectory(runId, "model_request", {
              ...payload,
              turn: turn + 1,
              phase,
            });
          },
          onModelResponse(response, turn) {
            void appendTrajectory(runId, "model_response", {
              ...payload,
              turn,
              hasContent: Boolean(response.content),
              toolCallCount: response.toolCalls.length,
              finishReason: response.finishReason,
            });
          },
          onToolCall(toolName, args) {
            void appendTrajectory(runId, "tool_call", {
              ...payload,
              toolName,
              args,
            });
            events.push(
              createEvent("info", "executing", `Tool called: ${toolName}`, {
                ...payload,
                toolName,
              }),
            );
          },
          onToolResult(toolName, ok) {
            observedToolCalls += 1;
            void appendTrajectory(runId, "tool_result", {
              ...payload,
              toolName,
              ok,
            });
            events.push(
              createEvent(
                ok ? "info" : "warn",
                "executing",
                ok ? `Tool completed: ${toolName}` : `Tool failed: ${toolName}`,
                { ...payload, toolName },
              ),
            );
          },
        } satisfies AgentLoopOptions,
      );
      const finishedAt = now();
      const status = toRunStatus(loopResult.status);
      events.push(
        createEvent(
          status === "succeeded" ? "info" : "error",
          status === "succeeded" ? "done" : "executing",
          status === "succeeded"
            ? "Goal milestone agent loop completed."
            : "Goal milestone agent loop did not complete.",
          {
            ...payload,
            status: loopResult.status,
            toolCallsExecuted: loopResult.toolCallsExecuted,
          },
        ),
      );
      await appendTrajectory(runId, "final_summary", {
        ...payload,
        status: loopResult.status,
        toolCallsExecuted: loopResult.toolCallsExecuted,
        summary: loopResult.summary,
      });

      const run: AgentRunRecord = {
        id: runId,
        taskId,
        taskName: goal.description,
        skillName: "goal-milestone",
        status,
        runContext,
        summary: loopResult.summary,
        events,
        startedAt,
        finishedAt,
      };
      notifyProgress(
        status === "succeeded" ? "milestone_accepted" : "milestone_rejected",
        goal,
        loopResult.summary ?? `里程碑运行结束：${status}`,
        milestone.id,
      );
      await options.runStore.append(run);

      await appendTrajectory(runId, "checkpoint_written", {
        ...payload,
        runId,
        status,
      });

      return {
        runId,
        toolCallCount: Math.max(
          loopResult.toolCallsExecuted,
          observedToolCalls,
        ),
        status: loopResult.status,
        summary: loopResult.summary,
        wallClockMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
        tokens: inferTokens(loopResult, initialMessages),
      };
    },
  };
}

function buildGoalSystemPrompt(): string {
  return [
    "你是 Zerox Agent 的长期目标执行器，运行在用户本地桌面环境中。",
    "默认使用中文，围绕当前长期目标推进一个明确里程碑。",
    "需要证据时直接调用可用工具；不要只声明会做，要实际推进。",
    "完成后给出本轮已做的事、证据来源、剩余风险和下一步建议。",
  ].join("\n");
}

function buildMilestoneInstruction(milestone: Milestone): string {
  return [
    "[Goal milestone execution instruction]",
    `Milestone: ${milestone.description}`,
    "请执行这个里程碑。优先产出可追溯证据和阶段性结论。",
  ].join("\n");
}

function toRunStatus(status: AgentLoopResult["status"]): AgentRunRecord["status"] {
  if (status === "succeeded" || status === "paused" || status === "canceled") {
    return status;
  }
  return "failed";
}

function inferTokens(
  loopResult: AgentLoopResult,
  initialMessages: ChatMessage[],
): number {
  const loopResultWithTokens = loopResult as unknown as { tokens?: unknown };
  if (typeof loopResultWithTokens.tokens === "number") {
    return loopResultWithTokens.tokens;
  }

  return Math.max(1, estimateMessageTokens(initialMessages));
}
