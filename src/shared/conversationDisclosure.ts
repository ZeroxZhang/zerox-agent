import type { AgentExecutionStatus } from "./agentExecution";
import type { AgentTrajectoryEventType } from "./agentTrajectory";
import type { GoalStatus } from "./agentGoal";
import type {
  ChatMessageRecord,
  ChatTaskStatusEvent,
  SkillPendingInputState,
} from "./chat";
import type { KernelRunStatus } from "./kernelContract";
import type { PlanActionGate, PlanStatus } from "./planMode";
import type { ToolInvocationStatus } from "./toolInvocationLedger";
import type { WorkspaceRunStatus } from "./workspaceRunLedger";
import { redactCredentialString } from "./credentialRedaction";

export const CONVERSATION_DISCLOSURE_SCHEMA_VERSION = 1 as const;
export const CONVERSATION_DISCLOSURE_PROJECTION_VERSION = 1 as const;
export const CONVERSATION_DISCLOSURE_CONTRIBUTOR_PAGE_LIMIT = 16;
export const CONVERSATION_DISCLOSURE_SUMMARY_MAX_BYTES = 2_048;
export const CONVERSATION_DISCLOSURE_SUMMARY_MAX_LINES = 8;

export type ConversationFactKind =
  | "chat_activity"
  | "chat_message"
  | "goal"
  | "plan"
  | "scheduled_run"
  | "agent_run"
  | "trajectory"
  | "workspace_run"
  | "tool_invocation"
  | "approval"
  | "guided_input"
  | "context"
  | "usage"
  | "kernel";

export type ConversationApprovalObservationStatus =
  | "pending"
  | "approved"
  | "denied_or_interrupted";

export type ConversationContextObservationStatus =
  | "observed"
  | "compacted"
  | "compacted_degraded";

export type ConversationUsageObservationStatus =
  | "measured"
  | "estimated"
  | "partial";

export type ConversationDomainStatusMap = {
  chat_activity: ChatTaskStatusEvent["state"];
  chat_message: ChatMessageRecord["role"];
  goal: GoalStatus;
  plan: PlanStatus;
  scheduled_run: AgentExecutionStatus;
  agent_run: AgentExecutionStatus;
  trajectory: AgentTrajectoryEventType;
  workspace_run: WorkspaceRunStatus;
  tool_invocation: ToolInvocationStatus;
  approval: ConversationApprovalObservationStatus;
  guided_input: SkillPendingInputState["status"];
  context: ConversationContextObservationStatus;
  usage: ConversationUsageObservationStatus;
  kernel: KernelRunStatus;
};

export type ConversationDisclosureSurface =
  | "chat"
  | "goal"
  | "scheduled"
  | "run";

export type ConversationDisclosureScope = {
  key: string;
  surface: ConversationDisclosureSurface;
  sessionId?: string;
  goalId?: string;
  runId?: string;
  queryHash: string;
};

export type ConversationDisclosureRequiredness =
  | "required"
  | "optional"
  | "ignorable";

export type ConversationDisclosureDurability =
  | "durable"
  | "process_recoverable"
  | "ephemeral";

export type ConversationDisclosureSensitivity =
  | "public_summary"
  | "technical"
  | "restricted";

export type ConversationDisclosureLifecycle =
  | "queued"
  | "running"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "waiting_for_review"
  | "waiting_for_acceptance"
  | "waiting_for_model"
  | "paused"
  | "blocked"
  | "succeeded"
  | "completed_unverified"
  | "failed"
  | "canceled"
  | "unknown";

export type ConversationDisclosureClass =
  | "narrative"
  | "operation"
  | "gate"
  | "ambient"
  | "evidence";

export type ConversationDisclosureAttention =
  | "normal"
  | "needs_attention"
  | "blocking";

export type ConversationDisclosureDetailAvailability =
  | "none"
  | "inline"
  | "evidence";

export type ConversationTypedSourceRef<
  K extends ConversationFactKind = ConversationFactKind,
> = K extends ConversationFactKind
  ? {
      kind: K;
      ref: string;
      domainRevision?: string;
      domainStatus: ConversationDomainStatusMap[K];
      role: "primary" | "contributor" | "evidence";
    }
  : never;

export type ConversationUnknownSourceRef = {
  kind: "unknown";
  originalKind: string;
  ref: string;
  domainRevision?: string;
  domainStatus: string;
  role: "primary" | "contributor" | "evidence";
};

export type ConversationDisclosureSourceRef =
  | ConversationTypedSourceRef
  | ConversationUnknownSourceRef;

export type ConversationEvidenceTarget =
  | {
      schemaVersion: 1;
      kind: "agent_run_event";
      runId: string;
      eventId: string;
    }
  | {
      schemaVersion: 1;
      kind: "trajectory_event";
      runId: string;
      eventId: string;
    }
  | {
      schemaVersion: 1;
      kind: "tool_invocation";
      runId: string;
      invocationId: string;
    }
  | {
      schemaVersion: 1;
      kind: "goal_record";
      goalId: string;
      revision?: number;
    }
  | {
      schemaVersion: 1;
      kind: "plan_record";
      planId: string;
      revision: number;
    }
  | {
      schemaVersion: 1;
      kind: "checkpoint";
      runId: string;
      checkpointId: string;
    }
  | {
      schemaVersion: 1;
      kind: "contributor_page";
      scopeKey: string;
      generation: string;
      itemId: string;
      cursor?: string;
    }
  | {
      schemaVersion: 1;
      kind: "generic_source";
      source: ConversationDisclosureSourceRef;
    };

type ConversationSafeFactPayload = {
  semanticSlot: string;
  summary: string;
  disclosureClass: ConversationDisclosureClass;
  requestId?: string;
  turnId?: string;
  runId?: string;
  actionRequired?: boolean;
  detailAvailability?: ConversationDisclosureDetailAvailability;
  evidenceTarget?: ConversationEvidenceTarget;
};

export type ConversationFactPayloadMap = {
  chat_activity: ConversationSafeFactPayload & {
    sequence?: number;
    elapsedMs?: number;
    toolName?: string;
  };
  chat_message: ConversationSafeFactPayload & {
    messageId: string;
    executedRunId?: string;
    goalId?: string;
  };
  goal: ConversationSafeFactPayload & {
    goalId: string;
    stopReason?: string;
    planVersion?: number;
    acceptancePhase?: string;
  };
  plan: ConversationSafeFactPayload & {
    planId: string;
    revision: number;
    actionGate: PlanActionGate;
    goalId?: string;
  };
  scheduled_run: ConversationSafeFactPayload & {
    taskId: string;
    runId: string;
  };
  agent_run: ConversationSafeFactPayload & {
    runId: string;
    taskId?: string;
    failureClass?: string;
  };
  trajectory: ConversationSafeFactPayload & {
    eventId: string;
    runId: string;
    sequence: number;
    owningStatus?:
      | { kind: "goal"; status: GoalStatus }
      | { kind: "run"; status: AgentExecutionStatus };
  };
  workspace_run: ConversationSafeFactPayload & {
    workspaceRunId: string;
    eventId?: string;
    sequence?: number;
  };
  tool_invocation: ConversationSafeFactPayload & {
    invocationId: string;
    toolCallId: string;
    toolName: string;
    ok?: boolean;
    resultRef?: string;
  };
  approval: ConversationSafeFactPayload & {
    approvalId: string;
    invocationId?: string;
    decisionReasonClass?: "approved" | "user_denied" | "aborted_or_timeout";
  };
  guided_input: ConversationSafeFactPayload & {
    inputRequestId: string;
  };
  context: ConversationSafeFactPayload & {
    estimatedTokens?: number;
    tokenBudget?: number;
    compactionCount?: number;
  };
  usage: ConversationSafeFactPayload & {
    totalTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
  };
  kernel: ConversationSafeFactPayload & {
    runId: string;
    turn?: number;
    maxTurns?: number;
  };
};

export type ConversationDisclosureFact<
  K extends ConversationFactKind = ConversationFactKind,
> = K extends ConversationFactKind
  ? {
      schemaVersion: 1;
      kind: K;
      authorityRef: string;
      scope: ConversationDisclosureScope;
      domainRevision?: string;
      domainStatus: ConversationDomainStatusMap[K];
      requiredness: ConversationDisclosureRequiredness;
      durability: ConversationDisclosureDurability;
      sensitivity: ConversationDisclosureSensitivity;
      occurredAt: string;
      payload: ConversationFactPayloadMap[K];
    }
  : never;

export type ConversationUnknownFact = {
  schemaVersion: number;
  originalKind: string;
  authorityRef: string;
  scope: ConversationDisclosureScope;
  domainRevision?: string;
  domainStatus: string;
  requiredness: ConversationDisclosureRequiredness;
  durability: ConversationDisclosureDurability;
  sensitivity: ConversationDisclosureSensitivity;
  occurredAt: string;
  semanticSlot: string;
  safeSummary: string;
};

export type ConversationDisclosureItem = {
  schemaVersion: 1;
  projectionVersion: 1;
  id: string;
  primarySource: ConversationDisclosureSourceRef;
  contributors: ConversationDisclosureSourceRef[];
  contributorCount: number;
  contributorsComplete: boolean;
  contributorSetComplete?: boolean;
  contributorCursor?: string;
  scope: ConversationDisclosureScope;
  requestId?: string;
  turnId?: string;
  runId?: string;
  estimatedTokens?: number;
  tokenBudget?: number;
  compactionCount?: number;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  lifecycle: ConversationDisclosureLifecycle;
  disclosureClass: ConversationDisclosureClass;
  attention: ConversationDisclosureAttention;
  sensitivity: ConversationDisclosureSensitivity;
  summary: string;
  summaryRedacted: boolean;
  summaryTruncated: boolean;
  detailAvailability: ConversationDisclosureDetailAvailability;
  evidenceTarget?: ConversationEvidenceTarget;
  occurredAt: string;
};

export type ConversationSourceCut = {
  source: ConversationFactKind | "unknown";
  sourceIdentity?: string;
  originalKind?: string;
  cursor?: string;
  requiredness: ConversationDisclosureRequiredness;
  status:
    | "complete"
    | "partial"
    | "unavailable"
    | "ephemeral"
    | "incompatible";
  reasonCode?: string;
  ignoredUnknownCount?: number;
};

export type ConversationCoverage = {
  state: "complete" | "partial" | "degraded";
  reasonCodes: string[];
};

type ConversationAttemptControlBase = {
  requestId: string;
  turnId: string;
  attempt: number;
  sequence: number;
};

type ConversationAttemptNonAcceptControl =
  | (ConversationAttemptControlBase & { operation: "begin" | "reset" })
  | (ConversationAttemptControlBase & {
      operation: "supersede";
      supersedesAttempt: number;
    });

export type ConversationAttemptControl =
  | ConversationAttemptNonAcceptControl
  | (ConversationAttemptControlBase & {
      operation: "accept";
      acceptedMessageId: string;
    });

export type ConversationLiveContentDelta = {
  schemaVersion: 1;
  requestId: string;
  turnId: string;
  attempt: number;
  sequence: number;
  channel: "answer";
  text: string;
};

export type ActiveConversationAttempt = {
  requestId: string;
  turnId: string;
  attempt: number;
  lastSequence: number;
  answerText: string;
};

type ConversationAttemptSettlementBase = {
  requestId: string;
  turnId: string;
  attempt: number;
  lastSequence: number;
  lastEventFingerprint: string;
};

export type ConversationAcceptedAttemptSettlement =
  ConversationAttemptSettlementBase & {
    outcome: "accepted";
    acceptedMessageId: string;
    acceptedMessageRole: "assistant";
    acceptedContentFingerprint: string;
    acceptedTurnSettlementStatus?: "succeeded" | "paused" | "failed" | "canceled";
    acceptanceReceiptFingerprint: string;
  };

export type ConversationAttemptSettlement =
  | (ConversationAttemptSettlementBase & {
      outcome: "reset" | "superseded";
    })
  | ConversationAcceptedAttemptSettlement;

