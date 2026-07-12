export const defaultRequestTimeoutMs = 300_000;
// v3.6.0: Separate connect timeout from body timeout (NET-01, S2-27).
// The connect timeout applies to the initial TCP/TLS handshake; the body
// timeout covers the full request including response streaming.
export const defaultConnectTimeoutMs = 30_000;

export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<string> {
  const normalizedLimit = Math.max(1, Math.floor(maxBytes));
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > normalizedLimit) {
    await response.body?.cancel(`${label} response exceeded ${normalizedLimit} bytes`);
    throw new Error(`${label} response exceeded ${normalizedLimit} bytes.`);
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > normalizedLimit) {
      throw new Error(`${label} response exceeded ${normalizedLimit} bytes.`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > normalizedLimit) {
        await reader.cancel(`${label} response exceeded ${normalizedLimit} bytes`);
        throw new Error(`${label} response exceeded ${normalizedLimit} bytes.`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function readResponseJsonWithLimit<T>(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<T> {
  return JSON.parse(
    await readResponseTextWithLimit(response, maxBytes, label),
  ) as T;
}

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
    controller.abort(error);
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

  const cleanup = () => {
    if (timeout) clearTimeout(timeout);
    if (connectTimeout) clearTimeout(connectTimeout);
    timeout = null;
    connectTimeout = null;
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
    initSignal?.removeEventListener("abort", abortFromInitSignal);
    rejectAbortable = null;
  };

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
    connectTimeout = null;
    // Once headers arrive the caller no longer awaits `abortable`; body reads
    // observe the controller abort directly.
    rejectAbortable = null;
    return wrapResponseLifecycle(response, controller.signal, cleanup);
  } catch (error) {
    cleanup();
    throw error;
  }
}

function wrapResponseLifecycle(
  response: Response,
  signal: AbortSignal,
  cleanup: () => void,
): Response {
  let cleaned = false;
  const cleanupOnce = () => {
    if (cleaned) return;
    cleaned = true;
    cleanup();
  };
  if (!response.body) {
    cleanupOnce();
    return response;
  }
  const body = wrapResponseBody(response.body, signal, cleanupOnce);
  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function wrapResponseBody(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  cleanup: () => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let abortHandler: (() => void) | undefined;
  const finish = () => {
    if (abortHandler) {
      signal.removeEventListener("abort", abortHandler);
      abortHandler = undefined;
    }
    cleanup();
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      abortHandler = () => {
        finish();
        void reader.cancel(signal.reason).catch(() => undefined);
        controller.error(
          signal.reason instanceof Error
            ? signal.reason
            : new Error("request aborted"),
        );
      };
      if (signal.aborted) {
        abortHandler();
      } else {
        signal.addEventListener("abort", abortHandler, { once: true });
      }
    },
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          finish();
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      finish();
      await reader.cancel(reason);
    },
  });
}
