import { useEffect, useRef, useState } from "react";
import type { Goal } from "../../shared/agentGoal";
import type { ChatSessionGoalSummary } from "../../shared/chat";
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
  open: boolean;
  summary: ChatSessionGoalSummary | null;
  onClose: () => void;
  onStart?: () => void;
  onResolveReview?: (decision: "approve" | "reject" | "terminate") => void;
  onIncreaseBudget?: () => void;
  onReplan?: () => void;
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
      props.summary?.status !== "waiting_for_acceptance" ||
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
    props.summary?.status,
  ]);

  if (!props.open || !props.summary || !progress) {
    return null;
  }

  const hasGuardedActions =
    props.summary.status === "waiting_for_review" ||
    isRecoverableStatus(props.summary.status) ||
    progress.recoveryActions.length > 0;
  const displayTitle = buildGoalDisplayTitle(props.summary.description);

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

          {isRecoverableStatus(props.summary.status) ? (
            <section className="goal-recovery-actions">
              <span>恢复路径</span>
              <p>{getRecoveryHint(props.summary.status)}</p>
              <div className="goal-review-actions">
                {props.summary.status === "waiting_for_acceptance" &&
                progress.recoveryActions.includes("continue_acceptance") &&
                props.onContinueAcceptance ? (
                  <button
                    type="button"
                    className="goal-primary-action"
                    disabled={props.goalAcceptanceOperationPending}
                    onClick={props.onContinueAcceptance}
                  >
                    继续验收
                  </button>
                ) : null}
                {props.summary.status === "waiting_for_acceptance" &&
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
                {props.summary.status === "stopped_blocked" &&
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
                {props.summary.status === "stopped_blocked" &&
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
                {props.onCancel &&
                (props.summary.status !== "stopped_blocked" ||
                  progress.recoveryActions.includes("terminate")) ? (
                  <button
                    type="button"
                    className="goal-danger-action"
                    onClick={props.onCancel}
                  >
                    {props.summary.status === "stopped_blocked"
                      ? "终止目标"
                      : "结束目标"}
                  </button>
                ) : null}
              </div>
              {props.summary.status === "waiting_for_acceptance" &&
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
      return "目标已达到预算上限并停止，不会在后台继续。你可以增加预算后继续，或查看证据并结束目标。";
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
