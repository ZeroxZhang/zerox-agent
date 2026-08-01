import type {
  AcceptanceCheck,
  AcceptanceCheckKind,
  GoalSelectedSkill,
  GoalStatus,
  Milestone,
  SuccessCriterion,
} from "./agentGoal";
import type { ResolvedModelBinding } from "./modelSettings";
import { extractLeadingCdWorkspace } from "./acceptanceCommand";

export type GoalDraftStatus = "draft" | "confirmed" | "discarded";

export type GoalDraftWarningCode =
  | "planning_model_unavailable"
  | "invalid_check_kind_clamped"
  | "model_review_requires_evidence"
  | "model_only_acceptance"
  | "missing_deterministic_checks"
  | "empty_success_criteria"
  | "cd_chain_acceptance_command_rewritten";

export type GoalDraftWarning = {
  code: GoalDraftWarningCode;
  severity: "info" | "warning" | "error";
  message: string;
  criterionId?: string;
  checkId?: string;
};

export type GoalAcceptanceCoverage = {
  deterministicChecks: number;
  modelReviewChecks: number;
  totalChecks: number;
  hasDeterministicCoverage: boolean;
  hasModelReviewCoverage: boolean;
};

export type GoalDraft = {
  id: string;
  sessionId: string;
  workspaceId?: string;
  originMessageId?: string;
  sourceMessage: string;
  sourcePlanRef?: {
    planId: string;
    revision: number;
    sha256: string;
  };
  /** Frozen model selected for execution when this draft came from Plan Mode. */
  executionModelBinding?: ResolvedModelBinding;
  normalizedDescription: string;
  successCriteria: SuccessCriterion[];
  acceptanceCoverage: GoalAcceptanceCoverage;
  warnings: GoalDraftWarning[];
  milestones?: Milestone[];
  selectedSkill?: GoalSelectedSkill;
  selectedSkillInputValues?: Record<string, string | number | boolean>;
  status: GoalDraftStatus;
  createdAt: string;
  updatedAt: string;
};

export type GoalDraftEdit = {
  normalizedDescription?: string;
  successCriteria?: SuccessCriterion[];
  milestones?: Milestone[];
};

export type GoalDraftConfirmResult =
  | {
      ok: true;
      draft: GoalDraft;
      activeGoal: {
        id: string;
        description: string;
        status: GoalStatus;
      };
    }
  | { ok: false; message: string };

export type GoalDraftDiscardResult =
  | { ok: true; draft: GoalDraft; message: string }
  | { ok: false; message: string };

const allowedAcceptanceCheckKinds: AcceptanceCheckKind[] = [
  "file_exists",
  "command_exit_code",
  "test_passes",
  "assertion",
  "model_review",
];

export function normalizeGoalDraftCriteria(
  criteria: SuccessCriterion[],
): {
  successCriteria: SuccessCriterion[];
  acceptanceCoverage: GoalAcceptanceCoverage;
  warnings: GoalDraftWarning[];
} {
  const warnings: GoalDraftWarning[] = [];
  const successCriteria =
    criteria.length > 0
      ? criteria.map((criterion, criterionIndex) =>
          normalizeSuccessCriterion(criterion, criterionIndex, warnings),
        )
      : [
          normalizeSuccessCriterion(
            {
              id: "criterion_goal_satisfied",
              description: "Goal outcome is verifiably satisfied.",
              acceptanceChecks: [],
            },
            0,
            warnings,
          ),
        ];

  if (criteria.length === 0) {
    warnings.push({
      code: "empty_success_criteria",
      severity: "warning",
      message: "目标草案缺少成功标准，已补充一个需要证据的复核标准。",
    });
  }

  const checks = successCriteria.flatMap((criterion) => criterion.acceptanceChecks);
  const deterministicChecks = checks.filter(
    (check) => check.kind !== "model_review",
  ).length;
  const modelReviewChecks = checks.filter(
    (check) => check.kind === "model_review",
  ).length;

  if (deterministicChecks === 0) {
    warnings.push({
      code: modelReviewChecks > 0 ? "model_only_acceptance" : "missing_deterministic_checks",
      severity: "warning",
      message:
        "当前验收主要依赖模型复核。建议补充文件、命令、测试或断言类检查，让目标完成判断更可度量。",
    });
  }

  return {
    successCriteria,
    acceptanceCoverage: {
      deterministicChecks,
      modelReviewChecks,
      totalChecks: checks.length,
      hasDeterministicCoverage: deterministicChecks > 0,
      hasModelReviewCoverage: modelReviewChecks > 0,
    },
    warnings: dedupeGoalDraftWarnings(warnings),
  };
}

