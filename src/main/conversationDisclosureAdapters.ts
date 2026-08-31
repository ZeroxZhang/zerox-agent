import type { AgentExecutionCheckpoint, AgentExecutionStatus } from "../shared/agentExecution";
import type { AgentRunRecord } from "../shared/agentRuns";
import {
  agentTrajectoryEventTypes,
  type AgentTrajectoryEvent,
} from "../shared/agentTrajectory";
import type { Goal, ProgressLedgerEvent } from "../shared/agentGoal";
import type {
  ChatMessageRecord,
  ChatSessionContextSnapshot,
  ChatSessionTokenUsage,
  ChatTaskStatusEvent,
  SkillPendingInputState,
} from "../shared/chat";
import type {
  ConversationCausalRecord,
  ConversationRequiredSettlement,
  ToolApprovalIntent,
} from "../shared/conversationCausalSpine";
import {
  createConversationRequestFingerprint,
} from "../shared/conversationCausalSpine";
import {
  sanitizeConversationDisclosureSummary,
  type ConversationDisclosureFact,
  type ConversationDisclosureScope,
  type ConversationProjectionSeed,
  type ConversationSourceCut,
  type ConversationUnknownFact,
} from "../shared/conversationDisclosure";
import type {
  ConversationChatActivityRecord,
  ConversationSourcePage,
} from "../shared/conversationEvidence";
import type { KernelRunStatus } from "../shared/kernelContract";
import type { PlanRecord } from "../shared/planMode";
import type { ToolInvocationRecord } from "../shared/toolInvocationLedger";
import type {
  WorkspaceRun,
  WorkspaceRunEvent,
} from "../shared/workspaceRunLedger";
import { normalizeChatTaskStatusEventForPersistence } from "./chatSessionStore";

export type ConversationScheduledRunObservation = {
  taskId: string;
  runId: string;
  status: AgentExecutionStatus;
  occurredAt: string;
};

export type ConversationContextObservation = {
  authorityRef: string;
  status: "observed" | "compacted" | "compacted_degraded";
  snapshot: Partial<Pick<
    ChatSessionContextSnapshot,
    "estimatedTokens" | "tokenBudget" | "compactionCount"
  >>;
  occurredAt: string;
};

export type ConversationUsageObservation = {
  authorityRef: string;
  status: "measured" | "estimated" | "partial";
  usage: ChatSessionTokenUsage;
  occurredAt: string;
};

export type ConversationKernelObservation = {
  authorityRef: string;
  runId: string;
  status: KernelRunStatus;
  occurredAt: string;
  turn?: number;
  maxTurns?: number;
};

export type ConversationGuidedInputObservation = {
  state: SkillPendingInputState;
  settlement?: ConversationRequiredSettlement;
  settlementOwner?: ConversationCausalRecord;
  chatEvent?: ChatTaskStatusEvent;
  occurredAt: string;
};

export type ConversationWorkspaceRead = {
  run: WorkspaceRun;
  events?: ConversationSourcePage<WorkspaceRunEvent>;
};

export type ConversationTrajectoryRead = {
  runId: string;
  owner?: Pick<AgentRunRecord, "id" | "status">;
  events: ConversationSourcePage<AgentTrajectoryEvent>;
};

export type ConversationGoalLedgerRead = {
  goalId: string;
  sourceRevision: string;
  status: "complete" | "partial" | "unavailable" | "incompatible";
  records: readonly ProgressLedgerEvent[];
  reasonCode?: string;
};

export type ConversationToolInvocationConflict = {
  runId: string;
  invocationId: string;
};

export type ConversationDisclosureAdapterReadSet = {
  scope: ConversationDisclosureScope;
  chatTranscript?: {
    sessionId: string;
    sourceRevision?: string;
    status: "complete" | "partial" | "unavailable" | "incompatible";
    reasonCode?: string;
  };
  runScopeAvailable?: boolean;
  causalRecords?: readonly ConversationCausalRecord[];
  chatMessages?: readonly ChatMessageRecord[];
  chatActivity?: ConversationSourcePage<ConversationChatActivityRecord>;
  goals?: readonly Goal[];
  goalLedgers?: readonly ConversationGoalLedgerRead[];
  plans?: readonly PlanRecord[];
  scheduledRuns?: readonly ConversationScheduledRunObservation[];
  agentRuns?: readonly AgentRunRecord[];
  activeCheckpoints?: readonly AgentExecutionCheckpoint[];
  trajectory?: readonly ConversationTrajectoryRead[];
  workspaceRuns?: readonly ConversationWorkspaceRead[];
  toolInvocations?: readonly ToolInvocationRecord[];
  toolInvocationConflicts?: readonly ConversationToolInvocationConflict[];
  approvals?: readonly ToolApprovalIntent[];
  guidedInputs?: readonly ConversationGuidedInputObservation[];
  contexts?: readonly ConversationContextObservation[];
  usages?: readonly ConversationUsageObservation[];
  kernel?: readonly ConversationKernelObservation[];
  unknownFacts?: readonly ConversationUnknownFact[];
};

export type ConversationAdapterDiagnostic = {
  code:
    | "required_owner_missing"
    | "required_witness_missing"
    | "required_witness_conflict"
    | "required_settlement_incomplete"
    | "source_identity_conflict"
    | "tool_association_conflict"
    | "source_unavailable";
  source: string;
  authorityRef: string;
};

export type ConversationDisclosureAdapterBatch = {
  seeds: ConversationProjectionSeed[];
  unknownFacts: ConversationUnknownFact[];
  sourceCuts: ConversationSourceCut[];
  diagnostics: ConversationAdapterDiagnostic[];
};

