import { createHash } from "node:crypto";

const expectedScenarioActions = Object.freeze({
  "S01-default-narrative": ["send_task", "observe_compact_completion"],
  "S02-inline-expansion": [
    "expand_group_and_item", "append_stream_update", "collapse_group",
  ],
  "S03-evidence-handoff": ["open_exact_evidence", "reload_and_reopen_evidence"],
  "S04-failure-attention": ["observe_failure", "open_recovery_evidence"],
  "S05-approval-attention": [
    "observe_pending_approval",
    "reload_pending_approval",
    "resolve_once_and_reject_duplicate",
  ],
  "S06-pause-reload-recovery": [
    "reload_paused_continuation",
    "inspect_paused_authority",
    "consume_continuation_once",
  ],
  "S07-plan-progress": [
    "observe_persisted_plan_progress",
    "reload_during_plan",
    "review_final_plan_decision",
  ],
  "S08-scheduled-progress": [
    "observe_scheduled_stream",
    "navigate_scheduled_to_runs",
    "verify_shared_run_identity",
  ],
  "S09-long-session": [
    "load_bounded_tail", "page_older_evidence", "measure_streaming_bounds",
  ],
  "S10-accessibility": [
    "keyboard_expand_and_navigate",
    "inspect_accessible_state",
    "enable_reduced_motion",
  ],
  "S11-secret-safety": [
    "observe_safe_default",
    "open_authorized_redacted_evidence",
    "scan_persisted_and_visual_artifacts",
  ],
  "S12-retry-attempt": [
    "observe_failed_partial_attempt", "execute_retry", "reload_accepted_attempt",
  ],
  "S13-legacy-coverage": [
    "open_projected_legacy_session",
    "inspect_partial_coverage",
    "restart_in_legacy_mode",
  ],
  "S14-guided-input": [
    "reload_pending_guided_input",
    "submit_one_guided_response",
    "settle_guided_continuation_once",
  ],
  "S15-goal-acceptance": [
    "verify_shared_preacceptance_source", "complete_unverified_branch",
    "certify_parallel_branch_and_reload",
  ],
  "S16-plan-confirmation": [
    "reload_awaiting_confirmation", "confirm_plan_once", "inspect_blocked_plan",
  ],
  "S17-cancel-interruption": [
    "cancel_active_turn",
    "restart_with_pending_approval",
    "inspect_cold_start_recovery",
  ],
  "S18-context-usage": [
    "observe_precompression_usage",
    "trigger_context_compaction",
    "reload_cumulative_usage",
  ],
  "S19-unknown-coverage": [
    "open_optional_unknown",
    "open_required_unknown",
    "reload_both_coverage_scopes",
  ],
});

