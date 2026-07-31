import { describe, expect, it, vi } from "vitest";
import type { AcceptanceResult } from "./agentGoalAcceptance";
import {
  FINAL_ACCEPTANCE_MAX_RETRY_AFTER_MS,
  classifyAcceptanceInfrastructureFailure,
  decideFinalAcceptanceRetry,
  type AcceptanceInfrastructureFailure,
} from "./agentGoalAcceptanceRetryPolicy";

describe("agent goal acceptance retry policy", () => {
  it.each([
    [Object.assign(new Error("reset"), { code: "ECONNRESET" }), "network_reset"],
    [Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }), "judge_timeout"],
    [Object.assign(new Error("busy"), { status: 503 }), "provider_unavailable"],
    [Object.assign(new Error("limited"), { status: 429 }), "rate_limited"],
  ])("classifies retryable infrastructure failures", (error, code) => {
    expect(classifyAcceptanceInfrastructureFailure(error)).toMatchObject({
      code,
      retryable: true,
    });
  });

  it("keeps bounded retry-after metadata while requiring manual 429 retry", () => {
    const limited = Object.assign(new Error("limited"), {
      status: 429,
      responseHeaders: { "retry-after-ms": "1500" },
    });
    const excessive = Object.assign(new Error("limited"), {
      statusCode: 429,
      headers: { "Retry-After": "60" },
    });

    expect(classifyAcceptanceInfrastructureFailure(limited).retryAfterMs).toBe(1500);
    expect(classifyAcceptanceInfrastructureFailure(excessive).retryAfterMs).toBe(
      FINAL_ACCEPTANCE_MAX_RETRY_AFTER_MS,
    );
    expect(decideFinalAcceptanceRetry(timeoutResult(), 1, 10_000)).toMatchObject({
      action: "retry",
      delayMs: 1000,
      nextRetryAt: new Date(11_000).toISOString(),
    });
    expect(decideFinalAcceptanceRetry(timeoutResult(), 2, 10_000)).toMatchObject({
      action: "retry",
      delayMs: 2000,
      nextRetryAt: new Date(12_000).toISOString(),
    });
    expect(
      decideFinalAcceptanceRetry(rateLimitedResult(1500), 1, 10_000),
    ).toEqual({
      action: "wait_for_user",
      code: "rate_limited",
    });
  });

  it("prefers structured status over compatibility message matching", () => {
    const limited = Object.assign(new Error("upstream timeout text"), { status: 429 });

    expect(classifyAcceptanceInfrastructureFailure(limited).code).toBe("rate_limited");
  });

  it("falls back to a valid statusCode when status is malformed", () => {
    const limited = Object.assign(new Error("limited"), {
      status: "unknown",
      statusCode: 429,
    });

    expect(classifyAcceptanceInfrastructureFailure(limited).code).toBe("rate_limited");
  });

  it.each([
    ["HTTP 429", "rate_limited", true],
    ["HTTP 502", "provider_unavailable", true],
    ["HTTP 400", "transport_failed", false],
  ] as const)(
    "classifies native provider message %s without making other 4xx retryable",
    (message, code, retryable) => {
      expect(
        classifyAcceptanceInfrastructureFailure(new Error(`${message}: redacted`)),
      ).toMatchObject({ code, retryable });
    },
  );

  it("ignores HTTP-date retry-after without reading the wall clock", () => {
    const now = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("classifier must not read the wall clock");
    });
    let classified: AcceptanceInfrastructureFailure | undefined;
    try {
      classified = classifyAcceptanceInfrastructureFailure(
        Object.assign(new Error("limited"), {
          status: 429,
          headers: { "retry-after": "Wed, 21 Oct 2037 07:28:00 GMT" },
        }),
      );
    } finally {
      now.mockRestore();
    }

    expect(classified).toMatchObject({
      code: "rate_limited",
      retryable: true,
    });
    expect(classified).not.toHaveProperty("retryAfterMs");
  });

  it("waits for the user after the third retryable failure", () => {
    expect(decideFinalAcceptanceRetry(timeoutResult(), 3, 10_000)).toEqual({
      action: "wait_for_user",
      code: "judge_timeout",
    });
  });

  it("allows only one clean retry for an invalid judge response", () => {
    expect(decideFinalAcceptanceRetry(invalidJudgeResult(), 1, 10_000).action).toBe("retry");
    expect(decideFinalAcceptanceRetry(invalidJudgeResult(), 2, 10_000)).toEqual({
      action: "wait_for_user",
      code: "judge_invalid_response",
    });
  });

  it.each(["accepted", "rejected_repairable", "blocked_external", "impossible"] as const)(
    "does not apply to a %s verdict",
    (verdict) => {
      expect(decideFinalAcceptanceRetry(resultWith({ verdict }), 1, 10_000)).toEqual({
        action: "not_applicable",
      });
    },
  );
});

function timeoutResult(): AcceptanceResult {
  return resultWith({
    verdict: "acceptance_unavailable",
    retry: failure("judge_timeout"),
  });
}

function rateLimitedResult(retryAfterMs: number): AcceptanceResult {
  return resultWith({
    verdict: "acceptance_unavailable",
    retry: { ...failure("rate_limited"), retryAfterMs },
  });
}

function invalidJudgeResult(): AcceptanceResult {
  return resultWith({
    verdict: "acceptance_unavailable",
    retry: failure("judge_invalid_response"),
  });
}

function failure(
  code: AcceptanceInfrastructureFailure["code"],
): AcceptanceInfrastructureFailure {
  return { code, retryable: true, detail: code };
}

function resultWith(
  overrides: Partial<AcceptanceResult> & {
    retry?: AcceptanceInfrastructureFailure;
  },
): AcceptanceResult {
  return {
    accepted: overrides.verdict === "accepted",
    verdict: "acceptance_unavailable",
    failureClass: "judge_unavailable",
    checkResults: [],
    inferentialUsed: true,
    ...overrides,
  } as AcceptanceResult;
}
