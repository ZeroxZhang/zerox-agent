import type { ToolSafetySummary } from "../../shared/toolSafetySummary";

export function ToolSafetySummaryCard(props: {
  summary: ToolSafetySummary;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <section
      className={`tool-safety-card is-${props.summary.tone}`}
      aria-label="运行前安全确认"
    >
      <div className="tool-safety-header">
        <div>
          <span>运行前安全确认</span>
          <h4>{props.summary.title}</h4>
          <p>{props.summary.message}</p>
        </div>
        {props.actionLabel && props.onAction ? (
          <button className="secondary-action" type="button" onClick={props.onAction}>
            {props.actionLabel}
          </button>
        ) : null}
      </div>
      <div className="tool-safety-grid">
        {props.summary.sections.map((section) => (
          <article key={section.id}>
            <strong>{section.label}</strong>
            <span>{section.value}</span>
          </article>
        ))}
      </div>
      <p className="tool-safety-audit">{props.summary.auditMessage}</p>
    </section>
  );
}
