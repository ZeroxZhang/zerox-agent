import { memo, useMemo } from "react";
import type { RenderedOutputPart } from "../../chatOutputModel";
import { isMainConversationOutputPart } from "../../chatOutputModel";
import { OutputPartRenderer } from "./OutputPartRenderer";

type AnswerBlockProps = {
  parts: RenderedOutputPart[];
};

export const AnswerBlock = memo(function AnswerBlock({ parts }: AnswerBlockProps) {
  const mainParts = useMemo(
    () => parts.filter(isMainConversationOutputPart),
    [parts],
  );
  if (mainParts.length === 0) {
    return null;
  }

  return (
    <div className="chat-answer-block is-body-only">
      <div className="chat-answer-body">
        <div className="chat-output-part-list">
          {mainParts.map((part) => (
            <OutputPartRenderer key={part.renderKey} part={part} />
          ))}
        </div>
      </div>
    </div>
  );
});
