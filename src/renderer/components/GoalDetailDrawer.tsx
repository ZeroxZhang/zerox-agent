import type { Goal } from "../../shared/agentGoal";
import type { ChatSessionGoalSummary } from "../../shared/chat";

type GoalDetailDrawerProps = {
  goal: Goal | null;
  open: boolean;
  summary: ChatSessionGoalSummary | null;
  onClose: () => void;
};

export function GoalDetailDrawer(props: GoalDetailDrawerProps) {
  if (!props.open || !props.summary) {
    return null;
  }

  const milestones = props.goal?.milestones ?? [];

  return (
    <aside className="goal-detail-drawer" aria-label="目标详情">
      <header>
        <div>
          <span>Goal detail</span>
          <h3>{props.summary.description}</h3>
        </div>
        <button type="button" onClick={props.onClose}>
          关闭
        </button>
      </header>
      {props.goal ? (
        <dl>
          <div>
            <dt>计划版本</dt>
            <dd>{props.goal.planVersion}</dd>
          </div>
          <div>
            <dt>预算</dt>
            <dd>
              {props.goal.budgetUsage.iterations}/{props.goal.budget.maxIterations}{" "}
              iterations
            </dd>
          </div>
        </dl>
      ) : (
        <p>目标详情会在桌面端加载后显示。</p>
      )}
      <div className="goal-detail-drawer-milestones">
        {milestones.map((milestone) => (
          <article key={milestone.id}>
            <span>{milestone.state}</span>
            <strong>{milestone.description}</strong>
            {milestone.lastAcceptanceSummary ? (
              <p>{milestone.lastAcceptanceSummary}</p>
            ) : null}
          </article>
        ))}
      </div>
    </aside>
  );
}
