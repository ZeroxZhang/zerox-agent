import { createHash } from "node:crypto";
import type { AcceptanceCheck, GoalSelectedSkill } from "../shared/agentGoal";
import { classifyTaskFrame } from "../shared/agentTaskStrategy";
import type {
  PlanActionGate,
  PlanArtifact,
  PlanEvidenceItem,
  PlanInvestigationDepth,
  PlanQualityIssue,
  PlanQualityReport,
  PlanReviewIssue,
  PlanSkillDecision,
  PlanTaskContract,
  PlanTaskProfile,
  PlanningBrief,
} from "../shared/planMode";
import type { SkillInputValue } from "../shared/skillExecutionContract";
import type { SkillRecord } from "../shared/skills";
import { validatePlanMilestoneGraph } from "../shared/planValidation";
import { assertValidPlanRoundShape } from "../shared/planStructuredOutput";
import {
  isDeterministicAcceptanceCheck,
  validateAcceptanceCheckContract,
} from "./acceptanceContractValidator";
import { resolveSkillInput } from "./skillExecutionService";

export type PlannerSkillRoutingInput = {
  brief: PlanningBrief;
  skills: SkillRecord[];
  explicitSkill?: GoalSelectedSkill;
  workspaceId?: string;
  workspaceRoot?: string;
};

export type PlannerSkillRoutingResult = {
  decision: PlanSkillDecision;
  selectedSkill?: GoalSelectedSkill;
};

export function createPlanTaskProfile(sourceMessage: string): PlanTaskProfile {
  const frame = classifyTaskFrame(sourceMessage);
  const domain =
    frame.domain === "unknown" &&
    /(研究|调研|竞品|文献|资料搜集|research|investigate|benchmark)/i.test(
      sourceMessage,
    )
      ? "research"
      : frame.domain;
  const crossModuleOrHighComplexity =
    /(跨模块|多个模块|全仓|架构|迁移|重构|复杂|cross[- ]module|migration|refactor|end[- ]to[- ]end)/i.test(
      sourceMessage,
    );
  const expectedScale = crossModuleOrHighComplexity
    ? "large"
    : frame.expectedScale;
  const investigationDepth =
    expectedScale === "large" ||
    domain === "unknown" ||
    domain === "research" ||
    crossModuleOrHighComplexity ||
    frame.ambiguity.length > 0 ||
    frame.targetRefs.length > 1 ||
    frame.risk === "deletes_data" ||
    frame.risk === "external_side_effect"
      ? "deep"
      : frame.expectedScale === "small" &&
          frame.risk === "read_only" &&
          frame.targetRefs.length <= 1
        ? "quick"
        : "standard";
  return {
    domain,
    mode: frame.mode,
    risk: frame.risk,
    expectedScale,
    needsConfirmation: frame.needsConfirmation,
    targetRefs: frame.targetRefs,
    ambiguity: frame.ambiguity,
    investigationDepth,
  };
}

export function shouldEscalatePlanInvestigation(input: {
  depth: PlanInvestigationDepth;
  brief: PlanningBrief;
  evidence: PlanEvidenceItem[];
  attemptEvidenceIds: Iterable<string>;
}): boolean {
  return (
    input.depth !== "deep" &&
    isPlanInvestigationEvidenceInsufficient(input)
  );
}

export function isPlanInvestigationEvidenceInsufficient(input: {
  brief: PlanningBrief;
  evidence: PlanEvidenceItem[];
  attemptEvidenceIds: Iterable<string>;
}): boolean {
  const attemptEvidenceIds = new Set(input.attemptEvidenceIds);
  const citedAttemptEvidence = input.brief.evidenceRefs.some((ref) =>
    attemptEvidenceIds.has(ref),
  );
  const evidenceInsufficiency = [
    ...input.brief.assumptions,
    ...input.brief.unresolvedQuestions,
  ].some((value) =>
    /(证据不足|缺少证据|无法验证|尚未验证|未找到|insufficient evidence|not verified|not found)/i.test(
      value,
    ),
  );
  const hasNonUserEvidence = input.evidence.some(
    (item) => item.kind !== "user",
  );
  return !hasNonUserEvidence || !citedAttemptEvidence || evidenceInsufficiency;
}

