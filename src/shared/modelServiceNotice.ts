export type ModelServiceNoticeKind =
  | "output_limit"
  | "rate_limit"
  | "quota_exhausted"
  | "provider_stop";

export type ModelServiceNotice = {
  kind: ModelServiceNoticeKind;
  provider?: string;
  model?: string;
  code?: string;
  statusCode?: number;
  retryAfterMs?: number;
  rawReason?: string;
  message: string;
};

type NoticeContext = {
  provider?: string;
  model?: string;
};

export class ModelServiceNoticeError extends Error {
  readonly code: ModelServiceNoticeKind;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;

  constructor(readonly notice: ModelServiceNotice) {
    super(notice.message);
    this.name = "ModelServiceNoticeError";
    this.code = notice.kind;
    this.statusCode = notice.statusCode;
    this.retryAfterMs = notice.retryAfterMs;
  }
}

export function throwForModelServiceNotice(
  notice: ModelServiceNotice | undefined,
): void {
  if (notice) throw new ModelServiceNoticeError(notice);
}

const NORMAL_COMPLETION_REASONS = new Set([
  "",
  "stop",
  "end_turn",
  "stop_sequence",
  "tool_calls",
  "tool_use",
  "function_call",
  "complete",
  "completed",
]);

export function modelServiceNoticeFromFinishReason(
  finishReason: string | null | undefined,
  context: NoticeContext = {},
): ModelServiceNotice | undefined {
  const rawReason = sanitizeIdentifier(finishReason);
  const normalized = rawReason.toLowerCase();
  if (NORMAL_COMPLETION_REASONS.has(normalized)) return undefined;

  if (
    normalized === "length" ||
    normalized === "max_tokens" ||
    normalized === "max_output_tokens" ||
    normalized === "model_length" ||
    normalized === "max_completion_tokens"
  ) {
    return buildNotice("output_limit", context, {
      rawReason,
      message: "模型或服务商已达到本次输出长度限制，当前内容可能不完整。",
    });
  }

  return buildNotice("provider_stop", context, {
    rawReason,
    message: `模型或服务商停止了本次生成（${rawReason || "原因未知"}）。`,
  });
}

export function withModelServiceNotice<
  T extends { finishReason: string; modelServiceNotice?: ModelServiceNotice },
>(
  response: T,
  context: NoticeContext = {},
): T {
  const notice =
    response.modelServiceNotice ??
    modelServiceNoticeFromFinishReason(response.finishReason, context);
  return notice ? { ...response, modelServiceNotice: notice } : response;
}

export function modelServiceNoticeFromError(
  error: unknown,
  context: NoticeContext = {},
): ModelServiceNotice | undefined {
  if (error instanceof ModelServiceNoticeError) return error.notice;
  const record = asRecord(error);
  const metadata = asRecord(record?.$metadata);
  const response = asRecord(record?.response);
  const nestedError = asRecord(record?.error);
  const message = error instanceof Error ? error.message : String(error ?? "");
  const statusCode =
    readFiniteNumber(record?.statusCode) ??
    readFiniteNumber(record?.status) ??
    readFiniteNumber(metadata?.httpStatusCode) ??
    readFiniteNumber(response?.statusCode) ??
    readFiniteNumber(response?.status) ??
    parseStatusCode(message);
  const code = sanitizeErrorCode(
    record?.code ??
      record?.type ??
      nestedError?.code ??
      nestedError?.type ??
      record?.name,
  );
  const retryAfterMs =
    readFiniteNumber(record?.retryAfterMs) ??
    readRetryAfterMs(record?.headers) ??
    readRetryAfterMs(record?.responseHeaders) ??
    readRetryAfterMs(metadata?.httpHeaders) ??
    readRetryAfterMs(response?.headers);
  const classifierText = `${code} ${message}`.toLowerCase();

  if (
    statusCode === 402 ||
    /insufficient[_\s-]*quota|quota[_\s-]*(?:exhausted|exceeded)|billing[_\s-]*hard[_\s-]*limit|credits?[_\s-]*(?:exhausted|depleted)/i.test(
      classifierText,
    )
  ) {
    return buildNotice("quota_exhausted", context, {
      ...(code ? { code } : {}),
      ...(statusCode !== undefined ? { statusCode } : {}),
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      message: "模型服务商返回额度或余额不足，请检查服务商账户后重试。",
    });
  }

  if (
    statusCode === 429 ||
    /rate[_\s-]*limit|resource[_\s-]*exhausted|too many requests/i.test(
      classifierText,
    )
  ) {
    return buildNotice("rate_limit", context, {
      ...(code ? { code } : {}),
      ...(statusCode !== undefined ? { statusCode } : {}),
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      message: "模型服务商正在限流，请稍后由你手动重试。",
    });
  }

  return undefined;
}

function buildNotice(
  kind: ModelServiceNoticeKind,
  context: NoticeContext,
  fields: Omit<ModelServiceNotice, "kind" | "provider" | "model">,
): ModelServiceNotice {
  return {
    kind,
    ...(context.provider ? { provider: context.provider } : {}),
    ...(context.model ? { model: context.model } : {}),
    ...fields,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseStatusCode(message: string): number | undefined {
  const match = message.match(/\bstatus(?:\s+code)?\s*[:=]?\s*(\d{3})\b/i);
  return match ? Number(match[1]) : undefined;
}

function readRetryAfterMs(value: unknown): number | undefined {
  const headers = asRecord(value);
  if (!headers) return undefined;
  const direct =
    headers["retry-after-ms"] ??
    headers["Retry-After-Ms"] ??
    headers["retryAfterMs"];
  const directNumber = readFiniteNumber(direct);
  if (directNumber !== undefined) return Math.max(0, directNumber);
  const retryAfter = headers["retry-after"] ?? headers["Retry-After"];
  const seconds = readFiniteNumber(retryAfter);
  if (seconds !== undefined) return Math.max(0, seconds * 1000);
  if (typeof retryAfter !== "string") return undefined;
  const date = Date.parse(retryAfter);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function sanitizeIdentifier(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/[^\w.\-:/]/g, "_")
    .slice(0, 96);
}

function sanitizeErrorCode(value: unknown): string {
  const code = sanitizeIdentifier(value);
  return code === "Error" ||
    code === "ProviderHttpError" ||
    code === "ModelServiceNoticeError"
    ? ""
    : code;
}
