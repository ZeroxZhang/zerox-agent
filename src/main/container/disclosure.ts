import { createHash } from "node:crypto";
import { toolEvidenceCandidatesConflict } from "./helpers";
import { toolEvidenceSemanticFingerprint } from "./helpers";
import { toolEvidenceIdentityFingerprint } from "./helpers";
import { toolEvidenceCandidateFingerprint } from "./helpers";
import { createConversationRequestFingerprint } from "../../shared/conversationCausalSpine";
import { ConversationEvidenceBackendResult } from "../conversationEvidenceResolver";
import { WorkspaceRunEvent } from "../../shared/workspaceRunLedger";
import { ConversationCausalRecord } from "../../shared/conversationCausalSpine";
import { evidenceTargetRunId } from "./helpers";
import { TrustedConversationEvidenceContext } from "../conversationEvidenceResolver";
import { ConversationEvidenceTarget } from "../../shared/conversationDisclosure";
import { approvalReferencesRun } from "./helpers";
import { kernelObservationStatus } from "./helpers";
import { ConversationUsageObservation } from "../conversationDisclosureAdapters";
import { projectChatSessionTokenUsage } from "../chatSessionUsage";
import { replayContextSurface } from "../contextSurface";
import { ConversationContextObservation } from "../conversationDisclosureAdapters";
import { toolInvocationFromTrajectoryEvent } from "./helpers";
import { toolCandidatesConflict } from "./helpers";
import { ToolInvocationRecord } from "../../shared/toolInvocationLedger";
import { toolInvocationFromWorkspaceEvent } from "./helpers";
import { ConversationGoalLedgerRead } from "../conversationDisclosureAdapters";
import { causalRecordReferencesRun } from "./helpers";

import { ConversationDisclosureScope } from "../../shared/conversationDisclosure";
import { createAgentExecutionStore } from "../agentExecutionStore";
import { createAgentGoalStore } from "../agentGoalStore";
import { createAgentRunStore } from "../agentRunStore";
import { createAgentTrajectoryStore } from "../agentTrajectoryStore";
import { createChatSessionStore } from "../chatSessionStore";
import { createConversationCausalStore } from "../conversationCausalStore";
import { createConversationDisclosureMaterializer } from "../conversationDisclosureMaterializer";
import { createPlanStore } from "../planStore";
import { createScheduledTaskStore } from "../taskStore";
import { createWorkspaceRunStore } from "../workspaceRunStore";
import { KernelEventBus } from "../kernel/eventBus";

/** Outer factory accessors threaded into the disclosure runtime. */
export type DisclosureRuntime = {
  agentExecutionStore: () => ReturnType<typeof createAgentExecutionStore>;
  agentGoalStore: () => ReturnType<typeof createAgentGoalStore>;
  agentRunStore: () => ReturnType<typeof createAgentRunStore>;
  agentTrajectoryStore: () => ReturnType<typeof createAgentTrajectoryStore>;
  chatSessionStore: () => ReturnType<typeof createChatSessionStore>;
  conversationCausalStore: () => ReturnType<typeof createConversationCausalStore>;
  conversationDisclosureMaterializer: () => ReturnType<typeof createConversationDisclosureMaterializer>;
  kernelEventBus: () => KernelEventBus;
  planStore: () => ReturnType<typeof createPlanStore>;
  scheduledTaskStore: () => ReturnType<typeof createScheduledTaskStore>;
  workspaceRunStore: () => ReturnType<typeof createWorkspaceRunStore>;
};