export function adaptConversationDisclosureSources(
  input: ConversationDisclosureAdapterReadSet,
): ConversationDisclosureAdapterBatch {
  const scope = input.scope;
  const causal = (input.causalRecords ?? []).filter(
    (record) => !scope.sessionId || record.sessionId === scope.sessionId,
  );
  const requiredAgentRunRefs = new Set(
    causal.flatMap((record) =>
      record.refs
        .filter((entry) => entry.kind === "agent_run")
        .map((entry) => entry.id)),
  );
  const requiredWorkspaceRuns = new Set(
    causal.flatMap((record) => [
      ...record.refs
        .filter((entry) => entry.kind === "workspace_run")
        .map((entry) => entry.id),
      ...(record.requiredSettlements ?? [])
        .filter((entry) => entry.requiredDomains.includes("workspace"))
        .flatMap((entry) => entry.workspaceRunId ? [entry.workspaceRunId] : []),
    ]),
  );
  const requiredWorkspaceOwners = new Map<string, Array<{
    sessionId?: string;
    requestId: string;
    turnId: string;
  }>>();
  for (const record of causal) {
    for (const ref of record.refs) {
      if (ref.kind !== "workspace_run") continue;
      appendMapValue(requiredWorkspaceOwners, ref.id, {
        sessionId: record.sessionId,
        requestId: record.requestId,
        turnId: record.turnId,
      });
    }
    for (const settlement of record.requiredSettlements ?? []) {
      if (
        !settlement.requiredDomains.includes("workspace")
        || !settlement.workspaceRunId
      ) {
        continue;
      }
      appendMapValue(requiredWorkspaceOwners, settlement.workspaceRunId, {
        sessionId: record.sessionId,
        requestId: record.requestId,
        turnId: record.turnId,
      });
    }
  }
  const requiredMessageRequirements = new Map<string, Array<{
    role: "user" | "assistant";
    requestId: string;
    turnId: string;
    attempt?: number;
    settlementStatus?: "succeeded" | "paused" | "failed" | "canceled";
  }>>();
  for (const record of causal) {
    if (record.userMessageId) {
      appendMapValue(requiredMessageRequirements, record.userMessageId, {
        role: "user",
        requestId: record.requestId,
        turnId: record.turnId,
      });
    }
    for (const attempt of record.attempts) {
      if (!attempt.acceptedSettlement?.acceptedMessageId) continue;
      appendMapValue(
        requiredMessageRequirements,
        attempt.acceptedSettlement.acceptedMessageId,
        {
          role: "assistant",
          requestId: record.requestId,
          turnId: record.turnId,
          attempt: attempt.attempt,
          ...(attempt.acceptedSettlement.acceptedTurnSettlementStatus
            ? {
                settlementStatus:
                  attempt.acceptedSettlement.acceptedTurnSettlementStatus,
              }
            : {}),
        },
      );
    }
  }
  const agentRunRequirements = new Map<string, Array<{
    sessionId?: string;
    requestId: string;
    turnId: string;
    taskId: string;
    executionRevision: number;
    state: "admitted" | "started" | "settled" | "aborted";
    finalStatus?: "succeeded" | "paused" | "failed" | "canceled";
  }>>();
  for (const record of causal) {
    for (const admission of record.agentRunAdmissions ?? []) {
      appendMapValue(agentRunRequirements, admission.runId, {
        sessionId: record.sessionId,
        requestId: record.requestId,
        turnId: record.turnId,
        taskId: admission.taskId,
        executionRevision: admission.executionRevision ?? 1,
        state: admission.state,
        ...(admission.finalStatus
          ? { finalStatus: admission.finalStatus }
          : {}),
      });
    }
  }
  const requiredToolInvocationRequirements = new Map<string, Array<{
    sessionId?: string;
    requestId: string;
    turnId: string;
  }>>();
  const requiredApprovalRequirements = new Map<string, Array<{
    sessionId?: string;
    requestId: string;
    turnId: string;
  }>>();
  for (const record of causal) {
    for (const ref of record.refs) {
      if (ref.kind === "tool_invocation") {
        appendMapValue(
          requiredToolInvocationRequirements,
          `${ref.runId}\0${ref.id}`,
          {
            sessionId: record.sessionId,
            requestId: record.requestId,
            turnId: record.turnId,
          },
        );
      } else if (ref.kind === "approval") {
        appendMapValue(requiredApprovalRequirements, ref.id, {
          sessionId: record.sessionId,
          requestId: record.requestId,
          turnId: record.turnId,
        });
      }
    }
  }
  const requiredChatSettlements = causal.flatMap((record) =>
    (record.requiredSettlements ?? [])
      .filter((entry) => entry.requiredDomains.includes("chat"))
      .map((settlement) => ({ record, settlement })));
  const requiredWorkspaceSettlements = causal.flatMap((record) =>
    (record.requiredSettlements ?? [])
      .filter((entry) => entry.requiredDomains.includes("workspace"))
      .map((settlement) => ({ record, settlement })));
  const conflictingAgentRunRequirementKeys = conflictingGroupedKeys(
    [...agentRunRequirements].flatMap(([runId, requirements]) =>
      requirements.map((requirement) => ({ runId, requirement }))),
    ({ runId, requirement }) =>
      agentRunRequirementKey(runId, requirement),
    ({ runId, requirement }) =>
      agentRunObligationIdentity(runId, requirement),
  );
  const conflictingWorkspaceRunIds = conflictingMapKeys(
    requiredWorkspaceOwners,
    workspaceOwnerRequirementIdentity,
  );
  const conflictingToolInvocationKeys = conflictingMapKeys(
    requiredToolInvocationRequirements,
    workspaceOwnerRequirementIdentity,
  );
  const conflictingApprovalIds = conflictingMapKeys(
    requiredApprovalRequirements,
    workspaceOwnerRequirementIdentity,
  );
  const conflictingChatSettlementIds = conflictingGroupedKeys(
    requiredChatSettlements,
    ({ settlement }) => settlement.id,
    ({ record, settlement }) =>
      settlementObligationIdentity(record, settlement),
  );
  const conflictingWorkspaceSettlementKeys = conflictingGroupedKeys(
    requiredWorkspaceSettlements,
    ({ settlement }) => workspaceSettlementKey(settlement),
    ({ record, settlement }) =>
      settlementObligationIdentity(record, settlement),
  );
  const seeds: ConversationProjectionSeed[] = [];
  const sourceCuts: ConversationSourceCut[] = [];
  const diagnostics: ConversationAdapterDiagnostic[] = [];
  const representedChatSettlements = new Set<string>();
  const representedToolInvocations = new Set<string>();
  const representedWorkspaceEvents = new Set<string>();
  if (
    scope.surface === "chat"
    && scope.sessionId
    && !input.chatTranscript
  ) {
    sourceCuts.push({
      source: "chat_message",
      sourceIdentity: scope.sessionId,
      requiredness: "required",
      status: "unavailable",
      reasonCode: "required_owner_missing",
    });
    diagnostics.push({
      code: "required_owner_missing",
      source: "chat_message",
      authorityRef: scope.sessionId,
    });
  }
  if (input.chatTranscript) {
    const ownerMatches = Boolean(
      scope.sessionId
      && input.chatTranscript.sessionId === scope.sessionId,
    );
    sourceCuts.push({
      source: "chat_message",
      sourceIdentity: input.chatTranscript.sessionId,
      requiredness: "required",
      status: ownerMatches
        ? input.chatTranscript.status
        : "incompatible",
      ...(input.chatTranscript.sourceRevision
        ? { cursor: input.chatTranscript.sourceRevision }
        : {}),
      ...(!ownerMatches
        ? { reasonCode: "source_identity_conflict" }
        : input.chatTranscript.reasonCode
          ? { reasonCode: input.chatTranscript.reasonCode }
        : {}),
    });
    if (!ownerMatches) {
      diagnostics.push({
        code: "source_identity_conflict",
        source: "chat_message",
        authorityRef: `${scope.sessionId ?? "missing"}:${
          input.chatTranscript.sessionId
        }`,
      });
    }
  }
  if (
    scope.surface === "run"
    && scope.runId
    && input.runScopeAvailable !== true
  ) {
    addMissingRequiredWitness(
      sourceCuts,
      diagnostics,
      "agent_run",
      scope.runId,
      undefined,
      "required_owner_missing",
    );
  }
  for (const requirementKey of conflictingAgentRunRequirementKeys) {
    const [runId] = requirementKey.split("\0");
    addConflictingRequiredWitness(
      sourceCuts,
      diagnostics,
      "agent_run",
      runId!,
    );
  }
  for (const runId of conflictingWorkspaceRunIds) {
    addConflictingRequiredWitness(
      sourceCuts,
      diagnostics,
      "workspace_run",
      runId,
    );
  }
  for (const invocationKey of conflictingToolInvocationKeys) {
    const [, invocationId] = invocationKey.split("\0");
    addConflictingRequiredWitness(
      sourceCuts,
      diagnostics,
      "tool_invocation",
      invocationId!,
    );
  }
  for (const settlementId of conflictingChatSettlementIds) {
    addConflictingRequiredWitness(
      sourceCuts,
      diagnostics,
      "chat_activity",
      `settlement:${settlementId}`,
    );
  }
  for (const witnessKey of conflictingWorkspaceSettlementKeys) {
    const [, eventId] = witnessKey.split("\0");
    addConflictingRequiredWitness(
      sourceCuts,
      diagnostics,
      "workspace_run",
      eventId || `settlement:${witnessKey}`,
    );
  }

  for (const message of input.chatMessages ?? []) {
    const messageRequired = (
      requiredMessageRequirements.get(message.id) ?? []
    ).some((requirement) => messageMatchesRequirement(message, requirement));
    seeds.push({
      primary: makeFact("chat_message", {
        authorityRef: message.id,
        scope,
        ...(message.causalAttempt !== undefined
          ? { domainRevision: String(message.causalAttempt) }
          : {}),
        domainStatus: message.role,
        requiredness: messageRequired
          ? "required"
          : "optional",
        durability: "durable",
        sensitivity: "public_summary",
        occurredAt: message.createdAt,
        payload: {
          semanticSlot: `chat-message:${message.id}`,
          summary: message.role === "user"
            ? "User message persisted"
            : `Assistant message ${
              message.turnSettlementStatus ?? "legacy status unknown"
            }`,
          disclosureClass: "narrative",
          messageId: message.id,
          ...(message.requestId ? { requestId: message.requestId } : {}),
          ...(message.turnId ? { turnId: message.turnId } : {}),
          ...(message.executedRunId ? { executedRunId: message.executedRunId } : {}),
          ...(message.goalId ? { goalId: message.goalId } : {}),
        },
      }),
    });
  }

  if (input.chatActivity) {
    const requiredActivity = requiredChatSettlements.length > 0;
    const pageOwnerMatches = Boolean(
      scope.sessionId
      && input.chatActivity.sourceId === scope.sessionId,
    );
    const cut = pageCut(
      input.chatActivity,
      requiredActivity ? "required" : "optional",
    );
    sourceCuts.push(pageOwnerMatches
      ? cut
      : {
          ...cut,
          status: "incompatible",
          reasonCode: "source_identity_conflict",
        });
    if (!pageOwnerMatches) {
      diagnostics.push({
        code: "source_identity_conflict",
        source: "chat_activity",
        authorityRef: `${scope.sessionId ?? "missing"}:${
          input.chatActivity.sourceId
        }`,
      });
    }
    for (const record of input.chatActivity.records) {
      const eventOwnerMatches = pageOwnerMatches
        && record.event.sessionId === scope.sessionId;
      const matchingSettlements = record.event.settlementId
        ? requiredChatSettlements.filter(
          ({ record: owner, settlement }) =>
            !conflictingChatSettlementIds.has(settlement.id)
            && chatEventMatchesSettlement(
              record.event,
              owner,
              settlement,
            ),
        )
        : [];
      if (!eventOwnerMatches) {
        sourceCuts.push({
          source: "chat_activity",
          sourceIdentity: `record:${record.eventId}`,
          requiredness: matchingSettlements.length > 0
            ? "required"
            : "optional",
          status: "incompatible",
          reasonCode: "source_identity_conflict",
        });
        diagnostics.push({
          code: "source_identity_conflict",
          source: "chat_activity",
          authorityRef: `${input.chatActivity.sourceId}:${record.eventId}`,
        });
        continue;
      }
      const settlementRequired = matchingSettlements.length > 0;
      for (const matched of matchingSettlements) {
        representedChatSettlements.add(
          settlementObligationIdentity(matched.record, matched.settlement),
        );
      }
      seeds.push({
        primary: makeFact("chat_activity", {
          authorityRef: record.eventId,
          scope,
          domainRevision: String(record.sequence),
          domainStatus: record.event.state,
          requiredness: settlementRequired ? "required" : "optional",
          durability: "durable",
          sensitivity: "public_summary",
          occurredAt: record.event.createdAt,
          payload: {
            semanticSlot: activitySlot(record),
            summary: safeSummary(record.event.message),
            disclosureClass: activityClass(record.event.state),
            ...(record.event.requestId
              ? { requestId: record.event.requestId }
              : {}),
            ...(record.event.turnId ? { turnId: record.event.turnId } : {}),
            ...(record.event.sequence !== undefined
              ? { sequence: record.event.sequence }
              : {}),
            ...(record.event.elapsedMs !== undefined
              ? { elapsedMs: record.event.elapsedMs }
              : {}),
            ...(record.event.toolName ? { toolName: safeId(record.event.toolName) } : {}),
          },
        }),
      });
    }
  }
  for (const [messageId, requirements] of requiredMessageRequirements) {
    const distinctRequirements = new Map(
      requirements.map((requirement) => [
        messageRequirementIdentity(requirement),
        requirement,
      ]),
    );
    if (distinctRequirements.size > 1) {
      addConflictingRequiredWitness(
        sourceCuts,
        diagnostics,
        "chat_message",
        messageId,
      );
      continue;
    }
    const requirement = distinctRequirements.values().next().value;
    if (
      requirement
      && (input.chatMessages ?? []).some((message) =>
        message.id === messageId
        && messageMatchesRequirement(message, requirement))
    ) {
      continue;
    }
    addMissingRequiredWitness(
      sourceCuts,
      diagnostics,
      "chat_message",
      messageId,
    );
  }
  for (const { record, settlement } of requiredChatSettlements) {
    if (conflictingChatSettlementIds.has(settlement.id)) continue;
    if (
      settlement.state === "committed"
      && representedChatSettlements.has(
        settlementObligationIdentity(record, settlement),
      )
    ) {
      continue;
    }
    addMissingRequiredWitness(
      sourceCuts,
      diagnostics,
      "chat_activity",
      `settlement:${settlement.id}`,
      undefined,
      settlement.state === "committed"
        ? "required_witness_missing"
        : "required_settlement_incomplete",
    );
  }

  const scopedGoals = (input.goals ?? []).filter((goal) => {
    const ownerMatches = (!scope.goalId || goal.id === scope.goalId)
      && (!scope.sessionId || goal.chatSessionId === scope.sessionId);
    if (!ownerMatches) {
      sourceCuts.push({
        source: "goal",
        sourceIdentity: `record:${goal.id}`,
        requiredness: scope.goalId === goal.id ? "required" : "optional",
        status: "incompatible",
        reasonCode: "source_identity_conflict",
      });
      diagnostics.push({
        code: "source_identity_conflict",
        source: "goal",
        authorityRef: goal.id,
      });
    }
    return ownerMatches;
  });
  const goalsById = new Map(scopedGoals.map((goal) => [goal.id, goal]));
  if (scope.goalId && !goalsById.has(scope.goalId)) {
    addMissingRequiredWitness(
      sourceCuts,
      diagnostics,
      "goal",
      scope.goalId,
      undefined,
      "required_owner_missing",
    );
  }
  const goalLedgersById = new Map<string, ConversationGoalLedgerRead[]>();
  for (const ledger of input.goalLedgers ?? []) {
    appendMapValue(goalLedgersById, ledger.goalId, ledger);
  }
  for (const goal of scopedGoals) {
    const ledgers = goalLedgersById.get(goal.id) ?? [];
    const ledger = ledgers.length === 1 ? ledgers[0] : undefined;
    let contributors: ConversationDisclosureFact<"goal">[] = [];
    let contributorsComplete = false;
    if (ledgers.length > 1) {
      addSourceIdentityConflict(
        sourceCuts,
        diagnostics,
        "goal",
        `ledger:${goal.id}`,
        "optional",
      );
    } else if (ledger) {
      sourceCuts.push({
        source: "goal",
        sourceIdentity: `ledger:${goal.id}`,
        cursor: ledger.sourceRevision,
        requiredness: "optional",
        status: ledger.status,
        ...(ledger.reasonCode ? { reasonCode: ledger.reasonCode } : {}),
      });
      contributorsComplete = ledger.status === "complete";
      if (ledger.status === "complete" || ledger.status === "partial") {
        contributors = ledger.records.map((event) =>
          makeFact("goal", {
            authorityRef: goalLedgerEventRef(goal.id, event),
            scope,
            domainRevision: event.at,
            domainStatus: goal.status,
            requiredness: "optional",
            durability: "durable",
            sensitivity: "public_summary",
            occurredAt: event.at,
            payload: {
              semanticSlot:
                `goal-ledger:${goal.id}:${goalLedgerEventRef(goal.id, event)}`,
              summary: safeSummary(`Goal ${event.kind}: ${event.summary}`),
              disclosureClass: "evidence",
              goalId: goal.id,
              planVersion: goal.planVersion,
              actionRequired: false,
              evidenceTarget: {
                schemaVersion: 1,
                kind: "goal_record",
                goalId: goal.id,
                revision: goal.planVersion,
              },
            },
          }));
      }
    }
    seeds.push({
      primary: makeFact("goal", {
        authorityRef: goal.id,
        scope,
        domainRevision: String(goal.planVersion),
        domainStatus: goal.status,
        requiredness: scope.goalId === goal.id ? "required" : "optional",
        durability: "durable",
        sensitivity: "public_summary",
        occurredAt: goal.updatedAt,
        payload: {
          semanticSlot: `goal:${goal.id}`,
          summary: `Goal ${goal.status}`,
          disclosureClass: goal.status.startsWith("waiting_")
            ? "gate"
            : "narrative",
          goalId: goal.id,
          ...(goal.stopReason ? { stopReason: goal.stopReason } : {}),
          planVersion: goal.planVersion,
          ...(goal.acceptanceState?.phase
            ? { acceptancePhase: goal.acceptanceState.phase }
            : {}),
          actionRequired: goal.status.startsWith("waiting_"),
          evidenceTarget: {
            schemaVersion: 1,
            kind: "goal_record",
            goalId: goal.id,
            revision: goal.planVersion,
          },
        },
      }),
      ...(ledger
        ? {
            contributors,
            contributorsComplete,
          }
        : {}),
    });
  }

  const representedActivePlanRefs = new Set<string>();
  for (const plan of input.plans ?? []) {
    const owningGoal = plan.goalId ? goalsById.get(plan.goalId) : undefined;
    const required = Boolean(
      owningGoal?.activePlanRef?.planId === plan.id
      && owningGoal.activePlanRef.planRevision === plan.revision,
    );
    if (required) {
      representedActivePlanRefs.add(
        `${owningGoal!.id}\0${plan.id}\0${plan.revision}`,
      );
    }
    const ownerMatches = (!scope.sessionId || plan.sessionId === scope.sessionId)
      && (!scope.goalId || plan.goalId === scope.goalId)
      && (
        !scope.runId
        || Boolean(
          owningGoal?.milestones.some((milestone) =>
            milestone.runIds.includes(scope.runId!)),
        )
      );
    if (!ownerMatches) {
      addSourceIdentityConflict(
        sourceCuts,
        diagnostics,
        "plan",
        plan.id,
        required ? "required" : "optional",
      );
      continue;
    }
    seeds.push({
      primary: makeFact("plan", {
        authorityRef: plan.id,
        scope,
        domainRevision: String(plan.revision),
        domainStatus: plan.status,
        requiredness: required ? "required" : "optional",
        durability: "durable",
        sensitivity: "public_summary",
        occurredAt: plan.updatedAt,
        payload: {
          semanticSlot: `plan:${plan.id}`,
          summary: `Plan ${plan.status}`,
          disclosureClass: plan.actionGate === "ready" ? "operation" : "gate",
          planId: plan.id,
          revision: plan.revision,
          actionGate: plan.actionGate,
          ...(plan.goalId ? { goalId: plan.goalId } : {}),
          actionRequired: plan.actionGate !== "ready",
          evidenceTarget: {
            schemaVersion: 1,
            kind: "plan_record",
            planId: plan.id,
            revision: plan.revision,
          },
        },
      }),
    });
  }
  for (const goal of scopedGoals) {
    const activePlan = goal.activePlanRef;
    if (
      !activePlan
      || representedActivePlanRefs.has(
        `${goal.id}\0${activePlan.planId}\0${activePlan.planRevision}`,
      )
    ) {
      continue;
    }
    addMissingRequiredWitness(
      sourceCuts,
      diagnostics,
      "plan",
      activePlan.planId,
      goal.id,
      "required_owner_missing",
    );
  }

  for (const run of input.scheduledRuns ?? []) {
    const runRequired = requiredAgentRunRefs.has(run.runId)
      || (agentRunRequirements.get(run.runId) ?? []).some((requirement) =>
        !conflictingAgentRunRequirementKeys.has(
          agentRunRequirementKey(run.runId, requirement),
        )
        && scheduledRunMatchesRequirement(run, requirement));
    const runOwner = (input.agentRuns ?? []).find(
      (candidate) => candidate.id === run.runId,
    ) ?? (input.activeCheckpoints ?? []).find(
      (candidate) => candidate.runId === run.runId,
    );
    if (!runOwner) {
      if (runRequired) {
        addMissingRequiredWitness(
          sourceCuts,
          diagnostics,
          "scheduled_run",
          run.runId,
          undefined,
          "required_owner_missing",
        );
      } else {
        addOptionalUnavailableSource(
          sourceCuts,
          diagnostics,
          "scheduled_run",
          run.runId,
        );
      }
      continue;
    }
    if (!runMatchesScope(
      run.runId,
      runOwner?.runContext,
      scope,
      causal,
      scopedGoals,
    )) {
      addSourceIdentityConflict(
        sourceCuts,
        diagnostics,
        "scheduled_run",
        run.runId,
        runRequired ? "required" : "optional",
      );
      continue;
    }
    seeds.push({
      primary: makeFact("scheduled_run", {
        authorityRef: run.runId,
        scope,
        domainRevision: run.runId,
        domainStatus: run.status,
        requiredness: runRequired ? "required" : "optional",
        durability: "durable",
        sensitivity: "public_summary",
        occurredAt: run.occurredAt,
        payload: {
          semanticSlot: `scheduled-run:${run.runId}`,
          summary: `Scheduled run ${run.status}`,
          disclosureClass: "operation",
          taskId: run.taskId,
          runId: run.runId,
        },
      }),
    });
  }

  const agentRuns = new Map<string, AgentRunRecord>();
  const checkpointRunIds = new Set<string>();
  const representedAgentRunObligations = new Set<string>();
  for (const run of input.agentRuns ?? []) {
    const matchingRequirements = (agentRunRequirements.get(run.id) ?? [])
      .filter((requirement) =>
        !conflictingAgentRunRequirementKeys.has(
          agentRunRequirementKey(run.id, requirement),
        )
        && agentRunMatchesRequirement(run, requirement));
    const runRequired = requiredAgentRunRefs.has(run.id)
      || matchingRequirements.length > 0;
    const ownerMatches = runMatchesScope(
      run.id,
      run.runContext,
      scope,
      causal,
      scopedGoals,
    );
    if (!ownerMatches) {
      addSourceIdentityConflict(
        sourceCuts,
        diagnostics,
        "agent_run",
        run.id,
        runRequired ? "required" : "optional",
      );
      continue;
    }
    agentRuns.set(run.id, run);
    if (requiredAgentRunRefs.has(run.id)) {
      representedAgentRunObligations.add(`ref:${run.id}`);
    }
    for (const requirement of matchingRequirements) {
      representedAgentRunObligations.add(
        agentRunObligationIdentity(run.id, requirement),
      );
    }
    seeds.push({
      primary: makeFact("agent_run", {
        authorityRef: run.id,
        scope,
        domainRevision: String(run.executionRevision ?? 1),
        domainStatus: run.status,
        requiredness: runRequired ? "required" : "optional",
        durability: "durable",
        sensitivity: "technical",
        occurredAt: run.finishedAt || run.startedAt,
        payload: {
          semanticSlot: `agent-run:${run.id}`,
          summary: `Agent run ${run.status}${
            run.failureClass ? ` (${run.failureClass})` : ""
          }`,
          disclosureClass: "operation",
          runId: run.id,
          taskId: run.taskId,
          ...(run.failureClass ? { failureClass: run.failureClass } : {}),
          evidenceTarget: {
            schemaVersion: 1,
            kind: "generic_source",
            source: {
              kind: "agent_run",
              ref: run.id,
              domainRevision: String(run.executionRevision ?? 1),
              domainStatus: run.status,
              role: "primary",
            },
          },
        },
      }),
    });
  }
  for (const checkpoint of input.activeCheckpoints ?? []) {
    if (agentRuns.has(checkpoint.runId)) continue;
    const checkpointRequired = requiredAgentRunRefs.has(checkpoint.runId)
      && !agentRunRequirements.has(checkpoint.runId);
    if (!runMatchesScope(
      checkpoint.runId,
      checkpoint.runContext,
      scope,
      causal,
      scopedGoals,
    )) {
      addSourceIdentityConflict(
        sourceCuts,
        diagnostics,
        "agent_run",
        checkpoint.runId,
        checkpointRequired ? "required" : "optional",
      );
      continue;
    }
    checkpointRunIds.add(checkpoint.runId);
    if (checkpointRequired) {
      representedAgentRunObligations.add(`ref:${checkpoint.runId}`);
    }
    seeds.push({
      primary: makeFact("agent_run", {
        authorityRef: checkpoint.runId,
        scope,
        domainRevision: checkpoint.updatedAt,
        domainStatus: checkpoint.status,
        requiredness: checkpointRequired
          ? "required"
          : "optional",
        durability: "process_recoverable",
        sensitivity: "technical",
        occurredAt: checkpoint.updatedAt,
        payload: {
          semanticSlot: `agent-run:${checkpoint.runId}`,
          summary: `Agent checkpoint ${checkpoint.status}`,
          disclosureClass: "operation",
          runId: checkpoint.runId,
          taskId: checkpoint.taskId,
          ...(checkpoint.currentStepId
            ? { failureClass: `step:${safeId(checkpoint.currentStepId)}` }
            : {}),
          ...(checkpoint.id
            ? {
                evidenceTarget: {
                  schemaVersion: 1,
                  kind: "checkpoint",
                  runId: checkpoint.runId,
                  checkpointId: checkpoint.id,
                } as const,
              }
            : {}),
        },
      }),
    });
  }

  for (const requiredRunId of requiredAgentRunRefs) {
    if (representedAgentRunObligations.has(`ref:${requiredRunId}`)) continue;
    sourceCuts.push({
      source: "agent_run",
      sourceIdentity: `record:${requiredRunId}`,
      requiredness: "required",
      status: "unavailable",
      reasonCode: "required_owner_missing",
    });
    diagnostics.push({
      code: "required_owner_missing",
      source: "agent_run",
      authorityRef: requiredRunId,
    });
  }
  for (const [runId, requirements] of agentRunRequirements) {
    for (const requirement of requirements) {
      if (
        conflictingAgentRunRequirementKeys.has(
          agentRunRequirementKey(runId, requirement),
        )
        || representedAgentRunObligations.has(
          agentRunObligationIdentity(runId, requirement),
        )
      ) {
        continue;
      }
      addMissingRequiredWitness(
        sourceCuts,
        diagnostics,
        "agent_run",
        runId,
        undefined,
        "required_owner_missing",
      );
    }
  }

  const trajectoryFacts: ConversationDisclosureFact<"trajectory">[] = [];
  const unknownTrajectoryFacts: ConversationUnknownFact[] = [];
  const knownTrajectoryTypes = new Set<string>(agentTrajectoryEventTypes);
  const acceptedTrajectoryReads = new Set<ConversationTrajectoryRead>();
  for (const trajectory of input.trajectory ?? []) {
    const storeOwner = agentRuns.get(trajectory.runId);
    const ownerConflict = Boolean(
      storeOwner
      && trajectory.owner
      && (
        trajectory.owner.id !== storeOwner.id
        || trajectory.owner.status !== storeOwner.status
      ),
    );
    const candidateOwner = storeOwner ?? trajectory.owner;
    const scopeOwnerMatches = runMatchesScope(
      trajectory.runId,
      (input.agentRuns ?? []).find(
        (candidate) => candidate.id === trajectory.runId,
      )?.runContext,
      scope,
      causal,
      scopedGoals,
    );
    const pageOwnerMatches = !ownerConflict
      && scopeOwnerMatches
      && trajectory.events.sourceId === trajectory.runId;
    const cut = pageCut(trajectory.events, "optional");
    sourceCuts.push(pageOwnerMatches
      ? cut
      : {
          ...cut,
          status: "incompatible",
          reasonCode: "source_identity_conflict",
        });
    const owner = candidateOwner?.id === trajectory.runId
      ? candidateOwner
      : undefined;
    if (pageOwnerMatches && (!candidateOwner || owner)) {
      acceptedTrajectoryReads.add(trajectory);
    }
    if (!pageOwnerMatches || (candidateOwner && !owner)) {
      diagnostics.push({
        code: "source_identity_conflict",
        source: "trajectory",
        authorityRef: `${trajectory.runId}:${trajectory.events.sourceId}`,
      });
    }
    for (const event of trajectory.events.records) {
      if (!pageOwnerMatches || event.runId !== trajectory.runId) {
        sourceCuts.push({
          source: "trajectory",
          sourceIdentity: `record:${event.id}`,
          requiredness: "optional",
          status: "incompatible",
          reasonCode: "source_identity_conflict",
        });
        continue;
      }
      const eventType = String(event.type);
      if (!knownTrajectoryTypes.has(eventType)) {
        unknownTrajectoryFacts.push({
          schemaVersion: 1,
          originalKind: "trajectory_event_unknown",
          authorityRef: event.id,
          scope,
          domainRevision: String(event.sequence),
          domainStatus: "unknown",
          requiredness: event.payload.requiredness === "optional"
            ? "optional"
            : "required",
          durability: "durable",
          sensitivity: "technical",
          occurredAt: event.createdAt,
          semanticSlot: `trajectory:${event.runId}:${event.id}`,
          safeSummary: "Unknown trajectory evidence",
        });
        continue;
      }
      const fact = makeFact("trajectory", {
        authorityRef: event.id,
        scope,
        domainRevision: String(event.sequence),
        domainStatus: event.type,
        requiredness: "optional",
        durability: "durable",
        sensitivity: "technical",
        occurredAt: event.createdAt,
        payload: {
          semanticSlot: `trajectory:${event.runId}:${event.id}`,
          summary: `Trajectory ${event.type}`,
          disclosureClass: "evidence",
          eventId: event.id,
          runId: event.runId,
          sequence: event.sequence,
          ...(owner
            ? { owningStatus: { kind: "run" as const, status: owner.status } }
            : {}),
          evidenceTarget: {
            schemaVersion: 1,
            kind: "trajectory_event",
            runId: event.runId,
            eventId: event.id,
          },
        },
      });
      trajectoryFacts.push(fact);
      seeds.push({ primary: fact });
    }
  }

  const workspaceFacts: ConversationDisclosureFact<"workspace_run">[] = [];
  const representedWorkspaceRuns = new Set<string>();
  const acceptedWorkspaceRunIds = new Set<string>();
  for (const entry of input.workspaceRuns ?? []) {
    const requiredReference =
      requiredWorkspaceRuns.has(entry.run.workspaceRunId)
      && !conflictingWorkspaceRunIds.has(entry.run.workspaceRunId);
    const ownerMatches = workspaceRunMatchesScope(
      entry.run,
      scope,
      causal,
      requiredReference,
    );
    const required = requiredReference && ownerMatches;
    const pageOwnerMatches = ownerMatches && (
      !entry.events
      || entry.events.sourceId === entry.run.workspaceRunId
    );
    if (!ownerMatches) {
      addSourceIdentityConflict(
        sourceCuts,
        diagnostics,
        "workspace_run",
        entry.run.workspaceRunId,
        requiredReference ? "required" : "optional",
      );
      if (requiredReference) {
        representedWorkspaceRuns.add(entry.run.workspaceRunId);
      }
      continue;
    }
    acceptedWorkspaceRunIds.add(entry.run.workspaceRunId);
    if (required) representedWorkspaceRuns.add(entry.run.workspaceRunId);
    if (entry.events) {
      const cut = pageCut(entry.events, required ? "required" : "optional");
      sourceCuts.push(pageOwnerMatches
        ? cut
        : {
            ...cut,
            status: "incompatible",
            reasonCode: "source_identity_conflict",
          });
      if (!pageOwnerMatches) {
        diagnostics.push({
          code: "source_identity_conflict",
          source: "workspace_run",
          authorityRef:
            `${entry.run.workspaceRunId}:${entry.events.sourceId}`,
        });
      }
    }
    const ownerFact = makeFact("workspace_run", {
      authorityRef: entry.run.workspaceRunId,
      scope,
      domainRevision: entry.run.updatedAt,
      domainStatus: entry.run.status,
      requiredness: required ? "required" : "optional",
      durability: "durable",
      sensitivity: "technical",
      occurredAt: entry.run.updatedAt,
      payload: {
        semanticSlot: `workspace-run:${entry.run.workspaceRunId}`,
        summary: `Workspace run ${entry.run.status}`,
        disclosureClass: "operation",
        workspaceRunId: entry.run.workspaceRunId,
        runId: entry.run.workspaceRunId,
      },
    });
    seeds.push({ primary: ownerFact });
    for (const event of entry.events?.records ?? []) {
      const requiredEventReference = requiredWorkspaceSettlements.some(
        ({ settlement }) =>
          settlement.state === "committed"
          && settlement.workspaceRunId === entry.run.workspaceRunId
          && settlement.workspaceEventId === event.id
          && !conflictingWorkspaceSettlementKeys.has(
            workspaceSettlementKey(settlement),
          ),
      );
      const eventOwnerMatches = pageOwnerMatches
        && event.workspaceRunId === entry.run.workspaceRunId
        && event.sessionId === entry.run.sessionId
        && event.requestId === entry.run.requestId;
      if (!eventOwnerMatches) {
        sourceCuts.push({
          source: "workspace_run",
          sourceIdentity: `record:${event.id}`,
          requiredness: requiredEventReference ? "required" : "optional",
          status: "incompatible",
          reasonCode: "source_identity_conflict",
        });
        diagnostics.push({
          code: "source_identity_conflict",
          source: "workspace_run",
          authorityRef: `${entry.run.workspaceRunId}:${event.id}`,
        });
        continue;
      }
      const exactRequiredEvent = requiredWorkspaceSettlements.some(
        ({ record, settlement }) =>
          !conflictingWorkspaceSettlementKeys.has(
            workspaceSettlementKey(settlement),
          )
          && workspaceEventMatchesSettlement(
            event,
            entry.run,
            record,
            settlement,
          ),
      );
      if (exactRequiredEvent) {
        for (const obligation of requiredWorkspaceSettlements) {
          if (
            workspaceEventMatchesSettlement(
              event,
              entry.run,
              obligation.record,
              obligation.settlement,
            )
          ) {
            representedWorkspaceEvents.add(
              settlementObligationIdentity(
                obligation.record,
                obligation.settlement,
              ),
            );
          }
        }
      }
      const fact = makeFact("workspace_run", {
        authorityRef: event.id,
        scope,
        domainRevision: String(event.seq),
        domainStatus: entry.run.status,
        requiredness: exactRequiredEvent ? "required" : "optional",
        durability: "durable",
        sensitivity: "technical",
        occurredAt: event.createdAt,
        payload: {
          semanticSlot: `workspace-event:${entry.run.workspaceRunId}:${event.id}`,
          summary: safeSummary(event.message ?? `Workspace ${event.type}`),
          disclosureClass: event.lifecycleStatus ? "operation" : "evidence",
          workspaceRunId: entry.run.workspaceRunId,
          eventId: event.id,
          sequence: event.seq,
          runId: entry.run.workspaceRunId,
        },
      });
      workspaceFacts.push(fact);
      seeds.push({ primary: fact, contributors: [ownerFact] });
    }
  }
  for (const requiredRunId of requiredWorkspaceRuns) {
    if (conflictingWorkspaceRunIds.has(requiredRunId)) continue;
    if (representedWorkspaceRuns.has(requiredRunId)) continue;
    sourceCuts.push({
      source: "workspace_run",
      sourceIdentity: `record:${requiredRunId}`,
      requiredness: "required",
      status: "unavailable",
      reasonCode: "required_owner_missing",
    });
    diagnostics.push({
      code: "required_owner_missing",
      source: "workspace_run",
      authorityRef: requiredRunId,
    });
  }
  for (const { record, settlement } of requiredWorkspaceSettlements) {
    const witnessKey = workspaceSettlementKey(settlement);
    if (conflictingWorkspaceSettlementKeys.has(witnessKey)) continue;
    if (
      settlement.state === "committed"
      && representedWorkspaceEvents.has(
        settlementObligationIdentity(record, settlement),
      )
    ) {
      continue;
    }
    addMissingRequiredWitness(
      sourceCuts,
      diagnostics,
      "workspace_run",
      settlement.workspaceEventId ?? `settlement:${settlement.id}`,
      settlement.workspaceRunId,
      settlement.state === "committed"
        ? "required_witness_missing"
        : "required_settlement_incomplete",
    );
  }

  const toolInvocationGroups = new Map<string, ToolInvocationRecord[]>();
  for (const invocation of input.toolInvocations ?? []) {
    appendMapValue(
      toolInvocationGroups,
      `${invocation.runId}\0${invocation.id}`,
      invocation,
    );
  }
  const explicitToolConflicts = new Set(
    (input.toolInvocationConflicts ?? []).map(
      (conflict) => `${conflict.runId}\0${conflict.invocationId}`,
    ),
  );
  const toolInvocationKeys = new Set([
    ...toolInvocationGroups.keys(),
    ...explicitToolConflicts,
  ]);
  for (const invocationKey of toolInvocationKeys) {
    const candidates = toolInvocationGroups.get(invocationKey) ?? [];
    const invocationId = invocationKey.slice(invocationKey.indexOf("\0") + 1);
    const required = requiredToolInvocationRequirements.has(invocationKey)
      && !conflictingToolInvocationKeys.has(invocationKey);
    const selection = selectToolInvocationCandidate(candidates);
    if (explicitToolConflicts.has(invocationKey) || selection.kind === "conflict") {
      addSourceIdentityConflict(
        sourceCuts,
        diagnostics,
        "tool_invocation",
        invocationId!,
        required ? "required" : "optional",
      );
      if (required) representedToolInvocations.add(invocationKey);
      continue;
    }
    const invocation = selection.invocation;
    const associationKey = `${invocation.runId}\0${invocation.toolCallId}`;
    const hasExecutionOwner = agentRuns.has(invocation.runId)
      || checkpointRunIds.has(invocation.runId)
      || acceptedWorkspaceRunIds.has(invocation.runId);
    if (!hasExecutionOwner) {
      if (required) {
        addMissingRequiredWitness(
          sourceCuts,
          diagnostics,
          "tool_invocation",
          invocation.id,
          invocation.runId,
          "required_owner_missing",
        );
        representedToolInvocations.add(invocationKey);
      } else {
        addOptionalUnavailableSource(
          sourceCuts,
          diagnostics,
          "tool_invocation",
          invocation.id,
        );
      }
      continue;
    }
    if (!runMatchesScope(
      invocation.runId,
      (input.agentRuns ?? []).find(
        (candidate) => candidate.id === invocation.runId,
      )?.runContext
        ?? (input.activeCheckpoints ?? []).find(
          (candidate) => candidate.runId === invocation.runId,
        )?.runContext,
      scope,
      causal,
      scopedGoals,
    )) {
      addSourceIdentityConflict(
        sourceCuts,
        diagnostics,
        "tool_invocation",
        invocation.id,
        required ? "required" : "optional",
      );
      if (required) representedToolInvocations.add(invocationKey);
      continue;
    }
    if (required) representedToolInvocations.add(invocationKey);
    const linkedWorkspaceRunIds = new Set(
      causal
        .filter((record) => record.refs.some((ref) =>
          ref.kind === "tool_invocation"
          && ref.runId === invocation.runId
          && ref.id === invocation.id))
        .flatMap((record) => [
          ...record.refs.flatMap((ref) =>
            ref.kind === "workspace_run" ? [ref.id] : []),
          ...(record.requiredSettlements ?? []).flatMap((settlement) =>
            settlement.workspaceRunId ? [settlement.workspaceRunId] : []),
        ]),
    );
    const contributors = [
      ...trajectoryFacts.filter((fact) =>
        fact.payload.runId === invocation.runId
        && trajectoryEventMatchesInvocation(
          input.trajectory ?? [],
          fact.authorityRef,
          invocation,
        )),
      ...workspaceFacts.filter((fact) =>
        workspaceEventMatchesInvocation(
          input.workspaceRuns ?? [],
          fact.authorityRef,
          invocation,
        )
        && (
          fact.payload.runId === invocation.runId
          || linkedWorkspaceRunIds.has(fact.payload.workspaceRunId)
        )),
    ];
    const relevantTrajectory = (input.trajectory ?? []).filter(
      (entry) => entry.runId === invocation.runId,
    );
    const relevantWorkspace = (input.workspaceRuns ?? []).filter((entry) =>
      entry.run.workspaceRunId === invocation.runId
      || linkedWorkspaceRunIds.has(entry.run.workspaceRunId)
      || entry.events?.records.some((event) =>
        event.type === "tool_invocation"
        && event.toolInvocationId === invocation.id
        && event.toolCallId === invocation.toolCallId));
    const relevantContributorSources = [
      ...relevantTrajectory.map((entry) =>
        acceptedTrajectoryReads.has(entry) && trajectoryReadIsComplete(entry)),
      ...relevantWorkspace.map(workspaceReadIsComplete),
    ];
    seeds.push({
      primary: makeFact("tool_invocation", {
        authorityRef: invocation.id,
        scope,
        domainRevision: invocation.updatedAt,
        domainStatus: invocation.status,
        requiredness: required ? "required" : "optional",
        durability: "durable",
        sensitivity: "technical",
        occurredAt: invocation.updatedAt,
        payload: {
          semanticSlot: `tool:${associationKey}`,
          summary: `Tool ${safeId(invocation.toolName)} ${invocation.status}`,
          disclosureClass: invocation.status === "waiting_approval"
            ? "gate"
            : "operation",
          runId: invocation.runId,
          invocationId: invocation.id,
          toolCallId: invocation.toolCallId,
          toolName: safeId(invocation.toolName),
          ...(typeof invocation.ok === "boolean" ? { ok: invocation.ok } : {}),
          actionRequired: invocation.status === "waiting_approval",
          evidenceTarget: {
            schemaVersion: 1,
            kind: "tool_invocation",
            runId: invocation.runId,
            invocationId: invocation.id,
          },
        },
      }),
      contributors,
      contributorsComplete:
        relevantContributorSources.length > 0
        && relevantContributorSources.every(Boolean),
    });
  }
  for (const requiredInvocation of requiredToolInvocationRequirements.keys()) {
    if (conflictingToolInvocationKeys.has(requiredInvocation)) continue;
    if (representedToolInvocations.has(requiredInvocation)) continue;
    const [runId, invocationId] = requiredInvocation.split("\0");
    addMissingRequiredWitness(
      sourceCuts,
      diagnostics,
      "tool_invocation",
      invocationId!,
      runId,
    );
  }

  const representedApprovals = new Set<string>();
  for (const approval of input.approvals ?? []) {
    const required = approval.state === "pending"
      || requiredApprovalRequirements.has(approval.id);
    if (!approvalMatchesScope(approval, scope, causal)) {
      addSourceIdentityConflict(
        sourceCuts,
        diagnostics,
        "approval",
        approval.id,
        required ? "required" : "optional",
      );
      if (requiredApprovalRequirements.has(approval.id)) {
        representedApprovals.add(approval.id);
      }
      continue;
    }
    if (requiredApprovalRequirements.has(approval.id)) {
      representedApprovals.add(approval.id);
    }
    seeds.push({
      primary: makeFact("approval", {
        authorityRef: approval.id,
        scope,
        domainRevision: String(approval.revision),
        domainStatus: approval.state === "pending"
          ? "pending"
          : approval.state === "approved"
            ? "approved"
            : "denied_or_interrupted",
        requiredness: required ? "required" : "optional",
        durability: "process_recoverable",
        sensitivity: "restricted",
        occurredAt: approval.updatedAt,
        payload: {
          semanticSlot: `approval:${approval.id}`,
          summary: `Approval ${approval.state}`,
          disclosureClass: "gate",
          approvalId: approval.id,
          ...(approval.causalRef.toolInvocationId
            ? { invocationId: approval.causalRef.toolInvocationId }
            : {}),
          ...(approval.decision
            ? {
                decisionReasonClass: approval.state === "approved"
                  ? "approved"
                  : approval.state === "denied"
                    ? "user_denied"
                    : "aborted_or_timeout",
              }
            : {}),
          actionRequired: approval.state === "pending",
        },
      }),
    });
  }
  for (const approvalId of requiredApprovalRequirements.keys()) {
    if (conflictingApprovalIds.has(approvalId)) {
      addConflictingRequiredWitness(
        sourceCuts,
        diagnostics,
        "approval",
        approvalId,
      );
      continue;
    }
    if (representedApprovals.has(approvalId)) continue;
    addMissingRequiredWitness(
      sourceCuts,
      diagnostics,
      "approval",
      approvalId,
    );
  }

  for (const observation of input.guidedInputs ?? []) {
    const settlement = observation.settlement;
    const owner = observation.settlementOwner;
    const event = observation.chatEvent;
    const settlementComplete = Boolean(
      settlement
      && owner
      && event
      && settlement.id === observation.state.settlementId
      && settlement.guidedInputRequestId
        === observation.state.inputRequestId
      && settlement.requiredDomains.includes("chat")
      && settlement.targetState === "waiting_for_input"
      && owner.sessionId === observation.state.sessionId
      && owner.requestId === observation.state.requestId
      && event.pendingSkillInput?.inputRequestId
        === observation.state.inputRequestId
      && event.pendingSkillInput.settlementId
        === observation.state.settlementId
      && (!scope.sessionId || owner.sessionId === scope.sessionId)
      && (!scope.runId || causalRecordReferencesRun(owner, scope.runId))
      && causal.some((record) =>
        record.sessionId === owner.sessionId
        && record.requestId === owner.requestId
        && record.turnId === owner.turnId
        && (record.requiredSettlements ?? []).some((candidate) =>
          settlementObligationIdentity(record, candidate)
            === settlementObligationIdentity(record, settlement)))
      && chatEventMatchesSettlement(event, owner, settlement)
    );
    if (!settlementComplete && observation.state.status === "pending") {
      sourceCuts.push({
        source: "guided_input",
        sourceIdentity: `record:${observation.state.inputRequestId}`,
        requiredness: "required",
        status: "unavailable",
        reasonCode: "required_settlement_incomplete",
      });
      diagnostics.push({
        code: "required_settlement_incomplete",
        source: "guided_input",
        authorityRef: observation.state.inputRequestId,
      });
      continue;
    }
    seeds.push({
      primary: makeFact("guided_input", {
        authorityRef: observation.state.inputRequestId,
        scope,
        domainRevision: observation.state.settlementId,
        domainStatus: observation.state.status,
        requiredness: observation.state.status === "pending"
          ? "required"
          : "optional",
        durability: "process_recoverable",
        sensitivity: "restricted",
        occurredAt: observation.occurredAt,
        payload: {
          semanticSlot: `guided-input:${observation.state.inputRequestId}`,
          summary: `Guided input ${observation.state.status}`,
          disclosureClass: "gate",
          inputRequestId: observation.state.inputRequestId,
          requestId: observation.state.requestId,
          actionRequired: observation.state.status === "pending",
        },
      }),
    });
  }

  for (const context of input.contexts ?? []) {
    seeds.push({
      primary: makeFact("context", {
        authorityRef: context.authorityRef,
        scope,
        domainRevision: context.occurredAt,
        domainStatus: context.status,
        requiredness: "optional",
        durability: "durable",
        sensitivity: "technical",
        occurredAt: context.occurredAt,
        payload: {
          semanticSlot: `context:${context.authorityRef}`,
          summary: `Context ${context.status}`,
          disclosureClass: "ambient",
          ...context.snapshot,
        },
      }),
    });
  }

  for (const usage of input.usages ?? []) {
    seeds.push({
      primary: makeFact("usage", {
        authorityRef: usage.authorityRef,
        scope,
        domainRevision: usage.occurredAt,
        domainStatus: usage.status,
        requiredness: "optional",
        durability: "durable",
        sensitivity: "technical",
        occurredAt: usage.occurredAt,
        payload: {
          semanticSlot: `usage:${usage.authorityRef}`,
          summary: `Usage ${usage.status}`,
          disclosureClass: "ambient",
          totalTokens: usage.usage.totalTokens,
          ...(usage.usage.promptTokens !== undefined
            ? { promptTokens: usage.usage.promptTokens }
            : {}),
          ...(usage.usage.completionTokens !== undefined
            ? { completionTokens: usage.usage.completionTokens }
            : {}),
        },
      }),
    });
  }

  for (const kernel of input.kernel ?? []) {
    if (!runMatchesScope(
      kernel.runId,
      (input.agentRuns ?? []).find(
        (candidate) => candidate.id === kernel.runId,
      )?.runContext
        ?? (input.activeCheckpoints ?? []).find(
          (candidate) => candidate.runId === kernel.runId,
        )?.runContext,
      scope,
      causal,
      scopedGoals,
    )) {
      addSourceIdentityConflict(
        sourceCuts,
        diagnostics,
        "kernel",
        kernel.authorityRef,
        "optional",
      );
      continue;
    }
    seeds.push({
      primary: makeFact("kernel", {
        authorityRef: kernel.authorityRef,
        scope,
        domainRevision: kernel.occurredAt,
        domainStatus: kernel.status,
        requiredness: "optional",
        durability: "ephemeral",
        sensitivity: "technical",
        occurredAt: kernel.occurredAt,
        payload: {
          semanticSlot: `kernel:${kernel.runId}`,
          summary: `Kernel ${kernel.status}`,
          disclosureClass: "evidence",
          runId: kernel.runId,
          ...(kernel.turn !== undefined ? { turn: kernel.turn } : {}),
          ...(kernel.maxTurns !== undefined ? { maxTurns: kernel.maxTurns } : {}),
        },
      }),
    });
  }

  return {
    seeds: structuredClone(seeds),
    unknownFacts: structuredClone([
      ...(input.unknownFacts ?? []),
      ...unknownTrajectoryFacts,
    ]),
    sourceCuts: structuredClone(sourceCuts),
    diagnostics: structuredClone(diagnostics),
  };
}

