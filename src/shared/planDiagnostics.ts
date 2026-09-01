import type {
  DebateCritique,
  DebateRound,
  DebateRoundKind,
  PlanArtifact,
  PlanMilestone,
  PlanProposal,
  PlanQualityIssue,
  PlanQualityReport,
  PlanRecord,
  PlanReviewIssue,
  PlanRisk,
  PlanningStageRecord,
  PlanningStageKind,
  RevisedPlanProposal,
} from "./planMode";
import type { AcceptanceCheck } from "./agentGoal";
import {
  canonicalizeGoalContract,
  type GoalContractIssue,
  type GoalContractRef,
  type GoalContractSnapshot,
  type GoalPlanRef,
  type GoalPlanTrigger,
  type PlanCriterionBinding,
} from "./goalPlanContract";
import type { ResolvedModelBinding } from "./modelSettings";
import { createPublicSkillSnapshot } from "./skills";
import { sha256Hex } from "./sha256";

const contentFreeFailurePattern =
  /^response omitted; contentLength=\d{1,12}; contentSha256=[a-f0-9]{16}$/;

const planQualityIssueCodes = new Set<PlanQualityIssue["code"]>([
  "INVALID_SCHEMA",
  "INVALID_DAG",
  "UNKNOWN_SKILL",
  "SKILL_INPUT_MISSING",
  "SKILL_INPUT_INVALID",
  "UNKNOWN_TOOL",
  "INVALID_ACCEPTANCE_CHECK",
  "MISSING_EVIDENCE",
  "INSUFFICIENT_DETERMINISTIC_ACCEPTANCE",
  "UNRESOLVED_AMBIGUITY",
  "UNMITIGATED_CRITICAL_RISK",
  "MODEL_REVIEW_REJECTED",
  "GOAL_CONTRACT_DRIFT",
  "GOAL_CRITERION_UNCOVERED",
  "GOAL_CONTRACT_BLOCKED",
  "ILLEGAL_CAPABILITY",
]);

export function classifyPlanReplayReadFailure(
  error: unknown,
): "invalid_json" | "plan_file_unavailable" {
  return error instanceof SyntaxError
    ? "invalid_json"
    : "plan_file_unavailable";
}

export function sanitizePlanReviewIssue(
  issue: PlanReviewIssue,
): PlanReviewIssue {
  const code = "MODEL_REVIEW_ISSUE";
  const severity = ["low", "medium", "high", "critical"].includes(
    issue.severity,
  )
    ? issue.severity
    : "high";
  return {
    code,
    severity,
    message: `模型审查报告了 ${code}；原始说明未保存。`,
    repairable: issue.repairable === true,
    repairInstruction: issue.repairable
      ? `根据 ${code} 重新检查并修复计划。`
      : "",
  };
}