function normalizeSuccessCriterion(
  criterion: SuccessCriterion,
  criterionIndex: number,
  warnings: GoalDraftWarning[],
): SuccessCriterion {
  const criterionId = safeId(criterion.id, `criterion_${criterionIndex + 1}`);
  const checks =
    criterion.acceptanceChecks.length > 0
      ? criterion.acceptanceChecks
      : [
          {
            id: `${criterionId}_review`,
            kind: "model_review" as const,
            description:
              "An independent judge confirms the goal condition from recorded execution evidence.",
            params: {
              condition: criterion.description,
              evidenceRefs: ["artifact:goalEvidence"],
            },
            requiresEvidence: true,
          },
        ];

  return {
    id: criterionId,
    description: String(criterion.description ?? "").trim() || "Goal outcome is satisfied.",
    acceptanceChecks: checks.map((check, checkIndex) =>
      normalizeAcceptanceCheck(check, criterionId, checkIndex, warnings),
    ),
  };
}

function normalizeAcceptanceCheck(
  check: AcceptanceCheck,
  criterionId: string,
  checkIndex: number,
  warnings: GoalDraftWarning[],
): AcceptanceCheck {
  const id = safeId(check.id, `${criterionId}_check_${checkIndex + 1}`);
  let kind = allowedAcceptanceCheckKinds.includes(check.kind)
    ? check.kind
    : "model_review";
  const params =
    check.params && typeof check.params === "object" ? { ...check.params } : {};
  let requiresEvidence = Boolean(check.requiresEvidence);

  if (kind !== check.kind) {
    warnings.push({
      code: "invalid_check_kind_clamped",
      severity: "warning",
      criterionId,
      checkId: id,
      message: `验收检查 ${id} 使用了不支持的类型，已降级为模型复核。`,
    });
  }

  // Planner models routinely write "run CMD in directory X" as the
  // idiomatic `cd X && CMD` chain, which the acceptance sandbox rejects
  // outright (shell control operators are forbidden so every command stays
  // a single statically checkable invocation). Rewrite the chain into the
  // params form instead: the acceptance runner resolves workspaceRoot
  // against the goal workspace and fail-closes on anything outside the
  // boundary, so semantics are preserved without weakening containment.
  // Mirrors normalizePlanArtifactAcceptanceCommands on the plan path.
  const expectedExitCode = Number(params.expectedExitCode ?? 0);
  const rewritableCommandCheck =
    kind === "test_passes" ||
    (kind === "command_exit_code" && expectedExitCode === 0);
  if (rewritableCommandCheck) {
    const command = typeof params.command === "string" ? params.command : "";
    const extracted = extractLeadingCdWorkspace(command);
    if (extracted) {
      const existingRoot =
        typeof params.workspaceRoot === "string"
          ? params.workspaceRoot.trim()
          : "";
      if (!existingRoot || existingRoot === extracted.dir) {
        params.command = extracted.rest;
        if (extracted.dir === "." || extracted.dir === "./") {
          delete params.workspaceRoot;
        } else {
          params.workspaceRoot = extracted.dir;
        }
        if (kind === "command_exit_code") {
          // test_passes is exactly "command exits 0" and executes through
          // test_run, which honors the workspaceRoot parameter end-to-end
          // (command_exit_code runs through shell_exec and ignores it).
          kind = "test_passes";
          delete params.expectedExitCode;
        }
        warnings.push({
          code: "cd_chain_acceptance_command_rewritten",
          severity: "warning",
          criterionId,
          checkId: id,
          message: `验收检查 ${id} 的 cd 链式命令已改写为 workspaceRoot 参数形式。`,
        });
      }
    }
  }

  if (kind === "model_review") {
    const evidenceRefs = Array.isArray(params.evidenceRefs)
      ? params.evidenceRefs.filter((value): value is string => typeof value === "string")
      : [];

    if (!requiresEvidence || evidenceRefs.length === 0) {
      requiresEvidence = true;
      params.evidenceRefs = evidenceRefs.length ? evidenceRefs : ["artifact:goalEvidence"];
      warnings.push({
        code: "model_review_requires_evidence",
        severity: "warning",
        criterionId,
        checkId: id,
        message: `模型复核检查 ${id} 必须绑定执行证据，已自动要求证据。`,
      });
    }
  }

  return {
    id,
    kind,
    description: String(check.description ?? "").trim() || "Acceptance check passes.",
    params,
    requiresEvidence,
  };
}

function safeId(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_") || fallback;
}

function dedupeGoalDraftWarnings(warnings: GoalDraftWarning[]): GoalDraftWarning[] {
  const seen = new Set<string>();
  const deduped: GoalDraftWarning[] = [];
  for (const warning of warnings) {
    const key = [
      warning.code,
      warning.criterionId ?? "",
      warning.checkId ?? "",
      warning.message,
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(warning);
  }
  return deduped;
}