function makeFact<K extends ConversationDisclosureFact["kind"]>(
  kind: K,
  value: Omit<ConversationDisclosureFact<K>, "schemaVersion" | "kind">,
): ConversationDisclosureFact<K> {
  return {
    schemaVersion: 1,
    kind,
    ...value,
  } as ConversationDisclosureFact<K>;
}

function pageCut<T>(
  page: ConversationSourcePage<T>,
  requiredness: ConversationSourceCut["requiredness"],
): ConversationSourceCut {
  const status = page.nextCursor && page.status === "complete"
    ? "partial"
    : page.status;
  const reasonCode = page.nextCursor && page.status === "complete"
    ? "source_page_incomplete"
    : page.reasonCode;
  return {
    source: page.source,
    sourceIdentity: page.sourceId,
    cursor: page.sourceRevision,
    requiredness,
    status,
    ...(reasonCode ? { reasonCode } : {}),
  };
}

function sourcePageIsComplete(
  page: Pick<ConversationSourcePage<unknown>, "status" | "nextCursor">,
): boolean {
  return page.status === "complete" && !page.nextCursor;
}

function trajectoryReadIsComplete(
  entry: ConversationTrajectoryRead,
): boolean {
  return entry.events.sourceId === entry.runId
    && entry.events.records.every((event) => event.runId === entry.runId)
    && sourcePageIsComplete(entry.events);
}