export function sanitizePlanRecordDiagnostics(plan: PlanRecord): PlanRecord {
  const hasReviewDiagnostics = (plan.planningStages ?? []).some(
    (stage) => (stage.reviewIssues?.length ?? 0) > 0,
  );
  const qualityReport = plan.qualityReport
    ? sanitizeQualityReport(plan.qualityReport)
    : undefined;
  const finalArtifact = plan.finalArtifact
      ? sanitizePlanArtifact(plan.finalArtifact, {
        hasReviewDiagnostics,
        qualityBlocked: Boolean(
          qualityReport && qualityReport.status !== "ready",
        ),
      })
    : undefined;
  const goalContractSnapshot = plan.goalContractSnapshot
    ? sanitizeGoalContractSnapshot(plan.goalContractSnapshot)
    : undefined;
  const goalContractRef = plan.goalContractRef
    ? goalContractSnapshot
      ? createSanitizedGoalContractRef(goalContractSnapshot)
      : sanitizeGoalContractRef(plan.goalContractRef)
    : undefined;

  // This is deliberately an exact DTO reconstruction, not a spread-and-patch
  // sanitizer. Legacy JSON and SQLite payloads are untrusted at runtime even
  // when TypeScript says PlanRecord; unknown diagnostic fields must not survive
  // persistence, IPC, or projection rendering at any nesting level we own.
  return {
    ...(plan.schemaVersion !== undefined
      ? { schemaVersion: plan.schemaVersion }
      : {}),
    id: plan.id,
    sessionId: plan.sessionId,
    ...(plan.workspaceId !== undefined ? { workspaceId: plan.workspaceId } : {}),
    ...(plan.workspaceRoot !== undefined
      ? { workspaceRoot: plan.workspaceRoot }
      : {}),
    sourceMessage: plan.sourceMessage,
    ...(plan.baseSourceMessage !== undefined
      ? { baseSourceMessage: plan.baseSourceMessage }
      : {}),
    ...(plan.clarifications !== undefined
      ? { clarifications: [...plan.clarifications] }
      : {}),
    ...(plan.requestedSkillName !== undefined
      ? { requestedSkillName: plan.requestedSkillName }
      : {}),
    ...(plan.selectedSkill !== undefined
      ? { selectedSkill: createPublicSkillSnapshot(plan.selectedSkill) }
      : {}),
    mode: plan.mode,
    ...(plan.autonomyMode !== undefined
      ? { autonomyMode: plan.autonomyMode }
      : {}),
    status: plan.status,
    actionGate: plan.actionGate,
    revision: plan.revision,
    ...(plan.taskProfile !== undefined
      ? { taskProfile: sanitizeTaskProfile(plan.taskProfile) }
      : {}),
    ...(plan.planningBrief !== undefined
      ? { planningBrief: sanitizePlanningBrief(plan.planningBrief) }
      : {}),
    ...(plan.planningStages
      ? {
          planningStages: plan.planningStages.map(sanitizePlanningStage),
        }
      : {}),
    ...(plan.skillDecision !== undefined
      ? { skillDecision: sanitizeSkillDecision(plan.skillDecision) }
      : {}),
    ...(plan.selectedSkillInputValues !== undefined
      ? { selectedSkillInputValues: { ...plan.selectedSkillInputValues } }
      : {}),
    ...(qualityReport ? { qualityReport } : {}),
    taskContract: sanitizeTaskContract(plan.taskContract),
    ...(plan.purpose !== undefined ? { purpose: plan.purpose } : {}),
    ...(goalContractSnapshot !== undefined
      ? { goalContractSnapshot }
      : {}),
    ...(goalContractRef !== undefined
      ? { goalContractRef }
      : {}),
    ...(plan.goalId !== undefined ? { goalId: plan.goalId } : {}),
    ...(plan.parentPlanRef !== undefined
      ? { parentPlanRef: sanitizeGoalPlanRef(plan.parentPlanRef) }
      : {}),
    ...(plan.goalPlanVersion !== undefined
      ? { goalPlanVersion: plan.goalPlanVersion }
      : {}),
    ...(plan.trigger !== undefined
      ? { trigger: sanitizeGoalPlanTrigger(plan.trigger) }
      : {}),
    ...(plan.criterionBindings !== undefined
      ? {
          criterionBindings: plan.criterionBindings.map(
            sanitizePlanCriterionBinding,
          ),
        }
      : {}),
    ...(plan.goalContractIssues !== undefined
      ? { goalContractIssues: sanitizeGoalContractIssues(plan.goalContractIssues) }
      : {}),
    ...(plan.supersededByPlanId !== undefined
      ? { supersededByPlanId: plan.supersededByPlanId }
      : {}),
    ...(plan.supersededAt !== undefined
      ? { supersededAt: plan.supersededAt }
      : {}),
    evidence: (plan.evidence ?? []).map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      summary: item.summary,
      ...(item.sourceRef !== undefined ? { sourceRef: item.sourceRef } : {}),
      ...(item.sha256 !== undefined ? { sha256: item.sha256 } : {}),
      ...(item.sourceHashes !== undefined
        ? {
            sourceHashes: item.sourceHashes.map((source) => ({
              sourceRef: source.sourceRef,
              sha256: source.sha256,
            })),
          }
        : {}),
    })),
    requestedModelAssignments: sanitizeModelAssignments(
      plan.requestedModelAssignments,
    ),
    frozenModelAssignments: sanitizeFrozenModelAssignments(
      plan.frozenModelAssignments,
    ),
    rounds: (plan.rounds ?? []).map((round) => sanitizeRound(round, {
      hasReviewDiagnostics,
      qualityBlocked: Boolean(
        qualityReport && qualityReport.status !== "ready",
      ),
    })),
    ...(finalArtifact ? { finalArtifact } : {}),
    ...(plan.projection !== undefined
      ? {
          projection: {
            path: plan.projection.path,
            sha256: plan.projection.sha256,
            writtenAt: plan.projection.writtenAt,
          },
        }
      : {}),
    ...(plan.projectionIntent !== undefined
      ? {
          projectionIntent: {
            kind: plan.projectionIntent.kind,
            expectedSha256: plan.projectionIntent.expectedSha256,
            nextPath: plan.projectionIntent.nextPath,
            nextSha256: plan.projectionIntent.nextSha256,
            targetStatus: plan.projectionIntent.targetStatus,
            targetActionGate: plan.projectionIntent.targetActionGate,
            preparedAt: plan.projectionIntent.preparedAt,
          },
        }
      : {}),
    ...(plan.executionGoalId !== undefined
      ? { executionGoalId: plan.executionGoalId }
      : {}),
    ...(plan.executionRunId !== undefined
      ? { executionRunId: plan.executionRunId }
      : {}),
    ...(plan.confirmedRevision !== undefined
      ? { confirmedRevision: plan.confirmedRevision }
      : {}),
    ...(plan.confirmedAt !== undefined
      ? { confirmedAt: plan.confirmedAt }
      : {}),
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

