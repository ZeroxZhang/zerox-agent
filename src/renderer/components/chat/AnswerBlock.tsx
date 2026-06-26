import type { RenderedOutputPart } from "../../chatOutputModel";
import { isMainConversationOutputPart } from "../../chatOutputModel";
import { EvidenceRail, isEvidencePart } from "./EvidenceRail";
import { OutputPartRenderer } from "./OutputPartRenderer";

type AnswerBlockProps = {
  parts: RenderedOutputPart[];
};

export function AnswerBlock({ parts }: AnswerBlockProps) {
  const mainParts = parts.filter(isMainConversationOutputPart);
  if (mainParts.length === 0) {
    return null;
  }

  const evidenceParts = mainParts.filter(isEvidencePart);
  const bodyParts = mainParts.filter((part) => !isEvidencePart(part));
  const renderParts = bodyParts.length > 0 ? bodyParts : mainParts;
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
