import { describe, expect, it } from "vitest";
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

  it("uses bounded retry-after before exponential fallback", () => {
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
    expect(decideFinalAcceptanceRetry(rateLimitedResult(1500), 1, 10_000)).toMatchObject({
      action: "retry",
      delayMs: 1500,
      nextRetryAt: new Date(11_500).toISOString(),
    });
  });

  it("prefers structured status over compatibility message matching", () => {
    const limited = Object.assign(new Error("upstream timeout text"), { status: 429 });

    expect(classifyAcceptanceInfrastructureFailure(limited).code).toBe("rate_limited");
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