function sanitizeRound(
  round: DebateRound,
  options: { hasReviewDiagnostics: boolean; qualityBlocked: boolean },
): DebateRound {
  return {
    id: round.id,
    kind: round.kind,
    role: round.role,
    ordinal: round.ordinal,
    runId: round.runId,
    modelBinding: sanitizeModelBinding(round.modelBinding),
    status: round.status,
    publicInputRefs: [...(round.publicInputRefs ?? [])],
    ...(round.output !== undefined
      ? { output: sanitizeRoundOutput(round.kind, round.output, options) }
      : {}),
    ...(round.error
      ? {
          error: round.error === "turn_limit"
            ? "turn_limit"
            : `规划模型轮次 ${(round.kind ?? "unknown").toUpperCase()} 未完成；原始诊断内容未保存。`,
        }
      : {}),
    ...(isContentFreeFailure(round.failureExcerpt)
      ? { failureExcerpt: round.failureExcerpt }
      : {}),
    ...(round.startedAt !== undefined ? { startedAt: round.startedAt } : {}),
    ...(round.completedAt !== undefined
      ? { completedAt: round.completedAt }
      : {}),
    ...(round.latencyMs !== undefined ? { latencyMs: round.latencyMs } : {}),
    ...(round.usage !== undefined
      ? {
          usage: {
            inputTokens: round.usage.inputTokens,
            outputTokens: round.usage.outputTokens,
            ...(round.usage.estimated !== undefined
              ? { estimated: round.usage.estimated }
              : {}),
          },
        }
      : {}),
  };
}

