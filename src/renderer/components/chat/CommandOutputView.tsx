import type { RenderedOutputPart } from "../../chatOutputModel";

type CommandOutputPart = Extract<
  RenderedOutputPart,
  { type: "command_output" }
>;

type CommandOutputViewProps = {
  part: CommandOutputPart;
};

export function CommandOutputView({ part }: CommandOutputViewProps) {
  const exitLabel =
    part.exitCode === undefined ? "running" : `exit ${part.exitCode}`;
  const elapsedLabel =
    part.elapsedMs === undefined ? undefined : `${part.elapsedMs} ms`;

  return (
    <section className="chat-command-output" aria-label="Command output">
      <header className="chat-command-header">
        <code>{part.command}</code>
        <span>{exitLabel}</span>
      </header>
      <dl className="chat-command-meta">
        {part.cwd ? (
          <>
            <dt>cwd</dt>
            <dd>{part.cwd}</dd>
          </>
        ) : null}
        {elapsedLabel ? (
          <>
            <dt>elapsed</dt>
            <dd>{elapsedLabel}</dd>
          </>
        ) : null}
      </dl>
      {part.stdout ? (
        <TerminalStream label="stdout" text={part.stdout} />
      ) : null}
      {part.stderr ? (
        <TerminalStream label="stderr" text={part.stderr} tone="error" />
      ) : null}
      {!part.stdout && !part.stderr ? (
        <p className="chat-command-empty">No output</p>
      ) : null}
    </section>
  );
}

function TerminalStream({
  label,
  text,
  tone,
}: {
  label: string;
  text: string;
  tone?: "error";
}) {
  return (
    <div
      className={`chat-command-stream${tone === "error" ? " is-error" : ""}`}
    >
      <span>{label}</span>
      <pre>{text}</pre>
    </div>
  );
}
