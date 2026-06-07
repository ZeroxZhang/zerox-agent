export type AgentTrajectoryEventType =
  | "state_transition"
  | "model_request"
  | "model_response"
  | "tool_call"
  | "tool_result"
  | "checkpoint_written"
  | "artifact_created"
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
