import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Goal, Milestone } from "../shared/agentGoal";
import type { AgentRunEvent, AgentRunRecord } from "../shared/agentRuns";
import {
  buildPrimaryRunContext,
  type AgentRunContext,
} from "../shared/agentWorkspace";
import type { TaskPermissionPolicy } from "../shared/toolPermissions";
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
import type {
  RuntimeToolAuthorizationTask,
  ToolAuthorizationService,
} from "./toolAuthorizationService";
import type { ToolResultOffloadStore } from "./toolResultOffloadStore";
import { estimateMessageTokens } from "./contextManager";
import type { GoalProgressEvent } from "../shared/chat";
import { applyGoalOutputRootsToRunContext } from "./goalOutputRoots";

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
  onEvent?: (event: AgentRunEvent) => void;
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
    const event: AgentRunEvent = {
      level,
      phase,
      message,
      ...(data ? { data } : {}),
      createdAt: now(),
    };
    options.onEvent?.(event);
    return event;
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
    let runContext: AgentRunContext;
    if (options.workspaceService) {
      runContext = await options.workspaceService.resolveRunContext({
        workspaceId: goal.workspaceId,
        ...(goal.chatSessionId ? { sessionId: goal.chatSessionId } : {}),
      });
      return applyGoalOutputRootsToRunContext(runContext, goal);
    }

    // Legacy fallback for callers that still provide a fixed root.
    const workspaceRoot = options.workspaceRoot;
    if (!workspaceRoot) {
      throw new Error(
        "GoalRuntimeEngine requires workspaceService or workspaceRoot.",
      );
    }
    runContext = buildPrimaryRunContext({
      workspaceId: goal.workspaceId ?? "local",
      workspaceRoot,
      ...(goal.chatSessionId ? { sessionId: goal.chatSessionId } : {}),
    });
    return applyGoalOutputRootsToRunContext(runContext, goal);
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
        content: buildMilestoneInstruction(goal, milestone, runContext),
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
          runContext,
          runtimeTask: buildGoalMilestoneRuntimeTask(goal, runContext),
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
          onReasoning(reasoningContent, turn) {
            void appendTrajectory(runId, "model_reasoning", {
              ...payload,
              turn,
              reasoningContent,
            });
            events.push(
              createEvent("info", "reflecting", reasoningContent, {
                ...payload,
                turn,
              }),
            );
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

function buildGoalMilestoneRuntimeTask(
  goal: Goal,
  runContext: AgentRunContext,
): RuntimeToolAuthorizationTask {
  return {
    name: `Goal milestone: ${goal.description}`,
    policyLabel: "goal milestone runtime policy",
    permissions: buildGoalMilestonePermissionPolicy(runContext),
  };
}

function buildGoalMilestonePermissionPolicy(
  runContext: AgentRunContext,
): TaskPermissionPolicy {
  const readRoots = [
    runContext.workspaceRoot,
    ...runContext.sandbox.extraReadRoots,
  ];
  const writeRoots =
    runContext.sandbox.mode === "read_only"
      ? []
      : [
          runContext.workspaceRoot,
          ...runContext.sandbox.extraWriteRoots,
        ];

  return {
    files: {
      read: readRoots,
      write: writeRoots,
    },
    web: {
      search: runContext.sandbox.network !== "none",
      fetchDomains: [],
    },
    shell: {
      commands: [
        "npm test",
        "npm test -- *",
        "npm run build",
        "npm run verify",
        "npm run harness:check",
        "npm run harness:score",
        "npm run smoke:prod",
        "node *",
        "git status",
        "git diff",
        "git diff -- *",
      ],
    },
    memory: {
      read: true,
      write: false,
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

function buildMilestoneInstruction(
  goal: Goal,
  milestone: Milestone,
  runContext: AgentRunContext,
): string {
  const criteriaLines = milestone.successCriteria.flatMap((criterion, index) => {
    const lines = [
      `  验收标准 ${index + 1}: ${criterion.description}`,
      ...criterion.acceptanceChecks.map(
        (check) =>
          `    - ${check.description}${
            check.requiresEvidence ? "（需要证据）" : ""
          }`,
      ),
    ];
    return lines;
  });
  const artifactContractLines = buildArtifactEvidenceContract(
    goal,
    milestone,
    runContext,
  );

  return [
    "[Goal milestone execution instruction]",
    `Milestone: ${milestone.description}`,
    "",
    "本里程碑的验收标准如下，你必须确保每一项验收检查最终通过：",
    ...criteriaLines,
    ...artifactContractLines,
    "",
    "请执行这个里程碑。优先产出可追溯证据和阶段性结论。如果验收标准涉及文件路径，请准确创建对应文件。",
  ].join("\n");
}

function buildArtifactEvidenceContract(
  goal: Goal,
  milestone: Milestone,
  runContext: AgentRunContext,
): string[] {
  const artifactNames = getArtifactEvidenceNames(milestone);
  if (artifactNames.length === 0) {
    return [];
  }

  const outputRoot = getArtifactOutputRoot(runContext);
  return [
    "",
    "Artifact evidence contract:",
    "以下 artifact 是后续验收会直接读取的证据引用。完成本里程碑前必须把对应内容写入指定文件，不能只在回复中声明已经完成：",
    ...artifactNames.map((artifactName) => {
      const artifactPath = path.join(outputRoot, `${artifactName}.md`);
      return `  - artifact:${artifactName} -> ${artifactPath}`;
    }),
    `目标：${goal.description}`,
    "如果你还需要生成更友好的展示文件名，可以额外生成；但上述 artifact alias 文件必须保留并包含可验收的完整内容或最终文件清单。",
  ];
}

function getArtifactEvidenceNames(milestone: Milestone): string[] {
  const names: string[] = [];
  for (const criterion of milestone.successCriteria) {
    for (const check of criterion.acceptanceChecks) {
      const evidenceRefs = Array.isArray(check.params.evidenceRefs)
        ? check.params.evidenceRefs
        : [];
      for (const ref of evidenceRefs) {
        if (typeof ref !== "string" || !ref.startsWith("artifact:")) {
          continue;
        }
        const artifactName = ref.slice("artifact:".length);
        if (isSafeArtifactName(artifactName) && !names.includes(artifactName)) {
          names.push(artifactName);
        }
      }
    }
  }
  return names;
}

function getArtifactOutputRoot(runContext: AgentRunContext): string {
  return runContext.sandbox.extraWriteRoots[0] ?? runContext.workspaceRoot;
}

function isSafeArtifactName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes("..");
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
