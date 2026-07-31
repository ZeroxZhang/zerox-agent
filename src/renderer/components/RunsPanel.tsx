import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildRunTimeline,
  getRunGuidance,
  type RunTimelineItem,
} from "../../shared/agentRunInsights";
import { summarizeHandoffReviewCards } from "../../shared/agentHandoff";
import type { AgentRunRecord } from "../../shared/agentRuns";
import type { AgentExecutionCheckpoint } from "../../shared/agentExecution";
import type { AgentEvalCandidate } from "../../shared/agentEvalCandidate";
import type { AgentTrajectoryEvent } from "../../shared/agentTrajectory";
import type { KernelEvent } from "../../shared/kernelContract";
import {
  reduceKernelEventsToRunViews,
  summarizeKernelEventForTimeline,
} from "../../shared/kernelEventView";
import {
  projectRunGraph,
  type RunGraphGate,
} from "../../shared/runGraph";
import {
  buildRunRecordSummary,
  compareRunRecordPriority,
  getRunRecordAction,
  getRunRecordStatus,
  toRunRecordListItem,
  type RunRecordAction,
} from "../../shared/runRecordViewModel";
import { demoRuns } from "../demoAgentData";
import { Icon } from "./Icon";
import { RunTrajectoryPanel } from "./RunTrajectoryPanel";

type RunsStatus =
  | { kind: "idle"; message: string }
  | { kind: "error"; message: string }
  | { kind: "loading"; message: string };

type SelectedRunSelection = {
  id: string;
  source: "active" | "history";
};

