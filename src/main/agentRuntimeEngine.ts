import { randomUUID } from "node:crypto";
import type { AgentExecutionStore } from "./agentExecutionStore";
import { classifyAgentFailure } from "./agentFailureClassifier";
import { extractLearningCandidatesFromTrajectory } from "./agentLearningExtractor";
import type { AgentLearningStore } from "./agentLearningStore";
import {
  appendProceduralMemoryContext,
  buildProceduralMemoryPromptContext,
} from "./agentProceduralMemory";
import type { AgentRunStore } from "./agentRunStore";
import type { AgentToolExecutor } from "./agentToolExecutor";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import type { AgentWorkspaceService } from "./agentWorkspaceService";
import type { MemoryStore } from "./memoryStore";
import type {
  ChatClient,
  ChatMessage,
  ToolDefinition,
} from "./openAiCompatibleClient";
import type { ScheduledTaskStore } from "./taskStore";
import type { ToolAuthorizationService } from "./toolAuthorizationService";
import {
  buildAgentSystemPrompt,
  buildTaskPrompt,
  buildToolDefinitions,
} from "../shared/agentProtocol";
import { serializeToolObservationWithOffload } from "./toolObservationOffload";
import type { ToolResultOffloadStore } from "./toolResultOffloadStore";
import type {
  AgentExecutionCheckpoint,
  AgentExecutionMessage,
  AgentExecutionStatus,
  AgentExecutionStep,
} from "../shared/agentExecution";
import type {
  AgentTrajectoryEvent,
  AgentTrajectoryEventType,
} from "../shared/agentTrajectory";
import type { NativeToolDescriptor } from "../shared/nativeCapabilities";
import type {
  AgentRunEvent,
  AgentRunRecord,
  RunScheduledTaskResult,
} from "../shared/agentRuns";
import type { SkillRecord } from "../shared/skills";
import type { AgentToolName } from "../shared/toolPermissions";

export type AgentRuntimeModelProfile = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
};

export type AgentRuntimeEngine = {
  startTask(
    taskId: string,
    options?: { signal?: AbortSignal },
  ): Promise<RunScheduledTaskResult>;
  resumeRun(
    runId: string,
    options?: { signal?: AbortSignal },
  ): Promise<RunScheduledTaskResult>;
};

