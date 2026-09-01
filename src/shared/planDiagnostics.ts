import type {
  PlanQualityIssue,
  PlanRecord,
  PlanReviewIssue,
  PlanningStageKind,
} from "./planMode";

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
  const finalArtifact = plan.finalArtifact
    ? {
        ...plan.finalArtifact,
        // Markdown is a derived workspace projection. Persisting the model's
        // raw markdown field duplicates an unbounded diagnostic channel in
        // JSON/SQLite and plans IPC, so the Plan record stores no copy.
        markdown: "",
        ...(hasReviewDiagnostics
          ? {
              minorityOpinion: ["模型审查意见的原始内容未保存。"],
            }
          : {}),
        ...(plan.qualityReport && plan.qualityReport.status !== "ready"
          ? {
              gateReason:
                "计划质量门禁未通过；原始诊断内容未保存。请提供修订方向后重新规划。",
            }
          : {}),
      }
    : undefined;

  return {
    ...plan,
    rounds: plan.rounds.map((round) => {
      const { failureExcerpt, ...safeRound } = round;
      return {
        ...safeRound,
        ...(round.error
          ? {
              error: round.error === "turn_limit"
                ? "turn_limit"
                : `规划模型轮次 ${(round.kind ?? "unknown").toUpperCase()} 未完成；原始诊断内容未保存。`,
            }
          : {}),
        ...(isContentFreeFailure(failureExcerpt) ? { failureExcerpt } : {}),
      };
    }),
    ...(plan.planningStages
      ? {
          planningStages: plan.planningStages.map((stage) => {
            const { failureExcerpt, ...safeStage } = stage;
            return {
              ...safeStage,
              ...(stage.reviewIssues
                ? { reviewIssues: stage.reviewIssues.map(sanitizePlanReviewIssue) }
                : {}),
              ...(stage.error
                ? { error: safeStageError(stage.kind, stage.error) }
                : {}),
              ...(isContentFreeFailure(failureExcerpt)
                ? { failureExcerpt }
                : {}),
            };
          }),
        }
      : {}),
    ...(plan.qualityReport
      ? {
          qualityReport: {
            ...plan.qualityReport,
            blockingIssues: plan.qualityReport.blockingIssues.map(
              sanitizeQualityIssue,
            ),
            warnings: plan.qualityReport.warnings.map(sanitizeQualityIssue),
            evidenceCoverage: {
              ...plan.qualityReport.evidenceCoverage,
              missingRefs: [],
            },
          },
        }
      : {}),
    ...(finalArtifact ? { finalArtifact } : {}),
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
