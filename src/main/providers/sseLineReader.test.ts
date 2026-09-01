import { describe, expect, it } from "vitest";
import {
  readSseLinesUntilTerminal,
  SSE_MAX_LINE_BYTES,
  SSE_MAX_STREAM_BYTES,
} from "./sseLineReader";

describe("readSseLinesUntilTerminal", () => {
  it("fails and cancels before decoding an endless line beyond the byte limit", async () => {
    let canceled = false;
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(8).fill(0x61));
      },
      cancel() {
        canceled = true;
      },
    });
    const drain = async () => {
      for await (const _line of readSseLinesUntilTerminal(body, {
        isTerminal: () => false,
        maxLineBytes: 31,
        maxStreamBytes: 128,
      })) {
        // No line can be yielded because the transport never sends a newline.
      }
    };

    await expect(drain()).rejects.toThrow(
      "Model SSE line response exceeded 31 bytes.",
    );
    expect(pulls).toBeLessThanOrEqual(5);
    expect(canceled).toBe(true);
  });

  it("bounds the aggregate stream even when every individual frame is small", async () => {
    const encoder = new TextEncoder();
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encoder.encode("data: {}\n\n"));
      },
      cancel() {
        canceled = true;
      },
    });
    const drain = async () => {
      for await (const _line of readSseLinesUntilTerminal(body, {
        isTerminal: () => false,
        maxLineBytes: 32,
        maxStreamBytes: 31,
      })) {
        // Drain until the aggregate limit rejects the stream.
      }
    };

    await expect(drain()).rejects.toThrow(
      "Model SSE stream response exceeded 31 bytes.",
    );
    expect(canceled).toBe(true);
    expect(SSE_MAX_LINE_BYTES).toBe(4 * 1024 * 1024);
    expect(SSE_MAX_STREAM_BYTES).toBe(32 * 1024 * 1024);
  });
});
