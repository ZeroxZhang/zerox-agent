export type ToolResultContentSummary = {
  ok: boolean | null;
  tool: string;
  resultKeys: string[];
  originalChars: number;
  preview: string;
};

export type ReadToolResultRefResult =
  | {
      ok: true;
      ref: string;
      content: string;
      summary: ToolResultContentSummary;
    }
  | { ok: false; message: string };

export function extractToolResultRef(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const candidate = payload.resultRef ?? payload.result_ref;
  if (typeof candidate !== "string") {
    return null;
  }

  return isSafeToolResultRef(candidate) ? candidate : null;
}

export function isSafeToolResultRef(ref: string): boolean {
  return /^tool-result-refs\/[a-zA-Z0-9._-]+\.json$/.test(ref);
}

export function summarizeToolResultContent(
  content: string,
): ToolResultContentSummary {
  try {
    const parsed = JSON.parse(content) as {
      tool?: unknown;
      ok?: unknown;
      result?: unknown;
    };
    const preview = truncate(JSON.stringify(parsed.result ?? parsed, null, 2), 600);

    return {
      ok: typeof parsed.ok === "boolean" ? parsed.ok : null,
      tool: typeof parsed.tool === "string" ? parsed.tool : "unknown",
      resultKeys:
        parsed.result && typeof parsed.result === "object"
          ? Object.keys(parsed.result as Record<string, unknown>)
          : [],
      originalChars: content.length,
      preview,
    };
  } catch {
    return {
      ok: null,
      tool: "unknown",
      resultKeys: [],
      originalChars: content.length,
      preview: truncate(content, 600),
    };
  }
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars
    ? value
    : `${value.slice(0, maxChars - 20)}... [truncated]`;
}
