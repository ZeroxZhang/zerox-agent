import type { ChatSessionGoalSummary } from "../../shared/chat";
import { buildGoalProgressViewModel } from "../goalProgressViewModel";

type GoalContractBarProps = {
  goal: ChatSessionGoalSummary;
  onEnd: () => void;
  onModify: () => void;
  onPause?: () => void;
  onStart?: () => void;
  onViewProgress: () => void;
  onIncreaseBudget?: () => void;
  onReplan?: () => void;
  onRetry?: () => void;
};

export function GoalContractBar(props: GoalContractBarProps) {
  const progress = buildGoalProgressViewModel(props.goal, null);

  return (
    <section className={`goal-contract-bar is-${props.goal.status}`}>
      <div>
        <span>Goal</span>
        <strong>{props.goal.description}</strong>
        <em>{progress.statusDetail}</em>
      </div>
      <small>{progress.statusLabel}</small>
      <div className="goal-contract-actions">
        {canStartGoal(props.goal.status) && props.onStart ? (
          <button
            className="goal-primary-action"
            type="button"
            onClick={props.onStart}
          >
            {progress.nextActionLabel}
          </button>
        ) : null}
        <button type="button" onClick={props.onViewProgress}>
          查看进度
        </button>
        <button type="button" onClick={props.onModify}>
          修改
        </button>
        {props.onPause ? (
          <button type="button" onClick={props.onPause}>
            暂停
          </button>
        ) : null}
        {props.goal.status === "stopped_budget" && props.onIncreaseBudget ? (
          <button type="button" onClick={props.onIncreaseBudget}>
            增加预算
          </button>
        ) : null}
        {props.goal.status === "stopped_stalled" && props.onReplan ? (
          <button type="button" onClick={props.onReplan}>
            重新规划
          </button>
        ) : null}
        {(props.goal.status === "failed" ||
          props.goal.status === "stopped_stalled") &&
        props.onRetry ? (
          <button type="button" onClick={props.onRetry}>
            重试
          </button>
        ) : null}
        <button type="button" onClick={props.onEnd}>
          结束
        </button>
      </div>
    </section>
  );
}

function canStartGoal(status: ChatSessionGoalSummary["status"]): boolean {
  return (
    status === "planning" ||
    status === "failed" ||
    status === "stopped_budget" ||
    status === "stopped_stalled" ||
    status === "canceled"
  );
}
