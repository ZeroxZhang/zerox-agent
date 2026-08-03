import type { ResolvedModelBinding } from "./modelSettings";
import type { AcceptanceCheck, GoalSelectedSkill } from "./agentGoal";
import type {
  ExpectedTaskScale,
  ResolvedReference,
  TaskDomain,
  TaskMode,
  TaskRisk,
} from "./agentTaskStrategy";
import type { SkillInputValue } from "./skillExecutionContract";
import type {
  GoalAmendmentProposal,
  GoalContractIssue,
  GoalContractRef,
  GoalContractSnapshot,
  GoalPlanPurpose,
  GoalPlanRef,
  GoalPlanTrigger,
  PlanCriterionBinding,
} from "./goalPlanContract";

export type PlanMode = "direct" | "debate";
export type PlanAutonomyMode = "standard" | "auto";
export type PlanSchemaVersion = 1 | 2 | 3;
export type PlanInvestigationDepth = "quick" | "standard" | "deep";

export type PlanStatus =
  | "drafting"
  | "paused"
  | "awaiting_input"
  | "awaiting_confirmation"
  | "confirmed_pending_execution"
  | "executing"
  | "steps_completed"
  | "completed"
  | "superseded"
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

export type PlanTaskProfile = {
  domain: TaskDomain;
  mode: TaskMode;
  risk: TaskRisk;
  expectedScale: ExpectedTaskScale;
  needsConfirmation: boolean;
  targetRefs: ResolvedReference[];
  ambiguity: Array<{ field: string; reason: string; options: string[] }>;
  investigationDepth: PlanInvestigationDepth;
};

export type PlanTaskContract = {
  objective: string;
  audience: string;
  deliverables?: string[];
  inScope: string[];
  outOfScope: string[];
  constraints: string[];
  successCriteria: string[];
  assumptions: string[];
  targetRefs?: string[];
  evidenceRefs?: string[];
};

export type PlanEvidenceItem = {
  id: string;
  kind: "workspace" | "file" | "git" | "web" | "user" | "skill";
  title: string;
  summary: string;
  sourceRef?: string;
  sha256?: string;
  sourceHashes?: Array<{ sourceRef: string; sha256: string }>;
};

export type PlanSkillPermissionSummary = {
  fileRead: string[];
  fileWrite: string[];
  shellCommands: string[];
  webSearch: boolean;
  webFetchDomains: string[];
  memoryRead: boolean;
  memoryWrite: boolean;
};

export type PlanSkillCandidate = {
  name: string;
  reason: string;
  evidenceRefs: string[];
};

export type PlanSkillDecision = {
  source: "explicit" | "automatic" | "none";
  selectedSkillName?: string;
  reason: string;
  evidenceRefs: string[];
  alternatives: PlanSkillCandidate[];
  snapshotSha256?: string;
  inputValues: Record<string, SkillInputValue>;
  inputEvidenceRefs: Record<string, string[]>;
  missingInputFields: string[];
  invalidInputFields: string[];
  permissions?: PlanSkillPermissionSummary;
};

export type PlanningBrief = {
  objective: string;
  deliverables: string[];
  inScope: string[];
  outOfScope: string[];
  constraints: string[];
  assumptions: string[];
  unresolvedQuestions: string[];
  targetRefs: string[];
  evidenceRefs: string[];
  skillCandidates: PlanSkillCandidate[];
  recommendedSkillName?: string;
  recommendedSkillReason?: string;
  recommendedSkillInputValues?: Record<string, SkillInputValue>;
  recommendedSkillInputEvidenceRefs?: Record<string, string[]>;
};

export type PlanningStageKind =
  | "triage"
  | "investigation"
  | "skill_route"
  | "contract"
  | "generation"
  | "review"
  | "quality";

export type PlanningStageStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "invalidated";

export type PlanReviewIssue = {
  code: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  repairable: boolean;
  repairInstruction: string;
};

export type PlanningStageRecord = {
  id: string;
  kind: PlanningStageKind;
  runId: string;
  status: PlanningStageStatus;
  investigationDepth?: PlanInvestigationDepth;
  modelBinding?: ResolvedModelBinding;
  evidenceRefs: string[];
  reviewApproved?: boolean;
  reviewIssues?: PlanReviewIssue[];
  revisionAttempted?: boolean;
  /**
   * Quality stage only: one bounded model repair round was attempted after
   * the deterministic quality gate blocked the artifact (gate violations
   * are contract slips by the synthesizer, so they get the same single
   * repair-ladder chance as malformed round output).
   */
  gateRepairAttempted?: boolean;
  startedAt?: string;
  completedAt?: string;
  latencyMs?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    estimated?: boolean;
  };
  error?: string;
  /**
   * Bounded excerpt of the raw model response that failed the stage (same
   * observability contract as DebateRound.failureExcerpt).
   */
  failureExcerpt?: string;
};