export type ConversationProjectionAttemptControl =
  | ConversationAttemptNonAcceptControl
  | (ConversationAttemptControlBase & {
      operation: "accept";
      acceptedSettlement: ConversationAcceptedAttemptSettlement;
    });

export type ConversationLiveAnswerStream = {
  requestId: string;
  turnId: string;
  lastSequence: number;
  lastEventFingerprint: string;
  active?: { attempt: number; answerText: string };
  settlement?: ConversationAttemptSettlement;
};

export type ConversationLiveAnswerState = {
  streams: ConversationLiveAnswerStream[];
};

export type ConversationPersistedAssistantMessage = Pick<
  ChatMessageRecord,
  "id" | "role" | "content" | "turnSettlementStatus"
> & {
  requestId: string;
  turnId: string;
};

export type ConversationDisclosureSnapshot = {
  schemaVersion: 1;
  projectionVersion: 1;
  scope: ConversationDisclosureScope;
  generation: string;
  cursor: number;
  lastDeltaId?: string;
  sourceCuts: ConversationSourceCut[];
  coverage: ConversationCoverage;
  activeAttempts: ActiveConversationAttempt[];
  attemptSettlements: ConversationAttemptSettlement[];
  items: ConversationDisclosureItem[];
};

export type ConversationDisclosureDelta = {
  schemaVersion: 1;
  projectionVersion: 1;
  deltaId: string;
  scopeKey: string;
  queryHash: string;
  generation: string;
  fromCursor: number;
  toCursor: number;
  sourceCutChanges: ConversationSourceCut[];
  coverage?: ConversationCoverage;
  attemptControls: ConversationProjectionAttemptControl[];
  upserts: ConversationDisclosureItem[];
  removals: string[];
  resetRequired?: true;
};

export type ConversationDisclosureDeltaBody = Omit<
  ConversationDisclosureDelta,
  "deltaId"
>;

export type ConversationProjectionSeed = {
  primary: ConversationDisclosureFact;
  contributors?: ConversationDisclosureFact[];
  contributorsComplete?: boolean;
};

export type ConversationDisclosurePreference =
  | "auto"
  | "open"
  | "closed"
  | "pinned";

export type ConversationDisclosurePolicyResult = {
  visible: true;
  prominence: "normal" | "prominent";
  expanded: boolean;
  detailMode: ConversationDisclosureDetailAvailability;
  reason: string;
};

export type ConversationReduceResult<T> =
  | { kind: "applied"; state: T }
  | { kind: "duplicate"; state: T }
  | { kind: "reset_required"; reason: string; state: T };

export type ConversationLiveAnswerReduceResult =
  | ConversationReduceResult<ConversationLiveAnswerState>
  | { kind: "rejected"; reason: string; state: ConversationLiveAnswerState };

const goalLifecycleMap = {
  planning: "queued",
  executing: "running",
  waiting_for_review: "waiting_for_review",
  waiting_for_acceptance: "waiting_for_acceptance",
  waiting_for_model: "waiting_for_model",
  achieved: "succeeded",
  completed_unverified: "completed_unverified",
  stopped_budget: "blocked",
  stopped_stalled: "blocked",
  stopped_blocked: "blocked",
  failed: "failed",
  canceled: "canceled",
} satisfies Record<GoalStatus, ConversationDisclosureLifecycle>;

const planLifecycleMap = {
  drafting: "running",
  paused: "paused",
  awaiting_input: "waiting_for_user",
  awaiting_confirmation: "waiting_for_user",
  confirmed_pending_execution: "queued",
  executing: "running",
  steps_completed: "completed_unverified",
  completed: "succeeded",
  superseded: "canceled",
  discarded: "canceled",
  canceled: "canceled",
  failed: "failed",
} satisfies Record<PlanStatus, ConversationDisclosureLifecycle>;

const executionLifecycleMap = {
  queued: "queued",
  running: "running",
  waiting_for_approval: "waiting_for_approval",
  paused: "paused",
  succeeded: "succeeded",
  failed: "failed",
  canceled: "canceled",
} satisfies Record<AgentExecutionStatus, ConversationDisclosureLifecycle>;

const workspaceRunLifecycleMap = {
  queued: "queued",
  running: "running",
  waiting_for_user: "waiting_for_user",
  waiting_for_approval: "waiting_for_approval",
  paused: "paused",
  succeeded: "succeeded",
  failed: "failed",
  canceled: "canceled",
} satisfies Record<WorkspaceRunStatus, ConversationDisclosureLifecycle>;

const toolLifecycleMap = {
  proposed: "queued",
  visible: "queued",
  authorized: "queued",
  waiting_approval: "waiting_for_approval",
  running: "running",
  completed: "succeeded",
  error: "failed",
  recovered: "succeeded",
  aborted: "canceled",
} satisfies Record<ToolInvocationStatus, ConversationDisclosureLifecycle>;

const kernelLifecycleMap = {
  queued: "queued",
  running: "running",
  waiting_for_approval: "waiting_for_approval",
  paused: "paused",
  succeeded: "succeeded",
  failed: "failed",
  canceled: "canceled",
} satisfies Record<KernelRunStatus, ConversationDisclosureLifecycle>;

const chatActivityLifecycleMap = {
  started: "running",
  workspace: "running",
  skill: "running",
  skill_load: "running",
  memory: "running",
  memory_scope: "running",
  history: "running",
  context: "running",
  model: "running",
  reasoning: "running",
  streaming: "running",
  requirement: "running",
  actor_spawned: "running",
  actor_done: "running",
  tool_invocation: "running",
  tool_call: "running",
  tool_result: "running",
  checkpoint_boundary: "running",
  waiting_for_input: "waiting_for_user",
  paused: "paused",
  canceled: "canceled",
  completed: "succeeded",
  failed: "failed",
} satisfies Record<
  ChatTaskStatusEvent["state"],
  ConversationDisclosureLifecycle
>;

const approvalLifecycleMap = {
  pending: "waiting_for_approval",
  approved: "succeeded",
  denied_or_interrupted: "canceled",
} satisfies Record<
  ConversationApprovalObservationStatus,
  ConversationDisclosureLifecycle
>;

const guidedInputLifecycleMap = {
  pending: "waiting_for_user",
  processing: "running",
  completed: "succeeded",
  failed: "failed",
  canceled: "canceled",
  superseded: "canceled",
} satisfies Record<
  SkillPendingInputState["status"],
  ConversationDisclosureLifecycle
>;

const contextLifecycleMap = {
  observed: "succeeded",
  compacted: "succeeded",
  compacted_degraded: "completed_unverified",
} satisfies Record<
  ConversationContextObservationStatus,
  ConversationDisclosureLifecycle
>;

const usageLifecycleMap = {
  measured: "succeeded",
  estimated: "completed_unverified",
  partial: "completed_unverified",
} satisfies Record<
  ConversationUsageObservationStatus,
  ConversationDisclosureLifecycle
>;

const trajectoryObservationTypes = [
  "run_context_created",
  "state_transition",
  "goal_planned",
  "milestone_started",
  "goal_replanned",
  "goal_resume_circuit_broken",
  "goal_review_requested",
  "goal_stopped",
  "goal_judged",
  "model_request",
  "model_retry",
  "model_response",
  "model_reasoning",
  "skill_invoked",
  "skill_loaded",
  "tool_call",
  "tool_invocation",
  "tool_result",
  "native_tool_invocation",
  "native_tool_observation",
  "checkpoint_written",
  "checkpoint_boundary",
  "context_compacted",
  "context_rebuilt",
  "task_gate_checked",
  "memory_scope_recalled",
  "history_indexed",
  "history_searched",
  "acceptance_checked",
  "acceptance_manifest_created",
  "acceptance_failure_classified",
  "acceptance_repair_scheduled",
  "acceptance_strategy_changed",
  "acceptance_retry_scheduled",
  "acceptance_retry_started",
  "acceptance_retry_exhausted",
  "acceptance_waiting_for_user",
  "acceptance_manual_completion_requested",
  "acceptance_manual_completion_recorded",
  "acceptance_blocked",
  "acceptance_certified",
  "artifact_created",
  "workspace_escape_denied",
  "child_run_scheduled",
  "child_handoff_created",
  "child_handoff_completed",
  "child_handoff_reviewed",
  "actor_spawned",
  "actor_done",
  "actor_message_sent",
  "actor_message_reentered",
  "actor_message_undelivered",
  "workflow_started",
  "workflow_phase",
  "workflow_completed",
  "workflow_error",
  "workflow_fact_capped",
  "dream_started",
  "dream_completed",
  "dream_memory_written",
  "distill_started",
  "distill_completed",
  "distill_skill_packaged",
  "reflection_added",
  "strategy_guard_triggered",
  "failure_classified",
  "final_summary",
] as const satisfies readonly AgentTrajectoryEventType[];

type MissingTrajectoryObservation = Exclude<
  AgentTrajectoryEventType,
  (typeof trajectoryObservationTypes)[number]
>;

const trajectoryObservationTypesComplete:
  MissingTrajectoryObservation extends never ? true : false = true;

const knownStatuses: {
  [K in ConversationFactKind]: ReadonlySet<ConversationDomainStatusMap[K]>;
} = {
  chat_activity: new Set(Object.keys(chatActivityLifecycleMap)) as ReadonlySet<
    ConversationDomainStatusMap["chat_activity"]
  >,
  chat_message: new Set(["assistant", "user"]),
  goal: new Set(Object.keys(goalLifecycleMap)) as ReadonlySet<GoalStatus>,
  plan: new Set(Object.keys(planLifecycleMap)) as ReadonlySet<PlanStatus>,
  scheduled_run: new Set(Object.keys(executionLifecycleMap)) as ReadonlySet<
    AgentExecutionStatus
  >,
  agent_run: new Set(Object.keys(executionLifecycleMap)) as ReadonlySet<
    AgentExecutionStatus
  >,
  trajectory: new Set<AgentTrajectoryEventType>(
    trajectoryObservationTypesComplete ? trajectoryObservationTypes : [],
  ),
  workspace_run: new Set(
    Object.keys(workspaceRunLifecycleMap),
  ) as ReadonlySet<WorkspaceRunStatus>,
  tool_invocation: new Set(Object.keys(toolLifecycleMap)) as ReadonlySet<
    ToolInvocationStatus
  >,
  approval: new Set(Object.keys(approvalLifecycleMap)) as ReadonlySet<
    ConversationApprovalObservationStatus
  >,
  guided_input: new Set(Object.keys(guidedInputLifecycleMap)) as ReadonlySet<
    SkillPendingInputState["status"]
  >,
  context: new Set(Object.keys(contextLifecycleMap)) as ReadonlySet<
    ConversationContextObservationStatus
  >,
  usage: new Set(Object.keys(usageLifecycleMap)) as ReadonlySet<
    ConversationUsageObservationStatus
  >,
  kernel: new Set(Object.keys(kernelLifecycleMap)) as ReadonlySet<KernelRunStatus>,
};

const factKinds = new Set<ConversationFactKind>([
  "chat_activity",
  "chat_message",
  "goal",
  "plan",
  "scheduled_run",
  "agent_run",
  "trajectory",
  "workspace_run",
  "tool_invocation",
  "approval",
  "guided_input",
  "context",
  "usage",
  "kernel",
]);

export function createConversationDisclosureScope(input: {
  surface: ConversationDisclosureSurface;
  queryHash: string;
  sessionId?: string;
  goalId?: string;
  runId?: string;
}): ConversationDisclosureScope {
  const key = createTupleIdentity("scope", [
    String(CONVERSATION_DISCLOSURE_PROJECTION_VERSION),
    input.surface,
    input.sessionId ?? "",
    input.goalId ?? "",
    input.runId ?? "",
    input.queryHash,
  ]);
  return { ...input, key };
}

