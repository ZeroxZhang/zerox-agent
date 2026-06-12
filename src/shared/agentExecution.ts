import type { AgentRunContext } from "./agentWorkspace";

export type AgentExecutionStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "paused"
  | "succeeded"
  | "failed"
  | "canceled";

export type AgentFailureClass =
  | "model_error"
  | "tool_error"
  | "permission_denied"
  | "invalid_model_output"
  | "timeout"
  | "canceled"
  | "unknown";

export type AgentExecutionStepState =
  | "pending"
  | "running"
  | "waiting_for_tool"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "skipped";

export type AgentExecutionMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
};

export type AgentExecutionStep = {
  id: string;
  description: string;
  expectedTool?: string;
  expectedOutcome: string;
  state: AgentExecutionStepState;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  failureClass?: AgentFailureClass;
  failureMessage?: string;
};

export type AgentExecutionCheckpoint = {
  id: string;
  runId: string;
  taskId: string;
  goalId?: string;
  milestoneId?: string;
  status: AgentExecutionStatus;
  runContext?: AgentRunContext;
  currentStepId?: string;
  steps: AgentExecutionStep[];
  messages: AgentExecutionMessage[];
  toolCallCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AgentExecutionArtifact = {
  id: string;
  kind: "file" | "text" | "tool_result" | "other";
  label: string;
  path?: string;
  contentType?: string;
  createdAt: string;
};

const terminalStatuses = new Set<AgentExecutionStatus>([
  "succeeded",
  "failed",
  "canceled",
]);

const allowedTransitions: Record<AgentExecutionStatus, AgentExecutionStatus[]> = {
  queued: ["running", "canceled"],
  running: [
    "waiting_for_approval",
    "paused",
    "succeeded",
    "failed",
    "canceled",
  ],
  waiting_for_approval: ["running", "failed", "canceled"],
  paused: ["running", "canceled"],
  succeeded: [],
  failed: [],
  canceled: [],
};

export function isTerminalExecutionStatus(
  status: AgentExecutionStatus,
): boolean {
  return terminalStatuses.has(status);
}

export function canTransitionExecutionStatus(
  from: AgentExecutionStatus,
  to: AgentExecutionStatus,
): boolean {
  if (from === to) {
    return true;
  }

  return allowedTransitions[from].includes(to);
}

export function assertExecutionTransition(
  from: AgentExecutionStatus,
  to: AgentExecutionStatus,
): void {
  if (!canTransitionExecutionStatus(from, to)) {
    throw new Error(`Cannot transition agent execution from "${from}" to "${to}".`);
  }
}
