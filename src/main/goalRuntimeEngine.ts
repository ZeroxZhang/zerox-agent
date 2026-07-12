import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  AcceptanceRepairDirective,
  Goal,
  Milestone,
} from "../shared/agentGoal";
import type { AgentRunEvent, AgentRunRecord } from "../shared/agentRuns";
import type { ExecutionContextMemoryScope } from "../shared/executionContextPackage";
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
import { buildAgentSystemPrompt, getSystemPromptAssembler } from "../shared/agentProtocol";
import {
  type DeterministicToolExecutionOptions,
  executeDeterministicGoalPipeline,
  getDeterministicGoalPipelineReadRoots,
  isDeterministicGoalPipelineSupported,
} from "./agentDeterministicGoalPipeline";
import {
  createToolInvocation,
  transitionToolInvocation,
  type ToolInvocationRecord,
  type ToolInvocationTransition,
} from "../shared/toolInvocationLedger";
import { createRuntimeContextSnapshotForRun } from "./runtimeContextFactory";
import { summarizeAgentRuntimeContextSnapshot } from "../shared/agentRuntimeContext";
import {
  createToolActionSignature,
  sanitizeActionSignaturesForPersistence,
} from "./agentGoalFailureFingerprint";
import { boundRuntimeTranscript } from "./runtimeTranscript";

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
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) return;
    try {
      await options.trajectoryStore.append(
        runId,
        {
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
        },
        { ...(signal ? { signal } : {}) },
      );
    } catch (error) {
      if (signal?.aborted) return;
      throw error;
    }
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
      const remainingWallClockMs = Math.max(
        1,
        goal.budget.maxWallClockMs - goal.budgetUsage.wallClockMs,
      );
      const deadlineSignal = createBudgetDeadlineSignal(remainingWallClockMs);
      const runSignal = combineRuntimeSignals(
        runOptions?.signal,
        deadlineSignal,
      );
      let trajectoryQueue: Promise<void> = Promise.resolve();
      const appendRunTrajectory = (
        type: Parameters<AgentTrajectoryStore["append"]>[1]["type"],
        payload: Record<string, unknown>,
        containsUserText = true,
      ) => {
        const write = trajectoryQueue.then(() =>
          appendTrajectory(
            runId,
            type,
            payload,
            containsUserText,
            runSignal,
          ),
        );
        trajectoryQueue = write.catch(() => undefined);
        return write;
      };
      const flushTrajectoryWrites = async () => {
        await trajectoryQueue;
      };
      const taskId = `goal:${goal.id}`;
      const runContext = extendRunContextForSelectedSkill(
        withGoalRunIdentity(
          await resolveRunContext(goal),
          runId,
          goal.id,
          milestone.id,
        ),
        goal,
      );
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
      const actionSignatures = new Set<string>();
      const recordActionSignature = (toolName: string, args: unknown) => {
        if (actionSignatures.size >= 32) {
          return;
        }
        actionSignatures.add(createToolActionSignature(toolName, args));
      };
      const recordCanceledRun = async (
        skillName: string,
        transcriptMessages: ChatMessage[],
        tokens: number,
      ) => {
        const finishedAt = now();
        const canceledRun: AgentRunRecord = {
          id: runId,
          taskId,
          taskName: goal.description,
          skillName,
          status: "canceled",
          runContext,
          summary: "Goal milestone canceled.",
          events,
          startedAt,
          finishedAt,
        };
        await options.runStore.append(canceledRun);
        await flushTrajectoryWrites();
        return {
          runId,
          toolCallCount: observedToolCalls,
          status: "canceled" as const,
          summary: "Goal milestone canceled.",
          wallClockMs:
            new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
          tokens,
          transcriptMessages,
          actionSignatures: sanitizeActionSignaturesForPersistence([
            ...actionSignatures,
          ]),
        };
      };
      const recordTimedOutRun = async (skillName: string) => {
        const finishedAt = now();
        const summary = `Goal milestone exceeded wall-clock budget after ${remainingWallClockMs}ms.`;
        const failedRun: AgentRunRecord = {
          id: runId,
          taskId,
          taskName: goal.description,
          skillName,
          status: "failed",
          runContext,
          summary,
          events,
          startedAt,
          finishedAt,
        };
        await options.runStore.append(failedRun);
        await flushTrajectoryWrites();
        return {
          runId,
          toolCallCount: observedToolCalls,
          status: "failed" as const,
          summary,
          wallClockMs: remainingWallClockMs,
          tokens: 0,
          transcriptMessages: [] as ChatMessage[],
          actionSignatures: sanitizeActionSignaturesForPersistence([
            ...actionSignatures,
          ]),
        };
      };

      const taskContract = goal.taskContract;
      if (isDeterministicGoalPipelineSupported(taskContract)) {
        const runtimeContextSnapshot = createRuntimeContextSnapshotForRun({
          surface: "goal",
          runId,
          runContext,
          modelProfile: {
            providerId: "native",
            model: "deterministic",
            profile: "goal",
            capabilities: ["native_pipeline"],
          },
          tools: options.toolExecutor.getRegistry().getDefinitions(),
          getToolSource: (toolName) =>
            options.toolExecutor.getRegistry().getSource(toolName),
          ...(goal.selectedSkill ? { selectedSkill: goal.selectedSkill } : {}),
          permission: {
            taskId,
            runtimeTaskId: `${taskId}:${milestone.id}`,
            approvalMode: "scheduled",
            policyLabel: "goal milestone runtime policy",
          },
          memory: {
            scopes: buildGoalRuntimeMemoryScopes(goal, runContext),
            recallBudgetTokens: 0,
            rawHistoryEnabled: false,
          },
          checkpoint: {
            strategy: "boundary",
            preserveToolPairs: true,
            protectSkillLoads: true,
          },
          trajectory: {
            ...(goal.chatSessionId ? { sessionId: goal.chatSessionId } : {}),
          },
          createId: () => `runtime_snapshot_${runId}`,
          now,
        });
        await appendRunTrajectory("run_context_created", {
          ...payload,
          runContext,
          runtimeContextSnapshot,
          runtimeContextSnapshotSummary:
            summarizeAgentRuntimeContextSnapshot(runtimeContextSnapshot),
        }, false);
        let pipelineResult: Awaited<
          ReturnType<typeof executeDeterministicGoalPipeline>
        >;
        try {
          pipelineResult = await executeDeterministicGoalPipeline({
          contract: taskContract,
          runContext,
          async executeTool(
            toolName,
            args,
            deterministicOptions?: DeterministicToolExecutionOptions,
          ) {
            recordActionSignature(toolName, args);
            const registeredToolSource =
              options.toolExecutor.getRegistry().getSource(toolName);
            let invocation = createToolInvocation({
              id: `tool_invocation_${createId()}`,
              runId,
              toolCallId: `deterministic_${observedToolCalls + 1}`,
              toolName,
              source: "deterministic-goal-pipeline",
              args,
              createdAt: now(),
            });
            const appendInvocation = async (record: ToolInvocationRecord) => {
              await appendRunTrajectory("tool_invocation", {
                ...payload,
                toolInvocationId: record.id,
                toolCallId: record.toolCallId,
                toolName: record.toolName,
                toolSource: record.source,
                invocationStatus: record.status,
                args: record.args,
                ...(typeof record.ok === "boolean" ? { ok: record.ok } : {}),
                ...(record.resultRef ? { resultRef: record.resultRef } : {}),
                ...(record.error ? { error: record.error } : {}),
                history: record.history,
              });
            };
            const transitionInvocation = async (
              transition: Omit<ToolInvocationTransition, "at"> & { at?: string },
            ) => {
              invocation = transitionToolInvocation(invocation, {
                ...transition,
                at: transition.at ?? now(),
              });
              await appendInvocation(invocation);
            };
            await appendInvocation(invocation);
            await transitionInvocation({ status: "visible" });

            if (options.toolAuthorizationService) {
              const auth = await options.toolAuthorizationService.authorize(
                taskId,
                {
                  toolName: toolName as never,
                  ...(registeredToolSource
                    ? { source: registeredToolSource }
                    : {}),
                  args,
                },
                {
                  ...(runSignal ? { signal: runSignal } : {}),
                  runContext,
                  runtimeTask: buildGoalMilestoneRuntimeTask(goal, runContext),
                },
              );
              if (!auth.ok || !auth.decision.allowed) {
                const rejectedResult = {
                  ok: false as const,
                  error: auth.ok ? auth.decision.reason : auth.message,
                };
                await transitionInvocation({
                  status: "error",
                  ok: false,
                  error: rejectedResult.error,
                });
                await appendRunTrajectory("tool_result", {
                  ...payload,
                  toolName,
                  ok: false,
                  error: rejectedResult.error,
                });
                return rejectedResult;
              }
              await transitionInvocation({
                status: "authorized",
                reason: auth.decision.reason,
              });
            } else {
              await transitionInvocation({
                status: "error",
                ok: false,
                error: "工具授权服务未配置，已拒绝执行。",
              });
              const rejectedResult = {
                ok: false as const,
                error: "工具授权服务未配置，已拒绝执行。",
              };
              await appendRunTrajectory("tool_result", {
                ...payload,
                toolName,
                ok: false,
                error: rejectedResult.error,
              });
              return rejectedResult;
            }

            await appendRunTrajectory("tool_call", {
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
            await transitionInvocation({ status: "running" });
            const result = await options.toolExecutor.execute(
              {
                toolName: toolName as never,
                ...(registeredToolSource
                  ? { source: registeredToolSource }
                  : {}),
                args,
              },
              {
                ...(runSignal ? { signal: runSignal } : {}),
                runContext,
                ...(deterministicOptions?.artifactWrite
                  ? { artifactWrite: deterministicOptions.artifactWrite }
                  : {}),
              },
            );
            observedToolCalls += 1;
            const artifactEvidence = extractArtifactEvidence(result);
            await transitionInvocation(
              result.ok
                ? { status: "completed", ok: true }
                : { status: "error", ok: false, error: result.error },
            );
            await appendRunTrajectory("tool_result", {
              ...payload,
              toolName,
              ok: result.ok,
              ...artifactEvidence.toolResultPayload,
            });
            for (const artifact of artifactEvidence.artifacts ?? []) {
              await appendRunTrajectory("artifact_created", {
                ...payload,
                ...artifact,
                toolName,
              }, false);
            }
            events.push(
              createEvent(
                result.ok ? "info" : "warn",
                "executing",
                result.ok
                  ? `Tool completed: ${toolName}`
                  : `Tool failed: ${toolName}`,
                { ...payload, toolName },
              ),
            );
            return result;
          },
          });
        } catch (error) {
          if (deadlineSignal.aborted && !runOptions?.signal?.aborted) {
            return recordTimedOutRun("deterministic-goal-pipeline");
          }
          if (runOptions?.signal?.aborted || isAbortLike(error)) {
            return recordCanceledRun(
              "deterministic-goal-pipeline",
              [],
              0,
            );
          }
          throw error;
        }
        const finishedAt = now();
        if (deadlineSignal.aborted && !runOptions?.signal?.aborted) {
          return recordTimedOutRun("deterministic-goal-pipeline");
        }
        if (runOptions?.signal?.aborted) {
          return recordCanceledRun("deterministic-goal-pipeline", [], 0);
        }
        const status = pipelineResult.status;
        events.push(
          createEvent(
            status === "succeeded" ? "info" : "error",
            status === "succeeded" ? "done" : "executing",
            status === "succeeded"
              ? "Deterministic goal pipeline completed."
              : "Deterministic goal pipeline failed.",
            {
              ...payload,
              status,
              toolCallsExecuted: pipelineResult.toolNames.length,
            },
          ),
        );
        await appendRunTrajectory("final_summary", {
          ...payload,
          status,
          toolCallsExecuted: pipelineResult.toolNames.length,
          summary: pipelineResult.summary,
          artifacts: pipelineResult.artifacts,
        }, false);

        const run: AgentRunRecord = {
          id: runId,
          taskId,
          taskName: goal.description,
          skillName: "deterministic-goal-pipeline",
          status,
          runContext,
          summary: pipelineResult.summary,
          events,
          startedAt,
          finishedAt,
        };
        notifyProgress(
          status === "succeeded" ? "milestone_accepted" : "milestone_rejected",
          goal,
          pipelineResult.summary,
          milestone.id,
        );
        await options.runStore.append(run);
        await appendRunTrajectory("checkpoint_written", {
          ...payload,
          runId,
          status,
        });
        await flushTrajectoryWrites();

        return {
          runId,
          toolCallCount: Math.max(
            pipelineResult.toolNames.length,
            observedToolCalls,
          ),
          status,
          summary: pipelineResult.summary,
          wallClockMs:
            new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
          tokens: 0,
          transcriptMessages: [
            { role: "assistant", content: pipelineResult.summary },
          ],
          actionSignatures: sanitizeActionSignaturesForPersistence([
            ...actionSignatures,
          ]),
        };
      }

      const modelProfile = await options.getModelProfile();
      const runtimeContextSnapshot = createRuntimeContextSnapshotForRun({
        surface: "goal",
        runId,
        runContext,
        modelProfile,
        tools: options.toolExecutor.getRegistry().getDefinitions(),
        getToolSource: (toolName) =>
          options.toolExecutor.getRegistry().getSource(toolName),
        ...(goal.selectedSkill ? { selectedSkill: goal.selectedSkill } : {}),
        permission: {
          taskId,
          runtimeTaskId: `${taskId}:${milestone.id}`,
          approvalMode: "scheduled",
          policyLabel: "goal milestone runtime policy",
        },
        memory: {
          scopes: buildGoalRuntimeMemoryScopes(goal, runContext),
          recallBudgetTokens: 0,
          rawHistoryEnabled: false,
        },
        checkpoint: {
          strategy: "boundary",
          preserveToolPairs: true,
          protectSkillLoads: true,
        },
        trajectory: {
          ...(goal.chatSessionId ? { sessionId: goal.chatSessionId } : {}),
        },
        createId: () => `runtime_snapshot_${runId}`,
        now,
      });
      await appendRunTrajectory("run_context_created", {
        ...payload,
        runContext,
        runtimeContextSnapshot,
        runtimeContextSnapshotSummary:
          summarizeAgentRuntimeContextSnapshot(runtimeContextSnapshot),
      }, false);
      const tokenBudget =
        options.tokenBudget ??
        (goal.budget.maxTokens
          ? Math.max(1, goal.budget.maxTokens - goal.budgetUsage.tokens)
          : undefined) ??
        modelProfile.maxTokens;
      const assembled = options.goalContext.assemble(
        goal,
        runOptions?.resumeMessages ?? [],
        tokenBudget,
      );
      const milestoneInstruction: ChatMessage = {
        role: "user",
        content: buildMilestoneInstruction(
          goal,
          milestone,
          runContext,
          runOptions?.repairDirective,
        ),
      };
      const initialMessages: ChatMessage[] = [
        ...assembled.messages,
        ...(runOptions?.resumeMessages?.length
          ? [
              {
                role: "system" as const,
                content:
                  "Resume directly from the latest real message/tool result. Do not recap, restart repository discovery, or ask the user to continue.",
              },
            ]
          : []),
        milestoneInstruction,
      ];

      const loopResult = await runLoop(
        initialMessages,
        modelProfile,
        {
          chatClient: options.chatClient,
          toolExecutor: options.toolExecutor,
          toolAuthorizationService: options.toolAuthorizationService,
          taskId,
          runId,
          runContext,
          runtimeTask: buildGoalMilestoneRuntimeTask(goal, runContext),
          systemPrompt: buildGoalSystemPrompt(modelProfile.model, startedAt.split("T")[0]),
          maxTurns:
            options.maxTurns ??
            Math.max(
              4,
              Math.min(
                32,
                goal.budget.maxToolCalls - goal.budgetUsage.toolCalls,
              ),
            ),
          maxToolCalls: Math.max(
            0,
            goal.budget.maxToolCalls - goal.budgetUsage.toolCalls,
          ),
          maxWallClockMs: Math.max(
            1,
            goal.budget.maxWallClockMs - goal.budgetUsage.wallClockMs,
          ),
          tools: options.toolExecutor.getRegistry().getDefinitions(),
          toolResultOffloadStore: options.toolResultOffloadStore,
          toolResultOffloadThreshold: options.toolResultOffloadThreshold,
          pauseOnFailureLoop: true,
          pauseOnStrategyGuard: true,
          pauseOnTurnLimit: false,
          ...(runSignal ? { signal: runSignal } : {}),
          onTurn(turn, phase) {
            void appendRunTrajectory("model_request", {
              ...payload,
              turn: turn + 1,
              phase,
            });
          },
          onModelResponse(response, turn) {
            void appendRunTrajectory("model_response", {
              ...payload,
              turn,
              hasContent: Boolean(response.content),
              toolCallCount: response.toolCalls.length,
              finishReason: response.finishReason,
            });
          },
          onReasoning(reasoningContent, turn) {
            void appendRunTrajectory("model_reasoning", {
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
            recordActionSignature(toolName, args);
            void appendRunTrajectory("tool_call", {
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
          onToolInvocation(record) {
            void appendRunTrajectory("tool_invocation", {
              ...payload,
              toolInvocationId: record.id,
              toolCallId: record.toolCallId,
              toolName: record.toolName,
              toolSource: record.source,
              invocationStatus: record.status,
              args: record.args,
              ...(typeof record.ok === "boolean" ? { ok: record.ok } : {}),
              ...(record.resultRef ? { resultRef: record.resultRef } : {}),
              ...(record.error ? { error: record.error } : {}),
              history: record.history,
            });
          },
          onToolResult(toolName, ok, result) {
            observedToolCalls += 1;
            const artifactEvidence = extractArtifactEvidence(result);
            void appendRunTrajectory("tool_result", {
              ...payload,
              toolName,
              ok,
              ...artifactEvidence.toolResultPayload,
            });
            for (const artifact of artifactEvidence.artifacts ?? []) {
              void appendRunTrajectory("artifact_created", {
                ...payload,
                ...artifact,
                toolName,
              }, false);
            }
            events.push(
              createEvent(
                ok ? "info" : "warn",
                "executing",
                ok ? `Tool completed: ${toolName}` : `Tool failed: ${toolName}`,
                { ...payload, toolName },
              ),
            );
          },
          onStrategyGuard(event) {
            void appendRunTrajectory("strategy_guard_triggered", {
              ...payload,
              ...event,
            }, false);
            events.push(
              createEvent(
                event.severity === "warn" ? "warn" : "info",
                "reflecting",
                `Strategy guard triggered: ${event.code}`,
                {
                  ...payload,
                  ...event,
                },
              ),
            );
          },
          async onCheckpoint(checkpoint) {
            await runOptions?.onCheckpoint?.({
              transcriptMessages: toBoundedTranscriptMessages(
                checkpoint.messages,
              ),
              toolCallCount: checkpoint.toolCallsExecuted,
              wallClockMs:
                new Date(now()).getTime() - new Date(startedAt).getTime(),
              tokens: checkpoint.tokensConsumed,
              nextAction: checkpoint.nextAction,
            });
          },
        } satisfies AgentLoopOptions,
      );
      const finishedAt = now();
      if (runOptions?.signal?.aborted) {
        const canceledRun: AgentRunRecord = {
          id: runId,
          taskId,
          taskName: goal.description,
          skillName: "goal-milestone",
          status: "canceled",
          runContext,
          summary: "Goal milestone canceled.",
          events,
          startedAt,
          finishedAt,
        };
        await options.runStore.append(canceledRun);
        await flushTrajectoryWrites();
        return {
          runId,
          toolCallCount: Math.max(
            loopResult.toolCallsExecuted,
            observedToolCalls,
          ),
          status: "canceled",
          summary: "Goal milestone canceled.",
          wallClockMs:
            new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
          tokens: inferTokens(loopResult, initialMessages),
          transcriptMessages: toBoundedTranscriptMessages(
            loopResult.messages,
          ),
          actionSignatures: sanitizeActionSignaturesForPersistence([
            ...actionSignatures,
          ]),
        };
      }
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
      await appendRunTrajectory("final_summary", {
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

      await appendRunTrajectory("checkpoint_written", {
        ...payload,
        runId,
        status,
      });
      await flushTrajectoryWrites();

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
        transcriptMessages: toBoundedTranscriptMessages(
          loopResult.messages,
          loopResult.summary,
        ),
        actionSignatures: sanitizeActionSignaturesForPersistence([
          ...actionSignatures,
        ]),
      };
    },
  };
}

function withGoalRunIdentity(
  runContext: AgentRunContext,
  runId: string,
  goalId: string,
  milestoneId: string,
): AgentRunContext {
  return {
    ...runContext,
    runId,
    goalId,
    milestoneId,
  };
}

function isAbortLike(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && /abort|cancel/i.test(`${error.name} ${error.message}`))
  );
}

function createBudgetDeadlineSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Wall-clock budget exceeded.", "TimeoutError")),
    ms,
  );
  timer.unref?.();
  return controller.signal;
}

function combineRuntimeSignals(
  first: AbortSignal | undefined,
  second: AbortSignal,
): AbortSignal {
  if (!first) return second;
  const controller = new AbortController();
  const forward = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  if (first.aborted) forward(first);
  else first.addEventListener("abort", () => forward(first), { once: true });
  if (second.aborted) forward(second);
  else second.addEventListener("abort", () => forward(second), { once: true });
  return controller.signal;
}

function buildGoalRuntimeMemoryScopes(
  goal: Goal,
  runContext: AgentRunContext,
): ExecutionContextMemoryScope[] {
  return [
    { kind: "goal", id: goal.id },
    ...(runContext.workspaceId
      ? [{ kind: "workspace" as const, id: runContext.workspaceId }]
      : []),
    ...(goal.chatSessionId
      ? [{ kind: "session" as const, id: goal.chatSessionId }]
      : []),
    ...(goal.selectedSkill?.manifest.name
      ? [{ kind: "skill" as const, id: goal.selectedSkill.manifest.name }]
      : []),
  ];
}

function extendRunContextForSelectedSkill(
  runContext: AgentRunContext,
  goal: Goal,
): AgentRunContext {
  const skill = goal.selectedSkill;
  if (!skill) {
    return runContext;
  }

  return {
    ...runContext,
    sandbox: {
      ...runContext.sandbox,
      extraReadRoots: uniqueStrings([
        ...runContext.sandbox.extraReadRoots,
        skill.rootDir,
        ...skill.manifest.permissions.files.read.map((permissionPath) =>
          resolveSelectedSkillPermissionPath(
            permissionPath,
            skill,
            goal.selectedSkillInputValues,
          ),
        ),
      ]),
      extraWriteRoots: uniqueStrings([
        ...runContext.sandbox.extraWriteRoots,
        ...skill.manifest.permissions.files.write.map((permissionPath) =>
          resolveSelectedSkillPermissionPath(
            permissionPath,
            skill,
            goal.selectedSkillInputValues,
          ),
        ),
      ]),
    },
  };
}

function resolveSelectedSkillPermissionPath(
  permissionPath: string,
  skill: NonNullable<Goal["selectedSkill"]>,
  values?: Goal["selectedSkillInputValues"],
): string {
  const withSkillPaths = permissionPath
    .replaceAll("{{skillRoot}}", skill.rootDir)
    .replaceAll("{{skillDir}}", skill.rootDir);
  return withSkillPaths.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (match, name) => {
    const value = values?.[name];
    return value === undefined ? match : String(value);
  });
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function extractArtifactEvidence(
  result: Awaited<ReturnType<AgentToolExecutor["execute"]>>,
): {
  toolResultPayload: Record<string, unknown>;
  artifacts: Record<string, unknown>[];
} {
  if (!result.ok) {
    return { toolResultPayload: {}, artifacts: [] };
  }

  const artifactRefs = buildArtifactCreatedPayloads(result.result);
  const toolResultPayload = pickKnownArtifactResultFields(result.result);
  return {
    toolResultPayload,
    artifacts: artifactRefs,
  };
}

function buildArtifactCreatedPayloads(
  result: Record<string, unknown>,
): Record<string, unknown>[] {
  const artifacts: Record<string, unknown>[] = [];
  appendArtifactCreatedPayload(artifacts, {
    artifactRef: readString(result.artifactRef),
    artifactPath: readString(result.artifactPath),
    provenanceRef: readString(result.provenanceRef),
    provenancePath: readString(result.provenancePath),
  });
  appendArtifactCreatedPayload(artifacts, {
    artifactRef: readString(result.goalEvidenceRef),
    artifactPath: readString(result.goalEvidencePath),
    provenanceRef: readString(result.goalEvidenceProvenanceRef),
    provenancePath: readString(result.goalEvidenceProvenancePath),
  });
  return artifacts;
}

function appendArtifactCreatedPayload(
  artifacts: Record<string, unknown>[],
  input: {
    artifactRef: string | null;
    artifactPath: string | null;
    provenanceRef: string | null;
    provenancePath: string | null;
  },
) {
  if (!input.artifactRef) {
    return;
  }
  artifacts.push({
    artifactId: artifactIdFromRef(input.artifactRef),
    artifactRef: input.artifactRef,
    ...(input.artifactPath ? { artifactPath: input.artifactPath } : {}),
    ...(input.provenanceRef ? { provenanceRef: input.provenanceRef } : {}),
    ...(input.provenancePath ? { provenancePath: input.provenancePath } : {}),
  });
}

function pickKnownArtifactResultFields(
  result: Record<string, unknown>,
): Record<string, unknown> {
  const keys = [
    "artifactRef",
    "artifactPath",
    "provenanceRef",
    "provenancePath",
    "goalEvidenceRef",
    "goalEvidencePath",
    "goalEvidenceProvenanceRef",
    "goalEvidenceProvenancePath",
    "evidenceRefs",
  ];
  const payload: Record<string, unknown> = {};
  for (const key of keys) {
    if (result[key] !== undefined) {
      payload[key] = result[key];
    }
  }
  return payload;
}

function artifactIdFromRef(ref: string): string {
  return ref.startsWith("artifact:") ? ref.slice("artifact:".length) : ref;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function buildGoalMilestoneRuntimeTask(
  goal: Goal,
  runContext: AgentRunContext,
): RuntimeToolAuthorizationTask {
  return {
    name: `Goal milestone: ${goal.description}`,
    policyLabel: "goal milestone runtime policy",
    permissions: buildGoalMilestonePermissionPolicy(goal, runContext),
  };
}

function buildGoalMilestonePermissionPolicy(
  goal: Goal,
  runContext: AgentRunContext,
): TaskPermissionPolicy {
  const selectedSkill = goal.selectedSkill;
  const readRoots = [
    runContext.workspaceRoot,
    ...runContext.sandbox.extraReadRoots,
    ...getDeterministicGoalPipelineReadRoots(goal.taskContract, runContext),
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
      read: uniqueStrings(readRoots),
      write: uniqueStrings(writeRoots),
    },
    web: {
      search: runContext.sandbox.network !== "none",
      fetchDomains: selectedSkill?.manifest.permissions.web.fetchDomains ?? [],
    },
    shell: {
      commands: uniqueStrings([
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
        ...(selectedSkill?.manifest.permissions.shell.commands ?? []),
      ]),
    },
    memory: {
      read: true,
      write: false,
    },
    ...(selectedSkill
      ? {
          tools: {
            allowedNames: uniqueStrings([
              "skill_resource_list",
              "skill_load",
              ...(selectedSkill.manifest.tools?.map((tool) => tool.name) ?? []),
            ]),
            allowedSkillNames: [selectedSkill.manifest.name],
            allowedSources: [
              ...(selectedSkill.manifest.tools?.length
                ? [`skill:${selectedSkill.manifest.name}`]
                : []),
              ...(selectedSkill.manifest.mcpServers?.map(
                (server) => `mcp:${selectedSkill.manifest.name}:${server.name}`,
              ) ?? []),
            ],
          },
        }
      : {}),
  };
}

function buildGoalSystemPrompt(modelId?: string, currentDate?: string): string {
  return getSystemPromptAssembler().assemble({
    modelId,
    currentDate,
    mode: "goal",
  }).prompt;
}

function buildMilestoneInstruction(
  goal: Goal,
  milestone: Milestone,
  runContext: AgentRunContext,
  repairDirective?: AcceptanceRepairDirective,
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
    `Workspace root: ${runContext.workspaceRoot}`,
    "工具使用约束：所有 file_list/file_read/file_search/code_search/git_status/git_diff/test_run 调用都必须使用上述 workspace root 或其内部路径；不要猜测、改写或省略工作区路径。",
    "优先使用 file_list、file_search、file_read、code_search、git_status、git_diff、test_run 等 typed native tools 观察和验证项目；只有这些工具无法完成时才申请 shell_exec。",
    "",
    "本里程碑的验收标准如下，你必须确保每一项验收检查最终通过：",
    ...criteriaLines,
    ...buildSelectedSkillExecutionContract(goal),
    ...artifactContractLines,
    ...buildAcceptanceRepairContract(repairDirective),
    "",
    "请执行这个里程碑。优先产出可追溯证据和阶段性结论。如果验收标准涉及文件路径，请准确创建对应文件。",
  ].join("\n");
}