export function createAgentRuntimeEngine(options: {
  taskStore: Pick<ScheduledTaskStore, "get" | "recordRun">;
  runStore: AgentRunStore;
  executionStore: AgentExecutionStore;
  resolveSkill: (skillName: string) => Promise<SkillRecord | null>;
  chatClient: ChatClient;
  getModelProfile: () => Promise<AgentRuntimeModelProfile>;
  toolAuthorizationService: ToolAuthorizationService;
  toolExecutor: AgentToolExecutor;
  workspaceService?: Pick<AgentWorkspaceService, "resolveRunContext">;
  trajectoryStore?: AgentTrajectoryStore;
  learningStore?: Pick<AgentLearningStore, "create">;
  memoryStore?: Partial<Pick<MemoryStore, "create" | "search">>;
  toolResultOffloadStore?: ToolResultOffloadStore;
  toolResultOffloadThreshold?: number;
  createId?: () => string;
  now?: () => Date;
}): AgentRuntimeEngine {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  let trajectorySequence = 0;

  function createEvent(
    level: AgentRunEvent["level"],
    message: string,
    data?: Record<string, unknown>,
  ): AgentRunEvent {
    return {
      level,
      message,
      ...(data ? { data } : {}),
      createdAt: now().toISOString(),
    };
  }

  async function saveCheckpoint(
    checkpoint: AgentExecutionCheckpoint,
    status: AgentExecutionStatus,
    updates: Partial<AgentExecutionCheckpoint> = {},
  ): Promise<AgentExecutionCheckpoint> {
    const updated: AgentExecutionCheckpoint = {
      ...checkpoint,
      ...updates,
      status,
      id: createId(),
      updatedAt: now().toISOString(),
    };
    if (checkpoint.status !== status) {
      await appendTrajectory(updated.runId, "state_transition", {
        from: checkpoint.status,
        to: status,
      }, undefined, updated.runContext);
    }
    await options.executionStore.save(updated);
    await appendTrajectory(updated.runId, "checkpoint_written", {
      checkpointId: updated.id,
      status: updated.status,
      currentStepId: updated.currentStepId,
    }, undefined, updated.runContext);
    return updated;
  }

  async function appendTrajectory(
    runId: string,
    type: AgentTrajectoryEventType,
    payload: Record<string, unknown>,
    redaction: AgentTrajectoryEvent["redaction"] | undefined = {
      containsApiKey: false,
      containsFileContent: false,
      containsUserText: false,
    },
    runContext?: AgentTrajectoryEvent["runContext"],
  ) {
    if (!options.trajectoryStore) return;

    trajectorySequence += 1;
    await options.trajectoryStore.append(runId, {
      id: createId(),
      runId,
      type,
      sequence: trajectorySequence,
      ...(runContext ? { runContext } : {}),
      payload,
      redaction: redaction ?? {
        containsApiKey: false,
        containsFileContent: false,
        containsUserText: false,
      },
      createdAt: now().toISOString(),
    });
  }

  async function finishRun(input: {
    checkpoint: AgentExecutionCheckpoint;
    taskId: string;
    taskName: string;
    skillName: string;
    status: AgentRunRecord["status"];
    summary: string;
    events: AgentRunEvent[];
    startedAt: string;
    failure?: unknown;
  }): Promise<RunScheduledTaskResult> {
    const finishedAt = now().toISOString();
    const failureClass = input.failure
      ? classifyAgentFailure(input.failure)
      : undefined;
    const failureMessage = input.failure
      ? formatFailureMessage(input.failure)
      : undefined;
    if (failureClass) {
      await appendTrajectory(input.checkpoint.runId, "failure_classified", {
        failureClass,
        ...(failureMessage ? { failureMessage } : {}),
      });
    }
    const checkpoint = await saveCheckpoint(
      input.checkpoint,
      input.status,
      failureClass || failureMessage
        ? { steps: markCurrentStepFailed(input.checkpoint.steps, failureClass, failureMessage) }
        : undefined,
    );
    const run: AgentRunRecord = {
      id: input.checkpoint.runId,
      taskId: input.taskId,
      taskName: input.taskName,
      skillName: input.skillName,
      status: input.status,
      ...(checkpoint.runContext ? { runContext: checkpoint.runContext } : {}),
      summary: input.summary,
      events: input.events,
      checkpointId: checkpoint.id,
      ...(failureClass ? { failureClass } : {}),
      ...(failureMessage ? { failureMessage } : {}),
      startedAt: input.startedAt,
      finishedAt,
    };

    if (run.status === "succeeded" && options.memoryStore?.create) {
      try {
        await options.memoryStore.create({
          kind: "episodic",
          title: `Run: ${input.taskName}`,
          content: run.summary,
          tags: ["agent-run", input.skillName],
          source: { type: "agent_run", refId: run.id },
          importance: 3,
        });
        run.events.push(
          createEvent("info", "Episodic memory written.", {
            memoryKind: "episodic",
          }),
        );
      } catch (error) {
        run.events.push(
          createEvent("warn", "Unable to write episodic memory.", {
            error:
              error instanceof Error
                ? error.message
                : "Unknown memory error.",
          }),
        );
      }
    }

    await options.runStore.append(run);
    if (input.status !== "paused") {
      await options.taskStore.recordRun(input.taskId, new Date(finishedAt));
    }
    await createLearningCandidates(run);

    return { ok: true, run };
  }

  async function createLearningCandidates(run: AgentRunRecord) {
    if (!options.learningStore || !options.trajectoryStore) {
      return;
    }

    const trajectory = await options.trajectoryStore.list(run.id);
    const candidates = extractLearningCandidatesFromTrajectory(run, trajectory);

    for (const candidate of candidates) {
      await options.learningStore.create(candidate);
    }
  }

  async function runFromCheckpoint(
    checkpoint: AgentExecutionCheckpoint,
    task: { id: string; name: string; skillName: string },
    skill: SkillRecord,
    signal: AbortSignal | undefined,
    events: AgentRunEvent[],
    startedAt: string,
  ): Promise<RunScheduledTaskResult> {
    let current = await saveCheckpoint(checkpoint, "running", {
      steps: markCurrentStepRunning(
        checkpoint.steps,
        checkpoint.currentStepId,
        now().toISOString(),
      ),
    });
    let messages: ChatMessage[] = current.messages.map(toChatMessage);
    let toolCallCount = current.toolCallCount;
    const profile = await options.getModelProfile();
    const maxTurns = skill.manifest.execution.maxTurns ?? 10;
    const toolDefinitions = getToolDefinitions(options.toolExecutor);

    for (let turn = 0; turn < maxTurns; turn += 1) {
      throwIfCanceled(signal);
      await appendTrajectory(current.runId, "model_request", {
        turn,
        messageCount: messages.length,
      }, {
        containsApiKey: false,
        containsFileContent: false,
        containsUserText: true,
      }, current.runContext);
      const response = await options.chatClient.complete({
        ...profile,
        messages,
        tools: toolDefinitions,
        tool_choice: "auto",
        ...(signal ? { signal } : {}),
      });
      await appendTrajectory(current.runId, "model_response", {
        turn,
        hasContent: Boolean(response.content),
        toolCallCount: response.toolCalls.length,
        finishReason: response.finishReason,
      }, {
        containsApiKey: false,
        containsFileContent: false,
        containsUserText: Boolean(response.content),
      }, current.runContext);

      if (!response.toolCalls.length && response.content) {
        current = {
          ...current,
          messages: messages.map(toExecutionMessage),
          toolCallCount,
          steps: markCurrentStepCompleted(
            current.steps,
            current.currentStepId,
            now().toISOString(),
          ),
        };
        await appendTrajectory(current.runId, "final_summary", {
          status: "succeeded",
          summaryLength: response.content.length,
        }, {
          containsApiKey: false,
          containsFileContent: false,
          containsUserText: true,
        }, current.runContext);
        return finishRun({
          checkpoint: current,
          taskId: task.id,
          taskName: task.name,
          skillName: task.skillName,
          status: "succeeded",
          summary: response.content,
          events,
          startedAt,
        });
      }

      if (!response.toolCalls.length) {
        throw new Error("模型未返回有效内容或工具调用。");
      }

      messages.push({
        role: "assistant",
        content: response.content ?? "",
        tool_calls: response.toolCalls,
      });

      for (const toolCall of response.toolCalls) {
        const toolName = toolCall.function.name as AgentToolName;
        const args = parseToolArguments(toolCall.function.arguments);
        await appendTrajectory(current.runId, "tool_call", {
          toolCallId: toolCall.id,
          toolName,
          args,
        }, {
          containsApiKey: false,
          containsFileContent: false,
          containsUserText: true,
        }, current.runContext);
        const auth = await options.toolAuthorizationService.authorize(
          task.id,
          {
            toolName,
            args,
          },
          {
            runContext: current.runContext,
            onApprovalRequested: async () => {
              current = await saveCheckpoint(current, "waiting_for_approval");
            },
            onApprovalResolved: async () => {
              current = await saveCheckpoint(current, "running");
            },
          },
        );
        if (!auth.ok || !auth.decision.allowed) {
          const reason = auth.ok ? auth.decision.reason : auth.message;
          if (/运行沙箱阻止|workspace|workspace_only/i.test(reason)) {
            await appendTrajectory(current.runId, "workspace_escape_denied", {
              toolCallId: toolCall.id,
              toolName,
              reason,
              ...(typeof args.path === "string" ? { path: args.path } : {}),
              ...(typeof args.command === "string"
                ? { command: args.command }
                : {}),
            }, {
              containsApiKey: false,
              containsFileContent: false,
              containsUserText: false,
            }, current.runContext);
          }
          throw new Error(`工具调用被拒绝：${reason}`);
        }

        const nativeDescriptor = getNativeToolDescriptor(
          options.toolExecutor,
          toolName,
        );
        if (nativeDescriptor) {
          await appendTrajectory(current.runId, "native_tool_invocation", {
            toolCallId: toolCall.id,
            ...buildNativeToolEvidencePayload(nativeDescriptor),
          }, {
            containsApiKey: false,
            containsFileContent: false,
            containsUserText: false,
          }, current.runContext);
        }

        const result = await options.toolExecutor.execute(
          { toolName, args },
          {
            runContext: current.runContext,
            ...(signal ? { signal } : {}),
          },
        );
        toolCallCount += 1;
        if (nativeDescriptor) {
          await appendTrajectory(current.runId, "native_tool_observation", {
            toolCallId: toolCall.id,
            ...buildNativeToolEvidencePayload(nativeDescriptor),
            ok: result.ok,
            ...(result.ok
              ? { resultKeys: Object.keys(result.result).slice(0, 10) }
              : { error: result.error }),
          }, {
            containsApiKey: false,
            containsFileContent: false,
            containsUserText: false,
          }, current.runContext);
        }
        const serializedObservation =
          await serializeToolObservationWithOffload({
            tool: toolName,
            ok: result.ok,
            ...(result.ok
              ? { result: result.result }
              : { error: result.error }),
            toolCallId: toolCall.id,
          }, {
            store: options.toolResultOffloadStore,
            thresholdChars: options.toolResultOffloadThreshold,
            runId: current.runId,
          });
        await appendTrajectory(current.runId, "tool_result", {
          toolCallId: toolCall.id,
          toolName,
          ok: result.ok,
          ...(serializedObservation.offloaded
            ? {
                offloaded: true,
                resultRef: serializedObservation.resultRef,
                originalChars: serializedObservation.originalChars,
              }
            : {}),
        }, {
          containsApiKey: false,
          containsFileContent: result.ok && !serializedObservation.offloaded,
          containsUserText: false,
        }, current.runContext);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: serializedObservation.content,
        });

        if (!result.ok) {
          throw new Error(`工具 ${toolName} 执行失败：${result.error}`);
        }
      }

      current = await saveCheckpoint(current, "running", {
        messages: messages.map(toExecutionMessage),
        toolCallCount,
      });
    }

    throw new Error("Agent run reached the maximum turn limit.");
  }

  return {
    async startTask(taskId, runOptions) {
      const task = await options.taskStore.get(taskId);
      if (!task) {
        return { ok: false, message: "Scheduled task was not found." };
      }

      const skill = await options.resolveSkill(task.skillName);
      if (!skill) {
        return { ok: false, message: "Task skill was not found." };
      }

      const startedAt = now().toISOString();
      const runId = createId();
      const events = [createEvent("info", "Agent runtime started.")];
      const runContext = await options.workspaceService?.resolveRunContext();
      const proceduralMemoryContext =
        await buildProceduralMemoryPromptContext({
          memoryStore: options.memoryStore,
          taskName: task.name,
          skillName: task.skillName,
          skillDescription: skill.manifest.description,
        });
      const step: AgentExecutionStep = {
        id: createId(),
        description: task.name,
        expectedOutcome: "Task completes with a final summary.",
        state: "pending",
        attempts: 0,
      };
      let checkpoint: AgentExecutionCheckpoint = {
        id: createId(),
        runId,
        taskId: task.id,
        status: "queued",
        ...(runContext ? { runContext } : {}),
        currentStepId: step.id,
        steps: [step],
        messages: [
          { role: "system", content: buildAgentSystemPrompt() },
          {
            role: "user",
            content: appendProceduralMemoryContext(
              buildTaskPrompt(task, skill),
              proceduralMemoryContext,
            ),
          },
        ],
        toolCallCount: 0,
        createdAt: startedAt,
        updatedAt: startedAt,
      };

      await options.executionStore.save(checkpoint);
      if (runContext) {
        await appendTrajectory(runId, "run_context_created", {
          workspaceId: runContext.workspaceId,
          workspaceRoot: runContext.workspaceRoot,
          agentRole: runContext.agentRole,
          depth: runContext.depth,
          ...(runContext.parentRunId ? { parentRunId: runContext.parentRunId } : {}),
          ...(runContext.sessionId ? { sessionId: runContext.sessionId } : {}),
        }, undefined, runContext);
      }
      await appendTrajectory(runId, "state_transition", {
        from: null,
        to: "queued",
      }, undefined, runContext);
      await appendTrajectory(runId, "checkpoint_written", {
        checkpointId: checkpoint.id,
        status: checkpoint.status,
        currentStepId: checkpoint.currentStepId,
      }, undefined, runContext);

      try {
        return await runFromCheckpoint(
          checkpoint,
          task,
          skill,
          runOptions?.signal,
          events,
          startedAt,
        );
      } catch (error) {
        if (isPauseError(error, runOptions?.signal)) {
          const latestCheckpoint =
            (await options.executionStore.get(runId)) ?? checkpoint;
          return finishRun({
            checkpoint: latestCheckpoint,
            taskId: task.id,
            taskName: task.name,
            skillName: task.skillName,
            status: "paused",
            summary: "运行已暂停。",
            events: [...events, createEvent("warn", "Agent run paused.")],
            startedAt,
          });
        }

        if (isCancellationError(error, runOptions?.signal)) {
          const latestCheckpoint =
            (await options.executionStore.get(runId)) ?? checkpoint;
          return finishRun({
            checkpoint: latestCheckpoint,
            taskId: task.id,
            taskName: task.name,
            skillName: task.skillName,
            status: "canceled",
            summary: "运行已取消。",
            events: [...events, createEvent("warn", "Agent run canceled.")],
            startedAt,
            failure: error,
          });
        }

        return finishRun({
          checkpoint,
          taskId: task.id,
          taskName: task.name,
          skillName: task.skillName,
          status: "failed",
          summary: error instanceof Error ? error.message : "Agent run failed.",
          events: [...events, createEvent("error", formatFailureMessage(error))],
          startedAt,
          failure: error,
        });
      }
    },

    async resumeRun(runId, runOptions) {
      const checkpoint = await options.executionStore.get(runId);
      if (!checkpoint) {
        return { ok: false, message: "Agent execution checkpoint was not found." };
      }

      const task = await options.taskStore.get(checkpoint.taskId);
      if (!task) {
        return { ok: false, message: "Scheduled task was not found." };
      }

      const skill = await options.resolveSkill(task.skillName);
      if (!skill) {
        return { ok: false, message: "Task skill was not found." };
      }

      try {
        return await runFromCheckpoint(
          checkpoint,
          task,
          skill,
          runOptions?.signal,
          [createEvent("info", "Agent runtime resumed.")],
          checkpoint.createdAt,
        );
      } catch (error) {
        if (isPauseError(error, runOptions?.signal)) {
          const latestCheckpoint =
            (await options.executionStore.get(runId)) ?? checkpoint;
          return finishRun({
            checkpoint: latestCheckpoint,
            taskId: task.id,
            taskName: task.name,
            skillName: task.skillName,
            status: "paused",
            summary: "运行已暂停。",
            events: [createEvent("warn", "Agent run paused.")],
            startedAt: checkpoint.createdAt,
          });
        }

        const latestCheckpoint =
          (await options.executionStore.get(runId)) ?? checkpoint;
        return finishRun({
          checkpoint: latestCheckpoint,
          taskId: task.id,
          taskName: task.name,
          skillName: task.skillName,
          status: isCancellationError(error, runOptions?.signal)
            ? "canceled"
            : "failed",
          summary: isCancellationError(error, runOptions?.signal)
            ? "运行已取消。"
            : formatFailureMessage(error),
          events: [createEvent("error", formatFailureMessage(error))],
          startedAt: checkpoint.createdAt,
          failure: error,
        });
      }
    },
  };
}

