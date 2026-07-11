import { describe, expect, it } from "vitest";
import {
  redactAndBoundAcceptanceSummary,
  redactAndBoundEvidenceRef,
} from "./agentGoalRedaction";

describe("goal acceptance redaction", () => {
  it.each([
    "artifact:report?session_token=session-secret&safe=1",
    "artifact:report/cookie/cookie-secret/result",
    "https://user:password@example.invalid/report?refresh_token=refresh-secret",
    '{"client_secret":"json-secret","credentials":"credential-secret"}',
    "webhook=https://hooks.slack.com/services/T000/B000/SLACKSECRET",
    "webhook=https://example.invalid/hooks/generic-webhook-secret",
    "Authorization: Bearer bearer-secret",
    "aws_session_token=aws-secret&security_token=security-secret",
  ])("redacts credential-bearing evidence ref %s", (value) => {
    const redacted = redactAndBoundEvidenceRef(value);

    expect(redacted).toContain("[redacted]");
    expect(redacted).not.toMatch(
      /session-secret|cookie-secret|password@example|refresh-secret|json-secret|credential-secret|SLACKSECRET|generic-webhook-secret|bearer-secret|aws-secret|security-secret/,
    );
    expect(Buffer.byteLength(redacted)).toBeLessThanOrEqual(512);
  });

  it("redacts and byte-bounds accepted or rejected judge explanations", () => {
    const secret = "judge-session-secret";
    const raw = [
      "Cold judge explanation.",
      `session_token=${secret}`,
      "cookie: judge-cookie-secret",
      "x".repeat(10_000),
    ].join(" ");

    const redacted = redactAndBoundAcceptanceSummary(raw);

    expect(redacted).toContain("Cold judge explanation.");
    expect(redacted).not.toContain(secret);
    expect(redacted).not.toContain("judge-cookie-secret");
    expect(Buffer.byteLength(redacted)).toBeLessThanOrEqual(1_024);
  });
});
