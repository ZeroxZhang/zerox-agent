import { useEffect, useMemo, useState } from "react";
import type { Goal, GoalBudget, GoalStatus } from "../../shared/agentGoal";
import type {
  GoalReviewDecision,
  GoalReviewPolicy,
} from "../../shared/agentGoalReview";

type GoalFormState = {
  description: string;
  successCriterion: string;
  maxIterations: number;
  maxToolCalls: number;
  maxWallClockMinutes: number;
  maxReplans: number;
  reviewPolicy: GoalReviewPolicy;
};

const demoGoals: Goal[] = [
  {
    id: "preview_goal",
    description: "生成一份本地研究报告并通过验收。",
    successCriteria: [
      {
        id: "criterion_preview",
        description: "报告存在且证据完整。",
        acceptanceChecks: [
          {
            id: "check_preview",
            kind: "model_review",
            description: "证据支撑的最终审核。",
            params: {},
            requiresEvidence: true,
          },
        ],
      },
    ],
    milestones: [
      {
        id: "milestone_sources",
        description: "收集来源和引用。",
        dependsOn: [],
        successCriteria: [],
        state: "accepted",
        runIds: ["run_preview_sources"],
        attempts: 1,
        lastAcceptanceSummary: "来源已通过引用覆盖检查。",
      },
      {
        id: "milestone_report",
        description: "写入 Markdown 报告。",
        dependsOn: ["milestone_sources"],
        successCriteria: [],
        state: "ready",
        runIds: [],
        attempts: 0,
      },
    ],
    status: "waiting_for_review",
    budget: {
      maxIterations: 8,
      maxToolCalls: 24,
      maxWallClockMs: 600_000,
      maxReplans: 2,
    },
    budgetUsage: {
      iterations: 1,
      toolCalls: 4,
      wallClockMs: 80_000,
      tokens: 1200,
      replans: 0,
    },
    reviewPolicy: "review_each_milestone",
    planVersion: 1,
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
  },
];

const initialForm: GoalFormState = {
  description: "",
  successCriterion: "",
  maxIterations: 8,
  maxToolCalls: 24,
  maxWallClockMinutes: 10,
  maxReplans: 2,
  reviewPolicy: "review_final_only",
};