function getToolDefinitions(toolExecutor: AgentToolExecutor): ToolDefinition[] {
  if ("getRegistry" in toolExecutor) {
    return toolExecutor.getRegistry().getDefinitions();
  }

  return buildToolDefinitions();
}

function getNativeToolDescriptor(
  toolExecutor: AgentToolExecutor,
  toolName: string,
): NativeToolDescriptor | null {
  const maybeExecutor = toolExecutor as Partial<Pick<AgentToolExecutor, "getRegistry">>;
  if (typeof maybeExecutor.getRegistry !== "function") {
    return null;
  }

  return maybeExecutor.getRegistry().getNativeDescriptor(toolName);
}

function buildNativeToolEvidencePayload(
  descriptor: NativeToolDescriptor,
): Record<string, unknown> {
  return {
    toolName: descriptor.id,
    nativeKind: descriptor.kind,
    riskLevel: descriptor.riskLevel,
    permissionScope: descriptor.permissionScope,
    source: "registry",
    label: descriptor.label,
  };
}

function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // handled below
  }

  throw new Error("参数 JSON 解析失败");
}

function throwIfCanceled(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new Error(isPauseSignal(signal) ? "Agent run paused." : "Agent run canceled.");
  }
}

function isPauseSignal(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true && (signal as AbortSignal & { reason?: unknown }).reason === "pause";
}