export function RunsPanel(props: {
  onOpenChatSession: (sessionId: string) => void;
}) {
  const [runs, setRuns] = useState<AgentRunRecord[]>([]);
  const [activeExecutions, setActiveExecutions] = useState<
    AgentExecutionCheckpoint[]
  >([]);
  const [evalCandidates, setEvalCandidates] = useState<AgentEvalCandidate[]>([]);
  const [selectedRunSelection, setSelectedRunSelection] =
    useState<SelectedRunSelection | null>(null);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [activeRunsTab, setActiveRunsTab] = useState<
    "action" | "history" | "details"
  >("action");
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [trajectoryEvents, setTrajectoryEvents] = useState<AgentTrajectoryEvent[]>([]);
  const [kernelEvents, setKernelEvents] = useState<KernelEvent[]>([]);
  const [status, setStatus] = useState<RunsStatus>({
    kind: "loading",
    message: "正在加载运行记录...",
  });

  const refreshRunsSnapshot = useCallback(async (selectFirstRun = false) => {
    if (!window.buildingAgent) {
      setRuns(demoRuns);
      setEvalCandidates([]);
      setKernelEvents(createDemoKernelEvents());
      setSelectedRunSelection((currentSelection) =>
        selectFirstRun
          ? null
          : resolveSelectedRunSelection(currentSelection, demoRuns, []),
      );
      setStatus({
        kind: "idle",
        message: "浏览器预览模式，正在展示演示运行数据。",
      });
      return;
    }

    await Promise.all([
      window.buildingAgent.listAgentRuns(),
      window.buildingAgent.listActiveAgentExecutions(),
      window.buildingAgent.listEvalCandidates(),
    ])
      .then(([loadedRuns, loadedExecutions, loadedEvalCandidates]) => {
        setRuns(loadedRuns);
        setActiveExecutions(loadedExecutions);
        setEvalCandidates(loadedEvalCandidates);
        setSelectedRunSelection((currentSelection) =>
          selectFirstRun
            ? null
            : resolveSelectedRunSelection(
                currentSelection,
                loadedRuns,
                loadedExecutions,
              ),
        );
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

  useEffect(() => {
    void refreshRunsSnapshot(true);
  }, [refreshRunsSnapshot]);

  useEffect(() => {
    if (!window.buildingAgent) {
      return;
    }

    return window.buildingAgent.onAgentRunsChanged(() => {
      void refreshRunsSnapshot(false);
    });
  }, [refreshRunsSnapshot]);

  useEffect(() => {
    if (!window.buildingAgent) {
      return;
    }

    return window.buildingAgent.onAgentStreamEvent(() => {
      void refreshRunsSnapshot(false);
    });
  }, [refreshRunsSnapshot]);

  useEffect(() => {
    if (!window.buildingAgent) {
      return;
    }

    return window.buildingAgent.onKernelEvent((event) => {
      setKernelEvents((currentEvents) => appendKernelEvent(currentEvents, event));
    });
  }, []);

  const sortedRuns = useMemo(
    () => [...runs].sort(compareRunRecordPriority),
    [runs],
  );
  const sortedActiveExecutions = useMemo(
    () => [...activeExecutions].sort(compareRunRecordPriority),
    [activeExecutions],
  );
  const selectedActiveExecution = useMemo(
    () =>
      selectedRunSelection?.source === "active"
        ? activeExecutions.find(
            (execution) => execution.runId === selectedRunSelection.id,
          ) ?? null
        : null,
    [activeExecutions, selectedRunSelection],
  );
  const selectedPersistedRun = useMemo(
    () =>
      selectedRunSelection?.source === "history"
        ? runs.find((run) => run.id === selectedRunSelection.id) ?? null
        : null,
    [runs, selectedRunSelection],
  );
  const selectedRunRecord =
    selectedActiveExecution ??
    selectedPersistedRun ??
    sortedActiveExecutions[0] ??
    sortedRuns[0] ??
    null;
  const selectedRecordId = selectedRunRecord
    ? getRunRecordStableId(selectedRunRecord)
    : "";
  const selectedRun =
    selectedRunRecord && isPersistedRunRecord(selectedRunRecord)
      ? selectedRunRecord
      : selectedPersistedRun;
  const selectedRunAction = selectedRunRecord
    ? getRunRecordAction(selectedRunRecord)
    : null;
  const selectedRunStatus = selectedRunRecord
    ? getRunRecordStatus(selectedRunRecord)
    : null;
  const selectedRunSummary = selectedRunRecord
    ? isPersistedRunRecord(selectedRunRecord)
      ? buildRunRecordSummary(selectedRunRecord, trajectoryEvents)
      : buildActiveRunRecordSummary(selectedRunRecord, selectedRunAction)
    : null;
  const recentRunItems = useMemo(
    () => sortedRuns.slice(0, 8).map(toRunRecordListItem),
    [sortedRuns],
  );
  const activeExecutionItems = useMemo(
    () => sortedActiveExecutions.slice(0, 4).map(toRunRecordListItem),
    [sortedActiveExecutions],
  );
  const timeline = useMemo(
    () => (selectedRun ? buildRunTimeline(selectedRun) : []),
    [selectedRun],
  );
  const selectedEvent =
    timeline.find((item) => item.id === selectedEventId) ?? timeline[0] ?? null;
  const guidance = selectedRun ? getRunGuidance(selectedRun) : null;
  const selectedEvalCandidate = useMemo(
    () =>
      selectedRun
        ? evalCandidates.find(
            (candidate) => candidate.sourceRunId === selectedRun.id,
          ) ?? null
        : null,
    [evalCandidates, selectedRun],
  );
  const selectedKernelEvents = useMemo(
    () =>
      selectedRun
        ? kernelEvents.filter((event) => event.runId === selectedRun.id)
        : [],
    [kernelEvents, selectedRun],
  );

  useEffect(() => {
    setSelectedEventId("");
  }, [selectedRecordId]);

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
    setSelectedRunSelection({ id: result.run.id, source: "history" });
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
    setSelectedRunSelection({ id: result.run.id, source: "history" });
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
        message: "浏览器预览模式无法生成真实回归样例。",
      });
      return;
    }

    setStatus({
      kind: "loading",
      message: `正在生成回归样例：${selectedRun.taskName}`,
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
          ? "已加载这次任务的现有回归样例。"
          : "回归样例已生成，等待审核。",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "无法生成回归样例。",
      });
    }
  }

  async function handleRunRecordAction(action: RunRecordAction) {
    if (!selectedRunRecord) {
      return;
    }

    if (action.kind === "retry") {
      if (!selectedRun) {
        setStatus({
          kind: "error",
          message: "这条任务还没有完成记录，暂时不能重新运行。",
        });
        return;
      }
      await handleRetrySelectedRun();
      return;
    }

    if (action.kind === "continue") {
      const checkpoint = activeExecutions.find(
        (execution) => execution.runId === selectedRecordId,
      );
      if (checkpoint) {
        await handleResumeExecution(checkpoint);
      } else {
        setStatus({
          kind: "error",
          message: "没有找到可恢复检查点，请重新运行任务。",
        });
      }
      return;
    }

    if (action.kind === "stop") {
      const checkpoint = activeExecutions.find(
        (execution) => execution.runId === selectedRecordId,
      );
      if (checkpoint) {
        await handlePauseExecution(checkpoint);
      } else {
        setStatus({
          kind: "idle",
          message: "这条任务当前没有运行中的检查点。",
        });
      }
      return;
    }

    if (action.kind === "view_details" || action.kind === "view_result") {
      setActiveRunsTab("details");
      setShowTechnicalDetails(action.kind === "view_details" && Boolean(selectedRun));
      if (action.kind === "view_details" && !selectedRun) {
        setStatus({
          kind: "idle",
          message: "任务完成后会显示技术详情。",
        });
      }
      return;
    }

    if (action.kind === "open_chat") {
      await openChatSessionForRecord(selectedRunRecord);
      return;
    }

    if (action.kind === "review_permission") {
      await openChatSessionForRecord(selectedRunRecord);
      return;
    }

    if (action.kind === "open_settings") {
      navigateToHash("settings");
    }
  }

  return (
    <section className="runs-panel task-records-panel">
      <div className="panel-heading task-records-heading">
        <div>
          <h2>任务概览</h2>
          <p>看任务是否完成。需要处理时，直接给你下一步。</p>
        </div>
        <div className="task-records-heading-actions">
          <button
            className="secondary-action"
            onClick={() => void openChatSessionForRecord(selectedRunRecord)}
            type="button"
          >
            打开会话
          </button>
          <button
            className="primary-action"
            onClick={() => navigateToHash("scheduled-tasks")}
            type="button"
          >
            新任务
          </button>
        </div>
      </div>

      {selectedRunRecord &&
      selectedRunStatus &&
      selectedRunAction &&
      selectedRunSummary ? (
        <>
          <article className={`task-record-focus is-${selectedRunStatus.tone}`}>
            <div className="task-record-focus-main">
              <span className={`task-record-status is-${selectedRunStatus.tone}`}>
                {selectedRunStatus.label}
              </span>
              <h3>{selectedRunSummary.title}</h3>
              <p>{selectedRunSummary.outcome}</p>
            </div>
            <div className="task-record-next">
              <span>下一步</span>
              <strong>{selectedRunSummary.nextStep}</strong>
              <button
                className="primary-action"
                disabled={status.kind === "loading"}
                onClick={() => void handleRunRecordAction(selectedRunAction.primary)}
                type="button"
              >
                {selectedRunAction.primary.label}
              </button>
              <div className="task-record-secondary-actions">
                {selectedRunAction.secondary.map((action) => (
                  <button
                    className="secondary-action"
                    disabled={status.kind === "loading"}
                    key={action.kind}
                    onClick={() => void handleRunRecordAction(action)}
                    type="button"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          </article>

          <div
            className="task-record-mobile-tabs"
            role="tablist"
            aria-label="任务记录视图"
          >
            <button
              className={activeRunsTab === "action" ? "is-active" : ""}
              onClick={() => setActiveRunsTab("action")}
              type="button"
            >
              处理
            </button>
            <button
              className={activeRunsTab === "history" ? "is-active" : ""}
              onClick={() => setActiveRunsTab("history")}
              type="button"
            >
              历史
            </button>
            <button
              className={activeRunsTab === "details" ? "is-active" : ""}
              onClick={() => setActiveRunsTab("details")}
              type="button"
            >
              详情
            </button>
          </div>

          <div className="task-records-content">
            <section
              className={`task-record-card task-record-history ${
                activeRunsTab === "history" ? "is-active-mobile" : ""
              }`}
              aria-label="最近任务"
            >
              <div className="task-record-card-header">
                <h3>最近任务</h3>
                <span>{recentRunItems.length} 次</span>
              </div>
              {activeExecutionItems.length ? (
                <div className="task-record-active-list" aria-label="正在进行">
                  {activeExecutionItems.map((item) => (
                    <button
                      className={`task-record-row is-active-execution ${
                        selectedRunRecord &&
                        !isPersistedRunRecord(selectedRunRecord) &&
                        item.id === selectedRecordId
                          ? "is-selected"
                          : ""
                      }`}
                      key={`active-${item.id}`}
                      onClick={() =>
                        setSelectedRunSelection({
                          id: item.id,
                          source: "active",
                        })
                      }
                      type="button"
                    >
                      <span className={`task-record-status is-${item.status.tone}`}>
                        {item.status.label}
                      </span>
                      <strong>{item.title}</strong>
                      <small>{item.subtitle}</small>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="task-record-list">
                {recentRunItems.map((item) => (
                  <button
                    className={`task-record-row ${
                      selectedRunRecord &&
                      isPersistedRunRecord(selectedRunRecord) &&
                      item.id === selectedRecordId
                        ? "is-selected"
                        : ""
                    }`}
                    key={item.id}
                    onClick={() =>
                      setSelectedRunSelection({
                        id: item.id,
                        source: "history",
                      })
                    }
                    type="button"
                  >
                    <span className={`task-record-status is-${item.status.tone}`}>
                      {item.status.label}
                    </span>
                    <strong>{item.title}</strong>
                    <small>{item.subtitle}</small>
                  </button>
                ))}
              </div>
            </section>

            <section
              className={`task-record-card task-record-details ${
                activeRunsTab === "details" || activeRunsTab === "action"
                  ? "is-active-mobile"
                  : ""
              }`}
              aria-label="任务详情"
            >
              <div className="task-record-card-header">
                <h3>这次发生了什么</h3>
                <span>简版详情</span>
              </div>
              <div className="task-record-step-list">
                {selectedRunSummary.simpleSteps.length ? (
                  selectedRunSummary.simpleSteps.map((step, index) => (
                    <article
                      className={`task-record-step is-${step.tone}`}
                      key={`${step.createdAt}-${index}`}
                    >
                      <span>{index + 1}</span>
                      <div>
                        <strong>{step.title}</strong>
                        <p>{step.detail}</p>
                      </div>
                      <time>{formatTime(step.createdAt)}</time>
                    </article>
                  ))
                ) : (
                  <p className="task-record-empty-copy">
                    这次任务没有可查看的步骤。
                  </p>
                )}
              </div>

              <div className="task-record-facts">
                <span>
                  {selectedRunSummary.producedArtifacts
                    ? "已生成产物"
                    : "未生成产物"}
                </span>
                <span>
                  {selectedRunSummary.wroteMemory ? "已写入记忆" : "未写入记忆"}
                </span>
                <span>{selectedRunSummary.technicalEventCount} 条技术事件</span>
                <span>{selectedRunSummary.trajectoryEventCount} 条证据事件</span>
              </div>

              <details
                className="task-record-technical-details"
                open={showTechnicalDetails}
                onToggle={(event) =>
                  setShowTechnicalDetails(event.currentTarget.open)
                }
              >
                <summary>技术详情</summary>
                {selectedRun ? (
                  <RunInspector
                    canGenerateEvalCandidate={Boolean(isTerminalRun(selectedRun))}
                    evalCandidate={selectedEvalCandidate}
                    event={selectedEvent}
                    guidance={guidance}
                    isBusy={status.kind === "loading"}
                    kernelEvents={selectedKernelEvents}
                    onGenerateEvalCandidate={
                      handleGenerateEvalCandidateForSelectedRun
                    }
                    run={selectedRun}
                    trajectoryEvents={trajectoryEvents}
                  />
                ) : (
                  <p className="task-record-empty-copy">
                    这次任务还没有可查看的技术详情，完成后会在这里出现。
                  </p>
                )}
              </details>
            </section>
          </div>
        </>
      ) : (
        <section className="task-record-empty-state">
          <Icon name="task" size={28} />
          <h3>还没有任务记录</h3>
          <p>从会话里发起一个任务，完成后会在这里看到结果和步骤。</p>
          <button
            className="primary-action"
            onClick={() => navigateToHash("chat")}
            type="button"
          >
            打开会话
          </button>
        </section>
      )}

      <p className={`settings-message is-${status.kind}`}>{status.message}</p>
    </section>
  );

  async function openChatSessionForRecord(
    record: AgentRunRecord | AgentExecutionCheckpoint | null,
  ): Promise<void> {
    if (!record) {
      setStatus({
        kind: "error",
        message: "还没有选中可打开的任务记录。",
      });
      return;
    }

    if (!window.buildingAgent) {
      const sessionId = record.runContext?.sessionId;
      if (sessionId) {
        props.onOpenChatSession(sessionId);
        return;
      }
      setStatus({
        kind: "error",
        message: "浏览器预览模式无法打开真实任务会话。",
      });
      return;
    }

    setStatus({
      kind: "loading",
      message: "正在打开任务会话...",
    });

    const result = await window.buildingAgent.openAgentRunSession(
      getRunRecordStableId(record),
    );
    if (!result.ok) {
      setStatus({ kind: "error", message: result.message });
      return;
    }

    props.onOpenChatSession(result.sessionId);
    setStatus({
      kind: "idle",
      message: "已打开任务会话。",
    });
  }
}

function navigateToHash(sectionId: "chat" | "scheduled-tasks" | "settings") {
  const nextHash = `#${sectionId}`;

  if (window.location.hash === nextHash) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }

  window.location.hash = nextHash;
}

function resolveSelectedRunSelection(
  selection: SelectedRunSelection | null,
  runs: AgentRunRecord[],
  activeExecutions: AgentExecutionCheckpoint[],
): SelectedRunSelection | null {
  if (!selection) {
    return null;
  }

  const activeExists = activeExecutions.some(
    (execution) => execution.runId === selection.id,
  );
  const historyExists = runs.some((run) => run.id === selection.id);

  if (selection.source === "active") {
    if (activeExists) {
      return selection;
    }

    return historyExists ? { id: selection.id, source: "history" } : null;
  }

  if (historyExists) {
    return selection;
  }

  return activeExists ? { id: selection.id, source: "active" } : null;
}

function isPersistedRunRecord(
  record: AgentRunRecord | AgentExecutionCheckpoint,
): record is AgentRunRecord {
  return "taskName" in record;
}

function getRunRecordStableId(
  record: AgentRunRecord | AgentExecutionCheckpoint,
): string {
  return isPersistedRunRecord(record) ? record.id : record.runId;
}

function buildActiveRunRecordSummary(
  execution: AgentExecutionCheckpoint,
  action: ReturnType<typeof getRunRecordAction> | null,
): ReturnType<typeof buildRunRecordSummary> {
  const status = getRunRecordStatus(execution);
  const simpleSteps = execution.steps.length
    ? execution.steps.map((step) => ({
        title: step.description || `步骤 ${step.id}`,
        detail: buildActiveExecutionStepDetail(step),
        tone: getActiveExecutionStepTone(step),
        createdAt: step.startedAt ?? step.finishedAt ?? execution.updatedAt,
      }))
    : [
        {
          title: "等待记录步骤",
          detail: "任务正在准备或运行，完成后会同步步骤记录。",
          tone: status.tone,
          createdAt: execution.updatedAt,
        },
      ];

  return {
    title: execution.taskId ? `任务 ${execution.taskId}` : `运行 ${execution.runId}`,
    outcome: status.description,
    nextStep: action ? `可以选择「${action.primary.label}」。` : "查看任务详情。",
    producedArtifacts: false,
    wroteMemory: false,
    simpleSteps,
    technicalEventCount: execution.steps.length,
    trajectoryEventCount: 0,
  };
}

function buildActiveExecutionStepDetail(
  step: AgentExecutionCheckpoint["steps"][number],
): string {
  if (step.failureMessage) {
    return step.failureMessage;
  }

  if (step.expectedTool) {
    return `工具：${step.expectedTool}`;
  }

  return step.expectedOutcome || formatExecutionStepState(step.state);
}

function getActiveExecutionStepTone(
  step: AgentExecutionCheckpoint["steps"][number],
): ReturnType<typeof getRunRecordStatus>["tone"] {
  if (step.state === "failed") {
    return "danger";
  }

  if (step.state === "waiting_for_approval") {
    return "attention";
  }

  if (step.state === "completed") {
    return "success";
  }

  return "info";
}

function formatExecutionStepState(
  state: AgentExecutionCheckpoint["steps"][number]["state"],
): string {
  const labels: Record<
    AgentExecutionCheckpoint["steps"][number]["state"],
    string
  > = {
    completed: "已完成",
    failed: "需要处理",
    pending: "等待开始",
    running: "正在执行",
    skipped: "已跳过",
    waiting_for_approval: "等待授权",
    waiting_for_tool: "等待工具",
  };

  return labels[state];
}

function RunInspector(props: {
  canGenerateEvalCandidate: boolean;
  evalCandidate: AgentEvalCandidate | null;
  event: RunTimelineItem | null;
  guidance: ReturnType<typeof getRunGuidance> | null;
  isBusy: boolean;
  kernelEvents: KernelEvent[];
  onGenerateEvalCandidate: () => void;
  run: AgentRunRecord | null;
  trajectoryEvents: AgentTrajectoryEvent[];
}) {
  const handoffCards = useMemo(
    () => summarizeHandoffReviewCards(props.trajectoryEvents),
    [props.trajectoryEvents],
  );
  const kernelRunView = useMemo(
    () =>
      props.run
        ? reduceKernelEventsToRunViews(props.kernelEvents).find(
            (view) => view.runId === props.run?.id,
          ) ?? null
        : null,
    [props.kernelEvents, props.run],
  );
  const kernelTimelineCards = useMemo(
    () =>
      props.kernelEvents.map((event) => ({
        event,
        summary: summarizeKernelEventForTimeline(event),
      })),
    [props.kernelEvents],
  );
  const runGraph = useMemo(
    () =>
      props.run
        ? projectRunGraph({
            run: props.run,
            trajectoryEvents: props.trajectoryEvents,
            kernelEvents: props.kernelEvents,
          })
        : null,
    [props.kernelEvents, props.run, props.trajectoryEvents],
  );

  return (
    <aside className="run-inspector" aria-label="任务详情">
      <div className="inspector-section">
        <span className="inspector-label">下一步</span>
        {props.guidance ? (
          <article className={`guidance-card is-${props.guidance.tone}`}>
            <strong>{props.guidance.title}</strong>
            <p>{props.guidance.action}</p>
          </article>
        ) : (
          <p>还没有选中任务。</p>
        )}
      </div>

      <div className="inspector-section">
        <span className="inspector-label">步骤详情</span>
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
          <p>选择一个步骤后，可以查看原始详情。</p>
        )}
      </div>

      <div
        className="inspector-section"
        aria-label="证据链"
        data-technical-surface="Run Graph"
      >
        <span className="inspector-label">证据链</span>
        {runGraph ? (
          <>
            <dl className="run-graph-summary">
              <div>
                <dt>证据点</dt>
                <dd>{runGraph.nodes.length}</dd>
              </div>
              <div>
                <dt>关联</dt>
                <dd>{runGraph.edges.length}</dd>
              </div>
              <div>
                <dt>审核点</dt>
                <dd>{runGraph.gates.length}</dd>
              </div>
              <div>
                <dt>证据</dt>
                <dd>{runGraph.evidence.length}</dd>
              </div>
            </dl>
            {runGraph.gates.length ? (
              <div className="run-graph-gate-list">
                {runGraph.gates.map((gate) => (
                  <article
                    className={`run-graph-gate is-${gate.status}`}
                    key={gate.id}
                  >
                    <div>
                      <strong>{translateRunGraphGateKind(gate.kind)}</strong>
                      <span>{translateRunGraphGateStatus(gate.status)}</span>
                    </div>
                    <p>{gate.title}</p>
                    <small>{gate.sourceRefs.join(", ")}</small>
                  </article>
                ))}
              </div>
            ) : (
              <p>尚未记录审核点。</p>
            )}
          </>
        ) : (
          <p>选择一条任务记录后，可以查看证据链。</p>
        )}
      </div>

      <div
        className="inspector-section"
        aria-label="高级日志"
        data-technical-surface="Kernel Events"
      >
        <span className="inspector-label">高级日志</span>
        {kernelTimelineCards.length ? (
          <>
            {kernelRunView ? (
              <dl className="inspector-dl">
                <div>
                  <dt>状态</dt>
                  <dd>{translateRunStatus(kernelRunView.status)}</dd>
                </div>
                <div>
                  <dt>轮次</dt>
                  <dd>
                    第 {kernelRunView.turn} 轮
                    {kernelRunView.maxTurns
                      ? ` · 每 ${kernelRunView.maxTurns} 轮保存检查点`
                      : ""}
                  </dd>
                </div>
              </dl>
            ) : null}
            <div className="kernel-event-list">
              {kernelTimelineCards.map(({ event, summary }, index) => (
                <article
                  className={`kernel-event-card is-${summary.tone}`}
                  key={getKernelEventKey(event, index)}
                >
                  <div>
                    <strong>{summary.title}</strong>
                    <span>{formatTime(event.createdAt)}</span>
                  </div>
                  <p>{summary.detail}</p>
                  {event.type === "retry" ? (
                    <small>{event.error}</small>
                  ) : null}
                </article>
              ))}
            </div>
          </>
        ) : (
          <p>这次任务没有记录高级日志。</p>
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
        <div
          className="inspector-section"
          aria-label="回归样例"
          data-technical-surface="Eval Candidate"
        >
          <span className="inspector-label">回归样例</span>
          {props.evalCandidate ? (
            <dl className="inspector-dl">
              <div>
                <dt>状态</dt>
                <dd>{translateEvalCandidateStatus(props.evalCandidate.status)}</dd>
              </div>
              <div>
                <dt>样例</dt>
                <dd>{props.evalCandidate.fixture.id}</dd>
              </div>
            </dl>
          ) : props.canGenerateEvalCandidate ? (
            <>
              <p>这次任务还没有回归样例。</p>
              <button
                className="primary-action"
                disabled={props.isBusy}
                onClick={() => props.onGenerateEvalCandidate()}
                type="button"
              >
                生成回归样例
              </button>
            </>
          ) : (
            <p>任务结束后可生成回归样例。</p>
          )}
        </div>
      ) : null}

      {handoffCards.length ? (
        <div
          className="inspector-section"
          aria-label="协作审核"
          data-technical-surface="Handoff Review"
        >
          <span className="inspector-label">协作审核</span>
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

function translateRunGraphGateKind(kind: RunGraphGate["kind"]): string {
  const labels: Record<RunGraphGate["kind"], string> = {
    acceptance: "验收",
    goal_review: "目标审核",
    permission: "权限",
    reconcile: "状态对账",
    strategy_guard: "策略护栏",
    workspace_sandbox: "工作区沙箱",
  };

  return labels[kind];
}

function translateRunGraphGateStatus(status: RunGraphGate["status"]): string {
  const labels: Record<RunGraphGate["status"], string> = {
    blocked: "阻塞",
    succeeded: "通过",
    waiting: "等待",
  };

  return labels[status];
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

function appendKernelEvent(
  events: KernelEvent[],
  nextEvent: KernelEvent,
): KernelEvent[] {
  const nextKey = getKernelEventKey(nextEvent);
  if (events.some((event) => getKernelEventKey(event) === nextKey)) {
    return events;
  }

  return [...events, nextEvent].slice(-500);
}

function getKernelEventKey(event: KernelEvent, fallbackIndex = 0): string {
  return `${event.runId}:${event.type}:${event.createdAt}:${fallbackIndex}`;
}

function createDemoKernelEvents(): KernelEvent[] {
  return [
    {
      v: 1,
      type: "turn_start",
      runId: "demo_run_1",
      turn: 1,
      maxTurns: 8,
      createdAt: "2026-06-05T08:00:01.000Z",
    },
    {
      v: 1,
      type: "checkpoint_written",
      runId: "demo_run_1",
      ref: "kernel-checkpoints/demo_run_1/checkpoint_1.json",
      turn: 1,
      createdAt: "2026-06-05T08:00:02.000Z",
    },
    {
      v: 1,
      type: "compaction",
      runId: "demo_run_1",
      beforeTokens: 128000,
      afterTokens: 42000,
      prunedTurns: [1, 2, 3],
      checkpointRef: "kernel-checkpoints/demo_run_1/checkpoint_1.json",
      createdAt: "2026-06-05T08:00:03.000Z",
    },
    {
      v: 1,
      type: "retry",
      runId: "demo_run_1",
      attempt: 1,
      maxRetries: 3,
      afterMs: 1200,
      error: "rate_limit_exceeded",
      createdAt: "2026-06-05T08:00:04.000Z",
    },
    {
      v: 1,
      type: "judge_verdict",
      runId: "demo_run_1",
      decision: {
        stop: true,
        reason: "Evidence confirms the report and memory write completed.",
        evidence: ["agent-report.md", "memory:demo_memory_1"],
      },
      createdAt: "2026-06-05T08:00:05.000Z",
    },
    {
      v: 1,
      type: "run_end",
      runId: "demo_run_1",
      status: "succeeded",
      reason: "Goal evidence accepted.",
      createdAt: "2026-06-05T08:00:06.000Z",
    },
  ];
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