function workspaceReadIsComplete(
  entry: ConversationWorkspaceRead,
): boolean {
  return Boolean(
    entry.events
    && entry.events.sourceId === entry.run.workspaceRunId
    && entry.events.records.every((event) =>
      event.workspaceRunId === entry.run.workspaceRunId
      && event.sessionId === entry.run.sessionId
      && event.requestId === entry.run.requestId)
    && sourcePageIsComplete(entry.events),
  );
}

function addMissingRequiredWitness(
  sourceCuts: ConversationSourceCut[],
  diagnostics: ConversationAdapterDiagnostic[],
  source: ConversationSourceCut["source"],
  authorityRef: string,
  ownerRef?: string,
  code:
    | "required_owner_missing"
    | "required_witness_missing"
    | "required_settlement_incomplete" = "required_witness_missing",
): void {
  sourceCuts.push({
    source,
    sourceIdentity: `record:${authorityRef}`,
    requiredness: "required",
    status: "unavailable",
    reasonCode: code,
  });
  diagnostics.push({
    code,
    source,
    authorityRef: ownerRef
      ? `${ownerRef}:${authorityRef}`
      : authorityRef,
  });
}

function addConflictingRequiredWitness(
  sourceCuts: ConversationSourceCut[],
  diagnostics: ConversationAdapterDiagnostic[],
  source: ConversationSourceCut["source"],
  authorityRef: string,
): void {
  sourceCuts.push({
    source,
    sourceIdentity: `record:${authorityRef}`,
    requiredness: "required",
    status: "incompatible",
    reasonCode: "required_witness_conflict",
  });
  diagnostics.push({
    code: "required_witness_conflict",
    source,
    authorityRef,
  });
}

