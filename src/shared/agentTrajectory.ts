import type { AgentRunContext } from "./agentWorkspace";

export type AgentTrajectoryEventType =
  | "run_context_created"
  | "state_transition"
  | "goal_planned"
  | "milestone_started"
  | "goal_replanned"
  | "goal_resume_circuit_broken"
  | "goal_review_requested"
  | "goal_stopped"
  | "goal_judged"
  | "model_request"
  | "model_retry"
  | "model_response"
  | "model_reasoning"
  | "skill_invoked"
  | "skill_loaded"
  | "tool_call"
  | "tool_invocation"
  | "tool_result"
  | "native_tool_invocation"
  | "native_tool_observation"
  | "checkpoint_written"
  | "checkpoint_boundary"
  | "context_compacted"
  | "context_rebuilt"
  | "task_gate_checked"
  | "memory_scope_recalled"
  | "history_indexed"
  | "history_searched"
  | "acceptance_checked"
  | "acceptance_manifest_created"
  | "acceptance_failure_classified"
  | "acceptance_repair_scheduled"
  | "acceptance_strategy_changed"
  | "acceptance_retry_scheduled"
  | "acceptance_retry_started"
  | "acceptance_retry_exhausted"
  | "acceptance_waiting_for_user"
  | "acceptance_manual_completion_requested"
  | "acceptance_manual_completion_recorded"
  | "acceptance_blocked"
  | "acceptance_certified"
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
