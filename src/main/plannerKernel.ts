import { createHash } from "node:crypto";
import path from "node:path";
import type { AcceptanceCheck, GoalSelectedSkill } from "../shared/agentGoal";
import {
  extractLeadingCdWorkspace,
  findBlockedShellControl,
} from "../shared/acceptanceCommand";
import { classifyTaskFrame } from "../shared/agentTaskStrategy";
import type {
  PlanActionGate,
  PlanArtifact,
  PlanAutonomyMode,
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
import {
  createPublicSkillSnapshot,
  createPublicSkillSnapshotSha256,
  type SkillSnapshotSource,
} from "../shared/skills";
import type {
  GoalContractIssue,
  GoalContractRef,
  GoalContractSnapshot,
  PlanCriterionBinding,
} from "../shared/goalPlanContract";
import { validatePlanMilestoneGraph } from "../shared/planValidation";
import { assertValidPlanRoundShape } from "../shared/planStructuredOutput";
import {
  isDeterministicAcceptanceCheck,
  validateAcceptanceCheckContract,
} from "./acceptanceContractValidator";
import { resolveSkillInput } from "./skillExecutionService";
import { goalContractMatchesRef } from "./goalPlanContractService";

const USER_AUTHORITY_QUESTION_PATTERNS = [
  /(?:api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token|password|passcode|secret|credential|密钥|口令|密码|令牌|凭证)/i,
  /(?:验证码|动态码|二次验证|双重验证|2fa|mfa|one[\s_-]?time[\s_-]?code)/i,
  /(?:收件人|接收人|发送给谁|对外发送|公开发布|发布账号|recipient|external recipient|publish account)/i,
  /(?:付款|支付|购买|转账|金额|预算上限|payment|purchase|transfer|spend|budget limit)/i,
  /(?:法务|法律意见|合规批准|医疗决定|处方|legal approval|regulated decision|medical decision)/i,
  /(?:永久删除|不可恢复|不可逆|清空数据|覆盖现有|生产环境变更|production deployment|irreversible|permanently delete)/i,
  /(?:选择工作区|工作区路径|workspace path|select (?:a )?workspace)/i,
] as const;

export type PlannerSkillRoutingInput = {
  brief: PlanningBrief;
  skills: SkillSnapshotSource[];
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
  skills?: SkillSnapshotSource[];
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

export function applyPlanningBriefAutonomy(
  brief: PlanningBrief,
  autonomyMode: PlanAutonomyMode | undefined,
): PlanningBrief {
  if (autonomyMode !== "auto" || brief.unresolvedQuestions.length === 0) {
    return brief;
  }
  const { blocking, delegated } = partitionAutonomousQuestions(
    brief.unresolvedQuestions,
  );
  return {
    ...brief,
    assumptions: unique([
      ...brief.assumptions,
      ...delegated.map(toAutonomousAssumption),
    ]),
    unresolvedQuestions: blocking,
  };
}

export function applyPlanArtifactAutonomy(
  artifact: PlanArtifact,
  autonomyMode: PlanAutonomyMode | undefined,
): PlanArtifact {
  if (autonomyMode !== "auto" || artifact.unresolvedQuestions.length === 0) {
    return artifact;
  }
  const { blocking, delegated } = partitionAutonomousQuestions(
    artifact.unresolvedQuestions,
  );
  return {
    ...artifact,
    assumptions: unique([
      ...artifact.assumptions,
      ...delegated.map(toAutonomousAssumption),
    ]),
    unresolvedQuestions: blocking,
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
  const skillAuthoringTask =
    !input.explicitSkill && isSkillAuthoringBrief(input.brief);
  const skillCreator = actualSkills.get("skill-creator");
  const creatorCandidate = skillCreator
    ? input.brief.skillCandidates.find(
        (candidate) => candidate.name === skillCreator.manifest.name,
      ) ?? {
        name: skillCreator.manifest.name,
        reason:
          "该任务要创建或更新 Skill，应使用专门的 Skill 创建器，而不是调用一个领域内容 Skill。",
        evidenceRefs: [] as string[],
      }
    : undefined;
  const routingCandidates = skillAuthoringTask
    ? creatorCandidate
      ? [creatorCandidate]
      : []
    : input.brief.skillCandidates;
  let source: PlanSkillDecision["source"] = "none";
  let selected: GoalSelectedSkill | undefined;
  let reason = "没有发现能实质改善结果的已安装 Skill。";
  const candidateNames = unique(
    routingCandidates
      .map((candidate) => candidate.name)
      .filter((name) => actualSkills.has(name)),
  );

  if (input.explicitSkill) {
    source = "explicit";
    selected = snapshotSkill(input.explicitSkill);
    reason = "保留用户显式选择的 Skill，自动路由不得替换。";
  } else if (skillAuthoringTask) {
    if (skillCreator) {
      source = "automatic";
      selected = snapshotSkill(skillCreator);
      reason =
        creatorCandidate?.reason ??
        "创建或更新 Skill 的任务由 Skill 创建器执行。";
    } else {
      reason =
        "这是创建新 Skill 的任务，但未安装 skill-creator；交由普通执行 Agent 创建，不调用现有领域 Skill。";
    }
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
        routingCandidates.find(
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
      routingCandidates.find(
        (candidate) => candidate.name === selected?.manifest.name,
      )?.evidenceRefs ?? [],
    alternatives: routingCandidates
      .filter((candidate) => actualSkills.has(candidate.name))
      .map((candidate) => ({ ...candidate })),
    ...(selected
      ? {
          snapshotSha256: createPublicSkillSnapshotSha256(selected),
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

function isSkillAuthoringBrief(brief: PlanningBrief): boolean {
  const text = [brief.objective, ...brief.deliverables, ...brief.inScope]
    .join("\n")
    .toLowerCase();
  return (
    /(?:创建|新建|开发|制作|编写|生成|搭建|实现|更新|修改).{0,32}(?:skill|技能)/iu.test(
      text,
    ) ||
    /(?:create|build|develop|write|generate|update|modify)\s+(?:a\s+|an\s+)?skill\b/i.test(
      text,
    )
  );
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
  goalContractSnapshot?: GoalContractSnapshot;
  goalContractRef?: GoalContractRef;
  criterionBindings?: PlanCriterionBinding[];
  goalContractIssues?: GoalContractIssue[];
  now?: string;
}): PlanQualityReport {
  const blockingIssues: PlanQualityIssue[] = [];
  const warnings: PlanQualityIssue[] = [];
  const evidenceIds = new Set(input.evidence.map((item) => item.id));
  const availableAcceptanceKinds = new Set(
    input.availableAcceptanceKinds ?? [],
  );

  for (const issue of input.goalContractIssues ?? []) {
    const qualityIssue: PlanQualityIssue = {
      code: "GOAL_CONTRACT_BLOCKED",
      severity: issue.severity === "blocking" ? "blocking" : "warning",
      message: issue.description,
      evidenceRefs: issue.evidenceRefs,
    };
    if (qualityIssue.severity === "blocking") {
      blockingIssues.push(qualityIssue);
    } else {
      warnings.push(qualityIssue);
    }
  }

  if (input.goalContractSnapshot) {
    const contract = input.goalContractSnapshot;
    if (
      !input.goalContractRef ||
      !goalContractMatchesRef(contract, input.goalContractRef)
    ) {
      blockingIssues.push({
        code: "GOAL_CONTRACT_DRIFT",
        severity: "blocking",
        message: "Plan 使用的 GoalContract 快照与冻结哈希不一致。",
      });
    }
    const boundCriteria = new Set(
      (input.criterionBindings ?? [])
        .filter(
          (binding) =>
            binding.milestoneIds.length > 0 && binding.checkIds.length > 0,
        )
        .map((binding) => binding.criterionId),
    );
    for (const criterion of contract.successCriteria) {
      if (!boundCriteria.has(criterion.id)) {
        blockingIssues.push({
          code: "GOAL_CRITERION_UNCOVERED",
          severity: "blocking",
          message: `Goal 成功标准未绑定到里程碑和验收检查：${criterion.description}`,
        });
      }
    }
  }

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
      semanticCriteria: milestoneId
        ? [
            ...(input.artifact.milestones.find(
              (milestone) => milestone.id === milestoneId,
            )?.acceptanceCriteria ?? []),
            ...(input.goalContractSnapshot?.successCriteria.map(
              (criterion) => criterion.description,
            ) ?? []),
          ]
        : [
            ...input.artifact.acceptanceCriteria,
            ...(input.goalContractSnapshot?.successCriteria.map(
              (criterion) => criterion.description,
            ) ?? []),
          ],
      // A read-only plan may propose an explicit external artifact location
      // (for example a shared Skill directory). User confirmation establishes
      // intent; the Goal runtime remains responsible for authorization and
      // live sandbox enforcement.
      allowExternalFileTargets: true,
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

export function derivePlanCriterionBindings(
  artifact: PlanArtifact,
  contract: GoalContractSnapshot,
): PlanCriterionBinding[] {
  const planCheckIds = (artifact.acceptanceChecks ?? []).map(
    (check) => check.id,
  );
  const hasOrdinalCoverageCapacity =
    artifact.acceptanceCriteria.length >= contract.successCriteria.length &&
    artifact.milestones.length >= contract.successCriteria.length;
  return contract.successCriteria.map((criterion, criterionIndex) => {
    const expected = normalizeSemanticText(criterion.description);
    const matchingMilestones = artifact.milestones.filter((milestone) =>
      milestone.acceptanceCriteria.some(
        (candidate) => normalizeSemanticText(candidate) === expected,
      ),
    );
    const semanticMilestones = rankSemanticMilestoneMatches(
      criterion.description,
      artifact.milestones,
    );
    const fallbackMilestones =
      hasOrdinalCoverageCapacity
        ? [artifact.milestones[criterionIndex]!]
        : [];
    const boundMilestones =
      matchingMilestones.length > 0
        ? matchingMilestones
        : semanticMilestones.length > 0
          ? semanticMilestones
          : fallbackMilestones;
    const milestoneIds = boundMilestones.map((milestone) => milestone.id);
    const milestoneCheckIds = boundMilestones.flatMap((milestone) =>
      (milestone.acceptanceChecks ?? []).map((check) => check.id),
    );
    return {
      criterionId: criterion.id,
      milestoneIds: unique(milestoneIds),
      checkIds: unique([
        ...planCheckIds,
        ...milestoneCheckIds,
      ]),
    };
  });
}

function rankSemanticMilestoneMatches(
  criterion: string,
  milestones: PlanArtifact["milestones"],
): PlanArtifact["milestones"] {
  const ranked = milestones
    .map((milestone) => ({
      milestone,
      score: semanticOverlapScore(
        criterion,
        [
          milestone.title,
          milestone.description,
          ...milestone.acceptanceCriteria,
          ...(milestone.acceptanceChecks ?? []).flatMap((check) => [
            check.description,
            stableSemanticValue(check.params),
          ]),
        ].join(" "),
      ),
    }))
    .sort((left, right) =>
      right.score - left.score ||
      left.milestone.id.localeCompare(right.milestone.id),
    );
  const best = ranked[0]?.score ?? 0;
  if (best < 4) return [];
  const threshold = Math.max(4, Math.floor(best * 0.85));
  return ranked
    .filter((candidate) => candidate.score >= threshold)
    .map((candidate) => candidate.milestone);
}

function semanticOverlapScore(left: string, right: string): number {
  const leftText = normalizeSemanticSignal(left);
  const rightText = normalizeSemanticSignal(right);
  if (!leftText || !rightText) return 0;

  const leftAsciiTokens = new Set(leftText.match(/[a-z0-9][a-z0-9._/-]*/g) ?? []);
  const rightAsciiTokens = new Set(rightText.match(/[a-z0-9][a-z0-9._/-]*/g) ?? []);
  let score = 0;
  for (const token of leftAsciiTokens) {
    if (token.length >= 2 && rightAsciiTokens.has(token)) score += 12;
  }

  const leftBigrams = new Set(characterBigrams(leftText));
  const rightBigrams = new Set(characterBigrams(rightText));
  for (const bigram of leftBigrams) {
    if (rightBigrams.has(bigram)) score += 1;
  }
  return score;
}

function normalizeSemanticSignal(value: string): string {
  return normalizeSemanticText(value)
    .replace(/交付并验证|交付|验证|完成|构建|编写|实现|确保|可选|说明/g, "")
    .replace(/[^a-z0-9\u3400-\u9fff._/-]+/g, "");
}

function characterBigrams(value: string): string[] {
  const characters = [...value];
  return characters.slice(0, -1).map((character, index) =>
    `${character}${characters[index + 1]}`,
  );
}

function stableSemanticValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(stableSemanticValue).join(" ");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${key} ${stableSemanticValue(entry)}`)
      .join(" ");
  }
  return String(value ?? "");
}

function normalizeSemanticText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
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

/**
 * Older planner prompts and several compatible providers use these labels for
 * capabilities.  They are not registered Agent tools: normalize them at the
 * planning boundary so the persisted plan only names executable tools.
 */
const plannerToolAliases: Readonly<Record<string, string>> = {
  command_run: "shell_exec",
  command_exit_code: "shell_exec",
  file_exists: "file_stat",
  test_passes: "test_run",
};

/**
 * Acceptance-check kinds are execution-time verifier names, not Agent
 * tools. Planner models repeatedly confuse the two namespaces (2026-08-02
 * "milestone_4 引用了不存在的工具 model_review" — blocked twice even
 * after a gate-repair round). Three kinds have executable aliases above;
 * the rest must never appear in toolNames, so strip them deterministically
 * instead of asking the model to regenerate an otherwise valid plan.
 */
const acceptanceKindOnlyToolNames: ReadonlySet<string> = new Set([
  "assertion",
  "model_review",
]);

export function normalizePlanToolNames(toolNames: Iterable<string>): string[] {
  return unique(
    [...toolNames]
      .map((toolName) => toolName.trim())
      .filter(Boolean)
      .filter(
        (toolName) =>
          !acceptanceKindOnlyToolNames.has(toolName) &&
          !toolName.startsWith("validator:"),
      )
      .map((toolName) => plannerToolAliases[toolName] ?? toolName),
  );
}

/**
 * Rewrites only documented planner compatibility aliases.  This permits a
 * previously persisted Plan Mode artifact to be re-checked safely without
 * asking the model to regenerate an otherwise valid plan.
 */
export function normalizePlanArtifactToolNames(
  artifact: PlanArtifact,
): PlanArtifact {
  return {
    ...artifact,
    milestones: artifact.milestones.map((milestone) => ({
      ...milestone,
      toolNames: normalizePlanToolNames(milestone.toolNames ?? []),
    })),
  };
}

/**
 * Gives acceptance commands an explicit execution root. Idiomatic
 * `cd <dir> && <cmd>` chains are split into `command` + `workspaceRoot`;
 * otherwise the root is inferred from the milestone's declared targetRefs.
 * Only roots inside the Plan workspace are accepted. Exit-0 command checks
 * are retagged as `test_passes`; nonzero checks retain command_exit_code but
 * use the same typed runner. Ambiguous roots, unsafe shell structure,
 * conflicting params, and workspace escapes remain unchanged so the quality
 * gate keeps failing closed.
 */
export function normalizePlanArtifactAcceptanceCommands(
  artifact: PlanArtifact,
  workspaceRoot?: string,
): PlanArtifact {
  const normalizeCheck = (
    check: AcceptanceCheck,
    inferredWorkspaceRoot?: string,
  ): AcceptanceCheck => {
    if (
      !workspaceRoot ||
      (check.kind !== "command_exit_code" && check.kind !== "test_passes")
    ) {
      return check;
    }
    const command =
      typeof check.params.command === "string" ? check.params.command : "";
    const extracted = extractLeadingCdWorkspace(command);
    const existingRoot =
      typeof check.params.workspaceRoot === "string"
        ? check.params.workspaceRoot.trim()
        : "";
    if (!extracted) {
      if (findBlockedShellControl(command) || /^\s*cd\s+/i.test(command)) {
        return check;
      }
      const requestedRoot =
        existingRoot || inferredWorkspaceRoot || workspaceRoot;
      const resolvedRoot = path.isAbsolute(requestedRoot)
        ? path.resolve(requestedRoot)
        : path.resolve(workspaceRoot, requestedRoot);
      const resolvedWorkspace = path.resolve(workspaceRoot);
      if (
        resolvedRoot !== resolvedWorkspace &&
        !resolvedRoot.startsWith(`${resolvedWorkspace}${path.sep}`)
      ) {
        return check;
      }
      const params: Record<string, unknown> = {
        ...check.params,
        workspaceRoot: resolvedRoot,
      };
      if (
        check.kind === "command_exit_code" &&
        Number(check.params.expectedExitCode ?? 0) === 0
      ) {
        delete params.expectedExitCode;
        return { ...check, kind: "test_passes", params };
      }
      return { ...check, params };
    }
    const resolvedDir = path.isAbsolute(extracted.dir)
      ? path.resolve(extracted.dir)
      : path.resolve(workspaceRoot, extracted.dir);
    const resolvedWorkspace = path.resolve(workspaceRoot);
    const resolvedExistingRoot = existingRoot
      ? path.isAbsolute(existingRoot)
        ? path.resolve(existingRoot)
        : path.resolve(workspaceRoot, existingRoot)
      : "";
    if (resolvedExistingRoot && resolvedExistingRoot !== resolvedDir) {
      return check;
    }
    const insideWorkspace =
      resolvedDir === resolvedWorkspace ||
      resolvedDir.startsWith(`${resolvedWorkspace}${path.sep}`);
    if (!insideWorkspace) {
      return check;
    }

    const params: Record<string, unknown> = {
      ...check.params,
      command: extracted.rest,
      workspaceRoot: resolvedDir,
    };
    let kind = check.kind;
    if (
      kind === "command_exit_code" &&
      Number(check.params.expectedExitCode ?? 0) === 0
    ) {
      // test_passes is exactly "command exits 0" and executes through
      // test_run, which honors the workspaceRoot parameter end-to-end.
      kind = "test_passes";
      delete params.expectedExitCode;
    }
    return { ...check, kind, params };
  };

  const milestoneRoots = artifact.milestones.map((milestone) =>
    inferTargetWorkspaceRoot(milestone.targetRefs, workspaceRoot),
  );
  const artifactWorkspaceRoot = commonWorkspaceRoot(
    milestoneRoots.filter((root): root is string => Boolean(root)),
    workspaceRoot,
  );

  return {
    ...artifact,
    acceptanceChecks: (artifact.acceptanceChecks ?? []).map((check) =>
      normalizeCheck(check, artifactWorkspaceRoot),
    ),
    milestones: artifact.milestones.map((milestone, index) => ({
      ...milestone,
      acceptanceChecks: (milestone.acceptanceChecks ?? []).map((check) =>
        normalizeCheck(check, milestoneRoots[index]),
      ),
    })),
  };
}

function inferTargetWorkspaceRoot(
  targetRefs: string[] | undefined,
  planWorkspaceRoot: string | undefined,
): string | undefined {
  if (!planWorkspaceRoot || !targetRefs?.length) return undefined;
  const resolvedPlanRoot = path.resolve(planWorkspaceRoot);
  let candidates = targetRefs
    .map((targetRef) => targetRef.trim())
    .filter(Boolean)
    .map((targetRef) =>
      path.isAbsolute(targetRef)
        ? path.resolve(targetRef)
        : path.resolve(resolvedPlanRoot, targetRef),
    )
    .filter(
      (candidate) =>
        candidate === resolvedPlanRoot ||
        candidate.startsWith(`${resolvedPlanRoot}${path.sep}`),
    )
    .map((candidate) =>
      path.extname(path.basename(candidate)) ? path.dirname(candidate) : candidate,
    );
  if (
    candidates.length === 1 &&
    /^(?:src|lib|scripts?|tests?|evals?|references?|docs?)$/i.test(
      path.basename(candidates[0]),
    )
  ) {
    candidates = [path.dirname(candidates[0])];
  }
  return commonWorkspaceRoot(candidates, resolvedPlanRoot);
}

function commonWorkspaceRoot(
  candidates: string[],
  planWorkspaceRoot: string | undefined,
): string | undefined {
  if (!candidates.length || !planWorkspaceRoot) return undefined;
  const resolvedPlanRoot = path.resolve(planWorkspaceRoot);
  let common = path.resolve(candidates[0]);
  for (const candidate of candidates.slice(1)) {
    const resolvedCandidate = path.resolve(candidate);
    while (
      common !== resolvedPlanRoot &&
      resolvedCandidate !== common &&
      !resolvedCandidate.startsWith(`${common}${path.sep}`)
    ) {
      common = path.dirname(common);
    }
  }
  if (
    common !== resolvedPlanRoot &&
    !common.startsWith(`${resolvedPlanRoot}${path.sep}`)
  ) {
    return undefined;
  }
  return common;
}

function snapshotSkill(skill: GoalSelectedSkill): GoalSelectedSkill {
  return createPublicSkillSnapshot(skill);
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

function partitionAutonomousQuestions(questions: string[]): {
  blocking: string[];
  delegated: string[];
} {
  const blocking: string[] = [];
  const delegated: string[] = [];
  for (const question of unique(questions)) {
    if (
      USER_AUTHORITY_QUESTION_PATTERNS.some((pattern) =>
        pattern.test(question),
      )
    ) {
      blocking.push(question);
    } else {
      delegated.push(question);
    }
  }
  return { blocking, delegated };
}

function toAutonomousAssumption(question: string): string {
  const decision = question.replace(/[?？\s]+$/u, "");
  return `自动模式决策：${decision}；执行 Agent 按工作区证据、最小风险和可验证性选择默认方案，并在结果中记录实际选择。`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isSensitiveSkillInputName(value: string): boolean {
  return /^(?:api_?key|access_?token|refresh_?token|token|password|passwd|secret|authorization|credential)$/i.test(
    value,
  );
}
