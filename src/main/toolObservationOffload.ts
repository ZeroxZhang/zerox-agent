import {
  serializeToolObservation,
  type ToolObservation,
} from "../shared/agentProtocol";
import type {
  ToolResultOffloadRef,
  ToolResultOffloadStore,
} from "./toolResultOffloadStore";

const DEFAULT_TOOL_RESULT_OFFLOAD_THRESHOLD_CHARS = 12_000;

export type SerializedToolObservation = {
  content: string;
  offloaded: boolean;
  originalChars: number;
  resultRef?: string;
  absolutePath?: string;
  offloadError?: string;
};

export async function serializeToolObservationWithOffload(
  observation: ToolObservation,
  options: {
    store?: ToolResultOffloadStore;
    thresholdChars?: number;
    runId?: string;
  } = {},
): Promise<SerializedToolObservation> {
  const content = serializeToolObservation(observation);
  const originalChars = content.length;
  const thresholdChars =
    options.thresholdChars ?? DEFAULT_TOOL_RESULT_OFFLOAD_THRESHOLD_CHARS;

  if (
    !options.store ||
    !observation.ok ||
    !observation.result ||
    originalChars <= thresholdChars
  ) {
    return {
      content,
      offloaded: false,
      originalChars,
    };
  }

  try {
    const ref = await options.store.write({
      runId: options.runId,
      toolCallId: observation.toolCallId,
      toolName: observation.tool,
      content,
    });

    return {
      content: serializeCompactObservation(observation, originalChars, ref),
      offloaded: true,
      originalChars,
      resultRef: ref.relativePath,
      absolutePath: ref.absolutePath,
    };
  } catch (error) {
    return {
      content,
      offloaded: false,
      originalChars,
      offloadError:
        error instanceof Error ? error.message : "Unknown offload error.",
    };
  }
}

function serializeCompactObservation(
  observation: ToolObservation,
  originalChars: number,
  ref: ToolResultOffloadRef,
): string {
  return JSON.stringify({
    type: "tool_result",
    tool: observation.tool,
    ok: true,
    summary: summarizeResult(observation, originalChars),
    result_preview: buildResultPreview(observation.result),
    offloaded: true,
    result_ref: ref.relativePath,
    original_chars: originalChars,
    ...(observation.toolCallId ? { tool_call_id: observation.toolCallId } : {}),
  });
}

function summarizeResult(
  observation: ToolObservation,
  originalChars: number,
): string {
  const keys = observation.result
    ? Object.keys(observation.result).slice(0, 8)
    : [];
  const keySummary = keys.length ? keys.join(", ") : "none";
  return `Full ${observation.tool} result was offloaded (${originalChars} chars). Top-level result keys: ${keySummary}.`;
}

function buildResultPreview(
  result: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!result) return {};

  const priorityKeys = ["answerPreview", "summary", "markdown"];
  const orderedEntries = [
    ...priorityKeys
      .filter((key) => Object.prototype.hasOwnProperty.call(result, key))
      .map((key) => [key, result[key]] as const),
    ...Object.entries(result).filter(([key]) => !priorityKeys.includes(key)),
  ];

  return Object.fromEntries(
    orderedEntries
      .slice(0, 5)
      .map(([key, value]) => [key, previewValue(value)]),
  );
}

function previewValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length <= 240) return value;
    return `${value.slice(0, 240)}... [truncated ${value.length - 240} chars]`;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      preview: value.slice(0, 5).map(previewValue),
    };
  }

  if (value && typeof value === "object") {
    return {
      type: "object",
      keys: Object.keys(value as Record<string, unknown>).slice(0, 8),
    };
  }

  return String(value);
}