function addSourceIdentityConflict(
  sourceCuts: ConversationSourceCut[],
  diagnostics: ConversationAdapterDiagnostic[],
  source: ConversationSourceCut["source"],
  authorityRef: string,
  requiredness: ConversationSourceCut["requiredness"],
): void {
  sourceCuts.push({
    source,
    sourceIdentity: `record:${authorityRef}`,
    requiredness,
    status: "incompatible",
    reasonCode: "source_identity_conflict",
  });
  diagnostics.push({
    code: "source_identity_conflict",
    source,
    authorityRef,
  });
}

function addOptionalUnavailableSource(
  sourceCuts: ConversationSourceCut[],
  diagnostics: ConversationAdapterDiagnostic[],
  source: ConversationSourceCut["source"],
  authorityRef: string,
): void {
  sourceCuts.push({
    source,
    sourceIdentity: `record:${authorityRef}`,
    requiredness: "optional",
    status: "unavailable",
    reasonCode: "source_unavailable",
  });
  diagnostics.push({
    code: "source_unavailable",
    source,
    authorityRef,
  });
}

function runMatchesScope(
  runId: string,
  runContext: AgentRunRecord["runContext"],
  scope: ConversationDisclosureScope,
  causal: readonly ConversationCausalRecord[],
  goals: readonly Goal[],
): boolean {
  if (scope.runId && scope.runId !== runId) return false;
  const causalOwner = causal.some((record) =>
    (!scope.sessionId || record.sessionId === scope.sessionId)
    && causalRecordReferencesRun(record, runId));
  const sessionOwnedSurface = scope.surface === "chat"
    || scope.surface === "goal";
  if (
    scope.sessionId
    && (
      runContext?.sessionId
        ? runContext.sessionId !== scope.sessionId
        : sessionOwnedSurface && !causalOwner
    )
  ) {
    return false;
  }
  if (
    scope.goalId
    && (
      (runContext?.goalId && runContext.goalId !== scope.goalId)
      || !goals.some((goal) =>
        goal.id === scope.goalId
        && goal.milestones.some((milestone) => milestone.runIds.includes(runId)))
    )
  ) {
    return false;
  }
  return true;
}

