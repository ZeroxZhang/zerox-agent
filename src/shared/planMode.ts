import type { ResolvedModelBinding } from "./modelSettings";

export type PlanMode = "direct" | "debate";

export type PlanStatus =
  | "drafting"
  | "paused"
  | "awaiting_input"
  | "awaiting_confirmation"
  | "confirmed_pending_execution"
  | "executing"
  | "completed"
  | "discarded"
  | "canceled"
  | "failed";

export type PlanActionGate = "ready" | "needs_input" | "blocked";
export type DebateRole = "direct" | "a" | "b" | "c";
export type DebateRoundKind = "direct" | "a1" | "b1" | "a2" | "b2" | "c";
export type DebateRoundStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "invalidated";

export type PlanModelAssignments = {
  direct?: string;
  a?: string;
  b?: string;
  c?: string;
};

export type FrozenPlanModelAssignments = Partial<
  Record<"direct" | "a" | "b" | "c", ResolvedModelBinding>
>;

export type PlanTaskContract = {
  objective: string;
  audience: string;
  inScope: string[];
  outOfScope: string[];
  constraints: string[];
  successCriteria: string[];
  assumptions: string[];
};

export type PlanEvidenceItem = {
  id: string;
  kind: "workspace" | "file" | "git" | "web" | "user";
  title: string;
  summary: string;
  sourceRef?: string;
  sha256?: string;
};

export type PlanMilestone = {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  dependencies: string[];
};

export type PlanRisk = {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  mitigation: string;
  status: "resolved" | "open" | "accepted";
};

export type PlanProposal = {
  title: string;
  summary: string;
  objective: string;
  scope: {
    in: string[];
    out: string[];
  };
  assumptions: string[];
  milestones: PlanMilestone[];
  dependencies: string[];
  risks: PlanRisk[];
  acceptanceCriteria: string[];
};

export type DebateCritiqueIssue = {
  id: string;
  target: string;
  severity: "low" | "medium" | "high" | "critical";
  claim: string;
  evidenceOrCounterexample: string;
  requestedChange: string;
  status: "open" | "accepted" | "rejected" | "resolved";
};

export type DebateCritique = {
  summary: string;
  issues: DebateCritiqueIssue[];
  minorityOpinion: string[];
  unresolvedRisks: PlanRisk[];
};

export type PlanRevisionDecision = {
  issueId: string;
  decision: "accepted" | "rejected" | "partially_accepted";
  reason: string;
  changedSections: string[];
};

export type RevisedPlanProposal = PlanProposal & {
  decisions: PlanRevisionDecision[];
};

export type ClaimLedgerItem = {
  id: string;
  claim: string;
  evidenceRefs: string[];
  counterexamples: string[];
  conditions: string[];
  confidence: number;
  status: "verified" | "contested" | "unverified" | "rejected";
};

export type PlanArtifact = PlanProposal & {
  claimLedger: ClaimLedgerItem[];
  unresolvedQuestions: string[];
  minorityOpinion: string[];
  actionGate: PlanActionGate;
  gateReason: string;
  markdown: string;
};

export type DebateRound = {
  id: string;
  kind: DebateRoundKind;
  role: DebateRole;
  ordinal: number;
  runId: string;
  modelBinding: ResolvedModelBinding;
  status: DebateRoundStatus;
  publicInputRefs: string[];
  output?: PlanProposal | RevisedPlanProposal | DebateCritique | PlanArtifact;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  latencyMs?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
};

export type PlanProjection = {
  path: string;
  sha256: string;
  writtenAt: string;
};

export type PlanRecord = {
  id: string;
  sessionId: string;
  workspaceId?: string;
  workspaceRoot?: string;
  sourceMessage: string;
  mode: PlanMode;
  status: PlanStatus;
  actionGate: PlanActionGate;
  revision: number;
  taskContract: PlanTaskContract;
  evidence: PlanEvidenceItem[];
  requestedModelAssignments: PlanModelAssignments;
  frozenModelAssignments: FrozenPlanModelAssignments;
  rounds: DebateRound[];
  finalArtifact?: PlanArtifact;
  projection?: PlanProjection;
  executionGoalId?: string;
  executionRunId?: string;
  confirmedRevision?: number;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreatePlanInput = {
  sessionId: string;
  workspaceId?: string;
  workspaceRoot?: string;
  sourceMessage: string;
  mode: PlanMode;
  modelAssignments?: PlanModelAssignments;
  signal?: AbortSignal;
};

export type PlanOperationResult =
  | { ok: true; plan: PlanRecord; message: string }
  | { ok: false; message: string; plan?: PlanRecord };

export type ConfirmPlanInput = {
  planId: string;
  expectedRevision: number;
};

export type ConfirmPlanResult =
  | {
      ok: true;
      plan: PlanRecord;
      activeGoal: {
        id: string;
        description: string;
        status: string;
      };
    }
  | { ok: false; message: string; plan?: PlanRecord };

export const DEBATE_SEQUENCE: DebateRoundKind[] = [
  "a1",
  "b1",
  "a2",
  "b2",
  "c",
];

export function isPlanConfirmable(plan: PlanRecord): boolean {
  return (
    plan.status === "awaiting_confirmation" &&
    plan.actionGate === "ready" &&
    Boolean(plan.finalArtifact && plan.projection)
  );
}
