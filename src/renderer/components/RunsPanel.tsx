import { useEffect, useMemo, useState } from "react";
import {
  buildRunTimeline,
  getRunGuidance,
  summarizeRunEventKinds,
  type RunTimelineItem,
} from "../../shared/agentRunInsights";
import { summarizeHandoffReviewCards } from "../../shared/agentHandoff";
import type { AgentRunRecord } from "../../shared/agentRuns";
import type { AgentExecutionCheckpoint } from "../../shared/agentExecution";
import type { AgentEvalCandidate } from "../../shared/agentEvalCandidate";
import type { AgentTrajectoryEvent } from "../../shared/agentTrajectory";
import { demoRuns } from "../demoAgentData";
import { RunTrajectoryPanel } from "./RunTrajectoryPanel";

type RunsStatus =
  | { kind: "idle"; message: string }
  | { kind: "error"; message: string }
  | { kind: "loading"; message: string };

export function RunsPanel() {
  const [runs, setRuns] = useState<AgentRunRecord[]>([]);
  const [activeExecutions, setActiveExecutions] = useState<
    AgentExecutionCheckpoint[]
  >([]);
  const [evalCandidates, setEvalCandidates] = useState<AgentEvalCandidate[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [trajectoryEvents, setTrajectoryEvents] = useState<AgentTrajectoryEvent[]>([]);
  const [status, setStatus] = useState<RunsStatus>({
    kind: "loading",
    message: "正在加载运行记录...",
  });

  useEffect(() => {
    if (!window.buildingAgent) {
      setRuns(demoRuns);
      setEvalCandidates([]);
      setSelectedRunId(demoRuns[0]?.id ?? "");
      setStatus({
        kind: "idle",
        message: "浏览器预览模式，正在展示演示运行数据。",
      });
      return;
    }

    Promise.all([
      window.buildingAgent.listAgentRuns(),
      window.buildingAgent.listActiveAgentExecutions(),
      window.buildingAgent.listEvalCandidates(),
    ])
      .then(([loadedRuns, loadedExecutions, loadedEvalCandidates]) => {
        setRuns(loadedRuns);
        setActiveExecutions(loadedExecutions);
        setEvalCandidates(loadedEvalCandidates);
        setSelectedRunId(loadedRuns[0]?.id ?? "");
        setStatus({
          kind: "idle",
          message:
            loadedRuns.length || loadedExecutions.length
              ? "运行记录已加载。"
              : "还没有运行记录。",
        });
      })
      .catch((error) => {
        setStatus({
          kind: "error",
          message:
            error instanceof Error ? error.message : "无法加载运行记录。",
        });
      });
  }, []);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId],
  );
  const timeline = useMemo(
    () => (selectedRun ? buildRunTimeline(selectedRun) : []),
    [selectedRun],
  );
  const selectedEvent =
    timeline.find((item) => item.id === selectedEventId) ?? timeline[0] ?? null;
  const guidance = selectedRun ? getRunGuidance(selectedRun) : null;
  const summary = selectedRun ? summarizeRunEventKinds(selectedRun) : null;
  const selectedEvalCandidate = useMemo(
    () =>
      selectedRun
        ? evalCandidates.find(
            (candidate) => candidate.sourceRunId === selectedRun.id,
          ) ?? null
        : null,
    [evalCandidates, selectedRun],
  );

  useEffect(() => {
    setSelectedEventId("");
  }, [selectedRunId]);

  useEffect(() => {
    if (!selectedRun) {
      setTrajectoryEvents([]);
      return;
    }

    if (!window.buildingAgent) {
      setTrajectoryEvents([]);
      return;
    }

    window.buildingAgent
      .listAgentRunTrajectory(selectedRun.id)
      .then(setTrajectoryEvents)
      .catch(() => setTrajectoryEvents([]));
  }, [selectedRun]);

  async function handleRetrySelectedRun() {
    if (!selectedRun) {
      return;
    }

    if (!window.buildingAgent) {
      setStatus({
        kind: "idle",
        message: "浏览器预览模式无法真实重试；桌面端会重新执行这条运行对应的任务。",
      });
      return;
    }

    setStatus({
      kind: "loading",
      message: `正在重新运行：${selectedRun.taskName}`,
    });
    const result = await window.buildingAgent.retryAgentRun(selectedRun.id);

    if (!result.ok) {
      setStatus({
        kind: "error",
        message: result.message,
      });
      return;
    }

    setRuns((currentRuns) => [result.run, ...currentRuns]);
    setSelectedRunId(result.run.id);
    setStatus({
      kind: result.run.status === "succeeded" ? "idle" : "error",
      message: `重试完成：${translateRunStatus(result.run.status)}。`,
    });
  }

  async function handleResumeExecution(execution: AgentExecutionCheckpoint) {
    if (!window.buildingAgent) {
      setStatus({
        kind: "idle",
        message: "浏览器预览模式无法恢复真实运行。",
      });
      return;
    }

    setStatus({
      kind: "loading",
      message: `正在恢复运行：${execution.runId}`,
    });
    const result = await window.buildingAgent.resumeAgentRun(execution.runId);

    if (!result.ok) {
      setStatus({
        kind: "error",
        message: result.message,
      });
      return;
    }

    setRuns((currentRuns) => [result.run, ...currentRuns]);
    setActiveExecutions((currentExecutions) =>
      currentExecutions.filter((item) => item.runId !== execution.runId),
    );
    setSelectedRunId(result.run.id);
    setStatus({
      kind: result.run.status === "succeeded" ? "idle" : "error",
      message: `恢复完成：${translateRunStatus(result.run.status)}。`,
    });
  }

  async function handlePauseExecution(execution: AgentExecutionCheckpoint) {
    if (!window.buildingAgent) {
      setStatus({
        kind: "idle",
        message: "浏览器预览模式无法暂停真实运行。",
      });
      return;
    }

    setStatus({
      kind: "loading",
      message: `正在暂停运行：${execution.runId}`,
    });
    const result = await window.buildingAgent.pauseAgentRun(execution.runId);

    if (!result.ok) {
      setStatus({
        kind: "error",
        message: result.message,
      });
      return;
    }

    setActiveExecutions((currentExecutions) =>
      currentExecutions.map((item) =>
        item.runId === execution.runId
          ? {
              ...item,
              status: "paused",
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    );
    setStatus({
      kind: "idle",
      message: result.message,
    });
  }

  async function handleGenerateEvalCandidateForSelectedRun() {
    if (!selectedRun || !isTerminalRun(selectedRun)) {
      return;
    }

    if (!window.buildingAgent) {
      setStatus({
        kind: "idle",
        message: "浏览器预览模式无法生成真实评测候选。",
      });
      return;
    }

    setStatus({
      kind: "loading",
      message: `正在生成评测候选：${selectedRun.taskName}`,
    });
    try {
      const result = await window.buildingAgent.generateEvalCandidateForRun(
        selectedRun.id,
      );

      if (!result.ok) {
        setStatus({ kind: "error", message: result.message });
        return;
      }

      setEvalCandidates((currentCandidates) => {
        const exists = currentCandidates.some(
          (candidate) =>
            candidate.id === result.candidate.id ||
            candidate.sourceRunId === result.candidate.sourceRunId,
        );
        if (!exists) {
          return [result.candidate, ...currentCandidates];
        }

        return currentCandidates.map((candidate) =>
          candidate.id === result.candidate.id ||
          candidate.sourceRunId === result.candidate.sourceRunId
            ? result.candidate
            : candidate,
        );
      });
      setStatus({
        kind: "idle",
        message: result.existing
          ? "已加载这条运行的现有评测候选。"
          : "评测候选已生成，等待审核。",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "无法生成评测候选。",
      });
    }
  }

  return (
    <section className="runs-panel">
      <div className="panel-heading">
        <div>
          <h2>运行</h2>
          <p>按顺序回放模型、权限、工具和记忆事件。</p>
        </div>
        <span className={`settings-state is-${status.kind}`}>
          {runs.length} 条最近记录
        </span>
      </div>

      <div className="runs-layout">
        <section className="run-list-panel" aria-label="运行历史">
          {activeExecutions.length ? (
            <div className="active-run-list" aria-label="可恢复运行">
              {activeExecutions.map((execution) => (
                <article
                  className={`run-list-item is-${execution.status}`}
                  key={execution.runId}
                >
                  <span>{translateRunStatus(execution.status)}</span>
                  <strong>{execution.runId}</strong>
                  <small>
                    {execution.currentStepId
                      ? `步骤 ${execution.currentStepId}`
                      : "等待恢复"}
                  </small>
                  {execution.runContext ? (
                    <small>
                      {formatAgentRole(execution.runContext.agentRole)} /{" "}
                      {formatWorkspaceLabel(execution.runContext.workspaceRoot)}
                    </small>
                  ) : null}
                  <div className="run-list-actions">
                    {execution.status === "paused" ? (
                      <button
                        className="secondary-action"
                        disabled={status.kind === "loading"}
                        onClick={() => void handleResumeExecution(execution)}
                        type="button"
                      >
                        恢复
                      </button>
                    ) : (
                      <button
                        className="secondary-action"
                        disabled={status.kind === "loading"}
                        onClick={() => void handlePauseExecution(execution)}
                        type="button"
                      >
                        暂停
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          {runs.length ? (
            runs.map((run) => (
              <button
                className={`run-list-item ${
                  run.id === selectedRun?.id ? "is-selected" : ""
                } is-${run.status}`}
                key={run.id}
                onClick={() => setSelectedRunId(run.id)}
                type="button"
              >
                <span>{translateRunStatus(run.status)}</span>
                <strong>{run.taskName}</strong>
                <small>
                  {run.runContext
                    ? `${formatAgentRole(run.runContext.agentRole)} / ${formatWorkspaceLabel(
                        run.runContext.workspaceRoot,
                      )}`
                    : formatDate(run.finishedAt)}
                </small>
              </button>
            ))
          ) : (
            <div className="empty-state">还没有运行记录。</div>
          )}
        </section>

        <section className="timeline-panel" aria-label="运行时间线">
          {selectedRun ? (
            <>
              <div className="run-summary-card">
                <span className={`run-status is-${selectedRun.status}`}>
                  {translateRunStatus(selectedRun.status)}
                </span>
                <div>
                  <h3>{selectedRun.taskName}</h3>
                  <p>{selectedRun.summary}</p>
                </div>
                <button
                  className="secondary-action"
                  disabled={status.kind === "loading"}
                  onClick={() => void handleRetrySelectedRun()}
                  type="button"
                >
                  重新运行任务
                </button>
              </div>

              {summary ? (
                <dl className="run-metrics">
                  <div>
                    <dt>模型</dt>
                    <dd>{summary.model}</dd>
                  </div>
                  <div>
                    <dt>权限</dt>
                    <dd>{summary.permission}</dd>
                  </div>
                  <div>
                    <dt>工具</dt>
                    <dd>{summary.tool}</dd>
                  </div>
                  <div>
                    <dt>记忆</dt>
                    <dd>{summary.memory}</dd>
                  </div>
                  <div>
                    <dt>错误</dt>
                    <dd>{summary.error}</dd>
                  </div>
                </dl>
              ) : null}

              <div className="timeline-list">
                {timeline.map((item) => (
                  <button
                    className={`timeline-event is-${item.kind} ${
                      item.id === selectedEvent?.id ? "is-selected" : ""
                    }`}
                    key={item.id}
                    onClick={() => setSelectedEventId(item.id)}
                    type="button"
                  >
                    <span aria-hidden="true" />
                    <div>
                      <strong>{item.title}</strong>
                      <small>
                        {item.detail ? `${item.detail} / ` : ""}
                        {formatTime(item.createdAt)}
                      </small>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">运行一个任务后，这里会生成时间线。</div>
          )}
        </section>

        <RunInspector
          canGenerateEvalCandidate={Boolean(
            selectedRun && isTerminalRun(selectedRun),
          )}
          evalCandidate={selectedEvalCandidate}
          event={selectedEvent}
          guidance={guidance}
          isBusy={status.kind === "loading"}
          onGenerateEvalCandidate={handleGenerateEvalCandidateForSelectedRun}
          run={selectedRun}
          trajectoryEvents={trajectoryEvents}
        />
      </div>

      <p className={`settings-message is-${status.kind}`}>{status.message}</p>
    </section>
  );
}

function RunInspector(props: {
  canGenerateEvalCandidate: boolean;
  evalCandidate: AgentEvalCandidate | null;
  event: RunTimelineItem | null;
  guidance: ReturnType<typeof getRunGuidance> | null;
  isBusy: boolean;
  onGenerateEvalCandidate: () => void;
  run: AgentRunRecord | null;
  trajectoryEvents: AgentTrajectoryEvent[];
}) {
  const handoffCards = useMemo(
    () => summarizeHandoffReviewCards(props.trajectoryEvents),
    [props.trajectoryEvents],
  );

  return (
    <aside className="run-inspector" aria-label="运行检查器">
      <div className="inspector-section">
        <span className="inspector-label">处理建议</span>
        {props.guidance ? (
          <article className={`guidance-card is-${props.guidance.tone}`}>
            <strong>{props.guidance.title}</strong>
            <p>{props.guidance.action}</p>
          </article>
        ) : (
          <p>还没有选中运行。</p>
        )}
      </div>

      <div className="inspector-section">
        <span className="inspector-label">选中事件</span>
        {props.event ? (
          <>
            <h3>{props.event.title}</h3>
            <dl className="inspector-dl">
              <div>
                <dt>类型</dt>
                <dd>{translateTimelineKind(props.event.kind)}</dd>
              </div>
              <div>
                <dt>级别</dt>
                <dd>{translateLevel(props.event.level)}</dd>
              </div>
              <div>
                <dt>时间</dt>
                <dd>{formatTime(props.event.createdAt)}</dd>
              </div>
            </dl>
            <pre className="payload-preview">
              {JSON.stringify(props.event.data ?? {}, null, 2)}
            </pre>
          </>
        ) : (
          <p>选择一个事件后，可以查看 payload 详情。</p>
        )}
      </div>

      {props.run ? (
        <div className="inspector-section">
          <span className="inspector-label">运行身份</span>
          <dl className="inspector-dl">
            <div>
              <dt>任务</dt>
              <dd>{props.run.taskName}</dd>
            </div>
            <div>
              <dt>技能</dt>
              <dd>{props.run.skillName}</dd>
            </div>
            <div>
              <dt>完成时间</dt>
              <dd>{formatDate(props.run.finishedAt)}</dd>
            </div>
            {props.run.runContext ? (
              <>
                <div>
                  <dt>角色</dt>
                  <dd>{formatAgentRole(props.run.runContext.agentRole)}</dd>
                </div>
                <div>
                  <dt>工作区</dt>
                  <dd>{props.run.runContext.workspaceRoot}</dd>
                </div>
                <div>
                  <dt>沙箱</dt>
                  <dd>{formatSandboxSummary(props.run.runContext.sandbox)}</dd>
                </div>
                {props.run.runContext.sessionId ? (
                  <div>
                    <dt>会话</dt>
                    <dd>{props.run.runContext.sessionId}</dd>
                  </div>
                ) : null}
                {props.run.runContext.parentRunId ? (
                  <div>
                    <dt>父运行</dt>
                    <dd>{props.run.runContext.parentRunId}</dd>
                  </div>
                ) : null}
              </>
            ) : null}
            {props.run.childRunIds?.length ? (
              <div>
                <dt>子运行</dt>
                <dd>{props.run.childRunIds.join(", ")}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}

      {props.run ? (
        <div className="inspector-section" aria-label="Eval Candidate">
          <span className="inspector-label">Eval Candidate</span>
          {props.evalCandidate ? (
            <dl className="inspector-dl">
              <div>
                <dt>状态</dt>
                <dd>{translateEvalCandidateStatus(props.evalCandidate.status)}</dd>
              </div>
              <div>
                <dt>Fixture</dt>
                <dd>{props.evalCandidate.fixture.id}</dd>
              </div>
            </dl>
          ) : props.canGenerateEvalCandidate ? (
            <>
              <p>这条运行还没有评测候选。</p>
              <button
                className="primary-action"
                disabled={props.isBusy}
                onClick={() => props.onGenerateEvalCandidate()}
                type="button"
              >
                生成评测候选
              </button>
            </>
          ) : (
            <p>运行结束后可生成评测候选。</p>
          )}
        </div>
      ) : null}

      {handoffCards.length ? (
        <div className="inspector-section" aria-label="Handoff Review">
          <span className="inspector-label">Handoff Review</span>
          {handoffCards.map((card) => (
            <article
              className={`handoff-review-card is-${card.status}`}
              key={card.handoffId}
            >
              <div>
                <strong>{formatAgentRole(card.childRole)}</strong>
                <span>{translateHandoffStatus(card.status)}</span>
              </div>
              <p>{card.objective}</p>
              <dl className="inspector-dl">
                {card.childRunId ? (
                  <div>
                    <dt>子运行</dt>
                    <dd>{card.childRunId}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>审核</dt>
                  <dd>
                    {card.reviewDecision
                      ? translateReviewDecision(card.reviewDecision)
                      : "等待审核"}
                  </dd>
                </div>
                <div>
                  <dt>产物</dt>
                  <dd>
                    {card.artifactLabels.length
                      ? card.artifactLabels.join(", ")
                      : "未记录"}
                  </dd>
                </div>
              </dl>
              {card.checklist.length ? (
                <ul>
                  {card.checklist.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      <RunTrajectoryPanel events={props.trajectoryEvents} />
    </aside>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatWorkspaceLabel(workspaceRoot: string): string {
  return workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? workspaceRoot;
}

function formatAgentRole(role: NonNullable<AgentRunRecord["runContext"]>["agentRole"]): string {
  const labels: Record<
    NonNullable<AgentRunRecord["runContext"]>["agentRole"],
    string
  > = {
    primary: "主运行",
    researcher: "研究",
    planner: "规划",
    executor: "执行",
    reviewer: "审查",
    critic: "批评",
  };

  return labels[role];
}

function translateHandoffStatus(
  status: ReturnType<typeof summarizeHandoffReviewCards>[number]["status"],
): string {
  const labels: Record<
    ReturnType<typeof summarizeHandoffReviewCards>[number]["status"],
    string
  > = {
    pending: "待启动",
    running: "子运行中",
    completed: "待审核",
    accepted: "已接受",
    rejected: "已拒绝",
    revision_requested: "需修订",
  };

  return labels[status];
}

function translateReviewDecision(
  decision: NonNullable<
    ReturnType<typeof summarizeHandoffReviewCards>[number]["reviewDecision"]
  >,
): string {
  const labels: Record<
    NonNullable<
      ReturnType<typeof summarizeHandoffReviewCards>[number]["reviewDecision"]
    >,
    string
  > = {
    accepted: "接受",
    rejected: "拒绝",
    revision_requested: "要求修订",
  };

  return labels[decision];
}

function formatSandboxSummary(
  sandbox: NonNullable<AgentRunRecord["runContext"]>["sandbox"],
): string {
  const mode = sandbox.mode === "read_only" ? "只读" : "工作区写入";
  const network =
    sandbox.network === "none"
      ? "无网络"
      : sandbox.network === "approved_domains"
        ? "限定域名"
        : "任务策略";
  const shell =
    sandbox.shell === "disabled"
      ? "无命令"
      : sandbox.shell === "workspace_only"
        ? "工作区命令"
        : "授权命令";

  return `${mode} / ${network} / ${shell}`;
}

function isTerminalRun(run: AgentRunRecord): boolean {
  return (
    run.status === "succeeded" ||
    run.status === "failed" ||
    run.status === "canceled"
  );
}

function translateEvalCandidateStatus(
  status: AgentEvalCandidate["status"],
): string {
  if (status === "pending_review") {
    return "待审核";
  }

  if (status === "accepted") {
    return "已接受";
  }

  if (status === "promoted") {
    return "已提升";
  }

  return "已拒绝";
}

function translateRunStatus(status: AgentRunRecord["status"]): string {
  if (status === "queued") {
    return "排队中";
  }

  if (status === "running") {
    return "运行中";
  }

  if (status === "waiting_for_approval") {
    return "等待授权";
  }

  if (status === "paused") {
    return "可恢复";
  }

  if (status === "succeeded") {
    return "成功";
  }

  if (status === "canceled") {
    return "已取消";
  }

  return "失败";
}

function translateTimelineKind(kind: RunTimelineItem["kind"]): string {
  const labels: Record<RunTimelineItem["kind"], string> = {
    error: "错误",
    memory: "记忆",
    model: "模型",
    permission: "权限",
    system: "系统",
    tool: "工具",
  };

  return labels[kind];
}

function translateLevel(level: RunTimelineItem["level"]): string {
  if (level === "error") {
    return "错误";
  }

  if (level === "warn") {
    return "警告";
  }

  return "信息";
}
