export const defaultRequestTimeoutMs = 300_000;

export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const effectiveTimeoutMs = Math.max(1, Math.floor(timeoutMs));
  const controller = new AbortController();
  const initSignal = init.signal instanceof AbortSignal ? init.signal : undefined;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let rejectAbortable: ((error: Error) => void) | null = null;

  const abortWith = (error: Error) => {
    rejectAbortable?.(error);
    controller.abort();
  };

  const abortFromExternalSignal = () => {
    abortWith(new Error("aborted by external signal"));
  };
  const abortFromInitSignal = () => {
    abortWith(new Error("aborted by external signal"));
  };

  const abortable = new Promise<never>((_, reject) => {
    rejectAbortable = reject;
    if (externalSignal?.aborted || initSignal?.aborted) {
      abortFromExternalSignal();
      return;
    }

    externalSignal?.addEventListener("abort", abortFromExternalSignal, {
      once: true,
    });
    initSignal?.addEventListener("abort", abortFromInitSignal, { once: true });
    timeout = setTimeout(() => {
      abortWith(new Error(`${label} request timed out after ${effectiveTimeoutMs} ms.`));
    }, effectiveTimeoutMs);
  });

  try {
    const fetchPromise = fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
    void fetchPromise.catch(() => {
      // Promise.race observes this too; the extra observer prevents abandoned
      // transport aborts from becoming unhandled rejections after local timeout wins.
    });

    return await Promise.race([
      fetchPromise,
      abortable,
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
    initSignal?.removeEventListener("abort", abortFromInitSignal);
    rejectAbortable = null;
  }
}
