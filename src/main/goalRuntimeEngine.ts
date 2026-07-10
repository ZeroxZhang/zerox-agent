import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Goal, Milestone } from "../shared/agentGoal";
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
        await appendTrajectory(runId, "run_context_created", {
          ...payload,
          runContext,
          runtimeContextSnapshot,
          runtimeContextSnapshotSummary:
            summarizeAgentRuntimeContextSnapshot(runtimeContextSnapshot),
        }, false);
        const pipelineResult = await executeDeterministicGoalPipeline({
          contract: taskContract,
          runContext,
          async executeTool(
            toolName,
            args,
            deterministicOptions?: DeterministicToolExecutionOptions,
          ) {
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
              await appendTrajectory(runId, "tool_invocation", {
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
                  args,
                },
                {
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
                await appendTrajectory(runId, "tool_result", {
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
                status: "authorized",
                reason: "tool authorization service not configured",
              });
            }

            await appendTrajectory(runId, "tool_call", {
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
                args,
              },
              {
                ...(runOptions?.signal ? { signal: runOptions.signal } : {}),
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
            await appendTrajectory(runId, "tool_result", {
              ...payload,
              toolName,
              ok: result.ok,
              ...artifactEvidence.toolResultPayload,
            });
            for (const artifact of artifactEvidence.artifacts ?? []) {
              await appendTrajectory(runId, "artifact_created", {
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
        const finishedAt = now();
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
        await appendTrajectory(runId, "final_summary", {
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
        await appendTrajectory(runId, "checkpoint_written", {
          ...payload,
          runId,
          status,
        });

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
      await appendTrajectory(runId, "run_context_created", {
        ...payload,
        runContext,
        runtimeContextSnapshot,
        runtimeContextSnapshotSummary:
          summarizeAgentRuntimeContextSnapshot(runtimeContextSnapshot),
      }, false);
      const tokenBudget =
        options.tokenBudget ??
        goal.budget.maxTokens ??
        modelProfile.maxTokens;
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
        modelProfile,
        {
          chatClient: options.chatClient,
          toolExecutor: options.toolExecutor,
          toolAuthorizationService: options.toolAuthorizationService,
          taskId,
          runContext,
          runtimeTask: buildGoalMilestoneRuntimeTask(goal, runContext),
          systemPrompt: buildGoalSystemPrompt(modelProfile.model, startedAt.split("T")[0]),
          maxTurns: options.maxTurns ?? 8,
          tools: options.toolExecutor.getRegistry().getDefinitions(),
          toolResultOffloadStore: options.toolResultOffloadStore,
          toolResultOffloadThreshold: options.toolResultOffloadThreshold,
          pauseOnFailureLoop: true,
          pauseOnStrategyGuard: true,
          pauseOnTurnLimit: true,
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
          onToolInvocation(record) {
            void appendTrajectory(runId, "tool_invocation", {
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
            void appendTrajectory(runId, "tool_result", {
              ...payload,
              toolName,
              ok,
              ...artifactEvidence.toolResultPayload,
            });
            for (const artifact of artifactEvidence.artifacts ?? []) {
              void appendTrajectory(runId, "artifact_created", {
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
            void appendTrajectory(runId, "strategy_guard_triggered", {
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
        transcriptMessages: toBoundedTranscriptMessages(
          loopResult.messages,
          loopResult.summary,
        ),
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

function buildGoalMilestoneRuntimeTask(
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
    "",
    "请执行这个里程碑。优先产出可追溯证据和阶段性结论。如果验收标准涉及文件路径，请准确创建对应文件。",
  ].join("\n");
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

function toBoundedTranscriptMessages(
  messages: ChatMessage[],
  finalSummary?: string,
): ChatMessage[] {
  const maxMessages = 24;
  const maxChars = 4000;
  const transcriptMessages = finalSummary
    ? [...messages, { role: "assistant" as const, content: finalSummary }]
    : messages;
  return transcriptMessages.slice(-maxMessages).map((message) => ({
    ...message,
    content:
      message.content.length > maxChars
        ? `${message.content.slice(0, maxChars)}... [truncated]`
        : message.content,
  }));
}