function buildAcceptanceRepairContract(
  directive?: AcceptanceRepairDirective,
): string[] {
  if (!directive) {
    return [];
  }

  return [
    "",
    "BEGIN ACCEPTANCE REPAIR DIRECTIVE",
    `Failed check ids: ${directive.failedCheckIds.join(", ") || "none"}`,
    `Occurrence: ${directive.occurrence}`,
    `Fingerprint: ${directive.fingerprint.slice(0, 12)}`,
    ...directive.instructions.map((instruction) => `- ${instruction}`),
    ...(directive.occurrence === 2
      ? [
          "- Occurrence 2 requires a materially different strategy and materially different tool arguments; do not repeat the prior failed approach.",
        ]
      : []),
    "END ACCEPTANCE REPAIR DIRECTIVE",
  ];
}

function buildSelectedSkillExecutionContract(goal: Goal): string[] {
  const skill = goal.selectedSkill;
  if (!skill) {
    return [];
  }

  return [
    "",
    "Selected skill execution contract:",
    `Skill: ${skill.manifest.name} (${skill.manifest.displayName})`,
    `Description: ${skill.manifest.description}`,
    `Skill file: ${skill.skillFile}`,
    "你必须按这个 selected skill 的正文执行；不得把技能正文当作可选参考，也不得在最终交付前跳过技能要求的验证或输出格式。",
    "Selected skill body:",
    "```markdown",
    skill.body.trim() || "(技能正文为空)",
    "```",
  ];
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
    `目标：${goal.originalDescription ?? goal.description}`,
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
  if (
    typeof loopResult.tokensConsumed === "number" &&
    loopResult.tokensConsumed > 0
  ) {
    return loopResult.tokensConsumed;
  }
  if (typeof loopResultWithTokens.tokens === "number") {
    return loopResultWithTokens.tokens;
  }

  return Math.max(1, estimateMessageTokens(initialMessages));
}

function toBoundedTranscriptMessages(
  messages: ChatMessage[],
  finalSummary?: string,
): ChatMessage[] {
  const transcriptMessages = finalSummary
    ? [...messages, { role: "assistant" as const, content: finalSummary }]
    : messages;
  return boundRuntimeTranscript(transcriptMessages);
}
