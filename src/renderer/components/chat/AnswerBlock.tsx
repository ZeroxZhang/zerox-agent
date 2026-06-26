import type { RenderedOutputPart } from "../../chatOutputModel";
import { EvidenceRail, isEvidencePart } from "./EvidenceRail";
import { OutputPartRenderer } from "./OutputPartRenderer";

type AnswerBlockProps = {
  parts: RenderedOutputPart[];
};

export function AnswerBlock({ parts }: AnswerBlockProps) {
  const evidenceParts = parts.filter(isEvidencePart);
  const bodyParts = parts.filter((part) => !isEvidencePart(part));
  const renderParts = bodyParts.length > 0 ? bodyParts : parts;
  const hasEvidence = evidenceParts.length > 0;
  const showEvidenceRail = hasEvidence && bodyParts.length > 0;
  const blockClassName = `chat-answer-block ${
    showEvidenceRail ? "has-evidence" : "is-body-only"
  }`;

  return (
    <div className={blockClassName}>
      <div className="chat-answer-body">
        <div className="chat-output-part-list">
          {renderParts.map((part) => (
            <OutputPartRenderer key={part.renderKey} part={part} />
          ))}
        </div>
      </div>
      {showEvidenceRail ? <EvidenceRail parts={evidenceParts} /> : null}
    </div>
  );
}
