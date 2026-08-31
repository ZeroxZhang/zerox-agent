import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentTrajectoryEvent } from "../../shared/agentTrajectory";
import { summarizeTrajectoryInsights } from "../../shared/agentTrajectoryInsights";
import { redactCredentials } from "../../shared/credentialRedaction";
import { assessUnknownTrajectoryCoverage } from "../../shared/unknownTrajectoryCoverage";
import {
  extractToolResultRef,
  type ReadToolResultRefResult,
} from "../../shared/toolResultRefs";

export function RunTrajectoryPanel(props: {
  runId: string;
  events: AgentTrajectoryEvent[];
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  const [selectedEventId, setSelectedEventId] = useState(() =>
    readPersistedEvidenceSelection(props.runId),
  );
  const [visibleCount, setVisibleCount] = useState(50);
  const [loadedRef, setLoadedRef] = useState<ReadToolResultRefResult | null>(null);
  const [loadingRef, setLoadingRef] = useState(false);
  const loadRefGeneration = useRef(0);
  const selectedEvent = useMemo(
    () =>
      props.events.find((event) => event.id === selectedEventId) ??
      props.events[0] ??
      null,
    [props.events, selectedEventId],
  );
  const insights = useMemo(
    () => summarizeTrajectoryInsights(props.events),
    [props.events],
  );
  const unknownCoverage = useMemo(
    () => assessUnknownTrajectoryCoverage(props.events),
    [props.events],
  );
  const resultRef = extractToolResultRef(selectedEvent?.payload);

  useEffect(() => {
    loadRefGeneration.current += 1;
    setLoadedRef(null);
    setLoadingRef(false);
  }, [selectedEvent?.id]);

  useEffect(() => {
    setSelectedEventId(readPersistedEvidenceSelection(props.runId));
    setVisibleCount(50);
  }, [props.runId]);

  useEffect(() => {
    if (!selectedEvent?.id) return;
    persistEvidenceSelection(props.runId, selectedEvent.id);
  }, [props.runId, selectedEvent?.id]);

  async function handleLoadRef() {
    if (!resultRef || !window.buildingAgent) {
      return;
    }

    const generation = ++loadRefGeneration.current;
    setLoadingRef(true);
    try {
      const result = await window.buildingAgent.readToolResultRef(resultRef, {
        runId: selectedEvent?.runId,
        trajectoryEventId: selectedEvent?.id,
      });
      if (loadRefGeneration.current === generation) {
        setLoadedRef(result);
      }
    } finally {
      if (loadRefGeneration.current === generation) {
        setLoadingRef(false);
      }
    }
  }

  if (!props.events.length) {
    return (
      <section className="trajectory-panel" aria-label="证据事件">
        <span className="inspector-label">证据事件</span>
        <p>这次任务没有可查看的详细证据，可能来自旧版本或预览数据。</p>
      </section>
    );
  }

  return (
    <section
      aria-label="证据事件"
      className="trajectory-panel"
      data-evidence-run-id={props.runId}
    >
      <div className="section-heading">
        <span>证据事件</span>
        <small>已加载 {props.events.length} 个事件</small>
      </div>
      {unknownCoverage.state === "degraded" ? (
        <p
          className="settings-message is-error"
          data-coverage-state={unknownCoverage.state}
          data-reset-required={String(unknownCoverage.resetRequired)}
          data-testid="unknown-trajectory-coverage"
          role="alert"
        >
          检测到当前版本无法解释的必需证据，覆盖已降级；请重新加载证据视图后再作判断。
        </p>
      ) : null}
      {insights.length ? (
        <>
          <div className="section-heading">
            <span>证据摘要</span>
            <small>{insights.length} 条摘要</small>
          </div>
          <div className="trajectory-insight-list">
            {insights.map((insight) => (
              <button
                className={`trajectory-insight is-${insight.tone}`}
                key={insight.eventId}
                onClick={() => setSelectedEventId(insight.eventId)}
                type="button"
              >
                <strong>{insight.title}</strong>
                <span>{insight.detail}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
      <div className="section-heading">
        <span>原始证据</span>
        <small>{props.events.length} 条记录</small>
      </div>
      <div className="trajectory-event-list">
        {props.events.slice(0, visibleCount).map((event) => (
          <button
            aria-current={
              event.id === selectedEvent?.id ? "true" : undefined
            }
            className={`trajectory-event ${
              event.id === selectedEvent?.id ? "is-selected" : ""
            }`}
            key={event.id}
            onClick={() => {
              loadRefGeneration.current += 1;
              setSelectedEventId(event.id);
            }}
            type="button"
          >
            <strong>{formatEvidenceEventType(event.type)}</strong>
            <small>#{event.sequence}</small>
          </button>
        ))}
      </div>
      {visibleCount < props.events.length || props.hasMore ? (
        <button
          className="secondary-action"
          disabled={props.loadingMore}
          onClick={() => {
            if (visibleCount < props.events.length) {
              setVisibleCount((current) => current + 50);
              return;
            }
            props.onLoadMore?.();
          }}
          type="button"
        >
          {props.loadingMore ? "正在加载..." : "加载更多证据"}
        </button>
      ) : null}
      {selectedEvent ? (
        <>
          <pre className="payload-preview">
            {formatEvidencePreview(selectedEvent)}
          </pre>
          {resultRef ? (
            <div className="tool-result-ref-viewer">
              <div className="section-heading">
                <span>完整工具结果</span>
                <small>{resultRef}</small>
              </div>
              <button
                className="secondary-action"
                disabled={loadingRef}
                onClick={() => void handleLoadRef()}
                type="button"
              >
                {loadingRef ? "正在加载..." : "查看完整结果"}
              </button>
              {loadedRef ? (
                loadedRef.ok ? (
                  <>
                    <dl className="run-metrics">
                      <div>
                        <dt>工具</dt>
                        <dd>{loadedRef.summary.tool}</dd>
                      </div>
                      <div>
                        <dt>状态</dt>
                        <dd>{loadedRef.summary.ok ? "成功" : "失败"}</dd>
                      </div>
                      <div>
                        <dt>字符数</dt>
                        <dd>{loadedRef.summary.originalChars}</dd>
                      </div>
                      <div>
                        <dt>字段</dt>
                        <dd>{loadedRef.summary.resultKeys.join(", ") || "无"}</dd>
                      </div>
                    </dl>
                    <pre className="payload-preview">{loadedRef.content}</pre>
                  </>
                ) : (
                  <p className="settings-message is-error">{loadedRef.message}</p>
                )
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function evidenceSelectionKey(runId: string): string {
  return `zerox.evidence-selection:${runId}`;
}

function readPersistedEvidenceSelection(runId: string): string {
  try {
    return window.localStorage?.getItem(evidenceSelectionKey(runId)) ?? "";
  } catch {
    return "";
  }
}

function persistEvidenceSelection(runId: string, eventId: string): void {
  try {
    window.localStorage?.setItem(evidenceSelectionKey(runId), eventId);
  } catch {
    // Evidence selection persistence is a best-effort renderer preference.
  }
}

function formatEvidencePreview(event: AgentTrajectoryEvent): string {
  const value = JSON.stringify(
    redactCredentials({
      type: event.type,
      payload: event.payload,
      redaction: event.redaction,
      createdAt: event.createdAt,
    }),
    null,
    2,
  );
  return value.length > 16_384
    ? `${value.slice(0, 16_384)}\n[证据预览已截断]`
    : value;
}

function formatEvidenceEventType(type: string): string {
  const labels: Record<string, string> = {
    model_request: "模型请求",
    model_response: "模型响应",
    tool_invocation: "工具调用",
    tool_result: "工具结果",
    memory_write: "记忆写入",
    run_status: "运行状态",
  };
  return labels[type] ?? `其他证据 · ${type || "unknown"}`;
}
