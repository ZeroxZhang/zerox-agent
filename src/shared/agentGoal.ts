import type { GoalReviewPolicy } from "./agentGoalReview";
import type { AgentTaskContract } from "./agentTaskContract";
import type { PublicSkillSnapshot } from "./skills";
import type { ModelServiceNotice } from "./modelServiceNotice";
import type { AgentContextUsage } from "./contextUsage";
import type { ResolvedModelBinding } from "./modelSettings";
import type {
  GoalContractRef,
  GoalContractSnapshot,
  GoalAmendmentProposal,
  GoalPlanHistoryEntry,
  GoalPlanRef,
} from "./goalPlanContract";

export type GoalStatus =
  | "planning"
  | "executing"
  | "waiting_for_review"
  | "waiting_for_acceptance"
  | "waiting_for_model"
  | "achieved"
  | "completed_unverified"
  | "stopped_budget"
  | "stopped_stalled"
  | "stopped_blocked"
  | "failed"
  | "canceled";

export type StopReason =
  | "goal_accepted"
  | "budget_exhausted"
  | "progress_stalled"
  | "review_rejected"
  | "user_canceled"
  | "unrecoverable_failure"
  | "external_blocked"
  | "goal_impossible"
  | "user_marked_complete"
  | "acceptance_unavailable"
  | "acceptance_integrity_failed";

export type BuiltinAcceptanceCheckKind =
  | "file_exists"
  | "command_exit_code"
  | "test_passes"
  | "assertion"
  | "model_review";

export type AcceptanceCheckKind =
  | BuiltinAcceptanceCheckKind
  | `validator:${string}`;

export type GoalAcceptanceProtocolVersion = 1 | 2;

export type AcceptanceVerdict =
  | "accepted"
  | "rejected_repairable"
  | "replan_required"
  | "blocked_external"
  | "impossible"
  | "acceptance_unavailable";

export type AcceptanceFailureClass =
  | "artifact_missing"
  | "artifact_invalid"
  | "artifact_outside_boundary"
  | "command_failed"
  | "test_failed"
  | "assertion_failed"
  | "semantic_evidence_insufficient"
  | "plan_structure_invalid"
  | "external_dependency_missing"
  | "goal_impossible"
  | "validator_unavailable"
  | "judge_unavailable"
  | "unknown";

export type GoalAcceptanceCheckResult = {
  checkId: string;
  kind: AcceptanceCheckKind;
  passed: boolean;
  code: string;
  failureClass?: AcceptanceFailureClass;
  evidenceRefs: string[];
  detail: string;
};

export type AcceptanceRepairDirective = {
  action:
    | "repair_same_milestone"
    | "retry_alternate_strategy"
    | "replan"
    | "wait_for_acceptance"
    | "stop_stalled"
    | "stop_blocked";
  summary: string;
  failedCheckIds: string[];
  fingerprint: string;
  occurrence: number;
  instructions: string[];
};

export type GoalAcceptanceFailureRecord = {
  at: string;
  targetKind: "milestone" | "goal";
  targetId: string;
  fingerprint: string;
  occurrence: number;
  verdict: Exclude<AcceptanceVerdict, "accepted">;
  failureClass: AcceptanceFailureClass;
  failedCheckIds: string[];
  evidenceRefs: string[];
  actionSignatures: string[];
};

export type GoalAcceptanceState = {
  protocolVersion: 2;
  phase:
    | "idle"
    | "validating"
    | "repairing"
    | "judging"
    | "retrying"
    | "awaiting_user"
    | "blocked"
    | "certified";
  attempt: number;
  recentFailures: GoalAcceptanceFailureRecord[];
  lastDecision?: AcceptanceRepairDirective;
};

export type GoalAcceptanceRetryState = {
  cycle: number;
  attempt: number;
  maxAttempts: number;
  lastCode: string;
  lastDetail: string;
  nextRetryAt?: string;
  evidenceFingerprint: string;
  finalJudgeReplay?: FinalGoalJudgeReplayEvidence;
  resumeFrom: "final_judge";
};

