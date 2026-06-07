export type AgentLearningCandidateType =
  | "procedural_memory"
  | "failure_lesson"
  | "skill_improvement";

export type AgentLearningCandidateStatus =
  | "pending_review"
  | "accepted"
  | "rejected"
  | "applied";

export type AgentLearningCandidateInput = {
  type: AgentLearningCandidateType;
  sourceRunId: string;
  sourceTrajectoryEventIds: string[];
  claim: string;
  recommendedAction: string;
  risk: string;
};

export type AgentLearningCandidate = AgentLearningCandidateInput & {
  id: string;
  status: AgentLearningCandidateStatus;
  createdAt: string;
  updatedAt: string;
};

export type AgentLearningListOptions = {
  status?: AgentLearningCandidateStatus;
  type?: AgentLearningCandidateType;
};
