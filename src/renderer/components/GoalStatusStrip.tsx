import type { Goal } from "../../shared/agentGoal";
import type { ChatSessionGoalSummary } from "../../shared/chat";
import type { PlanRecord } from "../../shared/planMode";
import { getPlanOutcomePresentation } from "../planFailurePresentation";
import { buildGoalProgressViewModel } from "../goalProgressViewModel";

type GoalStatusStripProps = {
  goal: ChatSessionGoalSummary;
  detail: Goal | null;
  activePlan?: PlanRecord | null;
  planCandidate?: PlanRecord | null;
  recovery?: boolean;
  onViewDetail: () => void;
  onStart?: () => void;
  onPause?: () => void;
  onResolveReview?: (decision: "approve" | "reject" | "terminate") => void;
  onReplan?: () => void;
  onRetry?: () => void;
  onContinueAcceptance?: () => void;
  goalAcceptanceOperationPending?: boolean;
  onCancel?: () => void;
};

export function GoalStatusStrip(props: GoalStatusStripProps) {
  const progress = buildGoalProgressViewModel(props.goal, props.detail);
  const showRecovery = Boolean(
    props.recovery && progress.status !== "waiting_for_acceptance",
  );
  const currentMilestone = progress.milestoneRows.find(
    (m) => m.state === "running" || m.state === "ready",
  );
  const activePlanOutcome =
    props.activePlan?.status === "steps_completed"
      ? getPlanOutcomePresentation(props.activePlan)
      : null;
  const amendment = props.detail?.pendingGoalAmendment;
  const amendmentPending =
    amendment?.status === "pending" || amendment?.status === "approved";

  return (
    <div className={`goal-status-strip is-${progress.status}`}>
      <div className="goal-status-strip-main">
        <div className="goal-status-strip-dot" aria-hidden="true" />
        <div className="goal-status-strip-text">
          <strong>
            {showRecovery
              ? "之前的目标待恢复"
              : amendment?.status === "pending"
                ? "目标修订等待批准"
                : amendment?.status === "approved"
                  ? "目标修订已批准，等待采用 Plan"
                  : progress.statusLabel}
          </strong>
          <small>
            {showRecovery
              ? "当前结果不会自动改写原 Goal；重试后将沿用原 Plan、里程碑和验收记录"
              : amendmentPending
                ? amendment?.status === "pending"
                  ? "GoalContract 和活动 Plan 尚未改变，请在详情中批准或拒绝"
                  : "只有采用对应的 Direct Plan 后，新 GoalContract 才会生效"
              : activePlanOutcome
              ? `${activePlanOutcome.title} · ${activePlanOutcome.nextAction}`
              : progress.acceptance
              ? `${progress.acceptance.phaseLabel}${
                  progress.acceptance.lastDirective
                    ? ` · ${progress.acceptance.lastDirective.label}`
                    : ""
                }`
              : currentMilestone
              ? `${currentMilestone.stateLabel} · ${currentMilestone.description}`
                : progress.statusDetail}
            {showRecovery ? "" : ` · ${progress.progressText}`}
          </small>
        </div>
      </div>
      <div className="goal-status-strip-actions">
        <button type="button" onClick={props.onViewDetail}>
          详情
        </button>
        {renderStatusAction(props, progress)}
      </div>
    </div>
  );
}

function renderStatusAction(
  props: GoalStatusStripProps,
  progress: ReturnType<typeof buildGoalProgressViewModel>,
) {
  const amendment = props.detail?.pendingGoalAmendment;
  if (
    amendment?.status === "pending" ||
    amendment?.status === "approved" ||
    isOpenRuntimePlanCandidate(props.planCandidate)
  ) {
    return null;
  }
  switch (progress.status) {
    case "planning":
    case "canceled":
      return props.onStart ? (
        <button type="button" onClick={props.onStart}>
          开始
        </button>
      ) : null;
    case "executing":
      return props.onPause ? (
        <button type="button" onClick={props.onPause}>
          暂停
        </button>
      ) : null;
    case "waiting_for_review":
      return props.onResolveReview ? (
        <>
          <button
            type="button"
            className="goal-primary-action"
            onClick={() => props.onResolveReview!("approve")}
          >
            继续
          </button>
          <button
            type="button"
            onClick={() => props.onResolveReview!("reject")}
          >
            调整
          </button>
          <button
            type="button"
            className="goal-danger-action"
            onClick={() => props.onResolveReview!("terminate")}
          >
            终止
          </button>
        </>
      ) : null;
    case "waiting_for_model":
      return props.onRetry ? (
        <button type="button" className="goal-primary-action" onClick={props.onRetry}>
          {props.detail?.modelServiceNotice?.kind === "output_limit"
            ? "继续生成"
            : "重试模型"}
        </button>
      ) : null;
    case "stopped_budget":
      return null;
    case "stopped_stalled":
      return props.onRetry || props.onReplan ? (
        <>
          {props.onRetry ? (
            <button
              type="button"
              className="goal-primary-action"
              onClick={props.onRetry}
            >
              重试目标
            </button>
          ) : null}
          {props.onReplan ? (
            <button type="button" onClick={props.onReplan}>
              重新规划
            </button>
          ) : null}
        </>
      ) : null;
    case "stopped_blocked":
      return props.onRetry ? (
        <button
          type="button"
          className="goal-primary-action"
          aria-label="重试验收"
          onClick={props.onRetry}
        >
          重试验收
        </button>
      ) : null;
    case "waiting_for_acceptance":
      return props.onContinueAcceptance || props.onRetry ? (
        <button
          type="button"
          className="goal-primary-action"
          disabled={props.goalAcceptanceOperationPending}
          onClick={props.onContinueAcceptance ?? props.onRetry}
        >
          继续最终验收
        </button>
      ) : null;
    case "failed":
      return props.onRetry ? (
        <button type="button" onClick={props.onRetry}>
          重试
        </button>
      ) : null;
    default:
      return null;
  }
}

function isOpenRuntimePlanCandidate(plan: PlanRecord | null | undefined): boolean {
  return Boolean(
    plan?.purpose === "runtime_replan" &&
      !plan.executionGoalId &&
      !["discarded", "superseded", "completed", "steps_completed"].includes(
        plan.status,
      ),
  );
}
