export type AgentRunStatus = "succeeded" | "failed" | "canceled";

export type AgentPhase = "planning" | "executing" | "reflecting" | "done";

export type AgentRunEvent = {
  level: "info" | "warn" | "error";
  message: string;
  phase?: AgentPhase;
  data?: Record<string, unknown>;
  createdAt: string;
};

export type ExecutionPlan = {
  steps: ExecutionStep[];
  estimatedTurns: number;
  reasoning: string;
};

export type ExecutionStep = {
  description: string;
  expectedTool?: string;
  expectedOutcome: string;
  status: "pending" | "in_progress" | "completed" | "failed";
};

export type AgentRunRecord = {
  id: string;
  taskId: string;
  taskName: string;
  skillName: string;
  status: AgentRunStatus;
  summary: string;
  events: AgentRunEvent[];
  startedAt: string;
  finishedAt: string;
};

export type RunScheduledTaskResult =
  | {
      ok: true;
      run: AgentRunRecord;
    }
  | {
      ok: false;
      message: string;
    };

export type CancelScheduledTaskRunResult =
  | {
      ok: true;
      message: string;
    }
  | {
      ok: false;
      message: string;
    };