function sanitizePlanningStage(stage: PlanningStageRecord): PlanningStageRecord {
  return {
    id: stage.id,
    kind: stage.kind,
    runId: stage.runId,
    status: stage.status,
    ...(stage.investigationDepth !== undefined
      ? { investigationDepth: stage.investigationDepth }
      : {}),
    ...(stage.modelBinding !== undefined
      ? { modelBinding: sanitizeModelBinding(stage.modelBinding) }
      : {}),
    evidenceRefs: [...(stage.evidenceRefs ?? [])],
    ...(stage.reviewApproved !== undefined
      ? { reviewApproved: stage.reviewApproved }
      : {}),
    ...(stage.reviewIssues !== undefined
      ? { reviewIssues: stage.reviewIssues.map(sanitizePlanReviewIssue) }
      : {}),
    ...(stage.revisionAttempted !== undefined
      ? { revisionAttempted: stage.revisionAttempted }
      : {}),
    ...(stage.gateRepairAttempted !== undefined
      ? { gateRepairAttempted: stage.gateRepairAttempted }
      : {}),
    ...(stage.startedAt !== undefined ? { startedAt: stage.startedAt } : {}),
    ...(stage.completedAt !== undefined
      ? { completedAt: stage.completedAt }
      : {}),
    ...(stage.latencyMs !== undefined ? { latencyMs: stage.latencyMs } : {}),
    ...(stage.usage !== undefined
      ? {
          usage: {
            inputTokens: stage.usage.inputTokens,
            outputTokens: stage.usage.outputTokens,
            ...(stage.usage.estimated !== undefined
              ? { estimated: stage.usage.estimated }
              : {}),
          },
        }
      : {}),
    ...(stage.error
      ? { error: safeStageError(stage.kind, stage.error) }
      : {}),
    ...(isContentFreeFailure(stage.failureExcerpt)
      ? { failureExcerpt: stage.failureExcerpt }
      : {}),
  };
}

function sanitizeQualityReport(report: PlanQualityReport): PlanQualityReport {
  return {
    status: report.status,
    blockingIssues: (report.blockingIssues ?? []).map(sanitizeQualityIssue),
    warnings: (report.warnings ?? []).map(sanitizeQualityIssue),
    evidenceCoverage: {
      referenced: report.evidenceCoverage?.referenced ?? 0,
      total: report.evidenceCoverage?.total ?? 0,
      missingRefs: [],
    },
    acceptanceCoverage: {
      deterministicChecks: report.acceptanceCoverage?.deterministicChecks ?? 0,
      modelReviewChecks: report.acceptanceCoverage?.modelReviewChecks ?? 0,
      totalChecks: report.acceptanceCoverage?.totalChecks ?? 0,
      milestonesCovered: report.acceptanceCoverage?.milestonesCovered ?? 0,
      milestonesTotal: report.acceptanceCoverage?.milestonesTotal ?? 0,
    },
    generatedAt: report.generatedAt,
  };
}

function sanitizePlanArtifact(
  artifact: PlanArtifact,
  options: { hasReviewDiagnostics: boolean; qualityBlocked: boolean },
): PlanArtifact {
  return {
    ...sanitizePlanProposal(artifact),
    claimLedger: (artifact.claimLedger ?? []).map((item) => ({
      id: item.id,
      claim: item.claim,
      evidenceRefs: [...item.evidenceRefs],
      counterexamples: [...item.counterexamples],
      conditions: [...item.conditions],
      confidence: item.confidence,
      status: item.status,
    })),
    unresolvedQuestions: [...(artifact.unresolvedQuestions ?? [])],
    minorityOpinion: options.hasReviewDiagnostics
      ? ["模型审查意见的原始内容未保存。"]
      : [...(artifact.minorityOpinion ?? [])],
    actionGate: artifact.actionGate ?? "blocked",
    gateReason: options.qualityBlocked
      ? "计划质量门禁未通过；原始诊断内容未保存。请提供修订方向后重新规划。"
      : artifact.gateReason ?? "",
    // Markdown is a derived workspace projection. The persisted Plan record
    // and IPC DTO never keep a second model-controlled copy.
    markdown: "",
  };
}

