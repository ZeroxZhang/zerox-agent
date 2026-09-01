import { createHash, randomUUID } from "node:crypto";
import { fsync, writeFile as writeFileDescriptor } from "node:fs";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { nativeImage, type BrowserWindow } from "electron";
import {
  conversationDisclosureScenarioActionCounts,
  conversationDisclosureScenarioActions,
  type ConversationDisclosureScenarioActionReceipt,
  type ConversationDisclosureScenarioId,
  type ConversationDisclosureScenarioIpcInvocation,
  type ConversationDisclosureScenarioReceipt,
  type ConversationDisclosureScenarioRequirementReceipt,
} from "../shared/conversationDisclosureAcceptance";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import type { ChatOutputPart } from "../shared/chatOutput";
import type { Goal } from "../shared/agentGoal";
import type { PlanArtifact, PlanRecord } from "../shared/planMode";
import type { ResolvedModelBinding } from "../shared/modelSettings";
import type { AppContainer } from "./container";
import type { ConversationDisclosureAcceptanceEnabledMode } from "./conversationDisclosureAcceptanceMode";
import type { TrustedIpcInvocationObservation } from "./ipc";
import type {
  ToolUserApprovalRequest,
  ToolUserApprovalRequestOptions,
  ToolUserApprovalResult,
} from "./toolAuthorizationService";
import type { ToolApprovalRequestPayload } from "../shared/toolApproval";
import { finalAcceptanceEvidenceFingerprint } from "./agentGoalController";
import { exportAgentEpisodeFromConfig } from "./agentEpisodeExportCli";
import { createPlanDebateOrchestrator } from "./planDebateOrchestrator";
import type { BoundModelClient, ModelRouter } from "./providers/modelRouter";

type PlanAcceptanceResult =
  | { ok: true; plan: PlanRecord }
  | { ok: false; error: unknown };

type PlanAcceptanceRuntime = {
  planId: string;
  releaseReview(): void;
  result: Promise<PlanAcceptanceResult>;
  modelCalls: string[];
};

type RendererPerformanceSample = {
  taskDurationSeconds: number;
  jsHeapUsedBytes: number;
  nodeCount: number;
};

type RendererPerformanceSession = {
  attachedByAcceptance: boolean;
  before: RendererPerformanceSample;
};

type PreparedScenario = {
  sessionId: string;
  runId: string;
  scheduledTaskId?: string;
  goalId?: string;
  unverifiedGoalId?: string;
  planId?: string;
  blockedPlanId?: string;
  secretCanary?: string;
  legacyFixtureDigest?: string;
  legacySourceCutId?: string;
  legacyIntentionalAbsenceCount?: number;
  legacyAuthorityLinkageValid?: boolean;
  legacyAuthorityRecordCount?: number;
  legacySourceNotMutated?: boolean;
  interruptedApprovalId?: string;
  interruptedToolInvocationId?: string;
  interruptedToolInvocationRunId?: string;
  interruptedWorkspaceRunId?: string;
  interruptedTrajectoryAborted?: boolean;
  interruptedWorkspaceAborted?: boolean;
  interruptedChatAborted?: boolean;
  planRuntime?: PlanAcceptanceRuntime;
  evidenceIds: string[];
};

const legacyFixtureAuthorityFiles = Object.freeze([
  "config/agent-goals/cd09-v391-goal.json",
  "config/agent-goals/cd09-v391-goal.ledger.jsonl",
  "config/agent-runs.jsonl",
  "config/agent-trajectories/cd09-v391-run.jsonl",
  "config/chat-sessions.json",
  "config/plans/cd09-v391-plan.events.jsonl",
  "config/plans/cd09-v391-plan.json",
  "config/plans/session-index.json",
]);

type AcceptanceApprovalCoordinator = {
  requestUserApproval(
    request: ToolUserApprovalRequest,
    options?: ToolUserApprovalRequestOptions,
  ): Promise<ToolUserApprovalResult>;
  pendingSnapshot(): ToolApprovalRequestPayload[];
};

type ApprovalRuntime = {
  id: string;
  revision: number;
  result: Promise<ToolUserApprovalResult>;
};

export function createConversationDisclosureIpcRecorder(): {
  observe(observation: TrustedIpcInvocationObservation): void;
  snapshot(): ConversationDisclosureScenarioIpcInvocation[];
} {
  const invocations: ConversationDisclosureScenarioIpcInvocation[] = [];
  return {
    observe(observation) {
      invocations.push({
        ordinal: invocations.length + 1,
        channel: observation.channel,
        ok: observation.ok,
      });
    },
    snapshot() {
      return invocations.map((entry) => ({ ...entry }));
    },
  };
}

