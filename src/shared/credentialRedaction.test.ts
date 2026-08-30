import { describe, expect, it } from "vitest";
import {
  redactCredentialJsonText,
  redactCredentialString,
  redactCredentialText,
  redactCredentials,
  stringifyRedactedCredentials,
} from "./credentialRedaction";

describe("credential redaction", () => {
  it("recursively masks secret keys and credential-shaped string values", () => {
    const redacted = redactCredentials({
      apiKey: "sk-top-secret",
      nested: {
        command:
          "curl https://user:password@example.test/run?access_token=query-secret " +
          "-H 'Authorization: Bearer bearer-secret'",
        result: ["Set-Cookie: session=cookie-secret; Path=/", "safe"],
      },
    });
    const serialized = JSON.stringify(redacted);

    expect(serialized).toContain("[redacted]");
    expect(serialized).toContain("safe");
    expect(serialized).not.toMatch(
      /sk-top-secret|password@example|query-secret|bearer-secret|cookie-secret/,
    );
  });

  it("redacts prefixed non-JSON history strings before serialization", () => {
    const value =
      'Tool result shell_exec: error {"headers":{"authorization":"Bearer nested-secret"}}';

    expect(redactCredentialText(value)).not.toContain("nested-secret");
    expect(stringifyRedactedCredentials({ content: value })).not.toContain(
      "nested-secret",
    );
  });

  it("redacts every Authorization header scheme and credential body", () => {
    const values = [
      "Authorization: ApiKey api-key-canary",
      "Authorization: Token token-canary",
      "Authorization: Digest username=user, response=digest-canary",
      'Authorization: Digest username="alice", response="quoted-canary"',
      "Authorization: AWS4-HMAC-SHA256 Credential=aws-canary",
    ];

    for (const value of values) {
      expect(redactCredentialText(value)).toBe("Authorization: [redacted]");
    }
  });

  it("returns a detached redacted graph without mutating the input", () => {
    const input = {
      command:
        "curl https://user:password@example.test?api_key=query-secret",
      nested: {
        authorization: "Bearer nested-secret",
        values: ["safe", "Cookie: session=cookie-secret"],
      },
    };
    const original = structuredClone(input);
    const redacted = redactCredentials(input);

    expect(input).toEqual(original);
    expect(redacted).not.toBe(input);
    if (!redacted || typeof redacted !== "object" || !("nested" in redacted)) {
      throw new Error("Expected a redacted object graph.");
    }
    expect(redacted.nested).not.toBe(input.nested);
    expect(JSON.stringify(redacted)).not.toMatch(
      /password@example|query-secret|nested-secret|cookie-secret/,
    );
  });

  it("redacts quoted headers, escaped separators, and escaped JSON keys", () => {
    const quotedHeader =
      'curl -H "X-Api-Key: quoted-header-canary" https://example.test';
    const escapedSeparator = "client_secret\\u003descaped-separator-canary";
    const escapedJsonKey =
      '{"api\\u005fkey":"escaped-key-canary","command":"client_secret\\u003descaped-json-canary"}';

    expect(redactCredentialText(quotedHeader)).not.toContain(
      "quoted-header-canary",
    );
    expect(redactCredentialText(escapedSeparator)).not.toContain(
      "escaped-separator-canary",
    );
    const redactedJson = redactCredentialJsonText(escapedJsonKey);
    expect(redactedJson).toContain("[redacted]");
    expect(redactedJson).not.toMatch(
      /escaped-key-canary|escaped-json-canary/,
    );
    expect(redactCredentialJsonText("{partial")).toBe(
      '{"redacted":"invalid_tool_arguments"}',
    );
  });

  it("preserves numeric and boolean token telemetry", () => {
    expect(redactCredentials({
      inputTokens: 42,
      outputTokens: 7,
      tokenBudget: 334,
      tokensEstimated: true,
      password: 123456,
      apiKey: 987654,
      accessToken: 246810,
      refreshToken: "telemetry-secret-canary",
    })).toEqual({
      inputTokens: 42,
      outputTokens: 7,
      tokenBudget: 334,
      tokensEstimated: true,
      password: "[redacted]",
      apiKey: "[redacted]",
      accessToken: "[redacted]",
      refreshToken: "[redacted]",
    });
  });

  it("redacts nested JSON strings before they enter durable payloads", () => {
    const redacted = redactCredentialJsonText(JSON.stringify({
      payload: '{"api\\u005fkey":"nested-json-canary"}',
    }));

    expect(redacted).toContain("[redacted]");
    expect(redacted).not.toContain("nested-json-canary");
    expect(
      redactCredentialString('{"api\\u005fkey":"json-text-canary"}'),
    ).not.toContain("json-text-canary");
  });

  it("redacts Unicode-escaped secret keys inside prefixed JSON fragments", () => {
    const objectFragment =
      'boom {"api\\u005fkey":"prefixed-json-canary"} tail';
    const assignedFragment =
      'tool failed: payload={"client\\u005fsecret":"nested-fragment-canary"}';

    expect(redactCredentialString(objectFragment)).not.toContain(
      "prefixed-json-canary",
    );
    expect(redactCredentialString(assignedFragment)).not.toContain(
      "nested-fragment-canary",
    );
  });

  it("redacts quoted values attached to unquoted secret keys", () => {
    const values = [
      'X-Api-Key: "quoted-value-canary"',
      'api_key="assigned-quoted-canary"',
      "client_secret: 'single-quoted-canary'",
      'api_key=\\"escaped-quoted-canary\\"',
    ];

    for (const value of values) {
      const redacted = redactCredentialString(value);
      expect(redacted).toContain("[redacted]");
      expect(redacted).not.toMatch(
        /quoted-value-canary|assigned-quoted-canary|single-quoted-canary|escaped-quoted-canary/,
      );
    }
  });

  it("redacts CLI flags and percent-encoded secret keys", () => {
    const values = [
      "curl --api-key cli-flag-canary",
      "tool --password cli-password-canary",
      "https://example.test?api%5Fkey=encoded-key-canary",
      "https://example.test?api%255fkey=recursive-url-canary",
      "tool --api%255fkey recursive-cli-canary",
      "API_KEY+=append-assignment-canary",
    ];

    for (const value of values) {
      expect(redactCredentialString(value)).not.toMatch(
        /cli-flag-canary|cli-password-canary|encoded-key-canary|recursive-url-canary|recursive-cli-canary|append-assignment-canary/,
      );
    }
  });

  it("redacts recursively encoded object and JSON keys plus YAML block scalars", () => {
    const canary = "recursive-grammar-canary";
    const values = [
      { "api%255fkey": canary },
      `{"api%255fkey":"${canary}"}`,
      `damaged={"api%255fkey":"${canary}",BROKEN}`,
      `api_key: |-\n  ${canary}\nnext: safe`,
      `nested:\n  api%255fkey: >+\n    ${canary}\n  next: safe`,
    ];

    for (const value of values) {
      const serialized = JSON.stringify(redactCredentials(value));
      expect(serialized).toContain("[redacted]");
      expect(serialized).not.toContain(canary);
    }
  });

  it("preserves recursively encoded numeric token telemetry", () => {
    expect(redactCredentials({
      "input%255ftokens": 42,
      "token%255fbudget": 128,
      "api%255fkey": 123,
    })).toEqual({
      "input%255ftokens": 42,
      "token%255fbudget": 128,
      "api%255fkey": "[redacted]",
    });
  });

  it("recursively redacts prefixed nested JSON and damaged escaped fragments", () => {
    const valid =
      'tool failed payload={"outer":"{\\"api_key\\":\\"nested-json-canary\\"}"}';
    const damaged =
      'tool failed payload={"outer":"{\\"api_key\\":\\"damaged-json-canary\\"}",BROKEN}';

    expect(redactCredentialString(valid)).not.toContain("nested-json-canary");
    expect(redactCredentialString(damaged)).not.toContain(
      "damaged-json-canary",
    );
  });

  it("redacts fullwidth Unicode credential keys and separators", () => {
    const values = [
      "api＿key=unicode-key-canary",
      "api_key：unicode-colon-canary",
      "api_key＝unicode-equals-canary",
      "ａｐｉ＿ｋｅｙ=unicode-fullwidth-canary",
      "工具失败：api_key=unicode-inline-canary",
    ];

    for (const value of values) {
      expect(redactCredentialString(value)).not.toMatch(
        /unicode-key-canary|unicode-colon-canary|unicode-equals-canary|unicode-fullwidth-canary|unicode-inline-canary/,
      );
    }
  });
});
