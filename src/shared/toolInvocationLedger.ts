import {
  redactCredentials,
  redactCredentialString,
} from "./credentialRedaction";

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
  approvalId?: string;
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
  approvalId?: string;
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
  approvalId?: string;
};

export function createToolInvocation(
  input: CreateToolInvocationInput,
): ToolInvocationRecord {
  return {
    ...input,
    args: redactCredentials(input.args) as Record<string, unknown>,
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

  const safeReason = transition.reason
    ? redactCredentialString(transition.reason)
    : undefined;
  const safeError = transition.error
    ? redactCredentialString(transition.error)
    : undefined;
  const safeHistory = record.history.map((entry) => ({
    ...entry,
    ...(entry.reason
      ? { reason: redactCredentialString(entry.reason) }
      : {}),
    ...(entry.error
      ? { error: redactCredentialString(entry.error) }
      : {}),
  }));
  const historyEntry: ToolInvocationHistoryEntry = {
    status: transition.status,
    at: transition.at,
    ...(safeReason ? { reason: safeReason } : {}),
    ...(typeof transition.ok === "boolean" ? { ok: transition.ok } : {}),
    ...(transition.resultRef ? { resultRef: transition.resultRef } : {}),
    ...(safeError ? { error: safeError } : {}),
    ...(transition.approvalId ? { approvalId: transition.approvalId } : {}),
  };

  return {
    ...record,
    args: redactCredentials(record.args) as Record<string, unknown>,
    status: transition.status,
    updatedAt: transition.at,
    ...(typeof transition.ok === "boolean" ? { ok: transition.ok } : {}),
    ...(transition.resultRef ? { resultRef: transition.resultRef } : {}),
    ...(safeError ? { error: safeError } : {}),
    ...(transition.approvalId ? { approvalId: transition.approvalId } : {}),
    history: [...safeHistory, historyEntry],
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
    ...(record.approvalId ? { approvalId: record.approvalId } : {}),
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