function workspaceRunMatchesScope(
  run: WorkspaceRun,
  scope: ConversationDisclosureScope,
  causal: readonly ConversationCausalRecord[],
  declaredRequired: boolean,
): boolean {
  if (scope.sessionId && run.sessionId !== scope.sessionId) return false;
  if (!scope.runId && !scope.goalId) return true;
  if (scope.runId === run.workspaceRunId) return true;
  if (!declaredRequired) return false;
  return causal.some((record) =>
    record.requestId === run.requestId
    && (!record.sessionId || record.sessionId === run.sessionId)
    && (!scope.runId || causalRecordReferencesRun(record, scope.runId))
    && (
      record.refs.some((ref) =>
        ref.kind === "workspace_run" && ref.id === run.workspaceRunId)
      || (record.requiredSettlements ?? []).some((settlement) =>
        settlement.workspaceRunId === run.workspaceRunId)
    ));
}

function approvalMatchesScope(
  approval: ToolApprovalIntent,
  scope: ConversationDisclosureScope,
  causal: readonly ConversationCausalRecord[],
): boolean {
  if (
    scope.sessionId
    && approval.causalRef.sessionId !== scope.sessionId
  ) {
    return false;
  }
  if (
    scope.runId
    && ![
      approval.causalRef.agentRunId,
      approval.causalRef.trajectoryRunId,
      approval.causalRef.workspaceRunId,
      approval.causalRef.kernelRunId,
      approval.causalRef.toolInvocationRunId,
    ].includes(scope.runId)
  ) {
    return false;
  }
  if (scope.goalId && !scope.sessionId && !scope.runId) return false;
  return causal.some((record) =>
    Boolean(approval.causalRef.requestId)
    && record.requestId === approval.causalRef.requestId
    && (
      !approval.causalRef.turnId
      || record.turnId === approval.causalRef.turnId
    )
    && (
      !approval.causalRef.sessionId
      || record.sessionId === approval.causalRef.sessionId
    )
    && record.refs.some((ref) =>
      ref.kind === "approval" && ref.id === approval.id));
}

