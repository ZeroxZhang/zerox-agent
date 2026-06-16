import { describe, expect, it } from "vitest";
import {
  completeWithModelRetry,
  type ModelRetryEvent,
} from "./modelRetry";
import type {
  ChatClient,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "./openAiCompatibleClient";

const request: ChatCompletionRequest = {
  baseUrl: "https://api.example.com/v1",
  apiKey: "secret",
  model: "agent-model",
  temperature: 0,
  maxTokens: 128,
  messages: [{ role: "user", content: "hello" }],
};

describe("completeWithModelRetry", () => {
  it("honors retry-after-ms before exponential fallback", async () => {
    const sleeps: number[] = [];
    const retryEvents: ModelRetryEvent[] = [];
    const client = createFlakyClient(
      retryableError(429, { "retry-after-ms": "500" }),
    );

    await expect(completeWithModelRetry(client, request, {
      maxRetries: 2,
      baseDelayMs: 1000,
      sleep: async (delayMs) => {
        sleeps.push(delayMs);
      },
    }, (event) => {
      retryEvents.push(event);
    })).resolves.toMatchObject({
      content: "ok",
    });

    expect(sleeps).toEqual([500]);
    expect(retryEvents[0]).toMatchObject({
      attempt: 1,
      maxRetries: 2,
      delayMs: 500,
      error: "LLM request failed with status 429: overloaded",
    });
  });

  it("honors retry-after seconds", async () => {
    const sleeps: number[] = [];
    const client = createFlakyClient(
      retryableError(503, { "retry-after": "2" }),
    );

    await completeWithModelRetry(client, request, {
      maxRetries: 1,
      baseDelayMs: 1000,
      sleep: async (delayMs) => {
        sleeps.push(delayMs);
      },
    });

    expect(sleeps).toEqual([2000]);
  });

  it("honors retry-after HTTP dates", async () => {
    const sleeps: number[] = [];
    const retryAt = new Date(Date.now() + 2500).toUTCString();
    const client = createFlakyClient(
      retryableError(503, { "retry-after": retryAt }),
    );

    await completeWithModelRetry(client, request, {
      maxRetries: 1,
      baseDelayMs: 1000,
      sleep: async (delayMs) => {
        sleeps.push(delayMs);
      },
    });

    expect(sleeps[0]).toBeGreaterThan(0);
    expect(sleeps[0]).toBeLessThanOrEqual(3000);
  });

  it("does not retry non-retryable authorization errors", async () => {
    let attempts = 0;
    const client: ChatClient = {
      async complete() {
        attempts += 1;
        throw retryableError(401, {});
      },
    };

    await expect(completeWithModelRetry(client, request, {
      maxRetries: 2,
      sleep: async () => {
        throw new Error("sleep should not run");
      },
    })).rejects.toThrow("status 401");
    expect(attempts).toBe(1);
  });

  it("aborts a custom retry sleep before another attempt starts", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const client: ChatClient = {
      async complete() {
        attempts += 1;
        throw retryableError(500, {});
      },
    };

    const result = await Promise.race([
      completeWithModelRetry(client, {
        ...request,
        signal: controller.signal,
      }, {
        maxRetries: 2,
        baseDelayMs: 1000,
        sleep: async () => {
          controller.abort();
          await new Promise(() => {
            // unresolved on purpose; abort must win the race
          });
        },
      }).then(
        () => "resolved",
        (error) => error instanceof Error ? error.message : String(error),
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("timeout"), 50);
      }),
    ]);

    expect(result).toBe("Agent run canceled.");
    expect(attempts).toBe(1);
  });
});

function createFlakyClient(error: Error): ChatClient {
  let attempts = 0;
  return {
    async complete(): Promise<ChatCompletionResponse> {
      attempts += 1;
      if (attempts === 1) {
        throw error;
      }

      return {
        content: "ok",
        toolCalls: [],
        finishReason: "stop",
      };
    },
  };
}

function retryableError(
  status: number,
  headers: Record<string, string>,
): Error {
  return Object.assign(
    new Error(`LLM request failed with status ${status}: overloaded`),
    {
      status,
      responseHeaders: headers,
    },
  );
}
