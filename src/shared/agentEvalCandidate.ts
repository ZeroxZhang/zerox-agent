import type {
  AgentTrajectoryEvent,
  AgentTrajectoryEventType,
} from "./agentTrajectory";

export type AgentEvalCandidateStatus =
  | "pending_review"
  | "accepted"
  | "rejected"
  | "promoted";

export type AgentEvalCandidateListOptions = {
  status?: AgentEvalCandidateStatus;
};

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
  updatedAt: string;
};

export type GenerateEvalCandidateForRunResult =
  | {
      ok: true;
      candidate: AgentEvalCandidate;
      existing: boolean;
    }
  | {
      ok: false;
      message: string;
    };

export type PromoteEvalCandidateResult =
  | {
      ok: true;
      candidate: AgentEvalCandidate;
      fixtureId: string;
    }
  | {
      ok: false;
      message: string;
    };
