import { memo, useMemo, useState, type ReactNode } from "react";
import {
  parseInlineMarkdown,
  parseMarkdownBlocks,
  type MarkdownBlock,
} from "../../chatMarkdown";
import {
  createMarkdownPreview,
  shouldRenderMarkdownPreview,
} from "../../chatMarkdownPreview";
import type { RenderedOutputPart } from "../../chatOutputModel";
import { CodeBlockView } from "./CodeBlockView";
import { CommandOutputView } from "./CommandOutputView";
import { DataTableView } from "./DataTableView";
import { JsonPreview } from "./JsonPreview";
import { RunLedgerView } from "./RunLedgerView";

type OutputPartRendererProps = {
  part: RenderedOutputPart;
};

export const OutputPartRenderer = memo(function OutputPartRenderer({
  part,
}: OutputPartRendererProps) {
  switch (part.type) {
    case "text":
      return (
        <section className="chat-output-part is-text">
          <TextPartView part={part} />
        </section>
      );
    case "table":
      return (
        <section className="chat-output-part is-table">
          <DataTableView part={part} />
        </section>
      );
    case "code":
      return (
        <section className="chat-output-part is-code">
          <CodeBlockView part={part} />
        </section>
      );
    case "file_diff":
      return (
        <section className="chat-output-part is-file-diff">
          <CodeBlockView part={part} />
        </section>
      );
    case "command_output":
      return (
        <section className="chat-output-part is-command-output">
          <CommandOutputView part={part} />
        </section>
      );
    case "tool_call":
      return (
        <section className="chat-output-part chat-tool-card is-tool-call">
          <header>
            <span>Tool call</span>
            <strong>{part.toolName}</strong>
            {part.toolSource ? <small>{part.toolSource}</small> : null}
          </header>
          <JsonPreview label="Arguments" value={part.argsPreview} />
        </section>
      );
    case "tool_result":
      return (
        <section
          className={`chat-output-part chat-tool-card is-tool-result ${
            part.ok ? "is-ok" : "is-error"
          }`}
        >
          <header>
            <span>Tool result</span>
            <strong>{part.ok ? "Success" : "Error"}</strong>
          </header>
          {part.error ? <p>{part.error}</p> : null}
          <JsonPreview label="Result" value={part.resultPreview} />
        </section>
      );
    case "file_ref":
      return (
        <section className="chat-output-part chat-evidence-inline is-file-ref">
          <span>{part.action}</span>
          <strong>{part.label ?? part.path}</strong>
          {part.label ? <small>{part.path}</small> : null}
        </section>
      );
    case "artifact":
      return (
        <section className="chat-output-part chat-evidence-inline chat-artifact-card is-artifact">
          <span>Artifact</span>
          <strong>{part.title}</strong>
          {part.path ? <small>{part.path}</small> : null}
        </section>
      );
    case "citation":
      return (
        <section className="chat-output-part chat-evidence-inline chat-citation-chip is-citation">
          <span>{part.label}</span>
          {part.uri ? (
            <a href={part.uri} rel="noreferrer" target="_blank">
              {part.sourceTitle}
            </a>
          ) : (
            <strong>{part.sourceTitle}</strong>
          )}
        </section>
      );
    case "approval_request":
      return (
        <section className="chat-output-part chat-evidence-inline chat-approval-block is-approval">
          <span>Approval requested</span>
          <strong>{part.toolName}</strong>
          <small>{part.riskLevel} risk</small>
          <JsonPreview label="Arguments" value={part.argsPreview} />
        </section>
      );
    case "input_request":
      return (
        <section className="chat-output-part chat-input-request-block">
          <header>
            <span>Input requested</span>
            <strong>{part.skillName}</strong>
          </header>
          <p>{part.reason}</p>
          <ul>
            {part.fields.map((field) => (
              <li key={field.name}>
                <strong>{field.label}</strong>
                <span>{field.type}</span>
                {field.required ? <small>required</small> : null}
              </li>
            ))}
          </ul>
        </section>
      );
    case "diagnostic":
      return (
        <section
          className={`chat-output-part chat-evidence-inline is-diagnostic is-${part.severity}`}
        >
          <span>{part.severity}</span>
          <strong>{part.title}</strong>
          <p>{part.message}</p>
        </section>
      );
    case "ledger_event":
      return (
        <section className="chat-output-part is-ledger-event">
          <RunLedgerView part={part} />
        </section>
      );
    default: {
      const exhaustivePart: never = part;
      return exhaustivePart;
    }
  }
});

