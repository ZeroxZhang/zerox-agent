// StreamProcessor (contracts v1.4 §10.1, P8).
//
// Consumes `LLMProvider.stream()`'s contract `StreamEvent` variants
// (text_delta / tool_call_delta / thinking_delta / done / error) and aggregates
// them into a `CompleteResponse` field-equivalent to the non-streaming path —
// so the existing agentLoop / agentRuntimeEngine tool-parse/dispatch logic works
// unchanged (minimal-change migration per spec §10.1). On `error`, rethrows so
// the existing modelRetry layer handles retry.

import type {
  CompleteResponse,
  LLMProvider,
  CompleteRequest,
  StreamEvent,
  ToolCall,
} from "./provider";

export interface StreamProcessorResult {
  response: CompleteResponse;
  textDeltas: number;
  toolCallDeltas: number;
  thinkingDeltas: number;
}

/**
 * Drive a provider stream to completion, aggregating into a CompleteResponse.
 * Throws on an `error` variant (caller's retry layer handles it).
 */
export async function processStream(
  provider: LLMProvider,
  req: CompleteRequest,
): Promise<StreamProcessorResult> {
  let text = "";
  let thinking = "";
  const toolCallArgs = new Map<string, { id: string; name: string; args: string }>();
  let textDeltas = 0;
  let toolCallDeltas = 0;
  let thinkingDeltas = 0;
  let doneResponse: CompleteResponse | null = null;

  for await (const ev of provider.stream(req)) {
    switch (ev.type) {
      case "text_delta":
        text += ev.text;
        textDeltas += 1;
        break;
      case "thinking_delta":
        thinking += ev.text;
        thinkingDeltas += 1;
        break;
      case "tool_call_delta": {
        toolCallDeltas += 1;
        const existing = toolCallArgs.get(ev.toolCallId) ?? { id: ev.toolCallId, name: ev.name ?? "", args: "" };
        if (ev.name) existing.name = ev.name;
        if (ev.argumentsDelta) existing.args += ev.argumentsDelta;
        toolCallArgs.set(ev.toolCallId, existing);
        break;
      }
      case "done":
        if (ev.response) doneResponse = ev.response;
        break;
      case "error":
        throw ev.error;
    }
  }

  // Prefer the provider's aggregated `done.response` when present; otherwise
  // synthesize from the accumulated deltas.
  if (doneResponse) {
    const response =
      thinking && !doneResponse.reasoningContent
        ? { ...doneResponse, reasoningContent: thinking }
        : doneResponse;
    return { response, textDeltas, toolCallDeltas, thinkingDeltas };
  }
  const toolCalls: ToolCall[] = [...toolCallArgs.values()].map((tc) => ({
    id: tc.id,
    type: "function",
    function: { name: tc.name, arguments: tc.args },
  }));
  const response: CompleteResponse = {
    content: text || null,
    toolCalls,
    finishReason: "stop",
    ...(thinking ? { reasoningContent: thinking } : {}),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  return { response, textDeltas, toolCallDeltas, thinkingDeltas };
}

/** Type guard narrowing for the contract StreamEvent variants (test helper). */
export function isStreamEvent(value: unknown): value is StreamEvent {
  return (
    typeof value === "object" && value !== null && "type" in value &&
    ["text_delta", "thinking_delta", "tool_call_delta", "done", "error"].includes((value as { type: string }).type)
  );
}
