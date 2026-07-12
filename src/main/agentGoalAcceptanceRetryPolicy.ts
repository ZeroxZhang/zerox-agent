import type { AcceptanceResult } from "./agentGoalAcceptance";

export const FINAL_ACCEPTANCE_MAX_ATTEMPTS = 3;
export const FINAL_ACCEPTANCE_RETRY_DELAYS_MS = [1000, 2000] as const;
export const FINAL_ACCEPTANCE_MAX_RETRY_AFTER_MS = 30_000;

export type AcceptanceInfrastructureFailure = {
  code:
    | "judge_timeout"
    | "rate_limited"
    | "provider_unavailable"
    | "network_reset"
    | "transport_failed"
    | "judge_invalid_response"
    | "validator_missing"
    | "validator_failed";
  retryable: boolean;
  detail: string;
  retryAfterMs?: number;
};

export type AcceptanceRetryDecision =
  | { action: "retry"; code: string; delayMs: number; nextRetryAt: string }
  | { action: "wait_for_user"; code: string }
  | { action: "not_applicable" };

type ProviderError = {
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  responseHeaders?: unknown;
  headers?: unknown;
  message?: unknown;
};

export function classifyAcceptanceInfrastructureFailure(
  error: unknown,
): AcceptanceInfrastructureFailure {
  const providerError = asProviderError(error);
  const status = readStatus(providerError);
  const providerCode = readProviderCode(providerError);
  const message = readMessage(providerError);
  const retryAfterMs = readRetryAfterMs(providerError);

  if (providerCode === "judge_invalid_response") {
    return failure("judge_invalid_response", true, "Final judge returned an invalid response.");
  }
  if (providerCode === "validator_missing") {
    return failure("validator_missing", false, "Acceptance validator is unavailable.");
  }
  if (providerCode === "validator_failed") {
    return failure("validator_failed", false, "Acceptance validator failed.");
  }
  if (status === 429) {
    return failure("rate_limited", true, "Final judge provider rate limited the request.", retryAfterMs);
  }
  if (status !== undefined && status >= 500 && status <= 599) {
    return failure("provider_unavailable", true, "Final judge provider is unavailable.", retryAfterMs);
  }
  if (providerCode === "ETIMEDOUT" || /\b(?:timed?\s*out|timeout)\b/i.test(message)) {
    return failure("judge_timeout", true, "Final judge timed out.", retryAfterMs);
  }
  if (providerCode === "ECONNRESET" || providerCode === "EPIPE") {
    return failure("network_reset", true, "Final judge connection was reset.", retryAfterMs);
  }
  if (
    providerCode === "ENOTFOUND" ||
    providerCode === "ECONNREFUSED" ||
    /\b(?:network|fetch failed)\b/i.test(message)
  ) {
    return failure("transport_failed", true, "Final judge transport failed.", retryAfterMs);
  }
  return failure("transport_failed", false, "Final judge transport failed.");
}

export function decideFinalAcceptanceRetry(
  result: AcceptanceResult,
  attempt: number,
  nowMs: number,
): AcceptanceRetryDecision {
  if (result.verdict !== "acceptance_unavailable") {
    return { action: "not_applicable" };
  }

  const retry = result.retry;
  if (!retry) return { action: "not_applicable" };
  const maxAttempts = retry.code === "judge_invalid_response"
    ? 2
    : FINAL_ACCEPTANCE_MAX_ATTEMPTS;
  if (!retry.retryable || attempt >= maxAttempts) {
    return { action: "wait_for_user", code: retry.code };
  }

  const fallbackDelayMs = FINAL_ACCEPTANCE_RETRY_DELAYS_MS[
    Math.min(Math.max(0, attempt - 1), FINAL_ACCEPTANCE_RETRY_DELAYS_MS.length - 1)
  ];
  const delayMs = retry.retryAfterMs ?? fallbackDelayMs;
  return {
    action: "retry",
    code: retry.code,
    delayMs,
    nextRetryAt: new Date(nowMs + delayMs).toISOString(),
  };
}

function failure(
  code: AcceptanceInfrastructureFailure["code"],
  retryable: boolean,
  detail: string,
  retryAfterMs?: number,
): AcceptanceInfrastructureFailure {
  return {
    code,
    retryable,
    detail,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

function asProviderError(error: unknown): ProviderError {
  if (error && typeof error === "object") return error as ProviderError;
  return { message: typeof error === "string" ? error : "" };
}

function readStatus(error: ProviderError): number | undefined {
  const structuredStatus = parseStatus(error.status) ?? parseStatus(error.statusCode);
  if (structuredStatus !== undefined) return structuredStatus;
  const match = readMessage(error).match(/\bstatus\s+(\d{3})\b/i);
  return match?.[1] ? Number(match[1]) : undefined;
}

function parseStatus(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
  return undefined;
}

function readProviderCode(error: ProviderError): string {
  return typeof error.code === "string" ? error.code.trim() : "";
}

function readMessage(error: ProviderError): string {
  return typeof error.message === "string" ? error.message : "";
}

function readRetryAfterMs(error: ProviderError): number | undefined {
  const retryAfterMs = readHeader(error, "retry-after-ms");
  if (retryAfterMs !== undefined) {
    const milliseconds = Number.parseFloat(retryAfterMs);
    if (Number.isFinite(milliseconds) && milliseconds >= 0) {
      return boundedDelay(milliseconds);
    }
  }

  const retryAfter = readHeader(error, "retry-after");
  if (retryAfter === undefined) return undefined;
  const seconds = Number.parseFloat(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return boundedDelay(seconds * 1000);
  }
  return undefined;
}

function boundedDelay(delayMs: number): number {
  return Math.min(FINAL_ACCEPTANCE_MAX_RETRY_AFTER_MS, Math.ceil(delayMs));
}

function readHeader(error: ProviderError, name: string): string | undefined {
  for (const source of [error.responseHeaders, error.headers]) {
    if (!source) continue;
    if (typeof (source as { get?: unknown }).get === "function") {
      const value = (source as { get(headerName: string): unknown }).get(name);
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    if (typeof source !== "object") continue;
    for (const [headerName, value] of Object.entries(source as Record<string, unknown>)) {
      if (headerName.toLowerCase() !== name) continue;
      if (typeof value === "string" || typeof value === "number") return String(value);
    }
  }
  return undefined;
}