export function createDisclosureRuntime(rt: DisclosureRuntime) {
  const agentExecutionStore = rt.agentExecutionStore;
  const agentGoalStore = rt.agentGoalStore;
  const agentRunStore = rt.agentRunStore;
  const agentTrajectoryStore = rt.agentTrajectoryStore;
  const chatSessionStore = rt.chatSessionStore;
  const conversationCausalStore = rt.conversationCausalStore;
  const conversationDisclosureMaterializer = rt.conversationDisclosureMaterializer;
  const kernelEventBus = rt.kernelEventBus;
  const planStore = rt.planStore;
  const scheduledTaskStore = rt.scheduledTaskStore;
  const workspaceRunStore = rt.workspaceRunStore;  async function loadConversationDisclosureReadSet(
    scope: ConversationDisclosureScope,
    signal?: AbortSignal,
  ) {
    const scopedGoal = scope.goalId
      ? await agentGoalStore().get(scope.goalId)
      : null;
    const sessionId = scope.sessionId ?? scopedGoal?.chatSessionId;
    const goalRunIds = new Set(
      scopedGoal?.milestones.flatMap((milestone) => milestone.runIds) ?? [],
    );
    const chatStore = chatSessionStore();
    const [causalRecords, transcript, activity, plans, pendingApprovals] =
      await Promise.all([
        conversationCausalStore().listRequests(),
        sessionId
          ? chatStore.getTranscriptPage(sessionId, { limit: 200 })
          : Promise.resolve(null),
        scope.sessionId && chatStore.getActivityPage
          ? chatStore.getActivityPage(scope.sessionId, {
              limit: 200,
              signal,
            })
          : Promise.resolve(undefined),
        sessionId
          ? planStore().listBySession(sessionId).then((records) =>
              scope.goalId
                ? records.filter((record) => record.goalId === scope.goalId)
                : records)
          : Promise.resolve([]),
        conversationCausalStore().listPendingApprovalIntents(),
      ]);
    const scopedCausal = causalRecords.filter(
      (record) => {
        if (scope.runId) return causalRecordReferencesRun(record, scope.runId);
        if (scope.goalId) {
          return record.sessionId === sessionId
            && [...goalRunIds].some((runId) =>
              causalRecordReferencesRun(record, runId));
        }
        return Boolean(sessionId && record.sessionId === sessionId);
      },
    );
    const referencedApprovalIds = new Set(
      scopedCausal.flatMap((record) =>
        record.refs.flatMap((ref) =>
          ref.kind === "approval" ? [ref.id] : [])),
    );
    const referencedApprovals = (
      await Promise.all([...referencedApprovalIds].map(
        (approvalId) =>
          conversationCausalStore().getApprovalIntent(approvalId),
      ))
    ).filter((approval): approval is NonNullable<typeof approval> =>
      Boolean(approval));
    const approvalsById = new Map(
      [...pendingApprovals, ...referencedApprovals].map(
        (approval) => [approval.id, approval],
      ),
    );
    const goalIds = new Set(scope.goalId
      ? [scope.goalId]
      : transcript?.session.goalIds ?? []);
    const goals = scopedGoal
      ? [scopedGoal]
      : goalIds.size > 0
        ? await agentGoalStore().getMany([...goalIds])
        : [];
    const goalLedgers: ConversationGoalLedgerRead[] = await Promise.all(
      goals.map(async (goal) => {
      try {
        const records = await agentGoalStore().readLedger(goal.id);
        return {
          goalId: goal.id,
          sourceRevision: `goal-ledger:${
            createHash("sha256")
              .update(JSON.stringify(records))
              .digest("hex")
          }`,
          status: "complete" as const,
          records,
        };
      } catch {
        return {
          goalId: goal.id,
          sourceRevision: `goal-ledger-unavailable:${goal.updatedAt}`,
          status: "unavailable" as const,
          reasonCode: "source_unavailable",
          records: [],
        };
      }
      }),
    );
    const scopedMessages = (transcript?.session.messages ?? []).filter(
      (message) => !scope.goalId || message.goalId === scope.goalId,
    );
    const runIds = new Set(scope.runId
      ? [scope.runId]
      : [
          ...goalRunIds,
          ...scopedMessages.flatMap((message) =>
            message.executedRunId ? [message.executedRunId] : []),
          ...scopedCausal.flatMap((record) => [
            ...(record.agentRunAdmissions ?? []).map((entry) => entry.runId),
            ...record.refs.flatMap((entry) =>
              entry.kind === "agent_run" || entry.kind === "trajectory_run"
                ? [entry.id]
                : []),
          ]),
        ]);
    const agentRuns = (
      await Promise.all([...runIds].map((runId) => agentRunStore().get(runId)))
    ).filter((run): run is NonNullable<typeof run> => Boolean(run));
    const activeCheckpoints = (
      await Promise.all(
        [...runIds].map((runId) => agentExecutionStore().get(runId)),
      )
    ).filter((checkpoint): checkpoint is NonNullable<typeof checkpoint> =>
      Boolean(checkpoint));
    const scheduledTaskIds = new Set([
      ...agentRuns.map((run) => run.taskId),
      ...activeCheckpoints.map((checkpoint) => checkpoint.taskId),
    ]);
    const scheduledTasks = (
      await Promise.all(
        [...scheduledTaskIds].map((taskId) => scheduledTaskStore().get(taskId)),
      )
    ).filter((task): task is NonNullable<typeof task> => Boolean(task));
    const scheduledTaskIdSet = new Set(scheduledTasks.map((task) => task.id));
    const scheduledRuns = [
      ...agentRuns
        .filter((run) => scheduledTaskIdSet.has(run.taskId))
        .map((run) => ({
          taskId: run.taskId,
          runId: run.id,
          status: run.status,
          occurredAt: run.finishedAt || run.startedAt,
        })),
      ...activeCheckpoints
        .filter((checkpoint) =>
          scheduledTaskIdSet.has(checkpoint.taskId)
          && !agentRuns.some((run) => run.id === checkpoint.runId))
        .map((checkpoint) => ({
          taskId: checkpoint.taskId,
          runId: checkpoint.runId,
          status: checkpoint.status,
          occurredAt: checkpoint.updatedAt,
        })),
    ];
    const trajectory = await Promise.all(
      [...runIds].map(async (runId) => ({
        runId,
        owner: agentRuns.find((run) => run.id === runId),
        events: agentTrajectoryStore().getPage
          ? await agentTrajectoryStore().getPage!(runId, {
              limit: 200,
              signal,
            })
          : undefined,
      })),
    );
    const workspaceRunIds = new Set(
      scopedCausal.flatMap((record) => [
        ...record.refs.flatMap((entry) =>
          entry.kind === "workspace_run" ? [entry.id] : []),
        ...(record.requiredSettlements ?? []).flatMap((settlement) =>
          settlement.workspaceRunId ? [settlement.workspaceRunId] : []),
      ]),
    );
    const workspaceRuns = (
      await Promise.all([...workspaceRunIds].map(async (workspaceRunId) => {
        const run = await workspaceRunStore().getRun(workspaceRunId);
        if (!run) return null;
        const events = workspaceRunStore().getEventPage
          ? await workspaceRunStore().getEventPage!(workspaceRunId, {
              limit: 200,
              signal,
            })
          : undefined;
        return { run, events };
      }))
    ).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    const toolInvocations = workspaceRuns.flatMap((entry) =>
      (
        entry.events?.sourceId === entry.run.workspaceRunId
          ? entry.events.records
          : []
      ).flatMap((event) => {
        if (
          event.workspaceRunId !== entry.run.workspaceRunId
          || event.sessionId !== entry.run.sessionId
          || event.requestId !== entry.run.requestId
        ) {
          return [];
        }
        const invocation = toolInvocationFromWorkspaceEvent(event);
        return invocation ? [invocation] : [];
      }));
    const requiredToolInvocations = scopedCausal.flatMap((record) =>
      record.refs.flatMap((ref) =>
        ref.kind === "tool_invocation"
          ? [{ runId: ref.runId, invocationId: ref.id }]
          : []));
    const toolInvocationConflicts: Array<{
      runId: string;
      invocationId: string;
    }> = [];
    for (const required of requiredToolInvocations) {
      const resolvedCandidates: ToolInvocationRecord[] = [];
      let incompatible = false;
      const linkedWorkspaceRunIds = new Set(
        scopedCausal
          .filter((record) => record.refs.some((ref) =>
            ref.kind === "tool_invocation"
            && ref.runId === required.runId
            && ref.id === required.invocationId))
          .flatMap((record) => [
            ...record.refs.flatMap((ref) =>
              ref.kind === "workspace_run" ? [ref.id] : []),
            ...(record.requiredSettlements ?? []).flatMap((settlement) =>
              settlement.workspaceRunId
                ? [settlement.workspaceRunId]
                : []),
          ]),
      );
      for (const workspace of workspaceRuns) {
        if (
          workspace.run.workspaceRunId !== required.runId
          && !linkedWorkspaceRunIds.has(workspace.run.workspaceRunId)
        ) {
          continue;
        }
        const found = await findWorkspaceToolInvocation(
          workspace.run.workspaceRunId,
          required.invocationId,
          signal,
        );
        if (found.kind === "incompatible") {
          incompatible = true;
          continue;
        }
        if (found.kind !== "found") continue;
        const candidates = found.events.flatMap((event) => {
          const embeddedRunId = event.payload?.runId;
          if (
            typeof embeddedRunId === "string"
            && embeddedRunId
            && embeddedRunId !== required.runId
          ) {
            return [];
          }
          const candidate = toolInvocationFromWorkspaceEvent(event);
          return candidate
            ? [{ event, invocation: { ...candidate, runId: required.runId } }]
            : [];
        });
        if (
          candidates.length !== found.events.length
          || toolCandidatesConflict(candidates.map(({ invocation }) => invocation))
        ) {
          incompatible = true;
          continue;
        }
        resolvedCandidates.push(
          ...candidates.map(({ invocation }) => invocation),
        );
      }
      const trajectoryFound = await findTrajectoryToolInvocation(
        required.runId,
        required.invocationId,
        signal,
      );
      if (trajectoryFound.kind === "incompatible") {
        incompatible = true;
      } else if (trajectoryFound.kind === "found") {
        const candidates = trajectoryFound.events.flatMap((event) => {
          const invocation = toolInvocationFromTrajectoryEvent(
            event,
            required.invocationId,
          );
          return invocation ? [{ event, invocation }] : [];
        });
        if (
          candidates.length !== trajectoryFound.events.length
          || toolCandidatesConflict(
            candidates.map(({ invocation }) => invocation),
          )
        ) {
          incompatible = true;
        } else {
          resolvedCandidates.push(
            ...candidates.map(({ invocation }) => invocation),
          );
        }
      }
      for (let index = toolInvocations.length - 1; index >= 0; index -= 1) {
        if (
          toolInvocations[index]!.id === required.invocationId
          && (
            toolInvocations[index]!.runId === required.runId
            || linkedWorkspaceRunIds.has(toolInvocations[index]!.runId)
          )
        ) {
          if (toolInvocations[index]!.runId === required.runId) {
            resolvedCandidates.push(toolInvocations[index]!);
          }
          toolInvocations.splice(index, 1);
        }
      }
      if (incompatible) {
        toolInvocationConflicts.push(required);
      } else {
        toolInvocations.push(...resolvedCandidates);
      }
    }
    const guidedInputs = (activity?.records ?? []).flatMap((activityRecord) => {
      const state = activityRecord.event.pendingSkillInput;
      if (!state) return [];
      const obligation = scopedCausal
        .flatMap((record) =>
          (record.requiredSettlements ?? []).map((settlement) => ({
            record,
            settlement,
          })))
        .find(({ record, settlement }) =>
          settlement.id === state.settlementId
          && settlement.guidedInputRequestId === state.inputRequestId
          && record.sessionId === state.sessionId
          && record.requestId === state.requestId);
      return [{
        state,
        ...(obligation
          ? {
              settlement: obligation.settlement,
              settlementOwner: obligation.record,
              chatEvent: activityRecord.event,
            }
          : {}),
        occurredAt: activityRecord.event.createdAt,
      }];
    });
    const contexts: ConversationContextObservation[] = [];
    if (transcript?.session.context) {
      contexts.push({
        authorityRef: `chat-context:${sessionId}`,
        status:
          transcript.session.context.lastCompaction?.strategy
              === "summarize-degraded"
            ? "compacted_degraded"
            : transcript.session.context.compactionCount > 0
              ? "compacted"
              : "observed",
        snapshot: transcript.session.context,
        occurredAt: transcript.session.updatedAt,
      });
    }
    for (const goal of goals) {
      if (!goal.contextUsage) continue;
      contexts.push({
        authorityRef: `goal-context:${goal.id}`,
        status:
          goal.contextUsage.lastCompaction?.strategy === "summarize-degraded"
            ? "compacted_degraded"
            : goal.contextUsage.compactionCount > 0
              ? "compacted"
              : "observed",
        snapshot: goal.contextUsage,
        occurredAt: goal.contextUsage.updatedAt,
      });
    }
    for (const checkpoint of activeCheckpoints) {
      if (!checkpoint.contextSurface) continue;
      try {
        const replay = replayContextSurface(checkpoint.contextSurface);
        const degraded = checkpoint.contextSurface.events.some((event) =>
          event.kind === "replace"
          && (
            event.strategy === "summarize-degraded"
            || event.reason === "message-integrity"
          ));
        contexts.push({
          authorityRef: `execution-context:${checkpoint.runId}`,
          status: degraded
            ? "compacted_degraded"
            : replay.replacementCount > 0
              ? "compacted"
              : "observed",
          snapshot: {
            estimatedTokens: replay.estimatedTokens,
            compactionCount: replay.replacementCount,
          },
          occurredAt: checkpoint.updatedAt,
        });
      } catch {
        contexts.push({
          authorityRef: `execution-context:${checkpoint.runId}`,
          status: "compacted_degraded",
          snapshot: {},
          occurredAt: checkpoint.updatedAt,
        });
      }
    }
    const projectedSessionUsage = projectChatSessionTokenUsage({
      chatUsage: transcript?.session.tokenUsage,
      plans,
      goals,
    });
    const usageOccurredAt = [
      transcript?.session.updatedAt,
      ...plans.map((plan) => plan.updatedAt),
      ...goals.map((goal) => goal.updatedAt),
    ].filter((value): value is string => Boolean(value)).sort().at(-1);
    const usages: ConversationUsageObservation[] = [
      ...(projectedSessionUsage && sessionId && usageOccurredAt
        ? [{
            authorityRef: `session-usage:${sessionId}`,
            status: projectedSessionUsage.estimated
              ? "estimated" as const
              : "measured" as const,
            usage: projectedSessionUsage,
            occurredAt: usageOccurredAt,
          }]
        : []),
      ...activeCheckpoints.flatMap((checkpoint) =>
        checkpoint.tokensConsumed !== undefined
          ? [{
              authorityRef: `execution-usage:${checkpoint.runId}`,
              status: checkpoint.tokensEstimated
                ? "estimated" as const
                : "measured" as const,
              usage: {
                totalTokens: Math.max(
                  0,
                  Math.floor(checkpoint.tokensConsumed),
                ),
                estimated: Boolean(checkpoint.tokensEstimated),
              },
              occurredAt: checkpoint.updatedAt,
            }]
          : []),
    ];
    const kernel = kernelEventBus().history()
      .filter((event) => runIds.has(event.runId))
      .map((event) => ({
        authorityRef: `kernel:${createHash("sha256")
          .update(JSON.stringify(event))
          .digest("hex")}`,
        runId: event.runId,
        status: kernelObservationStatus(event),
        occurredAt: event.createdAt,
        ...("turn" in event ? { turn: event.turn } : {}),
        ...("maxTurns" in event ? { maxTurns: event.maxTurns } : {}),
      }));
    return {
      scope,
      ...(scope.sessionId
        ? {
            chatTranscript: transcript
              ? {
                  sessionId: scope.sessionId,
                  sourceRevision: [
                    transcript.session.updatedAt,
                    transcript.page.endSequence,
                    transcript.page.totalMessages,
                  ].join("\0"),
                  status: transcript.page.hasMoreBefore
                    ? "partial" as const
                    : "complete" as const,
                  ...(transcript.page.hasMoreBefore
                    ? { reasonCode: "source_page_incomplete" }
                    : {}),
                }
              : {
                  sessionId: scope.sessionId,
                  status: "unavailable" as const,
                  reasonCode: "required_owner_missing",
                },
          }
        : {}),
      ...(scope.runId
        ? {
            runScopeAvailable: agentRuns.some((run) => run.id === scope.runId)
              || activeCheckpoints.some(
                (checkpoint) => checkpoint.runId === scope.runId,
              )
              || workspaceRuns.some(
                (entry) => entry.run.workspaceRunId === scope.runId,
              ),
          }
        : {}),
      causalRecords: scopedCausal,
      chatMessages: scopedMessages,
      ...(activity ? { chatActivity: activity } : {}),
      goals,
      goalLedgers,
      plans,
      scheduledRuns,
      agentRuns,
      activeCheckpoints,
      trajectory: trajectory.flatMap((entry) =>
        entry.events ? [{
          runId: entry.runId,
          ...(entry.owner ? { owner: entry.owner } : {}),
          events: entry.events,
        }] : []),
      workspaceRuns,
      toolInvocations,
      toolInvocationConflicts,
      approvals: [...approvalsById.values()].filter((intent) =>
        scope.runId
          ? approvalReferencesRun(intent, scope.runId)
          : scope.goalId
            ? [...goalRunIds].some((runId) =>
                approvalReferencesRun(intent, runId))
            : Boolean(
                sessionId && intent.causalRef.sessionId === sessionId,
              )),
      guidedInputs,
      contexts,
      usages,
      kernel,
    };
  }

  async function authorizeConversationEvidenceTarget(input: {
    target: ConversationEvidenceTarget;
    trustedContext: TrustedConversationEvidenceContext;
  }): Promise<boolean> {
    if (!input.trustedContext.actorId) return false;
    const scope = input.trustedContext.scope;
    const target = input.target;
    if (target.kind === "contributor_page") {
      if (target.scopeKey !== scope.key) return false;
      const snapshot = (
        await conversationDisclosureMaterializer().refresh(scope)
      ).snapshot;
      if (snapshot.generation !== target.generation) return false;
      const item = snapshot.items.find(
        (candidate) => candidate.id === target.itemId,
      );
      if (!item || item.contributorCount === 0) return false;
      return item.runId
        ? runBelongsToEvidenceScope(item.runId, scope)
        : true;
    }
    if (target.kind === "goal_record") {
      const goal = await agentGoalStore().get(target.goalId);
      return Boolean(
        goal
        && (!scope.goalId || scope.goalId === goal.id)
        && (!scope.sessionId || goal.chatSessionId === scope.sessionId)
        && (
          !scope.runId
          || goal.milestones.some((milestone) =>
            milestone.runIds.includes(scope.runId!))
        )
        && (scope.goalId || scope.sessionId),
      );
    }
    if (target.kind === "plan_record") {
      const plan = await planStore().get(target.planId);
      return Boolean(
        plan
        && (!scope.sessionId || plan.sessionId === scope.sessionId)
        && (!scope.goalId || plan.goalId === scope.goalId)
        && !scope.runId
        && (scope.sessionId || scope.goalId),
      );
    }
    if (target.kind === "generic_source") {
      return target.source.kind === "agent_run"
        && await runBelongsToEvidenceScope(
          target.source.ref,
          scope,
        );
    }
    const targetRunId = evidenceTargetRunId(target);
    return Boolean(
      targetRunId
      && await runBelongsToEvidenceScope(targetRunId, scope),
    );
  }

  async function runBelongsToEvidenceScope(
    runId: string,
    scope: ConversationDisclosureScope,
  ): Promise<boolean> {
    if (scope.runId && scope.runId !== runId) return false;
    const [runOwner, checkpointOwner, workspaceOwner, causalRecords] =
      await Promise.all([
        agentRunStore().get(runId),
        agentExecutionStore().get(runId),
        workspaceRunStore().getRun(runId),
        conversationCausalStore().listRequests(),
      ]);
    if (
      scope.sessionId
      && runOwner?.runContext?.sessionId
      && runOwner.runContext.sessionId !== scope.sessionId
    ) {
      return false;
    }
    const relevantCausal = causalRecords.filter((record) =>
      (!scope.sessionId || record.sessionId === scope.sessionId)
      && causalRecordReferencesRun(record, runId));
    const linkedWorkspaceOwners = (
      await Promise.all(relevantCausal.flatMap((record) =>
        record.refs.flatMap((ref) =>
          ref.kind === "workspace_run"
            ? [workspaceRunStore().getRun(ref.id).then((owner) => ({
                owner,
                record,
              }))]
            : [])))
    ).filter(({ owner, record }) =>
      Boolean(
        owner
        && owner.requestId === record.requestId
        && (!record.sessionId || owner.sessionId === record.sessionId),
      ));
    if (
      !runOwner
      && !checkpointOwner
      && !workspaceOwner
      && linkedWorkspaceOwners.length === 0
    ) {
      return false;
    }
    if (scope.goalId) {
      const goal = await agentGoalStore().get(scope.goalId);
      if (
        !goal
        || !goal.milestones.some((milestone) =>
          milestone.runIds.includes(runId))
        || (scope.sessionId && goal.chatSessionId !== scope.sessionId)
      ) {
        return false;
      }
    }
    if (!scope.sessionId) return Boolean(scope.runId || scope.goalId);
    const transcript = await chatSessionStore().getTranscriptPage(
      scope.sessionId,
      { limit: 200 },
    );
    if (!transcript) return false;
    if (transcript?.session.messages.some(
      (message) => message.executedRunId === runId,
    )) {
      return true;
    }
    return relevantCausal.length > 0;
  }

  async function workspaceRunIdsForEvidence(
    runId: string,
    scope: ConversationDisclosureScope,
    invocationId?: string,
  ): Promise<string[]> {
    const candidateOwners = new Map<string, ConversationCausalRecord[]>();
    const causalRecords = await conversationCausalStore().listRequests();
    for (const record of causalRecords) {
      if (scope.sessionId && record.sessionId !== scope.sessionId) continue;
      const ownsRun = record.agentRunAdmissions?.some(
        (admission) => admission.runId === runId,
      ) || record.refs.some((ref) =>
        ref.kind === "tool_invocation"
          ? ref.runId === runId
          : (
              ref.kind === "agent_run"
              || ref.kind === "trajectory_run"
              || ref.kind === "workspace_run"
            )
            && ref.id === runId);
      const ownsInvocation = !invocationId || record.refs.some((ref) =>
        ref.kind === "tool_invocation"
        && ref.runId === runId
        && ref.id === invocationId);
      if (!ownsRun || !ownsInvocation) continue;
      for (const ref of record.refs) {
        if (ref.kind !== "workspace_run") continue;
        const owners = candidateOwners.get(ref.id) ?? [];
        owners.push(record);
        candidateOwners.set(ref.id, owners);
      }
      for (const settlement of record.requiredSettlements ?? []) {
        if (!settlement.workspaceRunId) continue;
        const owners = candidateOwners.get(settlement.workspaceRunId) ?? [];
        owners.push(record);
        candidateOwners.set(settlement.workspaceRunId, owners);
      }
    }
    const authorized: string[] = [];
    for (const [workspaceRunId, owners] of candidateOwners) {
      const owner = await workspaceRunStore().getRun(workspaceRunId);
      if (
        owner
        && owners.some((record) =>
          owner.requestId === record.requestId
          && (!record.sessionId || owner.sessionId === record.sessionId)
          && (!scope.sessionId || owner.sessionId === scope.sessionId))
      ) {
        authorized.push(workspaceRunId);
      }
    }
    return authorized.sort();
  }

  async function findTrajectoryToolInvocation(
    runId: string,
    invocationId: string,
    signal?: AbortSignal,
  ): Promise<{
    kind: "found";
    events: import("../../shared/agentTrajectory").AgentTrajectoryEvent[];
  } | { kind: "missing" | "incompatible" | "unavailable" }> {
    return scanTrajectoryEvents(
      runId,
      (event) => (
        event.id === invocationId
        || event.payload.toolInvocationId === invocationId
      ) && Boolean(toolInvocationFromTrajectoryEvent(event, invocationId)),
      signal,
    );
  }

  async function scanTrajectoryEvents(
    runId: string,
    matchesTarget: (
      event: import("../../shared/agentTrajectory").AgentTrajectoryEvent,
    ) => boolean,
    signal?: AbortSignal,
  ): Promise<{
    kind: "found";
    events: import("../../shared/agentTrajectory").AgentTrajectoryEvent[];
  } | { kind: "missing" | "incompatible" | "unavailable" }> {
    if (!agentTrajectoryStore().getPage) return { kind: "unavailable" };
    let cursor: string | undefined;
    const matches: import("../../shared/agentTrajectory").AgentTrajectoryEvent[] =
      [];
    for (let pageIndex = 0; pageIndex < 256; pageIndex += 1) {
      const page = await agentTrajectoryStore().getPage!(runId, {
        ...(cursor ? { cursor } : {}),
        limit: 200,
        signal,
      });
      if (page.status === "unavailable") return { kind: "unavailable" };
      if (
        page.status === "partial"
        || page.status === "incompatible"
        || page.sourceId !== runId
        || page.records.some((event) => event.runId !== runId)
      ) {
        return { kind: "incompatible" };
      }
      for (const event of page.records) {
        if (matchesTarget(event)) matches.push(event);
      }
      if (!page.nextCursor) {
        return matches.length > 0
          ? {
              kind: "found",
              events: matches.sort(
                (left, right) => left.sequence - right.sequence,
              ),
            }
          : { kind: "missing" };
      }
      cursor = page.nextCursor;
    }
    return { kind: "incompatible" };
  }

  async function findWorkspaceToolInvocation(
    workspaceRunId: string,
    invocationId: string,
    signal?: AbortSignal,
  ): Promise<{
    kind: "found";
    events: Array<Extract<WorkspaceRunEvent, { type: "tool_invocation" }>>;
  } | { kind: "missing" | "incompatible" | "unavailable" }> {
    if (!workspaceRunStore().getEventPage) return { kind: "unavailable" };
    const owner = await workspaceRunStore().getRun(workspaceRunId);
    if (!owner) return { kind: "unavailable" };
    let cursor: string | undefined;
    const matches: Array<
      Extract<WorkspaceRunEvent, { type: "tool_invocation" }>
    > = [];
    for (let pageIndex = 0; pageIndex < 256; pageIndex += 1) {
      const page = await workspaceRunStore().getEventPage!(workspaceRunId, {
        ...(cursor ? { cursor } : {}),
        limit: 200,
        signal,
      });
      if (page.status === "unavailable") return { kind: "unavailable" };
      if (
        page.status === "partial"
        || page.status === "incompatible"
        || page.sourceId !== workspaceRunId
        || page.records.some((event) =>
          event.workspaceRunId !== workspaceRunId
          || event.sessionId !== owner.sessionId
          || event.requestId !== owner.requestId)
      ) {
        return { kind: "incompatible" };
      }
      for (const event of page.records) {
        if (
          event.type !== "tool_invocation"
          || event.toolInvocationId !== invocationId
        ) {
          continue;
        }
        matches.push(event);
      }
      if (!page.nextCursor) {
        return matches.length > 0
          ? {
              kind: "found",
              events: matches.sort((left, right) => left.seq - right.seq),
            }
          : { kind: "missing" };
      }
      cursor = page.nextCursor;
    }
    return { kind: "incompatible" };
  }

  async function resolveConversationEvidence(input: {
    target: ConversationEvidenceTarget;
    position: number;
    limit: number;
    expectedAuthorityRevision?: string;
    trustedContext: TrustedConversationEvidenceContext;
  }): Promise<ConversationEvidenceBackendResult> {
    const target = input.target;
    if (target.kind === "goal_record") {
      const goal = await agentGoalStore().get(target.goalId);
      if (!goal) return { kind: "missing" };
      const revision = String(goal.planVersion);
      if (
        target.revision !== undefined
        && target.revision !== goal.planVersion
      ) {
        return { kind: "incompatible", reasonCode: "authority_changed" };
      }
      return {
        kind: "found",
        authorityRevision: `${revision}\0${goal.status}`,
        entries: [{
          id: goal.id,
          kind: "goal",
          status: goal.status,
          summary: `Goal ${goal.status}`,
          occurredAt: goal.updatedAt,
        }],
        complete: true,
      };
    }
    if (target.kind === "plan_record") {
      const plan = await planStore().get(target.planId);
      if (!plan) return { kind: "missing" };
      if (plan.revision !== target.revision) {
        return { kind: "incompatible", reasonCode: "authority_changed" };
      }
      return {
        kind: "found",
        authorityRevision: `${plan.revision}\0${plan.status}`,
        entries: [{
          id: plan.id,
          kind: "plan",
          status: plan.status,
          summary: `Plan ${plan.status}`,
          occurredAt: plan.updatedAt,
        }],
        complete: true,
      };
    }
    if (target.kind === "checkpoint") {
      const checkpoint = await agentExecutionStore().get(target.runId);
      if (!checkpoint) return { kind: "missing" };
      if (checkpoint.id !== target.checkpointId) {
        return { kind: "incompatible", reasonCode: "target_mismatch" };
      }
      return {
        kind: "found",
        authorityRevision: `${checkpoint.updatedAt}\0${checkpoint.status}`,
        entries: [{
          id: checkpoint.id,
          kind: "checkpoint",
          status: checkpoint.status,
          summary: `Checkpoint ${checkpoint.status}`,
          occurredAt: checkpoint.updatedAt,
          count: checkpoint.steps.length,
        }],
        complete: true,
      };
    }
    if (target.kind === "trajectory_event") {
      const trajectory = await scanTrajectoryEvents(
        target.runId,
        (event) => event.id === target.eventId,
      );
      if (trajectory.kind !== "found") {
        if (trajectory.kind === "unavailable") {
          throw new Error("trajectory evidence source is unavailable");
        }
        return trajectory.kind === "incompatible"
          ? { kind: "incompatible", reasonCode: "authority_changed" }
          : { kind: "missing" };
      }
      const candidates = trajectory.events.map((event) => ({
        event,
        authorityRevision: `${event.sequence}\0${event.type}`,
        bodyFingerprint: createConversationRequestFingerprint(event),
      }));
      const matching = input.expectedAuthorityRevision
        ? candidates.filter((candidate) =>
            candidate.authorityRevision === input.expectedAuthorityRevision)
        : candidates.slice(-1);
      if (
        matching.length > 1
        && new Set(
          matching.map((candidate) => candidate.bodyFingerprint),
        ).size > 1
      ) {
        return { kind: "incompatible", reasonCode: "authority_changed" };
      }
      const selected = matching[0];
      if (!selected) {
        return { kind: "incompatible", reasonCode: "authority_changed" };
      }
      if (candidates.some((candidate) =>
        candidate.authorityRevision !== selected.authorityRevision
        && candidate.event.sequence >= selected.event.sequence)) {
        return { kind: "incompatible", reasonCode: "authority_changed" };
      }
      const event = selected.event;
      return {
        kind: "found",
        authorityRevision: selected.authorityRevision,
        entries: [{
          id: event.id,
          kind: event.type,
          summary: `Trajectory ${event.type}`,
          occurredAt: event.createdAt,
          sequence: event.sequence,
        }],
        complete: true,
      };
    }
    if (target.kind === "tool_invocation") {
      const candidates: Array<{
        sourceAuthority: string;
        authorityRevision: string;
        bodyFingerprint: string;
        identityFingerprint: string;
        semanticFingerprint: string;
        entry: {
          id: string;
          kind: string;
          status?: string;
          summary?: string;
          occurredAt?: string;
          sequence?: number;
          ok?: boolean;
        };
      }> = [];
      let incomplete = false;
      let unavailable = false;
      const trajectory = await findTrajectoryToolInvocation(
        target.runId,
        target.invocationId,
      );
      if (trajectory.kind === "found") {
        for (const event of trajectory.events) {
          const invocation = toolInvocationFromTrajectoryEvent(
            event,
            target.invocationId,
          );
          if (!invocation) continue;
          candidates.push({
            sourceAuthority: `trajectory:${target.runId}`,
            authorityRevision:
              `${invocation.updatedAt}\0${invocation.status}`,
            bodyFingerprint: toolEvidenceCandidateFingerprint(invocation),
            identityFingerprint:
              toolEvidenceIdentityFingerprint(invocation),
            semanticFingerprint:
              toolEvidenceSemanticFingerprint(invocation),
            entry: {
              id: invocation.id,
              kind: "tool_invocation",
              status: invocation.status,
              summary: `Tool ${invocation.toolName} ${invocation.status}`,
              occurredAt: invocation.updatedAt,
              sequence: event.sequence,
              ...(typeof invocation.ok === "boolean"
                ? { ok: invocation.ok }
                : {}),
            },
          });
        }
      } else if (trajectory.kind === "incompatible") {
        incomplete = true;
      } else if (trajectory.kind === "unavailable") {
        unavailable = true;
      }
      const workspaceRunIds = await workspaceRunIdsForEvidence(
        target.runId,
        input.trustedContext.scope,
        target.invocationId,
      );
      for (const workspaceRunId of workspaceRunIds) {
        const workspace = await findWorkspaceToolInvocation(
          workspaceRunId,
          target.invocationId,
        );
        if (workspace.kind === "incompatible") {
          incomplete = true;
          continue;
        }
        if (workspace.kind === "unavailable") {
          unavailable = true;
          continue;
        }
        if (workspace.kind !== "found") continue;
        for (const event of workspace.events) {
          const invocation = toolInvocationFromWorkspaceEvent(event);
          const embeddedRunId = event.payload?.runId;
          if (
            !invocation
            || (
              typeof embeddedRunId === "string"
              && embeddedRunId
              && embeddedRunId !== target.runId
            )
          ) {
            incomplete = true;
            continue;
          }
          const logicalInvocation = {
            ...invocation,
            runId: target.runId,
          };
          candidates.push({
            sourceAuthority: `workspace:${workspaceRunId}`,
            authorityRevision:
              `${event.createdAt}\0${event.invocationStatus}`,
            bodyFingerprint:
              toolEvidenceCandidateFingerprint(logicalInvocation),
            identityFingerprint:
              toolEvidenceIdentityFingerprint(logicalInvocation),
            semanticFingerprint:
              toolEvidenceSemanticFingerprint(logicalInvocation),
            entry: {
              id: logicalInvocation.id,
              kind: "tool_invocation",
              status: logicalInvocation.status,
              summary:
                `Tool ${logicalInvocation.toolName} ${logicalInvocation.status}`,
              occurredAt: logicalInvocation.updatedAt,
              sequence: event.seq,
              ...(typeof logicalInvocation.ok === "boolean"
                ? { ok: logicalInvocation.ok }
                : {}),
            },
          });
        }
      }
      if (unavailable) {
        throw new Error("tool evidence source is unavailable");
      }
      if (incomplete) {
        return { kind: "incompatible", reasonCode: "authority_changed" };
      }
      if (
        new Set(
          candidates.map((candidate) => candidate.identityFingerprint),
        ).size > 1
      ) {
        return { kind: "incompatible", reasonCode: "authority_changed" };
      }
      const matchingCandidates = input.expectedAuthorityRevision
        ? candidates.filter((candidate) =>
            candidate.authorityRevision === input.expectedAuthorityRevision)
        : candidates.sort(
            (left, right) =>
              (right.entry.sequence ?? 0) - (left.entry.sequence ?? 0),
          ).slice(0, 1);
      if (
        matchingCandidates.length > 1
        && toolEvidenceCandidatesConflict(matchingCandidates)
      ) {
        return { kind: "incompatible", reasonCode: "authority_changed" };
      }
      const selected = matchingCandidates[0];
      if (
        selected
        && candidates.some((candidate) =>
          candidate.authorityRevision !== selected.authorityRevision
          && (candidate.entry.occurredAt ?? "")
            >= (selected.entry.occurredAt ?? ""))
      ) {
        return { kind: "incompatible", reasonCode: "authority_changed" };
      }
      if (selected) {
        return {
          kind: "found",
          authorityRevision: selected.authorityRevision,
          entries: [selected.entry],
          complete: true,
        };
      }
      return candidates.length > 0
        ? { kind: "incompatible", reasonCode: "authority_changed" }
        : { kind: "missing" };
    }
    if (target.kind === "contributor_page") {
      if (target.scopeKey !== input.trustedContext.scope.key) {
        return { kind: "incompatible", reasonCode: "target_mismatch" };
      }
      const page = await conversationDisclosureMaterializer().contributorPage(
        input.trustedContext.scope,
        target.itemId,
        {
          expectedGeneration: target.generation,
          afterInline: true,
          position: input.position,
          limit: input.limit,
        },
      );
      if (!page) return { kind: "missing" };
      if (page.kind === "incompatible") {
        return { kind: "incompatible", reasonCode: "authority_changed" };
      }
      return {
        kind: "found",
        authorityRevision: page.authorityRevision,
        entries: page.refs.map((ref) => ({
          id: ref.ref,
          kind: ref.kind,
          status: ref.domainStatus,
        })),
        complete: page.complete,
        ...(page.nextPosition !== undefined
          ? { nextPosition: page.nextPosition }
          : {}),
      };
    }
    if (target.kind === "generic_source") {
      if (target.source.kind !== "agent_run") {
        return { kind: "incompatible", reasonCode: "target_mismatch" };
      }
      const run = await agentRunStore().get(target.source.ref);
      if (!run) return { kind: "missing" };
      const authorityRevision = String(run.executionRevision ?? 1);
      if (
        target.source.domainRevision
        && target.source.domainRevision !== authorityRevision
      ) {
        return { kind: "incompatible", reasonCode: "authority_changed" };
      }
      if (target.source.domainStatus !== run.status) {
        return { kind: "incompatible", reasonCode: "authority_changed" };
      }
      return {
        kind: "found",
        authorityRevision: `${authorityRevision}\0${run.status}`,
        entries: [{
          id: run.id,
          kind: "agent_run",
          status: run.status,
          summary: `Agent run ${run.status}`,
          occurredAt: run.finishedAt || run.startedAt,
        }],
        complete: true,
      };
    }
    return { kind: "incompatible", reasonCode: "target_mismatch" };
  }

  return {
    loadConversationDisclosureReadSet,
    authorizeConversationEvidenceTarget,
    runBelongsToEvidenceScope,
    workspaceRunIdsForEvidence,
    findTrajectoryToolInvocation,
    scanTrajectoryEvents,
    findWorkspaceToolInvocation,
    resolveConversationEvidence,
  };
}
