import type {
  AcceptanceCheckKind,
  AcceptanceRepairDirective,
  Goal,
  GoalBudget,
  GoalAcceptanceState,
  GoalStatus,
  Milestone,
  MilestoneState,
} from "../shared/agentGoal";
import type { ChatSessionGoalSummary } from "../shared/chat";

export type GoalProgressMetricCard = {
  label: string;
  value: string;
};

export type GoalProgressMilestoneRow = {
  id: string;
  description: string;
  state: MilestoneState;
  stateLabel: string;
  attempts: number;
  runCount: number;
  lastAcceptanceSummary?: string;
};

export type GoalRecoveryAction =
  | "retry_acceptance"
  | "adjust_plan"
  | "terminate";

export type GoalAcceptancePresentation = {
  phase: GoalAcceptanceState["phase"];
  phaseLabel: string;
  occurrence?: number;
  lastDirective?: {
    action: AcceptanceRepairDirective["action"];
    label: string;
  };
  failedCheckIds: string[];
  evidenceRefs: string[];
};

export type GoalCertificatePresentation = {
  acceptedAt: string;
  planVersion: number;
  checks: Array<{
    id: string;
    kind: AcceptanceCheckKind;
    mode: "deterministic" | "inferential";
    passed: boolean;
    code: string;
    evidenceRefs: string[];
  }>;
  artifacts: Array<{
    path?: string;
    sizeBytes?: number;
    shortSha256?: string;
  }>;
  judge?: {
    model: string;
    promptVersion: string;
  };
  shortCertificateHash: string;
};

export type GoalStatusPresentation = Pick<
  GoalProgressViewModel,
  "statusLabel" | "statusDetail" | "nextActionLabel" | "nextActionDetail"
> & {
  recoveryActions: GoalRecoveryAction[];
  acceptance?: GoalAcceptancePresentation;
  certificate?: GoalCertificatePresentation;
};

export type GoalProgressViewModel = {
  status: GoalStatus;
  statusLabel: string;
  statusDetail: string;
  nextActionLabel: string;
  nextActionDetail: string;
  progressText: string;
  metricCards: GoalProgressMetricCard[];
  milestoneRows: GoalProgressMilestoneRow[];
  recoveryActions: GoalRecoveryAction[];
  acceptance?: GoalAcceptancePresentation;
  certificate?: GoalCertificatePresentation;
};

const MAX_CHECKS = 10;
const MAX_ARTIFACTS = 10;
const MAX_FAILED_CHECK_IDS = 10;
const MAX_EVIDENCE_REFS = 20;
const MAX_ID_LENGTH = 120;
const MAX_CODE_LENGTH = 120;
const MAX_REF_LENGTH = 240;
const MAX_PATH_LENGTH = 500;
const MAX_METADATA_LENGTH = 160;

export function buildGoalBudgetIncreaseDelta(
  goal: Goal | null,
): Partial<GoalBudget> {
  if (!goal) {
    return {
      maxIterations: 8,
      maxToolCalls: 64,
      maxWallClockMs: 45 * 60 * 1000,
      maxReplans: 3,
    };
  }

  const delta: Partial<GoalBudget> = {};
  if (goal.budgetUsage.iterations >= goal.budget.maxIterations) {
    delta.maxIterations = Math.max(
      1,
      goal.budget.maxIterations,
      goal.budgetUsage.iterations,
    );
  }
  if (goal.budgetUsage.toolCalls >= goal.budget.maxToolCalls) {
    delta.maxToolCalls = Math.max(
      1,
      goal.budget.maxToolCalls,
      goal.budgetUsage.toolCalls,
    );
  }
  if (goal.budgetUsage.wallClockMs >= goal.budget.maxWallClockMs) {
    delta.maxWallClockMs = Math.max(
      60_000,
      goal.budget.maxWallClockMs,
      goal.budgetUsage.wallClockMs,
    );
  }
  if (goal.budgetUsage.replans >= goal.budget.maxReplans) {
    delta.maxReplans = Math.max(
      1,
      goal.budget.maxReplans,
      goal.budgetUsage.replans,
    );
  }
  if (
    goal.budget.maxTokens !== undefined &&
    goal.budgetUsage.tokens >= goal.budget.maxTokens
  ) {
    delta.maxTokens = Math.max(
      1,
      goal.budget.maxTokens,
      goal.budgetUsage.tokens,
    );
  }

  if (Object.keys(delta).length === 0) {
    delta.maxIterations = Math.max(1, goal.budget.maxIterations);
  }
  return delta;
}

