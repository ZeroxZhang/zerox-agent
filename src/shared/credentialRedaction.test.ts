import { describe, expect, it } from "vitest";
import {
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
});