export type PlanQualityIssueCode =
  | "INVALID_SCHEMA"
  | "INVALID_DAG"
  | "UNKNOWN_SKILL"
  | "SKILL_INPUT_MISSING"
  | "SKILL_INPUT_INVALID"
  | "UNKNOWN_TOOL"
  | "INVALID_ACCEPTANCE_CHECK"
  | "MISSING_EVIDENCE"
  | "INSUFFICIENT_DETERMINISTIC_ACCEPTANCE"
  | "UNRESOLVED_AMBIGUITY"
  | "UNMITIGATED_CRITICAL_RISK"
  | "MODEL_REVIEW_REJECTED"
  | "GOAL_CONTRACT_DRIFT"
  | "GOAL_CRITERION_UNCOVERED"
  | "GOAL_CONTRACT_BLOCKED"
  | "ILLEGAL_CAPABILITY";

export type PlanQualityIssue = {
  code: PlanQualityIssueCode;
  severity: "warning" | "blocking";
  message: string;
  milestoneId?: string;
  checkId?: string;
  evidenceRefs?: string[];
};

export type PlanQualityReport = {
  status: PlanActionGate;
  blockingIssues: PlanQualityIssue[];
  warnings: PlanQualityIssue[];
  evidenceCoverage: {
    referenced: number;
    total: number;
    missingRefs: string[];
  };
  acceptanceCoverage: {
    deterministicChecks: number;
    modelReviewChecks: number;
    totalChecks: number;
    milestonesCovered: number;
    milestonesTotal: number;
  };
  generatedAt: string;
};

export type PlanMilestone = {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  dependencies: string[];
  targetRefs?: string[];
  evidenceRefs?: string[];
  actions?: string[];
  toolNames?: string[];
  acceptanceChecks?: AcceptanceCheck[];
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
  acceptanceChecks?: AcceptanceCheck[];
  goalContractIssues?: GoalContractIssue[];
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
  goalContractIssues?: GoalContractIssue[];
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
  /**
   * Bounded excerpt of the raw model response that failed the round
   * contract, persisted for post-mortem diagnosis. Local-only; never
   * rendered into prompts.
   */
  failureExcerpt?: string;
  startedAt?: string;
  completedAt?: string;
  latencyMs?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    estimated?: boolean;
  };
};

export type PlanProjection = {
  path: string;
  sha256: string;
  writtenAt: string;
};

export type PlanRecord = {
  schemaVersion?: PlanSchemaVersion;
  id: string;
  sessionId: string;
  workspaceId?: string;
  workspaceRoot?: string;
  sourceMessage: string;
  baseSourceMessage?: string;
  clarifications?: string[];
  requestedSkillName?: string | null;
  selectedSkill?: GoalSelectedSkill;
  mode: PlanMode;
  autonomyMode?: PlanAutonomyMode;
  status: PlanStatus;
  actionGate: PlanActionGate;
  revision: number;
  taskProfile?: PlanTaskProfile;
  planningBrief?: PlanningBrief;
  planningStages?: PlanningStageRecord[];
  skillDecision?: PlanSkillDecision;
  selectedSkillInputValues?: Record<string, SkillInputValue>;
  qualityReport?: PlanQualityReport;
  taskContract: PlanTaskContract;
  purpose?: GoalPlanPurpose;
  goalContractSnapshot?: GoalContractSnapshot;
  goalContractRef?: GoalContractRef;
  goalId?: string;
  parentPlanRef?: GoalPlanRef;
  goalPlanVersion?: number;
  trigger?: GoalPlanTrigger;
  criterionBindings?: PlanCriterionBinding[];
  goalContractIssues?: GoalContractIssue[];
  supersededByPlanId?: string;
  supersededAt?: string;
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
  requestedSkillName?: string | null;
  selectedSkill?: GoalSelectedSkill;
  mode: PlanMode;
  autonomyMode?: PlanAutonomyMode;
  purpose?: GoalPlanPurpose;
  goalContractSnapshot?: GoalContractSnapshot;
  goalContractRef?: GoalContractRef;
  goalId?: string;
  parentPlanRef?: GoalPlanRef;
  goalPlanVersion?: number;
  trigger?: GoalPlanTrigger;
  feedbackEvidence?: PlanEvidenceItem[];
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

export type CreateRuntimeGoalPlanResult =
  | { ok: true; plan: PlanRecord; message: string }
  | { ok: false; message: string; plan?: PlanRecord };

export type AdoptGoalPlanInput = {
  planId: string;
  expectedRevision: number;
  expectedGoalPlanVersion: number;
};

export type AdoptGoalPlanResult =
  | {
      ok: true;
      plan: PlanRecord;
      goal: import("./agentGoal").Goal;
      message: string;
    }
  | { ok: false; message: string; plan?: PlanRecord };

export type ProposeGoalAmendmentInput = {
  goalId: string;
  candidateContract: GoalContractSnapshot;
  reason: string;
};

export type GoalAmendmentOperationResult =
  | {
      ok: true;
      proposal: GoalAmendmentProposal;
      plan?: PlanRecord;
      message: string;
    }
  | { ok: false; message: string };

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