export function createConversationDisclosureItemId(
  source:
    | { kind: ConversationFactKind; ref: string }
    | { kind: "unknown"; originalKind: string; ref: string },
  semanticSlot: string,
): string {
  return createTupleIdentity("item", [
    String(CONVERSATION_DISCLOSURE_SCHEMA_VERSION),
    source.kind,
    source.kind === "unknown" ? source.originalKind : "",
    source.ref,
    semanticSlot,
  ]);
}

export function createConversationDisclosureSourceRef(
  fact: ConversationDisclosureFact,
  role: ConversationDisclosureSourceRef["role"],
): ConversationDisclosureSourceRef {
  return sourceFromFact(fact, role);
}

export function createConversationDisclosureDeltaId(
  delta: ConversationDisclosureDeltaBody,
) {
  return `delta:${fnv1a64(canonicalSerialize(delta))}`;
}

export function createLegacyConversationRef(input: {
  kind: string;
  scopeKey: string;
  semanticSlot: string;
  requestId?: string;
  sequence?: number;
  stableSummary: string;
}): string {
  return `legacy:${fnv1a64(createTupleIdentity("legacy", [
    input.kind,
    input.scopeKey,
    input.semanticSlot,
    input.requestId ?? "",
    Number.isInteger(input.sequence) ? String(input.sequence) : "",
    input.requestId || Number.isInteger(input.sequence) ? "" : input.stableSummary,
  ]))}`;
}

export function isKnownConversationFactKind(
  value: unknown,
): value is ConversationFactKind {
  return typeof value === "string" && factKinds.has(value as ConversationFactKind);
}

export function isKnownConversationDomainStatus<
  K extends ConversationFactKind,
>(kind: K, value: unknown): value is ConversationDomainStatusMap[K] {
  return typeof value === "string"
    && (knownStatuses[kind] as ReadonlySet<string>).has(value);
}

export function mapConversationFactLifecycle(
  fact: ConversationDisclosureFact,
): ConversationDisclosureLifecycle {
  switch (fact.kind) {
    case "chat_activity":
      return chatActivityLifecycleMap[fact.domainStatus];
    case "chat_message":
      return "succeeded";
    case "goal":
      return goalLifecycleMap[fact.domainStatus];
    case "plan":
      return fact.payload.actionGate === "blocked"
        ? "blocked"
        : planLifecycleMap[fact.domainStatus];
    case "scheduled_run":
    case "agent_run":
      return executionLifecycleMap[fact.domainStatus];
    case "trajectory":
      return mapTrajectoryObservation(fact.payload.owningStatus);
    case "workspace_run":
      return workspaceRunLifecycleMap[fact.domainStatus];
    case "tool_invocation":
      return toolLifecycleMap[fact.domainStatus];
    case "approval":
      return approvalLifecycleMap[fact.domainStatus];
    case "guided_input":
      return guidedInputLifecycleMap[fact.domainStatus];
    case "context":
      return contextLifecycleMap[fact.domainStatus];
    case "usage":
      return usageLifecycleMap[fact.domainStatus];
    case "kernel":
      return kernelLifecycleMap[fact.domainStatus];
  }
}

export function sanitizeConversationDisclosureSummary(
  input: string,
  options: { maxBytes?: number; maxLines?: number } = {},
): { text: string; redacted: boolean; truncated: boolean } {
  const maxBytes = positiveInteger(
    options.maxBytes,
    CONVERSATION_DISCLOSURE_SUMMARY_MAX_BYTES,
  );
  const maxLines = positiveInteger(
    options.maxLines,
    CONVERSATION_DISCLOSURE_SUMMARY_MAX_LINES,
  );
  const normalized = String(input ?? "").replace(/\r\n?/g, "\n");
  const redactedText = redactConversationDisclosurePaths(
    redactCredentialString(normalized).replace(
      /\bsk-(?:proj-)?[A-Za-z0-9_-]{6,}\b/g,
      "[redacted]",
    ),
  );
  const redacted = redactedText !== normalized;
  const lines = redactedText.split("\n");
  const lineBounded = lines.length > maxLines
    ? `${lines.slice(0, maxLines).join("\n")}\n…`
    : redactedText;
  const byteBounded = truncateUtf8(lineBounded, maxBytes);
  return {
    text: byteBounded.text,
    redacted,
    truncated: lines.length > maxLines || byteBounded.truncated,
  };
}

