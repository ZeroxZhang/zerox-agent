import type { RenderedOutputPart } from "../../chatOutputModel";

type LedgerEventPart = Extract<RenderedOutputPart, { type: "ledger_event" }>;

type RunLedgerViewProps = {
  part: LedgerEventPart;
};

export function RunLedgerView({ part }: RunLedgerViewProps) {
  return (
    <section className={`chat-run-ledger is-${part.status}`}>
      <span className="chat-run-ledger-status">{part.status}</span>
      <div>
        <strong>{part.title}</strong>
        {part.detail ? <p>{part.detail}</p> : null}
        {part.toolName ? <small>{part.toolName}</small> : null}
      </div>
    </section>
  );
}