function isPauseError(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  return (
    isPauseSignal(signal) ||
    (error instanceof Error && /paused/i.test(error.message))
  );
}

function isCancellationError(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  return (
    signal?.aborted ||
    (error instanceof Error && /cancell?ed|abort/i.test(error.message))
  );
}

function formatFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "Agent run failed.");
}

function toExecutionMessage(message: ChatMessage): AgentExecutionMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
  };
}

function toChatMessage(message: AgentExecutionMessage): ChatMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.tool_calls ? { tool_calls: message.tool_calls as ChatMessage["tool_calls"] } : {}),
  };
}

function markCurrentStepRunning(
  steps: AgentExecutionStep[],
  currentStepId: string | undefined,
  startedAt: string,
): AgentExecutionStep[] {
  return steps.map((step) =>
    step.id === currentStepId
      ? {
          ...step,
          state: step.state === "pending" ? "running" : step.state,
          attempts: step.attempts === 0 ? 1 : step.attempts,
          startedAt: step.startedAt ?? startedAt,
        }
      : step,
  );
}

function markCurrentStepCompleted(
  steps: AgentExecutionStep[],
  currentStepId: string | undefined,
  finishedAt: string,
): AgentExecutionStep[] {
  return steps.map((step) =>
    step.id === currentStepId
      ? {
          ...step,
          state: "completed",
          finishedAt,
        }
      : step,
  );
}

function markCurrentStepFailed(
  steps: AgentExecutionStep[],
  failureClass: ReturnType<typeof classifyAgentFailure> | undefined,
  failureMessage: string | undefined,
): AgentExecutionStep[] {
  return steps.map((step) =>
    step.state === "completed"
      ? step
      : {
          ...step,
          state: failureClass ? "failed" : step.state,
          ...(failureClass ? { failureClass } : {}),
          ...(failureMessage ? { failureMessage } : {}),
        },
  );
}
