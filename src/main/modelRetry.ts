import type {
  ChatClient,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "./openAiCompatibleClient";

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
  const maxRetries = Math.max(0, Math.floor(options?.maxRetries ?? 2));
  const baseDelayMs = Math.max(0, Math.floor(options?.baseDelayMs ?? 1000));
  const maxDelayMs = Math.max(baseDelayMs, Math.floor(options?.maxDelayMs ?? 8000));

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    throwIfCanceled(request.signal);
    try {
      return await chatClient.complete(request);
    } catch (error) {
      if (
        attempt === maxRetries ||
        isCancellationError(error, request.signal) ||
        !isRetryableModelError(error)
      ) {
        throw error;
      }

      const delayMs = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      await onRetry?.({
        attempt: attempt + 1,
        maxRetries,
        delayMs,
        error: formatError(error),
      });
      await sleep(delayMs, options?.sleep, request.signal);
    }
  }

  throw new Error("LLM retry exhausted.");
}

function isRetryableModelError(error: unknown): boolean {
  const message = formatError(error);
  if (/status\s+(401|403)|unauthori[sz]ed|permission|forbidden/i.test(message)) {
    return false;
  }

  return /status\s+(408|409|425|429|5\d\d)|timeout|timed out|network|fetch|ENOTFOUND|ECONNRESET|EPIPE|overloaded/i
    .test(message);
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
    await sleepFn(delayMs);
    throwIfCanceled(signal);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, delayMs);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new Error("Agent run canceled."));
    }, { once: true });
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}
