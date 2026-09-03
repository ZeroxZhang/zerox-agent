import { formatAgentRunSessionStatus } from "./helpers";
import { formatAgentRunSessionPrompt } from "./helpers";
import { OpenAgentRunSessionResult } from "../../shared/agentRuns";
import { isTerminalExecutionStatus } from "../../shared/agentExecution";
import { PauseAgentRunResult } from "../../shared/agentRuns";
import { createConversationRequestFingerprint } from "../../shared/conversationCausalSpine";
import { AgentRunRevisionConflictError } from "../../shared/agentRuns";
import { formatScheduledTaskRunResult } from "./helpers";
import { formatScheduledTaskRunPrompt } from "./helpers";
import { ScheduledTask } from "../../shared/scheduledTasks";
import { AgentRunAdmissionCandidate } from "../../shared/agentRuns";
import { AgentRunEvent } from "../../shared/agentRuns";
import { RunScheduledTaskResult } from "../../shared/agentRuns";
import type { AgentRunsChangedEvent } from "../container";
import { createAgentExecutionStore } from "../agentExecutionStore";
import { createAgentRunStore } from "../agentRunStore";
import { createAgentRunnerService } from "../agentRunnerService";
import { createChatSessionStore } from "../chatSessionStore";
import { createConversationCausalStore } from "../conversationCausalStore";
import { createScheduledTaskStore } from "../taskStore";

type RunAgentTaskOptions = {
  sessionId?: string;
  writeChatTranscript?: boolean;
  beforeExecution?: import("../../shared/agentRuns").AgentRunAdmissionGate;
};

export type TaskRunRuntime = {
  agentExecutionStore: () => ReturnType<typeof createAgentExecutionStore>;
  agentRunStore: () => ReturnType<typeof createAgentRunStore>;
  agentRunnerService: () => ReturnType<typeof createAgentRunnerService>;
  agentWorkspaceService: () => { resolveRunContext(input: { workspaceId?: string; sessionId?: string }): Promise<{ workspaceRoot?: string } | null>; };
  chatSessionStore: () => ReturnType<typeof createChatSessionStore>;
  conversationCausalStore: () => ReturnType<typeof createConversationCausalStore>;
  scheduledTaskStore: () => ReturnType<typeof createScheduledTaskStore>;
  activeTaskRunControllers: () => Map<string, AbortController>;
  activeTaskRunCompletions: () => Map<string, Promise<void>>;
  executionReservations: () => Set<string>;
  emitAgentRunsChanged: (event: Omit<AgentRunsChangedEvent, "createdAt">) => void;
  trackRuntimeInvocation: <T>(operation: () => Promise<T>) => Promise<T>;
  runtimeShuttingDown: () => boolean;
};

