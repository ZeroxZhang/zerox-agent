import { useEffect, useRef, useState } from "react";
import type { AcceptanceCheck, Goal } from "../../shared/agentGoal";
import type { ChatSessionGoalSummary } from "../../shared/chat";
import type { GoalContractSnapshot } from "../../shared/goalPlanContract";
import type { PlanRecord } from "../../shared/planMode";
import { getPlanOutcomePresentation } from "../planFailurePresentation";
import {
  createManualCompletionConfirmation,
  getConfirmedManualCompletionGoalId,
  type GoalAcceptanceUiContext,
  type ManualCompletionConfirmation,
} from "../goalAcceptanceInteraction";
import { buildGoalProgressViewModel } from "../goalProgressViewModel";
import { useDialogFocusTrap } from "./useDialogFocusTrap";

type GoalDetailDrawerProps = {
  goal: Goal | null;
  activePlan?: PlanRecord | null;
  planCandidate?: PlanRecord | null;
  open: boolean;
  summary: ChatSessionGoalSummary | null;
  onClose: () => void;
  onStart?: () => void;
  onResolveReview?: (decision: "approve" | "reject" | "terminate") => void;
  onReplan?: () => void;
  onResolveAmendment?: (decision: "approve" | "reject") => void;
  goalAmendmentActionPending?: "approve" | "reject" | null;
  onRetry?: () => void;
  onContinueAcceptance?: () => void;
  onMarkCompletedUnverified?: (
    confirmation: ManualCompletionConfirmation,
  ) => void;
  goalAcceptanceContext: GoalAcceptanceUiContext;
  goalAcceptanceOperationPending?: boolean;
  onCancel?: () => void;
};

