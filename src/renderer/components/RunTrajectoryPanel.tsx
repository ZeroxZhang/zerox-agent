import { useMemo, useState } from "react";
import type { AgentTrajectoryEvent } from "../../shared/agentTrajectory";

export function RunTrajectoryPanel(props: {
  events: AgentTrajectoryEvent[];
}) {
  const [selectedEventId, setSelectedEventId] = useState("");
  const selectedEvent = useMemo(
    () =>
      props.events.find((event) => event.id === selectedEventId) ??
      props.events[0] ??
      null,
    [props.events, selectedEventId],
  );

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
      ) : null}
    </section>
  );
}