export function createFallbackPlanningBrief(input: {
  sourceMessage: string;
  profile: PlanTaskProfile;
  evidence: PlanEvidenceItem[];
  skills?: SkillRecord[];
}): PlanningBrief {
  const targetRefs = input.profile.targetRefs.map(
    (reference) => reference.canonical,
  );
  return {
    objective: input.sourceMessage.trim(),
    deliverables: [input.sourceMessage.trim()],
    inScope: ["用户明确要求的交付", "完成交付所需的工作区内调查、变更与验证"],
    outOfScope: ["未经授权的外部发布、发送或生产环境变更"],
    constraints: [
      "计划确认前保持只读",
      "不得绕过工作区边界、工具授权或 Skill 权限",
      "所有工作区事实必须引用已收集证据",
    ],
    assumptions: [],
    unresolvedQuestions: input.profile.ambiguity.map(
      (item) => `${item.field}：${item.reason}`,
    ),
    targetRefs,
    evidenceRefs: input.evidence.map((item) => item.id),
    skillCandidates: (input.skills ?? []).map((skill) => ({
      name: skill.manifest.name,
      reason: skill.manifest.description,
      evidenceRefs: [],
    })),
  };
}

export function buildPlanTaskContract(
  brief: PlanningBrief,
): PlanTaskContract {
  return {
    objective: brief.objective,
    audience: "提出需求并负责确认计划的 Zerox 用户",
    deliverables: [...brief.deliverables],
    inScope: [...brief.inScope],
    outOfScope: [...brief.outOfScope],
    constraints: [...brief.constraints],
    successCriteria: brief.deliverables.map(
      (deliverable) => `交付并验证：${deliverable}`,
    ),
    assumptions: [...brief.assumptions],
    targetRefs: [...brief.targetRefs],
    evidenceRefs: [...brief.evidenceRefs],
  };
}

export function routePlannerSkill(
  input: PlannerSkillRoutingInput,
): PlannerSkillRoutingResult {
  const actualSkills = new Map(
    input.skills.map((skill) => [skill.manifest.name, skill]),
  );
  let source: PlanSkillDecision["source"] = "none";
  let selected: GoalSelectedSkill | undefined;
  let reason = "没有发现能实质改善结果的已安装 Skill。";
  const candidateNames = unique(
    input.brief.skillCandidates
      .map((candidate) => candidate.name)
      .filter((name) => actualSkills.has(name)),
  );

  if (input.explicitSkill) {
    source = "explicit";
    selected = snapshotSkill(input.explicitSkill);
    reason = "保留用户显式选择的 Skill，自动路由不得替换。";
  } else {
    const recommendedName = input.brief.recommendedSkillName?.trim();
    if (recommendedName && actualSkills.has(recommendedName)) {
      source = "automatic";
      selected = snapshotSkill(actualSkills.get(recommendedName)!);
      reason =
        input.brief.recommendedSkillReason?.trim() ||
        "调查结果明确推荐该已安装 Skill。";
    } else if (candidateNames.length === 1) {
      source = "automatic";
      selected = snapshotSkill(actualSkills.get(candidateNames[0]!)!);
      reason =
        input.brief.skillCandidates.find(
          (candidate) => candidate.name === candidateNames[0],
        )?.reason || "只有一个已验证的 Skill 候选。";
    } else if (candidateNames.length > 1) {
      reason = "多个 Skill 会实质改变规划结果，需要用户选择。";
    }
  }

  const rawInputValues = selected
    ? (input.brief.recommendedSkillInputValues ?? {})
    : {};
  const resolution = selected
    ? resolveSkillInput({
        skill: selected,
        values: rawInputValues,
        runContext: input.workspaceRoot
          ? {
              workspaceId: input.workspaceId ?? "planner-workspace",
              workspaceRoot: input.workspaceRoot,
              runMode: "plan",
              agentRole: "planner",
              depth: 0,
              sandbox: {
                mode: "read_only",
                network: "none",
                shell: "disabled",
                allowWorkspaceEscape: false,
                extraReadRoots: [],
                extraWriteRoots: [],
              },
            }
          : undefined,
      })
    : {
        status: "complete" as const,
        values: {} as Record<string, SkillInputValue>,
        missingFields: [] as string[],
        invalidFields: [] as string[],
      };
  const inputEvidenceRefs = Object.fromEntries(
    Object.keys(resolution.values)
      .filter((field) => !isSensitiveSkillInputName(field))
      .map((field) => [
        field,
        unique(
          input.brief.recommendedSkillInputEvidenceRefs?.[field] ?? [],
        ),
      ]),
  );
  const sensitiveInputFields = Object.keys(resolution.values).filter(
    isSensitiveSkillInputName,
  );
  const safeInputValues = Object.fromEntries(
    Object.entries(resolution.values).filter(
      ([field]) => !sensitiveInputFields.includes(field),
    ),
  );
  const unsupportedInputFields = selected
    ? Object.keys(safeInputValues).filter((fieldName) => {
        const field = selected!.manifest.inputs.find(
          (candidate) => candidate.name === fieldName,
        );
        const usesDefault =
          field?.defaultValue !== undefined &&
          field.defaultValue === safeInputValues[fieldName];
        return !usesDefault && inputEvidenceRefs[fieldName]?.length === 0;
      })
    : [];

  const decision: PlanSkillDecision = {
    source,
    ...(selected ? { selectedSkillName: selected.manifest.name } : {}),
    reason,
    evidenceRefs:
      input.brief.skillCandidates.find(
        (candidate) => candidate.name === selected?.manifest.name,
      )?.evidenceRefs ?? [],
    alternatives: input.brief.skillCandidates
      .filter((candidate) => actualSkills.has(candidate.name))
      .map((candidate) => ({ ...candidate })),
    ...(selected
      ? {
          snapshotSha256: hash(
            JSON.stringify(selected.manifest) + selected.body,
          ),
          permissions: summarizePermissions(selected),
        }
      : {}),
    inputValues: safeInputValues,
    inputEvidenceRefs,
    missingInputFields: resolution.missingFields,
    invalidInputFields: unique([
      ...resolution.invalidFields,
      ...sensitiveInputFields,
      ...unsupportedInputFields,
    ]),
  };
  return {
    decision,
    ...(selected ? { selectedSkill: selected } : {}),
  };
}