function sanitizeRoundOutput(
  kind: DebateRoundKind,
  output: DebateRound["output"],
  options: { hasReviewDiagnostics: boolean; qualityBlocked: boolean },
): NonNullable<DebateRound["output"]> {
  const candidate = (
    output && typeof output === "object" ? output : {}
  ) as NonNullable<DebateRound["output"]>;
  if (kind === "direct" || kind === "c") {
    return sanitizePlanArtifact(candidate as PlanArtifact, options);
  }
  if (kind === "b1" || kind === "b2") {
    const critique = candidate as DebateCritique;
    return {
      summary: critique.summary ?? "",
      issues: (critique.issues ?? []).map((issue) => ({
        id: issue.id,
        target: issue.target,
        severity: issue.severity,
        claim: issue.claim,
        evidenceOrCounterexample: issue.evidenceOrCounterexample,
        requestedChange: issue.requestedChange,
        status: issue.status,
      })),
      minorityOpinion: [...(critique.minorityOpinion ?? [])],
      unresolvedRisks: (critique.unresolvedRisks ?? []).map(sanitizeRisk),
      ...(critique.goalContractIssues !== undefined
        ? {
            goalContractIssues: sanitizeGoalContractIssues(
              critique.goalContractIssues,
            ),
          }
        : {}),
    };
  }
  if (kind === "a2") {
    const revised = candidate as RevisedPlanProposal;
    return {
      ...sanitizePlanProposal(revised),
      decisions: (revised.decisions ?? []).map((decision) => ({
        issueId: decision.issueId,
        decision: decision.decision,
        reason: decision.reason,
        changedSections: [...decision.changedSections],
      })),
    };
  }
  return sanitizePlanProposal(candidate as PlanProposal);
}

function sanitizePlanProposal(proposal: PlanProposal): PlanProposal {
  return {
    title: proposal.title ?? "",
    summary: proposal.summary ?? "",
    objective: proposal.objective ?? "",
    scope: {
      in: [...(proposal.scope?.in ?? [])],
      out: [...(proposal.scope?.out ?? [])],
    },
    assumptions: [...(proposal.assumptions ?? [])],
    milestones: (proposal.milestones ?? []).map(sanitizeMilestone),
    dependencies: [...(proposal.dependencies ?? [])],
    risks: (proposal.risks ?? []).map(sanitizeRisk),
    acceptanceCriteria: [...(proposal.acceptanceCriteria ?? [])],
    ...(proposal.acceptanceChecks !== undefined
      ? { acceptanceChecks: proposal.acceptanceChecks.map(sanitizeAcceptanceCheck) }
      : {}),
    ...(proposal.goalContractIssues !== undefined
      ? {
          goalContractIssues: sanitizeGoalContractIssues(
            proposal.goalContractIssues,
          ),
        }
      : {}),
  };
}

function sanitizeGoalContractSnapshot(
  snapshot: GoalContractSnapshot,
): GoalContractSnapshot {
  return {
    schemaVersion: 1,
    id: snapshot.id,
    revision: snapshot.revision,
    source: {
      kind: snapshot.source.kind,
      ...(snapshot.source.ref !== undefined ? { ref: snapshot.source.ref } : {}),
      ...(snapshot.source.summary !== undefined
        ? { summary: snapshot.source.summary }
        : {}),
    },
    objective: snapshot.objective,
    deliverables: [...snapshot.deliverables],
    scope: {
      in: [...snapshot.scope.in],
      out: [...snapshot.scope.out],
    },
    assumptions: [...snapshot.assumptions],
    constraints: snapshot.constraints.map((constraint) => ({
      id: constraint.id,
      dimension: constraint.dimension,
      strength: constraint.strength,
      description: constraint.description,
    })),
    successCriteria: snapshot.successCriteria.map((criterion) => ({
      id: criterion.id,
      description: criterion.description,
    })),
    stopPolicy: {
      onSuccess: snapshot.stopPolicy.onSuccess,
      onUserCancel: snapshot.stopPolicy.onUserCancel,
      onExternalBlock: snapshot.stopPolicy.onExternalBlock,
      onImpossible: snapshot.stopPolicy.onImpossible,
      onSafetyBlock: snapshot.stopPolicy.onSafetyBlock,
    },
    riskPolicy: {
      ordinaryOperations: snapshot.riskPolicy.ordinaryOperations,
      highRiskOperations: snapshot.riskPolicy.highRiskOperations,
      irreversibleOperations: snapshot.riskPolicy.irreversibleOperations,
    },
    createdAt: snapshot.createdAt,
  };
}