export async function prepareConversationDisclosureScenario(
  container: AppContainer,
  mode: ConversationDisclosureAcceptanceEnabledMode,
  processEpoch: string,
): Promise<PreparedScenario> {
  const scenarioId = mode.scenarioId;
  const runId = `cd09-run-${scenarioId}`;
  const timestamp = "2026-08-26T10:00:00.000Z";
  const state = scenarioState(scenarioId);
  const activityState = scenarioActivityState(scenarioId);
  if (scenarioId === "S13-legacy-coverage") {
    return prepareLegacyConversationDisclosureScenario(
      container,
      mode,
      processEpoch,
    );
  }
  if (
    scenarioId === "S17-cancel-interruption"
    && mode.phase === "restart"
  ) {
    return prepareRestartedApprovalInterruptionScenario(
      container,
      processEpoch,
    );
  }
  if (mode.phase === "restart") {
    const causalRecord = await container.conversationCausalStore().getRequest(
      `request-${scenarioId}`,
    );
    const listedSessions = await container.chatSessionStore().list();
    const existingSession = causalRecord?.sessionId
      ? listedSessions.find((entry) => entry.id === causalRecord.sessionId)
      : listedSessions.find(
          (entry) =>
            entry.summary.includes(scenarioId)
            || entry.title.includes(scenarioId),
        );
    const [existingRun, trajectory] = await Promise.all([
      container.agentRunStore().get(runId),
      container.agentTrajectoryStore().list(runId),
    ]);
    if (!existingSession || !existingRun || trajectory.length === 0) {
      throw new Error(
        `Restart phase cannot recover persisted authority for ${scenarioId} `
        + `(session=${Boolean(existingSession)}, run=${Boolean(existingRun)}, `
        + `trajectory=${trajectory.length}).`,
      );
    }
    return {
      sessionId: existingSession.id,
      runId,
      evidenceIds: [
        existingSession.id,
        runId,
        trajectory[0]!.id,
        `process:${processEpoch}`,
        "restart:persisted-authority",
      ],
    };
  }
  const created = await container.chatSessionStore().appendMessage({
    requestId: `request-${scenarioId}`,
    turnId: `turn-${scenarioId}`,
    role: "user",
    content: `CD09 ${scenarioId} production acceptance fixture`,
  });
  const sessionId = created.session.id;
  if (
    scenarioId === "S06-pause-reload-recovery"
    ||
    scenarioId === "S05-approval-attention"
    || scenarioId === "S17-cancel-interruption"
  ) {
    const requestId = `request-${scenarioId}`;
    const claimed = await container.conversationCausalStore().claimRequest({
      requestId,
      turnId: `turn-${scenarioId}`,
      inputFingerprint: `sha256:${"5".repeat(64)}`,
      createdAt: timestamp,
    });
    const bound = await container.conversationCausalStore().bindRequest({
      requestId,
      sessionId,
      userMessageId: created.message.id,
    });
    if (
      claimed.disposition !== "applied"
      || bound.disposition !== "applied"
    ) {
      throw new Error("Approval fixture could not bind its causal request.");
    }
  }
  const outputParts = scenarioOutputParts(scenarioId, timestamp);
  await container.chatSessionStore().appendMessage({
    sessionId,
    requestId: `request-${scenarioId}`,
    turnId: `turn-${scenarioId}`,
    role: "assistant",
    content: scenarioSummary(scenarioId),
    outputParts,
    executedRunId: runId,
    turnSettlementStatus:
      state === "completed" ? "succeeded" : state === "canceled"
        ? "canceled"
        : state === "paused" ? "paused" : "failed",
  });
    await container.chatSessionStore().appendActivityEvent(sessionId, {
    sessionId,
    requestId: `request-${scenarioId}`,
    sequence: 1,
    turnId: `turn-${scenarioId}`,
    state: activityState,
    message: scenarioSummary(scenarioId),
    createdAt: timestamp,
    elapsedMs: 120,
    ...(state === "failed" ? { ok: false } : {}),
    ...([
      "S02-inline-expansion",
      "S05-approval-attention",
    ].includes(scenarioId)
      ? {
          ...(scenarioId === "S05-approval-attention"
            ? { approvalId: `approval-${scenarioId}` }
            : {}),
          toolInvocationId: `invocation-${scenarioId}`,
          toolName: "file_list",
          invocationStatus:
            scenarioId === "S05-approval-attention"
              ? "waiting_approval"
              : "succeeded",
        }
      : {}),
    });
  if (scenarioId === "S10-accessibility") {
    await container.chatSessionStore().appendActivityEvent(sessionId, {
      sessionId,
      requestId: `request-${scenarioId}`,
      sequence: 2,
      turnId: `turn-${scenarioId}`,
      state: "tool_invocation",
      message: "Inspect one bounded local evidence record.",
      createdAt: "2026-08-26T10:00:00.100Z",
      elapsedMs: 220,
      toolInvocationId: `invocation-${scenarioId}`,
      toolName: "file_list",
      invocationStatus: "succeeded",
    });
    await container.chatSessionStore().appendActivityEvent(sessionId, {
      sessionId,
      requestId: `request-${scenarioId}`,
      sequence: 3,
      turnId: `turn-${scenarioId}`,
      state: "failed",
      message: "A sanitized accessibility fixture needs attention.",
      createdAt: "2026-08-26T10:00:00.200Z",
      elapsedMs: 320,
      ok: false,
    });
  }
  if (
    scenarioId === "S09-long-session"
    || scenarioId === "S18-context-usage"
  ) {
    const messageCount =
      scenarioId === "S09-long-session" ? 320 : 16;
    for (let index = 0; index < messageCount; index += 1) {
      const role = index % 2 === 0 ? "user" : "assistant";
      await container.chatSessionStore().appendMessage({
        sessionId,
        requestId: `request-${scenarioId}-history-${index}`,
        turnId: `turn-${scenarioId}-history-${index}`,
        role,
        content:
          scenarioId === "S18-context-usage"
            ? `CD09 compaction history ${index} ${"context ".repeat(180)}`
            : [
                `CD09 bounded history row ${index}.`,
                "This record exercises stable transcript identity, grouped output projection, and bounded historical retrieval.",
                "projection evidence lifecycle ".repeat(48),
              ].join(" "),
        ...(scenarioId === "S09-long-session" && role === "assistant"
          ? { outputParts: longSessionOutputParts(index, timestamp) }
          : {}),
      });
    }
  }
  if (scenarioId === "S18-context-usage") {
    await container.chatSessionStore().addTokenUsage(sessionId, {
      totalTokens: 12_000,
      promptTokens: 9_000,
      completionTokens: 3_000,
      estimated: true,
    });
  }
  const scheduledTask = [
    "S06-pause-reload-recovery",
    "S08-scheduled-progress",
  ].includes(scenarioId)
    ? await container.scheduledTaskStore().create({
        name: `CD09 ${scenarioId}`,
        skillName: "example-mcp-skill",
        enabled: false,
        schedule: { kind: "manual" },
        input: {
          query: "Run the deterministic CD09 scheduled acceptance task.",
        },
      })
    : null;
  let goalId: string | undefined;
  let unverifiedGoalId: string | undefined;
  let planId: string | undefined;
  let blockedPlanId: string | undefined;
  if (scenarioId === "S15-goal-acceptance") {
    goalId = "cd09-goal-S15-goal-acceptance";
    const criterion = {
      id: "criterion-cd09",
      description: "Verify one deterministic local result.",
      acceptanceChecks: [{
        id: "check-cd09",
        kind: "model_review" as const,
        description: "The bounded local trajectory proves completion.",
        params: {
          condition: "The bounded local trajectory proves completion.",
          evidenceRefs: [`trajectory-${scenarioId}`],
        },
        requiresEvidence: true,
      }],
    };
    const goal: Goal = {
      id: goalId,
      chatSessionId: sessionId,
      description: "CD09 Goal acceptance authority",
      successCriteria: [criterion],
      milestones: [{
        id: "milestone-cd09",
        description: "Complete the bounded local result.",
        dependsOn: [],
        successCriteria: [criterion],
        state: "accepted",
        runIds: [runId],
        attempts: 1,
      }],
      status: "waiting_for_acceptance",
      executionUsage: {
        iterations: 1,
        toolCalls: 0,
        wallClockMs: 100,
        tokens: 36,
        replans: 0,
      },
      reviewPolicy: "review_final_only",
      planVersion: 1,
      acceptanceProtocolVersion: 2,
      acceptanceState: {
        protocolVersion: 2,
        phase: "awaiting_user",
        attempt: 1,
        recentFailures: [{
          at: timestamp,
          targetKind: "goal",
          targetId: goalId,
          fingerprint: "a".repeat(64),
          occurrence: 1,
          verdict: "blocked_external",
          failureClass: "external_dependency_missing",
          failedCheckIds: ["check-cd09"],
          evidenceRefs: [`trajectory-${scenarioId}`],
          actionSignatures: ["manual-completion"],
        }],
      },
      acceptanceRetryState: {
        cycle: 1,
        attempt: 1,
        maxAttempts: 3,
        lastCode: "judge_timeout",
        lastDetail: "Final judge was temporarily unavailable.",
        evidenceFingerprint: "a".repeat(64),
        resumeFrom: "final_judge",
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const sealUnavailableFinalJudge = async (candidate: Goal) => {
      const unavailable = await container.agentGoalAcceptance().evaluateGoal(
        candidate,
        {
        runId,
        goalId: candidate.id,
        workspacePath: process.cwd(),
        toolExecutor: {
          async execute() {
            throw new Error("S15 sealed replay must not execute tools.");
          },
        },
        trajectoryStore: {
          async append(_runId, event) {
            return event;
          },
        },
        chatClient: {
          async complete() {
            throw Object.assign(new Error("S15 final judge unavailable."), {
              status: 503,
            });
          },
        },
        modelProfile: {
          baseUrl: "http://127.0.0.1/unused",
          apiKey: "acceptance-not-a-secret",
          model: "cd09-scripted",
          temperature: 0,
          maxTokens: 1024,
        },
        now: () => timestamp,
        },
      );
      if (!unavailable.finalJudgeReplay) {
        throw new Error("S15 could not seal its unavailable final judge replay.");
      }
      candidate.acceptanceRetryState = {
        ...candidate.acceptanceRetryState!,
        evidenceFingerprint: finalAcceptanceEvidenceFingerprint(
          candidate,
          unavailable,
        ),
        finalJudgeReplay: unavailable.finalJudgeReplay,
      };
      return candidate;
    };
    await sealUnavailableFinalJudge(goal);
    unverifiedGoalId = `${goalId}-unverified`;
    const unverifiedGoal = structuredClone(goal);
    unverifiedGoal.id = unverifiedGoalId;
    unverifiedGoal.description = "CD09 Goal unverified completion branch";
    unverifiedGoal.acceptanceState!.recentFailures = unverifiedGoal
      .acceptanceState!.recentFailures.map((failure) => ({
        ...failure,
        targetId: unverifiedGoalId!,
      }));
    unverifiedGoal.acceptanceRetryState = {
      ...unverifiedGoal.acceptanceRetryState!,
      evidenceFingerprint: "a".repeat(64),
      finalJudgeReplay: undefined,
    };
    await sealUnavailableFinalJudge(unverifiedGoal);
    await Promise.all([
      container.agentGoalStore().save(goal),
      container.agentGoalStore().save(unverifiedGoal),
    ]);
    await container.chatSessionStore().attachGoal(sessionId, {
      id: goal.id,
      description: goal.description,
      status: goal.status,
      updatedAt: goal.updatedAt,
    });
  }
  let planRuntime: PlanAcceptanceRuntime | undefined;
  if (scenarioId === "S07-plan-progress") {
    planRuntime = await prepareLivePlanProgressScenario(
      container,
      sessionId,
      mode.userDataPath,
    );
    planId = planRuntime.planId;
  }
  if (scenarioId === "S16-plan-confirmation") {
    planId = `cd09-plan-${scenarioId}`;
    const artifact: PlanArtifact = {
      title: `CD09 ${scenarioId}`,
      summary: "A deterministic production Plan authority.",
      objective: "Complete one bounded local milestone.",
      scope: { in: ["local acceptance"], out: ["external publish"] },
      assumptions: [],
      milestones: [{
        id: "milestone-plan-cd09",
        title: "Validate",
        description: "Validate the local production path.",
        acceptanceCriteria: ["The local evidence is reviewable."],
        dependencies: [],
      }],
      dependencies: [],
      risks: [],
      acceptanceCriteria: ["The local evidence is reviewable."],
      claimLedger: [],
      unresolvedQuestions: [],
      minorityOpinion: [],
      actionGate: "ready",
      gateReason: "Ready for explicit confirmation.",
      markdown: "",
    };
    const planBase: PlanRecord = {
      id: planId,
      sessionId,
      workspaceRoot: process.cwd(),
      sourceMessage: artifact.objective,
      mode: "direct",
      status: "awaiting_confirmation",
      actionGate: artifact.actionGate,
      revision: 1,
      taskContract: {
        objective: artifact.objective,
        audience: "user",
        inScope: artifact.scope.in,
        outOfScope: artifact.scope.out,
        constraints: [],
        successCriteria: artifact.acceptanceCriteria,
        assumptions: [],
      },
      evidence: [],
      requestedModelAssignments: {},
      frozenModelAssignments: {},
      rounds: [],
      finalArtifact: artifact,
      planningStages: [{
            id: "stage-cd09",
            kind: "generation",
            runId,
            status: "completed",
            evidenceRefs: [`trajectory-${scenarioId}`],
            startedAt: timestamp,
            completedAt: timestamp,
          }],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const projection = await container.planArtifactWriter().write(
      planBase,
      artifact,
    );
    await container.planStore().create({ ...planBase, projection });
    blockedPlanId = `${planId}-blocked`;
    await container.planStore().create({
      ...planBase,
      id: blockedPlanId,
      status: "paused",
      actionGate: "blocked",
      projection: undefined,
      finalArtifact: {
        ...artifact,
        actionGate: "blocked",
        gateReason: "Blocked by deterministic acceptance evidence.",
      },
    });
  }
  const run: AgentRunRecord = {
    id: runId,
    taskId: scheduledTask?.id ?? `task-${scenarioId}`,
    taskName: `CD09 ${scenarioId}`,
    skillName: scheduledTask?.skillName
      ?? "conversation-disclosure-acceptance",
    status: state === "failed"
      ? "failed"
      : state === "paused"
        ? "paused"
        : state === "canceled"
          ? "canceled"
          : "succeeded",
    summary: scenarioSummary(scenarioId),
    events: [{
      level: state === "failed" ? "error" : "info",
      message: scenarioSummary(scenarioId),
      phase: state === "completed" ? "done" : "executing",
      createdAt: timestamp,
    }],
    executionRevision: 1,
    ...(state === "failed"
      ? {
          failureClass: "tool_error",
          failureCode: "AGENT_RUN_EXECUTION_FAILED",
          failureMessage: "Sanitized deterministic acceptance failure.",
        }
      : {}),
    startedAt: timestamp,
    finishedAt: timestamp,
  };
  await container.agentRunStore().append(run);
  if (scenarioId === "S06-pause-reload-recovery" && scheduledTask) {
    const admitted = await container.conversationCausalStore().admitAgentRun({
      requestId: `request-${scenarioId}`,
      runId,
      taskId: scheduledTask.id,
      sessionId,
      executionRevision: 1,
    });
    const started =
      await container.conversationCausalStore().settleAgentRunAdmission({
        requestId: `request-${scenarioId}`,
        runId,
        expectedExecutionRevision: 1,
        state: "started",
      });
    const settled =
      await container.conversationCausalStore().settleAgentRunAdmission({
        requestId: `request-${scenarioId}`,
        runId,
        expectedExecutionRevision: 1,
        state: "settled",
        finalStatus: "paused",
      });
    if (
      admitted.disposition !== "applied"
      || started.disposition !== "applied"
      || settled.disposition !== "applied"
    ) {
      throw new Error(
        "Paused continuation admission could not be established "
        + `(admitted=${admitted.disposition}, started=${started.disposition}, `
        + `settled=${settled.disposition}).`,
      );
    }
  }
  if (scenarioId === "S06-pause-reload-recovery" && scheduledTask) {
    await container.agentExecutionStore().save({
      id: `${runId}-checkpoint`,
      runId,
      taskId: scheduledTask.id,
      status: "paused",
      currentStepId: "step-1",
      steps: [{
        id: "step-1",
        description: "Resume the deterministic CD09 task",
        expectedOutcome: "The task settles once",
        state: "running",
        attempts: 1,
      }],
      messages: [
        { role: "system", content: "Complete the local acceptance task." },
        { role: "user", content: "Resume this deterministic task." },
      ],
      toolCallCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  const trajectory: AgentTrajectoryEvent = {
    id: `trajectory-${scenarioId}`,
    runId,
    type: state === "failed" ? "failure_classified" : "state_transition",
    sequence: 1,
    payload: {
      scenarioId,
      processEpoch,
      publicationKey: `cd09:${scenarioId}:trajectory`,
      state,
    },
    redaction: {
      containsApiKey: false,
      containsFileContent: false,
      containsUserText: false,
    },
    createdAt: timestamp,
  };
  await container.agentTrajectoryStore().append(runId, trajectory);
  if (scenarioId === "S09-long-session") {
    for (let sequence = 2; sequence <= 240; sequence += 1) {
      const type = sequence % 3 === 0
        ? "tool_result"
        : sequence % 3 === 1
          ? "model_response"
          : "state_transition";
      await container.agentTrajectoryStore().append(runId, {
        id: `trajectory-${scenarioId}-${sequence}`,
        runId,
        type,
        sequence,
        payload: {
          scenarioId,
          processEpoch,
          publicationKey: `cd09:${scenarioId}:trajectory:${sequence}`,
          groupId: `group-${Math.floor((sequence - 1) / 8)}`,
          summary:
            `Bounded trajectory record ${sequence}. `
            + "projection evidence ".repeat(24),
        },
        redaction: {
          containsApiKey: false,
          containsFileContent: false,
          containsUserText: false,
        },
        createdAt: new Date(Date.parse(timestamp) + sequence).toISOString(),
      });
    }
  }
  if (scenarioId === "S19-unknown-coverage") {
    await container.agentTrajectoryStore().append(runId, {
      ...trajectory,
      id: `trajectory-${scenarioId}-optional`,
      type: "future_optional_presenter" as AgentTrajectoryEvent["type"],
      sequence: 2,
      payload: {
        requiredness: "optional",
        summary: "Optional future evidence remains generically visible.",
      },
    });
    await container.agentTrajectoryStore().append(runId, {
      ...trajectory,
      id: `trajectory-${scenarioId}-required`,
      type: "future_required_owner" as AgentTrajectoryEvent["type"],
      sequence: 3,
      payload: {
        requiredness: "required",
      },
    });
  }
  await Promise.all([
    container.chatSessionStore().flush(),
    container.agentRunStore().flushShadowWrites(),
    container.agentTrajectoryStore().flushShadowWrites(),
  ]);
  return {
    sessionId,
    runId,
    ...(scheduledTask ? { scheduledTaskId: scheduledTask.id } : {}),
    ...(goalId ? { goalId } : {}),
    ...(unverifiedGoalId ? { unverifiedGoalId } : {}),
    ...(planId ? { planId } : {}),
    ...(blockedPlanId ? { blockedPlanId } : {}),
    ...(planRuntime ? { planRuntime } : {}),
    ...(mode.secretCanary ? { secretCanary: mode.secretCanary } : {}),
    evidenceIds: [
      sessionId,
      runId,
      trajectory.id,
      ...(scheduledTask ? [scheduledTask.id] : []),
      ...(goalId ? [goalId] : []),
      ...(planId ? [planId] : []),
      ...(blockedPlanId ? [blockedPlanId] : []),
      `process:${processEpoch}`,
    ],
  };
}

async function prepareLivePlanProgressScenario(
  container: AppContainer,
  sessionId: string,
  userDataPath: string,
): Promise<PlanAcceptanceRuntime> {
  const planId = "plan_cd09_s07_1";
  const workspaceRoot = path.join(path.dirname(userDataPath), "plan-workspace");
  await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
  const isolatedWorkspaceRoot = await realpath(workspaceRoot);
  const modelCalls: string[] = [];
  let releaseReviewGate: (() => void) | undefined;
  let reviewReleased = false;
  const reviewGate = new Promise<void>((resolve) => {
    releaseReviewGate = resolve;
  });
  const binding = acceptancePlanBinding();
  const client: BoundModelClient["client"] = {
    async complete() {
      const callKind = modelCalls.length === 0 ? "generation" : "review";
      modelCalls.push(callKind);
      if (callKind === "review") {
        await reviewGate;
      }
      return {
        content: JSON.stringify(
          callKind === "generation"
            ? acceptancePlanArtifact()
            : {
                approved: false,
                issues: [{
                  code: "CD09_FINAL_REVIEW_BLOCK",
                  severity: "high",
                  message:
                    "The final review intentionally leaves one explicit adoption decision unresolved.",
                  repairable: false,
                  repairInstruction:
                    "The user must explicitly resolve the adoption decision.",
                }],
              },
        ),
        toolCalls: [],
        finishReason: "stop",
        usage: { inputTokens: 32, outputTokens: 16 },
      };
    },
    async *streamComplete() {
      yield { type: "done" as const, finishReason: "stop" };
    },
  };
  const bound = { binding, client };
  const router: ModelRouter = {
    async resolve() {
      return bound;
    },
    async resolveFrozen() {
      return bound;
    },
    invalidate() {},
  };
  let id = 0;
  const orchestrator = createPlanDebateOrchestrator({
    planStore: container.planStore(),
    artifactWriter: container.planArtifactWriter(),
    modelRouter: router,
    now: () => "2026-08-26T10:00:00.000Z",
    createId: () => `cd09_s07_${++id}`,
    collectEvidence: async () => [{
      id: "evidence_cd09_s07_user_request",
      kind: "user",
      title: "CD09 S07 acceptance request",
      summary: "Observe persisted production planning stages and final review truth.",
      sha256: `sha256:${"7".repeat(64)}`,
    }],
    enableDirectReview: true,
  });
  const result = orchestrator.createPlan({
    sessionId,
    workspaceRoot: isolatedWorkspaceRoot,
    sourceMessage: "Complete one bounded local milestone with persisted stage evidence.",
    mode: "direct",
    requestedSkillName: null,
    modelAssignments: { direct: binding.profileId },
  }).then(
    (plan): PlanAcceptanceResult => ({ ok: true, plan }),
    (error: unknown): PlanAcceptanceResult => ({ ok: false, error }),
  );

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const plan = await container.planStore().get(planId);
    if (
      plan?.planningStages?.some(
        (stage) => stage.kind === "review" && stage.status === "running",
      )
    ) {
      return {
        planId,
        modelCalls,
        result,
        releaseReview() {
          if (reviewReleased) return;
          reviewReleased = true;
          releaseReviewGate?.();
        },
      };
    }
    const settled = await Promise.race([
      result.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 25)),
    ]);
    if (settled) break;
  }
  const settled = await result;
  if (!settled.ok) throw settled.error;
  throw new Error(
    `S07 plan did not persist a running review stage (status=${settled.plan.status}).`,
  );
}

function acceptancePlanBinding(): ResolvedModelBinding {
  return {
    profileId: "cd09-s07-scripted",
    connectionId: "cd09-s07-local",
    providerKind: "openai",
    modelId: "cd09-s07-scripted",
    revision: 1,
    connectionRevision: 1,
    profileRevision: 1,
    capabilities: {
      tools: true,
      vision: false,
      pdf: false,
      streaming: true,
      parallelToolCalls: false,
    },
    generation: {
      temperature: 0,
      maxTokens: 4096,
      thinkingEnabled: false,
      thinkingBudgetTokens: 0,
    },
  };
}

function acceptancePlanArtifact(): Record<string, unknown> {
  const objective =
    "Complete one bounded local milestone with persisted stage evidence.";
  return {
    title: "CD09 S07 production plan",
    summary: "A production-orchestrated plan whose review is deliberately gated.",
    objective,
    scope: { in: ["local acceptance"], out: ["external publishing"] },
    assumptions: [],
    milestones: [{
      id: "milestone-cd09-s07",
      title: "Validate persisted plan progress",
      description: objective,
      acceptanceCriteria: [objective],
      dependencies: [],
      targetRefs: ["src/"],
      evidenceRefs: ["evidence_cd09_s07_user_request"],
      actions: ["Run the bounded local verification command."],
      toolNames: ["test_run"],
      acceptanceChecks: [{
        id: "check-cd09-s07",
        kind: "test_passes",
        description: "The bounded local harness passes.",
        params: { command: "npm run harness:check", workspaceRoot: "." },
        requiresEvidence: false,
      }],
    }],
    dependencies: [],
    risks: [],
    acceptanceCriteria: [objective],
    acceptanceChecks: [{
      id: "review-cd09-s07",
      kind: "model_review",
      description: "Review the persisted production-stage evidence.",
      params: {
        condition: objective,
        evidenceRefs: ["evidence_cd09_s07_user_request"],
      },
      requiresEvidence: true,
    }],
    claimLedger: [{
      id: "claim-cd09-s07",
      claim: "The plan stages are persisted by the production orchestrator.",
      evidenceRefs: ["evidence_cd09_s07_user_request"],
      counterexamples: [],
      conditions: ["The review stage remains observable across reload."],
      confidence: 1,
      status: "verified",
    }],
    unresolvedQuestions: [],
    minorityOpinion: [],
    actionGate: "ready",
    gateReason: "The candidate artifact is ready for independent review.",
  };
}

function longSessionOutputParts(
  index: number,
  createdAt: string,
): ChatOutputPart[] {
  const toolCallId = `cd09-s09-tool-${index}`;
  return [
    {
      id: `cd09-s09-text-${index}`,
      type: "text",
      text: `Persisted grouped result ${index}.`,
      format: "plain",
      createdAt,
    },
    {
      id: `cd09-s09-call-${index}`,
      type: "tool_call",
      toolCallId,
      toolName: "file_list",
      argsPreview: { path: ".", limit: 20 },
      createdAt,
    },
    {
      id: `cd09-s09-result-${index}`,
      type: "tool_result",
      toolCallId,
      ok: true,
      resultPreview: {
        count: 20,
        summary: "bounded file metadata ".repeat(12),
      },
      createdAt,
    },
  ];
}

async function startRendererPerformanceSession(
  window: BrowserWindow,
): Promise<RendererPerformanceSession> {
  const runtimeDebugger = window.webContents.debugger;
  const attachedByAcceptance = !runtimeDebugger.isAttached();
  if (attachedByAcceptance) runtimeDebugger.attach("1.3");
  await runtimeDebugger.sendCommand("Performance.enable");
  return {
    attachedByAcceptance,
    before: await readRendererPerformanceSample(window),
  };
}

async function readRendererPerformanceSample(
  window: BrowserWindow,
): Promise<RendererPerformanceSample> {
  const response = await window.webContents.debugger.sendCommand(
    "Performance.getMetrics",
  ) as { metrics?: Array<{ name?: string; value?: number }> };
  const metrics = new Map(
    (response.metrics ?? []).flatMap((entry) =>
      typeof entry.name === "string" && Number.isFinite(entry.value)
        ? [[entry.name, entry.value!]] as const
        : [],
    ),
  );
  const taskDurationSeconds = metrics.get("TaskDuration");
  const jsHeapUsedBytes = metrics.get("JSHeapUsedSize");
  const nodeCount = metrics.get("Nodes");
  if (
    taskDurationSeconds === undefined
    || jsHeapUsedBytes === undefined
    || nodeCount === undefined
    || jsHeapUsedBytes <= 0
    || nodeCount <= 0
  ) {
    throw new Error("S09 renderer CPU/heap/DOM metrics are unavailable.");
  }
  return { taskDurationSeconds, jsHeapUsedBytes, nodeCount };
}

async function finishRendererPerformanceSession(
  window: BrowserWindow,
  session: RendererPerformanceSession,
): Promise<Record<string, number | boolean>> {
  try {
    const after = await readRendererPerformanceSample(window);
    const cpuTaskDurationMs = Math.max(
      0,
      (after.taskDurationSeconds - session.before.taskDurationSeconds) * 1_000,
    );
    const heapGrowthBytes = Math.max(
      0,
      after.jsHeapUsedBytes - session.before.jsHeapUsedBytes,
    );
    const domNodeGrowth = Math.max(0, after.nodeCount - session.before.nodeCount);
    return {
      rendererMetricsAvailable: true,
      cpuTaskDurationMs,
      heapBeforeBytes: session.before.jsHeapUsedBytes,
      heapAfterBytes: after.jsHeapUsedBytes,
      heapGrowthBytes,
      domNodeCount: after.nodeCount,
      domNodeGrowth,
      cpuHeapDomBounded:
        cpuTaskDurationMs < 5_000
        && heapGrowthBytes < 32 * 1024 * 1024
        && after.nodeCount < 20_000
        && domNodeGrowth < 2_000,
    };
  } finally {
    if (
      session.attachedByAcceptance
      && window.webContents.debugger.isAttached()
    ) {
      window.webContents.debugger.detach();
    }
  }
}

export async function runConversationDisclosureScenario(options: {
  container: AppContainer;
  window: BrowserWindow;
  mode: ConversationDisclosureAcceptanceEnabledMode;
  processEpoch: string;
  ipcInvocations: () => ConversationDisclosureScenarioIpcInvocation[];
  prepared: PreparedScenario;
  approvalCoordinator: AcceptanceApprovalCoordinator;
}): Promise<ConversationDisclosureScenarioReceipt> {
  const { window, mode, prepared } = options;
  await waitForRenderer(window);
  const approvalRuntime = mode.scenarioId === "S05-approval-attention"
    ? await startApprovalScenario(
        options.approvalCoordinator,
        prepared,
        mode.scenarioId,
      )
    : null;
  const actions: ConversationDisclosureScenarioActionReceipt[] = [];
  let actionScreenshot: Buffer | null = null;
  const actionCount =
    conversationDisclosureScenarioActionCounts[mode.scenarioId];
  for (let index = 0; index < actionCount; index += 1) {
    const ipcBefore = options.ipcInvocations();
    const deferredS17PhaseAction =
      mode.scenarioId === "S17-cancel-interruption"
      && (
        (mode.phase === "initial" && index === 2)
        || (mode.phase === "restart" && index < 2)
      );
    let action: ConversationDisclosureScenarioActionReceipt =
      deferredS17PhaseAction
        ? {
            index,
            action: conversationDisclosureScenarioActions[mode.scenarioId][index]!,
            executor: "production_main",
            ok: true,
            evidenceIds: [
              `process:${options.processEpoch}`,
              `phase-deferred:${mode.phase}:${index}`,
            ],
            observations: {
              phaseDeferred:
                mode.phase === "initial" ? "restart" : "initial",
            },
          }
        : await executeScenarioAction({
            container: options.container,
            window,
            scenarioId: mode.scenarioId,
            index,
            prepared,
            approvalRuntime,
            phase: mode.phase,
          });
    if (
      mode.scenarioId === "S17-cancel-interruption"
      && mode.phase === "restart"
      && index === 2
    ) {
      await reloadRenderer(window);
      const settledProjection = await inspectSettledS17Projection(
        window,
        prepared.sessionId,
      );
      if (
        settledProjection.listedWorkStatus !== "completed"
        || settledProjection.sidebarBadgeText !== "已完成"
        || settledProjection.recoveredSessionVisible !== true
      ) {
        throw new Error(
          "S17 settled attempt did not reach the canonical completed sidebar projection.",
        );
      }
      action = {
        ...action,
        observations: {
          ...action.observations,
          ...settledProjection,
        },
      };
    }
    if (mode.scenarioId === "S08-scheduled-progress" && index === 0) {
      const delta = options.ipcInvocations().slice(ipcBefore.length);
      const runsCalls = delta.filter(
        (entry) => entry.channel === "agentRuns:list",
      ).length;
      const activeCalls = delta.filter(
        (entry) => entry.channel === "agentRuns:listActiveExecutions",
      ).length;
      const evalCalls = delta.filter(
        (entry) => entry.channel === "agentEvalCandidates:list",
      ).length;
      const fullSnapshotRefreshCount = Math.min(
        runsCalls,
        activeCalls,
        evalCalls,
      );
      const streamEventCount = Number(action.observations.streamEventCount);
      if (
        fullSnapshotRefreshCount > 1
        || fullSnapshotRefreshCount >= streamEventCount
      ) {
        throw new Error(
          "S08 stream events triggered an unbounded full snapshot refresh.",
        );
      }
      action = {
        ...action,
        observations: {
          ...action.observations,
          fullSnapshotRefreshCount,
          streamRefreshBounded: true,
        },
      };
    }
    actions.push(action);
    if (approvalRuntime && index === 1) {
      await waitForPaint(window);
      actionScreenshot = (await window.webContents.capturePage()).toPNG();
    }
  }
  if (mode.scenarioId === "S11-secret-safety") {
    const actualRunId = String(actions[0]?.observations.actualRunId ?? "");
    if (!actualRunId || actualRunId === "missing") {
      throw new Error("S11 did not expose the exact production AgentRun id.");
    }
    const episodeExport = await exportAgentEpisodeFromConfig({
      configDir: path.join(mode.userDataPath, "config"),
      outDir: path.join(mode.userDataPath, "cd09-s11-episode-export"),
      runId: actualRunId,
      backend: "sqlite",
      exportedAt: new Date().toISOString(),
    });
    const finalAction = actions.at(-1);
    if (!finalAction || episodeExport.files.length === 0) {
      throw new Error("S11 exact-run episode export produced no evidence.");
    }
    finalAction.observations = {
      ...finalAction.observations,
      episodeExported: true,
      episodeExportRunId: episodeExport.runId,
      episodeExportFileCount: episodeExport.files.length,
    };
  }
  if (approvalRuntime && mode.scenarioId === "S05-approval-attention") {
    const result = await approvalRuntime.result;
    if (
      result.approved !== false
      || result.approvalId !== approvalRuntime.id
      || options.approvalCoordinator.pendingSnapshot().length !== 0
    ) {
      throw new Error("Approval scenario did not settle exactly once.");
    }
  }
  if (
    mode.phase === "single"
    && !validateScenarioObservationValues(mode.scenarioId, actions)
  ) {
    throw new Error(
      `Scenario ${mode.scenarioId} observations do not prove its requirements: ${
        JSON.stringify(actions.map((action) => action.observations))
      }`,
    );
  }
  const renderer = await inspectRenderer(window);
  if (!renderer.productionPreload || !renderer.sessionVisible) {
    throw new Error(
      `Production renderer did not expose scenario ${mode.scenarioId}.`,
    );
  }
  await waitForPaint(window);
  const screenshot =
    actionScreenshot ?? (await window.webContents.capturePage()).toPNG();
  const screenshotImage = nativeImage.createFromBuffer(screenshot);
  const bitmap = screenshotImage.toBitmap();
  const sampledColors = new Set<string>();
  for (let index = 0; index + 3 < bitmap.length; index += 64) {
    sampledColors.add(
      `${bitmap[index]}:${bitmap[index + 1]}:${bitmap[index + 2]}:${bitmap[index + 3]}`,
    );
    if (sampledColors.size >= 12) break;
  }
  if (screenshotImage.isEmpty() || sampledColors.size < 8) {
    throw new Error("Production scenario screenshot is blank or near-uniform.");
  }
  await writeBoundArtifact(mode.screenshotFd, screenshot);
  const screenshotDigest = sha256(screenshot);
  const ipcInvocations = options.ipcInvocations();
  if (
    ipcInvocations.length === 0
    || ipcInvocations.some((entry, index) => entry.ordinal !== index + 1)
    || !ipcInvocations.some((entry) => entry.channel === "chatSessions:list")
    || !ipcInvocations.some((entry) =>
      entry.channel === (
        mode.scenarioId === "S09-long-session"
          ? "chatSessions:getTranscriptPage"
          : "chatSessions:get"
      )
    )
    || !ipcInvocations.some((entry) => entry.channel === "agentRuns:list")
    || !ipcInvocations.some((entry) =>
      entry.channel === (
        mode.scenarioId === "S09-long-session"
          ? "agentRuns:getTrajectoryPage"
          : "agentRuns:listTrajectory"
      )
    )
  ) {
    throw new Error("Scenario did not traverse the required production IPC path.");
  }
  const requirements: ConversationDisclosureScenarioRequirementReceipt[] =
    [0, 1, 2].map((index) => ({
      index,
      requirement: mode.expected[index]!,
      ok: true,
      evidenceIds: [
        actionEvidenceRef(actions[
          expectedRequirementActionIndex(
            mode.scenarioId,
            index,
            actions.length,
          )
        ]!),
        `screenshot:${screenshotDigest}`,
      ],
    }));
  const receiptInput = {
    schemaVersion: 1 as const,
    kind: "conversation-disclosure-production-scenario" as const,
    scenarioId: mode.scenarioId,
    scenarioDigest: mode.scenarioDigest,
    executionId: randomUUID(),
    processEpochs: [options.processEpoch],
    attemptNonces: [mode.attemptNonce],
    productionMain: true as const,
    productionPreload: true as const,
    demoDataUsed: false as const,
    expected: mode.expected,
    evidenceRequirements: mode.evidenceRequirements,
    actions,
    requirements,
    ipcInvocations,
    screenshotDigests: [screenshotDigest],
    status: "passed" as const,
  };
  const receipt: ConversationDisclosureScenarioReceipt = {
    ...receiptInput,
    digest: hashCanonical(receiptInput),
  };
  await writeBoundArtifact(
    mode.outputFd,
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
}

async function inspectSettledS17Projection(
  window: BrowserWindow,
  sessionId: string,
): Promise<Record<string, string | boolean>> {
  return window.webContents.executeJavaScript(`
    (async () => {
      const api = window.buildingAgent;
      let listedWorkStatus = "missing";
      let sidebarBadgeText = "missing";
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const sessions = await api.listChatSessions();
        const listedSession = sessions.find(
          (entry) => entry.id === ${JSON.stringify(sessionId)}
        );
        listedWorkStatus = listedSession?.work?.status ?? "missing";
        const sessionButton = [...document.querySelectorAll(
          "button[data-session-id]"
        )].find(
          (element) => element.getAttribute("data-session-id")
            === ${JSON.stringify(sessionId)}
        );
        sidebarBadgeText = sessionButton
          ?.querySelector(".goal-session-badge")
          ?.textContent
          ?.trim() ?? "missing";
        if (
          listedWorkStatus === "completed"
          && sidebarBadgeText === "已完成"
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const settledSessionButton = [...document.querySelectorAll(
        "button[data-session-id]"
      )].find(
        (element) => element.getAttribute("data-session-id")
          === ${JSON.stringify(sessionId)}
      );
      settledSessionButton?.click();
      let recoveredSessionVisible = false;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        recoveredSessionVisible = document.body.innerText.includes(
          "Accepted production response for S17-cancel-interruption."
        );
        if (recoveredSessionVisible) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return {
        projectionReloaded: true,
        listedWorkStatus,
        sidebarBadgeText,
        recoveredSessionVisible
      };
    })()
  `);
}

async function writeBoundArtifact(
  fd: number,
  content: string | Buffer,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    writeFileDescriptor(fd, content, (error) =>
      error ? reject(error) : resolve()
    );
  });
  await new Promise<void>((resolve, reject) => {
    fsync(fd, (error) => error ? reject(error) : resolve());
  });
}

async function exerciseAccessibilityKeyboardAction(
  window: BrowserWindow,
  sessionId: string,
): Promise<Record<string, string | number | boolean>> {
  window.focus();
  window.webContents.focus();
  const prepared = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.buildingAgent;
      const session = await api?.getChatSession(${JSON.stringify(sessionId)});
      if (!session) {
        return { ready: false };
      }
      window.location.hash = "#chat";
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
      const sessionButton = [...document.querySelectorAll("button[data-session-id]")].find(
        (element) => element.getAttribute("data-session-id") === ${JSON.stringify(sessionId)}
      );
      sessionButton?.click();
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
      const toggle = document.querySelector(
        '[data-testid="conversation-disclosure"] button[aria-expanded]'
      );
      if (!(toggle instanceof HTMLButtonElement)) {
        return { ready: false };
      }
      window.__cd09AccessibilityKeyboard = {
        before: toggle.getAttribute("aria-expanded") ?? "missing",
        initialControlId: toggle.getAttribute("aria-controls") ?? "missing",
        trustedKeyDownObserved: false,
        trustedClickObserved: false
      };
      toggle.addEventListener("keydown", (event) => {
        if (event.key === " " && event.isTrusted) {
          window.__cd09AccessibilityKeyboard.trustedKeyDownObserved = true;
        }
      }, { once: true });
      toggle.addEventListener("click", (event) => {
        if (event.isTrusted) {
          window.__cd09AccessibilityKeyboard.trustedClickObserved = true;
        }
      }, { once: true });
      toggle.focus();
      return { ready: document.activeElement === toggle };
    })()
  `);
  if (prepared?.ready !== true) {
    throw new Error("Accessibility keyboard target was not focusable.");
  }
  window.webContents.sendInputEvent({
    type: "keyDown",
    keyCode: "Space",
  });
  window.webContents.sendInputEvent({
    type: "keyUp",
    keyCode: "Space",
  });
  await waitForPaint(window);
  let rowPrepared: { ready?: boolean; rowId?: string } = {};
  let tabSteps = 0;
  for (; tabSteps < 20; tabSteps += 1) {
    window.webContents.sendInputEvent({
      type: "keyDown",
      keyCode: "Tab",
    });
    window.webContents.sendInputEvent({
      type: "keyUp",
      keyCode: "Tab",
    });
    await waitForPaint(window);
    rowPrepared = await window.webContents.executeJavaScript(`
      (() => {
        const focusedControl = document.activeElement;
        const controlId = focusedControl
          ?.closest("[data-disclosure-id]")
          ?.getAttribute("data-disclosure-id")
          ?? focusedControl?.getAttribute("aria-controls");
        return {
          ready:
            focusedControl instanceof HTMLButtonElement
            && Boolean(focusedControl.closest('[data-testid="conversation-disclosure"]'))
            && Boolean(controlId)
            && controlId !== window.__cd09AccessibilityKeyboard?.initialControlId,
          rowId: controlId
        };
      })()
    `);
    if (rowPrepared.ready === true) break;
  }
  if (rowPrepared.ready !== true) {
    throw new Error("Accessibility Tab navigation did not reach a disclosure row.");
  }
  await window.webContents.executeJavaScript(`
    (() => {
      const state = window.__cd09AccessibilityKeyboard;
      const toggle = document.querySelector(
        '[data-testid="conversation-disclosure"] button[aria-expanded]'
      );
      const after = toggle?.getAttribute("aria-expanded") ?? "missing";
      const focusedControl = document.activeElement;
      const rowId = ${JSON.stringify(rowPrepared.rowId)};
      state.groupExpandedStateChanged =
        state.before !== "missing" && state.before !== after;
      state.keyboardFocusRetained = document.activeElement === focusedControl;
      state.rowId = rowId;
      state.tabSteps = ${tabSteps + 1};
      state.trustedRowKeyDownObserved = false;
      state.trustedRowClickObserved = false;
      focusedControl.addEventListener("keydown", (event) => {
        if (event.key === " " && event.isTrusted) {
          state.trustedRowKeyDownObserved = true;
        }
      }, { once: true });
      focusedControl.addEventListener("click", (event) => {
        if (event.isTrusted) {
          state.trustedRowClickObserved = true;
        }
      }, { once: true });
      return true;
    })()
  `);
  window.webContents.sendInputEvent({
    type: "keyDown",
    keyCode: "Space",
  });
  window.webContents.sendInputEvent({
    type: "keyUp",
    keyCode: "Space",
  });
  await waitForPaint(window);
  const updateResult = await window.webContents.executeJavaScript(`
    (async () => {
      const state = window.__cd09AccessibilityKeyboard;
      const api = window.buildingAgent;
      const update = await api.sendChatMessage({
        sessionId: ${JSON.stringify(sessionId)},
        requestId: "cd09-s10-focus-update",
        message: "Append one accessibility focus update."
      });
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
      const focusedRowId = document.activeElement
        ?.closest("[data-disclosure-id]")
        ?.getAttribute("data-disclosure-id")
        ?? document.activeElement?.getAttribute("aria-controls");
      state.focusSurvivedItemUpdate =
        Boolean(state.rowId) && focusedRowId === state.rowId;
      state.rowUpdateSucceeded = update.ok === true;
      const runsButton = document.querySelector(
        '.primary-nav button[aria-label="运行"]'
      );
      if (!(runsButton instanceof HTMLButtonElement)) {
        return { ready: false };
      }
      state.trustedEvidenceKeyDownObserved = false;
      state.trustedEvidenceClickObserved = false;
      runsButton.addEventListener("keydown", (event) => {
        if (event.key === " " && event.isTrusted) {
          state.trustedEvidenceKeyDownObserved = true;
        }
      }, { once: true });
      runsButton.addEventListener("click", (event) => {
        if (event.isTrusted) {
          state.trustedEvidenceClickObserved = true;
        }
      }, { once: true });
      runsButton.focus();
      return { ready: document.activeElement === runsButton };
    })()
  `);
  if (updateResult?.ready !== true) {
    throw new Error("Accessibility evidence-navigation target was not focusable.");
  }
  window.webContents.sendInputEvent({
    type: "keyDown",
    keyCode: "Space",
  });
  window.webContents.sendInputEvent({
    type: "keyUp",
    keyCode: "Space",
  });
  await waitForPaint(window);
  return window.webContents.executeJavaScript(`
    (() => {
      const state = window.__cd09AccessibilityKeyboard;
      const runsButton = document.querySelector(
        '.primary-nav button[aria-label="运行"]'
      );
      return {
        keyboardFocusRetained: state?.keyboardFocusRetained === true,
        expandedStateChanged: state?.groupExpandedStateChanged === true,
        trustedKeyDownObserved: state?.trustedKeyDownObserved === true,
        trustedClickObserved: state?.trustedClickObserved === true,
        tabReachedDisclosureControl: Boolean(state?.rowId),
        tabReachedDifferentDisclosureControl:
          Boolean(state?.rowId)
          && state.rowId !== state.initialControlId,
        tabNavigationSteps: state?.tabSteps ?? -1,
        trustedFocusedControlKeyDownObserved:
          state?.trustedRowKeyDownObserved === true,
        trustedFocusedControlClickObserved:
          state?.trustedRowClickObserved === true,
        rowUpdateSucceeded: state?.rowUpdateSucceeded === true,
        focusSurvivedItemUpdate: state?.focusSurvivedItemUpdate === true,
        trustedEvidenceKeyDownObserved:
          state?.trustedEvidenceKeyDownObserved === true,
        trustedEvidenceClickObserved:
          state?.trustedEvidenceClickObserved === true,
        evidenceNavigationActivated: window.location.hash === "#runs",
        focusSurvivedEvidenceNavigation: document.activeElement === runsButton
      };
    })()
  `);
}

async function exerciseReducedMotionAccessibilityAction(
  window: BrowserWindow,
  sessionId: string,
): Promise<Record<string, string | number | boolean>> {
  window.focus();
  window.webContents.focus();
  const prepared = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.buildingAgent;
      const session = await api?.getChatSession(${JSON.stringify(sessionId)});
      if (!session) {
        return { ready: false };
      }
      window.location.hash = "#chat";
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
      const sessionButton = [...document.querySelectorAll("button[data-session-id]")].find(
        (element) => element.getAttribute("data-session-id") === ${JSON.stringify(sessionId)}
      );
      sessionButton?.click();
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
      const toggle = document.querySelector(
        '[data-testid="conversation-disclosure"] button[aria-expanded]'
      );
      if (!(toggle instanceof HTMLButtonElement)) {
        return { ready: false };
      }
      window.__cd09ReducedMotion = {
        before: toggle.getAttribute("aria-expanded") ?? "missing",
        trustedClickObserved: false
      };
      toggle.addEventListener("click", (event) => {
        if (event.isTrusted) {
          window.__cd09ReducedMotion.trustedClickObserved = true;
        }
      }, { once: true });
      toggle.focus();
      return { ready: document.activeElement === toggle };
    })()
  `);
  if (prepared?.ready !== true) {
    throw new Error("Reduced-motion accessibility target was not focusable.");
  }
  window.webContents.sendInputEvent({
    type: "keyDown",
    keyCode: "Space",
  });
  window.webContents.sendInputEvent({
    type: "keyUp",
    keyCode: "Space",
  });
  await waitForPaint(window);
  return window.webContents.executeJavaScript(`
    (() => {
      const parseDurationMs = (value) =>
        value.split(",").reduce((maximum, entry) => {
          const normalized = entry.trim();
          if (normalized.endsWith("ms")) {
            return Math.max(maximum, Number.parseFloat(normalized));
          }
          if (normalized.endsWith("s")) {
            return Math.max(maximum, Number.parseFloat(normalized) * 1000);
          }
          return Number.POSITIVE_INFINITY;
        }, 0);
      const state = window.__cd09ReducedMotion;
      const disclosure = document.querySelector(
        '[data-testid="conversation-disclosure"]'
      );
      const toggle = disclosure?.querySelector("button[aria-expanded]");
      const motionTarget = document.querySelector(".chat-sidebar") ?? toggle;
      const motionStyle = motionTarget ? getComputedStyle(motionTarget) : null;
      const disclosureStyle = disclosure ? getComputedStyle(disclosure) : null;
      const animationDurationMs = motionStyle
        ? parseDurationMs(motionStyle.animationDuration)
        : Number.POSITIVE_INFINITY;
      const transitionDurationMs = motionStyle
        ? parseDurationMs(motionStyle.transitionDuration)
        : Number.POSITIVE_INFINITY;
      const after = toggle?.getAttribute("aria-expanded") ?? "missing";
      return {
        reducedMotionEnabled:
          matchMedia("(prefers-reduced-motion: reduce)").matches,
        reducedAnimationDurationMs: animationDurationMs,
        reducedTransitionDurationMs: transitionDurationMs,
        nonessentialMotionSuppressed:
          animationDurationMs <= 0.01 && transitionDurationMs <= 0.01,
        stateChangedUnderReducedMotion:
          state?.before !== "missing" && state.before !== after,
        stateStillVisible:
          Boolean(disclosure)
          && disclosureStyle?.display !== "none"
          && disclosureStyle?.visibility !== "hidden",
        trustedReducedMotionClickObserved:
          state?.trustedClickObserved === true
      };
    })()
  `);
}