const expectedObservationKeys = Object.freeze({
  "S01-default-narrative": [
    ["sendSucceeded", "acceptedAssistantPersisted", "answerDeltaObserved",
      "terminalObserved", "toolInvocationObserved", "toolResultObserved",
      "toolCallsExecuted"],
    ["disclosureVisible", "operationsExpanded", "acceptedNarrativeVisible",
      "privateReasoningHidden"],
  ],
  "S02-inline-expansion": [
    ["stableRowId", "groupExpanded", "rowExpanded"],
    ["updateSucceeded", "stableRowMatchCount", "rowExpansionRetained"],
    ["groupExpanded"],
  ],
  "S03-evidence-handoff": [
    ["runSelected", "selectedRunRow", "technicalDetailsOpen",
      "exactRunLoaded", "exactTrajectoryLoaded"],
    ["runSelected", "selectedRunRow", "technicalDetailsOpen",
      "exactRunLoaded", "exactTrajectoryLoaded"],
  ],
  "S04-failure-attention": [
    ["failureAttentionVisible", "failureNarrativeVisible",
      "successNarrativeVisible"],
    ["recoveryRunSelected", "technicalDetailsOpen",
      "sanitizedFailureVisible", "credentialMaterialVisible"],
  ],
  "S05-approval-attention": [
    ["pendingCount", "approvalIdStable", "revisionStable",
      "invocationIdStable"],
    ["pendingCount", "approvalIdStable", "revisionStable",
      "invocationIdStable"],
    ["firstDecisionApplied", "duplicateDecisionRejected"],
  ],
  "S06-pause-reload-recovery": [
    ["checkpointRecovered", "checkpointStatus", "chatSessionRecovered"],
    ["chatAndRunAgree", "evidenceCoverageAvailable"],
    ["continuationConsumed", "duplicateContinuationRejected",
      "terminalRunStatus"],
  ],
  "S07-plan-progress": [
    ["persistedPlanLoaded", "planStatus", "stageCount",
      "generationStagePersisted", "runningReviewPersisted",
      "productionModelCallCount"],
    ["revisionStable", "actionGate"],
    ["authoritativePlanStatus", "blockedDecisionVisible",
      "goalSemanticsUnchanged", "reviewRejectedPersisted",
      "qualityFailurePersisted", "productionModelCallCount"],
  ],
  "S08-scheduled-progress": [
    ["scheduledTaskFound", "streamEventCount", "actualRunId", "runError",
      "fullSnapshotRefreshCount", "streamRefreshBounded"],
    ["sharedRunIdentity", "runVisibleAcrossSurface",
      "trajectoryEventCount", "boundedTrajectory"],
    ["sharedRunIdentity", "runVisibleAcrossSurface",
      "trajectoryEventCount", "boundedTrajectory"],
  ],
  "S09-long-session": [
    ["tailMessageCount", "tailBounded", "totalMessageCount",
      "tailPayloadBytes", "hasOlderPage", "trajectoryPageCount",
      "trajectoryPageBounded", "trajectoryHasNextPage"],
    ["olderMessageCount", "olderPageBounded", "pagesDoNotOverlap",
      "olderTrajectoryCount", "trajectoryPagesDoNotOverlap",
      "trajectoryRevisionPinned"],
    ["streamUpdateSucceeded", "streamEventCount", "renderedRowCount",
      "renderedRowsBounded", "renderDurationMs", "postUpdateTailCount",
      "performanceBounded", "rendererMetricsAvailable",
      "cpuTaskDurationMs", "heapBeforeBytes", "heapAfterBytes",
      "heapGrowthBytes", "domNodeCount", "domNodeGrowth",
      "cpuHeapDomBounded"],
  ],
  "S10-accessibility": [
    [
      "keyboardFocusRetained",
      "expandedStateChanged",
      "trustedKeyDownObserved",
      "trustedClickObserved",
      "tabReachedDisclosureControl",
      "tabReachedDifferentDisclosureControl",
      "tabNavigationSteps",
      "trustedFocusedControlKeyDownObserved",
      "trustedFocusedControlClickObserved",
      "rowUpdateSucceeded",
      "focusSurvivedItemUpdate",
      "trustedEvidenceKeyDownObserved",
      "trustedEvidenceClickObserved",
      "evidenceNavigationActivated",
      "focusSurvivedEvidenceNavigation",
    ],
    [
      "politeLiveRegion",
      "expandedStateExposed",
      "controlRelationshipExposed",
      "blockingStateExposed",
      "selectedRunStateExposed",
      "selectedEvidenceStateExposed",
    ],
    [
      "reducedMotionEnabled",
      "reducedAnimationDurationMs",
      "reducedTransitionDurationMs",
      "nonessentialMotionSuppressed",
      "stateChangedUnderReducedMotion",
      "stateStillVisible",
      "trustedReducedMotionClickObserved",
    ],
  ],
  "S11-secret-safety": [
    ["defaultSummarySafe", "redactedMarkerVisible", "canaryInjected",
      "toolBoundaryTraversed", "canaryAbsentFromPersistence",
      "configuredKeyAbsentFromPersistence", "persistedSecretValuesAbsent",
      "actualRunId"],
    ["technicalEvidenceOpened", "technicalEvidenceRedacted"],
    ["visualArtifactsSafe", "persistedArtifactsSafe", "episodeExported",
      "episodeExportRunId", "episodeExportFileCount"],
  ],
  "S12-retry-attempt": [
    ["firstAttemptRejected", "rejectedPartialObserved",
      "failureTerminalObserved"],
    ["retrySucceeded", "acceptedReply"],
    ["acceptedAttemptPersisted", "rejectedPartialPersisted"],
  ],
  "S13-legacy-coverage": [
    ["disclosureMode", "sessionReadable", "goalSummaryLinked",
      "compatibilityIdStable", "authorityLinkageValid", "fixtureDigest",
      "sourceCutId", "sourceNotMutated"],
    ["disclosureMode", "runReadable", "trajectoryReadable", "goalReadable",
      "planReadable", "technicalEvidenceOpen", "availableTrajectoryCount",
      "coveragePartial", "intentionalAbsenceCount", "authorityRecordCount",
      "authorityLinkageValid", "fixtureDigest", "sourceCutId",
      "sourceNotMutated"],
    ["disclosureMode", "sessionReadable", "runReadable", "trajectoryReadable",
      "compatibilityIdStable", "authorityLinkageValid", "fixtureDigest",
      "sourceCutId", "sourceNotMutated"],
  ],
  "S14-guided-input": [
    ["guidedInputRequired", "inputRequestId", "waitingEventObserved",
      "workspaceBound", "reloadRecoveredPending", "recoveredInputRequestId"],
    ["responseAcceptedOnce", "responseCode", "duplicateResponseRejected"],
    ["continuationSettled", "staleResponseRejected"],
  ],
  "S15-goal-acceptance": [
    ["goalLoaded", "reviewGateStatus", "acceptancePhase",
      "branchSourceMatched"],
    ["manualCompletionApplied", "completedUnverifiedStatus",
      "acceptanceCertificateAbsent", "successNarrativeVisible"],
    ["certifiedBranchApplied", "terminalStatus",
      "acceptanceCertificatePersisted", "unverifiedBranchRemainedTerminal",
      "achievedNarrativeVisible"],
  ],
  "S16-plan-confirmation": [
    ["confirmationRecovered", "confirmationStatus", "actionGate"],
    ["firstConfirmationApplied", "duplicateConfirmationIdempotent",
      "executionGoalLinked"],
    ["blockedPlanLoaded", "blockedActionGate",
      "blockedConfirmationRejected"],
  ],
  "S17-cancel-interruption": [
    ["cancelAccepted", "canceledResult", "canceledCode"],
    ["pendingApprovalCount", "priorPrivilegeRecovered",
      "waitingInvocationPersisted", "invocationIdentityFrozen",
      "approvalBoundToInvocation"],
    ["coldStartPendingCount", "canceledAuthorityPersisted",
      "explicitNewAttemptRequired", "interruptedApprovalPersisted",
      "trajectoryInvocationAborted", "workspaceInvocationAborted",
      "chatInvocationAborted", "newAttemptSucceeded", "distinctAttemptPersisted",
      "projectionReloaded", "listedWorkStatus", "sidebarBadgeText",
      "recoveredSessionVisible"],
  ],
  "S18-context-usage": [
    ["preCompressionMessages", "cumulativeTokens",
      "preCompressionUncompacted"],
    ["compactionRequestSucceeded", "compactionCount", "beforeTokens",
      "afterTokens", "tokensReduced"],
    ["durableCumulativeTokens", "cumulativeUsageMonotonic",
      "compactionSurvivedReload"],
  ],
  "S19-unknown-coverage": [
    ["optionalUnknownLoaded", "genericFallbackVisible"],
    ["requiredUnknownLoaded", "coverageDegraded", "resetRequired"],
    ["optionalSurvivedReload", "requiredSurvivedReload"],
  ],
});