export function buildGoalProgressViewModel(
  summary: ChatSessionGoalSummary,
  goal: Goal | null,
): GoalProgressViewModel {
  const status = summary.status;
  const milestones = goal?.milestones ?? [];
  const acceptedCount = milestones.filter((milestone) =>
    milestone.state === "accepted" || milestone.state === "skipped"
  ).length;
  const totalCount = milestones.length;
  const nextMilestone = findCurrentMilestone(milestones);

  return {
    status,
    ...buildGoalStatusPresentation(status, goal, nextMilestone),
    progressText: totalCount > 0
      ? `${acceptedCount}/${totalCount} 已完成`
      : "尚未生成里程碑",
    metricCards: buildMetricCards(goal),
    milestoneRows: milestones.map(toMilestoneRow),
  };
}

export function buildGoalStatusPresentation(
  status: GoalStatus,
  goal: Goal | null,
  milestone: Milestone | null = goal ? findCurrentMilestone(goal.milestones) : null,
): GoalStatusPresentation {
  const milestoneDetail = milestone
    ? `Milestone ${milestone.id}：${milestone.description}`
    : "还没有可执行的里程碑。";
  const acceptance = projectAcceptance(goal);
  const certificate = projectCertificate(goal);

  if (status === "executing" && acceptance?.phase === "validating") {
    return withAcceptance({
      statusLabel: "正在验收",
      statusDetail: "正在运行确定性验收检查，完成前不会把目标标记为已达成。",
      nextActionLabel: "当前阶段",
      nextActionDetail: acceptanceDetail(acceptance),
    }, acceptance, certificate);
  }

  if (
    status === "executing" &&
    acceptance?.lastDirective?.action === "repair_same_milestone" &&
    acceptance.occurrence === 1
  ) {
    return withAcceptance({
      statusLabel: "正在修复验收问题（1/2）",
      statusDetail: `验收未通过，正在修复同一里程碑。${failedChecksDetail(acceptance)}`,
      nextActionLabel: "验收修复",
      nextActionDetail: acceptanceDetail(acceptance),
    }, acceptance, certificate);
  }

  if (
    status === "executing" &&
    acceptance?.lastDirective?.action === "retry_alternate_strategy" &&
    acceptance.occurrence === 2
  ) {
    return withAcceptance({
      statusLabel: "已切换策略（2/2）",
      statusDetail: `相同问题再次出现，已切换执行策略。${failedChecksDetail(acceptance)}`,
      nextActionLabel: "替代策略",
      nextActionDetail: acceptanceDetail(acceptance),
    }, acceptance, certificate);
  }

  switch (status) {
    case "planning":
      return {
        statusLabel: "已规划，待启动",
        statusDetail:
          "目标已经记录，还没有开始执行。点击“开始执行”后，智能体会按里程碑推进。",
        nextActionLabel: "开始执行",
        nextActionDetail: milestoneDetail,
        recoveryActions: [],
        ...(acceptance ? { acceptance } : {}),
      };
    case "executing":
      return {
        statusLabel: "执行中",
        statusDetail: "智能体正在按里程碑推进目标，进度会随运行和验收更新。",
        nextActionLabel: "当前阶段",
        nextActionDetail: milestoneDetail,
        recoveryActions: [],
        ...(acceptance ? { acceptance } : {}),
      };
    case "waiting_for_review":
      return {
        statusLabel: "等待审核",
        statusDetail: "目标已暂停在审核门，需要你决定继续、修改计划或终止。",
        nextActionLabel: "需要你处理",
        nextActionDetail: milestoneDetail,
        recoveryActions: [],
        ...(acceptance ? { acceptance } : {}),
      };
    case "achieved":
      const isLegacyAchieved = goal?.acceptanceProtocolVersion !== 2;
      return withAcceptance({
        statusLabel: "已达成",
        statusDetail: certificate
          ? "目标验收已通过并生成验收证书，当前目标已经结束。"
          : isLegacyAchieved
            ? "历史目标已达成，但完成时尚未生成验收证书。"
            : "目标记录为已达成，但验收证书不可用，无法展示认证详情。",
        nextActionLabel: certificate
          ? "查看验收证书"
          : isLegacyAchieved
            ? "历史验收记录"
            : "证书不可用",
        nextActionDetail: certificate
          ? "可在目标详情中查看安全、精简的证书元数据。"
          : isLegacyAchieved
            ? "这是旧版完成记录，不会补造验收证书。"
            : "不会为缺失或无效的证书补造展示数据。",
      }, acceptance, certificate);
    case "stopped_budget":
      return {
        statusLabel: "预算已用尽",
        statusDetail:
          "目标已达到执行预算上限并停止，不会在后台继续。你可以查看证据，或明确增加预算后继续。",
        nextActionLabel: "需要你处理",
        nextActionDetail: `查看证据或增加预算继续。${milestoneDetail}`,
        recoveryActions: [],
        ...(acceptance ? { acceptance } : {}),
      };
    case "stopped_stalled":
      return {
        statusLabel: "停滞停止",
        statusDetail:
          acceptance &&
          (acceptance.lastDirective?.action === "stop_stalled" ||
            (acceptance.occurrence ?? 0) >= 3)
            ? `目标因重复验收失败而停止，不会继续自动重试。${failedChecksDetail(acceptance)}`
            : "目标因为没有可推进的里程碑停止，需要重新规划。",
        nextActionLabel: "停止原因",
        nextActionDetail: acceptance
          ? acceptanceDetail(acceptance)
          : "没有 ready 里程碑可执行。",
        recoveryActions: [],
        ...(acceptance ? { acceptance } : {}),
      };
    case "stopped_blocked":
      return withAcceptance({
        statusLabel: "目标受阻",
        statusDetail: describeBlockedReason(goal?.stopReason),
        nextActionLabel: "需要你处理",
        nextActionDetail: acceptance
          ? acceptanceDetail(acceptance)
          : "可重试验收、调整计划或终止目标。",
        recoveryActions: ["retry_acceptance", "adjust_plan", "terminate"],
      }, acceptance, certificate);
    case "failed":
      return {
        statusLabel: "失败",
        statusDetail: "目标执行遇到不可恢复的问题，需要查看运行证据后处理。",
        nextActionLabel: "恢复路径",
        nextActionDetail:
          "使用下方“重试目标”或“结束目标”处理，失败记录会保留用于排查。",
        recoveryActions: [],
        ...(acceptance ? { acceptance } : {}),
      };
    case "canceled":
      return {
        statusLabel: "已取消",
        statusDetail: "目标已经由用户取消，不会继续执行。",
        nextActionLabel: "结束状态",
        nextActionDetail: "无需继续执行。",
        recoveryActions: [],
        ...(acceptance ? { acceptance } : {}),
      };
  }
}