export type FinalGoalJudgeReplayEvidence = {
  version: 1;
  goalId: string;
  criteriaFingerprint: string;
  evidenceFingerprint: string;
  deterministicCheckResults: GoalAcceptanceCheckResult[];
  evidenceManifest: GoalEvidenceManifest;
};

export const MAX_FINAL_JUDGE_REPLAY_BYTES = 256 * 1024;

export function sanitizeFinalGoalJudgeReplayEvidence(
  value: unknown,
): FinalGoalJudgeReplayEvidence | undefined {
  if (!isPlainRecord(value)) return undefined;
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return undefined;
  }
  if (
    new TextEncoder().encode(serialized).byteLength >
      MAX_FINAL_JUDGE_REPLAY_BYTES
  ) {
    return undefined;
  }
  if (
    value.version !== 1 ||
    !isBoundedString(value.goalId, 512) ||
    !isSha256(value.criteriaFingerprint) ||
    !isSha256(value.evidenceFingerprint) ||
    !Array.isArray(value.deterministicCheckResults) ||
    value.deterministicCheckResults.length > 128 ||
    !value.deterministicCheckResults.every(isReplayCheckResult) ||
    !isReplayEvidenceManifest(value.evidenceManifest)
  ) {
    return undefined;
  }
  try {
    return structuredClone(value) as FinalGoalJudgeReplayEvidence;
  } catch {
    return undefined;
  }
}

function isReplayCheckResult(value: unknown): boolean {
  return isPlainRecord(value) &&
    isBoundedString(value.checkId, 512) &&
    isBoundedString(value.kind, 512) &&
    typeof value.passed === "boolean" &&
    isBoundedString(value.code, 128) &&
    isBoundedString(value.detail, 4_096) &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.length <= 64 &&
    value.evidenceRefs.every((ref) => isBoundedString(ref, 512));
}

function isReplayEvidenceManifest(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  return value.version === 1 &&
    isBoundedString(value.generatedAt, 128) &&
    Array.isArray(value.artifacts) &&
    value.artifacts.length <= 128 &&
    value.artifacts.every((artifact) => {
      if (!isPlainRecord(artifact)) return false;
      return isBoundedString(artifact.ref, 512) &&
        isBoundedString(artifact.mediaType, 256) &&
        Array.isArray(artifact.excerpts) &&
        artifact.excerpts.length <= 64 &&
        artifact.excerpts.every((excerpt) =>
          isPlainRecord(excerpt) &&
          isBoundedString(excerpt.label, 256) &&
          isBoundedString(excerpt.text, 4_096));
    }) &&
    typeof value.totalRenderedChars === "number" &&
    Number.isFinite(value.totalRenderedChars) &&
    typeof value.truncated === "boolean";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export type GoalManualCompletionAttestation = {
  version: 1;
  goalId: string;
  completedAt: string;
  reason: "user_marked_complete";
  failedCheckIds: string[];
  evidenceRefs: string[];
  evidenceFingerprint: string;
  lastFailureCode: string;
  retryCycles: number;
};

export type GoalEvidenceArtifact = {
  ref: string;
  path?: string;
  mediaType: string;
  sizeBytes?: number;
  modifiedAt?: string;
  sha256?: string;
  lineCount?: number;
  headings?: Array<{ depth: number; text: string; line: number }>;
  jsonKeys?: string[];
  tableShape?: { rows: number; columns: number; headers: string[] };
  imageSize?: { width: number; height: number };
  excerpts: Array<{
    label: string;
    startLine?: number;
    endLine?: number;
    text: string;
  }>;
};

export type GoalEvidenceManifest = {
  version: 1;
  generatedAt: string;
  artifacts: GoalEvidenceArtifact[];
  totalRenderedChars: number;
  truncated: boolean;
};

export type GoalAcceptanceCertificate = {
  version: 1;
  goalId: string;
  acceptedAt: string;
  protocolVersion: 2;
  criteriaHash: string;
  planVersion: number;
  goalContractRef?: GoalContractRef;
  activePlanRef?: GoalPlanRef;
  runIds: string[];
  checkResults: GoalAcceptanceCheckResult[];
  evidence: Array<{
    ref: string;
    path?: string;
    sha256?: string;
    sizeBytes?: number;
    provenanceRefs: string[];
  }>;
  judge?: {
    providerId?: string;
    model: string;
    promptVersion: string;
    evaluatedMessageIds: string[];
  };
  certificateHash: string;
};

export type AcceptanceCheck = {
  id: string;
  kind: AcceptanceCheckKind;
  description: string;
  params: Record<string, unknown>;
  requiresEvidence: boolean;
};

export type SuccessCriterion = {
  id: string;
  description: string;
  acceptanceChecks: AcceptanceCheck[];
};

export type MilestoneState =
  | "pending"
  | "ready"
  | "running"
  | "accepted"
  | "rejected"
  | "skipped"
  | "failed";

export type Milestone = {
  id: string;
  description: string;
  dependsOn: string[];
  successCriteria: SuccessCriterion[];
  state: MilestoneState;
  runIds: string[];
  attempts: number;
  lastAcceptanceSummary?: string;
  lastRunStatus?: "succeeded" | "failed" | "canceled" | "paused";
  lastRunSummary?: string;
};

/** @deprecated Historical storage and goal:create decoding only. */
export type GoalBudget = {
  maxIterations: number;
  maxToolCalls: number;
  maxWallClockMs: number;
  maxTokens?: number;
  maxReplans: number;
};

export type GoalExecutionUsage = {
  iterations: number;
  toolCalls: number;
  wallClockMs: number;
  tokens: number;
  /** True when at least one model turn used a local token estimate. */
  tokensEstimated?: boolean;
  replans: number;
};

export type GoalRuntimeToolCallSnapshot = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type GoalRuntimeMessageSnapshot = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: GoalRuntimeToolCallSnapshot[];
  tool_call_id?: string;
  name?: string;
};

