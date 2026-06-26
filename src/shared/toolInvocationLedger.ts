export type ToolInvocationStatus =
  | "proposed"
  | "visible"
  | "authorized"
  | "waiting_approval"
  | "running"
  | "completed"
  | "error"
  | "recovered"
  | "aborted";

export type ToolInvocationHistoryEntry = {
  status: ToolInvocationStatus;
  at: string;
  reason?: string;
  ok?: boolean;
  resultRef?: string;
  error?: string;
};

export type ToolInvocationRecord = {
  id: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  source: string;
  args: Record<string, unknown>;
  status: ToolInvocationStatus;
  createdAt: string;
  updatedAt: string;
  ok?: boolean;
  resultRef?: string;
  error?: string;
  history: ToolInvocationHistoryEntry[];
};

export type CreateToolInvocationInput = {
  id: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  source: string;
  args: Record<string, unknown>;
  createdAt: string;
};

export type ToolInvocationTransition = {
  status: Exclude<ToolInvocationStatus, "proposed">;
  at: string;
  reason?: string;
  ok?: boolean;
  resultRef?: string;
  error?: string;
};

export function createToolInvocation(
  input: CreateToolInvocationInput,
): ToolInvocationRecord {
  return {
    ...input,
    status: "proposed",
    updatedAt: input.createdAt,
    history: [{ status: "proposed", at: input.createdAt }],
  };
}

export function transitionToolInvocation(
  record: ToolInvocationRecord,
  transition: ToolInvocationTransition,
): ToolInvocationRecord {
  if (!canTransitionToolInvocation(record.status, transition.status)) {
    throw new Error(
      `Cannot transition tool invocation from ${record.status} to ${transition.status}.`,
    );
  }

  const historyEntry: ToolInvocationHistoryEntry = {
    status: transition.status,
    at: transition.at,
    ...(transition.reason ? { reason: transition.reason } : {}),
    ...(typeof transition.ok === "boolean" ? { ok: transition.ok } : {}),
    ...(transition.resultRef ? { resultRef: transition.resultRef } : {}),
    ...(transition.error ? { error: transition.error } : {}),
  };

  return {
    ...record,
    status: transition.status,
    updatedAt: transition.at,
    ...(typeof transition.ok === "boolean" ? { ok: transition.ok } : {}),
    ...(transition.resultRef ? { resultRef: transition.resultRef } : {}),
    ...(transition.error ? { error: transition.error } : {}),
    history: [...record.history, historyEntry],
  };
}

export function canTransitionToolInvocation(
  from: ToolInvocationStatus,
  to: ToolInvocationStatus,
): boolean {
  if (isTerminalToolInvocationStatus(from)) {
    return false;
  }
  if (from === to) {
    return true;
  }
  if (isTerminalToolInvocationStatus(to)) {
    return true;
  }

  return statusRank(to) >= statusRank(from);
}

export function isTerminalToolInvocationStatus(
  status: ToolInvocationStatus,
): boolean {
  return (
    status === "completed" ||
    status === "error" ||
    status === "recovered" ||
    status === "aborted"
  );
}

export function toWorkspaceRunToolInvocationInput(
  record: ToolInvocationRecord,
) {
  return {
    type: "tool_invocation" as const,
    toolInvocationId: record.id,
    toolCallId: record.toolCallId,
    toolName: record.toolName,
    toolSource: record.source,
    invocationStatus: record.status,
    args: record.args,
    ...(typeof record.ok === "boolean" ? { ok: record.ok } : {}),
    ...(record.resultRef ? { resultRef: record.resultRef } : {}),
    ...(record.error ? { error: record.error } : {}),
    payload: {
      runId: record.runId,
      history: record.history,
    },
  };
}

function statusRank(status: ToolInvocationStatus): number {
  switch (status) {
    case "proposed":
      return 0;
    case "visible":
      return 1;
    case "waiting_approval":
      return 2;
    case "authorized":
      return 3;
    case "running":
      return 4;
    case "completed":
    case "error":
    case "recovered":
    case "aborted":
      return 5;
  }
}
