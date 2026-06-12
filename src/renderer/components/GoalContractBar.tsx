import type { ChatSessionGoalSummary } from "../../shared/chat";

type GoalContractBarProps = {
  goal: ChatSessionGoalSummary;
  onEnd: () => void;
  onModify: () => void;
  onPause: () => void;
  onViewProgress: () => void;
};

export function GoalContractBar(props: GoalContractBarProps) {
  return (
    <section className={`goal-contract-bar is-${props.goal.status}`}>
      <div>
        <span>Goal</span>
        <strong>{props.goal.description}</strong>
      </div>
      <small>{translateGoalStatus(props.goal.status)}</small>
      <div className="goal-contract-actions">
        <button type="button" onClick={props.onViewProgress}>
          查看进度
        </button>
        <button type="button" onClick={props.onModify}>
          修改
        </button>
        <button type="button" onClick={props.onPause}>
          暂停
        </button>
        <button type="button" onClick={props.onEnd}>
          结束
        </button>
      </div>
    </section>
  );
}

function translateGoalStatus(status: ChatSessionGoalSummary["status"]): string {
  const labels: Record<ChatSessionGoalSummary["status"], string> = {
    planning: "规划中",
    executing: "执行中",
    waiting_for_review: "等待审核",
    achieved: "已达成",
    stopped_budget: "预算停止",
    stopped_stalled: "停滞停止",
    failed: "失败",
    canceled: "已取消",
  };
  return labels[status];
}
