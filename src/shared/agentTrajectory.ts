import type { AgentRunContext } from "./agentWorkspace";

export type AgentTrajectoryEventType =
  | "run_context_created"
  | "state_transition"
  | "goal_planned"
  | "milestone_started"
  | "goal_replanned"
  | "goal_review_requested"
  | "goal_stopped"
  | "goal_judged"
  | "model_request"
  | "model_retry"
  | "model_response"
  | "model_reasoning"
  | "skill_invoked"
  | "tool_call"
  | "tool_result"
  | "native_tool_invocation"
  | "native_tool_observation"
  | "checkpoint_written"
  | "context_compacted"
  | "context_rebuilt"
  | "acceptance_checked"
  | "artifact_created"
  | "workspace_escape_denied"
  | "child_run_scheduled"
  | "child_handoff_created"
  | "child_handoff_completed"
  | "child_handoff_reviewed"
  | "actor_spawned"
  | "actor_done"
  | "actor_message_sent"
  | "actor_message_reentered"
  | "actor_message_undelivered"
  | "workflow_started"
  | "workflow_phase"
  | "workflow_completed"
  | "workflow_error"
  | "workflow_fact_capped"
  | "dream_started"
  | "dream_completed"
  | "dream_memory_written"
  | "distill_started"
  | "distill_completed"
  | "distill_skill_packaged"
  | "reflection_added"
  | "strategy_guard_triggered"
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