export type GoalRuntimeCheckpoint = {
  milestoneId: string;
  transcriptMessages: GoalRuntimeMessageSnapshot[];
  nextAction: string;
  updatedAt: string;
};

export type GoalSelectedSkill = Pick<
  PublicSkillSnapshot,
  "manifest" | "body" | "rootDir" | "skillFile"
>;

export type Goal = {
  id: string;
  chatSessionId?: string;
  originMessageId?: string;
  description: string;
  originalDescription?: string;
  sourcePlanRef?: {
    planId: string;
    revision: number;
    sha256: string;
  };
  goalContractSnapshot?: GoalContractSnapshot;
  goalContractRef?: GoalContractRef;
  activePlanRef?: GoalPlanRef;
  planHistory?: GoalPlanHistoryEntry[];
  pendingGoalAmendment?: GoalAmendmentProposal;
  /** Frozen execution model inherited from a confirmed Plan. */
  executionModelBinding?: ResolvedModelBinding;
  successCriteria: SuccessCriterion[];
  milestones: Milestone[];
  status: GoalStatus;
  stopReason?: StopReason;
  /** @deprecated Legacy data only. Runtime decisions must not read these limits. */
  budget?: GoalBudget;
  executionUsage: GoalExecutionUsage;
  reviewPolicy: GoalReviewPolicy;
  planVersion: number;
  workspaceId?: string;
  taskContract?: AgentTaskContract;
  selectedSkill?: GoalSelectedSkill;
  selectedSkillInputValues?: Record<string, string | number | boolean>;
  runtimeCheckpoint?: GoalRuntimeCheckpoint;
  contextUsage?: AgentContextUsage;
  modelServiceNotice?: ModelServiceNotice;
  acceptanceProtocolVersion?: GoalAcceptanceProtocolVersion;
  acceptanceState?: GoalAcceptanceState;
  acceptanceRetryState?: GoalAcceptanceRetryState;
  manualCompletionAttestation?: GoalManualCompletionAttestation;
  acceptanceCertificate?: GoalAcceptanceCertificate;
  createdAt: string;
  updatedAt: string;
};

export function hasGoalCompletedExecution(
  goal: Pick<Goal, "milestones">,
): boolean {
  return goal.milestones.length > 0 && goal.milestones.every(
    (milestone) =>
      milestone.state === "accepted" || milestone.state === "skipped",
  );
}