function projectAcceptance(goal: Goal | null): GoalAcceptancePresentation | undefined {
  const rawState = asRecord(goal?.acceptanceState);
  if (!rawState) {
    return undefined;
  }

  const phase = isAcceptancePhase(rawState.phase) ? rawState.phase : "idle";
  const rawFailures = Array.isArray(rawState.recentFailures)
    ? rawState.recentFailures
    : [];
  const latestFailure = asRecord(rawFailures.at(-1));
  const rawDecision = asRecord(rawState.lastDecision);
  const action = isRepairAction(rawDecision?.action)
    ? rawDecision.action
    : undefined;
  const occurrence = safePositiveInteger(rawDecision?.occurrence) ??
    safePositiveInteger(latestFailure?.occurrence);
  const failedCheckIds = boundedUniqueStrings(
    [
      ...(Array.isArray(rawDecision?.failedCheckIds)
        ? rawDecision.failedCheckIds
        : []),
      ...(Array.isArray(latestFailure?.failedCheckIds)
        ? latestFailure.failedCheckIds
        : []),
    ],
    MAX_FAILED_CHECK_IDS,
    MAX_ID_LENGTH,
  );
  const evidenceRefs = boundedUniqueStrings(
    Array.isArray(latestFailure?.evidenceRefs) ? latestFailure.evidenceRefs : [],
    MAX_EVIDENCE_REFS,
    MAX_REF_LENGTH,
  );

  return {
    phase,
    phaseLabel: acceptancePhaseLabel(phase),
    ...(occurrence ? { occurrence } : {}),
    ...(action
      ? { lastDirective: { action, label: repairActionLabel(action) } }
      : {}),
    failedCheckIds,
    evidenceRefs,
  };
}

