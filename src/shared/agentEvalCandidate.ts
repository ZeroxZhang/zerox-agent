import type {
  AgentTrajectoryEvent,
  AgentTrajectoryEventType,
} from "./agentTrajectory";

export type AgentEvalCandidateStatus =
  | "pending_review"
  | "accepted"
  | "rejected";

export type AgentEvalCandidateAssertion = {
  type: AgentTrajectoryEventType;
  payload?: Record<string, unknown>;
  after?: AgentTrajectoryEventType;
};

export type AgentEvalCandidateFixture = {
  id: string;
  description: string;
  events: AgentTrajectoryEvent[];
  requiredEventTypes: AgentTrajectoryEventType[];
  assertions?: AgentEvalCandidateAssertion[];
  recoverabilityRequired?: boolean;
};

export type AgentEvalCandidate = {
  id: string;
  sourceRunId: string;
  status: AgentEvalCandidateStatus;
  rationale: string;
  fixture: AgentEvalCandidateFixture;
  createdAt: string;
};
