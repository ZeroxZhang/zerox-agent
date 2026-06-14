import { useEffect, useRef } from "react";
import type { Goal } from "../../shared/agentGoal";
import type { ChatSessionGoalSummary } from "../../shared/chat";
import { buildGoalProgressViewModel } from "../goalProgressViewModel";

type GoalDetailDrawerProps = {
  goal: Goal | null;
  open: boolean;
  summary: ChatSessionGoalSummary | null;
  onClose: () => void;
  onStart?: () => void;
  onResolveReview?: (decision: "approve" | "reject" | "terminate") => void;
  onIncreaseBudget?: () => void;
  onReplan?: () => void;
  onRetry?: () => void;
  onCancel?: () => void;
};

export function GoalDetailDrawer(props: GoalDetailDrawerProps) {
  const milestonesRef = useRef<HTMLDivElement>(null);
  const progress = props.summary
    ? buildGoalProgressViewModel(props.summary, props.goal)
    : null;

  useEffect(() => {
    const element = milestonesRef.current;
    if (element && progress) {
      element.scrollTop = element.scrollHeight;
    }
  }, [progress?.milestoneRows.length, progress?.milestoneRows.at(-1)?.state]);

  if (!props.open || !props.summary || !progress) {
    return null;
  }

  return (
    <div
      className="goal-detail-drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      }}
    >
      <aside
        className="goal-detail-drawer"
        aria-label="目标详情"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Goal detail</span>
            <h3>{props.summary.description}</h3>
          </div>
          <button type="button" onClick={props.onClose}>
            关闭
          </button>
        </header>

        <div className="goal-detail-drawer-body">
          <section className="goal-progress-status">
            <div>
              <span>{progress.statusLabel}</span>
              <p>{progress.statusDetail}</p>
            </div>
            {canStartGoal(props.summary.status) && props.onStart ? (
              <button type="button" onClick={props.onStart}>
                {progress.nextActionLabel}
              </button>
            ) : null}
          </section>

          {props.summary.status === "waiting_for_review" &&
          props.onResolveReview ? (
            <section className="goal-review-gate">
              <span>审核门</span>
              <p>里程碑已完成，需要你基于运行证据决定是否继续。</p>
              {props.goal ? renderEvidenceList(props.goal) : null}
              <div className="goal-review-actions">
                <button
                  type="button"
                  className="goal-primary-action"
                  onClick={() => props.onResolveReview!("approve")}
                >
                  通过并继续
                </button>
                <button
                  type="button"
                  onClick={() => props.onResolveReview!("reject")}
                >
                  拒绝并重新规划
                </button>
                <button
                  type="button"
                  className="goal-danger-action"
                  onClick={() => props.onResolveReview!("terminate")}
                >
                  终止目标
                </button>
              </div>
            </section>
          ) : null}

          {isRecoverableStatus(props.summary.status) ? (
            <section className="goal-recovery-actions">
              <span>恢复路径</span>
              <p>{getRecoveryHint(props.summary.status)}</p>
              <div className="goal-review-actions">
                {props.summary.status === "stopped_budget" &&
                props.onIncreaseBudget ? (
                  <button
                    type="button"
                    className="goal-primary-action"
                    onClick={props.onIncreaseBudget}
                  >
                    增加预算并继续
                  </button>
                ) : null}
                {props.summary.status === "stopped_stalled" && props.onReplan ? (
                  <button
                    type="button"
                    className="goal-primary-action"
                    onClick={props.onReplan}
                  >
                    重新规划
                  </button>
                ) : null}
                {(props.summary.status === "failed" ||
                  props.summary.status === "stopped_stalled") &&
                props.onRetry ? (
                  <button
                    type="button"
                    className="goal-primary-action"
                    onClick={props.onRetry}
                  >
                    重试目标
                  </button>
                ) : null}
                {props.onCancel ? (
                  <button
                    type="button"
                    className="goal-danger-action"
                    onClick={props.onCancel}
                  >
                    结束目标
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="goal-progress-next">
            <span>下一步</span>
            <strong>{progress.nextActionLabel}</strong>
            <p>{progress.nextActionDetail}</p>
          </section>

          <dl className="goal-progress-metrics">
            <div>
              <dt>进度</dt>
              <dd>{progress.progressText}</dd>
            </div>
            {props.goal ? (
              <div>
                <dt>计划版本</dt>
                <dd>{props.goal.planVersion}</dd>
              </div>
            ) : null}
            {progress.metricCards.map((card) => (
              <div key={card.label}>
                <dt>{card.label}</dt>
                <dd>{card.value}</dd>
              </div>
            ))}
          </dl>

          <div className="goal-detail-drawer-milestones" ref={milestonesRef}>
            <div className="goal-detail-section-header">
              <span>里程碑</span>
              <small>{progress.progressText}</small>
            </div>
            {progress.milestoneRows.length ? (
              progress.milestoneRows.map((milestone) => (
                <article className={`is-${milestone.state}`} key={milestone.id}>
                  <span>{milestone.stateLabel}</span>
                  <strong>{milestone.description}</strong>
                  <small>
                    {milestone.id} · 尝试 {milestone.attempts} · 运行{" "}
                    {milestone.runCount}
                  </small>
                  {milestone.lastAcceptanceSummary ? (
                    <p>{milestone.lastAcceptanceSummary}</p>
                  ) : null}
                </article>
              ))
            ) : (
              <p>目标详情加载后会显示里程碑。</p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function canStartGoal(status: ChatSessionGoalSummary["status"]): boolean {
  return status === "planning";
}

function isRecoverableStatus(status: ChatSessionGoalSummary["status"]): boolean {
  return (
    status === "failed" ||
    status === "stopped_budget" ||
    status === "stopped_stalled"
  );
}

function getRecoveryHint(status: ChatSessionGoalSummary["status"]): string {
  switch (status) {
    case "stopped_budget":
      return "预算已耗尽。你可以增加预算后继续，或结束目标。";
    case "stopped_stalled":
      return "目标没有可推进的里程碑。你可以重新规划、重试或结束目标。";
    case "failed":
      return "目标执行失败。你可以重试或结束目标。";
    default:
      return "";
  }
}

function renderEvidenceList(goal: Goal) {
  const checks = goal.successCriteria.flatMap((criterion) =>
    criterion.acceptanceChecks.map((check) => ({ criterion, check })),
  );
  return (
    <ul className="goal-evidence-list">
      {checks.map(({ criterion, check }) => (
        <li key={check.id}>
          <strong>{criterion.description}</strong>
          <small>
            {check.description}
            {check.requiresEvidence ? "（需要证据）" : ""}
          </small>
        </li>
      ))}
    </ul>
  );
}