function projectCertificate(goal: Goal | null): GoalCertificatePresentation | undefined {
  const rawCertificate = asRecord(goal?.acceptanceCertificate);
  if (!rawCertificate) {
    return undefined;
  }

  const acceptedAt = safeString(rawCertificate.acceptedAt, MAX_METADATA_LENGTH);
  const planVersion = safeNonNegativeInteger(rawCertificate.planVersion);
  const certificateHash = safeHash(rawCertificate.certificateHash);
  if (!acceptedAt || planVersion === undefined || !certificateHash) {
    return undefined;
  }

  const checks = (Array.isArray(rawCertificate.checkResults)
    ? rawCertificate.checkResults
    : [])
    .slice(0, MAX_CHECKS)
    .flatMap((value) => {
      const check = asRecord(value);
      const id = safeString(check?.checkId, MAX_ID_LENGTH);
      const kind = safeAcceptanceCheckKind(check?.kind);
      const code = safeString(check?.code, MAX_CODE_LENGTH);
      if (!check || !id || !kind || !code || typeof check.passed !== "boolean") {
        return [];
      }
      return [{
        id,
        kind,
        mode: kind === "model_review"
          ? "inferential" as const
          : "deterministic" as const,
        passed: check.passed,
        code,
        evidenceRefs: boundedUniqueStrings(
          Array.isArray(check.evidenceRefs) ? check.evidenceRefs : [],
          MAX_EVIDENCE_REFS,
          MAX_REF_LENGTH,
        ),
      }];
    });

  const artifacts = (Array.isArray(rawCertificate.evidence)
    ? rawCertificate.evidence
    : [])
    .slice(0, MAX_ARTIFACTS)
    .flatMap((value) => {
      const artifact = asRecord(value);
      if (!artifact) {
        return [];
      }
      const path = safeString(artifact.path, MAX_PATH_LENGTH);
      const sizeBytes = safeNonNegativeInteger(artifact.sizeBytes);
      const sha256 = safeHash(artifact.sha256);
      if (!path && sizeBytes === undefined && !sha256) {
        return [];
      }
      return [{
        ...(path ? { path } : {}),
        ...(sizeBytes !== undefined ? { sizeBytes } : {}),
        ...(sha256 ? { shortSha256: sha256.slice(0, 12) } : {}),
      }];
    });

  const rawJudge = asRecord(rawCertificate.judge);
  const model = safeString(rawJudge?.model, MAX_METADATA_LENGTH);
  const promptVersion = safeString(rawJudge?.promptVersion, MAX_METADATA_LENGTH);

  return {
    acceptedAt,
    planVersion,
    checks,
    artifacts,
    ...(model && promptVersion ? { judge: { model, promptVersion } } : {}),
    shortCertificateHash: certificateHash.slice(0, 12),
  };
}

function withAcceptance(
  base: Omit<GoalStatusPresentation, "recoveryActions" | "acceptance" | "certificate"> &
    Partial<Pick<GoalStatusPresentation, "recoveryActions">>,
  acceptance: GoalAcceptancePresentation | undefined,
  certificate: GoalCertificatePresentation | undefined,
): GoalStatusPresentation {
  return {
    ...base,
    recoveryActions: base.recoveryActions ?? [],
    ...(acceptance ? { acceptance } : {}),
    ...(certificate ? { certificate } : {}),
  };
}

function describeBlockedReason(reason: Goal["stopReason"]): string {
  switch (reason) {
    case "external_blocked":
      return "目标受到外部依赖阻塞；恢复依赖后可重试验收，或调整计划。";
    case "goal_impossible":
      return "当前条件被判定为无法实现，必须调整目标或计划后再继续。";
    case "acceptance_unavailable":
      return "验收服务暂时不可用，目标未被标记为完成。可稍后重试验收。";
    default:
      return "目标验收受阻，尚未完成。可重试验收、调整计划或终止目标。";
  }
}

function acceptanceDetail(acceptance: GoalAcceptancePresentation): string {
  const parts = [acceptance.phaseLabel];
  if (acceptance.lastDirective) {
    parts.push(`决策：${acceptance.lastDirective.label}`);
  }
  if (acceptance.occurrence) {
    parts.push(`第 ${acceptance.occurrence} 次`);
  }
  if (acceptance.failedCheckIds.length > 0) {
    parts.push(`失败检查：${acceptance.failedCheckIds.join("、")}`);
  }
  return parts.join(" · ");
}

