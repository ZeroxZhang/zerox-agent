export const defaultRequestTimeoutMs = 300_000;
// v3.6.0: Separate connect timeout from body timeout (NET-01, S2-27).
// The connect timeout applies to the initial TCP/TLS handshake; the body
// timeout covers the full request including response streaming.
export const defaultConnectTimeoutMs = 30_000;

export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
  externalSignal?: AbortSignal,
  connectTimeoutMs?: number,
): Promise<Response> {
  const effectiveTimeoutMs = Math.max(1, Math.floor(timeoutMs));
  const effectiveConnectTimeoutMs = Math.max(1, Math.floor(connectTimeoutMs ?? defaultConnectTimeoutMs));
  const controller = new AbortController();
  const initSignal = init.signal instanceof AbortSignal ? init.signal : undefined;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let connectTimeout: ReturnType<typeof setTimeout> | null = null;
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
    // v3.6.0: Separate connect timeout — if the TCP/TLS handshake hangs,
    // this fires before the full body timeout (NET-01).
    connectTimeout = setTimeout(() => {
      abortWith(new Error(`${label} connection timed out after ${effectiveConnectTimeoutMs} ms.`));
    }, effectiveConnectTimeoutMs);
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

    const response = await Promise.race([
      fetchPromise,
      abortable,
    ]);
    // v3.6.0: Connection succeeded — clear the connect timeout since we're
    // now in the body/streaming phase (NET-01).
    if (connectTimeout) clearTimeout(connectTimeout);
    return response;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (connectTimeout) clearTimeout(connectTimeout);
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
    initSignal?.removeEventListener("abort", abortFromInitSignal);
    rejectAbortable = null;
  }
}
