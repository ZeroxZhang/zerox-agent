import type { RenderedOutputPart } from "../../chatOutputModel";
import { EvidenceRail, isEvidencePart } from "./EvidenceRail";
import { OutputPartRenderer } from "./OutputPartRenderer";

type AnswerBlockProps = {
  parts: RenderedOutputPart[];
};

export function AnswerBlock({ parts }: AnswerBlockProps) {
  const bodyParts = parts.filter((part) => !isEvidencePart(part));
  const renderParts = bodyParts.length > 0 ? bodyParts : parts;

  return (
    <div className="chat-answer-block">
      <div className="chat-output-part-list">
        {renderParts.map((part) => (
          <OutputPartRenderer key={part.renderKey} part={part} />
        ))}
      </div>
      <EvidenceRail parts={parts} />
    </div>
  );
}