export function createPlanQualityReport(input: {
  artifact: PlanArtifact;
  profile: PlanTaskProfile;
  brief: PlanningBrief;
  evidence: PlanEvidenceItem[];
  skillDecision?: PlanSkillDecision;
  workspaceRoot?: string;
  availableToolNames?: Iterable<string>;
  availableAcceptanceKinds?: Iterable<string>;
  reviewApproved?: boolean;
  reviewIssues?: PlanReviewIssue[];
  now?: string;
}): PlanQualityReport {
  const blockingIssues: PlanQualityIssue[] = [];
  const warnings: PlanQualityIssue[] = [];
  const evidenceIds = new Set(input.evidence.map((item) => item.id));
  const availableAcceptanceKinds = new Set(
    input.availableAcceptanceKinds ?? [],
  );

  try {
    assertValidPlanRoundShape(
      "direct",
      input.artifact as unknown as Record<string, unknown>,
      2,
    );
  } catch (error) {
    const issue: PlanQualityIssue = {
      code: "INVALID_SCHEMA",
      severity: "blocking",
      message:
        error instanceof Error
          ? error.message
          : "计划终版不符合 v2 结构合同。",
    };
    return {
      status: "blocked",
      blockingIssues: [issue],
      warnings,
      evidenceCoverage: {
        referenced: 0,
        total: 0,
        missingRefs: [],
      },
      acceptanceCoverage: {
        deterministicChecks: 0,
        modelReviewChecks: 0,
        totalChecks: 0,
        milestonesCovered: 0,
        milestonesTotal: 0,
      },
      generatedAt: input.now ?? new Date().toISOString(),
    };
  }

  try {
    validatePlanMilestoneGraph(input.artifact.milestones);
  } catch (error) {
    blockingIssues.push({
      code: "INVALID_DAG",
      severity: "blocking",
      message:
        error instanceof Error ? error.message : "计划里程碑 DAG 无效。",
    });
  }

  if (
    input.artifact.risks.some(
      (risk) => risk.severity === "critical" && risk.status === "open",
    )
  ) {
    blockingIssues.push({
      code: "UNMITIGATED_CRITICAL_RISK",
      severity: "blocking",
      message: "存在未缓解的严重风险。",
    });
  }

  for (const issue of input.reviewIssues ?? []) {
    const qualityIssue: PlanQualityIssue = {
      code: "MODEL_REVIEW_REJECTED",
      severity:
        issue.severity === "high" || issue.severity === "critical"
          ? "blocking"
          : "warning",
      message: `独立审查 [${issue.code}]：${issue.message}`,
    };
    if (qualityIssue.severity === "blocking") {
      blockingIssues.push(qualityIssue);
    } else {
      warnings.push(qualityIssue);
    }
  }
  if (
    input.reviewApproved === false &&
    !blockingIssues.some((issue) => issue.code === "MODEL_REVIEW_REJECTED")
  ) {
    blockingIssues.push({
      code: "MODEL_REVIEW_REJECTED",
      severity: "blocking",
      message: "独立冷审查未通过，计划必须修订后重新审查。",
    });
  }

  if (input.availableToolNames) {
    const availableTools = new Set(input.availableToolNames);
    for (const milestone of input.artifact.milestones) {
      for (const toolName of milestone.toolNames ?? []) {
        if (!availableTools.has(toolName)) {
          blockingIssues.push({
            code: "UNKNOWN_TOOL",
            severity: "blocking",
            message: `里程碑 ${milestone.id} 引用了不存在的工具 ${toolName}。`,
            milestoneId: milestone.id,
          });
        }
      }
    }
  }

  const unresolved = unique([
    ...input.brief.unresolvedQuestions,
    ...input.artifact.unresolvedQuestions,
  ]);
  for (const question of unresolved) {
    blockingIssues.push({
      code: "UNRESOLVED_AMBIGUITY",
      severity: "blocking",
      message: question,
    });
  }

  if (input.skillDecision) {
    if (
      input.skillDecision.source === "none" &&
      input.skillDecision.alternatives.length > 1
    ) {
      blockingIssues.push({
        code: "UNRESOLVED_AMBIGUITY",
        severity: "blocking",
        message: "存在多个会实质改变结果的 Skill 候选。",
      });
    }
    for (const field of input.skillDecision.missingInputFields) {
      blockingIssues.push({
        code: "SKILL_INPUT_MISSING",
        severity: "blocking",
        message: `Skill 必填输入缺失：${field}。`,
      });
    }
    for (const field of input.skillDecision.invalidInputFields) {
      blockingIssues.push({
        code: "SKILL_INPUT_INVALID",
        severity: "blocking",
        message: `Skill 输入非法：${field}。`,
      });
    }
  }

  const allChecks: Array<{
    check: AcceptanceCheck;
    milestoneId?: string;
  }> = [
    ...(input.artifact.acceptanceChecks ?? []).map((check) => ({ check })),
    ...input.artifact.milestones.flatMap((milestone) =>
      (milestone.acceptanceChecks ?? []).map((check) => ({
        check,
        milestoneId: milestone.id,
      })),
    ),
  ];
  let deterministicChecks = 0;
  let modelReviewChecks = 0;
  const acceptanceCheckIds = new Set<string>();
  for (const { check, milestoneId } of allChecks) {
    if (acceptanceCheckIds.has(check.id)) {
      blockingIssues.push({
        code: "INVALID_ACCEPTANCE_CHECK",
        severity: "blocking",
        message: `验收检查 id 重复：${check.id}。`,
        ...(milestoneId ? { milestoneId } : {}),
        checkId: check.id,
      });
    }
    acceptanceCheckIds.add(check.id);
    if (
      check.kind.startsWith("validator:") &&
      !availableAcceptanceKinds.has(check.kind)
    ) {
      blockingIssues.push({
        code: "INVALID_ACCEPTANCE_CHECK",
        severity: "blocking",
        message: `验收检查 ${check.id} 引用了未注册的验证器 ${check.kind}。`,
        ...(milestoneId ? { milestoneId } : {}),
        checkId: check.id,
      });
    }
    const validation = validateAcceptanceCheckContract(check, {
      workspaceRoot: input.workspaceRoot,
      evidenceRefs: evidenceIds,
    });
    if (isDeterministicAcceptanceCheck(check)) deterministicChecks += 1;
    if (check.kind === "model_review") modelReviewChecks += 1;
    for (const message of validation.errors) {
      blockingIssues.push({
        code: "INVALID_ACCEPTANCE_CHECK",
        severity: "blocking",
        message,
        ...(milestoneId ? { milestoneId } : {}),
        checkId: check.id,
      });
    }
    for (const message of validation.warnings) {
      warnings.push({
        code: "INVALID_ACCEPTANCE_CHECK",
        severity: "warning",
        message,
        ...(milestoneId ? { milestoneId } : {}),
        checkId: check.id,
      });
    }
  }

  const milestonesCovered = input.artifact.milestones.filter(
    (milestone) => (milestone.acceptanceChecks?.length ?? 0) > 0,
  ).length;
  for (const milestone of input.artifact.milestones) {
    if ((milestone.acceptanceChecks?.length ?? 0) === 0) {
      blockingIssues.push({
        code: "INVALID_ACCEPTANCE_CHECK",
        severity: "blocking",
        message: `里程碑 ${milestone.id} 缺少类型化验收检查。`,
        milestoneId: milestone.id,
      });
    }
    if (
      ["code", "files", "data"].includes(input.profile.domain) &&
      (milestone.evidenceRefs?.length ?? 0) === 0
    ) {
      blockingIssues.push({
        code: "MISSING_EVIDENCE",
        severity: "blocking",
        message: `里程碑 ${milestone.id} 缺少调查证据引用。`,
        milestoneId: milestone.id,
      });
    }
  }
  for (const claim of input.artifact.claimLedger ?? []) {
    if (claim.status !== "rejected" && claim.evidenceRefs.length === 0) {
      blockingIssues.push({
        code: "MISSING_EVIDENCE",
        severity: "blocking",
        message: `计划主张 ${claim.id} 缺少调查证据引用。`,
      });
    }
  }
  if (
    ["code", "files", "data"].includes(input.profile.domain) &&
    deterministicChecks === 0
  ) {
    blockingIssues.push({
      code: "INSUFFICIENT_DETERMINISTIC_ACCEPTANCE",
      severity: "blocking",
      message: "代码、文件或数据任务必须包含至少一个确定性验收检查。",
    });
  }

  const referencedEvidence = unique([
    ...input.brief.evidenceRefs,
    ...(input.artifact.claimLedger ?? []).flatMap(
      (claim) => claim.evidenceRefs,
    ),
    ...input.artifact.milestones.flatMap(
      (milestone) => milestone.evidenceRefs ?? [],
    ),
    ...Object.values(input.skillDecision?.inputEvidenceRefs ?? {}).flat(),
  ]);
  const missingRefs = referencedEvidence.filter(
    (ref) => !evidenceIds.has(ref),
  );
  if (missingRefs.length > 0) {
    blockingIssues.push({
      code: "MISSING_EVIDENCE",
      severity: "blocking",
      message: `计划引用了未收集的证据：${missingRefs.join("、")}。`,
      evidenceRefs: missingRefs,
    });
  }

  const needsInput = blockingIssues.some((issue) =>
    [
      "UNRESOLVED_AMBIGUITY",
      "SKILL_INPUT_MISSING",
      "SKILL_INPUT_INVALID",
    ].includes(issue.code),
  );
  const hasHardBlock = blockingIssues.some(
    (issue) =>
      ![
        "UNRESOLVED_AMBIGUITY",
        "SKILL_INPUT_MISSING",
        "SKILL_INPUT_INVALID",
      ].includes(issue.code),
  );
  const status: PlanActionGate = hasHardBlock
    ? "blocked"
    : needsInput
      ? "needs_input"
      : "ready";

  return {
    status,
    blockingIssues,
    warnings,
    evidenceCoverage: {
      referenced: referencedEvidence.length - missingRefs.length,
      total: referencedEvidence.length,
      missingRefs,
    },
    acceptanceCoverage: {
      deterministicChecks,
      modelReviewChecks,
      totalChecks: allChecks.length,
      milestonesCovered,
      milestonesTotal: input.artifact.milestones.length,
    },
    generatedAt: input.now ?? new Date().toISOString(),
  };
}

