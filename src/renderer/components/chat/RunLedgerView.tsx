import type { RenderedOutputPart } from "../../chatOutputModel";

type LedgerEventPart = Extract<RenderedOutputPart, { type: "ledger_event" }>;

type RunLedgerViewProps = {
  part: LedgerEventPart;
};

export function RunLedgerView({ part }: RunLedgerViewProps) {
  const hasDetail = Boolean(part.detail);
  const hasTool = Boolean(part.toolName);
  const rowClassName = [
    "chat-ledger-row",
    hasDetail ? "has-detail" : null,
    hasTool ? "has-tool" : null,
    !hasDetail && !hasTool ? "is-title-only" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={`chat-run-ledger is-${part.status}`}>
      <div className={rowClassName}>
        <span className="chat-run-ledger-status">{part.status}</span>
        <strong>{part.title}</strong>
        {part.detail ? <p>{part.detail}</p> : null}
        {part.toolName ? <small>{part.toolName}</small> : null}
      </div>
    </section>
  );
}
