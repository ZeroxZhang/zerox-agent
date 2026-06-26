import type { RenderedOutputPart } from "../../chatOutputModel";

type CodeBlockPart = Extract<
  RenderedOutputPart,
  { type: "code" | "file_diff" }
>;

type CodeBlockViewProps = {
  part: CodeBlockPart;
};

export function CodeBlockView({ part }: CodeBlockViewProps) {
  const isDiff = part.type === "file_diff";
  const title = isDiff
    ? part.filePath ?? "Diff"
    : part.title ?? part.language ?? "Code";
  const language = isDiff ? "diff" : part.language;
  const meta = isDiff
    ? [
        part.additions === undefined ? undefined : `+${part.additions}`,
        part.deletions === undefined ? undefined : `-${part.deletions}`,
      ]
        .filter(Boolean)
        .join(" ")
    : part.language;

  return (
    <figure className={`chat-code-block ${isDiff ? "is-diff" : "is-code"}`}>
      <figcaption className="chat-code-header">
        <span>{title}</span>
        {meta ? <small>{meta}</small> : null}
      </figcaption>
      <pre>
        <code data-language={language ?? "text"}>
          {isDiff ? part.patch : part.code}
        </code>
      </pre>
    </figure>
  );
}