function causalRecordReferencesRun(
  record: Pick<
    ConversationCausalRecord,
    "agentRunAdmissions" | "refs"
  >,
  runId: string,
): boolean {
  return Boolean(
    record.agentRunAdmissions?.some((entry) => entry.runId === runId)
    || record.refs.some((entry) =>
      entry.kind === "tool_invocation"
        ? entry.runId === runId
        : (
            entry.kind === "agent_run"
            || entry.kind === "trajectory_run"
            || entry.kind === "workspace_run"
          )
          && entry.id === runId),
  );
}

function conflictingMapKeys<T>(
  requirements: ReadonlyMap<string, readonly T[]>,
  identity: (value: T) => string,
): Set<string> {
  return new Set(
    [...requirements]
      .filter(([, values]) =>
        new Set(values.map((value) => identity(value))).size > 1)
      .map(([key]) => key),
  );
}

function conflictingGroupedKeys<T>(
  requirements: readonly T[],
  groupKey: (value: T) => string,
  identity: (value: T) => string,
): Set<string> {
  const grouped = new Map<string, T[]>();
  for (const requirement of requirements) {
    appendMapValue(grouped, groupKey(requirement), requirement);
  }
  return conflictingMapKeys(grouped, identity);
}

function agentRunRequirementIdentity(requirement: {
  sessionId?: string;
  requestId: string;
  turnId: string;
  taskId: string;
  executionRevision: number;
  state: "admitted" | "started" | "settled" | "aborted";
  finalStatus?: "succeeded" | "paused" | "failed" | "canceled";
}): string {
  return JSON.stringify([
    requirement.sessionId ?? null,
    requirement.requestId,
    requirement.turnId,
    requirement.taskId,
    requirement.executionRevision,
    requirement.state,
    requirement.finalStatus ?? null,
  ]);
}

function agentRunRequirementKey(
  runId: string,
  requirement: {
    executionRevision: number;
  },
): string {
  return `${runId}\0${requirement.executionRevision}`;
}

function agentRunObligationIdentity(
  runId: string,
  requirement: Parameters<typeof agentRunRequirementIdentity>[0],
): string {
  return JSON.stringify([
    runId,
    agentRunRequirementIdentity(requirement),
  ]);
}

