import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
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
import type { AppContainer } from "./container";
import type { ConversationDisclosureAcceptanceEnabledMode } from "./conversationDisclosureAcceptanceMode";
import type { TrustedIpcInvocationObservation } from "./ipc";
import type {
  ToolUserApprovalRequest,
  ToolUserApprovalRequestOptions,
  ToolUserApprovalResult,
} from "./toolAuthorizationService";
import type { ToolApprovalRequestPayload } from "../shared/toolApproval";

type PreparedScenario = {
  sessionId: string;
  runId: string;
  scheduledTaskId?: string;
  goalId?: string;
  planId?: string;
  blockedPlanId?: string;
  evidenceIds: string[];
};

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
              ? "waiting_for_approval"
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
      scenarioId === "S09-long-session" ? 120 : 16;
    for (let index = 0; index < messageCount; index += 1) {
      await container.chatSessionStore().appendMessage({
        sessionId,
        requestId: `request-${scenarioId}-history-${index}`,
        turnId: `turn-${scenarioId}-history-${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        content:
          scenarioId === "S18-context-usage"
            ? `CD09 compaction history ${index} ${"context ".repeat(180)}`
            : `CD09 bounded history row ${index}`,
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
  let planId: string | undefined;
  let blockedPlanId: string | undefined;
  if (scenarioId === "S15-goal-acceptance") {
    goalId = "cd09-goal-S15-goal-acceptance";
    const criterion = {
      id: "criterion-cd09",
      description: "Verify one deterministic local result.",
      acceptanceChecks: [{
        id: "check-cd09",
        kind: "assertion" as const,
        description: "The local result is explicitly reviewed.",
        params: { expected: true },
        requiresEvidence: false,
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
        maxAttempts: 1,
        lastCode: "CD09_ACCEPTANCE_REQUIRES_USER",
        lastDetail: "Explicit user resolution is required.",
        evidenceFingerprint: "a".repeat(64),
        resumeFrom: "final_judge",
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await container.agentGoalStore().save(goal);
    await container.chatSessionStore().attachGoal(sessionId, {
      id: goal.id,
      description: goal.description,
      status: goal.status,
      updatedAt: goal.updatedAt,
    });
  }
  if (
    scenarioId === "S07-plan-progress"
    || scenarioId === "S16-plan-confirmation"
  ) {
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
      actionGate:
        scenarioId === "S16-plan-confirmation" ? "ready" : "blocked",
      gateReason:
        scenarioId === "S16-plan-confirmation"
          ? "Ready for explicit confirmation."
          : "Awaiting persisted review evidence.",
      markdown: "",
    };
    const planBase: PlanRecord = {
      id: planId,
      sessionId,
      workspaceRoot: process.cwd(),
      sourceMessage: artifact.objective,
      mode: "direct",
      status:
        scenarioId === "S16-plan-confirmation"
          ? "awaiting_confirmation"
          : "paused",
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
        status:
          scenarioId === "S07-plan-progress" ? "running" : "completed",
        evidenceRefs: [`trajectory-${scenarioId}`],
        startedAt: timestamp,
        ...(scenarioId === "S16-plan-confirmation"
          ? { completedAt: timestamp }
          : {}),
      }],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const projection = await container.planArtifactWriter().write(
      planBase,
      artifact,
    );
    await container.planStore().create({ ...planBase, projection });
    if (scenarioId === "S16-plan-confirmation") {
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
        coverage: "degraded",
        resetRequired: true,
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
    ...(planId ? { planId } : {}),
    ...(blockedPlanId ? { blockedPlanId } : {}),
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
  const approvalRuntime = (
    mode.scenarioId === "S05-approval-attention"
    || (
      mode.scenarioId === "S17-cancel-interruption"
      && mode.phase === "initial"
    )
  )
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
    actions.push(await executeScenarioAction({
      window,
      scenarioId: mode.scenarioId,
      index,
      prepared,
      approvalRuntime,
      phase: mode.phase,
    }));
    if (approvalRuntime && index === 1) {
      await waitForPaint(window);
      actionScreenshot = (await window.webContents.capturePage()).toPNG();
    }
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
  await mkdir(path.dirname(mode.screenshotPath), { recursive: true });
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
  await writeFile(mode.screenshotPath, screenshot, { flag: "wx" });
  const screenshotDigest = sha256(screenshot);
  const ipcInvocations = options.ipcInvocations();
  if (
    ipcInvocations.length === 0
    || ipcInvocations.some((entry, index) => entry.ordinal !== index + 1)
    || !ipcInvocations.some((entry) => entry.channel === "chatSessions:list")
    || !ipcInvocations.some((entry) => entry.channel === "chatSessions:get")
    || !ipcInvocations.some((entry) => entry.channel === "agentRuns:list")
    || !ipcInvocations.some(
      (entry) => entry.channel === "agentRuns:listTrajectory",
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
  await mkdir(path.dirname(mode.outputPath), { recursive: true });
  await writeFile(mode.outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: "wx",
  });
  return receipt;
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
      const sessionButton = [...document.querySelectorAll("button")].find(
        (element) => element.textContent?.includes("CD09")
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
      const sessionButton = [...document.querySelectorAll("button")].find(
        (element) => element.textContent?.includes("CD09")
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
        Math.max(...value.split(",").map((entry) => {
          const normalized = entry.trim();
          if (normalized.endsWith("ms")) {
            return Number.parseFloat(normalized);
          }
          if (normalized.endsWith("s")) {
            return Number.parseFloat(normalized) * 1000;
          }
          return Number.POSITIVE_INFINITY;
        }));
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
  const result = await options.window.webContents.executeJavaScript(`
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
      let session = await api.getChatSession(${
        JSON.stringify(options.prepared.sessionId)
      });
      const runs = await api.listAgentRuns();
      const trajectory = await api.listAgentRunTrajectory(${
        JSON.stringify(options.prepared.runId)
      });
      const scheduledTasks = await api.listScheduledTasks();
      let semanticOk = true;
      let actionObservations = ${
        JSON.stringify(preliminaryObservations)
      };
      const sessionButton = [...document.querySelectorAll("button")].find(
        (element) => element.textContent?.includes("CD09")
      );
      if (${JSON.stringify(routeForScenario(options.scenarioId, options.index))} === "#chat") {
        sessionButton?.click();
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
      }
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
          const pending = await api.getPendingToolApprovals();
          const expectedPending = ${
            JSON.stringify(options.phase === "initial" ? 1 : 0)
          };
          semanticOk = pending.length === expectedPending;
          actionObservations = {
            pendingApprovalCount: pending.length,
            priorPrivilegeRecovered: pending.length > 0
          };
        } else {
          session = await api.getChatSession(${
            JSON.stringify(options.prepared.sessionId)
          });
          const persisted = JSON.stringify(session);
          const pending = await api.getPendingToolApprovals();
          semanticOk = ${JSON.stringify(options.phase === "restart")}
            ? pending.length === 0
              && persisted.includes("canceled")
            : pending.length === 1;
          actionObservations = {
            coldStartPendingCount: pending.length,
            canceledAuthorityPersisted: persisted.includes("canceled"),
            explicitNewAttemptRequired: pending.length === 0
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
        semanticOk =
          disclosureMode === expectedMode
          && Boolean(session)
          && trajectory.length > 0;
        actionObservations = {
          disclosureMode,
          sessionReadable: Boolean(session),
          availableTrajectoryCount: trajectory.length,
          coveragePartial: trajectory.length === 1
        };
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
            plan?.status === "paused"
            && plan.planningStages?.some(
              (stage) =>
                stage.kind === "generation"
                && stage.status === "running"
            ) === true;
          actionObservations = {
            persistedPlanLoaded: Boolean(plan),
            planStatus: plan?.status ?? "missing",
            runningStagePersisted:
              plan?.planningStages?.some(
                (stage) => stage.status === "running"
              ) === true
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
            plan?.status === "paused"
            && plan?.actionGate === "blocked"
            && plan?.executionGoalId === undefined;
          actionObservations = {
            authoritativePlanStatus: plan?.status ?? "missing",
            blockedDecisionVisible: plan?.actionGate === "blocked",
            goalSemanticsUnchanged: plan?.executionGoalId === undefined
          };
        }
      }
      if (${JSON.stringify(options.scenarioId)} === "S15-goal-acceptance") {
        const goalId = ${JSON.stringify(options.prepared.goalId ?? "")};
        let goal = await api.getGoal(goalId);
        if (${options.index} === 0) {
          semanticOk =
            goal?.status === "waiting_for_acceptance"
            && goal.acceptanceState?.phase === "awaiting_user";
          actionObservations = {
            goalLoaded: Boolean(goal),
            reviewGateStatus: goal?.status ?? "missing",
            acceptancePhase:
              goal?.acceptanceState?.phase ?? "missing"
          };
        } else if (${options.index} === 1) {
          const completed = await api.markGoalCompletedUnverified(goalId);
          goal = await api.getGoal(goalId);
          semanticOk =
            completed.ok === true
            && goal?.status === "completed_unverified"
            && goal?.acceptanceCertificate === undefined;
          actionObservations = {
            manualCompletionApplied: completed.ok === true,
            completionMessage: completed.message ?? "none",
            completedUnverified:
              goal?.status === "completed_unverified",
            certifiedAsAchieved:
              goal?.status === "achieved"
              || Boolean(goal?.acceptanceCertificate)
          };
        } else {
          const review = await api.resolveGoalReview(
            goalId,
            { kind: "approve_continue" }
          );
          goal = await api.getGoal(goalId);
          semanticOk =
            review.ok === true
            && goal?.status === "completed_unverified"
            && !document.body.innerText.includes("目标已达成");
          actionObservations = {
            terminalReviewIdempotent: review.ok === true,
            terminalStatus: goal?.status ?? "missing",
            unverifiedNarrativeVisible:
              !document.body.innerText.includes("目标已达成")
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
          sessionStorage.setItem(
            "cd09:S09:beforeSequence",
            String(page?.page.startSequence ?? 0)
          );
          semanticOk =
            Boolean(page)
            && page.session.messages.length <= 50
            && page.page.hasMoreBefore === true;
          actionObservations = {
            tailMessageCount: page?.session.messages.length ?? -1,
            tailBounded: (page?.session.messages.length ?? 51) <= 50,
            hasOlderPage: page?.page.hasMoreBefore === true
          };
        } else if (${options.index} === 1) {
          const beforeSequence = Number(
            sessionStorage.getItem("cd09:S09:beforeSequence") ?? "0"
          );
          const older = await api.getChatSessionTranscriptPage(
            ${JSON.stringify(options.prepared.sessionId)},
            { beforeSequence, limit: 50 }
          );
          semanticOk =
            Boolean(older)
            && older.session.messages.length > 0
            && older.session.messages.length <= 50
            && older.page.endSequence < beforeSequence;
          actionObservations = {
            olderMessageCount: older?.session.messages.length ?? -1,
            olderPageBounded: (older?.session.messages.length ?? 51) <= 50,
            pagesDoNotOverlap:
              Boolean(older) && older.page.endSequence < beforeSequence
          };
        } else {
          const update = await api.sendChatMessage({
            sessionId: ${JSON.stringify(options.prepared.sessionId)},
            requestId: "cd09-s09-stream-update",
            message: "Append one bounded long-session update."
          });
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          );
          const renderedRows = document.querySelectorAll(
            ".chat-message, .conversation-disclosure [data-disclosure-id]"
          ).length;
          semanticOk = update.ok === true && renderedRows <= 160;
          actionObservations = {
            streamUpdateSucceeded: update.ok === true,
            renderedRowCount: renderedRows,
            renderedRowsBounded: renderedRows <= 160
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
        const bodyText = document.body.innerText;
        const persisted = JSON.stringify({ session, trajectory });
        const forbidden = [
          "acceptance-not-a-secret",
          "api_key=",
          "authorization:"
        ];
        if (${options.index} === 0) {
          semanticOk = forbidden.every((value) => !bodyText.includes(value));
          actionObservations = {
            defaultSummarySafe:
              forbidden.every((value) => !bodyText.includes(value)),
            redactedMarkerVisible: bodyText.includes("[redacted]")
          };
        } else if (${options.index} === 1) {
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
            && forbidden.every((value) => !technicalText.includes(value));
          actionObservations = {
            technicalEvidenceOpened: Boolean(technicalDetails?.open),
            technicalEvidenceRedacted:
              forbidden.every((value) => !technicalText.includes(value))
          };
        } else {
          semanticOk =
            forbidden.every(
              (value) =>
                !bodyText.includes(value)
                && !persisted.includes(value)
            );
          actionObservations = {
            visualArtifactsSafe:
              forbidden.every((value) => !bodyText.includes(value)),
            persistedArtifactsSafe:
              forbidden.every((value) => !persisted.includes(value))
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
          semanticOk =
            required?.payload?.coverage === "degraded"
            && required?.payload?.resetRequired === true;
          actionObservations = {
            requiredUnknownLoaded: Boolean(required),
            coverageDegraded:
              required?.payload?.coverage === "degraded",
            resetRequired: required?.payload?.resetRequired === true
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
        if (${options.index} < 2) {
          semanticOk =
            pending.length === 1 &&
            pending[0].id === ${
              JSON.stringify(options.approvalRuntime?.id ?? "")
            } &&
            pending[0].revision === ${
              JSON.stringify(options.approvalRuntime?.revision ?? 0)
            };
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
                === "invocation-S05-approval-attention"
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
            Boolean(sessionButton)),
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
  `, true) as {
    ok?: boolean;
    reason?: string;
    sessionLoaded?: boolean;
    sessionListed?: boolean;
    runListed?: boolean;
    trajectoryLoaded?: boolean;
    actionObservations?: Record<string, string | number | boolean>;
  };
  if (!result?.ok) {
    throw new Error(
      `Scenario action ${options.scenarioId}/${options.index} failed: ${
        result?.reason ?? JSON.stringify({
          sessionLoaded: result?.sessionLoaded,
          sessionListed: result?.sessionListed,
          runListed: result?.runListed,
          trajectoryLoaded: result?.trajectoryLoaded,
          actionObservations: result?.actionObservations,
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
    || scenarioId === "S19-unknown-coverage"
    || scenarioId === "S09-long-session"
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
      return value(0, "planStatus") === "paused"
        && value(1, "actionGate") === "blocked"
        && value(2, "authoritativePlanStatus") === "paused";
    case "S08-scheduled-progress":
      return Number(value(0, "streamEventCount")) > 0
        && Number(value(1, "trajectoryEventCount")) > 0;
    case "S09-long-session":
      return Number(value(0, "tailMessageCount")) <= 50
        && Number(value(1, "olderMessageCount")) <= 50
        && Number(value(2, "renderedRowCount")) <= 160;
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
        && value(2, "disclosureMode") === "legacy";
    case "S14-guided-input":
      return value(0, "inputRequestId") === value(0, "recoveredInputRequestId")
        && value(1, "responseCode") === "success";
    case "S15-goal-acceptance":
      return value(0, "reviewGateStatus") === "waiting_for_acceptance"
        && value(1, "completedUnverified") === true
        && value(2, "terminalStatus") === "completed_unverified";
    case "S16-plan-confirmation":
      return value(0, "confirmationStatus") === "awaiting_confirmation"
        && value(0, "actionGate") === "ready";
    case "S17-cancel-interruption":
      return value(0, "canceledCode") === "CANCELED"
        && value(1, "pendingApprovalCount") === 0
        && value(2, "coldStartPendingCount") === 0;
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
  "certifiedAsAchieved",
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