function createSanitizedGoalContractRef(
  snapshot: GoalContractSnapshot,
): GoalContractRef {
  return {
    id: snapshot.id,
    revision: snapshot.revision,
    sha256: sha256Hex(
      new TextEncoder().encode(canonicalizeGoalContract(snapshot)),
    ),
  };
}

function sanitizeGoalContractRef(reference: GoalContractRef): GoalContractRef {
  return {
    id: reference.id,
    revision: reference.revision,
    sha256: reference.sha256,
  };
}

function sanitizeGoalPlanRef(reference: GoalPlanRef): GoalPlanRef {
  return {
    planId: reference.planId,
    planRevision: reference.planRevision,
    goalPlanVersion: reference.goalPlanVersion,
    mode: reference.mode,
    purpose: reference.purpose,
    goalContractRef: sanitizeGoalContractRef(reference.goalContractRef),
  };
}

function sanitizeGoalPlanTrigger(trigger: GoalPlanTrigger): GoalPlanTrigger {
  return {
    kind: trigger.kind,
    summary: trigger.summary,
    evidenceRefs: [...trigger.evidenceRefs],
    at: trigger.at,
  };
}

function sanitizePlanCriterionBinding(
  binding: PlanCriterionBinding,
): PlanCriterionBinding {
  return {
    criterionId: binding.criterionId,
    milestoneIds: [...binding.milestoneIds],
    checkIds: [...binding.checkIds],
  };
}

function sanitizeGoalContractIssues(
  issues: GoalContractIssue[],
): GoalContractIssue[] {
  return issues.map((issue, index) => {
    const severity = issue.severity === "blocking" ? "blocking" : "warning";
    return {
      id: `goal_contract_issue_${index + 1}`,
      severity,
      description:
        severity === "blocking"
          ? "规划模型报告 GoalContract 存在阻断问题；原始诊断内容未保存。"
          : "规划模型报告 GoalContract 存在警告；原始诊断内容未保存。",
      evidenceRefs: [],
    };
  });
}

function sanitizeMilestone(milestone: PlanMilestone): PlanMilestone {
  return {
    id: milestone.id,
    title: milestone.title,
    description: milestone.description,
    acceptanceCriteria: [...(milestone.acceptanceCriteria ?? [])],
    dependencies: [...(milestone.dependencies ?? [])],
    ...(milestone.targetRefs !== undefined
      ? { targetRefs: [...milestone.targetRefs] }
      : {}),
    ...(milestone.evidenceRefs !== undefined
      ? { evidenceRefs: [...milestone.evidenceRefs] }
      : {}),
    ...(milestone.actions !== undefined
      ? { actions: [...milestone.actions] }
      : {}),
    ...(milestone.toolNames !== undefined
      ? { toolNames: [...milestone.toolNames] }
      : {}),
    ...(milestone.acceptanceChecks !== undefined
      ? { acceptanceChecks: milestone.acceptanceChecks.map(sanitizeAcceptanceCheck) }
      : {}),
  };
}

function sanitizeRisk(risk: PlanRisk): PlanRisk {
  return {
    id: risk.id,
    severity: risk.severity,
    description: risk.description,
    mitigation: risk.mitigation,
    status: risk.status,
  };
}

function sanitizeAcceptanceCheck(check: AcceptanceCheck): AcceptanceCheck {
  return {
    id: check.id,
    kind: check.kind,
    description: check.description,
    params: structuredClone(check.params),
    requiresEvidence: check.requiresEvidence,
  };
}