function failedChecksDetail(acceptance: GoalAcceptancePresentation): string {
  return acceptance.failedCheckIds.length > 0
    ? `失败检查：${acceptance.failedCheckIds.join("、")}。`
    : "";
}

function acceptancePhaseLabel(phase: GoalAcceptanceState["phase"]): string {
  const labels: Record<GoalAcceptanceState["phase"], string> = {
    idle: "等待验收",
    validating: "正在验收",
    repairing: "修复验收问题",
    judging: "最终语义验收",
    blocked: "验收受阻",
    certified: "验收已认证",
  };
  return labels[phase];
}

function repairActionLabel(action: AcceptanceRepairDirective["action"]): string {
  const labels: Record<AcceptanceRepairDirective["action"], string> = {
    repair_same_milestone: "修复同一里程碑",
    retry_alternate_strategy: "切换执行策略",
    replan: "重新规划",
    stop_stalled: "重复失败后停止",
    stop_blocked: "等待用户处理阻塞",
  };
  return labels[action];
}

function isAcceptancePhase(value: unknown): value is GoalAcceptanceState["phase"] {
  return value === "idle" || value === "validating" || value === "repairing" ||
    value === "judging" || value === "blocked" || value === "certified";
}

function isRepairAction(value: unknown): value is AcceptanceRepairDirective["action"] {
  return value === "repair_same_milestone" ||
    value === "retry_alternate_strategy" || value === "replan" ||
    value === "stop_stalled" || value === "stop_blocked";
}

function safeAcceptanceCheckKind(value: unknown): AcceptanceCheckKind | undefined {
  const kind = safeString(value, MAX_ID_LENGTH);
  return kind as AcceptanceCheckKind | undefined;
}

function boundedUniqueStrings(
  values: unknown[],
  limit: number,
  maxLength: number,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const safe = safeString(value, maxLength);
    if (!safe || seen.has(safe)) {
      continue;
    }
    seen.add(safe);
    result.push(safe);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function safeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function safeHash(value: unknown): string | undefined {
  const hash = safeString(value, 64);
  return hash && /^[a-f\d]{12,64}$/i.test(hash) ? hash : undefined;
}

function safePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function safeNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function buildMetricCards(goal: Goal | null): GoalProgressMetricCard[] {
  if (!goal) {
    return [
      { label: "状态", value: "加载中" },
      { label: "运行", value: "待加载" },
    ];
  }

  return [
    {
      label: "迭代",
      value: String(goal.budgetUsage.iterations),
    },
    {
      label: "工具调用",
      value: String(goal.budgetUsage.toolCalls),
    },
    {
      label: "运行时间",
      value: `${formatMinutes(goal.budgetUsage.wallClockMs)} 分钟`,
    },
    {
      label: "重规划",
      value: String(goal.budgetUsage.replans),
    },
  ];
}

function findCurrentMilestone(milestones: Milestone[]): Milestone | null {
  return (
    milestones.find((milestone) => milestone.state === "running") ??
    milestones.find((milestone) => milestone.state === "ready") ??
    milestones.find((milestone) => milestone.state === "pending") ??
    milestones[0] ??
    null
  );
}

function toMilestoneRow(milestone: Milestone): GoalProgressMilestoneRow {
  return {
    id: milestone.id,
    description: milestone.description,
    state: milestone.state,
    stateLabel: translateMilestoneState(milestone.state),
    attempts: milestone.attempts,
    runCount: milestone.runIds.length,
    ...(milestone.lastAcceptanceSummary
      ? { lastAcceptanceSummary: milestone.lastAcceptanceSummary }
      : {}),
  };
}

function translateMilestoneState(state: MilestoneState): string {
  const labels: Record<MilestoneState, string> = {
    pending: "等待前置",
    ready: "待执行",
    running: "执行中",
    accepted: "已完成",
    rejected: "验收未通过",
    skipped: "已跳过",
    failed: "失败",
  };
  return labels[state];
}

function formatMinutes(milliseconds: number): string {
  const minutes = milliseconds / 60_000;
  if (Number.isInteger(minutes)) {
    return String(minutes);
  }
  return minutes.toFixed(1);
}
