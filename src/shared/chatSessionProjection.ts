import type { ChatMessageRecord, ChatSessionRecord } from "./chat";
import type { ChatOutputPart } from "./chatOutput";

/**
 * Parts the renderer needs to rebuild the transcript, including the LD03/LD04
 * process facts. The whitelist no longer exists to hide process state; it
 * exists to keep the read path bounded (see {@link boundTranscriptPart}).
 */
const transcriptOutputPartTypes = new Set<ChatOutputPart["type"]>([
  "approval_request",
  "artifact",
  "citation",
  "code",
  "command_output",
  "diagnostic",
  "file_diff",
  "file_ref",
  "input_request",
  "ledger_event",
  "model_call",
  "plan_step",
  "reasoning",
  "table",
  "text",
  "tool_call",
  "tool_result",
]);

/**
 * A reloaded session must not ship an unbounded blob to the renderer. Oversized
 * previews are replaced by a marker while the process fact itself survives, so
 * the inline stream still shows what happened.
 */
export const TRANSCRIPT_PART_PREVIEW_MAX_CHARS = 2_048;
const OMITTED_PREVIEW_MARKER = "[已省略：内容过大，请查看证据]";

export function projectChatSessionForTranscript(
  session: ChatSessionRecord,
): ChatSessionRecord {
  return {
    ...session,
    messages: session.messages.map(projectChatMessageForTranscript),
  };
}

export function projectChatMessageForTranscript(
  message: ChatMessageRecord,
): ChatMessageRecord {
  if (!message.outputParts?.length) {
    return message;
  }

  const sourceParts = message.outputParts;
  const projectedParts = sourceParts.map((part) =>
    isTranscriptOutputPart(part) ? boundTranscriptPart(part) : null,
  );
  // Identity comparison: bounding may rewrite a part without changing the
  // count, so a length check alone would return the unbounded original.
  if (projectedParts.every((part, index) => part === sourceParts[index])) {
    return message;
  }
  const outputParts = projectedParts.filter(
    (part): part is ChatOutputPart => part !== null,
  );

  const { outputParts: _outputParts, ...messageWithoutOutputParts } = message;
  return outputParts.length
    ? { ...messageWithoutOutputParts, outputParts }
    : messageWithoutOutputParts;
}

export function isTranscriptOutputPart(part: ChatOutputPart): boolean {
  return transcriptOutputPartTypes.has(part.type);
}

function boundTranscriptPart(part: ChatOutputPart): ChatOutputPart {
  if (
    part.type === "tool_call"
    && part.argsPreview !== undefined
    && previewLength(part.argsPreview) > TRANSCRIPT_PART_PREVIEW_MAX_CHARS
  ) {
    return { ...part, argsPreview: OMITTED_PREVIEW_MARKER };
  }
  if (
    part.type === "tool_result"
    && part.resultPreview !== undefined
    && previewLength(part.resultPreview) > TRANSCRIPT_PART_PREVIEW_MAX_CHARS
  ) {
    return { ...part, resultPreview: OMITTED_PREVIEW_MARKER };
  }
  if (part.type === "command_output") {
    const stdout = boundText(part.stdout);
    const stderr = boundText(part.stderr);
    if (stdout !== part.stdout || stderr !== part.stderr) {
      return { ...part, stdout, stderr };
    }
  }
  if (part.type === "reasoning" && part.text.length > TRANSCRIPT_PART_PREVIEW_MAX_CHARS) {
    return {
      ...part,
      text: part.text.slice(0, TRANSCRIPT_PART_PREVIEW_MAX_CHARS),
      truncated: true,
    };
  }
  return part;
}

function previewLength(value: unknown): number {
  try {
    return JSON.stringify(value ?? null)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function boundText(value: string): string {
  return value.length > TRANSCRIPT_PART_PREVIEW_MAX_CHARS
    ? `${value.slice(0, TRANSCRIPT_PART_PREVIEW_MAX_CHARS)}\n${OMITTED_PREVIEW_MARKER}`
    : value;
}