export function GoalDetailDrawer(props: GoalDetailDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const milestonesRef = useRef<HTMLDivElement>(null);
  const [manualCompletionConfirmation, setManualCompletionConfirmation] =
    useState<ManualCompletionConfirmation | null>(null);
  const progress = props.summary
    ? buildGoalProgressViewModel(props.summary, props.goal)
    : null;
  const dialogOpen = props.open && Boolean(props.summary && progress);

  useDialogFocusTrap({
    dialogRef: drawerRef,
    initialFocusRef: closeButtonRef,
    onEscape: props.onClose,
    open: dialogOpen,
  });

  useEffect(() => {
    const element = milestonesRef.current;
    if (element && progress) {
      element.scrollTop = element.scrollHeight;
    }
  }, [progress?.milestoneRows.length, progress?.milestoneRows.at(-1)?.state]);

  useEffect(() => {
    if (
      !props.open ||
      progress?.status !== "waiting_for_acceptance" ||
      !getConfirmedManualCompletionGoalId(
        manualCompletionConfirmation,
        props.goalAcceptanceContext,
      )
    ) {
      setManualCompletionConfirmation(null);
    }
  }, [
    manualCompletionConfirmation,
    props.goalAcceptanceContext,
    props.open,
    progress?.status,
  ]);

  if (!props.open || !props.summary || !progress) {
    return null;
  }

  const hasGuardedActions =
    progress.status === "waiting_for_review" ||
    isRecoverableStatus(progress.status) ||
    progress.recoveryActions.length > 0 ||
    props.goal?.pendingGoalAmendment?.status === "pending" ||
    props.goal?.pendingGoalAmendment?.status === "approved";
  const displayTitle = buildGoalDisplayTitle(props.summary.description);
  const amendment = props.goal?.pendingGoalAmendment;
  const activePlanPresentation = props.activePlan
    ? getPlanOutcomePresentation(props.activePlan)
    : null;

  return (
    <div
      className="goal-detail-drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !hasGuardedActions) {
          props.onClose();
        }
      }}
    >
      <aside
        aria-describedby="goal-detail-description"
        aria-labelledby="goal-detail-title"
        aria-modal="true"
        className="goal-detail-drawer"
        ref={drawerRef}
        role="dialog"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>目标详情</span>
            <h3 id="goal-detail-title" ref={headingRef} tabIndex={-1}>
              {displayTitle}
            </h3>
            <p id="goal-detail-description" className="sr-only">
              查看目标进度、审核门、恢复路径和里程碑证据。
            </p>
          </div>
          <button type="button" ref={closeButtonRef} onClick={props.onClose}>
            关闭
          </button>
        </header>

        <div className="goal-detail-drawer-body">
          <details className="goal-original-instructions" open>
            <summary>查看完整目标说明</summary>
            <div className="goal-original-instructions-content">
              {props.goal?.originalDescription ?? props.summary.description}
            </div>
          </details>

          {props.goal?.goalContractSnapshot ? (
            <details className="goal-original-instructions" open>
              <summary>
                Goal r{props.goal.goalContractSnapshot.revision} / Plan v
                {props.goal.planVersion} / {formatGoalPlanMode(props.goal)}
              </summary>
              <div className="goal-original-instructions-content">
                <strong>目标契约</strong>
                <GoalContractDetails
                  snapshot={props.goal.goalContractSnapshot}
                />
                <small>
                  SHA256 {props.goal.goalContractRef?.sha256.slice(0, 12)}
                </small>
              </div>
            </details>
          ) : null}

          {props.activePlan && activePlanPresentation ? (
            <section
              className={`goal-active-plan-status is-${activePlanPresentation.kind}`}
              aria-label="当前 Plan 状态"
            >
              <span>
                当前 Plan v{props.activePlan.goalPlanVersion ?? props.goal?.planVersion ?? 1}
              </span>
              <strong>{activePlanPresentation.title}</strong>
              <p>{activePlanPresentation.detail}</p>
              <small>{activePlanPresentation.nextAction}</small>
            </section>
          ) : null}

          {props.goal?.planHistory?.length ? (
            <details className="goal-original-instructions">
              <summary>Plan 历史 · {props.goal.planHistory.length}</summary>
              <div className="goal-original-instructions-content">
                <ul>
                  {props.goal.planHistory.map((entry) => (
                    <li key={`${entry.planId}-${entry.goalPlanVersion}`}>
                      Plan v{entry.goalPlanVersion} · {formatPlanMode(entry.mode)} ·
                      {" "}{formatPlanOutcome(entry.outcome)}
                      <small>
                        {` · Goal r${entry.goalContractRef.revision} · ${entry.trigger.summary}`}
                        {entry.parentPlanRef
                          ? ` · 父 Plan v${entry.parentPlanRef.goalPlanVersion}`
                          : ""}
                      </small>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          ) : null}

          {amendment?.status === "pending" || amendment?.status === "approved" ? (
            <section className="goal-review-gate">
              <span>
                {amendment.status === "pending"
                  ? "目标修订提案 · 等待批准"
                  : "目标修订已批准 · 尚未应用"}
              </span>
              <p>{amendment.reason}</p>
              {amendment.pausedExecution && amendment.status === "pending" ? (
                <p className="goal-amendment-state" role="status">
                  原执行路径已安全暂停；批准后生成新的 Direct Plan，拒绝后恢复原路径。
                </p>
              ) : null}
              <GoalContractComparison
                base={props.goal?.goalContractSnapshot ?? amendment.candidateContract}
                candidate={amendment.candidateContract}
              />
              {amendment.status === "approved" ? (
                <p className="goal-amendment-state" role="status">
                  {amendment.candidatePlanId
                    ? `候选 Direct Plan 已关联；只有采用它后 Goal r${amendment.candidateContract.revision} 才会生效。`
                    : "Direct Plan 尚未生成；旧 Goal 暂停恢复，直到生成并采用新 Plan 或撤销修订。"}
                </p>
              ) : null}
              {props.onResolveAmendment ? (
                <div className="goal-review-actions">
                  <button
                    type="button"
                    className="goal-primary-action"
                    disabled={Boolean(props.goalAmendmentActionPending)}
                    onClick={() => props.onResolveAmendment?.("approve")}
                  >
                    {props.goalAmendmentActionPending === "approve"
                      ? "正在生成…"
                      : amendment.status === "approved"
                        ? "重新生成或打开 Direct Plan"
                        : "批准并生成 Direct Plan"}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(props.goalAmendmentActionPending)}
                    onClick={() => props.onResolveAmendment?.("reject")}
                  >
                    {props.goalAmendmentActionPending === "reject"
                      ? "正在处理…"
                      : amendment.status === "approved"
                        ? "撤销修订"
                        : "拒绝修订"}
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="goal-progress-status">
            <div>
              <span>{progress.statusLabel}</span>
              <p>{progress.statusDetail}</p>
            </div>
            {canStartGoal(progress.status) && props.onStart ? (
              <button type="button" onClick={props.onStart}>
                {progress.nextActionLabel}
              </button>
            ) : null}
          </section>

          {progress.status === "waiting_for_review" &&
          amendment?.status !== "pending" &&
          amendment?.status !== "approved" &&
          !isOpenRuntimePlanCandidate(props.planCandidate) &&
          props.onResolveReview ? (
            <section className="goal-review-gate">
              <span>审核门</span>
              <p>目标已暂停或到达审核门，需要你基于当前证据决定是否继续。</p>
              {props.goal ? renderEvidenceList(props.goal) : null}
              <div className="goal-review-actions">
                <button
                  type="button"
                  className="goal-primary-action"
                  onClick={() => props.onResolveReview!("approve")}
                >
                  继续执行
                </button>
                <button
                  type="button"
                  onClick={() => props.onResolveReview!("reject")}
                >
                  填写调整意见
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

          {isRecoverableStatus(progress.status) ? (
            <section className="goal-recovery-actions">
              <span>恢复路径</span>
              <p>{getRecoveryHint(progress.status)}</p>
              <div className="goal-review-actions">
                {progress.status === "waiting_for_acceptance" &&
                progress.recoveryActions.includes("continue_acceptance") &&
                props.onContinueAcceptance ? (
                  <button
                    type="button"
                    className="goal-primary-action"
                    disabled={props.goalAcceptanceOperationPending}
                    onClick={props.onContinueAcceptance}
                  >
                    继续最终验收
                  </button>
                ) : null}
                {progress.status === "waiting_for_acceptance" &&
                progress.recoveryActions.includes("mark_completed_unverified") &&
                props.onMarkCompletedUnverified ? (
                  <button
                    type="button"
                    disabled={props.goalAcceptanceOperationPending}
                    onClick={() =>
                      setManualCompletionConfirmation(
                        createManualCompletionConfirmation(
                          props.goalAcceptanceContext,
                        ),
                      )
                    }
                  >
                    手动标记完成
                  </button>
                ) : null}
                {progress.status === "stopped_blocked" &&
                progress.recoveryActions.includes("retry_acceptance") &&
                props.onRetry ? (
                  <button
                    type="button"
                    className="goal-primary-action"
                    aria-label="重试验收"
                    onClick={props.onRetry}
                  >
                    重试验收
                  </button>
                ) : null}
                {progress.status === "stopped_blocked" &&
                progress.recoveryActions.includes("adjust_plan") &&
                props.onReplan ? (
                  <button
                    type="button"
                    aria-label="调整计划"
                    onClick={props.onReplan}
                  >
                    调整计划
                  </button>
                ) : null}
                {progress.status === "stopped_stalled" && props.onReplan ? (
                  <button
                    type="button"
                    className="goal-primary-action"
                    onClick={props.onReplan}
                  >
                    重新规划
                  </button>
                ) : null}
                {(progress.status === "failed" ||
                  progress.status === "waiting_for_model" ||
                  progress.status === "stopped_stalled") &&
                props.onRetry ? (
                  <button
                    type="button"
                    className="goal-primary-action"
                    onClick={props.onRetry}
                  >
                    {progress.status === "waiting_for_model"
                      ? props.goal?.modelServiceNotice?.kind === "output_limit"
                        ? "继续生成"
                        : "重试模型"
                      : "重试目标"}
                  </button>
                ) : null}
                {props.onCancel &&
                (progress.status !== "stopped_blocked" ||
                  progress.recoveryActions.includes("terminate")) ? (
                  <button
                    type="button"
                    className="goal-danger-action"
                    onClick={props.onCancel}
                  >
                    {progress.status === "stopped_blocked"
                      ? "终止目标"
                      : "结束目标"}
                  </button>
                ) : null}
              </div>
              {progress.status === "waiting_for_acceptance" &&
              manualCompletionConfirmation ? (
                <div
                  className="goal-manual-completion-confirmation"
                  role="alert"
                >
                  <strong>确认手动标记完成？</strong>
                  <p>
                    此操作会保留任务产物和本地记录，但不会生成机器验收证书，
                    也不表示最终裁判已经通过。
                  </p>
                  <div className="goal-review-actions">
                    <button
                      type="button"
                      disabled={props.goalAcceptanceOperationPending}
                      onClick={() => setManualCompletionConfirmation(null)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="goal-manual-completion-action"
                      disabled={props.goalAcceptanceOperationPending}
                      onClick={() => {
                        const goalId = getConfirmedManualCompletionGoalId(
                          manualCompletionConfirmation,
                          props.goalAcceptanceContext,
                        );
                        if (!goalId || goalId !== manualCompletionConfirmation.goalId) {
                          setManualCompletionConfirmation(null);
                          return;
                        }
                        props.onMarkCompletedUnverified?.(
                          manualCompletionConfirmation,
                        );
                      }}
                    >
                      确认手动完成
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {progress.acceptance ? (
            <section className="goal-acceptance-details">
              <div className="goal-detail-section-header">
                <span>验收决策</span>
                <small>{progress.acceptance.phaseLabel}</small>
              </div>
              {progress.acceptance.lastDirective ? (
                <p>
                  最后确定性决策：{progress.acceptance.lastDirective.label}
                  {progress.acceptance.occurrence
                    ? ` · 第 ${progress.acceptance.occurrence} 次`
                    : ""}
                </p>
              ) : (
                <p>尚无修复或停止决策。</p>
              )}
              {progress.acceptance.failedCheckIds.length > 0 ||
              progress.acceptance.evidenceRefs.length > 0 ? (
                <div className="goal-acceptance-evidence">
                  {progress.acceptance.failedCheckIds.length > 0 ? (
                    <div>
                      <strong>失败检查</strong>
                      <ul>
                        {progress.acceptance.failedCheckIds.map((checkId) => (
                          <li key={checkId}><code>{checkId}</code></li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {progress.acceptance.evidenceRefs.length > 0 ? (
                    <div>
                      <strong>证据引用</strong>
                      <ul>
                        {progress.acceptance.evidenceRefs.map((reference) => (
                          <li key={reference}><code>{reference}</code></li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {progress.acceptance.retry ? (
                <dl className="goal-acceptance-metadata">
                  <div>
                    <dt>重试周期</dt>
                    <dd>{progress.acceptance.retry.cycle}</dd>
                  </div>
                  <div>
                    <dt>本周期尝试</dt>
                    <dd>
                      {progress.acceptance.retry.attempt}/
                      {progress.acceptance.retry.maxAttempts}
                    </dd>
                  </div>
                  <div>
                    <dt>最近故障代码</dt>
                    <dd><code>{progress.acceptance.retry.lastCode}</code></dd>
                  </div>
                  {progress.acceptance.retry.nextRetryAt ? (
                    <div>
                      <dt>下次重试</dt>
                      <dd>{progress.acceptance.retry.nextRetryAt}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              {progress.acceptance.manualCompletion ? (
                <div className="goal-manual-completion-record">
                  <strong>手动完成记录</strong>
                  <dl className="goal-acceptance-metadata">
                    <div>
                      <dt>记录时间</dt>
                      <dd>{progress.acceptance.manualCompletion.completedAt}</dd>
                    </div>
                    <div>
                      <dt>最近故障代码</dt>
                      <dd>
                        <code>
                          {progress.acceptance.manualCompletion.lastFailureCode}
                        </code>
                      </dd>
                    </div>
                    <div>
                      <dt>验收周期</dt>
                      <dd>{progress.acceptance.manualCompletion.retryCycles}</dd>
                    </div>
                  </dl>
                  {progress.acceptance.manualCompletion.failedCheckIds.length > 0 ? (
                    <p>
                      失败检查：
                      {progress.acceptance.manualCompletion.failedCheckIds.join("、")}
                    </p>
                  ) : null}
                  {progress.acceptance.manualCompletion.evidenceRefs.length > 0 ? (
                    <p>
                      证据引用：
                      {progress.acceptance.manualCompletion.evidenceRefs.join("、")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {progress.certificate ? (
            <details className="goal-certificate-details">
              <summary>查看验收证书</summary>
              <dl className="goal-certificate-metadata">
                <div>
                  <dt>验收时间</dt>
                  <dd>{progress.certificate.acceptedAt}</dd>
                </div>
                <div>
                  <dt>计划版本</dt>
                  <dd>{progress.certificate.planVersion}</dd>
                </div>
                <div>
                  <dt>证书哈希</dt>
                  <dd className="goal-certificate-hash">
                    <code>{progress.certificate.shortCertificateHash}</code>
                  </dd>
                </div>
                {progress.certificate.judge ? (
                  <>
                    <div>
                      <dt>评审模型</dt>
                      <dd>{progress.certificate.judge.model}</dd>
                    </div>
                    <div>
                      <dt>提示版本</dt>
                      <dd>{progress.certificate.judge.promptVersion}</dd>
                    </div>
                  </>
                ) : null}
              </dl>
              <div className="goal-certificate-list">
                <strong>验收检查</strong>
                {progress.certificate.checks.length > 0 ? (
                  <ul>
                    {progress.certificate.checks.map((check) => (
                      <li key={`${check.id}-${check.kind}`}>
                        <span>{check.passed ? "通过" : "未通过"}</span>
                        <code>{check.id}</code>
                        <small>
                          {check.mode === "inferential" ? "推断性" : "确定性"}
                          {" · "}{check.kind} · {check.code}
                        </small>
                        {check.evidenceRefs.length > 0 ? (
                          <small>{check.evidenceRefs.join(" · ")}</small>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>证书未包含可展示的检查元数据。</p>
                )}
              </div>
              <div className="goal-certificate-list">
                <strong>产物元数据</strong>
                {progress.certificate.artifacts.length > 0 ? (
                  <ul>
                    {progress.certificate.artifacts.map((artifact, index) => (
                      <li key={`${artifact.path ?? "artifact"}-${index}`}>
                        {artifact.path ? <code>{artifact.path}</code> : null}
                        {artifact.sizeBytes !== undefined ? (
                          <small>{artifact.sizeBytes} bytes</small>
                        ) : null}
                        {artifact.shortSha256 ? (
                          <small>SHA256 <code>{artifact.shortSha256}</code></small>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>证书未包含可展示的产物元数据。</p>
                )}
              </div>
            </details>
          ) : null}

          <section className="goal-progress-next">
            <span>下一步</span>
            <strong>{progress.nextActionLabel}</strong>
            <p>{progress.nextActionDetail}</p>
          </section>

          <div className="goal-detail-section-header">
            <span>执行统计</span>
          </div>
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
                  {props.goal ? (
                    <MilestoneAcceptanceContract
                      checks={
                        props.goal.milestones
                          .find((candidate) => candidate.id === milestone.id)
                          ?.successCriteria.flatMap(
                            (criterion) => criterion.acceptanceChecks,
                          ) ?? []
                      }
                    />
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

function MilestoneAcceptanceContract(props: { checks: AcceptanceCheck[] }) {
  if (props.checks.length === 0) return null;
  return (
    <details className="goal-milestone-acceptance-contract">
      <summary>查看验收合同 · {props.checks.length} 项</summary>
      <ul>
        {props.checks.map((check) => (
          <li key={check.id}>
            <strong>{check.id} · {check.kind}</strong>
            <span>{check.description}</span>
            <code>{formatAcceptanceParams(check.params)}</code>
          </li>
        ))}
      </ul>
    </details>
  );
}

function formatAcceptanceParams(params: Record<string, unknown>): string {
  try {
    const value = JSON.stringify(params);
    return value.length > 1_000 ? `${value.slice(0, 1_000)}…` : value;
  } catch {
    return "[验收参数不可序列化]";
  }
}

function GoalContractDetails(props: { snapshot: GoalContractSnapshot }) {
  const { snapshot } = props;
  return (
    <div className="goal-contract-details">
      <p><b>目标结果：</b>{snapshot.objective}</p>
      <p><b>交付物：</b>{formatContractList(snapshot.deliverables)}</p>
      <p><b>范围内：</b>{formatContractList(snapshot.scope.in)}</p>
      <p><b>范围外：</b>{formatContractList(snapshot.scope.out)}</p>
      <p><b>显式假设：</b>{formatContractList(snapshot.assumptions)}</p>
      <div>
        <b>约束：</b>
        {snapshot.constraints.length ? (
          <ul>
            {snapshot.constraints.map((constraint) => (
              <li key={constraint.id}>
                <strong>{constraint.strength === "hard" ? "硬约束" : "偏好"}</strong>
                {` · ${formatConstraintDimension(constraint.dimension)} · ${constraint.description}`}
              </li>
            ))}
          </ul>
        ) : "无显式约束"}
      </div>
      <div>
        <b>成功标准：</b>
        <ol>
          {snapshot.successCriteria.map((criterion) => (
            <li key={criterion.id}>{criterion.description}</li>
          ))}
        </ol>
      </div>
      <p>
        <b>风险策略：</b>
        {snapshot.riskPolicy.ordinaryOperations === "auto_decide"
          ? "普通操作自动决策"
          : "普通操作需要确认"}
        ；高风险与不可逆操作必须确认
      </p>
      <p>
        <b>停止策略：</b>
        成功后生成验收证书；外部阻塞
        {snapshot.stopPolicy.onExternalBlock === "await_input" ? "等待输入" : "停止受阻"}
        ；不可实现时
        {snapshot.stopPolicy.onImpossible === "propose_goal_amendment"
          ? "提出目标修订"
          : "停止为不可实现"}
        ；安全阻断时
        {snapshot.stopPolicy.onSafetyBlock === "request_confirmation"
          ? "请求确认"
          : "停止受阻"}
      </p>
    </div>
  );
}

function GoalContractComparison(props: {
  base: GoalContractSnapshot;
  candidate: GoalContractSnapshot;
}) {
  const changedFields = getChangedGoalContractFields(props.base, props.candidate);
  const weakenedHardConstraints = props.base.constraints.filter(
    (constraint) =>
      constraint.strength === "hard" &&
      !props.candidate.constraints.some(
        (candidate) =>
          candidate.id === constraint.id &&
          candidate.strength === "hard" &&
          candidate.description === constraint.description,
      ),
  );
  return (
    <div className="goal-contract-comparison">
      <p>
        <b>变更字段：</b>
        {changedFields.length ? changedFields.join("、") : "仅修订版本和来源"}
      </p>
      {weakenedHardConstraints.length ? (
        <p className="goal-contract-warning" role="alert">
          注意：候选契约删除或放松了硬约束：
          {weakenedHardConstraints.map((constraint) => constraint.description).join("；")}
        </p>
      ) : null}
      <details>
        <summary>当前 Goal r{props.base.revision}</summary>
        <GoalContractDetails snapshot={props.base} />
      </details>
      <details open>
        <summary>候选 Goal r{props.candidate.revision}</summary>
        <GoalContractDetails snapshot={props.candidate} />
      </details>
    </div>
  );
}

function getChangedGoalContractFields(
  base: GoalContractSnapshot,
  candidate: GoalContractSnapshot,
): string[] {
  const fields: Array<[string, unknown, unknown]> = [
    ["目标结果", base.objective, candidate.objective],
    ["交付物", base.deliverables, candidate.deliverables],
    ["范围", base.scope, candidate.scope],
    ["显式假设", base.assumptions, candidate.assumptions],
    ["约束", base.constraints, candidate.constraints],
    ["成功标准", base.successCriteria, candidate.successCriteria],
    ["停止策略", base.stopPolicy, candidate.stopPolicy],
    ["风险策略", base.riskPolicy, candidate.riskPolicy],
  ];
  return fields.flatMap(([label, left, right]) =>
    JSON.stringify(left) === JSON.stringify(right) ? [] : [label],
  );
}

function formatContractList(values: string[]): string {
  return values.length ? values.join("；") : "无";
}

function formatConstraintDimension(
  dimension: GoalContractSnapshot["constraints"][number]["dimension"],
): string {
  const labels: Record<typeof dimension, string> = {
    quality: "质量",
    time: "时间",
    cost: "成本",
    safety: "安全",
    permission: "权限",
    source: "来源",
    scope: "范围",
    other: "其他",
  };
  return labels[dimension];
}

function formatGoalPlanMode(goal: Goal): string {
  const active = goal.activePlanRef;
  const initial = goal.planHistory?.[0];
  if (initial?.mode === "debate" && active?.mode === "direct") {
    return `初始 Debate → 当前 Direct v${active.goalPlanVersion}`;
  }
  return formatPlanMode(active?.mode ?? initial?.mode ?? "legacy");
}

function formatPlanMode(mode: "direct" | "debate" | "legacy"): string {
  if (mode === "direct") return "Direct";
  if (mode === "debate") return "Debate";
  return "Legacy compacted";
}

function formatPlanOutcome(
  outcome: NonNullable<Goal["planHistory"]>[number]["outcome"],
): string {
  if (outcome === "candidate") return "等待采用";
  if (outcome === "active") return "当前采用";
  if (outcome === "superseded") return "已替代";
  if (outcome === "rejected") return "未采用";
  return "旧版压缩记录";
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

export function buildGoalDisplayTitle(description: string): string {
  const compact = description
    .replace(/^\s*#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "未命名目标";
  return compact.length > 80
    ? `${compact.slice(0, 79).trimEnd()}…`
    : compact;
}

function canStartGoal(status: ChatSessionGoalSummary["status"]): boolean {
  return status === "planning";
}

function isRecoverableStatus(status: ChatSessionGoalSummary["status"]): boolean {
  return (
    status === "failed" ||
    status === "stopped_budget" ||
    status === "stopped_stalled" ||
    status === "stopped_blocked" ||
    status === "waiting_for_acceptance"
  );
}

function getRecoveryHint(status: ChatSessionGoalSummary["status"]): string {
  switch (status) {
    case "stopped_budget":
      return "这是旧版本地预算机制留下的只读任务。可查看原结果和执行证据，但不能继续或修改。";
    case "stopped_stalled":
      return "目标没有可推进的里程碑。你可以重新规划、重试或结束目标。";
    case "failed":
      return "目标执行失败。你可以重试或结束目标。";
    case "stopped_blocked":
      return "目标尚未完成。你可以重试验收、调整计划或终止目标。";
    case "waiting_for_acceptance":
      return "任务产物与已完成里程碑不会重新执行。你可以继续验收、手动记录为未经机器认证的完成，或结束目标。";
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