export function redactConversationDisclosurePaths(value: string): string {
  return value
    .replace(
      /\b(?:file|vscode-file|vscode-remote|ssh):(?:\/\/)?[^\r\n,;>"'`]*/gi,
      "[redacted-path]",
    )
    .replace(
      /(^|[\s(<[{"'`=:])(?:~\/|\.{1,2}\/|\/(?!\/)|[A-Za-z]:\\|\\\\)[^\r\n,;>)\]}"'`]*/g,
      (_match, prefix: string) => `${prefix}[redacted-path]`,
    )
    .replace(
      /(^|[\s(<[{"'`=:])(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+(?=$|[\s>),\]};"'`])/g,
      (_match, prefix: string) => `${prefix}[redacted-path]`,
    )
    .replace(
      /(^|[\s(<[{"'`=:])(?:[A-Za-z0-9._-]+\\)+[A-Za-z0-9._-]+(?=$|[\s>),\]};"'`])/g,
      (_match, prefix: string) => `${prefix}[redacted-path]`,
    );
}

export function projectConversationDisclosureItem(
  seed: ConversationProjectionSeed,
): ConversationDisclosureItem {
  const canonicalPrimaryScope = createConversationDisclosureScope(seed.primary.scope);
  if (!sameDisclosureScope(seed.primary.scope, canonicalPrimaryScope)) {
    throw new Error("conversation disclosure primary scope must be canonical");
  }
  if ((seed.contributors ?? []).some(
    (contributor) => !sameDisclosureScope(seed.primary.scope, contributor.scope),
  )) {
    throw new Error("conversation disclosure contributors must share primary scope");
  }
  const primarySource = sourceFromFact(seed.primary, "primary");
  const lifecycle = mapConversationFactLifecycle(seed.primary);
  const sanitized = sanitizeConversationDisclosureSummary(
    seed.primary.payload.summary,
  );
  const contributorRefs = normalizeContributorRefs(
    (seed.contributors ?? []).map((fact) => sourceFromFact(fact, "contributor")),
  );
  const itemId = createConversationDisclosureItemId(
    primarySource,
    seed.primary.payload.semanticSlot,
  );
  const contributorPage = createConversationContributorPage({
    scopeKey: seed.primary.scope.key,
    itemId,
    contributors: contributorRefs,
  });
  if (contributorPage.kind !== "page") {
    throw new Error("initial contributor page unexpectedly requires reset");
  }
  const evidenceTarget = seed.primary.payload.evidenceTarget;
  const detailAvailability = seed.primary.sensitivity === "restricted"
    ? evidenceTarget
      ? "evidence"
      : "none"
    : seed.primary.payload.detailAvailability
      ?? (evidenceTarget ? "evidence" : "none");
  return {
    schemaVersion: 1,
    projectionVersion: 1,
    id: itemId,
    primarySource,
    contributors: contributorPage.refs,
    contributorCount: contributorPage.total,
    contributorsComplete:
      contributorPage.complete && seed.contributorsComplete !== false,
    contributorSetComplete: seed.contributorsComplete !== false,
    ...(contributorPage.nextCursor
      ? { contributorCursor: contributorPage.nextCursor }
      : {}),
    scope: clonePlainData(seed.primary.scope),
    ...(seed.primary.payload.requestId
      ? { requestId: seed.primary.payload.requestId }
      : {}),
    ...(seed.primary.payload.turnId
      ? { turnId: seed.primary.payload.turnId }
      : {}),
    ...(seed.primary.payload.runId
      ? { runId: seed.primary.payload.runId }
      : {}),
    ...projectTelemetryFields(seed.primary),
    lifecycle,
    disclosureClass: seed.primary.payload.disclosureClass,
    attention: deriveConversationAttention(
      lifecycle,
      Boolean(seed.primary.payload.actionRequired),
    ),
    sensitivity: seed.primary.sensitivity,
    summary: sanitized.text,
    summaryRedacted: sanitized.redacted,
    summaryTruncated: sanitized.truncated,
    detailAvailability,
    ...(evidenceTarget ? { evidenceTarget: clonePlainData(evidenceTarget) } : {}),
    occurredAt: seed.primary.occurredAt,
  };
}

function projectTelemetryFields(
  fact: ConversationDisclosureFact,
): Pick<
  ConversationDisclosureItem,
  | "estimatedTokens"
  | "tokenBudget"
  | "compactionCount"
  | "totalTokens"
  | "promptTokens"
  | "completionTokens"
> {
  if (fact.kind === "context") {
    return {
      ...(fact.payload.estimatedTokens !== undefined
        ? { estimatedTokens: fact.payload.estimatedTokens }
        : {}),
      ...(fact.payload.tokenBudget !== undefined
        ? { tokenBudget: fact.payload.tokenBudget }
        : {}),
      ...(fact.payload.compactionCount !== undefined
        ? { compactionCount: fact.payload.compactionCount }
        : {}),
    };
  }
  if (fact.kind === "usage") {
    return {
      ...(fact.payload.totalTokens !== undefined
        ? { totalTokens: fact.payload.totalTokens }
        : {}),
      ...(fact.payload.promptTokens !== undefined
        ? { promptTokens: fact.payload.promptTokens }
        : {}),
      ...(fact.payload.completionTokens !== undefined
        ? { completionTokens: fact.payload.completionTokens }
        : {}),
    };
  }
  return {};
}

export function createConversationContributorPage(input: {
  scopeKey: string;
  itemId: string;
  contributors: ConversationDisclosureSourceRef[];
  cursor?: string;
  limit?: number;
}):
  | {
      kind: "page";
      refs: ConversationDisclosureSourceRef[];
      total: number;
      complete: boolean;
      nextCursor?: string;
    }
  | { kind: "reset_required"; reason: string } {
  const contributors = normalizeConversationContributorRefs(
    input.contributors,
  );
  const limit = Math.min(
    CONVERSATION_DISCLOSURE_CONTRIBUTOR_PAGE_LIMIT,
    positiveInteger(input.limit, CONVERSATION_DISCLOSURE_CONTRIBUTOR_PAGE_LIMIT),
  );
  const setFingerprint = fnv1a64(
    contributors.map(sourceIdentityKey).join("\n"),
  );
  const scopeFingerprint = fnv1a64(input.scopeKey);
  const itemFingerprint = fnv1a64(input.itemId);
  let offset = 0;
  if (input.cursor) {
    const parsed = parseContributorCursor(input.cursor);
    if (
      !parsed
      || parsed.scope !== scopeFingerprint
      || parsed.item !== itemFingerprint
      || parsed.set !== setFingerprint
      || parsed.offset > contributors.length
    ) {
      return { kind: "reset_required", reason: "contributor_cursor_mismatch" };
    }
    offset = parsed.offset;
  }
  const refs = contributors.slice(offset, offset + limit);
  const nextOffset = offset + refs.length;
  const complete = nextOffset >= contributors.length;
  return {
    kind: "page",
    refs,
    total: contributors.length,
    complete,
    ...(!complete
      ? {
          nextCursor: [
            "cc1",
            scopeFingerprint,
            itemFingerprint,
            setFingerprint,
            String(nextOffset),
          ].join(":"),
        }
      : {}),
  };
}

export function normalizeConversationContributorRefs(
  refs: ConversationDisclosureSourceRef[],
): ConversationDisclosureSourceRef[] {
  return normalizeContributorRefs(refs);
}

export function projectConversationDisclosureContributorSets(input: {
  scope: ConversationDisclosureScope;
  seeds: ConversationProjectionSeed[];
}): Array<{
  itemId: string;
  refs: ConversationDisclosureSourceRef[];
}> {
  const canonicalScope = createConversationDisclosureScope(input.scope);
  const selected = selectProjectionSeeds(
    input.seeds
      .filter((seed) => sameDisclosureScope(seed.primary.scope, canonicalScope))
      .map((seed) => ({
        primary: seed.primary,
        contributors: (seed.contributors ?? []).filter(
          (contributor) =>
            sameDisclosureScope(contributor.scope, canonicalScope),
        ),
        contributorsComplete: seed.contributorsComplete,
      })),
  );
  return selected.map(({ item, seed }) => ({
    itemId: item.id,
    refs: normalizeContributorRefs(
      seed.contributors.map((fact) => sourceFromFact(fact, "contributor")),
    ),
  }));
}

export function createConversationContributorAuthorityRevision(input: {
  generation: string;
  item: Pick<
    ConversationDisclosureItem,
    | "id"
    | "contributors"
    | "contributorCount"
    | "contributorsComplete"
    | "contributorSetComplete"
    | "contributorCursor"
  >;
}): string {
  return `contributors:${fnv1a64(canonicalSerialize({
    generation: input.generation,
    itemId: input.item.id,
    contributorCount: input.item.contributorCount,
    contributorsComplete: input.item.contributorsComplete,
    contributorSetComplete: input.item.contributorSetComplete ?? true,
    contributorCursor: input.item.contributorCursor ?? null,
    contributors: input.item.contributors,
  }))}`;
}

export function resolveConversationDisclosurePolicy(input: {
  item: ConversationDisclosureItem;
  preference?: ConversationDisclosurePreference;
  volume?: number;
}): ConversationDisclosurePolicyResult {
  const preference = input.preference ?? "auto";
  const item = input.item;
  const prominent = item.attention !== "normal";
  const autoExpanded = item.attention === "blocking"
    || item.lifecycle === "failed"
    || item.lifecycle === "blocked"
    || item.lifecycle === "completed_unverified"
    || item.lifecycle === "waiting_for_user"
    || item.lifecycle === "waiting_for_approval"
    || item.lifecycle === "waiting_for_review"
    || item.lifecycle === "waiting_for_acceptance"
    || (item.lifecycle === "waiting_for_model" && prominent);
  const expanded = preference === "open" || preference === "pinned"
    ? true
    : preference === "closed"
      ? false
      : autoExpanded;
  const detailMode = item.sensitivity === "restricted"
    ? item.evidenceTarget
      ? "evidence"
      : "none"
    : item.detailAvailability;
  return {
    visible: true,
    prominence: prominent ? "prominent" : "normal",
    expanded,
    detailMode,
    reason: preference === "auto"
      ? autoExpanded
        ? "automatic_attention"
        : positiveInteger(input.volume, 1) > 4
          ? "automatic_density"
          : "automatic_compact"
      : `user_${preference}`,
  };
}

export function projectConversationDisclosureSnapshot(input: {
  scope: ConversationDisclosureScope;
  generation: string;
  cursor?: number;
  expectedSourceCuts: ConversationSourceCut[];
  seeds: ConversationProjectionSeed[];
  unknownFacts?: ConversationUnknownFact[];
  activeAttempts?: ActiveConversationAttempt[];
  attemptSettlements?: ConversationAttemptSettlement[];
}): ConversationDisclosureSnapshot {
  const canonicalScope = createConversationDisclosureScope(input.scope);
  const scopedSeeds = input.seeds
    .filter((seed) => sameDisclosureScope(seed.primary.scope, canonicalScope))
    .map((seed) => ({
      primary: seed.primary,
      contributors: (seed.contributors ?? []).filter(
        (contributor) => sameDisclosureScope(contributor.scope, canonicalScope),
      ),
      contributorsComplete: seed.contributorsComplete,
    }));
  const selected = selectProjectionSeeds(scopedSeeds);
  const items = selected.map((entry) => entry.item);
  const sourceCuts = mergeInitialSourceCuts(
    input.expectedSourceCuts,
    [
      ...inferSourceCuts(selected.map((entry) => entry.seed)),
      ...selected.flatMap((entry) => entry.conflictCut
        ? [entry.conflictCut]
        : []),
    ],
  );
  const reasonCodes: string[] = [];
  for (const seed of input.seeds) {
    if (sameDisclosureScope(seed.primary.scope, canonicalScope)) continue;
    sourceCuts.push({
      source: seed.primary.kind,
      sourceIdentity: sourceCutIdentity(seed.primary),
      requiredness: seed.primary.requiredness,
      status: "incompatible",
      reasonCode: "fact_scope_mismatch",
    });
    reasonCodes.push(`fact_scope_mismatch:${seed.primary.kind}`);
  }
  for (const contributor of input.seeds.flatMap(
    (seed) => seed.contributors ?? [],
  )) {
    if (sameDisclosureScope(contributor.scope, canonicalScope)) continue;
    sourceCuts.push({
      source: contributor.kind,
      sourceIdentity: sourceCutIdentity(contributor),
      requiredness: contributor.requiredness,
      status: "incompatible",
      reasonCode: "contributor_scope_mismatch",
    });
    reasonCodes.push(`contributor_scope_mismatch:${contributor.kind}`);
  }
  for (const unknown of dedupeUnknownFacts(input.unknownFacts ?? [])) {
    if (!sameDisclosureScope(unknown.scope, canonicalScope)) {
      sourceCuts.push({
        source: "unknown",
        sourceIdentity: `record:${unknown.authorityRef}`,
        originalKind: unknown.originalKind,
        requiredness: unknown.requiredness,
        status: "incompatible",
        reasonCode: "fact_scope_mismatch",
      });
      reasonCodes.push(`fact_scope_mismatch:${unknown.originalKind}`);
      continue;
    }
    const cutBase: Omit<ConversationSourceCut, "status"> = {
      source: "unknown",
      originalKind: unknown.originalKind,
      requiredness: unknown.requiredness,
      ...(unknown.domainRevision ? { cursor: unknown.domainRevision } : {}),
    };
    if (unknown.requiredness === "required") {
      reasonCodes.push(`unknown_required:${unknown.originalKind}`);
      sourceCuts.push({
        ...cutBase,
        sourceIdentity: `record:${unknown.authorityRef}`,
        status: "incompatible",
        reasonCode: "unknown_required_fact",
      });
      continue;
    }
    if (unknown.requiredness === "ignorable") {
      sourceCuts.push({
        ...cutBase,
        sourceIdentity: unknown.scope.key,
        status: "complete",
        reasonCode: "unknown_ignorable_fact",
        ignoredUnknownCount: 1,
      });
      continue;
    }
    reasonCodes.push(`unknown_optional:${unknown.originalKind}`);
    sourceCuts.push({
      ...cutBase,
      sourceIdentity: `record:${unknown.authorityRef}`,
      status: "partial",
      reasonCode: "unknown_optional_fact",
    });
    items.push(projectUnknownItem(unknown));
  }
  const normalizedCuts = normalizeSourceCuts(sourceCuts);
  const coverage = deriveCoverageFromCuts(normalizedCuts, reasonCodes);
  const activeAttempts = normalizeActiveAttempts(input.activeAttempts ?? []);
  const attemptSettlements = normalizeAttemptSettlements(
    input.attemptSettlements ?? [],
  );
  const attemptConflict = findAttemptStateConflict(
    input.activeAttempts ?? [],
    input.attemptSettlements ?? [],
  );
  if (attemptConflict) {
    throw new Error(`invalid conversation attempt snapshot: ${attemptConflict}`);
  }
  return {
    schemaVersion: 1,
    projectionVersion: 1,
    scope: clonePlainData(canonicalScope),
    generation: input.generation,
    cursor: nonNegativeInteger(input.cursor, 0),
    sourceCuts: normalizedCuts,
    coverage,
    activeAttempts,
    attemptSettlements,
    items: items.sort(compareItems),
  };
}

export function applyConversationDisclosureDelta(
  snapshot: ConversationDisclosureSnapshot,
  delta: ConversationDisclosureDelta,
): ConversationReduceResult<ConversationDisclosureSnapshot> {
  if (delta.resetRequired) {
    return { kind: "reset_required", reason: "explicit_reset", state: snapshot };
  }
  if (delta.schemaVersion !== snapshot.schemaVersion) {
    return { kind: "reset_required", reason: "schema_mismatch", state: snapshot };
  }
  if (delta.projectionVersion !== snapshot.projectionVersion) {
    return { kind: "reset_required", reason: "projection_mismatch", state: snapshot };
  }
  if (
    delta.scopeKey !== snapshot.scope.key
    || delta.queryHash !== snapshot.scope.queryHash
  ) {
    return { kind: "reset_required", reason: "scope_mismatch", state: snapshot };
  }
  if (delta.generation !== snapshot.generation) {
    return { kind: "reset_required", reason: "generation_mismatch", state: snapshot };
  }
  if (!validCursor(delta.fromCursor)
    || !validCursor(delta.toCursor)
    || delta.toCursor <= delta.fromCursor
    || !delta.deltaId) {
    return { kind: "reset_required", reason: "invalid_cursor", state: snapshot };
  }
  const { deltaId: _deltaId, ...deltaBody } = delta;
  if (delta.deltaId !== createConversationDisclosureDeltaId(deltaBody)) {
    return { kind: "reset_required", reason: "invalid_delta_id", state: snapshot };
  }
  if (delta.toCursor < snapshot.cursor) {
    return {
      kind: "reset_required",
      reason: "historical_delta_unverified",
      state: snapshot,
    };
  }
  if (delta.toCursor === snapshot.cursor) {
    return delta.deltaId === snapshot.lastDeltaId
      ? { kind: "duplicate", state: snapshot }
      : {
          kind: "reset_required",
          reason: "conflicting_duplicate_delta",
          state: snapshot,
        };
  }
  if (delta.fromCursor < snapshot.cursor) {
    return { kind: "reset_required", reason: "cursor_overlap", state: snapshot };
  }
  if (delta.fromCursor > snapshot.cursor) {
    return { kind: "reset_required", reason: "cursor_gap", state: snapshot };
  }
  const removalSet = new Set(delta.removals);
  if (delta.upserts.some((item) => removalSet.has(item.id))) {
    return { kind: "reset_required", reason: "conflicting_item_mutation", state: snapshot };
  }
  if (delta.upserts.some(
    (item) => !sameDisclosureScope(item.scope, snapshot.scope),
  )) {
    return { kind: "reset_required", reason: "item_scope_mismatch", state: snapshot };
  }
  for (const change of delta.sourceCutChanges) {
    const current = snapshot.sourceCuts.find(
      (cut) => sourceCutKey(cut) === sourceCutKey(change),
    );
    if (
      current
      && sourceCutRank(change) < sourceCutRank(current)
    ) {
      return {
        kind: "reset_required",
        reason: "source_cut_improved",
        state: snapshot,
      };
    }
  }
  const sourceCuts = mergeSourceCuts(snapshot.sourceCuts, delta.sourceCutChanges);
  if (sourceCuts.some(
    (cut) => cut.requiredness === "required" && cut.status === "incompatible",
  )) {
    return {
      kind: "reset_required",
      reason: "required_source_incompatible",
      state: snapshot,
    };
  }
  const coverage = normalizeCoverage(delta.coverage ?? snapshot.coverage);
  if (!coverageMatchesCuts(coverage, sourceCuts)) {
    return { kind: "reset_required", reason: "dishonest_coverage", state: snapshot };
  }
  const items = new Map(snapshot.items.map((item) => [item.id, item]));
  for (const id of delta.removals) items.delete(id);
  for (const item of delta.upserts) items.set(item.id, cloneDisclosureItem(item));
  const attempts = applyAttemptControls(
    snapshot.activeAttempts,
    snapshot.attemptSettlements,
    delta.attemptControls,
  );
  if (attempts.kind === "reset_required") {
    return { kind: "reset_required", reason: attempts.reason, state: snapshot };
  }
  return {
    kind: "applied",
    state: {
      ...snapshot,
      cursor: delta.toCursor,
      lastDeltaId: delta.deltaId,
      sourceCuts,
      coverage,
      activeAttempts: attempts.active,
      attemptSettlements: attempts.settled,
      items: [...items.values()].sort(compareItems),
    },
  };
}

export function reduceConversationLiveAnswer(
  state: ConversationLiveAnswerState,
  event: ConversationAttemptControl | ConversationLiveContentDelta,
  persistedMessage?: ConversationPersistedAssistantMessage,
): ConversationLiveAnswerReduceResult {
  if (!validSequence(event.sequence) || !Number.isInteger(event.attempt) || event.attempt < 1) {
    return { kind: "reset_required", reason: "invalid_attempt_sequence", state };
  }
  const key = attemptStreamKey(event.requestId, event.turnId);
  const current = state.streams.find(
    (stream) => attemptStreamKey(stream.requestId, stream.turnId) === key,
  );
  const fingerprint = fingerprintLiveEvent(event);
  if (current) {
    if (event.sequence < current.lastSequence) {
      return { kind: "duplicate", state };
    }
    if (event.sequence === current.lastSequence) {
      return current.lastEventFingerprint === fingerprint
        ? { kind: "duplicate", state }
        : { kind: "reset_required", reason: "conflicting_duplicate", state };
    }
    if (event.sequence > current.lastSequence + 1) {
      return { kind: "reset_required", reason: "attempt_sequence_gap", state };
    }
  } else if (event.sequence !== 1 || !("operation" in event) || event.operation !== "begin") {
    return { kind: "reset_required", reason: "attempt_missing_begin", state };
  }

  const next = reduceLiveStream(current, event, fingerprint, persistedMessage);
  if (next.kind !== "applied") return { ...next, state };
  const streams = state.streams.filter(
    (stream) => attemptStreamKey(stream.requestId, stream.turnId) !== key,
  );
  streams.push(next.stream);
  streams.sort((left, right) =>
    compareCanonicalStrings(
      attemptStreamKey(left.requestId, left.turnId),
      attemptStreamKey(right.requestId, right.turnId),
    ),
  );
  return { kind: "applied", state: { streams } };
}

export function createConversationAcceptedAttemptSettlement(input: {
  requestId: string;
  turnId: string;
  attempt: number;
  sequence: number;
  acceptedMessageId: string;
  persistedMessage: ConversationPersistedAssistantMessage;
}): ConversationAcceptedAttemptSettlement {
  if (!input.requestId || !input.turnId || input.attempt < 1 || !validSequence(input.sequence)) {
    throw new Error("invalid accepted attempt lineage");
  }
  if (input.persistedMessage.role !== "assistant") {
    throw new Error("accepted message must be an assistant message");
  }
  if (
    input.persistedMessage.id !== input.acceptedMessageId
    || input.persistedMessage.requestId !== input.requestId
    || input.persistedMessage.turnId !== input.turnId
  ) {
    throw new Error("accepted message lineage mismatch");
  }
  const acceptEvent: ConversationAttemptControl = {
    requestId: input.requestId,
    turnId: input.turnId,
    attempt: input.attempt,
    sequence: input.sequence,
    operation: "accept",
    acceptedMessageId: input.acceptedMessageId,
  };
  const base = {
    requestId: input.requestId,
    turnId: input.turnId,
    attempt: input.attempt,
    outcome: "accepted" as const,
    lastSequence: input.sequence,
    lastEventFingerprint: fingerprintLiveEvent(acceptEvent),
    acceptedMessageId: input.acceptedMessageId,
    acceptedMessageRole: "assistant" as const,
    acceptedContentFingerprint: fnv1a64(input.persistedMessage.content),
    ...(input.persistedMessage.turnSettlementStatus
      ? { acceptedTurnSettlementStatus: input.persistedMessage.turnSettlementStatus }
      : {}),
  };
  return {
    ...base,
    acceptanceReceiptFingerprint: fingerprintAcceptedReceipt(base),
  };
}

export function getActiveConversationAttempts(
  state: ConversationLiveAnswerState,
): ActiveConversationAttempt[] {
  return state.streams
    .filter((stream) => stream.active)
    .map((stream) => ({
      requestId: stream.requestId,
      turnId: stream.turnId,
      attempt: stream.active!.attempt,
      lastSequence: stream.lastSequence,
      answerText: stream.active!.answerText,
    }))
    .sort(compareAttempts);
}

export function classifyConversationRuntimeObservation(input: {
  kind: unknown;
  domainStatus: unknown;
  requiredness: unknown;
  durability?: unknown;
  sensitivity?: unknown;
  authorityRef?: unknown;
  domainRevision?: unknown;
  requestId?: unknown;
  sequence?: unknown;
  scope: ConversationDisclosureScope;
  semanticSlot: string;
  safeSummary: string;
  occurredAt: string;
}):
  | {
      kind: "known";
      factKind: ConversationFactKind;
      domainStatus: string;
    }
  | { kind: "unknown"; fact: ConversationUnknownFact } {
  const requiredness = isRequiredness(input.requiredness)
    ? input.requiredness
    : "required";
  const originalKind = typeof input.kind === "string" && input.kind
    ? input.kind
    : "invalid";
  const status = typeof input.domainStatus === "string"
    ? input.domainStatus
    : "invalid";
  if (
    isKnownConversationFactKind(input.kind)
    && isKnownConversationDomainStatus(input.kind, input.domainStatus)
    && typeof input.authorityRef === "string"
    && input.authorityRef.length > 0
  ) {
    return {
      kind: "known",
      factKind: input.kind,
      domainStatus: input.domainStatus,
    };
  }
  const authorityRef = typeof input.authorityRef === "string"
    && input.authorityRef
    ? input.authorityRef
    : createLegacyConversationRef({
        kind: originalKind,
        scopeKey: input.scope.key,
        semanticSlot: input.semanticSlot,
        ...(typeof input.requestId === "string" && input.requestId
          ? { requestId: input.requestId }
          : {}),
        ...(typeof input.sequence === "number" && Number.isSafeInteger(input.sequence)
          ? { sequence: input.sequence }
          : {}),
        stableSummary: input.safeSummary,
      });
  return {
    kind: "unknown",
    fact: {
      schemaVersion: CONVERSATION_DISCLOSURE_SCHEMA_VERSION,
      originalKind,
      authorityRef,
      scope: input.scope,
      ...(typeof input.domainRevision === "string" && input.domainRevision
        ? { domainRevision: input.domainRevision }
        : {}),
      domainStatus: status,
      requiredness,
      durability: isDurability(input.durability) ? input.durability : "durable",
      sensitivity: isSensitivity(input.sensitivity)
        ? input.sensitivity
        : "technical",
      occurredAt: input.occurredAt,
      semanticSlot: input.semanticSlot,
      safeSummary: input.safeSummary,
    },
  };
}

function mapTrajectoryObservation(
  owningStatus: ConversationFactPayloadMap["trajectory"]["owningStatus"],
): ConversationDisclosureLifecycle {
  if (!owningStatus) return "unknown";
  return owningStatus.kind === "goal"
    ? goalLifecycleMap[owningStatus.status]
    : executionLifecycleMap[owningStatus.status];
}

function sourceFromFact(
  fact: ConversationDisclosureFact,
  role: ConversationTypedSourceRef["role"],
): ConversationTypedSourceRef {
  return {
    kind: fact.kind,
    ref: fact.authorityRef,
    ...(fact.domainRevision ? { domainRevision: fact.domainRevision } : {}),
    domainStatus: fact.domainStatus,
    role,
  } as ConversationTypedSourceRef;
}

function projectUnknownItem(
  fact: ConversationUnknownFact,
): ConversationDisclosureItem {
  const source: ConversationUnknownSourceRef = {
    kind: "unknown",
    originalKind: fact.originalKind,
    ref: fact.authorityRef,
    ...(fact.domainRevision ? { domainRevision: fact.domainRevision } : {}),
    domainStatus: fact.domainStatus,
    role: "primary",
  };
  const sanitized = sanitizeConversationDisclosureSummary(fact.safeSummary);
  const evidenceTarget: ConversationEvidenceTarget = {
    schemaVersion: 1,
    kind: "generic_source",
    source: clonePlainData(source),
  };
  return {
    schemaVersion: 1,
    projectionVersion: 1,
    id: createConversationDisclosureItemId(source, fact.semanticSlot),
    primarySource: source,
    contributors: [],
    contributorCount: 0,
    contributorsComplete: true,
    scope: clonePlainData(fact.scope),
    lifecycle: "unknown",
    disclosureClass: "evidence",
    attention: "normal",
    sensitivity: fact.sensitivity,
    summary: sanitized.text,
    summaryRedacted: sanitized.redacted,
    summaryTruncated: sanitized.truncated,
    detailAvailability: fact.sensitivity === "restricted" ? "none" : "evidence",
    evidenceTarget,
    occurredAt: fact.occurredAt,
  };
}

function deriveConversationAttention(
  lifecycle: ConversationDisclosureLifecycle,
  actionRequired: boolean,
): ConversationDisclosureAttention {
  switch (lifecycle) {
    case "waiting_for_user":
    case "waiting_for_approval":
    case "waiting_for_review":
    case "waiting_for_acceptance":
    case "blocked":
    case "failed":
      return "blocking";
    case "waiting_for_model":
      return actionRequired ? "blocking" : "needs_attention";
    case "paused":
    case "canceled":
    case "completed_unverified":
    case "unknown":
      return "needs_attention";
    case "queued":
    case "running":
    case "succeeded":
      return "normal";
  }
}

function inferSourceCuts(
  seeds: ConversationProjectionSeed[],
): ConversationSourceCut[] {
  const cuts: ConversationSourceCut[] = [];
  for (const fact of seeds.flatMap((seed) => [seed.primary, ...(seed.contributors ?? [])])) {
    const candidate: ConversationSourceCut = {
      source: fact.kind,
      sourceIdentity: sourceCutIdentity(fact),
      requiredness: fact.requiredness,
      status: fact.durability === "ephemeral" ? "ephemeral" : "complete",
      ...(fact.domainRevision ? { cursor: fact.domainRevision } : {}),
      ...(fact.durability === "ephemeral" ? { reasonCode: "ephemeral_source" } : {}),
    };
    cuts.push(candidate);
  }
  return normalizeSourceCuts(cuts);
}

function sourceCutIdentity(fact: ConversationDisclosureFact): string {
  return `record:${fact.authorityRef}`;
}

function normalizeContributorRefs(
  refs: ConversationDisclosureSourceRef[],
): ConversationDisclosureSourceRef[] {
  const byIdentity = new Map<string, ConversationDisclosureSourceRef>();
  for (const ref of refs) {
    const key = sourceIdentityKey(ref);
    if (!byIdentity.has(key)) byIdentity.set(key, ref);
  }
  return [...byIdentity.values()].sort((left, right) =>
    compareCanonicalStrings(
      sourceIdentityKey(left),
      sourceIdentityKey(right),
    ),
  );
}

function normalizeSourceCuts(cuts: ConversationSourceCut[]): ConversationSourceCut[] {
  const normalized = new Map<string, ConversationSourceCut>();
  for (const cut of cuts) {
    const key = sourceCutKey(cut);
    const existing = normalized.get(key);
    if (!existing) {
      normalized.set(key, { ...cut });
      continue;
    }
    normalized.set(key, combineSourceCuts(existing, cut));
  }
  return [...normalized.values()].sort((left, right) =>
    compareCanonicalStrings(sourceCutKey(left), sourceCutKey(right)),
  );
}

function combineSourceCuts(
  left: ConversationSourceCut,
  right: ConversationSourceCut,
): ConversationSourceCut {
  const requiredness = moreRestrictiveRequiredness(
    left.requiredness,
    right.requiredness,
  );
  const ignoredUnknownCount =
    (left.ignoredUnknownCount ?? 0) + (right.ignoredUnknownCount ?? 0);
  if (left.cursor && right.cursor && left.cursor !== right.cursor) {
    return {
      source: left.source,
      ...(left.sourceIdentity
        ? { sourceIdentity: left.sourceIdentity }
        : {}),
      ...(left.originalKind ? { originalKind: left.originalKind } : {}),
      requiredness,
      status: "incompatible",
      reasonCode: "source_cut_changed",
      ...(ignoredUnknownCount > 0 ? { ignoredUnknownCount } : {}),
    };
  }
  const status = sourceCutRank(left) >= sourceCutRank(right)
    ? left.status
    : right.status;
  const reasonCodes = [...new Set(
    [left.reasonCode, right.reasonCode].filter(
      (value): value is string => Boolean(value),
    ),
  )].sort();
  const reasonCode = reasonCodes.includes("source_cut_changed")
    ? "source_cut_changed"
    : reasonCodes.join("+");
  return {
    source: left.source,
    ...(left.sourceIdentity ? { sourceIdentity: left.sourceIdentity } : {}),
    ...(left.originalKind ? { originalKind: left.originalKind } : {}),
    ...(status !== "incompatible" && (left.cursor ?? right.cursor)
      ? { cursor: left.cursor ?? right.cursor }
      : {}),
    requiredness,
    status,
    ...(reasonCode
      ? { reasonCode }
      : {}),
    ...(ignoredUnknownCount > 0 ? { ignoredUnknownCount } : {}),
  };
}

function mergeSourceCuts(
  current: ConversationSourceCut[],
  changes: ConversationSourceCut[],
): ConversationSourceCut[] {
  const merged = new Map(
    current.map((cut) => [sourceCutKey(cut), { ...cut }]),
  );
  for (const change of changes) {
    const key = sourceCutKey(change);
    const existing = merged.get(key);
    merged.set(key, existing
      ? {
          ...change,
          requiredness: moreRestrictiveRequiredness(
            existing.requiredness,
            change.requiredness,
          ),
        }
      : { ...change });
  }
  return [...merged.values()].sort((left, right) =>
    compareCanonicalStrings(sourceCutKey(left), sourceCutKey(right)),
  );
}

function mergeInitialSourceCuts(
  expected: ConversationSourceCut[],
  observed: ConversationSourceCut[],
): ConversationSourceCut[] {
  const map = new Map(
    normalizeSourceCuts(expected).map((cut) => [sourceCutKey(cut), cut]),
  );
  for (const change of normalizeSourceCuts(observed)) {
    const key = sourceCutKey(change);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, change);
      continue;
    }
    map.set(key, combineSourceCuts(existing, change));
  }
  return normalizeSourceCuts([...map.values()]);
}

function normalizeCoverage(coverage: ConversationCoverage): ConversationCoverage {
  return {
    state: coverage.state,
    reasonCodes: [...new Set(coverage.reasonCodes)].sort(),
  };
}

function coverageMatchesCuts(
  coverage: ConversationCoverage,
  cuts: ConversationSourceCut[],
): boolean {
  const hasIncompatible = cuts.some((cut) => cut.status === "incompatible");
  const hasRequiredIncomplete = cuts.some(
    (cut) => cut.requiredness === "required" && cut.status !== "complete",
  );
  if ((hasIncompatible || hasRequiredIncomplete) && coverage.state !== "degraded") {
    return false;
  }
  const hasIncomplete = cuts.some(
    (cut) => cut.status !== "complete",
  );
  return !hasIncomplete || coverage.state !== "complete";
}

function deriveCoverageFromCuts(
  cuts: ConversationSourceCut[],
  reasonCodes: string[] = [],
): ConversationCoverage {
  const hasIncompatible = cuts.some((cut) => cut.status === "incompatible");
  const hasRequiredIncomplete = cuts.some(
    (cut) => cut.requiredness === "required" && cut.status !== "complete",
  );
  const hasIncomplete = cuts.some((cut) => cut.status !== "complete");
  return normalizeCoverage({
    state: hasIncompatible || hasRequiredIncomplete
      ? "degraded"
      : hasIncomplete
        ? "partial"
        : "complete",
    reasonCodes: [
      ...reasonCodes,
      ...cuts.flatMap((cut) => cut.reasonCode ? [cut.reasonCode] : []),
    ],
  });
}

function applyAttemptControls(
  activeAttempts: ActiveConversationAttempt[],
  settlements: ConversationAttemptSettlement[],
  controls: ConversationProjectionAttemptControl[],
):
  | {
      kind: "applied";
      active: ActiveConversationAttempt[];
      settled: ConversationAttemptSettlement[];
    }
  | { kind: "reset_required"; reason: string } {
  const snapshotConflict = findAttemptStateConflict(activeAttempts, settlements);
  if (snapshotConflict) {
    return { kind: "reset_required", reason: "attempt_snapshot_conflict" };
  }
  const active = new Map(
    normalizeActiveAttempts(activeAttempts).map((attempt) => [
      attemptStreamKey(attempt.requestId, attempt.turnId),
      { ...attempt },
    ]),
  );
  const settled = new Map<string, ConversationAttemptSettlement>();
  for (const settlement of settlements) {
    const key = attemptSettlementKey(settlement);
    const existing = settled.get(key);
    if (!existing || compareSettlements(existing, settlement) < 0) {
      settled.set(key, { ...settlement });
    }
  }
  for (const control of controls) {
    if (!validSequence(control.sequence) || control.attempt < 1) {
      return { kind: "reset_required", reason: "invalid_attempt_control" };
    }
    const key = attemptStreamKey(control.requestId, control.turnId);
    const current = active.get(key);
    const previous = settled.get(key);
    if (previous?.outcome === "accepted") {
      return { kind: "reset_required", reason: "attempt_already_accepted" };
    }
    if (control.operation === "begin") {
      if (current) return { kind: "reset_required", reason: "attempt_already_active" };
      if (
        control.attempt !== (previous?.attempt ?? 0) + 1
        || control.sequence !== (previous?.lastSequence ?? 0) + 1
      ) {
        return { kind: "reset_required", reason: "attempt_begin_gap" };
      }
      active.set(key, {
        requestId: control.requestId,
        turnId: control.turnId,
        attempt: control.attempt,
        lastSequence: control.sequence,
        answerText: "",
      });
      continue;
    }
    if (!current || (control.operation !== "supersede" && current.attempt !== control.attempt)) {
      return { kind: "reset_required", reason: "attempt_control_target_missing" };
    }
    if (control.sequence !== current.lastSequence + 1) {
      return { kind: "reset_required", reason: "attempt_control_sequence_gap" };
    }
    if (
      control.operation === "supersede"
      && (
        current.attempt !== control.supersedesAttempt
        || control.attempt !== current.attempt + 1
      )
    ) {
      return { kind: "reset_required", reason: "attempt_supersede_mismatch" };
    }
    active.delete(key);
    let settlement: ConversationAttemptSettlement;
    if (control.operation === "accept") {
      if (!validAcceptedSettlementWitness(control, current)) {
        return {
          kind: "reset_required",
          reason: "attempt_accept_witness_invalid",
        };
      }
      settlement = clonePlainData(control.acceptedSettlement);
    } else {
      settlement = {
        requestId: control.requestId,
        turnId: control.turnId,
        attempt: current.attempt,
        outcome: control.operation === "supersede" ? "superseded" : "reset",
        lastSequence: control.sequence,
        lastEventFingerprint: fingerprintProjectionAttemptControl(control),
      };
    }
    settled.set(attemptSettlementKey(settlement), settlement);
  }
  return {
    kind: "applied",
    active: [...active.values()].sort(compareAttempts),
    settled: [...settled.values()].sort(compareSettlements),
  };
}

function reduceLiveStream(
  current: ConversationLiveAnswerStream | undefined,
  event: ConversationAttemptControl | ConversationLiveContentDelta,
  fingerprint: string,
  persistedMessage?: ConversationPersistedAssistantMessage,
):
  | { kind: "applied"; stream: ConversationLiveAnswerStream }
  | { kind: "reset_required"; reason: string }
  | { kind: "rejected"; reason: string } {
  if (!("operation" in event)) {
    if (!current?.active || current.active.attempt !== event.attempt) {
      return { kind: "reset_required", reason: "delta_for_inactive_attempt" };
    }
    return {
      kind: "applied",
      stream: {
        ...current,
        lastSequence: event.sequence,
        lastEventFingerprint: fingerprint,
        active: {
          attempt: event.attempt,
          answerText: `${current.active.answerText}${event.text}`,
        },
      },
    };
  }
  if (event.operation === "begin") {
    if (current?.active) {
      return { kind: "reset_required", reason: "attempt_begin_without_settlement" };
    }
    const previousAttempt = current?.settlement?.attempt ?? 0;
    if (current?.settlement?.outcome === "accepted") {
      return { kind: "reset_required", reason: "attempt_already_accepted" };
    }
    if (event.attempt !== previousAttempt + 1) {
      return { kind: "reset_required", reason: "attempt_number_gap" };
    }
    return {
      kind: "applied",
      stream: {
        requestId: event.requestId,
        turnId: event.turnId,
        lastSequence: event.sequence,
        lastEventFingerprint: fingerprint,
        active: { attempt: event.attempt, answerText: "" },
        ...(current?.settlement ? { settlement: current.settlement } : {}),
      },
    };
  }
  if (!current?.active) {
    return { kind: "reset_required", reason: "attempt_control_without_active" };
  }
  if (event.operation !== "supersede" && current.active.attempt !== event.attempt) {
    return { kind: "reset_required", reason: "attempt_control_mismatch" };
  }
  if (event.operation === "supersede") {
    if (
      current.active.attempt !== event.supersedesAttempt
      || event.attempt !== current.active.attempt + 1
    ) {
      return { kind: "reset_required", reason: "attempt_supersede_mismatch" };
    }
    return {
      kind: "applied",
      stream: {
        ...current,
        lastSequence: event.sequence,
        lastEventFingerprint: fingerprint,
        active: undefined,
        settlement: {
          requestId: event.requestId,
          turnId: event.turnId,
          attempt: current.active.attempt,
          outcome: "superseded",
          lastSequence: event.sequence,
          lastEventFingerprint: fingerprint,
        },
      },
    };
  }
  if (event.operation === "accept") {
    if (!event.acceptedMessageId || !persistedMessage) {
      return { kind: "rejected", reason: "accepted_message_not_persisted" };
    }
    if (persistedMessage.role !== "assistant") {
      return { kind: "rejected", reason: "accepted_message_not_assistant" };
    }
    if (
      persistedMessage.id !== event.acceptedMessageId
      || persistedMessage.requestId !== event.requestId
      || persistedMessage.turnId !== event.turnId
    ) {
      return { kind: "reset_required", reason: "accepted_message_lineage_mismatch" };
    }
    const acceptedContentFingerprint = fnv1a64(persistedMessage.content);
    const acceptedSettlementBase = {
      requestId: event.requestId,
      turnId: event.turnId,
      attempt: current.active.attempt,
      outcome: "accepted" as const,
      lastSequence: event.sequence,
      lastEventFingerprint: fingerprint,
      acceptedMessageId: persistedMessage.id,
      acceptedMessageRole: "assistant" as const,
      acceptedContentFingerprint,
      ...(persistedMessage.turnSettlementStatus
        ? { acceptedTurnSettlementStatus: persistedMessage.turnSettlementStatus }
        : {}),
    };
    return {
      kind: "applied",
      stream: {
        ...current,
        lastSequence: event.sequence,
        lastEventFingerprint: fingerprint,
        active: undefined,
        settlement: {
          ...acceptedSettlementBase,
          acceptanceReceiptFingerprint: fingerprintAcceptedReceipt(
            acceptedSettlementBase,
          ),
        },
      },
    };
  }
  return {
    kind: "applied",
    stream: {
      ...current,
      lastSequence: event.sequence,
      lastEventFingerprint: fingerprint,
      active: undefined,
      settlement: {
        requestId: event.requestId,
        turnId: event.turnId,
        attempt: current.active.attempt,
        outcome: "reset",
        lastSequence: event.sequence,
        lastEventFingerprint: fingerprint,
      },
    },
  };
}

function truncateUtf8(value: string, maxBytes: number) {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) {
    return { text: value, truncated: false };
  }
  const suffix = maxBytes >= 3 ? "…" : "";
  const suffixBytes = encoder.encode(suffix).byteLength;
  let text = "";
  let bytes = 0;
  for (const char of value) {
    const charBytes = encoder.encode(char).byteLength;
    if (bytes + charBytes + suffixBytes > maxBytes) break;
    text += char;
    bytes += charBytes;
  }
  return { text: `${text}${suffix}`, truncated: true };
}

function normalizeContributorCursorNumber(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseContributorCursor(value: string): {
  scope: string;
  item: string;
  set: string;
  offset: number;
} | undefined {
  const [version, scope, item, set, offsetValue, ...rest] = value.split(":");
  const offset = normalizeContributorCursorNumber(offsetValue ?? "");
  if (
    version !== "cc1"
    || !scope
    || !item
    || !set
    || offset === undefined
    || rest.length > 0
  ) return undefined;
  return { scope, item, set, offset };
}

function sourceAuthorityKey(source: ConversationDisclosureSourceRef): string {
  return createTupleIdentity("source", [
    source.kind,
    source.kind === "unknown" ? source.originalKind : "",
    source.ref,
  ]);
}

function sourceIdentityKey(source: ConversationDisclosureSourceRef): string {
  return createTupleIdentity("source-version", [
    sourceAuthorityKey(source),
    source.domainRevision ?? "",
    source.domainStatus,
  ]);
}

function sourceCutKey(cut: ConversationSourceCut): string {
  return `${cut.source}:${cut.originalKind ?? ""}:${cut.sourceIdentity ?? ""}`;
}

function sourceCutRank(cut: ConversationSourceCut): number {
  switch (cut.status) {
    case "complete":
      return 0;
    case "ephemeral":
      return 1;
    case "partial":
      return 2;
    case "unavailable":
      return 3;
    case "incompatible":
      return 4;
  }
}

function selectProjectionSeeds(
  seeds: Array<{
    primary: ConversationDisclosureFact;
    contributors: ConversationDisclosureFact[];
    contributorsComplete?: boolean;
  }>,
): Array<{
  seed: {
    primary: ConversationDisclosureFact;
    contributors: ConversationDisclosureFact[];
    contributorsComplete?: boolean;
  };
  item: ConversationDisclosureItem;
  conflictCut?: ConversationSourceCut;
}> {
  const grouped = new Map<string, Array<{
    seed: {
      primary: ConversationDisclosureFact;
      contributors: ConversationDisclosureFact[];
      contributorsComplete?: boolean;
    };
    item: ConversationDisclosureItem;
  }>>();
  for (const seed of seeds) {
    const item = projectConversationDisclosureItem(seed);
    const entries = grouped.get(item.id) ?? [];
    entries.push({ seed, item });
    grouped.set(item.id, entries);
  }
  return [...grouped.values()].map((entries) => {
    const winner = entries.reduce((selected, candidate) =>
      compareProjectionEntries(selected, candidate) < 0
        ? candidate
        : selected);
    const related = entries.filter((candidate) =>
      sameProjectionVersion(winner, candidate));
    const conflict = related.some((candidate) =>
      canonicalSerialize(
        projectionPrimaryConflictBody(candidate.seed.primary),
      ) !== canonicalSerialize(
        projectionPrimaryConflictBody(winner.seed.primary),
      ));
    const requiredness = entries.reduce(
      (result, candidate) =>
        moreRestrictiveRequiredness(
          result,
          candidate.seed.primary.requiredness,
        ),
      winner.seed.primary.requiredness,
    );
    const durability = related.reduce(
      (result, candidate) =>
        lessDurable(result, candidate.seed.primary.durability),
      winner.seed.primary.durability,
    );
    const sensitivity = related.reduce(
      (result, candidate) =>
        moreRestrictiveSensitivity(
          result,
          candidate.seed.primary.sensitivity,
        ),
      winner.seed.primary.sensitivity,
    );
    const selectedSeed = normalizeConflictingSeed({
      ...winner.seed,
      primary: {
        ...winner.seed.primary,
        requiredness,
        durability,
        sensitivity,
      },
      contributors: related.flatMap(
        (candidate) => candidate.seed.contributors,
      ),
      contributorsComplete: related.every(
        (candidate) => candidate.seed.contributorsComplete !== false,
      ),
    }, conflict);
    return {
      seed: selectedSeed,
      item: projectConversationDisclosureItem(selectedSeed),
      ...(conflict
        ? {
            conflictCut: {
              source: winner.seed.primary.kind,
              sourceIdentity: sourceCutIdentity(winner.seed.primary),
              requiredness,
              status: "incompatible" as const,
              reasonCode: "source_cut_changed",
            },
          }
        : {}),
    };
  });
}

function compareProjectionEntries(
  left: {
    seed: {
      primary: ConversationDisclosureFact;
      contributors: ConversationDisclosureFact[];
      contributorsComplete?: boolean;
    };
    item: ConversationDisclosureItem;
  },
  right: {
    seed: {
      primary: ConversationDisclosureFact;
      contributors: ConversationDisclosureFact[];
      contributorsComplete?: boolean;
    };
    item: ConversationDisclosureItem;
  },
): number {
  return compareItemVersions(left.item, right.item)
    || compareProjectionPrimaryBodies(left.seed, right.seed);
}

function sameProjectionVersion(
  left: {
    seed: {
      primary: ConversationDisclosureFact;
      contributors: ConversationDisclosureFact[];
    };
    item: ConversationDisclosureItem;
  },
  right: {
    seed: {
      primary: ConversationDisclosureFact;
      contributors: ConversationDisclosureFact[];
    };
    item: ConversationDisclosureItem;
  },
): boolean {
  const revisionOrder = compareSourceRevisions(
    left.seed.primary.domainRevision,
    right.seed.primary.domainRevision,
  );
  if (revisionOrder.kind === "same" || revisionOrder.kind === "mixed") {
    return true;
  }
  return revisionOrder.kind === "opaque"
    && left.item.occurredAt === right.item.occurredAt;
}

function normalizeConflictingSeed(
  seed: {
    primary: ConversationDisclosureFact;
    contributors: ConversationDisclosureFact[];
    contributorsComplete?: boolean;
  },
  conflict: boolean,
) {
  if (!conflict) return seed;
  return {
    primary: { ...seed.primary, domainRevision: undefined },
    contributors: seed.contributors,
    contributorsComplete: seed.contributorsComplete,
  };
}

function compareProjectionPrimaryBodies(
  left: {
    primary: ConversationDisclosureFact;
    contributors: ConversationDisclosureFact[];
  },
  right: {
    primary: ConversationDisclosureFact;
    contributors: ConversationDisclosureFact[];
  },
): number {
  const normalize = (seed: typeof left) => ({
    ...seed.primary,
    domainRevision: undefined,
    requiredness: "ignorable" as const,
  });
  return compareCanonicalStrings(
    canonicalSerialize(normalize(left)),
    canonicalSerialize(normalize(right)),
  );
}

function projectionPrimaryConflictBody(
  primary: ConversationDisclosureFact,
): ConversationDisclosureFact {
  return {
    ...primary,
    requiredness: "ignorable",
  };
}

function dedupeUnknownFacts(facts: ConversationUnknownFact[]) {
  const map = new Map<string, ConversationUnknownFact>();
  for (const fact of facts) {
    const key = createTupleIdentity("unknown", [
      fact.scope.key,
      fact.originalKind,
      fact.authorityRef,
      fact.semanticSlot,
    ]);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, fact);
      continue;
    }
    const canonical = compareUnknownVersions(existing, fact) < 0
      ? fact
      : existing;
    map.set(key, {
      ...canonical,
      schemaVersion: Math.max(existing.schemaVersion, fact.schemaVersion),
      requiredness: moreRestrictiveRequiredness(
        existing.requiredness,
        fact.requiredness,
      ),
      durability: lessDurable(existing.durability, fact.durability),
      sensitivity: moreRestrictiveSensitivity(
        existing.sensitivity,
        fact.sensitivity,
      ),
    });
  }
  return [...map.values()].sort((left, right) =>
    compareCanonicalStrings(
      createTupleIdentity("unknown-sort", [
        left.originalKind,
        left.authorityRef,
      ]),
      createTupleIdentity("unknown-sort", [
        right.originalKind,
        right.authorityRef,
      ]),
    ),
  );
}

function compareItemVersions(
  left: ConversationDisclosureItem,
  right: ConversationDisclosureItem,
) {
  const revisionOrder = compareSourceRevisions(
    left.primarySource.domainRevision,
    right.primarySource.domainRevision,
  );
  if (revisionOrder.kind === "numeric") {
    if (revisionOrder.order !== 0) return revisionOrder.order;
    return lifecycleSafetyRank(left.lifecycle) - lifecycleSafetyRank(right.lifecycle)
      || compareCanonicalStrings(left.occurredAt, right.occurredAt)
      || compareProjectionItemBodies(left, right);
  }
  if (revisionOrder.kind === "mixed") return revisionOrder.order;
  if (revisionOrder.kind === "same") {
    return lifecycleSafetyRank(left.lifecycle) - lifecycleSafetyRank(right.lifecycle)
      || compareCanonicalStrings(left.occurredAt, right.occurredAt)
      || compareProjectionItemBodies(left, right);
  }
  return compareCanonicalStrings(left.occurredAt, right.occurredAt)
    || lifecycleSafetyRank(left.lifecycle) - lifecycleSafetyRank(right.lifecycle)
    || revisionOrder.order
    || compareProjectionItemBodies(left, right);
}

function compareProjectionItemBodies(
  left: ConversationDisclosureItem,
  right: ConversationDisclosureItem,
): number {
  return compareCanonicalStrings(
    createTupleIdentity("item-version", [
      left.primarySource.domainStatus,
      left.summary,
      sourceAuthorityKey(left.primarySource),
    ]),
    createTupleIdentity("item-version", [
      right.primarySource.domainStatus,
      right.summary,
      sourceAuthorityKey(right.primarySource),
    ]),
  );
}

function compareSourceRevisions(
  left: string | undefined,
  right: string | undefined,
): {
  kind: "same" | "numeric" | "opaque" | "mixed";
  order: number;
} {
  if (left === right) return { kind: "same", order: 0 };
  const leftNumeric = Boolean(left && /^\d+$/.test(left));
  const rightNumeric = Boolean(right && /^\d+$/.test(right));
  if (leftNumeric && rightNumeric) {
    const leftRevision = BigInt(left!);
    const rightRevision = BigInt(right!);
    return {
      kind: "numeric",
      order: leftRevision < rightRevision
        ? -1
        : leftRevision > rightRevision
          ? 1
          : 0,
    };
  }
  if (leftNumeric !== rightNumeric) {
    return { kind: "mixed", order: leftNumeric ? 1 : -1 };
  }
  return {
    kind: "opaque",
    order: compareCanonicalStrings(left ?? "", right ?? ""),
  };
}

function lifecycleSafetyRank(
  lifecycle: ConversationDisclosureLifecycle,
): number {
  switch (lifecycle) {
    case "failed":
      return 9;
    case "blocked":
      return 8;
    case "canceled":
      return 7;
    case "completed_unverified":
      return 6;
    case "waiting_for_approval":
    case "waiting_for_acceptance":
    case "waiting_for_review":
    case "waiting_for_user":
    case "waiting_for_model":
      return 5;
    case "paused":
      return 4;
    case "running":
      return 3;
    case "queued":
      return 2;
    case "succeeded":
      return 1;
    case "unknown":
      return 0;
  }
}

function compareUnknownVersions(
  left: ConversationUnknownFact,
  right: ConversationUnknownFact,
) {
  return compareCanonicalStrings(left.occurredAt, right.occurredAt)
    || compareCanonicalStrings(
      createTupleIdentity("unknown-version", [
        left.domainRevision ?? "",
        left.domainStatus,
        left.safeSummary,
      ]),
      createTupleIdentity("unknown-version", [
        right.domainRevision ?? "",
        right.domainStatus,
        right.safeSummary,
      ]),
    );
}

function moreRestrictiveRequiredness(
  left: ConversationDisclosureRequiredness,
  right: ConversationDisclosureRequiredness,
) {
  const rank: Record<ConversationDisclosureRequiredness, number> = {
    ignorable: 0,
    optional: 1,
    required: 2,
  };
  return rank[left] >= rank[right] ? left : right;
}

function lessDurable(
  left: ConversationDisclosureDurability,
  right: ConversationDisclosureDurability,
) {
  const rank: Record<ConversationDisclosureDurability, number> = {
    durable: 0,
    process_recoverable: 1,
    ephemeral: 2,
  };
  return rank[left] >= rank[right] ? left : right;
}

function moreRestrictiveSensitivity(
  left: ConversationDisclosureSensitivity,
  right: ConversationDisclosureSensitivity,
) {
  const rank: Record<ConversationDisclosureSensitivity, number> = {
    public_summary: 0,
    technical: 1,
    restricted: 2,
  };
  return rank[left] >= rank[right] ? left : right;
}

function compareItems(
  left: ConversationDisclosureItem,
  right: ConversationDisclosureItem,
) {
  return compareCanonicalStrings(left.occurredAt, right.occurredAt)
    || compareCanonicalStrings(left.id, right.id);
}

function compareAttempts(
  left: ActiveConversationAttempt,
  right: ActiveConversationAttempt,
) {
  return compareCanonicalStrings(
    attemptStreamKey(left.requestId, left.turnId),
    attemptStreamKey(right.requestId, right.turnId),
  ) || left.attempt - right.attempt
    || left.lastSequence - right.lastSequence
    || compareCanonicalStrings(left.answerText, right.answerText);
}

function compareSettlements(
  left: ConversationAttemptSettlement,
  right: ConversationAttemptSettlement,
) {
  return compareCanonicalStrings(
    attemptStreamKey(left.requestId, left.turnId),
    attemptStreamKey(right.requestId, right.turnId),
  ) || left.attempt - right.attempt
    || left.lastSequence - right.lastSequence
    || compareCanonicalStrings(
      left.lastEventFingerprint,
      right.lastEventFingerprint,
    );
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeActiveAttempts(attempts: ActiveConversationAttempt[]) {
  const byStream = new Map<string, ActiveConversationAttempt>();
  for (const attempt of attempts) {
    const key = attemptStreamKey(attempt.requestId, attempt.turnId);
    const existing = byStream.get(key);
    if (!existing || compareAttempts(existing, attempt) < 0) {
      byStream.set(key, { ...attempt });
    }
  }
  return [...byStream.values()].sort(compareAttempts);
}

function normalizeAttemptSettlements(
  settlements: ConversationAttemptSettlement[],
) {
  const byStream = new Map<string, ConversationAttemptSettlement>();
  for (const settlement of settlements) {
    const key = attemptSettlementKey(settlement);
    const existing = byStream.get(key);
    if (!existing || compareSettlements(existing, settlement) < 0) {
      byStream.set(key, { ...settlement });
    }
  }
  return [...byStream.values()].sort(compareSettlements);
}

function findAttemptStateConflict(
  activeAttempts: ActiveConversationAttempt[],
  settlements: ConversationAttemptSettlement[],
): string | undefined {
  const activeByStream = new Map<string, ActiveConversationAttempt[]>();
  for (const attempt of activeAttempts) {
    const key = attemptStreamKey(attempt.requestId, attempt.turnId);
    activeByStream.set(key, [...(activeByStream.get(key) ?? []), attempt]);
  }
  for (const attempts of activeByStream.values()) {
    if (
      attempts.length > 1
      && new Set(attempts.map(canonicalSerialize)).size > 1
    ) {
      return "duplicate_active_stream";
    }
  }

  const settledByStream = new Map<string, ConversationAttemptSettlement[]>();
  for (const settlement of settlements) {
    const key = attemptSettlementKey(settlement);
    settledByStream.set(key, [
      ...(settledByStream.get(key) ?? []),
      settlement,
    ]);
  }
  for (const [key, entries] of settledByStream) {
    const accepted = entries.filter(
      (entry): entry is ConversationAcceptedAttemptSettlement =>
        entry.outcome === "accepted",
    );
    if (accepted.length > 0) {
      if (accepted.some((entry) => !acceptedSettlementHasCanonicalReceipt(entry))) {
        return "accepted_settlement_witness_invalid";
      }
      if (activeByStream.has(key)) return "accepted_with_active_attempt";
      if (
        entries.some((entry) => entry.outcome !== "accepted")
        || new Set(accepted.map(canonicalSerialize)).size > 1
      ) {
        return "accepted_settlement_conflict";
      }
    }
  }

  const normalizedSettlements = normalizeAttemptSettlements(settlements);
  for (const active of normalizeActiveAttempts(activeAttempts)) {
    const settlement = normalizedSettlements.find(
      (entry) => attemptSettlementKey(entry) === attemptStreamKey(
        active.requestId,
        active.turnId,
      ),
    );
    if (
      settlement
      && (
        active.attempt !== settlement.attempt + 1
        || active.lastSequence <= settlement.lastSequence
      )
    ) {
      return "active_settlement_sequence_conflict";
    }
  }
  return undefined;
}

function validAcceptedSettlementWitness(
  control: Extract<
    ConversationProjectionAttemptControl,
    { operation: "accept" }
  >,
  active: ActiveConversationAttempt,
) {
  const witness = control.acceptedSettlement as unknown;
  if (!acceptedSettlementHasCanonicalReceipt(witness)) return false;
  const expectedEvent: Extract<
    ConversationAttemptControl,
    { operation: "accept" }
  > = {
    requestId: control.requestId,
    turnId: control.turnId,
    attempt: control.attempt,
    sequence: control.sequence,
    operation: "accept",
    acceptedMessageId: witness.acceptedMessageId,
  };
  return witness.outcome === "accepted"
    && witness.acceptedMessageRole === "assistant"
    && witness.requestId === control.requestId
    && witness.turnId === control.turnId
    && witness.attempt === active.attempt
    && witness.attempt === control.attempt
    && witness.lastSequence === control.sequence
    && witness.lastEventFingerprint === fingerprintLiveEvent(expectedEvent)
    && witness.acceptedMessageId.length > 0;
}

function acceptedSettlementHasCanonicalReceipt(
  value: unknown,
): value is ConversationAcceptedAttemptSettlement {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const witness = value as Partial<ConversationAcceptedAttemptSettlement>;
  if (
    witness.outcome !== "accepted"
    || witness.acceptedMessageRole !== "assistant"
    || typeof witness.requestId !== "string"
    || typeof witness.turnId !== "string"
    || !Number.isSafeInteger(witness.attempt)
    || Number(witness.attempt) < 1
    || !validSequence(Number(witness.lastSequence))
    || typeof witness.lastEventFingerprint !== "string"
    || typeof witness.acceptedMessageId !== "string"
    || witness.acceptedMessageId.length === 0
    || typeof witness.acceptedContentFingerprint !== "string"
    || !/^[0-9a-f]{16}$/.test(witness.acceptedContentFingerprint)
    || typeof witness.acceptanceReceiptFingerprint !== "string"
    || !/^[0-9a-f]{16}$/.test(witness.acceptanceReceiptFingerprint)
    || (witness.acceptedTurnSettlementStatus !== undefined
      && witness.acceptedTurnSettlementStatus !== "succeeded"
      && witness.acceptedTurnSettlementStatus !== "paused"
      && witness.acceptedTurnSettlementStatus !== "failed"
      && witness.acceptedTurnSettlementStatus !== "canceled")
  ) return false;
  const event: Extract<ConversationAttemptControl, { operation: "accept" }> = {
    requestId: witness.requestId,
    turnId: witness.turnId,
    attempt: Number(witness.attempt),
    sequence: Number(witness.lastSequence),
    operation: "accept",
    acceptedMessageId: witness.acceptedMessageId,
  };
  return witness.lastEventFingerprint === fingerprintLiveEvent(event)
    && witness.acceptanceReceiptFingerprint === fingerprintAcceptedReceipt({
      requestId: witness.requestId,
      turnId: witness.turnId,
      attempt: Number(witness.attempt),
      outcome: "accepted",
      lastSequence: Number(witness.lastSequence),
      lastEventFingerprint: witness.lastEventFingerprint,
      acceptedMessageId: witness.acceptedMessageId,
      acceptedMessageRole: "assistant",
      acceptedContentFingerprint: witness.acceptedContentFingerprint,
      ...(witness.acceptedTurnSettlementStatus
        ? { acceptedTurnSettlementStatus: witness.acceptedTurnSettlementStatus }
        : {}),
    });
}

function fingerprintAcceptedReceipt(
  receipt: Omit<
    ConversationAcceptedAttemptSettlement,
    "acceptanceReceiptFingerprint"
  >,
) {
  return fnv1a64(canonicalSerialize(receipt));
}

function fingerprintProjectionAttemptControl(
  control: ConversationAttemptNonAcceptControl,
) {
  return fingerprintLiveEvent(control);
}

function attemptSettlementKey(settlement: ConversationAttemptSettlement) {
  return attemptStreamKey(settlement.requestId, settlement.turnId);
}

function attemptStreamKey(requestId: string, turnId: string) {
  return createTupleIdentity("attempt", [requestId, turnId]);
}

function fingerprintLiveEvent(
  event: ConversationAttemptControl | ConversationLiveContentDelta,
) {
  return "operation" in event
    ? createTupleIdentity("control", [
        event.requestId,
        event.turnId,
        String(event.attempt),
        String(event.sequence),
        event.operation,
        event.operation === "supersede" ? String(event.supersedesAttempt) : "",
        event.operation === "accept" ? event.acceptedMessageId : "",
      ])
    : createTupleIdentity("delta", [
        event.requestId,
        event.turnId,
        String(event.attempt),
        String(event.sequence),
        event.channel,
        event.text,
      ]);
}

function createTupleIdentity(prefix: string, values: string[]) {
  return `${prefix}:${values.map((value) => `${value.length}:${value}`).join(":")}`;
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

function canonicalSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "undefined") return "undefined";
  if (Array.isArray(value)) {
    return `[${value.map(canonicalSerialize).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => typeof record[key] !== "undefined")
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalSerialize(record[key])}`)
      .join(",")}}`;
  }
  throw new Error(`unsupported disclosure value: ${typeof value}`);
}

function clonePlainData<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => clonePlainData(entry)) as T;
  }
  const clone: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "undefined") clone[key] = clonePlainData(entry);
  }
  return clone as T;
}

function cloneDisclosureItem(item: ConversationDisclosureItem) {
  return clonePlainData(item);
}

function sameDisclosureScope(
  left: ConversationDisclosureScope,
  right: ConversationDisclosureScope,
) {
  return left.key === right.key
    && left.surface === right.surface
    && left.queryHash === right.queryHash
    && left.sessionId === right.sessionId
    && left.goalId === right.goalId
    && left.runId === right.runId;
}

function positiveInteger(value: number | undefined, fallback: number) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number) {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function validCursor(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validSequence(value: number) {
  return Number.isSafeInteger(value) && value >= 1;
}

function isRequiredness(value: unknown): value is ConversationDisclosureRequiredness {
  return value === "required" || value === "optional" || value === "ignorable";
}

function isDurability(value: unknown): value is ConversationDisclosureDurability {
  return value === "durable"
    || value === "process_recoverable"
    || value === "ephemeral";
}

function isSensitivity(value: unknown): value is ConversationDisclosureSensitivity {
  return value === "public_summary"
    || value === "technical"
    || value === "restricted";
}
