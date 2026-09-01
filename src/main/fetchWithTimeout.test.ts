import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchWithTimeout,
  findResponseBodyLimitError,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
  ResponseBodyLimitError,
  throwIfResponseBodyLimitError,
} from "./fetchWithTimeout";
import { readSseLinesUntilTerminal } from "./providers/sseLineReader";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the total timeout active while the response body is pending", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Response(
        new ReadableStream({
          start() {
            // Headers are available immediately; the body never completes.
          },
        }),
      );
    }) as typeof fetch;

    const response = await fetchWithTimeout(
      fetchImpl,
      "https://example.test/slow",
      {},
      15,
      "fixture",
      undefined,
    );
    await expect(response.text()).rejects.toBeDefined();
    expect(requestSignal?.aborted).toBe(true);
  });

  it("keeps external cancellation active after response headers", async () => {
    const controller = new AbortController();
    const fetchImpl = (async () =>
      new Response(
        new ReadableStream({
          start() {},
        }),
      )) as typeof fetch;

    const response = await fetchWithTimeout(
      fetchImpl,
      "https://example.test/cancel",
      {},
      1_000,
      "fixture",
      controller.signal,
    );
    controller.abort();

    await expect(response.text()).rejects.toBeDefined();
  });

  it("allows model time-to-first-byte beyond the removed 30-second pseudo-connect deadline", async () => {
    vi.useFakeTimers();
    const fetchImpl = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 35_000));
      return new Response("slow but valid");
    }) as typeof fetch;

    const pending = fetchWithTimeout(
      fetchImpl,
      "https://example.test/slow-model",
      {},
      300_000,
      "LLM",
    ).then(async (response) => response.text());

    await vi.advanceTimersByTimeAsync(35_000);
    await expect(pending).resolves.toBe("slow but valid");
  });

  it("rejects declared and streamed bodies above the byte limit", async () => {
    const declaredError = await readResponseTextWithLimit(
        new Response("small", { headers: { "content-length": "100" } }),
        8,
        "fixture",
      ).catch((error: unknown) => error);
    expect(declaredError).toBeInstanceOf(ResponseBodyLimitError);
    expect((declaredError as Error).message).toBe(
      "fixture response exceeded 8 bytes.",
    );
    await expect(
      readResponseTextWithLimit(new Response("123456789"), 8, "fixture"),
    ).rejects.toThrow("fixture response exceeded 8 bytes");
    await expect(
      readResponseTextWithLimit(
        {
          headers: new Headers(),
          body: null,
          text: async () => "123456789",
        } as Response,
        8,
        "fixture",
      ),
    ).rejects.toThrow("fixture response exceeded 8 bytes");
  });

  it("does not wait for a non-settling body cancellation after overflow", async () => {
    const neverSettles = () => new Promise<void>(() => undefined);
    const declared = new Response(
      new ReadableStream({ cancel: neverSettles }),
      { headers: { "content-length": "9" } },
    );
    const streamed = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("123456789"));
        },
        cancel: neverSettles,
      }),
    );

    await expect(resolvesWithin(
      readResponseTextWithLimit(declared, 8, "fixture")
        .catch((error: unknown) => error),
    )).resolves.toBeInstanceOf(ResponseBodyLimitError);
    await expect(resolvesWithin(
      readResponseTextWithLimit(streamed, 8, "fixture")
        .catch((error: unknown) => error),
    )).resolves.toBeInstanceOf(ResponseBodyLimitError);
  });

  it("parses bounded JSON without bypassing the stream limit", async () => {
    await expect(
      readResponseJsonWithLimit<{ ok: boolean }>(
        new Response('{"ok":true}'),
        32,
        "fixture",
      ),
    ).resolves.toEqual({ ok: true });
  });

  it("finds a response limit through nested causes and aggregate failures", () => {
    const limit = new ResponseBodyLimitError("LLM", 32);
    const wrapped = new Error("outer", {
      cause: new AggregateError([new Error("sibling"), limit]),
    });

    expect(findResponseBodyLimitError(wrapped)).toBe(limit);
    expect(() => throwIfResponseBodyLimitError(wrapped)).toThrow(limit);
  });

  it("releases raw and wrapped SSE readers after a terminal frame", async () => {
    const encoder = new TextEncoder();
    const rawBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      },
      cancel() {
        return new Promise<void>(() => undefined);
      },
    });
    const response = await fetchWithTimeout(
      (async () => new Response(rawBody)) as typeof fetch,
      "https://example.test/sse-terminal",
      {},
      1_000,
      "fixture",
    );
    const wrappedBody = response.body!;
    let terminal = false;

    await expect(resolvesWithin(drainSse(wrappedBody, {
      isTerminal: () => terminal,
      onLine(line) {
        terminal = line === "data: [DONE]";
      },
    }))).resolves.toBeUndefined();
    expect(rawBody.locked).toBe(false);
    expect(wrappedBody.locked).toBe(false);
  });

  it("releases raw and wrapped SSE readers after line and aggregate overflow", async () => {
    const encoder = new TextEncoder();
    for (const limitKind of ["line", "stream"] as const) {
      const rawBody = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(
            encoder.encode(limitKind === "line" ? "aaaaaaaa" : "data: {}\n\n"),
          );
        },
        cancel() {
          return new Promise<void>(() => undefined);
        },
      });
      const response = await fetchWithTimeout(
        (async () => new Response(rawBody)) as typeof fetch,
        `https://example.test/sse-${limitKind}-overflow`,
        {},
        1_000,
        "fixture",
      );
      const wrappedBody = response.body!;

      await expect(resolvesWithin(
        drainSse(wrappedBody, {
          isTerminal: () => false,
          ...(limitKind === "line"
            ? { maxLineBytes: 7, maxStreamBytes: 64 }
            : { maxLineBytes: 32, maxStreamBytes: 15 }),
        }).catch((error: unknown) => error),
      )).resolves.toBeInstanceOf(ResponseBodyLimitError);
      expect(rawBody.locked).toBe(false);
      expect(wrappedBody.locked).toBe(false);
    }
  });

  it("releases raw and wrapped SSE readers when the parser unwinds", async () => {
    const rawBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: invalid\n\n"));
      },
      cancel() {
        return new Promise<void>(() => undefined);
      },
    });
    const response = await fetchWithTimeout(
      (async () => new Response(rawBody)) as typeof fetch,
      "https://example.test/sse-parser",
      {},
      1_000,
      "fixture",
    );
    const wrappedBody = response.body!;

    await expect(resolvesWithin(
      drainSse(wrappedBody, {
        isTerminal: () => false,
        onLine() {
          throw new Error("parser failed");
        },
      }).catch((error: unknown) => error),
    )).resolves.toMatchObject({ message: "parser failed" });
    expect(rawBody.locked).toBe(false);
    expect(wrappedBody.locked).toBe(false);
  });

  it("returns promptly and releases both SSE readers after an idle timeout", async () => {
    const rawBody = new ReadableStream<Uint8Array>({
      start() {
        // Keep the transport open without producing a frame.
      },
      cancel() {
        return new Promise<void>(() => undefined);
      },
    });
    const response = await fetchWithTimeout(
      (async () => new Response(rawBody)) as typeof fetch,
      "https://example.test/sse-idle",
      {},
      1_000,
      "fixture",
    );
    const wrappedBody = response.body!;

    await expect(resolvesWithin(
      drainSse(wrappedBody, {
        isTerminal: () => false,
        idleTimeoutMs: 5,
      }).catch((error: unknown) => error),
    )).resolves.toMatchObject({ message: "SSE stream idle timeout" });
    expect(rawBody.locked).toBe(false);
    expect(wrappedBody.locked).toBe(false);
  });

  it.each(["eof", "error"] as const)(
    "releases raw and wrapped readers after transport %s",
    async (ending) => {
      const rawBody = new ReadableStream<Uint8Array>({
        start(controller) {
          if (ending === "eof") {
            controller.enqueue(new TextEncoder().encode("data: partial\n"));
            controller.close();
          } else {
            controller.error(new Error("transport failed"));
          }
        },
      });
      const response = await fetchWithTimeout(
        (async () => new Response(rawBody)) as typeof fetch,
        `https://example.test/sse-${ending}`,
        {},
        1_000,
        "fixture",
      );
      const wrappedBody = response.body!;
      const outcome = drainSse(wrappedBody, {
        isTerminal: () => false,
      });

      if (ending === "eof") {
        await expect(resolvesWithin(outcome)).resolves.toBeUndefined();
      } else {
        await expect(resolvesWithin(
          outcome.catch((error: unknown) => error),
        )).resolves.toMatchObject({ message: "transport failed" });
      }
      expect(rawBody.locked).toBe(false);
      expect(wrappedBody.locked).toBe(false);
    },
  );
});

async function drainSse(
  body: ReadableStream<Uint8Array>,
  options: Parameters<typeof readSseLinesUntilTerminal>[1] & {
    onLine?: (line: string) => void;
  },
): Promise<void> {
  for await (const line of readSseLinesUntilTerminal(body, options)) {
    options.onLine?.(line);
  }
}

async function resolvesWithin<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("response budget did not fail promptly")),
          250,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