async function executeScenarioAction(options: {
  container: AppContainer;
  window: BrowserWindow;
  scenarioId: ConversationDisclosureScenarioId;
  index: number;
  prepared: PreparedScenario;
  approvalRuntime: ApprovalRuntime | null;
  phase: "single" | "initial" | "restart";
}): Promise<ConversationDisclosureScenarioActionReceipt> {
  let preliminaryObservations: Record<string, string | number | boolean> = {};
  let guidedInputReloaded = false;
  if (
    options.scenarioId === "S07-plan-progress"
    && options.index === 2
  ) {
    await completeAcceptancePlanRuntime(options.prepared);
  }
  if (
    options.scenarioId === "S14-guided-input"
    && options.index === 0
  ) {
    preliminaryObservations = await establishGuidedInputBeforeReload(
      options.window,
      options.prepared.sessionId,
    );
    await reloadRenderer(options.window);
    guidedInputReloaded = true;
  }
  if (
    options.scenarioId === "S10-accessibility"
    && options.index === 0
  ) {
    preliminaryObservations = await exerciseAccessibilityKeyboardAction(
      options.window,
      options.prepared.sessionId,
    );
  }
  const shouldReload =
    (
      (
        options.scenarioId === "S06-pause-reload-recovery"
        || options.scenarioId === "S16-plan-confirmation"
      )
      && options.index === 0
    )
    || options.index > 0
    && (
      options.scenarioId === "S05-approval-attention"
        ? options.index === 1
        : options.scenarioId === "S03-evidence-handoff"
          || options.index ===
            conversationDisclosureScenarioActionCounts[options.scenarioId] - 1
    );
  if (shouldReload) {
    await reloadRenderer(options.window);
  }
  if (
    options.scenarioId === "S10-accessibility"
    && options.index === 2
  ) {
    if (!options.window.webContents.debugger.isAttached()) {
      options.window.webContents.debugger.attach("1.3");
    }
    await options.window.webContents.debugger.sendCommand(
      "Emulation.setEmulatedMedia",
      {
        media: "",
        features: [{
          name: "prefers-reduced-motion",
          value: "reduce",
        }],
      },
    );
    preliminaryObservations =
      await exerciseReducedMotionAccessibilityAction(
        options.window,
        options.prepared.sessionId,
      );
  }
  const rendererPerformanceSession =
    options.scenarioId === "S09-long-session" && options.index === 2
      ? await startRendererPerformanceSession(options.window)
      : null;
  let result: {
    ok?: boolean;
    reason?: string;
    sessionLoaded?: boolean;
    sessionListed?: boolean;
    runListed?: boolean;
    trajectoryLoaded?: boolean;
    actionObservations?: Record<string, string | number | boolean>;
  };
  try {
    result = await options.window.webContents.executeJavaScript(`
    (async () => {
      const api = window.buildingAgent;
      if (!api || typeof api.getRuntimeInfo !== "function") {
        return { ok: false, reason: "missing-production-preload" };
      }
      window.location.hash = ${
        JSON.stringify(routeForScenario(options.scenarioId, options.index))
      };
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
      const sessions = await api.listChatSessions();
      const isLongSession = ${JSON.stringify(options.scenarioId)} === "S09-long-session";
      let session = isLongSession
        ? null
        : await api.getChatSession(${JSON.stringify(options.prepared.sessionId)});
      const runs = await api.listAgentRuns();
      let trajectory = isLongSession
        ? (await api.getAgentRunTrajectoryPage(
            ${JSON.stringify(options.prepared.runId)},
            { limit: 200 }
          )).records
        : await api.listAgentRunTrajectory(${
            JSON.stringify(options.prepared.runId)
          });
      const scheduledTasks = await api.listScheduledTasks();
      let semanticOk = true;
      let actionObservations = ${
        JSON.stringify(preliminaryObservations)
      };
      const sessionButton = [...document.querySelectorAll("button[data-session-id]")].find(
        (element) => element.getAttribute("data-session-id") === ${JSON.stringify(options.prepared.sessionId)}
      );
      if (${JSON.stringify(routeForScenario(options.scenarioId, options.index))} === "#chat") {
        sessionButton?.click();
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
      }
      const chatSurface = document.querySelector(
        '[data-testid="agent-chat-panel"]'
      );
      if (${JSON.stringify(options.scenarioId)} === "S01-default-narrative") {
        if (${options.index} === 0) {
          const streamEvents = [];
          const unsubscribe = api.onChatStreamEvent((event) => {
            if (event.requestId === "cd09-s01-production-send") {
              streamEvents.push(event);
            }
          });
          const sendResult = await api.sendChatMessage({
            sessionId: ${JSON.stringify(options.prepared.sessionId)},
            requestId: "cd09-s01-production-send",
            message: "Produce the bounded CD09 acceptance result."
          });
          for (let attempt = 0; attempt < 100; attempt += 1) {
            if (streamEvents.some((event) => event.type === "completed")) {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          unsubscribe();
          session = await api.getChatSession(${
            JSON.stringify(options.prepared.sessionId)
          });
          const acceptedMessage = session?.messages?.find(
            (message) =>
              message.requestId === "cd09-s01-production-send"
              && message.role === "assistant"
          );
          const toolStates = (session?.activity?.statusEvents ?? [])
            .filter(
              (event) =>
                event.requestId === "cd09-s01-production-send"
                && ["tool_call", "tool_invocation", "tool_result"].includes(
                  event.state
                )
            );
          semanticOk =
            sendResult.ok === true
            && sendResult.reply.includes(
              "Accepted production response for S01-default-narrative."
            )
            && Boolean(acceptedMessage)
            && streamEvents.some((event) => event.type === "answer_delta")
            && streamEvents.some((event) => event.type === "completed")
            && toolStates.some((event) => event.state === "tool_invocation")
            && toolStates.some((event) => event.state === "tool_result")
            && (sendResult.ok ? sendResult.agentStatus?.toolCallsExecuted : 0) === 1;
          actionObservations = {
            sendSucceeded: sendResult.ok === true,
            sendReply: sendResult.ok ? sendResult.reply : sendResult.message,
            acceptedAssistantPersisted: Boolean(acceptedMessage),
            answerDeltaObserved: streamEvents.some(
              (event) => event.type === "answer_delta"
            ),
            terminalObserved: streamEvents.some(
              (event) => event.type === "completed"
            ),
            toolInvocationObserved: toolStates.some(
              (event) => event.state === "tool_invocation"
            ),
            toolResultObserved: toolStates.some(
              (event) => event.state === "tool_result"
            ),
            toolCallsExecuted:
              sendResult.ok
                ? sendResult.agentStatus?.toolCallsExecuted ?? -1
                : -1,
            streamEventTypes: streamEvents.map((event) => event.type).join(",")
          };
        } else {
          const disclosure = document.querySelector(
            '[data-testid="conversation-disclosure"]'
          );
          const operationsToggle = disclosure?.querySelector(
            ".conversation-disclosure-group.is-operations > header > button"
          );
          const bodyText = document.body.innerText;
          semanticOk =
            Boolean(disclosure)
            && operationsToggle?.getAttribute("aria-expanded") === "false"
            && bodyText.includes(
              "Accepted production response for S01-default-narrative."
            )
            && !bodyText.includes("Comparing the persisted request");
          actionObservations = {
            disclosureVisible: Boolean(disclosure),
            operationsExpanded:
              operationsToggle?.getAttribute("aria-expanded") ?? "missing",
            acceptedNarrativeVisible: bodyText.includes(
              "Accepted production response for S01-default-narrative."
            ),
            privateReasoningHidden: !bodyText.includes(
              "Comparing the persisted request"
            )
          };
        }
      }
      if (${JSON.stringify(options.scenarioId)} === "S02-inline-expansion") {
        const operationsGroup = document.querySelector(
          ".conversation-disclosure-group.is-operations"
        );
        const groupToggle = operationsGroup?.querySelector(
          ":scope > header > button"
        );
        if (${options.index} === 0) {
          if (groupToggle?.getAttribute("aria-expanded") !== "true") {
            groupToggle?.click();
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            );
          }
          const row = operationsGroup?.querySelector(
            "[data-disclosure-id]"
          );
          const rowToggle = row?.querySelector("button[aria-expanded]");
          if (rowToggle?.getAttribute("aria-expanded") !== "true") {
            rowToggle?.click();
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            );
          }
          const rowId = row?.getAttribute("data-disclosure-id") ?? "";
          window.__cd09S02RowId = rowId;
          semanticOk =
            Boolean(rowId)
            && groupToggle?.getAttribute("aria-expanded") === "true"
            && rowToggle?.getAttribute("aria-expanded") === "true";
          actionObservations = {
            stableRowId: rowId,
            groupExpanded: groupToggle?.getAttribute("aria-expanded") === "true",
            rowExpanded: rowToggle?.getAttribute("aria-expanded") === "true"
          };
        } else if (${options.index} === 1) {
          const update = await api.sendChatMessage({
            sessionId: ${JSON.stringify(options.prepared.sessionId)},
            requestId: "cd09-s02-stream-update",
            message: "Append one deterministic streaming update."
          });
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          );
          const rowId = window.__cd09S02RowId ?? "";
          const matchingRows = [
            ...document.querySelectorAll("[data-disclosure-id]")
          ].filter(
            (row) => row.getAttribute("data-disclosure-id") === rowId
          );
          const retainedToggle = matchingRows[0]?.querySelector(
            "button[aria-expanded]"
          );
          semanticOk =
            update.ok === true
            && matchingRows.length === 1
            && retainedToggle?.getAttribute("aria-expanded") === "true";
          actionObservations = {
            updateSucceeded: update.ok === true,
            stableRowMatchCount: matchingRows.length,
            rowExpansionRetained:
              retainedToggle?.getAttribute("aria-expanded") === "true"
          };
        } else {
          if (groupToggle?.getAttribute("aria-expanded") === "true") {
            groupToggle.click();
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            );
          }
          semanticOk = groupToggle?.getAttribute("aria-expanded") === "false";
          actionObservations = {
            groupExpanded:
              groupToggle?.getAttribute("aria-expanded") ?? "missing"
          };
        }
      }
      if (${JSON.stringify(options.scenarioId)} === "S03-evidence-handoff") {
        const runButton = [...document.querySelectorAll(
          ".task-record-row"
        )].find((element) =>
          element.textContent?.includes(${JSON.stringify(options.prepared.runId)})
          || element.textContent?.includes("CD09 S03-evidence-handoff")
        );
        runButton?.click();
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
        const technicalDetails = document.querySelector(
          ".task-record-technical-details"
        );
        if (technicalDetails && !technicalDetails.open) {
          technicalDetails.querySelector("summary")?.click();
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          );
        }
        const bodyText = document.body.innerText;
        semanticOk =
          Boolean(runButton)
          && runButton?.classList.contains("is-selected") === true
          && Boolean(technicalDetails?.open)
          && trajectory.some(
            (entry) =>
              entry.id === "trajectory-S03-evidence-handoff"
              && entry.runId === ${JSON.stringify(options.prepared.runId)}
          );
        actionObservations = {
          runSelected: Boolean(runButton),
          selectedRunRow:
            runButton?.classList.contains("is-selected") === true,
          technicalDetailsOpen: Boolean(technicalDetails?.open),
          exactRunLoaded: runs.some(
            (entry) => entry.id === ${JSON.stringify(options.prepared.runId)}
          ),
          exactTrajectoryLoaded: trajectory.some(
            (entry) => entry.id === "trajectory-S03-evidence-handoff"
          )
        };
      }
      if (${JSON.stringify(options.scenarioId)} === "S06-pause-reload-recovery") {
        const activeExecutions = await api.listActiveAgentExecutions();
        const checkpoint = activeExecutions.find(
          (entry) => entry.runId === ${JSON.stringify(options.prepared.runId)}
        );
        if (${options.index} === 0) {
          semanticOk =
            checkpoint?.status === "paused"
            && Boolean(session)
            && runs.some(
              (entry) =>
                entry.id === ${JSON.stringify(options.prepared.runId)}
                && entry.status === "paused"
            );
          actionObservations = {
            checkpointRecovered: Boolean(checkpoint),
            checkpointStatus: checkpoint?.status ?? "missing",
            chatSessionRecovered: Boolean(session)
          };
        } else if (${options.index} === 1) {
          const pausedRun = runs.find(
            (entry) => entry.id === ${JSON.stringify(options.prepared.runId)}
          );
          semanticOk =
            checkpoint?.status === "paused"
            && pausedRun?.status === "paused"
            && trajectory.some(
              (entry) => entry.runId === ${JSON.stringify(options.prepared.runId)}
            );
          actionObservations = {
            chatAndRunAgree:
              checkpoint?.status === "paused"
              && pausedRun?.status === "paused",
            evidenceCoverageAvailable: trajectory.length > 0
          };
        } else {
          const first = await api.resumeAgentRun(
            ${JSON.stringify(options.prepared.runId)}
          );
          const duplicate = await api.resumeAgentRun(
            ${JSON.stringify(options.prepared.runId)}
          );
          semanticOk = first.ok === true && duplicate.ok === false;
          actionObservations = {
            continuationConsumed: first.ok === true,
            duplicateContinuationRejected: duplicate.ok === false,
            terminalRunStatus: first.ok ? first.run.status : "resume-failed"
          };
        }
      }
      if (${JSON.stringify(options.scenarioId)} === "S04-failure-attention") {
        const bodyText = document.body.innerText;
        if (${options.index} === 0) {
          const attention = document.querySelector(
            ".conversation-disclosure-group.is-attention"
          );
          semanticOk =
            Boolean(attention)
            && bodyText.includes("CD09 deterministic operation failed")
            && !bodyText.includes("CD09 S04-failure-attention production scenario state is persisted.");
          actionObservations = {
            failureAttentionVisible: Boolean(attention),
            failureNarrativeVisible: bodyText.includes(
              "CD09 deterministic operation failed"
            ),
            successNarrativeVisible: bodyText.includes(
              "CD09 S04-failure-attention production scenario state is persisted."
            )
          };
        } else {
          const runButton = [...document.querySelectorAll(
            ".task-record-row"
          )].find((element) =>
            element.textContent?.includes("CD09 S04-failure-attention")
          );
          runButton?.click();
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          );
          const technicalDetails = document.querySelector(
            ".task-record-technical-details"
          );
          technicalDetails?.querySelector("summary")?.click();
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          );
          const technicalText = technicalDetails?.textContent ?? "";
          semanticOk =
            Boolean(runButton)
            && Boolean(technicalDetails?.open)
            && technicalText.includes("CD09 deterministic operation failed")
            && !technicalText.includes("api_key")
            && !technicalText.includes("acceptance-not-a-secret");
          actionObservations = {
            recoveryRunSelected: Boolean(runButton),
            technicalDetailsOpen: Boolean(technicalDetails?.open),
            sanitizedFailureVisible: technicalText.includes(
              "CD09 deterministic operation failed"
            ),
            credentialMaterialVisible:
              technicalText.includes("api_key")
              || technicalText.includes("acceptance-not-a-secret")
          };
        }
      }
      if (${JSON.stringify(options.scenarioId)} === "S12-retry-attempt") {
        if (${options.index} === 0) {
          const streamEvents = [];
          const unsubscribe = api.onChatStreamEvent((event) => {
            if (event.requestId === "cd09-s12-attempt-1") {
              streamEvents.push(event);
            }
          });
          const firstAttempt = await api.sendChatMessage({
            sessionId: ${JSON.stringify(options.prepared.sessionId)},
            requestId: "cd09-s12-attempt-1",
            message: "Execute the first deterministic CD09 retry attempt."
          });
          unsubscribe();
          semanticOk =
            firstAttempt.ok === false
            && streamEvents.some(
              (event) =>
                event.type === "answer_delta"
                && event.text.includes("Rejected partial attempt.")
            )
            && streamEvents.some((event) => event.type === "failed");
          actionObservations = {
            firstAttemptRejected: firstAttempt.ok === false,
            firstAttemptMessage:
              firstAttempt.ok ? firstAttempt.reply : firstAttempt.message,
            rejectedPartialObserved: streamEvents.some(
              (event) =>
                event.type === "answer_delta"
                && event.text.includes("Rejected partial attempt.")
            ),
            failureTerminalObserved: streamEvents.some(
              (event) => event.type === "failed"
            ),
            streamEventTypes: streamEvents.map((event) => event.type).join(",")
          };
        } else if (${options.index} === 1) {
          const secondAttempt = await api.sendChatMessage({
            sessionId: ${JSON.stringify(options.prepared.sessionId)},
            requestId: "cd09-s12-attempt-2",
            message: "Retry the deterministic CD09 request."
          });
          semanticOk =
            secondAttempt.ok === true
            && secondAttempt.reply
              === "Accepted production response for S12-retry-attempt.";
          actionObservations = {
            retrySucceeded: secondAttempt.ok === true,
            acceptedReply:
              secondAttempt.ok === true
                ? secondAttempt.reply
                : "retry-failed"
          };
        } else {
          session = await api.getChatSession(${
            JSON.stringify(options.prepared.sessionId)
          });
          const persisted = JSON.stringify(session);
          semanticOk =
            persisted.includes(
              "Accepted production response for S12-retry-attempt."
            )
            && !persisted.includes("Rejected partial attempt.");
          actionObservations = {
            acceptedAttemptPersisted: persisted.includes(
              "Accepted production response for S12-retry-attempt."
            ),
            rejectedPartialPersisted: persisted.includes(
              "Rejected partial attempt."
            )
          };
        }
      }
      if (${JSON.stringify(options.scenarioId)} === "S17-cancel-interruption") {
        if (${JSON.stringify(options.phase)} === "initial" && ${options.index} === 0) {
          const requestId = "cd09-s17-cancel-active";
          const completion = api.sendChatMessage({
            sessionId: ${JSON.stringify(options.prepared.sessionId)},
            requestId,
            message: "Start the deterministic cancelable CD09 request."
          });
          await new Promise((resolve) => setTimeout(resolve, 100));
          const cancelResult = await api.cancelChatMessage(requestId);
          const sendResult = await completion;
          semanticOk =
            cancelResult.ok === true
            && sendResult.ok === false
            && sendResult.code === "CANCELED";
          actionObservations = {
            cancelAccepted: cancelResult.ok === true,
            canceledResult: sendResult.ok === false,
            canceledCode:
              sendResult.ok === false ? sendResult.code ?? "missing" : "unexpected-success"
          };
        } else if (${options.index} === 1) {
          if (${JSON.stringify(options.phase)} === "initial") {
            window.__cd09S17PendingCompletion = api.sendChatMessage({
              sessionId: ${JSON.stringify(options.prepared.sessionId)},
              requestId: "cd09-s17-pending-approval",
              message: "Start a real approval-bound tool invocation."
            }).catch((error) => error);
            let pending = [];
            for (let attempt = 0; attempt < 200; attempt += 1) {
              pending = await api.getPendingToolApprovals();
              if (pending.length === 1) break;
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            const approval = pending[0];
            const identity = approval?.causalRef?.toolInvocationIdentity;
            const invocationTrajectory = identity?.runId
              ? await api.listAgentRunTrajectory(identity.runId)
              : [];
            const waitingInvocationPersisted = invocationTrajectory.some(
              (event) =>
                event.payload?.toolInvocationId === identity?.id
                && event.payload?.invocationStatus === "waiting_approval"
                && event.payload?.approvalId === approval?.id
            );
            const invocationIdentityFrozen = Boolean(
              identity?.id
              && identity?.runId
              && identity?.toolCallId
              && identity?.toolName === "shell_exec"
              && identity?.source
              && identity?.createdAt
              && approval?.causalRef?.toolInvocationId === identity.id
              && approval?.causalRef?.toolInvocationRunId === identity.runId
            );
            semanticOk =
              pending.length === 1
              && waitingInvocationPersisted
              && invocationIdentityFrozen;
            actionObservations = {
              pendingApprovalCount: pending.length,
              priorPrivilegeRecovered: false,
              waitingInvocationPersisted,
              invocationIdentityFrozen,
              approvalBoundToInvocation:
                approval?.id === "approval-S17-cancel-interruption"
                && approval?.causalRef?.requestId
                  === "cd09-s17-pending-approval"
            };
          } else {
            const pending = await api.getPendingToolApprovals();
            const waitingInvocationPersisted = trajectory.some(
              (event) =>
                event.payload?.toolInvocationId === ${JSON.stringify(
                  options.prepared.interruptedToolInvocationId ?? "missing",
                )}
                && event.payload?.invocationStatus === "waiting_approval"
            );
            semanticOk = pending.length === 0 && waitingInvocationPersisted;
            actionObservations = {
              pendingApprovalCount: pending.length,
              priorPrivilegeRecovered: false,
              waitingInvocationPersisted,
              invocationIdentityFrozen: Boolean(${JSON.stringify(
                options.prepared.interruptedToolInvocationId ?? "",
              )}),
              approvalBoundToInvocation: ${JSON.stringify(
                options.prepared.interruptedApprovalId
                  === "approval-S17-cancel-interruption",
              )}
            };
          }
        } else {
          session = await api.getChatSession(${
            JSON.stringify(options.prepared.sessionId)
          });
          const persisted = JSON.stringify(session);
          const pending = await api.getPendingToolApprovals();
          const interruptedTrajectory = ${JSON.stringify(
            options.phase === "restart",
          )}
            ? await api.listAgentRunTrajectory(${JSON.stringify(
              options.prepared.interruptedToolInvocationRunId ?? "missing",
            )})
            : trajectory;
          const nextAttempt = ${JSON.stringify(options.phase === "restart")}
            ? await api.sendChatMessage({
                sessionId: ${JSON.stringify(options.prepared.sessionId)},
                requestId: "cd09-s17-new-attempt",
                message: "Start a distinct post-recovery attempt."
              })
            : null;
          const recovered = nextAttempt
            ? await api.getChatSession(${JSON.stringify(options.prepared.sessionId)})
            : session;
          const distinctAttemptPersisted = Boolean(
            recovered?.messages?.some(
              (message) => message.requestId === "cd09-s17-new-attempt"
            )
          );
          semanticOk = ${JSON.stringify(options.phase === "restart")}
            ? pending.length === 0
              && persisted.includes("canceled")
              && interruptedTrajectory.some(
                (event) =>
                  event.payload?.toolInvocationId === ${JSON.stringify(
                    options.prepared.interruptedToolInvocationId ?? "missing",
                  )}
                  && event.payload?.invocationStatus === "aborted"
              )
              && ${JSON.stringify(
                options.prepared.interruptedWorkspaceAborted === true,
              )}
              && ${JSON.stringify(
                options.prepared.interruptedChatAborted === true,
              )}
              && nextAttempt?.ok === true
              && distinctAttemptPersisted
            : pending.length === 1;
          actionObservations = {
            coldStartPendingCount: pending.length,
            canceledAuthorityPersisted: persisted.includes("canceled"),
            explicitNewAttemptRequired: pending.length === 0,
            interruptedApprovalPersisted: ${JSON.stringify(
              options.phase === "restart"
                ? Boolean(options.prepared.interruptedApprovalId)
                : "deferred_to_restart",
            )},
            trajectoryInvocationAborted: ${JSON.stringify(
              options.phase === "restart"
                ? options.prepared.interruptedTrajectoryAborted === true
                : "deferred_to_restart",
            )},
            workspaceInvocationAborted: ${JSON.stringify(
              options.phase === "restart"
                ? options.prepared.interruptedWorkspaceAborted === true
                : "deferred_to_restart",
            )},
            chatInvocationAborted: ${JSON.stringify(
              options.phase === "restart"
                ? options.prepared.interruptedChatAborted === true
                : "deferred_to_restart",
            )},
            newAttemptSucceeded:
              nextAttempt === null ? "deferred_to_restart" : nextAttempt.ok === true,
            distinctAttemptPersisted:
              nextAttempt === null ? "deferred_to_restart" : distinctAttemptPersisted
          };
        }
      }
      if (${JSON.stringify(options.scenarioId)} === "S08-scheduled-progress") {
        const task = scheduledTasks.find(
          (entry) => entry.id === ${
            JSON.stringify(options.prepared.scheduledTaskId ?? "")
          }
        );
        if (${options.index} === 0) {
          const streamEvents = [];
          const unsubscribe = api.onAgentStreamEvent((event) => {
            streamEvents.push(event);
          });
          let runError = "";
          try {
            await api.runScheduledTaskStreaming(task?.id ?? "");
          } catch (error) {
            runError = error instanceof Error ? error.message : String(error);
          }
          unsubscribe();
          const actualRuns = await api.listAgentRuns();
          const actualRun = actualRuns.find(
            (entry) =>
              entry.taskId === task?.id
              && entry.id !== ${JSON.stringify(options.prepared.runId)}
          );
          sessionStorage.setItem("cd09:S08:runId", actualRun?.id ?? "");
          semanticOk =
            Boolean(task)
            && Boolean(actualRun)
            && streamEvents.length > 0
            && runError === "";
          actionObservations = {
            scheduledTaskFound: Boolean(task),
            streamEventCount: streamEvents.length,
            actualRunId: actualRun?.id ?? "missing",
            runError: runError || "none"
          };
        } else {
          const actualRunId = sessionStorage.getItem("cd09:S08:runId") ?? "";
          const actualRuns = await api.listAgentRuns();
          const actualRun = actualRuns.find(
            (entry) => entry.id === actualRunId
          );
          const runButton = [...document.querySelectorAll(
            ".task-record-row"
          )].find((element) =>
            element.textContent?.includes(actualRun?.taskName ?? "__missing__")
          );
          runButton?.click();
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          );
          const actualTrajectory = actualRunId
            ? await api.listAgentRunTrajectory(actualRunId)
            : [];
          semanticOk =
            Boolean(task)
            && Boolean(actualRun)
            && actualRun?.taskId === task?.id
            && Boolean(runButton)
            && actualTrajectory.length > 0
            && actualTrajectory.length <= 200;
          actionObservations = {
            sharedRunIdentity: actualRun?.taskId === task?.id,
            runVisibleAcrossSurface: Boolean(runButton),
            trajectoryEventCount: actualTrajectory.length,
            boundedTrajectory: actualTrajectory.length <= 200
          };
        }
      }
      if (${JSON.stringify(options.scenarioId)} === "S13-legacy-coverage") {
        const disclosureMode = api.getConversationDisclosureMode();
        const expectedMode = ${
          JSON.stringify(options.phase === "restart" ? "legacy" : "projected")
        };
        const exactRun = runs.find(
          (entry) => entry.id === ${JSON.stringify(options.prepared.runId)}
        );
        const exactTrajectory = trajectory.find(
          (entry) => entry.id === "cd09-v391-trajectory-event"
        );
        const compatibilityIdStable =
          session?.id === "cd09-v391-session"
          && exactRun?.id === "cd09-v391-run"
          && exactTrajectory?.runId === "cd09-v391-run";
        const authorityLinkageValid = ${JSON.stringify(
          options.prepared.legacyAuthorityLinkageValid === true,
        )};
        const sourceNotMutated = ${JSON.stringify(
          options.prepared.legacySourceNotMutated === true,
        )};
        const fixtureDigest = ${JSON.stringify(
          options.prepared.legacyFixtureDigest ?? "missing",
        )};
        const sourceCutId = ${JSON.stringify(
          options.prepared.legacySourceCutId ?? "missing",
        )};
        if (${options.index} === 0) {
          const goalSummaryLinked =
            session?.goalIds?.includes("cd09-v391-goal") === true
            && session?.messages?.some(
              (message) =>
                message.role === "assistant"
                && message.executedRunId === "cd09-v391-run"
                && message.goalId === "cd09-v391-goal"
            );
          semanticOk =
            disclosureMode === expectedMode
            && Boolean(session)
            && goalSummaryLinked
            && compatibilityIdStable
            && authorityLinkageValid
            && sourceNotMutated;
          actionObservations = {
            disclosureMode,
            sessionReadable: Boolean(session),
            goalSummaryLinked,
            compatibilityIdStable,
            authorityLinkageValid,
            fixtureDigest,
            sourceCutId,
            sourceNotMutated
          };
        } else if (${options.index} === 1) {
          const runButton = [...document.querySelectorAll(
            ".task-record-row"
          )].find((element) =>
            element.textContent?.includes("v3.9.1 multidomain compatibility")
          );
          runButton?.click();
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          );
          const technicalDetails = document.querySelector(
            ".task-record-technical-details"
          );
          if (technicalDetails && !technicalDetails.open) {
            technicalDetails.querySelector("summary")?.click();
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            );
          }
          const intentionalAbsenceCount = ${JSON.stringify(
            options.prepared.legacyIntentionalAbsenceCount ?? 0,
          )};
          semanticOk =
            disclosureMode === expectedMode
            && Boolean(runButton)
            && Boolean(technicalDetails?.open)
            && Boolean(exactRun)
            && Boolean(exactTrajectory)
            && authorityLinkageValid
            && intentionalAbsenceCount > 0
            && sourceNotMutated;
          actionObservations = {
            disclosureMode,
            runReadable: Boolean(exactRun),
            trajectoryReadable: Boolean(exactTrajectory),
            goalReadable: authorityLinkageValid,
            planReadable: authorityLinkageValid,
            technicalEvidenceOpen: Boolean(technicalDetails?.open),
            availableTrajectoryCount: trajectory.length,
            coveragePartial: intentionalAbsenceCount > 0,
            intentionalAbsenceCount,
            authorityRecordCount: ${JSON.stringify(
              options.prepared.legacyAuthorityRecordCount ?? 0,
            )},
            authorityLinkageValid,
            fixtureDigest,
            sourceCutId,
            sourceNotMutated
          };
        } else {
          semanticOk =
            disclosureMode === expectedMode
            && Boolean(session)
            && compatibilityIdStable
            && authorityLinkageValid
            && sourceNotMutated;
          actionObservations = {
            disclosureMode,
            sessionReadable: Boolean(session),
            runReadable: Boolean(exactRun),
            trajectoryReadable: Boolean(exactTrajectory),
            compatibilityIdStable,
            authorityLinkageValid,
            fixtureDigest,
            sourceCutId,
            sourceNotMutated
          };
        }
      }
      if (${JSON.stringify(options.scenarioId)} === "S14-guided-input") {
        if (${options.index} === 0) {
          const inputRequestId =
            sessionStorage.getItem("cd09:S14:inputRequestId") ?? "";
          const pending = (session?.activity?.statusEvents ?? []).findLast(
            (event) =>
              event.pendingSkillInput?.inputRequestId === inputRequestId
              && event.pendingSkillInput?.status === "pending"
          );
          semanticOk =
            actionObservations.guidedInputRequired === true
            && Boolean(inputRequestId)
            && Boolean(pending);
          actionObservations = {
            ...actionObservations,
            reloadRecoveredPending: Boolean(pending),
            recoveredInputRequestId:
              pending?.pendingSkillInput?.inputRequestId ?? "missing"
          };
        } else if (${options.index} === 1) {
          const inputRequestId =
            sessionStorage.getItem("cd09:S14:inputRequestId") ?? "";
          const workspaceRoot =
            sessionStorage.getItem("cd09:S14:workspaceRoot") ?? "";
          const accepted = await api.respondSkillInput({
            inputRequestId,
            values: {
              targetDir: workspaceRoot
            }
          });
          const duplicate = await api.respondSkillInput({
            inputRequestId,
            values: {
              targetDir: workspaceRoot
            }
          });
          semanticOk = accepted.ok === true && duplicate.ok === false;
          actionObservations = {
            responseAcceptedOnce: accepted.ok === true,
            responseMessage: accepted.ok ? accepted.reply : accepted.message,
            responseCode:
              accepted.ok ? "success" : accepted.code ?? "missing",
            duplicateResponseRejected: duplicate.ok === false
          };
        } else {
          session = await api.getChatSession(${
            JSON.stringify(options.prepared.sessionId)
          });
          const persisted = JSON.stringify(session);
          const inputRequestId =
            sessionStorage.getItem("cd09:S14:inputRequestId") ?? "";
          const staleResponse = await api.respondSkillInput({
            inputRequestId,
            values: {
              targetDir:
                sessionStorage.getItem("cd09:S14:workspaceRoot") ?? ""
            }
          });
          semanticOk =
            persisted.includes(
              "Accepted production response for S14-guided-input."
            )
            && staleResponse.ok === false
            && staleResponse.code === "UNKNOWN_SKILL_INPUT";
          actionObservations = {
            continuationSettled: persisted.includes(
              "Accepted production response for S14-guided-input."
            ),
            staleResponseRejected:
              staleResponse.ok === false
              && staleResponse.code === "UNKNOWN_SKILL_INPUT"
          };
        }
      }
      if (${JSON.stringify(options.scenarioId)} === "S07-plan-progress") {
        const plan = await api.getPlan(
          ${JSON.stringify(options.prepared.planId ?? "")}
        );
        if (${options.index} === 0) {
          sessionStorage.setItem(
            "cd09:S07:revision",
            String(plan?.revision ?? -1)
          );
          semanticOk =
            plan?.status === "drafting"
            && (plan.planningStages?.length ?? 0) >= 6
            && plan.planningStages?.some(
              (stage) =>
                stage.kind === "review" && stage.status === "running"
            ) === true
            && plan.planningStages?.some(
              (stage) =>
                stage.kind === "generation" && stage.status === "completed"
            ) === true;
          actionObservations = {
            persistedPlanLoaded: Boolean(plan),
            planStatus: plan?.status ?? "missing",
            stageCount: plan?.planningStages?.length ?? 0,
            generationStagePersisted:
              plan?.planningStages?.some(
                (stage) =>
                  stage.kind === "generation" && stage.status === "completed"
              ) === true,
            runningReviewPersisted:
              plan?.planningStages?.some(
                (stage) =>
                  stage.kind === "review" && stage.status === "running"
              ) === true,
            productionModelCallCount: ${options.prepared.planRuntime?.modelCalls.length ?? 0}
          };
        } else if (${options.index} === 1) {
          const expectedRevision = Number(
            sessionStorage.getItem("cd09:S07:revision") ?? "-1"
          );
          semanticOk =
            plan?.revision === expectedRevision
            && plan?.actionGate === "blocked";
          actionObservations = {
            revisionStable: plan?.revision === expectedRevision,
            actionGate: plan?.actionGate ?? "missing"
          };
        } else {
          semanticOk =
            plan?.status === "awaiting_input"
            && plan?.actionGate === "blocked"
            && plan?.executionGoalId === undefined
            && plan?.planningStages?.some(
              (stage) =>
                stage.kind === "review"
                && stage.status === "completed"
                && stage.reviewApproved === false
            ) === true
            && plan?.planningStages?.some(
              (stage) => stage.kind === "quality" && stage.status === "failed"
            ) === true;
          actionObservations = {
            authoritativePlanStatus: plan?.status ?? "missing",
            blockedDecisionVisible: plan?.actionGate === "blocked",
            goalSemanticsUnchanged: plan?.executionGoalId === undefined,
            reviewRejectedPersisted:
              plan?.planningStages?.some(
                (stage) =>
                  stage.kind === "review"
                  && stage.status === "completed"
                  && stage.reviewApproved === false
              ) === true,
            qualityFailurePersisted:
              plan?.planningStages?.some(
                (stage) =>
                  stage.kind === "quality" && stage.status === "failed"
              ) === true,
            productionModelCallCount: ${options.prepared.planRuntime?.modelCalls.length ?? 0}
          };
        }
      }
      if (${JSON.stringify(options.scenarioId)} === "S15-goal-acceptance") {
        const goalId = ${JSON.stringify(options.prepared.goalId ?? "")};
        const unverifiedGoalId = ${
          JSON.stringify(options.prepared.unverifiedGoalId ?? "")
        };
        let goal = await api.getGoal(goalId);
        if (${options.index} === 0) {
          const unverifiedGoal = await api.getGoal(unverifiedGoalId);
          const certifiedReplay = goal?.acceptanceRetryState?.finalJudgeReplay;
          const unverifiedReplay =
            unverifiedGoal?.acceptanceRetryState?.finalJudgeReplay;
          const branchSourceMatched =
            Boolean(certifiedReplay)
            && Boolean(unverifiedReplay)
            && JSON.stringify(goal?.successCriteria)
              === JSON.stringify(unverifiedGoal?.successCriteria)
            && JSON.stringify(certifiedReplay?.deterministicCheckResults)
              === JSON.stringify(unverifiedReplay?.deterministicCheckResults)
            && JSON.stringify(certifiedReplay?.evidenceManifest)
              === JSON.stringify(unverifiedReplay?.evidenceManifest);
          semanticOk =
            goal?.status === "waiting_for_acceptance"
            && unverifiedGoal?.status === "waiting_for_acceptance"
            && goal.acceptanceState?.phase === "awaiting_user"
            && unverifiedGoal.acceptanceState?.phase === "awaiting_user"
            && branchSourceMatched;
          actionObservations = {
            goalLoaded: Boolean(goal),
            reviewGateStatus: goal?.status ?? "missing",
            acceptancePhase:
              goal?.acceptanceState?.phase ?? "missing",
            branchSourceMatched
          };
        } else if (${options.index} === 1) {
          const completed = await api.markGoalCompletedUnverified(
            unverifiedGoalId
          );
          const unverifiedGoal = await api.getGoal(unverifiedGoalId);
          const successNarrativeVisible = document.body.innerText.includes(
            "目标已达成"
          );
          semanticOk =
            completed.ok === true
            && unverifiedGoal?.status === "completed_unverified"
            && !unverifiedGoal?.acceptanceCertificate
            && !successNarrativeVisible;
          actionObservations = {
            manualCompletionApplied: completed.ok === true,
            completedUnverifiedStatus:
              unverifiedGoal?.status === "completed_unverified",
            acceptanceCertificateAbsent:
              !unverifiedGoal?.acceptanceCertificate,
            successNarrativeVisible
          };
        } else {
          const review = await api.continueGoalAcceptance(goalId);
          goal = await api.getGoal(goalId);
          const unverifiedGoal = await api.getGoal(unverifiedGoalId);
          for (let attempt = 0; attempt < 20; attempt += 1) {
            if (document.body.innerText.includes("目标已达成")) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          const achievedNarrativeVisible = document.body.innerText.includes(
            "目标已达成"
          );
          semanticOk =
            review.ok === true
            && goal?.status === "achieved"
            && Boolean(goal?.acceptanceCertificate)
            && unverifiedGoal?.status === "completed_unverified"
            && !unverifiedGoal?.acceptanceCertificate
            && achievedNarrativeVisible;
          actionObservations = {
            certifiedBranchApplied: review.ok === true,
            terminalStatus: goal?.status ?? "missing",
            acceptanceCertificatePersisted:
              Boolean(goal?.acceptanceCertificate),
            unverifiedBranchRemainedTerminal:
              unverifiedGoal?.status === "completed_unverified",
            achievedNarrativeVisible
          };
        }
      }
      if (${JSON.stringify(options.scenarioId)} === "S16-plan-confirmation") {
        const planId = ${JSON.stringify(options.prepared.planId ?? "")};
        const blockedPlanId = ${
          JSON.stringify(options.prepared.blockedPlanId ?? "")
        };
        let plan = await api.getPlan(planId);
        if (${options.index} === 0) {
          semanticOk =
            plan?.status === "awaiting_confirmation"
            && plan?.actionGate === "ready";
          actionObservations = {
            confirmationRecovered: Boolean(plan),
            confirmationStatus: plan?.status ?? "missing",
            actionGate: plan?.actionGate ?? "missing"
          };
        } else if (${options.index} === 1) {
          const first = await api.confirmPlan({
            planId,
            expectedRevision: plan?.revision ?? -1
          });
          const duplicate = await api.confirmPlan({
            planId,
            expectedRevision: plan?.revision ?? -1
          });
          plan = await api.getPlan(planId);
          semanticOk =
            first.ok === true
            && duplicate.ok === true
            && Boolean(plan?.executionGoalId);
          actionObservations = {
            firstConfirmationApplied: first.ok === true,
            duplicateConfirmationIdempotent: duplicate.ok === true,
            executionGoalLinked: Boolean(plan?.executionGoalId)
          };
        } else {
          const blocked = await api.getPlan(blockedPlanId);
          const rejected = await api.confirmPlan({
            planId: blockedPlanId,
            expectedRevision: blocked?.revision ?? -1
          });
          semanticOk =
            blocked?.actionGate === "blocked"
            && rejected.ok === false;
          actionObservations = {
            blockedPlanLoaded: Boolean(blocked),
            blockedActionGate: blocked?.actionGate === "blocked",
            blockedConfirmationRejected: rejected.ok === false
          };
        }
      }
      if (${JSON.stringify(options.scenarioId)} === "S09-long-session") {
        if (${options.index} === 0) {
          const page = await api.getChatSessionTranscriptPage(
            ${JSON.stringify(options.prepared.sessionId)},
            { limit: 50 }
          );
          const evidencePage = await api.getAgentRunTrajectoryPage(
            ${JSON.stringify(options.prepared.runId)},
            { limit: 75 }
          );
          session = page?.session ?? null;
          sessionStorage.setItem(
            "cd09:S09:beforeSequence",
            String(page?.page.startSequence ?? 0)
          );
          sessionStorage.setItem(
            "cd09:S09:trajectoryCursor",
            evidencePage.nextCursor ?? ""
          );
          sessionStorage.setItem(
            "cd09:S09:trajectoryRevision",
            evidencePage.sourceRevision
          );
          sessionStorage.setItem(
            "cd09:S09:trajectoryLastSequence",
            String(evidencePage.records.at(-1)?.sequence ?? 0)
          );
          const tailPayloadBytes = new TextEncoder().encode(
            JSON.stringify(page?.session.messages ?? [])
          ).byteLength;
          semanticOk =
            Boolean(page)
            && page.session.messages.length === 50
            && page.page.hasMoreBefore === true
            && (page.page.totalMessages ?? 0) >= 320
            && tailPayloadBytes > 50 * 1024
            && evidencePage.status === "complete"
            && evidencePage.records.length === 75
            && Boolean(evidencePage.nextCursor);
          actionObservations = {
            tailMessageCount: page?.session.messages.length ?? -1,
            tailBounded: (page?.session.messages.length ?? 51) <= 50,
            totalMessageCount: page?.page.totalMessages ?? -1,
            tailPayloadBytes,
            hasOlderPage: page?.page.hasMoreBefore === true,
            trajectoryPageCount: evidencePage.records.length,
            trajectoryPageBounded: evidencePage.records.length === 75,
            trajectoryHasNextPage: Boolean(evidencePage.nextCursor)
          };
        } else if (${options.index} === 1) {
          const beforeSequence = Number(
            sessionStorage.getItem("cd09:S09:beforeSequence") ?? "0"
          );
          const older = await api.getChatSessionTranscriptPage(
            ${JSON.stringify(options.prepared.sessionId)},
            { beforeSequence, limit: 50 }
          );
          const trajectoryCursor = sessionStorage.getItem(
            "cd09:S09:trajectoryCursor"
          ) ?? "";
          const evidencePage = await api.getAgentRunTrajectoryPage(
            ${JSON.stringify(options.prepared.runId)},
            { cursor: trajectoryCursor, limit: 75 }
          );
          session = older?.session ?? null;
          const priorTrajectorySequence = Number(
            sessionStorage.getItem("cd09:S09:trajectoryLastSequence") ?? "0"
          );
          const trajectoryPagesDoNotOverlap =
            evidencePage.records.length > 0
            && (evidencePage.records[0]?.sequence ?? 0)
              > priorTrajectorySequence;
          semanticOk =
            Boolean(older)
            && older.session.messages.length > 0
            && older.session.messages.length <= 50
            && older.page.endSequence < beforeSequence
            && evidencePage.status === "complete"
            && evidencePage.sourceRevision === sessionStorage.getItem(
              "cd09:S09:trajectoryRevision"
            )
            && evidencePage.records.length === 75
            && trajectoryPagesDoNotOverlap;
          actionObservations = {
            olderMessageCount: older?.session.messages.length ?? -1,
            olderPageBounded: (older?.session.messages.length ?? 51) <= 50,
            pagesDoNotOverlap:
              Boolean(older) && older.page.endSequence < beforeSequence,
            olderTrajectoryCount: evidencePage.records.length,
            trajectoryPagesDoNotOverlap,
            trajectoryRevisionPinned:
              evidencePage.sourceRevision === sessionStorage.getItem(
                "cd09:S09:trajectoryRevision"
              )
          };
        } else {
          const streamEvents = [];
          const unsubscribe = api.onChatStreamEvent((event) => {
            if (event.requestId === "cd09-s09-stream-update") {
              streamEvents.push(event);
            }
          });
          const startedAt = performance.now();
          const update = await api.sendChatMessage({
            sessionId: ${JSON.stringify(options.prepared.sessionId)},
            requestId: "cd09-s09-stream-update",
            message: "Append one bounded long-session update."
          });
          unsubscribe();
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          );
          const tail = await api.getChatSessionTranscriptPage(
            ${JSON.stringify(options.prepared.sessionId)},
            { limit: 50 }
          );
          session = tail?.session ?? null;
          const renderDurationMs = performance.now() - startedAt;
          const renderedRows = document.querySelectorAll(
            ".chat-message, .conversation-disclosure [data-disclosure-id]"
          ).length;
          semanticOk =
            update.ok === true
            && streamEvents.length > 0
            && renderedRows > 0
            && renderedRows <= 160
            && renderDurationMs < 5_000
            && (tail?.session.messages.length ?? 51) <= 50;
          actionObservations = {
            streamUpdateSucceeded: update.ok === true,
            streamEventCount: streamEvents.length,
            renderedRowCount: renderedRows,
            renderedRowsBounded: renderedRows > 0 && renderedRows <= 160,
            renderDurationMs,
            postUpdateTailCount: tail?.session.messages.length ?? -1,
            performanceBounded: renderDurationMs < 5_000
          };
        }
      }
      if (${JSON.stringify(options.scenarioId)} === "S10-accessibility") {
        const disclosure = document.querySelector(
          '[data-testid="conversation-disclosure"]'
        );
        const firstToggle = disclosure?.querySelector(
          "button[aria-expanded]"
        );
        if (${options.index} === 0) {
          semanticOk =
            actionObservations.keyboardFocusRetained === true
            && actionObservations.expandedStateChanged === true
            && actionObservations.trustedKeyDownObserved === true
            && actionObservations.trustedClickObserved === true;
        } else if (${options.index} === 1) {
          const controlledRegionId =
            firstToggle?.getAttribute("aria-controls") ?? "";
          const controlledRegion = controlledRegionId
            ? document.getElementById(controlledRegionId)
            : null;
          const blockingAlert = disclosure?.querySelector(
            '[data-disclosure-id].is-blocking[role="alert"][aria-label]'
          );
          window.location.hash = "#runs";
          let selectedRun = null;
          let selectedEvidence = null;
          for (let attempt = 0; attempt < 50; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            selectedRun = document.querySelector(
              '.task-record-row.is-selected[aria-current="true"]'
            );
            selectedEvidence = document.querySelector(
              '.trajectory-event.is-selected[aria-current="true"]'
            );
            if (selectedRun && selectedEvidence) break;
          }
          semanticOk =
            disclosure?.getAttribute("aria-live") === "polite"
            && ["true", "false"].includes(
              firstToggle?.getAttribute("aria-expanded") ?? ""
            )
            && Boolean(controlledRegion)
            && Boolean(blockingAlert?.textContent?.trim())
            && Boolean(selectedRun)
            && Boolean(selectedEvidence);
          actionObservations = {
            politeLiveRegion:
              disclosure?.getAttribute("aria-live") === "polite",
            expandedStateExposed:
              ["true", "false"].includes(
                firstToggle?.getAttribute("aria-expanded") ?? ""
              ),
            controlRelationshipExposed:
              Boolean(controlledRegion),
            blockingStateExposed:
              Boolean(blockingAlert?.textContent?.trim()),
            selectedRunStateExposed: Boolean(selectedRun),
            selectedEvidenceStateExposed: Boolean(selectedEvidence)
          };
        } else {
          semanticOk =
            actionObservations.reducedMotionEnabled === true
            && actionObservations.nonessentialMotionSuppressed === true
            && actionObservations.stateChangedUnderReducedMotion === true
            && actionObservations.stateStillVisible === true
            && actionObservations.trustedReducedMotionClickObserved === true
            && Number(actionObservations.reducedAnimationDurationMs) <= 0.01
            && Number(actionObservations.reducedTransitionDurationMs) <= 0.01;
        }
      }
      if (${JSON.stringify(options.scenarioId)} === "S11-secret-safety") {
        const secretValues = [
          ${JSON.stringify(options.prepared.secretCanary ?? "missing-canary")},
          "acceptance-not-a-secret"
        ];
        const sensitiveLabels = [
          "api_key=",
          "authorization:"
        ];
        const forbiddenVisual = [...secretValues, ...sensitiveLabels];
        if (${options.index} === 0) {
          const streamEvents = [];
          const unsubscribe = api.onChatStreamEvent((event) => {
            if (event.requestId === "cd09-s11-secret-boundary") {
              streamEvents.push(event);
            }
          });
          const sent = await api.sendChatMessage({
            sessionId: ${JSON.stringify(options.prepared.sessionId)},
            requestId: "cd09-s11-secret-boundary",
            message: "Exercise the production secret-redaction boundary."
          });
          unsubscribe();
          session = await api.getChatSession(${
            JSON.stringify(options.prepared.sessionId)
          });
          const bodyText = document.body.innerText;
          const persisted = JSON.stringify(session);
          const toolBoundaryTraversed = (session?.activity?.statusEvents ?? [])
            .some(
              (event) =>
                event.requestId === "cd09-s11-secret-boundary"
                && event.state === "tool_result"
            );
          semanticOk =
            sent.ok === true
            && toolBoundaryTraversed
            && forbiddenVisual.every((value) => !bodyText.includes(value))
            && secretValues.every((value) => !persisted.includes(value))
            && (bodyText.includes("[redacted]") || persisted.includes("[redacted]"));
          actionObservations = {
            defaultSummarySafe:
              forbiddenVisual.every((value) => !bodyText.includes(value)),
            redactedMarkerVisible:
              bodyText.includes("[redacted]") || persisted.includes("[redacted]"),
            canaryInjected: sent.ok === true,
            toolBoundaryTraversed,
            canaryAbsentFromPersistence:
              !persisted.includes(secretValues[0]),
            configuredKeyAbsentFromPersistence:
              !persisted.includes(secretValues[1]),
            persistedSecretValuesAbsent:
              secretValues.every((value) => !persisted.includes(value)),
            actualRunId: sent.agentStatus?.runId ?? "missing"
          };
        } else if (${options.index} === 1) {
          const bodyText = document.body.innerText;
          const technicalDetails = document.querySelector(
            ".task-record-technical-details"
          );
          technicalDetails?.querySelector("summary")?.click();
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          );
          const technicalText = technicalDetails?.textContent ?? "";
          semanticOk =
            Boolean(technicalDetails?.open)
            && forbiddenVisual.every((value) => !technicalText.includes(value));
          actionObservations = {
            technicalEvidenceOpened: Boolean(technicalDetails?.open),
            technicalEvidenceRedacted:
              forbiddenVisual.every((value) => !technicalText.includes(value))
          };
        } else {
          const bodyText = document.body.innerText;
          const persisted = JSON.stringify({ session, trajectory });
          semanticOk =
            forbiddenVisual.every((value) => !bodyText.includes(value))
            && secretValues.every((value) => !persisted.includes(value));
          actionObservations = {
            visualArtifactsSafe:
              forbiddenVisual.every((value) => !bodyText.includes(value)),
            persistedArtifactsSafe:
              secretValues.every((value) => !persisted.includes(value))
          };
        }
      }
      if (${JSON.stringify(options.scenarioId)} === "S18-context-usage") {
        if (${options.index} === 0) {
          const page = await api.getChatSessionTranscriptPage(
            ${JSON.stringify(options.prepared.sessionId)},
            { limit: 50 }
          );
          const usage = session?.tokenUsage;
          sessionStorage.setItem(
            "cd09:S18:cumulativeBefore",
            String(usage?.totalTokens ?? 0)
          );
          semanticOk =
            (page?.page.totalMessages ?? 0) >= 18
            && usage?.totalTokens === 12000
            && (session?.context?.compactionCount ?? 0) === 0;
          actionObservations = {
            preCompressionMessages: page?.page.totalMessages ?? -1,
            cumulativeTokens: usage?.totalTokens ?? -1,
            preCompressionUncompacted:
              (session?.context?.compactionCount ?? 0) === 0
          };
        } else if (${options.index} === 1) {
          const compacted = await api.sendChatMessage({
            sessionId: ${JSON.stringify(options.prepared.sessionId)},
            requestId: "cd09-s18-trigger-compaction",
            message: "Trigger the production context compaction boundary."
          });
          session = await api.getChatSession(${
            JSON.stringify(options.prepared.sessionId)
          });
          const current = session?.context;
          semanticOk =
            compacted.ok === true
            && (current?.compactionCount ?? 0) > 0
            && (current?.lastCompaction?.afterTokens ?? Infinity)
              < (current?.lastCompaction?.beforeTokens ?? -1);
          actionObservations = {
            compactionRequestSucceeded: compacted.ok === true,
            compactionCount: current?.compactionCount ?? -1,
            beforeTokens: current?.lastCompaction?.beforeTokens ?? -1,
            afterTokens: current?.lastCompaction?.afterTokens ?? -1,
            tokensReduced:
              (current?.lastCompaction?.afterTokens ?? Infinity)
                < (current?.lastCompaction?.beforeTokens ?? -1)
          };
        } else {
          const usage = session?.tokenUsage;
          const cumulativeBefore = Number(
            sessionStorage.getItem("cd09:S18:cumulativeBefore") ?? "0"
          );
          semanticOk =
            (usage?.totalTokens ?? 0) >= cumulativeBefore
            && session?.context?.compactionCount !== undefined
            && session.context.compactionCount > 0;
          actionObservations = {
            durableCumulativeTokens: usage?.totalTokens ?? -1,
            cumulativeUsageMonotonic:
              (usage?.totalTokens ?? 0) >= cumulativeBefore,
            compactionSurvivedReload:
              (session?.context?.compactionCount ?? 0) > 0
          };
        }
      }
      if (${JSON.stringify(options.scenarioId)} === "S19-unknown-coverage") {
        const optional = trajectory.find(
          (entry) => entry.id === "trajectory-S19-unknown-coverage-optional"
        );
        const required = trajectory.find(
          (entry) => entry.id === "trajectory-S19-unknown-coverage-required"
        );
        const runButton = [...document.querySelectorAll(
          ".task-record-row"
        )].find((element) =>
          element.textContent?.includes("CD09 S19-unknown-coverage")
        );
        runButton?.click();
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
        const technicalDetails = document.querySelector(
          ".task-record-technical-details"
        );
        if (technicalDetails && !technicalDetails.open) {
          technicalDetails.querySelector("summary")?.click();
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          );
        }
        const bodyText = document.body.innerText;
        if (${options.index} === 0) {
          semanticOk =
            Boolean(optional)
            && bodyText.includes("其他证据");
          actionObservations = {
            optionalUnknownLoaded: Boolean(optional),
            genericFallbackVisible: bodyText.includes("其他证据")
          };
        } else if (${options.index} === 1) {
          const coverageAlert = document.querySelector(
            '[data-testid="unknown-trajectory-coverage"]'
          );
          semanticOk =
            Boolean(required)
            && required?.payload?.coverage === undefined
            && required?.payload?.resetRequired === undefined
            && coverageAlert?.getAttribute("data-coverage-state") === "degraded"
            && coverageAlert?.getAttribute("data-reset-required") === "true";
          actionObservations = {
            requiredUnknownLoaded: Boolean(required),
            coverageDegraded:
              coverageAlert?.getAttribute("data-coverage-state") === "degraded",
            resetRequired:
              coverageAlert?.getAttribute("data-reset-required") === "true"
          };
        } else {
          semanticOk = Boolean(optional && required);
          actionObservations = {
            optionalSurvivedReload: Boolean(optional),
            requiredSurvivedReload: Boolean(required)
          };
        }
      }
      if (${JSON.stringify(options.scenarioId)} === "S05-approval-attention") {
        const pending = await api.getPendingToolApprovals();
        const listedSession = sessions.find(
          (entry) => entry.id === ${JSON.stringify(options.prepared.sessionId)}
        );
        const sidebarBadgeText = sessionButton
          ?.querySelector(".goal-session-badge")
          ?.textContent
          ?.trim() ?? "missing";
        if (${options.index} < 2) {
          semanticOk =
            pending.length === 1 &&
            pending[0].id === ${
              JSON.stringify(options.approvalRuntime?.id ?? "")
            } &&
            pending[0].revision === ${
              JSON.stringify(options.approvalRuntime?.revision ?? 0)
            } &&
            listedSession?.work?.source === "chat" &&
            listedSession.work.status === "waiting_for_approval" &&
            sidebarBadgeText === "等待授权";
          actionObservations = {
            pendingCount: pending.length,
            approvalIdStable:
              pending[0]?.id === ${
                JSON.stringify(options.approvalRuntime?.id ?? "")
              },
            revisionStable:
              pending[0]?.revision === ${
                JSON.stringify(options.approvalRuntime?.revision ?? 0)
              },
            invocationIdStable:
              pending[0]?.causalRef?.toolInvocationId
                === "invocation-S05-approval-attention",
            listedWorkStatus:
              listedSession?.work?.status ?? "missing",
            sidebarBadgeText
          };
        } else {
          const first = await api.resolveToolApproval({
            id: ${JSON.stringify(options.approvalRuntime?.id ?? "")},
            approved: false,
            expectedRevision: ${
              JSON.stringify(options.approvalRuntime?.revision ?? 0)
            },
            decisionId: "cd09-s05-decision"
          });
          const duplicate = await api.resolveToolApproval({
            id: ${JSON.stringify(options.approvalRuntime?.id ?? "")},
            approved: true,
            expectedRevision: ${
              JSON.stringify(options.approvalRuntime?.revision ?? 0)
            },
            decisionId: "cd09-s05-duplicate"
          });
          semanticOk = first === true && duplicate === false;
          actionObservations = {
            firstDecisionApplied: first === true,
            duplicateDecisionRejected: duplicate === false
          };
        }
      }
      return {
        ok: Boolean(session) &&
          sessions.some((entry) => entry.id === session.id) &&
          runs.some((entry) => entry.id === ${
            JSON.stringify(options.prepared.runId)
          }) &&
          trajectory.length > 0 &&
          semanticOk &&
          (${JSON.stringify(routeForScenario(options.scenarioId, options.index))} !== "#chat" ||
            Boolean(chatSurface)),
        sessionLoaded: Boolean(session),
        sessionListed: sessions.some(
          (entry) => entry.id === ${JSON.stringify(options.prepared.sessionId)}
        ),
        runListed: runs.some(
          (entry) => entry.id === ${JSON.stringify(options.prepared.runId)}
        ),
        trajectoryLoaded: trajectory.length > 0,
        actionObservations,
      };
    })()
    `, true);
  } catch (error) {
    if (
      rendererPerformanceSession?.attachedByAcceptance
      && options.window.webContents.debugger.isAttached()
    ) {
      options.window.webContents.debugger.detach();
    }
    throw error;
  }
  if (rendererPerformanceSession) {
    const measurements = await finishRendererPerformanceSession(
      options.window,
      rendererPerformanceSession,
    );
    result.actionObservations = {
      ...(result.actionObservations ?? {}),
      ...measurements,
    };
    result.ok = result.ok === true && measurements.cpuHeapDomBounded === true;
  }
  if (!result?.ok) {
    const goalLedger = options.prepared.goalId
      ? (await options.container.agentGoalStore().readLedger(
          options.prepared.goalId,
        )).slice(-6).map((entry) => ({
          kind: entry.kind,
          summary: entry.summary,
        }))
      : undefined;
    throw new Error(
      `Scenario action ${options.scenarioId}/${options.index} failed: ${
        result?.reason ?? JSON.stringify({
          sessionLoaded: result?.sessionLoaded,
          sessionListed: result?.sessionListed,
          runListed: result?.runListed,
          trajectoryLoaded: result?.trajectoryLoaded,
          actionObservations: result?.actionObservations,
          ...(goalLedger ? { goalLedger } : {}),
        })
      }`,
    );
  }
  return {
    index: options.index,
    action:
      conversationDisclosureScenarioActions[options.scenarioId][options.index]!,
    executor: scenarioActionExecutor(
      options.scenarioId,
      options.index,
      shouldReload || guidedInputReloaded,
      Boolean(options.approvalRuntime),
    ),
    ok: true,
    evidenceIds: [
      ...options.prepared.evidenceIds,
      ...(options.approvalRuntime
        ? [`approval:${options.approvalRuntime.id}`]
        : []),
    ],
    observations: {
      sessionLoaded: result.sessionLoaded === true,
      sessionListed: result.sessionListed === true,
      runListed: result.runListed === true,
      trajectoryLoaded: result.trajectoryLoaded === true,
      ...(result.actionObservations ?? {}),
    },
  };
}