export function createTaskRunRuntime(rt: TaskRunRuntime) {
  const agentExecutionStore = rt.agentExecutionStore;
  const agentRunStore = rt.agentRunStore;
  const agentRunnerService = rt.agentRunnerService;
  const agentWorkspaceService = rt.agentWorkspaceService;
  const chatSessionStore = rt.chatSessionStore;
  const conversationCausalStore = rt.conversationCausalStore;
  const scheduledTaskStore = rt.scheduledTaskStore;
  const activeTaskRunControllers = rt.activeTaskRunControllers();
  const activeTaskRunCompletions = rt.activeTaskRunCompletions();
  const executionReservations = rt.executionReservations();
  const emitAgentRunsChanged = rt.emitAgentRunsChanged;
  const trackRuntimeInvocation = rt.trackRuntimeInvocation;
  const runtimeShuttingDown = rt.runtimeShuttingDown;
  function runAgentTask(
    taskId: string,
    runOptions?: RunAgentTaskOptions,
  ): Promise<RunScheduledTaskResult> {
    if (runtimeShuttingDown()) {
      return Promise.resolve({
        ok: false,
        message: "应用正在退出，未启动新的任务运行。",
      });
    }
    const reservation = `task:${taskId}`;
    if (executionReservations.has(reservation)) {
      return Promise.resolve({
        ok: false,
        message: "这个任务已经在运行中。",
      });
    }
    executionReservations.add(reservation);
    const invocation = trackRuntimeInvocation(() =>
      runAgentTaskAccepted(taskId, runOptions),
    );
    void invocation.then(
      () => executionReservations.delete(reservation),
      () => executionReservations.delete(reservation),
    );
    return invocation;
  }

  async function* runAgentTaskStreaming(
    taskId: string,
  ): AsyncIterable<AgentRunEvent> {
    if (runtimeShuttingDown()) {
      yield {
        level: "error",
        message: "应用正在退出，未启动新的任务运行。",
        createdAt: new Date().toISOString(),
      };
      return;
    }
    const reservation = `task:${taskId}`;
    if (
      executionReservations.has(reservation) ||
      activeTaskRunControllers.has(taskId)
    ) {
      yield {
        level: "error",
        message: "这个任务已经在运行中。",
        createdAt: new Date().toISOString(),
      };
      return;
    }

    executionReservations.add(reservation);
    const controller = new AbortController();
    let settleCompletion: (() => void) | undefined;
    let admittedCandidate: AgentRunAdmissionCandidate | undefined;
    const completion = new Promise<void>((resolve) => {
      settleCompletion = resolve;
    });

    try {
      for await (const event of agentRunnerService().runTaskStreaming(taskId, {
        signal: controller.signal,
        onExecutionAdmitted(candidate) {
          if (candidate.taskId !== taskId) {
            throw new Error("AgentRun admission callback task identity changed.");
          }
          admittedCandidate = candidate;
          activeTaskRunControllers.set(taskId, controller);
          activeTaskRunCompletions.set(taskId, completion);
          emitAgentRunsChanged({
            reason: "active_execution_changed",
            runId: candidate.runId,
            taskId,
          });
        },
      })) {
        yield event;
      }
    } finally {
      if (!controller.signal.aborted) {
        controller.abort("stream_consumer_detached");
      }
      executionReservations.delete(reservation);
      if (admittedCandidate && activeTaskRunControllers.get(taskId) === controller) {
        activeTaskRunControllers.delete(taskId);
      }
      if (admittedCandidate) settleCompletion?.();
      if (admittedCandidate && activeTaskRunCompletions.get(taskId) === completion) {
        activeTaskRunCompletions.delete(taskId);
      }
      if (admittedCandidate) {
        emitAgentRunsChanged({
          reason: "active_execution_changed",
          runId: admittedCandidate.runId,
          taskId,
        });
      }
    }
  }

  async function runAgentTaskAccepted(
    taskId: string,
    runOptions?: RunAgentTaskOptions,
  ): Promise<RunScheduledTaskResult> {
    if (activeTaskRunControllers.has(taskId)) {
      return {
        ok: false,
        message: "这个任务已经在运行中。",
      };
    }

    const task = await scheduledTaskStore().get(taskId);
    if (runtimeShuttingDown()) {
      return { ok: false, message: "应用正在退出，任务运行已取消。" };
    }
    if (!task) {
      return {
        ok: false,
        message: "Scheduled task was not found.",
      };
    }

    const sessionId = await resolveTaskRunSessionId(task, runOptions);
    if (runtimeShuttingDown()) {
      return { ok: false, message: "应用正在退出，任务运行已取消。" };
    }
    const controller = new AbortController();
    let settleCompletion: (() => void) | undefined;
    let admittedCandidate: AgentRunAdmissionCandidate | undefined;
    const completion = new Promise<void>((resolve) => {
      settleCompletion = resolve;
    });

    try {
      const result = await agentRunnerService().runTask(taskId, {
        signal: controller.signal,
        ...(sessionId ? { sessionId } : {}),
        ...(runOptions?.beforeExecution
          ? { beforeExecution: runOptions.beforeExecution }
          : {}),
        onExecutionAdmitted(candidate) {
          if (candidate.taskId !== taskId) {
            throw new Error("AgentRun admission callback task identity changed.");
          }
          admittedCandidate = candidate;
          activeTaskRunControllers.set(taskId, controller);
          activeTaskRunCompletions.set(taskId, completion);
          emitAgentRunsChanged({
            reason: "active_execution_changed",
            runId: candidate.runId,
            taskId,
          });
        },
      });
      if (sessionId && shouldWriteTaskRunTranscript(runOptions)) {
        await appendTaskRunChatResult(sessionId, result);
      }
      emitAgentRunsChanged({
        reason: "run_updated",
        taskId,
        ...(result.ok ? { runId: result.run.id } : {}),
      });
      return result;
    } finally {
      if (admittedCandidate && activeTaskRunControllers.get(taskId) === controller) {
        activeTaskRunControllers.delete(taskId);
      }
      if (admittedCandidate) settleCompletion?.();
      if (admittedCandidate && activeTaskRunCompletions.get(taskId) === completion) {
        activeTaskRunCompletions.delete(taskId);
      }
      if (admittedCandidate) {
        emitAgentRunsChanged({
          reason: "active_execution_changed",
          runId: admittedCandidate.runId,
          taskId,
        });
      }
    }
  }

  async function resolveTaskRunSessionId(
    task: ScheduledTask,
    runOptions: RunAgentTaskOptions | undefined,
  ): Promise<string | undefined> {
    if (runOptions?.sessionId) {
      return runOptions.sessionId;
    }

    if (!shouldWriteTaskRunTranscript(runOptions)) {
      return undefined;
    }

    const created = await chatSessionStore().appendMessage({
      role: "user",
      content: formatScheduledTaskRunPrompt(task),
    });
    return created.session.id;
  }

  function shouldWriteTaskRunTranscript(
    runOptions: RunAgentTaskOptions | undefined,
  ): boolean {
    return runOptions?.writeChatTranscript ?? !runOptions?.sessionId;
  }

  async function appendTaskRunChatResult(
    sessionId: string,
    result: RunScheduledTaskResult,
  ): Promise<void> {
    await chatSessionStore().appendMessage({
      sessionId,
      role: "assistant",
      content: formatScheduledTaskRunResult(result),
      ...(result.ok ? { executedRunId: result.run.id } : {}),
    });
  }

  function resumeAgentRun(runId: string): Promise<RunScheduledTaskResult> {
    if (runtimeShuttingDown()) {
      return Promise.resolve({
        ok: false,
        message: "应用正在退出，未恢复任务运行。",
      });
    }
    const runReservation = `run:${runId}`;
    if (executionReservations.has(runReservation)) {
      return Promise.resolve({ ok: false, message: "这个运行已经在恢复中。" });
    }
    executionReservations.add(runReservation);
    const reservations = [runReservation];
    const invocation = trackRuntimeInvocation(() =>
      resumeAgentRunAccepted(runId, reservations),
    );
    void invocation.then(
      () => reservations.forEach((reservation) => executionReservations.delete(reservation)),
      () => reservations.forEach((reservation) => executionReservations.delete(reservation)),
    );
    return invocation;
  }

  async function resumeAgentRunAccepted(
    runId: string,
    reservations: string[],
  ): Promise<RunScheduledTaskResult> {
    const checkpoint = await agentExecutionStore().get(runId);
    if (runtimeShuttingDown()) {
      return { ok: false, message: "应用正在退出，任务恢复已取消。" };
    }

    if (!checkpoint) {
      return {
        ok: false,
        message: "运行检查点不存在，无法恢复。",
      };
    }

    const taskReservation = `task:${checkpoint.taskId}`;
    if (
      executionReservations.has(taskReservation) ||
      activeTaskRunControllers.has(checkpoint.taskId)
    ) {
      return {
        ok: false,
        message: "这个任务已经在运行中。",
      };
    }
    executionReservations.add(taskReservation);
    reservations.push(taskReservation);

    const controller = new AbortController();
    let settleCompletion: (() => void) | undefined;
    let admittedCandidate: AgentRunAdmissionCandidate | undefined;
    const completion = new Promise<void>((resolve) => {
      settleCompletion = resolve;
    });

    try {
      const result = await agentRunnerService().resumeRun(runId, {
        signal: controller.signal,
        async beforeExecution(candidate) {
          if (!candidate.executionEnvelope) {
            throw new AgentRunRevisionConflictError();
          }
          const executionEnvelopeFingerprint =
            createConversationRequestFingerprint(candidate.executionEnvelope);
          const begun = await conversationCausalStore().beginAgentRunResume({
            runId: candidate.runId,
            taskId: candidate.taskId,
            executionEnvelopeFingerprint,
          });
          if (begun.disposition === "not_found") {
            throw new AgentRunRevisionConflictError();
          }
          if (begun.disposition !== "applied" || !begun.value) {
            throw new AgentRunRevisionConflictError();
          }
          const claim = begun.value;
          if (
            claim.executionEnvelopeFingerprint
              !== executionEnvelopeFingerprint
          ) {
            throw new AgentRunRevisionConflictError();
          }
          return {
            runId: claim.runId,
            taskId: claim.taskId,
            executionRevision: claim.executionRevision,
            executionEnvelope: candidate.executionEnvelope,
            async settle(status, expectedExecutionRevision) {
              if (expectedExecutionRevision !== claim.executionRevision) {
                throw new AgentRunRevisionConflictError();
              }
              const finalStatus = status === "waiting_for_approval"
                ? "paused"
                : status;
              if (
                finalStatus !== "succeeded"
                && finalStatus !== "paused"
                && finalStatus !== "failed"
                && finalStatus !== "canceled"
              ) {
                throw new AgentRunRevisionConflictError();
              }
              const settled = await conversationCausalStore()
                .settleAgentRunAdmission({
                  requestId: claim.requestId,
                  runId: claim.runId,
                  expectedExecutionRevision,
                  state: "settled",
                  finalStatus,
                });
              if (
                settled.disposition !== "applied"
                && settled.disposition !== "duplicate"
              ) {
                throw new AgentRunRevisionConflictError();
              }
            },
          };
        },
        onExecutionAdmitted(candidate) {
          if (
            candidate.runId !== runId
            || candidate.taskId !== checkpoint.taskId
          ) {
            throw new AgentRunRevisionConflictError();
          }
          admittedCandidate = candidate;
          activeTaskRunControllers.set(checkpoint.taskId, controller);
          activeTaskRunCompletions.set(checkpoint.taskId, completion);
          emitAgentRunsChanged({
            reason: "active_execution_changed",
            runId,
            taskId: checkpoint.taskId,
          });
        },
      });
      emitAgentRunsChanged({
        reason: "run_updated",
        runId: result.ok ? result.run.id : runId,
        taskId: checkpoint.taskId,
      });
      return result;
    } finally {
      if (
        admittedCandidate
        && activeTaskRunControllers.get(checkpoint.taskId) === controller
      ) {
        activeTaskRunControllers.delete(checkpoint.taskId);
      }
      if (admittedCandidate) settleCompletion?.();
      if (
        admittedCandidate
        && activeTaskRunCompletions.get(checkpoint.taskId) === completion
      ) {
        activeTaskRunCompletions.delete(checkpoint.taskId);
      }
      if (admittedCandidate) {
        emitAgentRunsChanged({
          reason: "active_execution_changed",
          runId,
          taskId: checkpoint.taskId,
        });
      }
    }
  }

  async function pauseAgentRun(runId: string): Promise<PauseAgentRunResult> {
    const checkpoint = await agentExecutionStore().get(runId);

    if (!checkpoint) {
      return {
        ok: false,
        message: "运行检查点不存在，无法暂停。",
      };
    }

    if (isTerminalExecutionStatus(checkpoint.status)) {
      return {
        ok: false,
        message: "运行已结束，无法暂停。",
      };
    }

    const controller = activeTaskRunControllers.get(checkpoint.taskId);
    if (controller) {
      controller.abort("pause");
      return {
        ok: true,
        message: "已请求暂停运行。",
      };
    }

    await agentExecutionStore().save({
      ...checkpoint,
      status: "paused",
      updatedAt: new Date().toISOString(),
    });
    emitAgentRunsChanged({
      reason: "active_execution_changed",
      runId,
      taskId: checkpoint.taskId,
    });

    return {
      ok: true,
      message: "运行已标记为可恢复。",
    };
  }

  async function openAgentRunSession(
    runId: string,
  ): Promise<OpenAgentRunSessionResult> {
    const [run, checkpoint] = await Promise.all([
      agentRunStore().get(runId),
      agentExecutionStore().get(runId),
    ]);

    if (!run && !checkpoint) {
      return {
        ok: false,
        message: "运行记录不存在，无法打开会话。",
      };
    }

    const existingSessionId =
      run?.runContext?.sessionId ?? checkpoint?.runContext?.sessionId;
    if (existingSessionId) {
      const session = await chatSessionStore().get(existingSessionId);
      if (session) {
        return { ok: true, sessionId: existingSessionId };
      }
    }

    const taskId = checkpoint?.taskId ?? run?.taskId;
    const task = taskId ? await scheduledTaskStore().get(taskId) : null;
    const created = await chatSessionStore().appendMessage({
      role: "user",
      content: formatAgentRunSessionPrompt(task, run, checkpoint),
    });
    await chatSessionStore().appendMessage({
      sessionId: created.session.id,
      role: "assistant",
      content: formatAgentRunSessionStatus(task, run, checkpoint),
      ...(run ? { executedRunId: run.id } : {}),
    });

    if (checkpoint) {
      const runContext = checkpoint.runContext
        ? { ...checkpoint.runContext, sessionId: created.session.id }
        : ((await agentWorkspaceService().resolveRunContext({
            sessionId: created.session.id,
          })) as never);
      await agentExecutionStore().save({
        ...checkpoint,
        runContext,
        updatedAt: new Date().toISOString(),
      });
      emitAgentRunsChanged({
        reason: "active_execution_changed",
        runId: checkpoint.runId,
        taskId: checkpoint.taskId,
      });
    }

    return { ok: true, sessionId: created.session.id };
  }

  return {
    runAgentTask,
    runAgentTaskStreaming,
    runAgentTaskAccepted,
    resolveTaskRunSessionId,
    shouldWriteTaskRunTranscript,
    appendTaskRunChatResult,
    resumeAgentRun,
    resumeAgentRunAccepted,
    pauseAgentRun,
    openAgentRunSession,
  };
}