function workspaceOwnerRequirementIdentity(requirement: {
  sessionId?: string;
  requestId: string;
  turnId: string;
}): string {
  return JSON.stringify([
    requirement.sessionId ?? null,
    requirement.requestId,
    requirement.turnId,
  ]);
}

function workspaceSettlementKey(
  settlement: ConversationRequiredSettlement,
): string {
  return `${settlement.workspaceRunId ?? ""}\0${
    settlement.workspaceEventId ?? `settlement:${settlement.id}`
  }`;
}

function settlementObligationIdentity(
  record: ConversationCausalRecord,
  settlement: ConversationRequiredSettlement,
): string {
  return JSON.stringify([
    record.sessionId ?? null,
    record.requestId,
    record.turnId,
    settlement.id,
    settlement.attempt,
    settlement.sourceSequence,
    settlement.targetState,
    [...settlement.requiredDomains].sort(),
    settlement.workspaceRunId ?? null,
    settlement.workspaceEventId ?? null,
    settlement.guidedInputRequestId ?? null,
    settlement.state,
  ]);
}

function chatEventMatchesSettlement(
  event: ChatTaskStatusEvent,
  record: Pick<
    ConversationCausalRecord,
    "sessionId" | "requestId" | "turnId"
  >,
  settlement: ConversationRequiredSettlement,
): boolean {
  if (
    settlement.state !== "committed"
    || settlement.id !== event.settlementId
    || settlement.targetState !== event.state
    || settlement.sourceSequence !== event.sequence
    || (!record.sessionId || record.sessionId !== event.sessionId)
    || record.requestId !== event.requestId
    || record.turnId !== event.turnId
    || !settlement.chatEventFingerprint
    || settlement.chatEventFingerprint
      !== settlement.preparedChatEventFingerprint
  ) {
    return false;
  }
  return createRequiredChatEventFingerprint(event)
    === settlement.chatEventFingerprint;
}

function workspaceEventMatchesSettlement(
  event: WorkspaceRunEvent,
  run: WorkspaceRun,
  record: ConversationCausalRecord,
  settlement: ConversationRequiredSettlement,
): boolean {
  return settlement.state === "committed"
    && Boolean(settlement.preparedWorkspaceEventId)
    && settlement.workspaceEventId === settlement.preparedWorkspaceEventId
    && settlement.workspaceRunId === run.workspaceRunId
    && settlement.workspaceEventId === event.id
    && event.workspaceRunId === run.workspaceRunId
    && event.sessionId === run.sessionId
    && event.requestId === run.requestId
    && (!record.sessionId || record.sessionId === event.sessionId)
    && record.requestId === event.requestId
    && event.causalRef?.turnId === record.turnId
    && event.causalRef.sourceSequence === settlement.sourceSequence
    && event.type === "status"
    && event.status === settlement.targetState
    && event.lifecycleStatus === settlement.targetState;
}

export function createRequiredChatEventFingerprint(
  event: ChatTaskStatusEvent,
): string {
  const persistedEvent = normalizeChatTaskStatusEventForPersistence(event);
  const pendingSkillInput = persistedEvent.pendingSkillInput
    ? {
        ...persistedEvent.pendingSkillInput,
        ...(persistedEvent.pendingSkillInput.attachmentPayloads
          ? {
              attachmentPayloads:
                persistedEvent.pendingSkillInput.attachmentPayloads.map(
                  ({ dataBase64, ...metadata }) => ({
                    ...metadata,
                    dataFingerprint:
                      createConversationRequestFingerprint(dataBase64),
                  }),
                ),
            }
          : {}),
      }
    : undefined;
  return createConversationRequestFingerprint({
    schemaVersion: 2,
    event: {
      ...persistedEvent,
      ...(pendingSkillInput ? { pendingSkillInput } : {}),
    },
  });
}

function appendMapValue<K, V>(
  map: Map<K, V[]>,
  key: K,
  value: V,
): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function messageMatchesRequirement(
  message: ChatMessageRecord,
  requirement: {
    role: "user" | "assistant";
    requestId: string;
    turnId: string;
    attempt?: number;
    settlementStatus?: "succeeded" | "paused" | "failed" | "canceled";
  },
): boolean {
  return message.role === requirement.role
    && message.requestId === requirement.requestId
    && message.turnId === requirement.turnId
    && (
      requirement.attempt === undefined
      || message.causalAttempt === requirement.attempt
    )
    && (
      requirement.settlementStatus === undefined
      || message.turnSettlementStatus === requirement.settlementStatus
    );
}

function messageRequirementIdentity(requirement: {
  role: "user" | "assistant";
  requestId: string;
  turnId: string;
  attempt?: number;
  settlementStatus?: "succeeded" | "paused" | "failed" | "canceled";
}): string {
  return JSON.stringify([
    requirement.role,
    requirement.requestId,
    requirement.turnId,
    requirement.attempt ?? null,
    requirement.settlementStatus ?? null,
  ]);
}

function agentRunMatchesRequirement(
  run: AgentRunRecord,
  requirement: {
    taskId: string;
    executionRevision: number;
    state: "admitted" | "started" | "settled" | "aborted";
    finalStatus?: "succeeded" | "paused" | "failed" | "canceled";
  },
): boolean {
  return run.taskId === requirement.taskId
    && (run.executionRevision ?? 1) === requirement.executionRevision
    && (
      !requirement.finalStatus
      || run.status === requirement.finalStatus
      || (
        run.status === "waiting_for_approval"
        && requirement.finalStatus === "paused"
      )
    );
}

function scheduledRunMatchesRequirement(
  run: ConversationScheduledRunObservation,
  requirement: {
    taskId: string;
    executionRevision: number;
    state: "admitted" | "started" | "settled" | "aborted";
    finalStatus?: "succeeded" | "paused" | "failed" | "canceled";
  },
): boolean {
  return run.taskId === requirement.taskId
    && (
      !requirement.finalStatus
      || run.status === requirement.finalStatus
      || (
        run.status === "waiting_for_approval"
        && requirement.finalStatus === "paused"
      )
    );
}

function selectToolInvocationCandidate(
  candidates: readonly ToolInvocationRecord[],
):
  | { kind: "selected"; invocation: ToolInvocationRecord }
  | { kind: "conflict" } {
  if (candidates.length === 0) return { kind: "conflict" };
  const identityFingerprints = new Set(candidates.map((candidate) =>
    createConversationRequestFingerprint({
      id: candidate.id,
      runId: candidate.runId,
      toolCallId: candidate.toolCallId,
      toolName: candidate.toolName,
    })));
  if (identityFingerprints.size !== 1) return { kind: "conflict" };
  const bodiesByRevision = new Map<string, string>();
  for (const candidate of candidates) {
    const revision = candidate.updatedAt;
    const body = createConversationRequestFingerprint({
      id: candidate.id,
      runId: candidate.runId,
      toolCallId: candidate.toolCallId,
      toolName: candidate.toolName,
      status: candidate.status,
      updatedAt: candidate.updatedAt,
      ok: candidate.ok ?? null,
    });
    const previous = bodiesByRevision.get(revision);
    if (previous && previous !== body) return { kind: "conflict" };
    bodiesByRevision.set(revision, body);
  }
  const invocation = [...candidates].sort((left, right) => {
    const revisionOrder = compareStrings(left.updatedAt, right.updatedAt);
    if (revisionOrder !== 0) return revisionOrder;
    const statusOrder = compareStrings(left.status, right.status);
    if (statusOrder !== 0) return statusOrder;
    return compareStrings(
      createConversationRequestFingerprint(left),
      createConversationRequestFingerprint(right),
    );
  }).at(-1)!;
  return { kind: "selected", invocation };
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeSummary(value: string): string {
  return sanitizeConversationDisclosureSummary(value).text;
}

function goalLedgerEventRef(
  goalId: string,
  event: ProgressLedgerEvent,
): string {
  return `ledger:${goalId}:${
    event.publicationKey
      ?? createConversationRequestFingerprint({
        at: event.at,
        kind: event.kind,
        milestoneId: event.milestoneId ?? null,
        summary: event.summary,
        evidenceRefs: event.evidenceRefs ?? [],
      })
  }`;
}

function safeId(value: string): string {
  return sanitizeConversationDisclosureSummary(value, {
    maxBytes: 256,
    maxLines: 1,
  }).text;
}

function activitySlot(
  record: ConversationChatActivityRecord,
): string {
  return [
    "chat-activity",
    record.event.requestId ?? "legacy",
    record.event.turnId ?? "",
    record.event.state,
    String(record.sequence),
  ].join(":");
}

function activityClass(
  state: ConversationChatActivityRecord["event"]["state"],
): "operation" | "gate" {
  return state === "waiting_for_input" || state === "paused" || state === "failed"
    ? "gate"
    : "operation";
}

function trajectoryEventMatchesInvocation(
  pages: readonly ConversationTrajectoryRead[],
  eventId: string,
  invocation: ToolInvocationRecord,
): boolean {
  for (const page of pages) {
    const event = page.events.records.find((candidate) => candidate.id === eventId);
    if (!event || event.payload.toolCallId !== invocation.toolCallId) {
      continue;
    }
    return typeof event.payload.toolInvocationId !== "string"
      || event.payload.toolInvocationId === invocation.id;
  }
  return false;
}

function workspaceEventMatchesInvocation(
  runs: readonly ConversationWorkspaceRead[],
  eventId: string,
  invocation: ToolInvocationRecord,
): boolean {
  for (const run of runs) {
    const event = run.events?.records.find((candidate) => candidate.id === eventId);
    if (event?.type === "tool_invocation") {
      return event.toolInvocationId === invocation.id
        && event.toolCallId === invocation.toolCallId;
    }
  }
  return false;
}
