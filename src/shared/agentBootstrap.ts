import type { AgentRunRecord } from "./agentRuns";
import type { ScheduledTask } from "./scheduledTasks";

export type AgentBootstrapStep = {
  ready: boolean;
  message: string;
};

export type AgentBootstrapTaskStep = AgentBootstrapStep & {
  created: boolean;
  task: ScheduledTask | null;
};

export type AgentBootstrapReport = {
  ready: boolean;
  model: AgentBootstrapStep;
  skill: AgentBootstrapStep;
  task: AgentBootstrapTaskStep;
};

export type AgentBootstrapConnectionStep = AgentBootstrapStep & {
  checked: boolean;
  latencyMs: number | null;
};

export type AgentBootstrapRunStep = AgentBootstrapStep & {
  ran: boolean;
  run: AgentRunRecord | null;
};

export type AgentBootstrapValidationReport = AgentBootstrapReport & {
  connection: AgentBootstrapConnectionStep;
  run: AgentBootstrapRunStep;
};

export type AgentBootstrapValidationSnapshot = {
  report: AgentBootstrapValidationReport;
  validatedAt: string;
};

export type PrepareAgentResult =
  | {
      ok: true;
      report: AgentBootstrapReport;
    }
  | {
      ok: false;
      message: string;
    };

export type ValidateAgentResult =
  | {
      ok: true;
      report: AgentBootstrapValidationReport;
      snapshot: AgentBootstrapValidationSnapshot;
    }
  | {
      ok: false;
      message: string;
    };

export type LoadAgentValidationResult =
  | {
      ok: true;
      snapshot: AgentBootstrapValidationSnapshot | null;
    }
  | {
      ok: false;
      message: string;
    };
