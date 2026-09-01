import { ResponseBodyLimitError } from "../fetchWithTimeout";
import {
  MODEL_RESPONSE_MAX_BODY_BYTES,
  MODEL_STREAM_MAX_LINE_BYTES,
} from "../../shared/limits";

export interface SseLineReaderOptions {
  isTerminal: () => boolean;
  idleTimeoutMs?: number;
  idleTimeoutMessage?: string;
  maxLineBytes?: number;
  maxStreamBytes?: number;
}

export const SSE_MAX_LINE_BYTES = MODEL_STREAM_MAX_LINE_BYTES;
export const SSE_MAX_STREAM_BYTES = MODEL_RESPONSE_MAX_BODY_BYTES;

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
  let totalBytes = 0;
  let currentLineBytes = 0;
  const maxLineBytes = normalizeByteLimit(
    options.maxLineBytes,
    SSE_MAX_LINE_BYTES,
  );
  const maxStreamBytes = normalizeByteLimit(
    options.maxStreamBytes,
    SSE_MAX_STREAM_BYTES,
  );

  try {
    while (!options.isTerminal()) {
      const { done, value } = await readWithOptionalIdleTimeout(reader, options);
      if (done) {
        eofObserved = true;
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxStreamBytes) {
        throw new ResponseBodyLimitError("Model SSE stream", maxStreamBytes);
      }
      currentLineBytes = countTrailingLineBytes(
        value,
        currentLineBytes,
        maxLineBytes,
      );

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
      // is already complete (or the consumer is unwinding). cancel()
      // synchronously settles pending reads, so release the private lock now;
      // the provider's cleanup promise may legitimately never settle.
      try {
        void reader
          .cancel("SSE consumption ended before transport EOF.")
          .catch(() => undefined);
      } catch {
        // Cleanup errors cannot replace the terminal result or stream failure.
      }
      try {
        reader.releaseLock();
      } catch {
        // cancel() synchronously settles pending reads before its underlying
        // hook resolves; a defensive release failure still must not mask the
        // model result.
      }
    }
  }
}

function normalizeByteLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? Number(value)
    : fallback;
}

function countTrailingLineBytes(
  chunk: Uint8Array,
  previousLineBytes: number,
  maxLineBytes: number,
): number {
  let lineBytes = previousLineBytes;
  let segmentStart = 0;
  while (segmentStart < chunk.byteLength) {
    const newlineIndex = chunk.indexOf(0x0a, segmentStart);
    const segmentEnd = newlineIndex === -1 ? chunk.byteLength : newlineIndex;
    lineBytes += segmentEnd - segmentStart;
    if (lineBytes > maxLineBytes) {
      throw new ResponseBodyLimitError("Model SSE line", maxLineBytes);
    }
    if (newlineIndex === -1) break;
    lineBytes = 0;
    segmentStart = newlineIndex + 1;
  }
  return lineBytes;
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