function sanitizeTaskProfile(profile: NonNullable<PlanRecord["taskProfile"]>) {
  return {
    domain: profile.domain,
    mode: profile.mode,
    risk: profile.risk,
    expectedScale: profile.expectedScale,
    needsConfirmation: profile.needsConfirmation,
    targetRefs: profile.targetRefs.map((reference) => ({
      rawText: reference.rawText,
      canonical: reference.canonical,
      kind: reference.kind,
      ...(reference.exists !== undefined ? { exists: reference.exists } : {}),
      confidence: reference.confidence,
      alternatives: [...reference.alternatives],
    })),
    ambiguity: profile.ambiguity.map((entry) => ({
      field: entry.field,
      reason: entry.reason,
      options: [...entry.options],
    })),
    investigationDepth: profile.investigationDepth,
  };
}

function sanitizePlanningBrief(brief: NonNullable<PlanRecord["planningBrief"]>) {
  return {
    objective: brief.objective,
    deliverables: [...brief.deliverables],
    inScope: [...brief.inScope],
    outOfScope: [...brief.outOfScope],
    constraints: [...brief.constraints],
    assumptions: [...brief.assumptions],
    unresolvedQuestions: [...brief.unresolvedQuestions],
    targetRefs: [...brief.targetRefs],
    evidenceRefs: [...brief.evidenceRefs],
    skillCandidates: brief.skillCandidates.map((candidate) => ({
      name: candidate.name,
      reason: candidate.reason,
      evidenceRefs: [...candidate.evidenceRefs],
    })),
    ...(brief.recommendedSkillName !== undefined
      ? { recommendedSkillName: brief.recommendedSkillName }
      : {}),
    ...(brief.recommendedSkillReason !== undefined
      ? { recommendedSkillReason: brief.recommendedSkillReason }
      : {}),
    ...(brief.recommendedSkillInputValues !== undefined
      ? { recommendedSkillInputValues: { ...brief.recommendedSkillInputValues } }
      : {}),
    ...(brief.recommendedSkillInputEvidenceRefs !== undefined
      ? {
          recommendedSkillInputEvidenceRefs: Object.fromEntries(
            Object.entries(brief.recommendedSkillInputEvidenceRefs).map(
              ([key, refs]) => [key, [...refs]],
            ),
          ),
        }
      : {}),
  };
}

function sanitizeSkillDecision(
  decision: NonNullable<PlanRecord["skillDecision"]>,
) {
  return {
    source: decision.source,
    ...(decision.selectedSkillName !== undefined
      ? { selectedSkillName: decision.selectedSkillName }
      : {}),
    reason: decision.reason,
    evidenceRefs: [...decision.evidenceRefs],
    alternatives: decision.alternatives.map((candidate) => ({
      name: candidate.name,
      reason: candidate.reason,
      evidenceRefs: [...candidate.evidenceRefs],
    })),
    ...(decision.snapshotSha256 !== undefined
      ? { snapshotSha256: decision.snapshotSha256 }
      : {}),
    inputValues: { ...decision.inputValues },
    inputEvidenceRefs: Object.fromEntries(
      Object.entries(decision.inputEvidenceRefs).map(
        ([key, refs]) => [key, [...refs]],
      ),
    ),
    missingInputFields: [...decision.missingInputFields],
    invalidInputFields: [...decision.invalidInputFields],
    ...(decision.permissions !== undefined
      ? {
          permissions: {
            fileRead: [...decision.permissions.fileRead],
            fileWrite: [...decision.permissions.fileWrite],
            shellCommands: [...decision.permissions.shellCommands],
            webSearch: decision.permissions.webSearch,
            webFetchDomains: [...decision.permissions.webFetchDomains],
            memoryRead: decision.permissions.memoryRead,
            memoryWrite: decision.permissions.memoryWrite,
          },
        }
      : {}),
  };
}

