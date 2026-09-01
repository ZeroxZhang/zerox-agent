export interface SseLineReaderOptions {
  isTerminal: () => boolean;
  idleTimeoutMs?: number;
  idleTimeoutMessage?: string;
}

/**
 * Decode an SSE response one line at a time and stop at the protocol terminal
 * event, even when the transport remains open. The caller updates
 * `isTerminal` while handling each yielded line.
 */
export async function* readSseLinesUntilTerminal(
  body: ReadableStream<Uint8Array>,
  options: SseLineReaderOptions,
): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eofObserved = false;

  try {
    while (!options.isTerminal()) {
      const { done, value } = await readWithOptionalIdleTimeout(reader, options);
      if (done) {
        eofObserved = true;
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        yield line;
        if (options.isTerminal()) return;
      }
    }

    if (!options.isTerminal()) {
      buffer += decoder.decode();
      if (buffer.trim()) {
        for (const line of buffer.split("\n")) {
          yield line;
          if (options.isTerminal()) return;
        }
      }
    }
  } finally {
    if (eofObserved) {
      reader.releaseLock();
    } else {
      // Do not wait for a provider's cancellation hook: the protocol response
      // is already complete (or the consumer is unwinding). Release the lock
      // after cancellation settles so a pending read cannot make releaseLock
      // throw and mask the actual stream result.
      void reader
        .cancel("SSE consumption ended before transport EOF.")
        .catch(() => undefined)
        .finally(() => {
          try {
            reader.releaseLock();
          } catch {
            // The reader is private to this helper; cleanup errors are not a
            // valid reason to replace the model's terminal result or failure.
          }
        });
    }
  }
}

async function readWithOptionalIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: SseLineReaderOptions,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  const idleTimeoutMs = options.idleTimeoutMs;
  if (idleTimeoutMs === undefined) return reader.read();

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(options.idleTimeoutMessage ?? "SSE stream idle timeout")),
          idleTimeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
