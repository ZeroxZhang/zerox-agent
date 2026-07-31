import { describe, expect, it } from "vitest";
import {
  modelServiceNoticeFromError,
  modelServiceNoticeFromFinishReason,
} from "./modelServiceNotice";

describe("model service notices", () => {
  it.each(["length", "MAX_TOKENS", "max_tokens", "max_output_tokens"])(
    "normalizes %s as an output limit",
    (finishReason) => {
      expect(
        modelServiceNoticeFromFinishReason(finishReason, {
          provider: "test-provider",
          model: "test-model",
        }),
      ).toMatchObject({
        kind: "output_limit",
        provider: "test-provider",
        model: "test-model",
        rawReason: finishReason,
      });
    },
  );

  it.each(["stop", "end_turn", "tool_calls", "STOP"])(
    "does not create a notice for normal completion reason %s",
    (finishReason) => {
      expect(modelServiceNoticeFromFinishReason(finishReason)).toBeUndefined();
    },
  );

  it("normalizes a rate limit with retry metadata without exposing the body", () => {
    const notice = modelServiceNoticeFromError(
      Object.assign(new Error("secret response body sk-test-private"), {
        statusCode: 429,
        code: "rate_limit_exceeded",
        responseHeaders: { "retry-after": "2" },
      }),
      { provider: "openai-compatible", model: "test-model" },
    );

    expect(notice).toMatchObject({
      kind: "rate_limit",
      provider: "openai-compatible",
      model: "test-model",
      code: "rate_limit_exceeded",
      statusCode: 429,
      retryAfterMs: 2_000,
    });
    expect(JSON.stringify(notice)).not.toContain("sk-test-private");
  });

  it("distinguishes quota exhaustion from a generic 429", () => {
    expect(
      modelServiceNoticeFromError({
        status: 429,
        code: "insufficient_quota",
        message: "sensitive provider detail",
      }),
    ).toMatchObject({
      kind: "quota_exhausted",
      code: "insufficient_quota",
      statusCode: 429,
    });
  });

  it("reads Bedrock-style status metadata safely", () => {
    expect(
      modelServiceNoticeFromError({
        name: "ThrottlingException",
        message: "Request throttled",
        $metadata: {
          httpStatusCode: 429,
          httpHeaders: { "retry-after-ms": "750" },
        },
      }),
    ).toMatchObject({
      kind: "rate_limit",
      code: "ThrottlingException",
      statusCode: 429,
      retryAfterMs: 750,
    });
  });

  it("surfaces a generic provider HTTP error without exposing its response body", () => {
    const notice = modelServiceNoticeFromError(
      Object.assign(new Error("private provider response sk-secret"), {
        statusCode: 400,
        code: "invalid_request_error",
      }),
      { provider: "deepseek", model: "deepseek-v4-flash" },
    );

    expect(notice).toEqual({
      kind: "provider_stop",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      code: "invalid_request_error",
      statusCode: 400,
      rawReason: "HTTP 400 / invalid_request_error",
      message:
        "模型服务商返回错误（HTTP 400 / invalid_request_error），请根据服务商状态检查后手动重试。",
    });
    expect(JSON.stringify(notice)).not.toContain("sk-secret");
  });
});