function sanitizeTaskContract(contract: PlanRecord["taskContract"]) {
  return {
    objective: contract?.objective ?? "",
    audience: contract?.audience ?? "",
    ...(contract?.deliverables !== undefined
      ? { deliverables: [...contract.deliverables] }
      : {}),
    inScope: [...(contract?.inScope ?? [])],
    outOfScope: [...(contract?.outOfScope ?? [])],
    constraints: [...(contract?.constraints ?? [])],
    successCriteria: [...(contract?.successCriteria ?? [])],
    assumptions: [...(contract?.assumptions ?? [])],
    ...(contract?.targetRefs !== undefined
      ? { targetRefs: [...contract.targetRefs] }
      : {}),
    ...(contract?.evidenceRefs !== undefined
      ? { evidenceRefs: [...contract.evidenceRefs] }
      : {}),
  };
}

function sanitizeModelAssignments(
  assignments: PlanRecord["requestedModelAssignments"],
) {
  assignments ??= {};
  return {
    ...(assignments.direct !== undefined ? { direct: assignments.direct } : {}),
    ...(assignments.a !== undefined ? { a: assignments.a } : {}),
    ...(assignments.b !== undefined ? { b: assignments.b } : {}),
    ...(assignments.c !== undefined ? { c: assignments.c } : {}),
  };
}

function sanitizeFrozenModelAssignments(
  assignments: PlanRecord["frozenModelAssignments"],
) {
  assignments ??= {};
  return {
    ...(assignments.direct !== undefined
      ? { direct: sanitizeModelBinding(assignments.direct) }
      : {}),
    ...(assignments.a !== undefined
      ? { a: sanitizeModelBinding(assignments.a) }
      : {}),
    ...(assignments.b !== undefined
      ? { b: sanitizeModelBinding(assignments.b) }
      : {}),
    ...(assignments.c !== undefined
      ? { c: sanitizeModelBinding(assignments.c) }
      : {}),
  };
}

function sanitizeModelBinding(
  binding: ResolvedModelBinding | undefined,
): ResolvedModelBinding {
  return {
    profileId: binding?.profileId ?? "legacy-unavailable",
    connectionId: binding?.connectionId ?? "legacy-unavailable",
    providerKind: binding?.providerKind ?? "custom",
    modelId: binding?.modelId ?? "legacy-unavailable",
    ...(binding?.contextWindow !== undefined
      ? { contextWindow: binding.contextWindow }
      : {}),
    ...(binding?.contextWindowSource !== undefined
      ? { contextWindowSource: binding.contextWindowSource }
      : {}),
    revision: binding?.revision ?? 0,
    ...(binding?.connectionRevision !== undefined
      ? { connectionRevision: binding.connectionRevision }
      : {}),
    ...(binding?.profileRevision !== undefined
      ? { profileRevision: binding.profileRevision }
      : {}),
    ...(binding?.baseUrl !== undefined ? { baseUrl: binding.baseUrl } : {}),
    capabilities: {
      tools: binding?.capabilities?.tools ?? false,
      vision: binding?.capabilities?.vision ?? false,
      pdf: binding?.capabilities?.pdf ?? false,
      streaming: binding?.capabilities?.streaming ?? false,
      parallelToolCalls: binding?.capabilities?.parallelToolCalls ?? false,
    },
    generation: {
      temperature: binding?.generation?.temperature ?? 0,
      maxTokens: binding?.generation?.maxTokens ?? 0,
      thinkingEnabled: binding?.generation?.thinkingEnabled ?? false,
      thinkingBudgetTokens: binding?.generation?.thinkingBudgetTokens ?? 0,
    },
  };
}

function isContentFreeFailure(
  value: string | undefined,
): value is string {
  return Boolean(value && contentFreeFailurePattern.test(value));
}

function safeStageError(kind: PlanningStageKind, error: string): string {
  if (error === "turn_limit") return error;
  return `规划阶段 ${kind} 未完成；原始诊断内容未保存。`;
}

function sanitizeQualityIssue(issue: PlanQualityIssue): PlanQualityIssue {
  const code = planQualityIssueCodes.has(issue.code)
    ? issue.code
    : "INVALID_SCHEMA";
  return {
    code,
    severity: issue.severity === "warning" ? "warning" : "blocking",
    message: `计划质量检查 ${code} 未通过；原始诊断内容未保存。`,
  };
}