export function GoalPanel() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [form, setForm] = useState<GoalFormState>(initialForm);
  const [status, setStatus] = useState({
    kind: "loading" as "error" | "idle" | "loading",
    message: "正在加载目标...",
  });
  const selectedGoal = useMemo(
    () => goals.find((goal) => goal.id === selectedGoalId) ?? goals[0] ?? null,
    [goals, selectedGoalId],
  );

  useEffect(() => {
    void refreshGoals();
  }, []);

  async function refreshGoals() {
    if (!window.buildingAgent) {
      setGoals(demoGoals);
      setSelectedGoalId(demoGoals[0]?.id ?? null);
      setStatus({ kind: "idle", message: "浏览器预览模式，展示目标演示数据。" });
      return;
    }

    try {
      const activeGoals = await window.buildingAgent.listActiveGoals();
      setGoals(activeGoals);
      setSelectedGoalId((current) => current ?? activeGoals[0]?.id ?? null);
      setStatus({ kind: "idle", message: "目标列表已加载。" });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "无法加载目标。",
      });
    }
  }

  async function createGoal() {
    if (!window.buildingAgent || !form.description.trim()) {
      return;
    }

    const budget: GoalBudget = {
      maxIterations: form.maxIterations,
      maxToolCalls: form.maxToolCalls,
      maxWallClockMs: form.maxWallClockMinutes * 60_000,
      maxReplans: form.maxReplans,
    };
    const result = await window.buildingAgent.createGoal({
      description: form.description.trim(),
      successCriteria: [
        form.successCriterion.trim() || "目标结果需要证据支撑并通过审核。",
      ],
      budget,
      reviewPolicy: form.reviewPolicy,
    });
    if (result.ok && result.goal) {
      setForm(initialForm);
      await refreshGoals();
      setSelectedGoalId(result.goal.id);
    } else {
      setStatus({ kind: "error", message: result.message ?? "无法创建目标。" });
    }
  }

  async function mutateGoal(
    action: "cancelGoal" | "resumeGoal" | "startGoal",
    goalId: string,
  ) {
    if (!window.buildingAgent) return;
    const result = await window.buildingAgent[action](goalId);
    if (!result.ok) {
      setStatus({ kind: "error", message: result.message ?? "目标操作失败。" });
      return;
    }
    await refreshGoals();
  }

  async function resolveGoalReview(goalId: string, decision: GoalReviewDecision) {
    if (!window.buildingAgent) return;
    const result = await window.buildingAgent.resolveGoalReview(goalId, decision);
    if (!result.ok) {
      setStatus({ kind: "error", message: result.message ?? "审核处理失败。" });
      return;
    }
    await refreshGoals();
  }

  return (
    <section className="goal-panel">
      <div className="section-heading">
        <div>
          <span>Goal Mode</span>
          <h2>有边界自治目标</h2>
        </div>
        <small>{status.message}</small>
      </div>

      <section className="goal-create-panel" aria-label="创建目标">
        <label className="field">
          <span>目标描述</span>
          <textarea
            value={form.description}
            onChange={(event) =>
              setForm({ ...form, description: event.currentTarget.value })
            }
          />
        </label>
        <label className="field">
          <span>成功标准</span>
          <input
            value={form.successCriterion}
            onChange={(event) =>
              setForm({ ...form, successCriterion: event.currentTarget.value })
            }
          />
        </label>
        <div className="field-grid">
          <NumberField
            label="迭代"
            value={form.maxIterations}
            onChange={(value) => setForm({ ...form, maxIterations: value })}
          />
          <NumberField
            label="工具调用"
            value={form.maxToolCalls}
            onChange={(value) => setForm({ ...form, maxToolCalls: value })}
          />
          <NumberField
            label="分钟"
            value={form.maxWallClockMinutes}
            onChange={(value) => setForm({ ...form, maxWallClockMinutes: value })}
          />
          <NumberField
            label="重规划"
            value={form.maxReplans}
            onChange={(value) => setForm({ ...form, maxReplans: value })}
          />
        </div>
        <label className="field">
          <span>审核策略</span>
          <select
            value={form.reviewPolicy}
            onChange={(event) =>
              setForm({
                ...form,
                reviewPolicy: event.currentTarget.value as GoalReviewPolicy,
              })
            }
          >
            <option value="review_each_milestone">每个里程碑</option>
            <option value="review_key_milestones">关键里程碑</option>
            <option value="review_final_only">仅最终</option>
            <option value="review_high_risk_only">仅高风险</option>
          </select>
        </label>
        <button className="primary-action" type="button" onClick={() => void createGoal()}>
          创建目标
        </button>
      </section>

      <div className="goal-workspace">
        <aside className="goal-list" aria-label="目标列表">
          {goals.map((goal) => (
            <button
              key={goal.id}
              className={`goal-list-item ${
                goal.id === selectedGoal?.id ? "is-active" : ""
              }`}
              type="button"
              onClick={() => setSelectedGoalId(goal.id)}
            >
              <strong>{goal.description}</strong>
              <span>{translateGoalStatus(goal.status)}</span>
            </button>
          ))}
        </aside>

        {selectedGoal ? (
          <section className="goal-detail">
            <div className="goal-detail-header">
              <div>
                <span>{translateGoalStatus(selectedGoal.status)}</span>
                <h3>{selectedGoal.description}</h3>
              </div>
              <div className="goal-actions">
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => void mutateGoal("startGoal", selectedGoal.id)}
                >
                  启动
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => void mutateGoal("resumeGoal", selectedGoal.id)}
                >
                  继续
                </button>
                <button
                  className="danger-action"
                  type="button"
                  onClick={() => void mutateGoal("cancelGoal", selectedGoal.id)}
                >
                  终止
                </button>
              </div>
            </div>
            <BudgetMeter goal={selectedGoal} />
            {selectedGoal.status === "waiting_for_review" ? (
              <article className="review-gate-card goal-review-gate-card">
                <span>Review Gate</span>
                <h4>目标等待审核</h4>
                <p>检查已完成证据、剩余里程碑和预算消耗，然后决定下一步。</p>
                <div className="goal-actions">
                  <button
                    className="primary-action"
                    type="button"
                    onClick={() =>
                      void resolveGoalReview(selectedGoal.id, {
                        kind: "approve_continue",
                      })
                    }
                  >
                    继续
                  </button>
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() =>
                      void resolveGoalReview(selectedGoal.id, {
                        kind: "modify_plan",
                        instructions: "请收紧剩余计划并补充验收证据。",
                      })
                    }
                  >
                    修改计划
                  </button>
                  <button
                    className="danger-action"
                    type="button"
                    onClick={() =>
                      void resolveGoalReview(selectedGoal.id, { kind: "terminate" })
                    }
                  >
                    终止
                  </button>
                </div>
              </article>
            ) : null}
            {selectedGoal.stopReason ? (
              <p className="status-note">停止原因：{selectedGoal.stopReason}</p>
            ) : null}
            <div className="goal-milestone-tree">
              {selectedGoal.milestones.map((item) => (
                <article className={`goal-milestone is-${item.state}`} key={item.id}>
                  <span>{item.state}</span>
                  <strong>{item.description}</strong>
                  <small>
                    attempts {item.attempts} · runs {item.runIds.length}
                  </small>
                  {item.lastAcceptanceSummary ? <p>{item.lastAcceptanceSummary}</p> : null}
                </article>
              ))}
            </div>
          </section>
        ) : (
          <section className="goal-detail">
            <p>还没有活跃目标。</p>
          </section>
        )}
      </div>
    </section>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        min={1}
        type="number"
        value={props.value}
        onChange={(event) => props.onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

function BudgetMeter(props: { goal: Goal }) {
  const { budget, budgetUsage } = props.goal;
  return (
    <div className="goal-budget-grid" aria-label="预算用量">
      <BudgetItem label="迭代" value={budgetUsage.iterations} max={budget.maxIterations} />
      <BudgetItem label="工具" value={budgetUsage.toolCalls} max={budget.maxToolCalls} />
      <BudgetItem
        label="时间"
        value={Math.round(budgetUsage.wallClockMs / 60_000)}
        max={Math.round(budget.maxWallClockMs / 60_000)}
      />
      <BudgetItem label="重规划" value={budgetUsage.replans} max={budget.maxReplans} />
    </div>
  );
}

function BudgetItem(props: { label: string; value: number; max: number }) {
  return (
    <article>
      <span>{props.label}</span>
      <strong>
        {props.value}/{props.max}
      </strong>
    </article>
  );
}

function translateGoalStatus(status: GoalStatus): string {
  const labels: Record<GoalStatus, string> = {
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
