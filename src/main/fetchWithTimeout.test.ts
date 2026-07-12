import { describe, expect, it } from "vitest";
import {
  fetchWithTimeout,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from "./fetchWithTimeout";

describe("fetchWithTimeout", () => {
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
      100,
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
      100,
    );
    controller.abort();

    await expect(response.text()).rejects.toBeDefined();
  });

  it("rejects declared and streamed bodies above the byte limit", async () => {
    await expect(
      readResponseTextWithLimit(
        new Response("small", { headers: { "content-length": "100" } }),
        8,
        "fixture",
      ),
    ).rejects.toThrow("fixture response exceeded 8 bytes");
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