export function validateProductionScenarioReceipt(
  receipt,
  scenario,
  options = {},
) {
  const errors = [];
  const requiresProcessRestart = [
    "S13-legacy-coverage",
    "S17-cancel-interruption",
  ].includes(scenario?.id) && options.partialProcess !== true;
  const digestInput = Object.fromEntries(
    Object.entries(receipt ?? {}).filter(([key]) => key !== "digest"),
  );
  const expectedKeys = [
    "schemaVersion",
    "kind",
    "scenarioId",
    "scenarioDigest",
    "executionId",
    "processEpochs",
    "attemptNonces",
    "productionMain",
    "productionPreload",
    "demoDataUsed",
    "expected",
    "evidenceRequirements",
    "actions",
    "requirements",
    "ipcInvocations",
    "screenshotDigests",
    "status",
    "digest",
  ].sort();
  if (
    JSON.stringify(Object.keys(receipt ?? {}).sort())
    !== JSON.stringify(expectedKeys)
  ) {
    errors.push("receipt schema changed");
  }
  if (
    receipt?.schemaVersion !== 1
    || receipt?.kind !== "conversation-disclosure-production-scenario"
    || receipt?.scenarioId !== scenario?.id
    || receipt?.scenarioDigest !== hashCanonical(scenario)
    || receipt?.productionMain !== true
    || receipt?.productionPreload !== true
    || receipt?.demoDataUsed !== false
    || JSON.stringify(receipt?.expected) !== JSON.stringify(scenario?.expected)
    || JSON.stringify(receipt?.evidenceRequirements)
      !== JSON.stringify(scenario?.evidenceRequirements)
    || receipt?.status !== "passed"
    || receipt?.digest !== hashCanonical(digestInput)
    || !/^[0-9a-f-]{36}$/.test(receipt?.executionId ?? "")
  ) {
    errors.push("receipt identity or digest is invalid");
  }
  if (
    !Array.isArray(receipt?.processEpochs)
    || receipt.processEpochs.length < (requiresProcessRestart ? 2 : 1)
    || new Set(receipt.processEpochs).size !== receipt.processEpochs.length
    || receipt.processEpochs.some(
      (entry) => typeof entry !== "string" || entry.length < 16,
    )
  ) {
    errors.push("process epochs are invalid");
  }
  if (
    !Array.isArray(receipt?.attemptNonces)
    || receipt.attemptNonces.length !== receipt.processEpochs?.length
    || new Set(receipt.attemptNonces).size !== receipt.attemptNonces.length
    || receipt.attemptNonces.some(
      (entry) => !/^[0-9a-f-]{36}$/.test(entry ?? ""),
    )
  ) {
    errors.push("attempt nonces are invalid");
  }
  if (
    !Array.isArray(receipt?.actions)
    || receipt.actions.length !== scenario?.actions?.length
    || receipt.actions.some(
      (entry, index) =>
        JSON.stringify(Object.keys(entry ?? {}).sort())
          !== JSON.stringify([
            "action",
            "evidenceIds",
            "executor",
            "index",
            "observations",
            "ok",
          ])
        || entry.index !== index
        || entry.action !== expectedScenarioActions[scenario.id]?.[index]
        || entry.ok !== true
        || !Array.isArray(entry.evidenceIds)
        || entry.evidenceIds.length === 0
        || !entry.observations
        || typeof entry.observations !== "object"
        || Array.isArray(entry.observations)
        || Object.keys(entry.observations).length === 0
        || Object.values(entry.observations).some(
          (value) =>
            typeof value !== "string"
            && typeof value !== "number"
            && typeof value !== "boolean",
        ),
    )
    || (
      options.partialProcess !== true
      && !validateActionObservations(receipt?.actions, scenario?.id)
    )
  ) {
    errors.push("declared actions were not executed exactly once");
  }
  const expectedExecutors = {
    "S05-approval-attention": [
      "production_preload_ipc",
      "production_renderer_reload",
      "production_preload_ipc",
    ],
    "S13-legacy-coverage": [
      "production_preload_ipc",
      "production_renderer_dom",
      "production_restart",
    ],
    "S14-guided-input": [
      "production_renderer_reload",
      "production_renderer_dom",
      "production_renderer_reload",
    ],
    "S17-cancel-interruption": [
      "production_preload_ipc",
      "production_restart",
      "production_renderer_reload",
    ],
  }[scenario?.id];
  if (
    options.partialProcess !== true
    && expectedExecutors
    && receipt.actions.some(
      (entry, index) => entry.executor !== expectedExecutors[index],
    )
  ) {
    errors.push("scenario action executors do not match the compiled workflow");
  }
  if (
    !Array.isArray(receipt?.requirements)
    || receipt.requirements.length !== scenario?.expected?.length
    || receipt.requirements.some(
      (entry, index) =>
        JSON.stringify(Object.keys(entry ?? {}).sort())
          !== JSON.stringify([
            "evidenceIds",
            "index",
            "ok",
            "requirement",
          ])
        || entry.index !== index
        || entry.requirement !== scenario.expected[index]
        || entry.ok !== true
        || !Array.isArray(entry.evidenceIds)
        || entry.evidenceIds.length < 2
        || entry.evidenceIds[0] !== actionEvidenceRef(
          receipt.actions[expectedRequirementActionIndex(
            scenario.id,
            index,
            receipt.actions.length,
          )],
        )
        || entry.evidenceIds[1] !== `screenshot:${
          receipt.screenshotDigests[
            options.partialProcess === true
              ? 0
              : expectedScreenshotIndex(scenario.id, index)
          ]
        }`,
    )
  ) {
    errors.push("scenario requirements lack direct evidence");
  }
  if (
    !Array.isArray(receipt?.ipcInvocations)
    || receipt.ipcInvocations.length < 4
    || receipt.ipcInvocations.some(
      (entry, index) =>
        JSON.stringify(Object.keys(entry ?? {}).sort())
          !== JSON.stringify(["channel", "ok", "ordinal"])
        || entry.ordinal !== index + 1
        || typeof entry.channel !== "string"
        || entry.ok !== true,
    )
    || !receipt.ipcInvocations.some(
      (entry) => entry.channel === "chatSessions:list",
    )
    || !receipt.ipcInvocations.some((entry) =>
      entry.channel === (
        scenario?.id === "S09-long-session"
          ? "chatSessions:getTranscriptPage"
          : "chatSessions:get"
      )
    )
    || !receipt.ipcInvocations.some(
      (entry) => entry.channel === "agentRuns:list",
    )
    || !receipt.ipcInvocations.some((entry) =>
      entry.channel === (
        scenario?.id === "S09-long-session"
          ? "agentRuns:getTrajectoryPage"
          : "agentRuns:listTrajectory"
      )
    )
  ) {
    errors.push("production preload IPC trace is incomplete");
  }
  if (
    scenario?.id === "S05-approval-attention"
    && (
      receipt.ipcInvocations.filter(
        (entry) => entry.channel === "toolApproval:listPending",
      ).length < 2
      || receipt.ipcInvocations.filter(
        (entry) => entry.channel === "toolApproval:resolve",
      ).length !== 2
    )
  ) {
    errors.push("approval workflow did not execute through production IPC");
  }
  if (
    !Array.isArray(receipt?.screenshotDigests)
    || receipt.screenshotDigests.length < (requiresProcessRestart ? 2 : 1)
    || receipt.screenshotDigests.some(
      (digest) => !/^sha256:[0-9a-f]{64}$/.test(digest ?? ""),
    )
  ) {
    errors.push("scenario screenshot evidence is invalid");
  }
  return {
    ok: errors.length === 0,
    errors,
    digest: receipt?.digest,
  };
}

