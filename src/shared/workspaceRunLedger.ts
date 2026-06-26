export type WorkspaceRunStatus =
  | "queued"
  | "running"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "paused"
  | "succeeded"
  | "failed"
  | "canceled";

export type WorkspaceRunTerminalStatus = Extract<
  WorkspaceRunStatus,
  "succeeded" | "failed" | "canceled"
>;

export type WorkspaceRun = {
  workspaceRunId: string;
  sessionId: string;
  requestId: string;
  workspaceId?: string;
  workspaceRoot?: string;
  selectedSkillName?: string;
  status: WorkspaceRunStatus;
  summary?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export type WorkspaceRunEventType =
  | "model_request"
  | "reasoning"
  | "tool_call"
  | "tool_invocation"
  | "tool_result"
  | "tool_denied"
  | "skill_stage"
  | "checkpoint_boundary"
  | "memory_scope"
  | "history"
  | "status"
  | "summary";

type WorkspaceRunEventBase = {
  id: string;
  workspaceRunId: string;
  sessionId: string;
  requestId: string;
  workspaceId?: string;
  seq: number;
  type: WorkspaceRunEventType;
  message?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

export type WorkspaceRunModelRequestEvent = WorkspaceRunEventBase & {
  type: "model_request";
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
};

export type WorkspaceRunReasoningEvent = WorkspaceRunEventBase & {
  type: "reasoning";
  content?: string;
};

export type WorkspaceRunToolCallEvent = WorkspaceRunEventBase & {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  args?: unknown;
};

export type WorkspaceRunToolResultEvent = WorkspaceRunEventBase & {
  type: "tool_result";
  toolCallId: string;
  toolName?: string;
  ok?: boolean;
  resultRef?: string;
  resultPreview?: string;
  resultBytes?: number;
};

export type WorkspaceRunToolInvocationEvent = WorkspaceRunEventBase & {
  type: "tool_invocation";
  toolInvocationId: string;
  toolCallId: string;
  toolName: string;
  toolSource?: string;
  invocationStatus: string;
  args?: unknown;
  ok?: boolean;
  resultRef?: string;
  error?: string;
};

export type WorkspaceRunToolDeniedEvent = WorkspaceRunEventBase & {
  type: "tool_denied";
  toolCallId?: string;
  toolName: string;
  reason: string;
};

export type WorkspaceRunSkillStageEvent = WorkspaceRunEventBase & {
  type: "skill_stage";
  skillName?: string;
  stage: string;
};

export type WorkspaceRunCheckpointBoundaryEvent = WorkspaceRunEventBase & {
  type: "checkpoint_boundary";
  checkpointId: string;
  strategy: "summarize" | "rebuild" | "boundary" | string;
  preservedTailMessages?: number;
  protectedToolResults?: string[];
};

export type WorkspaceRunMemoryScopeEvent = WorkspaceRunEventBase & {
  type: "memory_scope";
  scopes: string[];
  rawHistoryEnabled?: boolean;
  recallBudgetTokens?: number;
};

export type WorkspaceRunHistoryEvent = WorkspaceRunEventBase & {
  type: "history";
  operation: "indexed" | "searched" | "around";
  query?: string;
  resultCount?: number;
  historyRef?: string;
};

export type WorkspaceRunStatusEvent = WorkspaceRunEventBase & {
  type: "status";
  status: WorkspaceRunStatus;
};

export type WorkspaceRunSummaryEvent = WorkspaceRunEventBase & {
  type: "summary";
  summary: string;
};

export type WorkspaceRunEvent =
  | WorkspaceRunModelRequestEvent
  | WorkspaceRunReasoningEvent
  | WorkspaceRunToolCallEvent
  | WorkspaceRunToolInvocationEvent
  | WorkspaceRunToolResultEvent
  | WorkspaceRunToolDeniedEvent
  | WorkspaceRunSkillStageEvent
  | WorkspaceRunCheckpointBoundaryEvent
  | WorkspaceRunMemoryScopeEvent
  | WorkspaceRunHistoryEvent
  | WorkspaceRunStatusEvent
  | WorkspaceRunSummaryEvent;

type WorkspaceRunEventInputBase = {
  id?: string;
  createdAt?: string;
  message?: string;
  payload?: Record<string, unknown>;
};

export type WorkspaceRunEventInput =
  | (WorkspaceRunEventInputBase & {
      type: "model_request";
      model?: string;
      promptTokens?: number;
      completionTokens?: number;
    })
  | (WorkspaceRunEventInputBase & {
      type: "reasoning";
      content?: string;
    })
  | (WorkspaceRunEventInputBase & {
      type: "tool_call";
      toolCallId: string;
      toolName: string;
      args?: unknown;
    })
  | (WorkspaceRunEventInputBase & {
      type: "tool_invocation";
      toolInvocationId: string;
      toolCallId: string;
      toolName: string;
      toolSource?: string;
      invocationStatus: string;
      args?: unknown;
      ok?: boolean;
      resultRef?: string;
      error?: string;
    })
  | (WorkspaceRunEventInputBase & {
      type: "tool_result";
      toolCallId: string;
      toolName?: string;
      ok?: boolean;
      resultRef?: string;
      resultPreview?: string;
      resultBytes?: number;
    })
  | (WorkspaceRunEventInputBase & {
      type: "tool_denied";
      toolCallId?: string;
      toolName: string;
      reason: string;
    })
  | (WorkspaceRunEventInputBase & {
      type: "skill_stage";
      skillName?: string;
      stage: string;
    })
  | (WorkspaceRunEventInputBase & {
      type: "checkpoint_boundary";
      checkpointId: string;
      strategy: "summarize" | "rebuild" | "boundary" | string;
      preservedTailMessages?: number;
      protectedToolResults?: string[];
    })
  | (WorkspaceRunEventInputBase & {
      type: "memory_scope";
      scopes: string[];
      rawHistoryEnabled?: boolean;
      recallBudgetTokens?: number;
    })
  | (WorkspaceRunEventInputBase & {
      type: "history";
      operation: "indexed" | "searched" | "around";
      query?: string;
      resultCount?: number;
      historyRef?: string;
    })
  | (WorkspaceRunEventInputBase & {
      type: "status";
      status: WorkspaceRunStatus;
    })
  | (WorkspaceRunEventInputBase & {
      type: "summary";
      summary: string;
    });

export type ChatTrajectoryEvent = {
  id: string;
  workspaceRunId: string;
  sessionId: string;
  requestId: string;
  workspaceId?: string;
  type: WorkspaceRunEventType;
  sequence: number;
  sourceEventId: string;
  message?: string;
  status?: WorkspaceRunStatus;
  toolCallId?: string;
  toolName?: string;
  resultRef?: string;
  ok?: boolean;
  invocationStatus?: string;
  toolSource?: string;
  skillName?: string;
  skillStage?: string;
  checkpointId?: string;
  memoryScopes?: string[];
  historyOperation?: string;
  summary?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

export function createWorkspaceRunEvent(options: {
  run: WorkspaceRun;
  input: WorkspaceRunEventInput;
  id: string;
  seq: number;
  createdAt: string;
}): WorkspaceRunEvent {
  return {
    ...options.input,
    id: options.id,
    workspaceRunId: options.run.workspaceRunId,
    sessionId: options.run.sessionId,
    requestId: options.run.requestId,
    ...(options.run.workspaceId ? { workspaceId: options.run.workspaceId } : {}),
    seq: options.seq,
    createdAt: options.createdAt,
  } as WorkspaceRunEvent;
}

export function getNextWorkspaceRunEventSeq(
  events: readonly Pick<WorkspaceRunEvent, "seq">[],
): number {
  return events.reduce((maxSeq, event) => Math.max(maxSeq, event.seq), 0) + 1;
}

export function isWorkspaceRunEventSequenceMonotonic(
  events: readonly Pick<WorkspaceRunEvent, "seq">[],
): boolean {
  let previousSeq = 0;
  for (const event of events) {
    if (event.seq <= previousSeq) {
      return false;
    }
    previousSeq = event.seq;
  }

  return true;
}

export function projectChatTrajectoryEvents(
  events: readonly WorkspaceRunEvent[],
): ChatTrajectoryEvent[] {
  return events.map((event) => ({
    id: `chat_trajectory_${event.id}`,
    workspaceRunId: event.workspaceRunId,
    sessionId: event.sessionId,
    requestId: event.requestId,
    ...(event.workspaceId ? { workspaceId: event.workspaceId } : {}),
    type: event.type,
    sequence: event.seq,
    sourceEventId: event.id,
    ...(event.message ? { message: event.message } : {}),
    ...projectStatus(event),
    ...projectTool(event),
    ...projectSkill(event),
    ...projectCheckpointBoundary(event),
    ...projectMemoryScope(event),
    ...projectHistory(event),
    ...projectSummary(event),
    ...(event.payload ? { payload: event.payload } : {}),
    createdAt: event.createdAt,
  }));
}

function projectStatus(
  event: WorkspaceRunEvent,
): Pick<ChatTrajectoryEvent, "status"> {
  return event.type === "status" ? { status: event.status } : {};
}

function projectTool(
  event: WorkspaceRunEvent,
): Pick<ChatTrajectoryEvent, "toolCallId" | "toolName" | "resultRef" | "ok"> {
  if (
    event.type !== "tool_call" &&
    event.type !== "tool_invocation" &&
    event.type !== "tool_result" &&
    event.type !== "tool_denied"
  ) {
    return {};
  }

  return {
    ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
    toolName: event.toolName,
    ...(event.type === "tool_invocation"
      ? {
          invocationStatus: event.invocationStatus,
          ...(event.toolSource ? { toolSource: event.toolSource } : {}),
        }
      : {}),
    ...(event.type === "tool_result" && event.resultRef
      ? { resultRef: event.resultRef }
      : {}),
    ...((event.type === "tool_result" || event.type === "tool_invocation") &&
    typeof event.ok === "boolean"
      ? { ok: event.ok }
      : {}),
    ...((event.type === "tool_result" || event.type === "tool_invocation") &&
    event.resultRef
      ? { resultRef: event.resultRef }
      : {}),
  };
}

function projectSkill(
  event: WorkspaceRunEvent,
): Pick<ChatTrajectoryEvent, "skillName" | "skillStage"> {
  if (event.type !== "skill_stage") {
    return {};
  }

  return {
    ...(event.skillName ? { skillName: event.skillName } : {}),
    skillStage: event.stage,
  };
}

function projectSummary(
  event: WorkspaceRunEvent,
): Pick<ChatTrajectoryEvent, "summary"> {
  return event.type === "summary" ? { summary: event.summary } : {};
}

function projectCheckpointBoundary(
  event: WorkspaceRunEvent,
): Pick<ChatTrajectoryEvent, "checkpointId"> {
  return event.type === "checkpoint_boundary"
    ? { checkpointId: event.checkpointId }
    : {};
}

function projectMemoryScope(
  event: WorkspaceRunEvent,
): Pick<ChatTrajectoryEvent, "memoryScopes"> {
  return event.type === "memory_scope" ? { memoryScopes: event.scopes } : {};
}

function projectHistory(
  event: WorkspaceRunEvent,
): Pick<ChatTrajectoryEvent, "historyOperation"> {
  return event.type === "history" ? { historyOperation: event.operation } : {};
}
