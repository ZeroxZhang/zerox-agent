import type { Goal } from "../../shared/agentGoal";
import type { ChatSessionGoalSummary } from "../../shared/chat";
import { buildGoalProgressViewModel } from "../goalProgressViewModel";

type GoalStatusStripProps = {
  goal: ChatSessionGoalSummary;
  detail: Goal | null;
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
  const currentMilestone = progress.milestoneRows.find(
    (m) => m.state === "running" || m.state === "ready",
  );

  return (
    <div className={`goal-status-strip is-${progress.status}`}>
      <div className="goal-status-strip-main">
        <div className="goal-status-strip-dot" aria-hidden="true" />
        <div className="goal-status-strip-text">
          <strong>{progress.statusLabel}</strong>
          <small>
            {progress.acceptance
              ? `${progress.acceptance.phaseLabel}${
                  progress.acceptance.lastDirective
                    ? ` · ${progress.acceptance.lastDirective.label}`
                    : ""
                }`
              : currentMilestone
              ? `${currentMilestone.stateLabel} · ${currentMilestone.description}`
              : progress.statusDetail}
            {" "}· {progress.progressText}
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
      return props.onContinueAcceptance ? (
        <button
          type="button"
          className="goal-primary-action"
          disabled={props.goalAcceptanceOperationPending}
          onClick={props.onContinueAcceptance}
        >
          继续验收
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
