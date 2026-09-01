import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchWithTimeout,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
  ResponseBodyLimitError,
} from "./fetchWithTimeout";

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
});

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
