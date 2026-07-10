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
    expect(left).toBe(
      'test_run:{"options":{"a":2,"nested":{"alpha":1,"beta":2},"z":1},"path":"package.json"}',
    );
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
    expect(left).toContain("[REDACTED]");
    expect(left).not.toContain(secretA);
    expect(left).not.toContain(secretB);
    expect(JSON.stringify({ left, right })).not.toContain("sk-live-secret");
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
    expect(signature).toContain("[CIRCULAR]");
    expect(signature).toContain("[UNDEFINED]");
    expect(signature).toContain("[NON_FINITE]");
    expect(signature).not.toContain("getter payload");
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
