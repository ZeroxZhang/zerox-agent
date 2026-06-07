import { useEffect, useMemo, useState } from "react";
import {
  buildRunTimeline,
  getRunGuidance,
  summarizeRunEventKinds,
  type RunTimelineItem,
} from "../../shared/agentRunInsights";
import type { AgentRunRecord } from "../../shared/agentRuns";
import type { AgentExecutionCheckpoint } from "../../shared/agentExecution";
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
    ])
      .then(([loadedRuns, loadedExecutions]) => {
        setRuns(loadedRuns);
        setActiveExecutions(loadedExecutions);
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
                <small>{formatDate(run.finishedAt)}</small>
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
          event={selectedEvent}
          guidance={guidance}
          run={selectedRun}
          trajectoryEvents={trajectoryEvents}
        />
      </div>

      <p className={`settings-message is-${status.kind}`}>{status.message}</p>
    </section>
  );
}

function RunInspector(props: {
  event: RunTimelineItem | null;
  guidance: ReturnType<typeof getRunGuidance> | null;
  run: AgentRunRecord | null;
  trajectoryEvents: AgentTrajectoryEvent[];
}) {
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
          </dl>
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