const TextPartView = memo(function TextPartView({
  part,
}: {
  part: Extract<RenderedOutputPart, { type: "text" }>;
}) {
  if (part.format === "plain") {
    return <p className="chat-output-text">{part.text}</p>;
  }

  return <MarkdownTextView text={part.text} />;
});

const MarkdownTextView = memo(function MarkdownTextView({
  text,
}: {
  text: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shouldPreview = shouldRenderMarkdownPreview(text);
  const previewText = useMemo(() => createMarkdownPreview(text), [text]);
  const blocks = useMemo(
    () => (shouldPreview && !expanded ? [] : parseMarkdownBlocks(text)),
    [expanded, shouldPreview, text],
  );

  return (
    <div className="chat-output-text markdown-message">
      {shouldPreview && !expanded ? (
        <p className="markdown-plain-preview">{previewText}</p>
      ) : (
        blocks.map((block, index) => (
          <MarkdownBlockView block={block} key={`${block.type}-${index}`} />
        ))
      )}
      {shouldPreview ? (
        <button
          type="button"
          aria-expanded={expanded}
          className="chat-message-collapse-button markdown-preview-toggle"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "收起完整内容" : "展开完整内容"}
        </button>
      ) : null}
    </div>
  );
});

function MarkdownBlockView({ block }: { block: MarkdownBlock }) {
  if (block.type === "heading") {
    const HeadingTag = `h${Math.min(block.depth + 2, 5)}` as
      | "h3"
      | "h4"
      | "h5";
    return (
      <HeadingTag>
        <InlineMarkdown text={block.text} />
      </HeadingTag>
    );
  }

  if (block.type === "unorderedList") {
    return (
      <ul>
        {block.items.map((item, index) => (
          <li key={`${item}-${index}`}>
            <InlineMarkdown text={item} />
          </li>
        ))}
      </ul>
    );
  }

  if (block.type === "orderedList") {
    return (
      <ol>
        {block.items.map((item, index) => (
          <li key={`${item}-${index}`}>
            <InlineMarkdown text={item} />
          </li>
        ))}
      </ol>
    );
  }

  if (block.type === "taskList") {
    return (
      <ul>
        {block.items.map((item, index) => (
          <li key={`${item.checked}-${item.text}-${index}`}>
            <input checked={item.checked} readOnly type="checkbox" />{" "}
            <InlineMarkdown text={item.text} />
          </li>
        ))}
      </ul>
    );
  }

  if (block.type === "code") {
    return (
      <figure className="markdown-code-block">
        <figcaption className="markdown-code-header">
          <span>{block.language ?? "text"}</span>
        </figcaption>
        <pre>
          <code>{block.code}</code>
        </pre>
      </figure>
    );
  }

  if (block.type === "table") {
    return (
      <DataTableView
        part={{
          id: "markdown-table",
          renderKey: "markdown-table",
          source: "persisted",
          type: "table",
          columns: block.columns,
          rows: block.rows,
          ...(block.caption ? { caption: block.caption } : {}),
        }}
      />
    );
  }

  if (block.type === "blockquote") {
    return (
      <blockquote>
        <InlineMarkdown text={block.text} />
      </blockquote>
    );
  }

  return (
    <p>
      <InlineMarkdown text={block.text} />
    </p>
  );
}

function InlineMarkdown({ text }: { text: string }): ReactNode {
  return parseInlineMarkdown(text).map((segment, index) => {
    if (segment.type === "strong") {
      return <strong key={`${segment.type}-${index}`}>{segment.text}</strong>;
    }
    if (segment.type === "code") {
      return <code key={`${segment.type}-${index}`}>{segment.text}</code>;
    }
    if (segment.type === "link") {
      return (
        <a
          href={segment.href}
          key={`${segment.type}-${index}`}
          rel="noreferrer"
          target="_blank"
        >
          {segment.text}
        </a>
      );
    }
    return <span key={`${segment.type}-${index}`}>{segment.text}</span>;
  });
}
