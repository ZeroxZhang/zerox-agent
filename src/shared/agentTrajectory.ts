import type { AgentRunContext } from "./agentWorkspace";

export type AgentTrajectoryEventType =
  | "run_context_created"
  | "state_transition"
  | "model_request"
  | "model_response"
  | "tool_call"
  | "tool_result"
  | "native_tool_invocation"
  | "native_tool_observation"
  | "checkpoint_written"
  | "artifact_created"
  | "workspace_escape_denied"
  | "child_run_scheduled"
  | "reflection_added"
  | "failure_classified"
  | "final_summary";

export type AgentTrajectoryRedaction = {
  containsApiKey: false;
  containsFileContent: boolean;
  containsUserText: boolean;
};

export type AgentTrajectoryEvent = {
  id: string;
  runId: string;
  type: AgentTrajectoryEventType;
  sequence: number;
  runContext?: AgentRunContext;
  payload: Record<string, unknown>;
  redaction: AgentTrajectoryRedaction;
  createdAt: string;
};

export type AgentTrajectoryScore = {
  runId: string;
  passed: boolean;
  score: number;
  reasons: string[];
  createdAt: string;
};
