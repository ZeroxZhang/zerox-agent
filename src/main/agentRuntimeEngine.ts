import { randomUUID } from "node:crypto";
import type { AgentExecutionStore } from "./agentExecutionStore";
import { classifyAgentFailure } from "./agentFailureClassifier";
import type { AgentRunStore } from "./agentRunStore";
import type { AgentToolExecutor } from "./agentToolExecutor";
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
  serializeToolObservation,
} from "../shared/agentProtocol";
import type {
  AgentExecutionCheckpoint,
  AgentExecutionMessage,
  AgentExecutionStatus,
  AgentExecutionStep,
} from "../shared/agentExecution";
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
  createId?: () => string;
  now?: () => Date;
}): AgentRuntimeEngine {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

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
    await options.executionStore.save(updated);
    return updated;
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
      summary: input.summary,
      events: input.events,
      checkpointId: checkpoint.id,
      ...(failureClass ? { failureClass } : {}),
      ...(failureMessage ? { failureMessage } : {}),
      startedAt: input.startedAt,
      finishedAt,
    };

    await options.runStore.append(run);
    await options.taskStore.recordRun(input.taskId, new Date(finishedAt));

    return { ok: true, run };
  }

  async function runFromCheckpoint(
    checkpoint: AgentExecutionCheckpoint,
    task: { id: string; name: string; skillName: string },
    skill: SkillRecord,
    signal: AbortSignal | undefined,
    events: AgentRunEvent[],
    startedAt: string,
  ): Promise<RunScheduledTaskResult> {
    let current = await saveCheckpoint(checkpoint, "running");
    let messages: ChatMessage[] = current.messages.map(toChatMessage);
    let toolCallCount = current.toolCallCount;
    const profile = await options.getModelProfile();
    const maxTurns = skill.manifest.execution.maxTurns ?? 10;
    const toolDefinitions = getToolDefinitions(options.toolExecutor);

    for (let turn = 0; turn < maxTurns; turn += 1) {
      throwIfCanceled(signal);
      const response = await options.chatClient.complete({
        ...profile,
        messages,
        tools: toolDefinitions,
        tool_choice: "auto",
        ...(signal ? { signal } : {}),
      });

      if (!response.toolCalls.length && response.content) {
        current = {
          ...current,
          messages: messages.map(toExecutionMessage),
          toolCallCount,
        };
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
        const auth = await options.toolAuthorizationService.authorize(task.id, {
          toolName,
          args,
        });
        if (!auth.ok || !auth.decision.allowed) {
          const reason = auth.ok ? auth.decision.reason : auth.message;
          throw new Error(`工具调用被拒绝：${reason}`);
        }

        const result = await options.toolExecutor.execute({ toolName, args });
        toolCallCount += 1;
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: serializeToolObservation({
            tool: toolName,
            ok: result.ok,
            ...(result.ok
              ? { result: result.result }
              : { error: result.error }),
            toolCallId: toolCall.id,
          }),
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
        currentStepId: step.id,
        steps: [step],
        messages: [
          { role: "system", content: buildAgentSystemPrompt() },
          { role: "user", content: buildTaskPrompt(task, skill) },
        ],
        toolCallCount: 0,
        createdAt: startedAt,
        updatedAt: startedAt,
      };

      await options.executionStore.save(checkpoint);

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
        if (isCancellationError(error, runOptions?.signal)) {
          return finishRun({
            checkpoint,
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
        return finishRun({
          checkpoint,
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
    throw new Error("Agent run canceled.");
  }
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