async function completeAcceptancePlanRuntime(
  prepared: PreparedScenario,
): Promise<void> {
  const runtime = prepared.planRuntime;
  if (!runtime || runtime.planId !== prepared.planId) {
    throw new Error("S07 production Plan runtime is unavailable.");
  }
  runtime.releaseReview();
  const result = await runtime.result;
  if (!result.ok) throw result.error;
  if (result.plan.id !== runtime.planId) {
    throw new Error("S07 production Plan runtime returned the wrong authority.");
  }
}

async function establishGuidedInputBeforeReload(
  window: BrowserWindow,
  sessionId: string,
): Promise<Record<string, string | number | boolean>> {
  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const api = window.buildingAgent;
      const workspace = await api.createTemporaryAgentWorkspace({
        name: "CD09 S14 guided input",
        cleanup: "delete_on_completion"
      });
      sessionStorage.setItem("cd09:S14:workspaceRoot", workspace.rootPath);
      const streamEvents = [];
      const unsubscribe = api.onChatStreamEvent((event) => {
        if (event.requestId === "cd09-s14-guided-request") {
          streamEvents.push(event);
        }
      });
      const initial = await api.sendChatMessage({
        sessionId: ${JSON.stringify(sessionId)},
        requestId: "cd09-s14-guided-request",
        message: "Organize the deterministic acceptance fixture.",
        selectedSkillName: "local-file-organizer",
        workspaceId: workspace.id
      });
      unsubscribe();
      const waiting = streamEvents.find(
        (event) => event.type === "waiting_for_input"
      );
      const inputRequestId = waiting?.inputRequest?.id ?? "";
      sessionStorage.setItem("cd09:S14:inputRequestId", inputRequestId);
      return {
        ok:
          initial.ok === false
          && initial.code === "SKILL_INPUT_REQUIRED"
          && Boolean(inputRequestId),
        observations: {
          guidedInputRequired:
            initial.ok === false
            && initial.code === "SKILL_INPUT_REQUIRED",
          inputRequestId: inputRequestId || "missing",
          waitingEventObserved: Boolean(waiting),
          workspaceBound: Boolean(workspace.id)
        }
      };
    })()
  `, true) as {
    ok?: boolean;
    observations?: Record<string, string | number | boolean>;
  };
  if (!result.ok || !result.observations) {
    throw new Error("Guided input was not durable before renderer reload.");
  }
  return result.observations;
}

function scenarioActionExecutor(
  scenarioId: ConversationDisclosureScenarioId,
  index: number,
  reloaded: boolean,
  approvalScenario: boolean,
): ConversationDisclosureScenarioActionReceipt["executor"] {
  if (reloaded) return "production_renderer_reload";
  if (
    index === 0
    || (approvalScenario && index === 2)
    || (scenarioId === "S02-inline-expansion" && index === 1)
    || (scenarioId === "S12-retry-attempt" && index === 1)
  ) {
    return "production_preload_ipc";
  }
  return "production_renderer_dom";
}

async function startApprovalScenario(
  coordinator: AcceptanceApprovalCoordinator,
  prepared: PreparedScenario,
  scenarioId:
    | "S05-approval-attention"
    | "S17-cancel-interruption",
): Promise<ApprovalRuntime> {
  const result = coordinator.requestUserApproval({
    taskId: `task-${scenarioId}`,
    taskName: "CD09 approval acceptance",
    request: {
      toolName: "file_list",
      args: { path: "[workspace]" },
    },
    deniedReason: "CD09 requires explicit confirmation.",
    risk: {
      level: "high",
      reason: "Deterministic acceptance confirmation.",
      category: "none",
      requiresConfirmation: true,
      affectedTargets: ["[workspace]"],
    },
    causalRef: {
      sessionId: prepared.sessionId,
      requestId: `request-${scenarioId}`,
      turnId: `turn-${scenarioId}`,
      trajectoryRunId: prepared.runId,
      toolInvocationId: `invocation-${scenarioId}`,
    },
    approvalId: `approval-${scenarioId}`,
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const pending = coordinator.pendingSnapshot();
    if (pending.length === 1) {
      return {
        id: pending[0]!.id,
        revision: pending[0]!.revision ?? 1,
        result,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Approval scenario did not publish a pending intent.");
}

async function inspectRenderer(
  window: BrowserWindow,
): Promise<{ productionPreload: boolean; sessionVisible: boolean }> {
  return window.webContents.executeJavaScript(`
    (() => ({
      productionPreload:
        typeof window.buildingAgent?.getRuntimeInfo === "function",
      sessionVisible:
        document.body.innerText.trim().length > 0
    }))()
  `, true);
}

async function waitForRenderer(window: BrowserWindow): Promise<void> {
  if (!window.webContents.isLoading()) return;
  await new Promise<void>((resolve, reject) => {
    window.webContents.once("did-finish-load", () => resolve());
    window.webContents.once(
      "did-fail-load",
      (_event, code, description) =>
        reject(new Error(`Renderer load failed (${code}): ${description}`)),
    );
  });
}

async function reloadRenderer(window: BrowserWindow): Promise<void> {
  const loaded = new Promise<void>((resolve, reject) => {
    window.webContents.once("did-finish-load", () => resolve());
    window.webContents.once(
      "did-fail-load",
      (_event, code, description) =>
        reject(new Error(`Renderer reload failed (${code}): ${description}`)),
    );
  });
  window.webContents.reloadIgnoringCache();
  await loaded;
}

async function waitForPaint(window: BrowserWindow): Promise<void> {
  window.show();
  await window.webContents.executeJavaScript(`
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)))
  `, true);
  await new Promise((resolve) => setTimeout(resolve, 150));
}

function routeForScenario(
  scenarioId: ConversationDisclosureScenarioId,
  actionIndex: number,
): string {
  if (scenarioId === "S08-scheduled-progress") {
    return actionIndex >= 1 ? "#runs" : "#scheduled-tasks";
  }
  if (
    scenarioId === "S03-evidence-handoff"
    || (scenarioId === "S04-failure-attention" && actionIndex > 0)
    || (scenarioId === "S11-secret-safety" && actionIndex > 0)
    || (scenarioId === "S13-legacy-coverage" && actionIndex === 1)
    || scenarioId === "S19-unknown-coverage"
  ) {
    return "#runs";
  }
  return "#chat";
}

function scenarioState(
  scenarioId: ConversationDisclosureScenarioId,
): "completed" | "failed" | "paused" | "canceled" {
  if (
    scenarioId === "S04-failure-attention"
    || scenarioId === "S12-retry-attempt"
  ) {
    return "failed";
  }
  if (
    scenarioId === "S05-approval-attention"
    ||
    scenarioId === "S06-pause-reload-recovery"
    || scenarioId === "S14-guided-input"
    || scenarioId === "S16-plan-confirmation"
  ) {
    return "paused";
  }
  if (scenarioId === "S17-cancel-interruption") return "canceled";
  return "completed";
}

function scenarioActivityState(
  scenarioId: ConversationDisclosureScenarioId,
): "completed" | "failed" | "paused" | "canceled" | "tool_invocation" | "waiting_for_input" {
  if (
    scenarioId === "S02-inline-expansion"
    || scenarioId === "S05-approval-attention"
  ) {
    return "tool_invocation";
  }
  return scenarioState(scenarioId);
}

function scenarioSummary(
  scenarioId: ConversationDisclosureScenarioId,
): string {
  if (scenarioId === "S04-failure-attention") {
    return "CD09 deterministic operation failed; review the sanitized recovery action.";
  }
  if (scenarioId === "S05-approval-attention") {
    return "CD09 approval is pending for one bounded read-only operation.";
  }
  if (scenarioId === "S06-pause-reload-recovery") {
    return "CD09 continuation is paused and can be resumed once.";
  }
  if (scenarioId === "S11-secret-safety") {
    return "CD09 restricted evidence is available as [redacted].";
  }
  return `CD09 ${scenarioId} production scenario state is persisted.`;
}

function scenarioOutputParts(
  scenarioId: ConversationDisclosureScenarioId,
  createdAt: string,
): ChatOutputPart[] {
  if (scenarioId === "S05-approval-attention") {
    return [{
      id: `part-${scenarioId}`,
      type: "approval_request",
      approvalId: `approval-${scenarioId}`,
      toolName: "file_list",
      riskLevel: "low",
      argsPreview: { path: "[workspace]" },
      createdAt,
    }];
  }
  if (
    scenarioId === "S04-failure-attention"
    || scenarioId === "S12-retry-attempt"
  ) {
    return [{
      id: `part-${scenarioId}`,
      type: "diagnostic",
      severity: "error",
      title: "Deterministic failure",
      message: "Sanitized failure with an explicit retry path.",
      createdAt,
    }];
  }
  return [{
    id: `part-${scenarioId}`,
    type: "ledger_event",
    status: scenarioLedgerStatus(scenarioId),
    title: `CD09 ${scenarioId}`,
    detail: scenarioSummary(scenarioId),
    createdAt,
  }];
}

function scenarioLedgerStatus(
  scenarioId: ConversationDisclosureScenarioId,
): "completed" | "failed" | "canceled" | "waiting" {
  const state = scenarioState(scenarioId);
  return state === "paused" ? "waiting" : state;
}

async function prepareLegacyConversationDisclosureScenario(
  container: AppContainer,
  mode: ConversationDisclosureAcceptanceEnabledMode,
  processEpoch: string,
): Promise<PreparedScenario> {
  const sessionId = "cd09-v391-session";
  const goalId = "cd09-v391-goal";
  const planId = "cd09-v391-plan";
  const runId = "cd09-v391-run";
  const trajectoryId = "cd09-v391-trajectory-event";
  if (
    !mode.legacyFixtureDigest
    || !mode.legacySourceCutId
    || !mode.legacyIntentionalAbsences?.length
  ) {
    throw new Error("S13 immutable fixture authority metadata is incomplete.");
  }

  const beforeDigest = await hashLegacyFixtureAuthority(mode.userDataPath);
  if (beforeDigest !== mode.legacyFixtureDigest) {
    throw new Error("S13 immutable multidomain fixture changed before product read.");
  }
  const [
    session,
    listedSessions,
    goal,
    sessionGoals,
    goalLedger,
    plan,
    sessionPlans,
    run,
    listedRuns,
    trajectory,
  ] = await Promise.all([
    container.chatSessionStore().get(sessionId),
    container.chatSessionStore().list(),
    container.agentGoalStore().get(goalId),
    container.agentGoalStore().listByChatSession(sessionId),
    container.agentGoalStore().readLedger(goalId),
    container.planStore().get(planId),
    container.planStore().listBySession(sessionId),
    container.agentRunStore().get(runId),
    container.agentRunStore().list({ limit: Number.MAX_SAFE_INTEGER }),
    container.agentTrajectoryStore().list(runId),
  ]);
  const assistantMessage = session?.messages.find(
    (message) => message.role === "assistant",
  );
  const trajectoryEvent = trajectory.find((event) => event.id === trajectoryId);
  const authorityLinkageValid = Boolean(
    session
    && goal
    && plan
    && run
    && trajectory.length === 1
    && trajectoryEvent
    && listedSessions.some((entry) => entry.id === sessionId)
    && sessionGoals.some((entry) => entry.id === goalId)
    && sessionPlans.some((entry) => entry.id === planId)
    && listedRuns.some((entry) => entry.id === runId)
    && session.goalIds?.includes(goalId)
    && assistantMessage?.executedRunId === runId
    && assistantMessage.goalId === goalId
    && goal.chatSessionId === sessionId
    && goal.activePlanRef?.planId === planId
    && goal.planHistory?.some((entry) => entry.planId === planId) === true
    && goal.milestones.some((milestone) =>
      milestone.id === "cd09-v391-milestone"
      && milestone.runIds.includes(runId)
    )
    && goalLedger.some((entry) => entry.evidenceRefs?.includes(runId))
    && plan.sessionId === sessionId
    && plan.goalId === goalId
    && run.runContext?.sessionId === sessionId
    && run.runContext.goalId === goalId
    && trajectoryEvent.runId === runId
    && trajectoryEvent.runContext?.sessionId === sessionId
    && trajectoryEvent.runContext.goalId === goalId
  );
  if (!authorityLinkageValid) {
    throw new Error("S13 v3.9.1 Chat/Goal/Plan/Run/Trajectory linkage is invalid.");
  }
  const afterDigest = await hashLegacyFixtureAuthority(mode.userDataPath);
  if (afterDigest !== beforeDigest) {
    throw new Error("S13 production readers mutated the immutable v3.9.1 fixture.");
  }
  return {
    sessionId,
    runId,
    goalId,
    planId,
    legacyFixtureDigest: afterDigest,
    legacySourceCutId: mode.legacySourceCutId,
    legacyIntentionalAbsenceCount: mode.legacyIntentionalAbsences.length,
    legacyAuthorityLinkageValid: true,
    legacyAuthorityRecordCount: 5,
    legacySourceNotMutated: true,
    evidenceIds: [
      sessionId,
      goalId,
      planId,
      runId,
      trajectoryId,
      ...goalLedger.map((_, index) => `goal-ledger:${goalId}:${index + 1}`),
      `source-cut:${mode.legacySourceCutId}`,
      `fixture:${afterDigest}`,
      `process:${processEpoch}`,
      ...(mode.phase === "restart" ? ["restart:persisted-authority"] : []),
    ],
  };
}

async function prepareRestartedApprovalInterruptionScenario(
  container: AppContainer,
  processEpoch: string,
): Promise<PreparedScenario> {
  const approvalId = "approval-S17-cancel-interruption";
  const approval = await container.conversationCausalStore().getApprovalIntent(
    approvalId,
  );
  const identity = approval?.causalRef.toolInvocationIdentity;
  const sessionId = approval?.causalRef.sessionId;
  const workspaceRunId = approval?.causalRef.workspaceRunId;
  if (
    approval?.state !== "interrupted"
    || approval.decision?.reasonCode !== "main_process_restarted"
    || !identity
    || !sessionId
    || !workspaceRunId
  ) {
    throw new Error(
      "S17 cold start did not recover exact interrupted approval authority.",
    );
  }
  const [session, trajectory, workspaceRun, workspaceEvents, causalRecord] =
    await Promise.all([
      container.chatSessionStore().get(sessionId),
      container.agentTrajectoryStore().list(identity.runId),
      container.workspaceRunStore().getRun(workspaceRunId),
      container.workspaceRunStore().listEvents(workspaceRunId),
      approval.causalRef.requestId
        ? container.conversationCausalStore().getRequest(
            approval.causalRef.requestId,
          )
        : Promise.resolve(null),
    ]);
  const trajectoryAborted = trajectory.some((event) =>
    event.payload.toolInvocationId === identity.id
    && event.payload.invocationStatus === "aborted"
    && event.payload.approvalId === approvalId
  );
  const workspaceAborted = workspaceRun?.status === "canceled"
    && workspaceEvents.some((event) =>
      event.type === "tool_invocation"
      && event.toolInvocationId === identity.id
      && event.invocationStatus === "aborted"
      && event.approvalId === approvalId
    );
  const chatAborted = Boolean(session?.activity?.statusEvents.some((event) =>
    event.toolInvocationId === identity.id
    && event.invocationStatus === "aborted"
    && event.approvalId === approvalId
  ));
  const causalAttemptInterrupted = Boolean(
    causalRecord?.attempts.some((attempt) => attempt.state === "interrupted"),
  );
  if (
    !session
    || !trajectoryAborted
    || !workspaceAborted
    || !chatAborted
    || !causalAttemptInterrupted
  ) {
    throw new Error(
      "S17 interrupted ToolInvocation did not reconcile across durable domains.",
    );
  }
  return {
    sessionId,
    runId: "cd09-run-S17-cancel-interruption",
    interruptedApprovalId: approvalId,
    interruptedToolInvocationId: identity.id,
    interruptedToolInvocationRunId: identity.runId,
    interruptedWorkspaceRunId: workspaceRunId,
    interruptedTrajectoryAborted: true,
    interruptedWorkspaceAborted: true,
    interruptedChatAborted: true,
    evidenceIds: [
      sessionId,
      approvalId,
      identity.id,
      identity.runId,
      workspaceRunId,
      `process:${processEpoch}`,
      "restart:approval-interrupted",
      "restart:tool-invocation-aborted",
      "restart:causal-attempt-interrupted",
    ],
  };
}

async function hashLegacyFixtureAuthority(userDataPath: string): Promise<string> {
  const records: string[] = [];
  for (const relativePath of legacyFixtureAuthorityFiles) {
    const absolutePath = path.join(userDataPath, relativePath);
    const identity = await lstat(absolutePath);
    if (
      !identity.isFile()
      || identity.isSymbolicLink()
      || identity.nlink !== 1
    ) {
      throw new Error(`S13 fixture authority is unsafe: ${relativePath}`);
    }
    const bytes = await readFile(absolutePath);
    const lineCount = bytes.length === 0
      ? 0
      : bytes.toString("utf8").split("\n").length - 1;
    records.push(
      `${relativePath}\0${sha256(bytes)}\0${bytes.length}\0${lineCount}\n`,
    );
  }
  return sha256(Buffer.from(records.join("")));
}

function hashCanonical(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function actionEvidenceRef(
  action: ConversationDisclosureScenarioActionReceipt,
): string {
  return `action:${action.index}:${hashCanonical(action.observations)}`;
}

function expectedRequirementActionIndex(
  scenarioId: ConversationDisclosureScenarioId,
  requirementIndex: number,
  actionCount: number,
): number {
  if (scenarioId === "S10-accessibility") {
    return [1, 0, 2][requirementIndex] ?? actionCount - 1;
  }
  if (scenarioId === "S08-scheduled-progress") {
    return [0, 1, 0][requirementIndex] ?? actionCount - 1;
  }
  return Math.min(requirementIndex, actionCount - 1);
}

function validateScenarioObservationValues(
  scenarioId: ConversationDisclosureScenarioId,
  actions: ConversationDisclosureScenarioActionReceipt[],
): boolean {
  const observation = (index: number) => actions[index]?.observations ?? {};
  const value = (index: number, key: string) => observation(index)[key];
  if (
    actions.some((action) =>
      Object.entries(action.observations).some(([key, entry]) =>
        typeof entry === "boolean"
          ? negativeObservationKeys.has(key) ? entry !== false : entry !== true
          : typeof entry === "number"
            ? !Number.isFinite(entry) || entry < 0
            : !entry || ["missing", "unexpected-success", "retry-failed"].includes(entry),
      ))
  ) {
    return false;
  }
  switch (scenarioId) {
    case "S01-default-narrative":
      return value(0, "toolCallsExecuted") === 1
        && value(1, "operationsExpanded") === "false";
    case "S02-inline-expansion":
      return value(1, "stableRowMatchCount") === 1
        && value(2, "groupExpanded") === "false";
    case "S05-approval-attention":
      return value(0, "pendingCount") === 1
        && value(1, "pendingCount") === 1;
    case "S06-pause-reload-recovery":
      return value(0, "checkpointStatus") === "paused"
        && value(2, "terminalRunStatus") === "succeeded";
    case "S07-plan-progress":
      return value(0, "planStatus") === "drafting"
        && Number(value(0, "stageCount")) >= 6
        && value(0, "generationStagePersisted") === true
        && value(0, "runningReviewPersisted") === true
        && Number(value(0, "productionModelCallCount")) === 2
        && value(1, "actionGate") === "blocked"
        && value(2, "authoritativePlanStatus") === "awaiting_input"
        && value(2, "reviewRejectedPersisted") === true
        && value(2, "qualityFailurePersisted") === true
        && Number(value(2, "productionModelCallCount")) === 2;
    case "S08-scheduled-progress":
      return Number(value(0, "streamEventCount")) > 0
        && Number(value(0, "fullSnapshotRefreshCount")) <= 1
        && Number(value(0, "fullSnapshotRefreshCount"))
          < Number(value(0, "streamEventCount"))
        && Number(value(1, "trajectoryEventCount")) > 0;
    case "S09-long-session":
      return Number(value(0, "tailMessageCount")) === 50
        && Number(value(0, "totalMessageCount")) >= 320
        && Number(value(0, "tailPayloadBytes")) > 50 * 1024
        && Number(value(0, "trajectoryPageCount")) === 75
        && Number(value(1, "olderMessageCount")) <= 50
        && Number(value(1, "olderTrajectoryCount")) === 75
        && value(1, "trajectoryPagesDoNotOverlap") === true
        && value(1, "trajectoryRevisionPinned") === true
        && Number(value(2, "streamEventCount")) > 0
        && Number(value(2, "renderedRowCount")) > 0
        && Number(value(2, "renderedRowCount")) <= 160
        && Number(value(2, "renderDurationMs")) < 5_000
        && value(2, "rendererMetricsAvailable") === true
        && Number(value(2, "cpuTaskDurationMs")) < 5_000
        && Number(value(2, "heapBeforeBytes")) > 0
        && Number(value(2, "heapAfterBytes")) > 0
        && Number(value(2, "heapGrowthBytes")) < 32 * 1024 * 1024
        && Number(value(2, "domNodeCount")) > 0
        && Number(value(2, "domNodeCount")) < 20_000
        && Number(value(2, "domNodeGrowth")) < 2_000;
    case "S10-accessibility":
      return value(1, "blockingStateExposed") === true
        && value(1, "selectedRunStateExposed") === true
        && value(1, "selectedEvidenceStateExposed") === true
        && Number(value(2, "reducedAnimationDurationMs")) <= 0.01
        && Number(value(2, "reducedTransitionDurationMs")) <= 0.01
        && value(2, "stateChangedUnderReducedMotion") === true;
    case "S13-legacy-coverage":
      return value(0, "disclosureMode") === "projected"
        && value(1, "disclosureMode") === "projected"
        && value(2, "disclosureMode") === "legacy"
        && value(0, "compatibilityIdStable") === true
        && value(0, "goalSummaryLinked") === true
        && Number(value(1, "availableTrajectoryCount")) === 1
        && value(1, "coveragePartial") === true
        && Number(value(1, "intentionalAbsenceCount")) > 0
        && Number(value(1, "authorityRecordCount")) === 5
        && value(1, "authorityLinkageValid") === true
        && value(2, "sourceNotMutated") === true
        && value(0, "fixtureDigest") === value(2, "fixtureDigest")
        && value(0, "sourceCutId") === value(2, "sourceCutId");
    case "S14-guided-input":
      return value(0, "inputRequestId") === value(0, "recoveredInputRequestId")
        && value(1, "responseCode") === "success";
    case "S15-goal-acceptance":
      return value(0, "reviewGateStatus") === "waiting_for_acceptance"
        && value(0, "branchSourceMatched") === true
        && value(1, "completedUnverifiedStatus") === true
        && value(1, "acceptanceCertificateAbsent") === true
        && value(1, "successNarrativeVisible") === false
        && value(2, "terminalStatus") === "achieved"
        && value(2, "acceptanceCertificatePersisted") === true
        && value(2, "unverifiedBranchRemainedTerminal") === true;
    case "S16-plan-confirmation":
      return value(0, "confirmationStatus") === "awaiting_confirmation"
        && value(0, "actionGate") === "ready";
    case "S17-cancel-interruption":
      return value(0, "canceledCode") === "CANCELED"
        && Number(value(1, "pendingApprovalCount")) === 1
        && value(1, "priorPrivilegeRecovered") === false
        && value(1, "waitingInvocationPersisted") === true
        && value(1, "invocationIdentityFrozen") === true
        && value(1, "approvalBoundToInvocation") === true
        && value(2, "coldStartPendingCount") === 0
        && value(2, "interruptedApprovalPersisted") === true
        && value(2, "trajectoryInvocationAborted") === true
        && value(2, "workspaceInvocationAborted") === true
        && value(2, "chatInvocationAborted") === true
        && value(2, "newAttemptSucceeded") === true
        && value(2, "distinctAttemptPersisted") === true
        && value(2, "projectionReloaded") === true
        && value(2, "listedWorkStatus") === "completed"
        && value(2, "sidebarBadgeText") === "已完成"
        && value(2, "recoveredSessionVisible") === true;
    case "S18-context-usage":
      return Number(value(0, "preCompressionMessages")) >= 18
        && Number(value(1, "compactionCount")) > 0
        && Number(value(1, "afterTokens")) < Number(value(1, "beforeTokens"))
        && Number(value(2, "durableCumulativeTokens"))
          >= Number(value(0, "cumulativeTokens"));
    default:
      return true;
  }
}

const negativeObservationKeys = new Set([
  "credentialMaterialVisible",
  "priorPrivilegeRecovered",
  "rejectedPartialPersisted",
  "successNarrativeVisible",
]);

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}