function validateActionObservations(actions, scenarioId) {
  if (!Array.isArray(actions)) return false;
  const requiredByAction = expectedObservationKeys[scenarioId];
  if (!requiredByAction || requiredByAction.length !== actions.length) {
    return false;
  }
  const structurallyValid = actions.every((action, index) => {
    const observations = action?.observations;
    if (!observations || typeof observations !== "object") return false;
    if (!requiredByAction[index].every((key) =>
      Object.hasOwn(observations, key))) {
      return false;
    }
    return Object.entries(observations).every(([key, value]) => {
      if (typeof value === "boolean") {
        return negativeObservationKeys.has(key) ? value === false : value === true;
      }
      if (typeof value === "number") {
        return Number.isFinite(value) && value >= 0;
      }
      return (
        typeof value === "string"
        && value.length > 0
        && !["missing", "unexpected-success", "retry-failed"].includes(value)
      );
    });
  });
  if (!structurallyValid) return false;
  const value = (index, key) => actions[index]?.observations?.[key];
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
        && value(0, "stageCount") >= 6
        && value(0, "generationStagePersisted") === true
        && value(0, "runningReviewPersisted") === true
        && value(0, "productionModelCallCount") === 2
        && value(1, "actionGate") === "blocked"
        && value(2, "authoritativePlanStatus") === "awaiting_input"
        && value(2, "reviewRejectedPersisted") === true
        && value(2, "qualityFailurePersisted") === true
        && value(2, "productionModelCallCount") === 2;
    case "S08-scheduled-progress":
      return value(0, "streamEventCount") > 0
        && value(0, "fullSnapshotRefreshCount") <= 1
        && value(0, "fullSnapshotRefreshCount") < value(0, "streamEventCount")
        && value(1, "trajectoryEventCount") > 0;
    case "S09-long-session":
      return value(0, "tailMessageCount") === 50
        && value(0, "totalMessageCount") >= 320
        && value(0, "tailPayloadBytes") > 50 * 1024
        && value(0, "trajectoryPageCount") === 75
        && value(1, "olderMessageCount") <= 50
        && value(1, "olderTrajectoryCount") === 75
        && value(1, "trajectoryPagesDoNotOverlap") === true
        && value(1, "trajectoryRevisionPinned") === true
        && value(2, "streamEventCount") > 0
        && value(2, "renderedRowCount") > 0
        && value(2, "renderedRowCount") <= 160
        && value(2, "renderDurationMs") < 5_000
        && value(2, "rendererMetricsAvailable") === true
        && value(2, "cpuTaskDurationMs") < 5_000
        && value(2, "heapBeforeBytes") > 0
        && value(2, "heapAfterBytes") > 0
        && value(2, "heapGrowthBytes") < 32 * 1024 * 1024
        && value(2, "domNodeCount") > 0
        && value(2, "domNodeCount") < 20_000
        && value(2, "domNodeGrowth") < 2_000;
    case "S10-accessibility":
      return value(1, "blockingStateExposed") === true
        && value(1, "selectedRunStateExposed") === true
        && value(1, "selectedEvidenceStateExposed") === true
        && value(2, "reducedAnimationDurationMs") <= 0.01
        && value(2, "reducedTransitionDurationMs") <= 0.01
        && value(2, "stateChangedUnderReducedMotion") === true;
    case "S13-legacy-coverage":
      return value(0, "disclosureMode") === "projected"
        && value(1, "disclosureMode") === "projected"
        && value(2, "disclosureMode") === "legacy"
        && value(0, "compatibilityIdStable") === true
        && value(0, "goalSummaryLinked") === true
        && value(1, "availableTrajectoryCount") === 1
        && value(1, "coveragePartial") === true
        && value(1, "intentionalAbsenceCount") > 0
        && value(1, "authorityRecordCount") === 5
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
        && value(1, "pendingApprovalCount") === 1
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
      return value(0, "preCompressionMessages") >= 18
        && value(1, "compactionCount") > 0
        && value(1, "afterTokens") < value(1, "beforeTokens")
        && value(2, "durableCumulativeTokens") >= value(0, "cumulativeTokens");
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

export function hashCanonical(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function actionEvidenceRef(action) {
  return `action:${action.index}:${hashCanonical(action.observations)}`;
}

function expectedRequirementActionIndex(
  scenarioId,
  requirementIndex,
  actionCount,
) {
  if (scenarioId === "S10-accessibility") {
    return [1, 0, 2][requirementIndex] ?? actionCount - 1;
  }
  if (scenarioId === "S08-scheduled-progress") {
    return [0, 1, 0][requirementIndex] ?? actionCount - 1;
  }
  return Math.min(requirementIndex, actionCount - 1);
}

function expectedScreenshotIndex(scenarioId, requirementIndex) {
  if (scenarioId === "S13-legacy-coverage") {
    return requirementIndex < 2 ? 1 : 0;
  }
  if (scenarioId === "S17-cancel-interruption") {
    return requirementIndex === 0 ? 1 : 0;
  }
  return 0;
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}