/**
 * Older Goal records used stopped_blocked for a final acceptance outage even
 * after every execution step had passed. Keep storage/audit history intact,
 * while projecting that recoverable state as final-acceptance pending in the
 * interactive UI.
 */
export function projectGoalStatusForInteraction(
  goal: Pick<Goal, "status" | "stopReason" | "milestones">,
): GoalStatus {
  return goal.status === "stopped_blocked" &&
      goal.stopReason === "acceptance_unavailable" &&
      hasGoalCompletedExecution(goal)
    ? "waiting_for_acceptance"
    : goal.status;
}

export function upgradeGoalAcceptanceProtocol(goal: Goal): Goal {
  if (goal.acceptanceProtocolVersion === 2 && goal.acceptanceState) {
    return goal;
  }

  return {
    ...goal,
    acceptanceProtocolVersion: 2,
    acceptanceState: {
      protocolVersion: 2,
      phase: "idle",
      attempt: 0,
      recentFailures: [],
    },
  };
}

const allowedTransitions: Record<GoalStatus, GoalStatus[]> = {
  planning: ["executing", "canceled"],
  executing: [
    "waiting_for_review",
    "waiting_for_acceptance",
    "waiting_for_model",
    "achieved",
    "stopped_stalled",
    "stopped_blocked",
    "failed",
    "canceled",
  ],
  waiting_for_review: ["executing", "canceled"],
  waiting_for_acceptance: ["executing", "completed_unverified", "canceled"],
  waiting_for_model: ["executing", "canceled"],
  achieved: [],
  completed_unverified: [],
  stopped_budget: [],
  stopped_stalled: [],
  stopped_blocked: ["executing", "canceled"],
  failed: [],
  canceled: [],
};

export function canTransitionGoalStatus(
  from: GoalStatus,
  to: GoalStatus,
): boolean {
  if (from === to) {
    return true;
  }

  return allowedTransitions[from].includes(to);
}

export function assertGoalTransition(from: GoalStatus, to: GoalStatus): void {
  if (!canTransitionGoalStatus(from, to)) {
    throw new Error(`Cannot transition goal from "${from}" to "${to}".`);
  }
}

export function validateGoalDraft(
  goal: Pick<Goal, "successCriteria" | "milestones">,
): void {
  if (goal.successCriteria.length === 0) {
    throw new Error("Goal must have at least one success criterion.");
  }

  for (const criterion of goal.successCriteria) {
    validateSuccessCriterion(criterion);
  }

  for (const milestone of goal.milestones) {
    if (milestone.successCriteria.length === 0) {
      throw new Error(
        `Milestone "${milestone.id}" must have at least one success criterion.`,
      );
    }

    for (const criterion of milestone.successCriteria) {
      validateSuccessCriterion(criterion);
    }
  }
}

export function validateGoal(goal: Goal): void {
  validateGoalDraft(goal);

  if (
    goal.acceptanceProtocolVersion === 2 &&
    goal.status === "achieved" &&
    !goal.acceptanceCertificate
  ) {
    throw new Error(
      "Protocol-v2 achieved goals require an acceptance certificate.",
    );
  }
}

function validateSuccessCriterion(criterion: SuccessCriterion): void {
  if (criterion.acceptanceChecks.length === 0) {
    throw new Error(
      `Success criterion "${criterion.id}" must have at least one acceptance check.`,
    );
  }

  for (const check of criterion.acceptanceChecks) {
    if (check.kind === "model_review" && !check.requiresEvidence) {
      throw new Error(`Model review check "${check.id}" must require evidence.`);
    }
  }
}

// Progress ledger event — appended to each goal's ledger JSONL. Moved to shared
// so the storage contract (src/shared/storageContract.ts) can reference it.
export type ProgressLedgerEvent = {
  at: string;
  publicationKey?: string;
  kind:
    | "goal_planned"
    | "milestone_started"
    | "milestone_accepted"
    | "milestone_rejected"
    | "goal_replanned"
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
    | "review_requested"
    | "review_resolved"
    | "goal_resume_circuit_broken"
    | "goal_stopped";
  milestoneId?: string;
  summary: string;
  evidenceRefs?: string[];
};
