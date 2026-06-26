import type { RenderedOutputPart } from "../../chatOutputModel";
import { JsonPreview } from "./JsonPreview";

type EvidencePart = Extract<
  RenderedOutputPart,
  | { type: "artifact" }
  | { type: "approval_request" }
  | { type: "citation" }
  | { type: "diagnostic" }
  | { type: "file_ref" }
>;

type EvidenceRailProps = {
  parts: RenderedOutputPart[];
};

export function EvidenceRail({ parts }: EvidenceRailProps) {
  const evidenceParts = parts.filter(isEvidencePart);
  if (evidenceParts.length === 0) {
    return null;
  }

  return (
    <aside className="chat-evidence-rail" aria-label="Evidence">
      {evidenceParts.map((part) => (
        <EvidenceItem key={part.renderKey} part={part} />
      ))}
    </aside>
  );
}

export function isEvidencePart(part: RenderedOutputPart): part is EvidencePart {
  return (
    part.type === "artifact" ||
    part.type === "approval_request" ||
    part.type === "citation" ||
    part.type === "diagnostic" ||
    part.type === "file_ref"
  );
}

function EvidenceItem({ part }: { part: EvidencePart }) {
  if (part.type === "citation") {
    const label = part.label || part.citationId;
    return (
      <div className="chat-evidence-item chat-citation-chip is-citation">
        <span>Citation</span>
        {part.uri ? (
          <a href={part.uri} rel="noreferrer" target="_blank">
            {label}
          </a>
        ) : (
          <strong>{label}</strong>
        )}
        <small>{part.sourceTitle}</small>
      </div>
    );
  }

  if (part.type === "artifact") {
    return (
      <div className="chat-evidence-item chat-artifact-card is-artifact">
        <span>Artifact</span>
        <strong>{part.title}</strong>
        {part.path ? <small>{part.path}</small> : null}
        {part.mediaType ? <small>{part.mediaType}</small> : null}
      </div>
    );
  }

  if (part.type === "file_ref") {
    return (
      <div className="chat-evidence-item is-file-ref">
        <span>{part.action}</span>
        <strong>{part.label ?? part.path}</strong>
        {part.label ? <small>{part.path}</small> : null}
      </div>
    );
  }

  if (part.type === "approval_request") {
    return (
      <div
        className={`chat-evidence-item chat-approval-block is-approval is-${part.riskLevel}`}
      >
        <span>Approval</span>
        <strong>{part.toolName}</strong>
        <small>{part.riskLevel} risk</small>
        <JsonPreview value={part.argsPreview} />
      </div>
    );
  }

  return (
    <div className={`chat-evidence-item is-diagnostic is-${part.severity}`}>
      <span>{part.severity}</span>
      <strong>{part.title}</strong>
      <small>{part.message}</small>
    </div>
  );
}
