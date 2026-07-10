import { describe, expect, it } from "vitest";
import type {
  GoalAcceptanceCheckResult,
  GoalAcceptanceFailureRecord,
  GoalEvidenceManifest,
} from "../shared/agentGoal";
import {
  countConsecutiveFingerprint,
  createAcceptanceFailureFingerprint,
  createToolActionSignature,
} from "./agentGoalFailureFingerprint";

const failedCheck = (
  overrides: Partial<GoalAcceptanceCheckResult> = {},
): GoalAcceptanceCheckResult => ({
  checkId: "check_tests",
  kind: "test_passes",
  passed: false,
  code: "test_exit_nonzero",
  failureClass: "test_failed",
  evidenceRefs: ["artifact:reports/test.json"],
  detail: "free-form failure wording",
  ...overrides,
});

const manifest = (
  overrides: Partial<GoalEvidenceManifest> = {},
): GoalEvidenceManifest => ({
  version: 1,
  generatedAt: "2026-07-11T00:00:00.000Z",
  totalRenderedChars: 100,
  truncated: false,
  artifacts: [
    {
      ref: "artifact:reports/test.json",
      path: "reports/test.json",
      mediaType: "application/json",
      sha256: "a".repeat(64),
      modifiedAt: "2026-07-11T00:00:00.000Z",
      excerpts: [{ label: "result", text: "failed prose" }],
    },
  ],
  ...overrides,
});

const fingerprintInput = (overrides: Record<string, unknown> = {}) => ({
  target: { targetKind: "milestone" as const, targetId: "milestone_1" },
  failedChecks: [failedCheck()],
  evidenceManifest: manifest(),
  evidenceRefs: ["run:run_1"],
  actionSignatures: [
    createToolActionSignature("test_run", {
      path: "package.json",
      options: { z: 1, a: 2 },
    }),
  ],
  protocolVersion: 2,
  validatorVersions: { test_passes: "builtin-v2" },
  ...overrides,
});