export function applyPlanQualityGate(
  artifact: PlanArtifact,
  report: PlanQualityReport,
): PlanArtifact {
  return {
    ...artifact,
    actionGate: report.status,
    gateReason:
      report.status === "ready"
        ? "代码质量门禁通过，计划可以进入用户确认。"
        : report.blockingIssues.map((issue) => issue.message).join(" "),
  };
}

function snapshotSkill(skill: GoalSelectedSkill): GoalSelectedSkill {
  return {
    rootDir: skill.rootDir,
    skillFile: skill.skillFile,
    body: skill.body,
    manifest: structuredClone(skill.manifest),
  };
}

function summarizePermissions(
  skill: GoalSelectedSkill,
): NonNullable<PlanSkillDecision["permissions"]> {
  return {
    fileRead: [...skill.manifest.permissions.files.read],
    fileWrite: [...skill.manifest.permissions.files.write],
    shellCommands: [...skill.manifest.permissions.shell.commands],
    webSearch: skill.manifest.permissions.web.search,
    webFetchDomains: [...skill.manifest.permissions.web.fetchDomains],
    memoryRead: skill.manifest.permissions.memory.read,
    memoryWrite: skill.manifest.permissions.memory.write,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isSensitiveSkillInputName(value: string): boolean {
  return /^(?:api_?key|access_?token|refresh_?token|token|password|passwd|secret|authorization|credential)$/i.test(
    value,
  );
}
