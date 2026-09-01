import type {
  ChatClient,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "./openAiCompatibleClient";
import { modelServiceNoticeFromError } from "../shared/modelServiceNotice";
import { ResponseBodyLimitError } from "./fetchWithTimeout";

export type ModelRetryOptions = {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
};

export type ModelRetryEvent = {
  attempt: number;
  maxRetries: number;
  delayMs: number;
  error: string;
};

export async function completeWithModelRetry(
  chatClient: ChatClient,
  request: ChatCompletionRequest,
  options: ModelRetryOptions | undefined,
  onRetry?: (event: ModelRetryEvent) => void | Promise<void>,
): Promise<ChatCompletionResponse> {
  return retryModelOperation(
    () => chatClient.complete(request),
    options,
    request.signal,
    onRetry,
  );
}

/**
 * Shared retry contract for model boundaries that do not expose a ChatClient
 * directly (for example Plan structured generation and cold review). Keeping
 * the classifier and cancellation semantics here prevents planning, Chat, and
 * Goal execution from drifting into different transport behavior.
 */
export async function retryModelOperation<T>(
  operation: () => Promise<T>,
  options: ModelRetryOptions | undefined,
  signal?: AbortSignal,
  onRetry?: (event: ModelRetryEvent) => void | Promise<void>,
): Promise<T> {
  const maxRetries = Math.max(0, Math.floor(options?.maxRetries ?? 2));
  const baseDelayMs = Math.max(0, Math.floor(options?.baseDelayMs ?? 1000));
  const maxDelayMs = Math.max(baseDelayMs, Math.floor(options?.maxDelayMs ?? 8000));

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    throwIfCanceled(signal);
    try {
      return await operation();
    } catch (error) {
      if (
        attempt === maxRetries ||
        isCancellationError(error, signal) ||
        !isRetryableModelError(error)
      ) {
        throw error;
      }

      const delayMs = getRetryDelayMs(error, attempt, baseDelayMs, maxDelayMs);
      await onRetry?.({
        attempt: attempt + 1,
        maxRetries,
        delayMs,
        error: formatError(error),
      });
      await sleep(delayMs, options?.sleep, signal);
    }
  }

  throw new Error("Temporary model transport retries did not recover.");
}

function isRetryableModelError(error: unknown): boolean {
  if (error instanceof ResponseBodyLimitError) {
    return false;
  }
  if (modelServiceNoticeFromError(error)) {
    return false;
  }
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : undefined;
  const status = Number(record?.statusCode ?? record?.status);
  if (Number.isFinite(status)) {
    if (status === 402 || status === 429) return false;
    if (status === 408 || status === 409 || status === 425 || status >= 500) {
      return true;
    }
  }
  const message = formatError(error);
  if (/status\s+(401|403)|unauthori[sz]ed|permission|forbidden/i.test(message)) {
    return false;
  }

  // Provider rate/quota limits are surfaced to the user for an explicit retry.
  return /(?:status|http)\s+(408|409|425|5\d\d)|timeout|timed out|network|fetch|ENOTFOUND|ECONNRESET|EPIPE|overloaded/i
    .test(message);
}

function getRetryDelayMs(
  error: unknown,
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const retryAfterMs = parseRetryAfterMs(error);
  if (retryAfterMs !== null) {
    return Math.min(retryAfterMs, maxDelayMs);
  }

  // v3.6.0: Add ±25% jitter to prevent thundering herd (NET-02).
  const base = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  const jitter = base * 0.25 * (Math.random() * 2 - 1); // random in [-25%, +25%]
  return Math.max(0, Math.ceil(base + jitter));
}

function parseRetryAfterMs(error: unknown): number | null {
  const retryAfterMs = readRetryHeader(error, "retry-after-ms");
  if (retryAfterMs) {
    const parsedMs = Number.parseFloat(retryAfterMs);
    if (!Number.isNaN(parsedMs) && parsedMs >= 0) {
      return Math.ceil(parsedMs);
    }
  }

  const retryAfter = readRetryHeader(error, "retry-after");
  if (!retryAfter) {
    return null;
  }

  const parsedSeconds = Number.parseFloat(retryAfter);
  if (!Number.isNaN(parsedSeconds) && parsedSeconds >= 0) {
    return Math.ceil(parsedSeconds * 1000);
  }

  const parsedDateMs = Date.parse(retryAfter) - Date.now();
  if (!Number.isNaN(parsedDateMs) && parsedDateMs > 0) {
    return Math.ceil(parsedDateMs);
  }

  return null;
}

function readRetryHeader(error: unknown, headerName: string): string | null {
  const sources = retryHeaderSources(error);
  for (const source of sources) {
    const value = readHeader(source, headerName);
    if (value) {
      return value;
    }
  }

  return null;
}

function retryHeaderSources(error: unknown): unknown[] {
  if (!error || typeof error !== "object") {
    return [];
  }

  const value = error as {
    responseHeaders?: unknown;
    headers?: unknown;
    response?: { headers?: unknown };
    data?: { responseHeaders?: unknown };
  };

  return [
    value.responseHeaders,
    value.headers,
    value.response?.headers,
    value.data?.responseHeaders,
  ].filter(Boolean);
}

function readHeader(source: unknown, headerName: string): string | null {
  const lowerHeaderName = headerName.toLowerCase();
  if (source && typeof (source as { get?: unknown }).get === "function") {
    const value = (source as { get(name: string): unknown }).get(headerName) ??
      (source as { get(name: string): unknown }).get(lowerHeaderName);
    return typeof value === "string" ? value : null;
  }

  if (!source || typeof source !== "object") {
    return null;
  }

  const record = source as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === lowerHeaderName && typeof value === "string") {
      return value;
    }
  }

  return null;
}

function isCancellationError(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  return (
    signal?.aborted ||
    (error instanceof Error && /cancell?ed|abort/i.test(error.message))
  );
}

function throwIfCanceled(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new Error("Agent run canceled.");
  }
}

async function sleep(
  delayMs: number,
  sleepFn: ModelRetryOptions["sleep"],
  signal: AbortSignal | undefined,
) {
  if (delayMs <= 0) {
    return;
  }
  throwIfCanceled(signal);
  if (sleepFn) {
    await raceWithAbort(sleepFn(delayMs), signal);
    throwIfCanceled(signal);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Agent run canceled."));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) {
    return promise;
  }

  throwIfCanceled(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new Error("Agent run canceled."));
    };
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}