describe("goal acceptance failure fingerprints", () => {
  it("sorts nested object keys recursively in tool action signatures", () => {
    const left = createToolActionSignature("test_run", {
      path: "package.json",
      options: { z: 1, nested: { beta: 2, alpha: 1 }, a: 2 },
    });
    const right = createToolActionSignature("test_run", {
      options: { a: 2, nested: { alpha: 1, beta: 2 }, z: 1 },
      path: "package.json",
    });

    expect(left).toBe(right);
    expect(left).toMatch(/^test_run:/);
    expect(left.indexOf("alpha")).toBeLessThan(left.indexOf("beta"));
    expect(left.indexOf("nested")).toBeLessThan(left.indexOf("z"));
    expect(left.indexOf("options")).toBeLessThan(left.indexOf("path"));
  });

  it("preserves dangerous own keys as sorted data without prototype setter effects", () => {
    const left = JSON.parse(
      '{"prototype":"proto","z":1,"__proto__":{"value":"left"},"constructor":"ctor","a":2}',
    );
    const reordered = JSON.parse(
      '{"a":2,"constructor":"ctor","__proto__":{"value":"left"},"z":1,"prototype":"proto"}',
    );
    const changed = JSON.parse(
      '{"prototype":"proto","z":1,"__proto__":{"value":"right"},"constructor":"ctor","a":2}',
    );

    const signature = createToolActionSignature("unsafe_keys", left);
    expect(signature).toBe(createToolActionSignature("unsafe_keys", reordered));
    expect(signature).not.toBe(createToolActionSignature("unsafe_keys", changed));
    expect(signature).toContain("__proto__");
    expect(signature.indexOf("__proto__")).toBeLessThan(signature.indexOf("constructor"));
    expect(signature.indexOf("constructor")).toBeLessThan(signature.indexOf("prototype"));
  });

  it("excludes prose, timestamps, plan versions, counters, and retry wording", () => {
    const left = fingerprintInput({
      failedChecks: [failedCheck({ detail: "first wording" })],
      evidenceManifest: manifest({ generatedAt: "2026-01-01T00:00:00.000Z" }),
      timestamp: "2026-01-01T00:00:00.000Z",
      planVersion: 1,
      retryCount: 1,
      retryWording: "try once",
      modelProse: "first model answer",
    });
    const right = fingerprintInput({
      failedChecks: [failedCheck({ detail: "cosmetically different wording" })],
      evidenceManifest: manifest({ generatedAt: "2027-02-02T00:00:00.000Z" }),
      timestamp: "2027-02-02T00:00:00.000Z",
      planVersion: 99,
      retryCount: 12,
      retryWording: "please try again",
      modelProse: "other model answer",
    });

    expect(createAcceptanceFailureFingerprint(left)).toBe(
      createAcceptanceFailureFingerprint(right),
    );
  });

  it.each([
    ["check code", { failedChecks: [failedCheck({ code: "assertion_false" })] }],
    [
      "failure class",
      { failedChecks: [failedCheck({ failureClass: "assertion_failed" })] },
    ],
    [
      "artifact hash",
      {
        evidenceManifest: manifest({
          artifacts: [
            {
              ...manifest().artifacts[0]!,
              sha256: "b".repeat(64),
            },
          ],
        }),
      },
    ],
    [
      "protocol version",
      { protocolVersion: 1 },
    ],
    [
      "validator version",
      { validatorVersions: { test_passes: "builtin-v3" } },
    ],
    [
      "action signature",
      { actionSignatures: [createToolActionSignature("test_run", { mode: "watch" })] },
    ],
  ])("changes when the meaningful %s changes", (_label, override) => {
    expect(createAcceptanceFailureFingerprint(fingerprintInput())).not.toBe(
      createAcceptanceFailureFingerprint(fingerprintInput(override)),
    );
  });

  it("treats evidence, failed checks, and recent action signatures as sorted sets", () => {
    const checkA = failedCheck({
      checkId: "a",
      kind: "assertion",
      code: "assertion_false",
      failureClass: "assertion_failed",
      evidenceRefs: ["evidence:z", "evidence:a"],
    });
    const checkB = failedCheck({
      checkId: "b",
      evidenceRefs: ["evidence:b"],
    });
    const actionA = createToolActionSignature("file_read", { path: "a" });
    const actionB = createToolActionSignature("test_run", { path: "b" });
    const left = fingerprintInput({
      failedChecks: [checkB, checkA],
      evidenceRefs: ["run:z", "run:a"],
      actionSignatures: [actionB, actionA],
    });
    const right = fingerprintInput({
      failedChecks: [checkA, checkB],
      evidenceRefs: ["run:a", "run:z"],
      actionSignatures: [actionA, actionB],
    });

    expect(createAcceptanceFailureFingerprint(left)).toBe(
      createAcceptanceFailureFingerprint(right),
    );
  });

  it("redacts secret-like values before signing and never leaks them", () => {
    const secretA = "sk-live-secret-alpha";
    const secretB = "sk-live-secret-beta";
    const left = createToolActionSignature("web_fetch", {
      apiKey: secretA,
      nested: {
        authorization: `Bearer ${secretA}`,
        cookie: secretA,
        password: secretA,
      },
      headers: [{ bearerToken: secretA }],
    });
    const right = createToolActionSignature("web_fetch", {
      apiKey: secretB,
      nested: {
        authorization: `Bearer ${secretB}`,
        cookie: secretB,
        password: secretB,
      },
      headers: [{ bearerToken: secretB }],
    });

    expect(left).toBe(right);
    expect(left).toContain("redacted");
    expect(left).not.toContain(secretA);
    expect(left).not.toContain(secretB);
    expect(JSON.stringify({ left, right })).not.toContain("sk-live-secret");
  });

  it("redacts hostile content, commands, URLs, query credentials, and bearer tokens", () => {
    const privateContent = "PRIVATE_REPORT_CONTENT".repeat(2_000);
    const shellCommand = "curl -H 'Authorization: Bearer shell-token' https://secret.invalid/run?api_key=query-secret";
    const hostileUrl = "https://user:password@secret.invalid/report?access_token=url-secret&safe=1";
    const signatures = [
      createToolActionSignature("file_write", {
        path: "report.md",
        content: privateContent,
      }),
      createToolActionSignature("shell_exec", {
        command: shellCommand,
        cwd: "/workspace",
      }),
      createToolActionSignature("web_fetch", {
        url: hostileUrl,
        headers: { accept: "application/json", custom: "Bearer header-token" },
      }),
    ];
    const serialized = JSON.stringify(signatures);

    expect(signatures.every((signature) => Buffer.byteLength(signature) <= 2_048)).toBe(true);
    expect(serialized).toContain("redacted");
    expect(serialized).not.toContain("PRIVATE_REPORT_CONTENT");
    expect(serialized).not.toContain("curl -H");
    expect(serialized).not.toContain("secret.invalid");
    expect(serialized).not.toContain("query-secret");
    expect(serialized).not.toContain("shell-token");
    expect(serialized).not.toContain("header-token");
    expect(serialized).not.toContain("url-secret");
  });

  it("keeps private values differentiated by bounded digests without persisting raw text", () => {
    const left = createToolActionSignature("file_write", {
      path: "report.md",
      content: "first private body",
      callbackUrl: "https://first.invalid/hook?token=first-token",
      command: "echo first-private-command",
    });
    const right = createToolActionSignature("file_write", {
      command: "echo second-private-command",
      callbackUrl: "https://second.invalid/hook?token=second-token",
      content: "second private body",
      path: "report.md",
    });

    expect(left).not.toBe(right);
    expect(left).toContain("private_digest");
    expect(right).toContain("private_digest");
    expect(`${left}${right}`).not.toMatch(
      /first private body|second private body|echo first|echo second|first\.invalid|second\.invalid/,
    );
  });

  it("differentiates large contents and commands using only digest markers", () => {
    const contentA = `PRIVATE_ALPHA_${"a".repeat(20_000)}`;
    const contentB = `PRIVATE_BRAVO_${"b".repeat(20_000)}`;
    const writeA = createToolActionSignature("file_write", {
      path: "report.md",
      content: contentA,
    });
    const writeB = createToolActionSignature("file_write", {
      path: "report.md",
      content: contentB,
    });
    const shellA = createToolActionSignature("shell_exec", {
      command: "npm test -- alpha-private-suite",
    });
    const shellB = createToolActionSignature("shell_exec", {
      command: "npm test -- bravo-private-suite",
    });

    expect(writeA).not.toBe(writeB);
    expect(shellA).not.toBe(shellB);
    expect(`${writeA}${writeB}${shellA}${shellB}`).not.toMatch(
      /PRIVATE_ALPHA|PRIVATE_BRAVO|alpha-private-suite|bravo-private-suite/,
    );
    expect([writeA, writeB, shellA, shellB].every((value) => value.includes("private_digest"))).toBe(true);
  });

  it("does not let URL credential changes alter the scrubbed private digest", () => {
    const left = createToolActionSignature("web_fetch", {
      url: "https://user:first-password@example.test/report?api_key=first-key",
    });
    const right = createToolActionSignature("web_fetch", {
      url: "https://user:other-password@example.test/report?api_key=other-key",
    });

    expect(left).toBe(right);
    expect(`${left}${right}`).not.toMatch(/first|other|api_key/);
  });

  it("handles undefined, non-finite numbers, sparse arrays, bigint, getters, and cycles safely", () => {
    const cyclic: Record<string, unknown> = {
      missing: undefined,
      values: [Number.NaN, Number.POSITIVE_INFINITY, , 1n],
    };
    cyclic.self = cyclic;
    Object.defineProperty(cyclic, "broken", {
      enumerable: true,
      get() {
        throw new Error("getter payload must not escape");
      },
    });

    expect(() => createToolActionSignature("unsafe_tool", cyclic)).not.toThrow();
    const signature = createToolActionSignature("unsafe_tool", cyclic);
    expect(signature).toContain("circular");
    expect(signature).toContain("undefined");
    expect(signature).toContain("nan");
    expect(signature).not.toContain("getter payload");
  });

  it("keeps exceptional values distinct from spoofing literal strings", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const unreadable: Record<string, unknown> = {};
    Object.defineProperty(unreadable, "value", {
      enumerable: true,
      get() {
        throw new Error("private getter failure");
      },
    });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    const collisionPairs: Array<[string, unknown, unknown]> = [
      ["undefined", undefined, "[UNDEFINED]"],
      ["cycle", cyclic, { self: "[CIRCULAR]" }],
      ["NaN", Number.NaN, "[NON_FINITE]"],
      ["positive infinity", Number.POSITIVE_INFINITY, "[NON_FINITE]"],
      ["negative infinity", Number.NEGATIVE_INFINITY, "[NON_FINITE]"],
      ["unreadable property", unreadable, { value: "[UNREADABLE]" }],
      ["function", () => undefined, "[FUNCTION]"],
      ["symbol", Symbol("private symbol description"), "[SYMBOL]"],
      ["bigint", 17n, "[BIGINT:17]"],
      ["unserializable value", revoked.proxy, "[UNSERIALIZABLE]"],
    ];

    for (const [label, exceptional, spoof] of collisionPairs) {
      expect(
        createToolActionSignature("collision", exceptional),
        `${label} must not collide with a user string/object`,
      ).not.toBe(createToolActionSignature("collision", spoof));
    }
  });

  it("distinguishes non-finite number classes from one another", () => {
    const signatures = [
      createToolActionSignature("number", Number.NaN),
      createToolActionSignature("number", Number.POSITIVE_INFINITY),
      createToolActionSignature("number", Number.NEGATIVE_INFINITY),
    ];

    expect(new Set(signatures)).toHaveLength(3);
  });

  it("counts consecutive matching fingerprints within one target and resets on change", () => {
    const history: GoalAcceptanceFailureRecord[] = [
      failureRecord("milestone", "m1", "old"),
      failureRecord("milestone", "m1", "same"),
      failureRecord("goal", "goal_1", "same"),
      failureRecord("milestone", "m1", "same"),
    ];

    expect(
      countConsecutiveFingerprint(
        history,
        { targetKind: "milestone", targetId: "m1" },
        "same",
      ),
    ).toBe(2);
    expect(
      countConsecutiveFingerprint(
        [...history, failureRecord("milestone", "m1", "changed")],
        { targetKind: "milestone", targetId: "m1" },
        "same",
      ),
    ).toBe(0);
    expect(
      countConsecutiveFingerprint(
        history,
        { targetKind: "goal", targetId: "goal_1" },
        "same",
      ),
    ).toBe(1);
  });
});

function failureRecord(
  targetKind: "milestone" | "goal",
  targetId: string,
  fingerprint: string,
): GoalAcceptanceFailureRecord {
  return {
    at: "2026-07-11T00:00:00.000Z",
    targetKind,
    targetId,
    fingerprint,
    occurrence: 1,
    verdict: "rejected_repairable",
    failureClass: "test_failed",
    failedCheckIds: ["check_tests"],
    evidenceRefs: [],
    actionSignatures: [],
  };
}
