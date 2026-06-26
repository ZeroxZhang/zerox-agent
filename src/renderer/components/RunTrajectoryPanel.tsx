import { useEffect, useMemo, useState } from "react";
import type { AgentTrajectoryEvent } from "../../shared/agentTrajectory";
import { summarizeTrajectoryInsights } from "../../shared/agentTrajectoryInsights";
import {
  extractToolResultRef,
  type ReadToolResultRefResult,
} from "../../shared/toolResultRefs";

export function RunTrajectoryPanel(props: {
  events: AgentTrajectoryEvent[];
}) {
  const [selectedEventId, setSelectedEventId] = useState("");
  const [loadedRef, setLoadedRef] = useState<ReadToolResultRefResult | null>(null);
  const [loadingRef, setLoadingRef] = useState(false);
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
  const resultRef = extractToolResultRef(selectedEvent?.payload);

  useEffect(() => {
    setLoadedRef(null);
    setLoadingRef(false);
  }, [selectedEvent?.id]);

  async function handleLoadRef() {
    if (!resultRef || !window.buildingAgent) {
      return;
    }

    setLoadingRef(true);
    try {
      setLoadedRef(
        await window.buildingAgent.readToolResultRef(resultRef, {
          runId: selectedEvent?.runId,
          sessionId: selectedEvent?.runContext?.sessionId,
          workspaceRunId: selectedEvent?.runContext?.runId,
        }),
      );
    } finally {
      setLoadingRef(false);
    }
  }

  if (!props.events.length) {
    return (
      <section className="trajectory-panel" aria-label="运行轨迹">
        <span className="inspector-label">轨迹</span>
        <p>这条运行还没有可查看的轨迹事件。</p>
      </section>
    );
  }

  return (
    <section className="trajectory-panel" aria-label="运行轨迹">
      <div className="section-heading">
        <span>轨迹</span>
        <small>{props.events.length} 个事件</small>
      </div>
      {insights.length ? (
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
      ) : null}
      <div className="trajectory-event-list">
        {props.events.map((event) => (
          <button
            className={`trajectory-event ${
              event.id === selectedEvent?.id ? "is-selected" : ""
            }`}
            key={event.id}
            onClick={() => setSelectedEventId(event.id)}
            type="button"
          >
            <strong>{event.type}</strong>
            <small>#{event.sequence}</small>
          </button>
        ))}
      </div>
      {selectedEvent ? (
        <>
          <pre className="payload-preview">
            {JSON.stringify(
              {
                type: selectedEvent.type,
                payload: selectedEvent.payload,
                redaction: selectedEvent.redaction,
                createdAt: selectedEvent.createdAt,
              },
              null,
              2,
            )}
          </pre>
          {resultRef ? (
            <div className="tool-result-ref-viewer">
              <div className="section-heading">
                <span>工具结果引用</span>
                <small>{resultRef}</small>
              </div>
              <button
                className="secondary-action"
                disabled={loadingRef}
                onClick={() => void handleLoadRef()}
                type="button"
              >
                {loadingRef ? "正在加载..." : "加载完整结果"}
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
                        <dd>{String(loadedRef.summary.ok)}</dd>
                      </div>
                      <div>
                        <dt>字符</dt>
                        <dd>{loadedRef.summary.originalChars}</dd>
                      </div>
                      <div>
                        <dt>字段</dt>
                        <dd>{loadedRef.summary.resultKeys.join(", ") || "none"}</dd>
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
