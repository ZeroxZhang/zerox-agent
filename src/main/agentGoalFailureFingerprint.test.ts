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

  it("includes array length and a digest of omitted elements in action identity", () => {
    const left = Array.from({ length: 40 }, (_, index) =>
      index === 32 ? "PRIVATE_TAIL_ALPHA" : `item_${index}`,
    );
    const right = Array.from({ length: 40 }, (_, index) =>
      index === 32 ? "PRIVATE_TAIL_BRAVO" : `item_${index}`,
    );
    const longer = [...left, "item_40"];
    const leftSignature = createToolActionSignature("tail_array", { values: left });
    const rightSignature = createToolActionSignature("tail_array", { values: right });
    const longerSignature = createToolActionSignature("tail_array", { values: longer });

    expect(leftSignature).not.toBe(rightSignature);
    expect(leftSignature).not.toBe(longerSignature);
    expect(`${leftSignature}${rightSignature}${longerSignature}`).not.toMatch(
      /PRIVATE_TAIL_ALPHA|PRIVATE_TAIL_BRAVO/,
    );
  });

  it("includes object key count and a digest of omitted sorted key/value entries", () => {
    const makeObject = (tailValue: string) =>
      Object.fromEntries(
        Array.from({ length: 70 }, (_, index) => [
          `key_${String(index).padStart(3, "0")}`,
          index === 64 ? tailValue : `value_${index}`,
        ]),
      );
    const left = createToolActionSignature("tail_object", makeObject("PRIVATE_KEY_ALPHA"));
    const right = createToolActionSignature("tail_object", makeObject("PRIVATE_KEY_BRAVO"));
    const withExtraKey = createToolActionSignature("tail_object", {
      ...makeObject("PRIVATE_KEY_ALPHA"),
      key_070: "value_70",
    });

    expect(left).not.toBe(right);
    expect(left).not.toBe(withExtraKey);
    expect(`${left}${right}${withExtraKey}`).not.toMatch(
      /PRIVATE_KEY_ALPHA|PRIVATE_KEY_BRAVO/,
    );
  });

  it("digests complete sparse array tails at element 97 and the far end", () => {
    const makeArray = (element97: string, finalElement: string) => {
      const value: string[] = new Array(10_000);
      for (let index = 0; index < 32; index += 1) value[index] = `head_${index}`;
      value[96] = element97;
      value[9_999] = finalElement;
      return value;
    };
    const baseline = createToolActionSignature(
      "complete_array_tail",
      makeArray("PRIVATE_ELEMENT_97_ALPHA", "PRIVATE_FINAL_ALPHA"),
    );
    const changed97 = createToolActionSignature(
      "complete_array_tail",
      makeArray("PRIVATE_ELEMENT_97_BRAVO", "PRIVATE_FINAL_ALPHA"),
    );
    const changedFinal = createToolActionSignature(
      "complete_array_tail",
      makeArray("PRIVATE_ELEMENT_97_ALPHA", "PRIVATE_FINAL_BRAVO"),
    );

    expect(baseline).not.toBe(changed97);
    expect(baseline).not.toBe(changedFinal);
    expect(`${baseline}${changed97}${changedFinal}`).not.toMatch(
      /PRIVATE_ELEMENT_97|PRIVATE_FINAL/,
    );
  });

  it("digests complete object tails at sorted key 129 and the far end", () => {
    const makeObject = (key129: string, finalValue: string) =>
      Object.fromEntries(
        Array.from({ length: 200 }, (_, index) => [
          `key_${String(index).padStart(3, "0")}`,
          index === 128
            ? key129
            : index === 199
              ? finalValue
              : `value_${index}`,
        ]),
      );
    const baseline = createToolActionSignature(
      "complete_object_tail",
      makeObject("PRIVATE_KEY_129_ALPHA", "PRIVATE_KEY_FINAL_ALPHA"),
    );
    const changed129 = createToolActionSignature(
      "complete_object_tail",
      makeObject("PRIVATE_KEY_129_BRAVO", "PRIVATE_KEY_FINAL_ALPHA"),
    );
    const changedFinal = createToolActionSignature(
      "complete_object_tail",
      makeObject("PRIVATE_KEY_129_ALPHA", "PRIVATE_KEY_FINAL_BRAVO"),
    );

    expect(baseline).not.toBe(changed129);
    expect(baseline).not.toBe(changedFinal);
    expect(`${baseline}${changed129}${changedFinal}`).not.toMatch(
      /PRIVATE_KEY_129|PRIVATE_KEY_FINAL/,
    );
  });

  it("resets bounded canonical state for every omitted entry", () => {
    const makeArray = (finalValue: string) =>
      Array.from({ length: 200 }, (_, index) => ({
        level1: {
          level2: {
            level3: index === 199 ? finalValue : `value_${index}`,
          },
        },
      }));
    const leftAction = createToolActionSignature(
      "late_node_budget",
      makeArray("PRIVATE_LATE_ALPHA"),
    );
    const rightAction = createToolActionSignature(
      "late_node_budget",
      makeArray("PRIVATE_LATE_BRAVO"),
    );
    const leftFingerprint = createAcceptanceFailureFingerprint(
      fingerprintInput({ actionSignatures: [leftAction] }),
    );
    const rightFingerprint = createAcceptanceFailureFingerprint(
      fingerprintInput({ actionSignatures: [rightAction] }),
    );

    expect(leftAction).not.toBe(rightAction);
    expect(leftFingerprint).not.toBe(rightFingerprint);
    expect(`${leftAction}${rightAction}`).not.toMatch(/PRIVATE_LATE/);
    expect(
      countConsecutiveFingerprint(
        [failureRecord("milestone", "milestone_1", leftFingerprint)],
        { targetKind: "milestone", targetId: "milestone_1" },
        rightFingerprint,
      ),
    ).toBe(0);
  });

  it("bounds hostile omitted tails while preserving fingerprint occurrence identity", () => {
    const leftTail: unknown[] = Array.from({ length: 100_000 });
    const rightTail: unknown[] = Array.from({ length: 100_000 });
    Object.defineProperty(leftTail, 32, {
      enumerable: true,
      get() {
        throw new Error("PRIVATE_ARRAY_GETTER_ALPHA");
      },
    });
    Object.defineProperty(rightTail, 32, {
      enumerable: true,
      get() {
        throw new Error("PRIVATE_ARRAY_GETTER_BRAVO");
      },
    });
    leftTail[33] = "tail_alpha";
    rightTail[33] = "tail_bravo";

    const objectLeft = Object.fromEntries(
      Array.from({ length: 70 }, (_, index) => [`key_${String(index).padStart(3, "0")}`, index]),
    );
    const objectRight = { ...objectLeft };
    Object.defineProperty(objectLeft, "key_064", {
      enumerable: true,
      get() {
        throw new Error("PRIVATE_OBJECT_GETTER_ALPHA");
      },
    });
    Object.defineProperty(objectRight, "key_064", {
      enumerable: true,
      get() {
        throw new Error("PRIVATE_OBJECT_GETTER_BRAVO");
      },
    });
    objectLeft.key_065 = 1;
    objectRight.key_065 = 2;

    const leftAction = createToolActionSignature("hostile_tail", {
      array: leftTail,
      object: objectLeft,
    });
    const rightAction = createToolActionSignature("hostile_tail", {
      array: rightTail,
      object: objectRight,
    });
    const leftFingerprint = createAcceptanceFailureFingerprint(
      fingerprintInput({ actionSignatures: [leftAction] }),
    );
    const rightFingerprint = createAcceptanceFailureFingerprint(
      fingerprintInput({ actionSignatures: [rightAction] }),
    );

    expect(leftAction).not.toBe(rightAction);
    expect(leftFingerprint).not.toBe(rightFingerprint);
    expect(Buffer.byteLength(leftAction)).toBeLessThanOrEqual(2_048);
    expect(`${leftAction}${rightAction}`).not.toMatch(/PRIVATE_.*GETTER/);
    expect(
      countConsecutiveFingerprint(
        [failureRecord("milestone", "milestone_1", leftFingerprint)],
        { targetKind: "milestone", targetId: "milestone_1" },
        rightFingerprint,
      ),
    ).toBe(0);
  });

  it("isolates a late visible field from an earlier wide object node budget", () => {
    const makeNestedValue = (seed: string): unknown => {
      let value: unknown = seed;
      for (let depth = 0; depth < 10; depth += 1) {
        value = { next: value };
      }
      return value;
    };
    const wideObject = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [
        `field_${String(index).padStart(2, "0")}`,
        makeNestedValue(`shared_${index}`),
      ]),
    );
    const leftAction = createToolActionSignature("wide_visible_object", {
      a: wideObject,
      z: "LATE_VISIBLE_ALPHA",
    });
    const rightAction = createToolActionSignature("wide_visible_object", {
      a: wideObject,
      z: "LATE_VISIBLE_BRAVO",
    });
    const leftFingerprint = createAcceptanceFailureFingerprint(
      fingerprintInput({ actionSignatures: [leftAction] }),
    );
    const rightFingerprint = createAcceptanceFailureFingerprint(
      fingerprintInput({ actionSignatures: [rightAction] }),
    );

    expect(leftAction).not.toBe(rightAction);
    expect(leftFingerprint).not.toBe(rightFingerprint);
    expect(Buffer.byteLength(leftAction)).toBeLessThanOrEqual(2_048);
    expect(Buffer.byteLength(rightAction)).toBeLessThanOrEqual(2_048);
    expect(`${leftAction}${rightAction}`).not.toMatch(/LATE_VISIBLE_(?:ALPHA|BRAVO)/);
    expect(
      countConsecutiveFingerprint(
        [failureRecord("milestone", "milestone_1", leftFingerprint)],
        { targetKind: "milestone", targetId: "milestone_1" },
        rightFingerprint,
      ),
    ).toBe(0);
  });

  it("isolates a late visible field from an earlier wide array node budget", () => {
    const makeNestedValue = (seed: string): unknown => {
      let value: unknown = seed;
      for (let depth = 0; depth < 8; depth += 1) {
        value = { next: value };
      }
      return value;
    };
    const wideArray = Array.from({ length: 32 }, (_, index) =>
      Object.fromEntries(
        Array.from({ length: 8 }, (_, branch) => [
          `branch_${branch}`,
          makeNestedValue(`shared_${index}_${branch}`),
        ]),
      ),
    );
    const leftAction = createToolActionSignature("wide_visible_array", {
      a: wideArray,
      z: "LATE_VISIBLE_ALPHA",
    });
    const rightAction = createToolActionSignature("wide_visible_array", {
      a: wideArray,
      z: "LATE_VISIBLE_BRAVO",
    });

    expect(leftAction).not.toBe(rightAction);
    expect(Buffer.byteLength(leftAction)).toBeLessThanOrEqual(2_048);
    expect(Buffer.byteLength(rightAction)).toBeLessThanOrEqual(2_048);
    expect(`${leftAction}${rightAction}`).not.toMatch(/LATE_VISIBLE_(?:ALPHA|BRAVO)/);
  });

  it("isolates sibling budgets inside an exact nested config object", () => {
    const makeNestedValue = (seed: string): unknown => {
      let value: unknown = seed;
      for (let depth = 0; depth < 10; depth += 1) {
        value = { next: value };
      }
      return value;
    };
    const wide = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [
        `field_${String(index).padStart(2, "0")}`,
        makeNestedValue(`shared_${index}`),
      ]),
    );
    const leftAction = createToolActionSignature("nested_config_object", {
      config: { a: wide, z: "NESTED_CONFIG_ALPHA" },
    });
    const rightAction = createToolActionSignature("nested_config_object", {
      config: { a: wide, z: "NESTED_CONFIG_BRAVO" },
    });
    const leftFingerprint = createAcceptanceFailureFingerprint(
      fingerprintInput({ actionSignatures: [leftAction] }),
    );
    const rightFingerprint = createAcceptanceFailureFingerprint(
      fingerprintInput({ actionSignatures: [rightAction] }),
    );

    expect(leftAction).not.toBe(rightAction);
    expect(leftFingerprint).not.toBe(rightFingerprint);
    expect(Buffer.byteLength(leftAction)).toBeLessThanOrEqual(2_048);
    expect(Buffer.byteLength(rightAction)).toBeLessThanOrEqual(2_048);
    expect(`${leftAction}${rightAction}`).not.toMatch(/NESTED_CONFIG_(?:ALPHA|BRAVO)/);
    expect(
      countConsecutiveFingerprint(
        [failureRecord("milestone", "milestone_1", leftFingerprint)],
        { targetKind: "milestone", targetId: "milestone_1" },
        rightFingerprint,
      ),
    ).toBe(0);
  });

  it("isolates visible elements inside a nested array", () => {
    const makeNestedValue = (seed: string): unknown => {
      let value: unknown = seed;
      for (let depth = 0; depth < 10; depth += 1) {
        value = { next: value };
      }
      return value;
    };
    const wide = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [
        `field_${String(index).padStart(2, "0")}`,
        makeNestedValue(`shared_${index}`),
      ]),
    );
    const leftAction = createToolActionSignature("nested_config_array", {
      config: [wide, "NESTED_ARRAY_ALPHA"],
    });
    const rightAction = createToolActionSignature("nested_config_array", {
      config: [wide, "NESTED_ARRAY_BRAVO"],
    });

    expect(leftAction).not.toBe(rightAction);
    expect(Buffer.byteLength(leftAction)).toBeLessThanOrEqual(2_048);
    expect(Buffer.byteLength(rightAction)).toBeLessThanOrEqual(2_048);
    expect(`${leftAction}${rightAction}`).not.toMatch(/NESTED_ARRAY_(?:ALPHA|BRAVO)/);
  });

  it("keeps nested array-object sibling budgets cycle- and getter-safe", () => {
    const makePayload = (lateValue: string, getterMessage: string) => {
      const makeNestedValue = (seed: string): unknown => {
        let value: unknown = seed;
        for (let depth = 0; depth < 10; depth += 1) {
          value = { next: value };
        }
        return value;
      };
      const entry: Record<string, unknown> = {
        a: Object.fromEntries(
          Array.from({ length: 64 }, (_, index) => [
            `field_${String(index).padStart(2, "0")}`,
            makeNestedValue(`shared_${index}`),
          ]),
        ),
        z: lateValue,
      };
      entry.self = entry;
      Object.defineProperty(entry, "broken", {
        enumerable: true,
        get() {
          throw new Error(getterMessage);
        },
      });
      return { config: [entry] };
    };

    const leftAction = createToolActionSignature(
      "nested_array_object",
      makePayload("NESTED_HOSTILE_ALPHA", "PRIVATE_NESTED_GETTER_ALPHA"),
    );
    const rightAction = createToolActionSignature(
      "nested_array_object",
      makePayload("NESTED_HOSTILE_BRAVO", "PRIVATE_NESTED_GETTER_BRAVO"),
    );

    expect(leftAction).not.toBe(rightAction);
    expect(Buffer.byteLength(leftAction)).toBeLessThanOrEqual(2_048);
    expect(Buffer.byteLength(rightAction)).toBeLessThanOrEqual(2_048);
    expect(`${leftAction}${rightAction}`).not.toMatch(
      /NESTED_HOSTILE_(?:ALPHA|BRAVO)|PRIVATE_NESTED_GETTER/,
    );
  });

  it("sweeps nested sibling isolation across alternating object and array depths", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 64 }, (_, branch) => [
        `branch_${String(branch).padStart(2, "0")}`,
        Object.fromEntries(
          Array.from({ length: 64 }, (_, leaf) => [
            `leaf_${String(leaf).padStart(2, "0")}`,
            `shared_${branch}_${leaf}`,
          ]),
        ),
      ]),
    );
    const wrapToDepth = (value: unknown, depth: number): unknown => {
      let wrapped = value;
      for (let level = 0; level < depth; level += 1) {
        wrapped = level % 2 === 0 ? [wrapped] : { layer: wrapped };
      }
      return wrapped;
    };

    for (let depth = 1; depth <= 14; depth += 1) {
      const leftAction = createToolActionSignature(
        "nested_depth_sweep",
        wrapToDepth(
          { a: wide, z: `DEPTH_SWEEP_ALPHA_${depth}` },
          depth,
        ),
      );
      const rightAction = createToolActionSignature(
        "nested_depth_sweep",
        wrapToDepth(
          { a: wide, z: `DEPTH_SWEEP_BRAVO_${depth}` },
          depth,
        ),
      );

      expect(leftAction, `depth ${depth}`).not.toBe(rightAction);
      expect(Buffer.byteLength(leftAction), `left depth ${depth}`).toBeLessThanOrEqual(2_048);
      expect(Buffer.byteLength(rightAction), `right depth ${depth}`).toBeLessThanOrEqual(2_048);
      expect(`${leftAction}${rightAction}`, `raw depth ${depth}`).not.toMatch(
        /DEPTH_SWEEP_(?:ALPHA|BRAVO)/,
      );
    }
  });

  it("digests a mixed action graph difference at the depth-16 boundary", () => {
    const makeDeepGraph = (lateValue: string): unknown => {
      let graph: unknown = { late: lateValue };
      for (let depth = 0; depth < 16; depth += 1) {
        graph = depth % 2 === 0 ? [graph] : { next: graph };
      }
      return graph;
    };
    const leftAction = createToolActionSignature(
      "depth_boundary",
      makeDeepGraph("DEEP_BOUNDARY_ALPHA"),
    );
    const rightAction = createToolActionSignature(
      "depth_boundary",
      makeDeepGraph("DEEP_BOUNDARY_BRAVO"),
    );

    expect(leftAction).not.toBe(rightAction);
    expect(Buffer.byteLength(leftAction)).toBeLessThanOrEqual(2_048);
    expect(Buffer.byteLength(rightAction)).toBeLessThanOrEqual(2_048);
    expect(`${leftAction}${rightAction}`).not.toMatch(/DEEP_BOUNDARY_(?:ALPHA|BRAVO)/);
  });

  it("digests late mixed-graph differences at depths 15, 16, 32, and 1000", () => {
    for (const depth of [15, 16, 32, 1_000]) {
      const leftAction = createToolActionSignature(
        "deep_graph_matrix",
        wrapMixedGraph(
          { late: `https://depth-${depth}-alpha.invalid/private` },
          depth,
        ),
      );
      const rightAction = createToolActionSignature(
        "deep_graph_matrix",
        wrapMixedGraph(
          { late: `https://depth-${depth}-bravo.invalid/private` },
          depth,
        ),
      );

      expect(leftAction, `depth ${depth}`).not.toBe(rightAction);
      expect(leftAction, `marker depth ${depth}`).toContain("deep_digest");
      expect(Buffer.byteLength(leftAction), `left depth ${depth}`).toBeLessThanOrEqual(2_048);
      expect(Buffer.byteLength(rightAction), `right depth ${depth}`).toBeLessThanOrEqual(2_048);
      expect(`${leftAction}${rightAction}`, `raw depth ${depth}`).not.toMatch(
        /depth-\d+-(?:alpha|bravo)\.invalid/,
      );
    }
  });

  it("digests deep differences in visible entries and complete sparse tails", () => {
    const visibleLeft = createToolActionSignature("deep_visible", {
      value: wrapMixedGraph(
        { late: "https://visible-alpha.invalid/private" },
        32,
      ),
    });
    const visibleRight = createToolActionSignature("deep_visible", {
      value: wrapMixedGraph(
        { late: "https://visible-bravo.invalid/private" },
        32,
      ),
    });
    const makeObjectTail = (lateValue: string) =>
      Object.fromEntries(
        Array.from({ length: 65 }, (_, index) => [
          `key_${String(index).padStart(3, "0")}`,
          index === 64
            ? wrapMixedGraph({ late: lateValue }, 32)
            : index,
        ]),
      );
    const objectTailLeft = createToolActionSignature(
      "deep_object_tail",
      makeObjectTail("https://object-tail-alpha.invalid/private"),
    );
    const objectTailRight = createToolActionSignature(
      "deep_object_tail",
      makeObjectTail("https://object-tail-bravo.invalid/private"),
    );
    const makeArrayTail = (lateValue: string) => {
      const value: unknown[] = [];
      value.length = 100_000;
      value[97] = wrapMixedGraph({ late: lateValue }, 32);
      return value;
    };
    const arrayTailLeft = createToolActionSignature(
      "deep_array_tail",
      makeArrayTail("https://array-tail-alpha.invalid/private"),
    );
    const arrayTailRight = createToolActionSignature(
      "deep_array_tail",
      makeArrayTail("https://array-tail-bravo.invalid/private"),
    );
    const signatures = [
      visibleLeft,
      visibleRight,
      objectTailLeft,
      objectTailRight,
      arrayTailLeft,
      arrayTailRight,
    ];

    expect(visibleLeft).not.toBe(visibleRight);
    expect(objectTailLeft).not.toBe(objectTailRight);
    expect(arrayTailLeft).not.toBe(arrayTailRight);
    expect(signatures.every((signature) => Buffer.byteLength(signature) <= 2_048)).toBe(true);
    expect(signatures.join("")).not.toMatch(
      /(?:visible|object-tail|array-tail)-(?:alpha|bravo)\.invalid/,
    );
  });

  it("keeps deep digests stable across equivalent object key insertion order", () => {
    const leftBoundary = {
      z: { beta: 2, alpha: 1 },
      a: [3, 2, 1],
    };
    const rightBoundary = {
      a: [3, 2, 1],
      z: { alpha: 1, beta: 2 },
    };

    expect(
      createToolActionSignature(
        "deep_key_order",
        wrapMixedGraph(leftBoundary, 16),
      ),
    ).toBe(
      createToolActionSignature(
        "deep_key_order",
        wrapMixedGraph(rightBoundary, 16),
      ),
    );
  });

  it("frames shared references and cycles deterministically in deep digests", () => {
    const makeBoundary = (lateValue: string, shareNode: boolean) => {
      const first = { late: lateValue };
      const boundary: Record<string, unknown> = {
        first,
        second: shareNode ? first : { late: lateValue },
      };
      boundary.self = boundary;
      return boundary;
    };
    const baseline = createToolActionSignature(
      "deep_graph_refs",
      wrapMixedGraph(
        makeBoundary("https://shared-alpha.invalid/private", true),
        16,
      ),
    );
    const equivalent = createToolActionSignature(
      "deep_graph_refs",
      wrapMixedGraph(
        makeBoundary("https://shared-alpha.invalid/private", true),
        16,
      ),
    );
    const changed = createToolActionSignature(
      "deep_graph_refs",
      wrapMixedGraph(
        makeBoundary("https://shared-bravo.invalid/private", true),
        16,
      ),
    );
    const duplicated = createToolActionSignature(
      "deep_graph_refs",
      wrapMixedGraph(
        makeBoundary("https://shared-alpha.invalid/private", false),
        16,
      ),
    );

    expect(baseline).toBe(equivalent);
    expect(baseline).not.toBe(changed);
    expect(baseline).not.toBe(duplicated);
    expect(`${baseline}${equivalent}${changed}${duplicated}`).not.toMatch(
      /shared-(?:alpha|bravo)\.invalid/,
    );
  });

  it("redacts deep secret keys and safely frames hostile getters", () => {
    let secretReads = 0;
    const makeBoundary = (secretValue: string, getterMessage: string) => {
      const boundary: Record<string, unknown> = { password: secretValue };
      Object.defineProperty(boundary, "apiKey", {
        enumerable: true,
        get() {
          secretReads += 1;
          throw new Error(`SECRET_GETTER_${getterMessage}`);
        },
      });
      Object.defineProperty(boundary, "broken", {
        enumerable: true,
        get() {
          throw new Error(`PRIVATE_DEEP_GETTER_${getterMessage}`);
        },
      });
      return boundary;
    };
    const left = createToolActionSignature(
      "deep_hostile",
      wrapMixedGraph(makeBoundary("DEEP_SECRET_ALPHA", "ALPHA"), 16),
    );
    const right = createToolActionSignature(
      "deep_hostile",
      wrapMixedGraph(makeBoundary("DEEP_SECRET_BRAVO", "BRAVO"), 16),
    );
    const spoof = createToolActionSignature(
      "deep_hostile",
      wrapMixedGraph(
        {
          apiKey: "DEEP_SECRET_CHARLIE",
          broken: "[UNREADABLE]",
          password: "DEEP_SECRET_DELTA",
        },
        16,
      ),
    );

    expect(left).toBe(right);
    expect(left).not.toBe(spoof);
    expect(secretReads).toBe(0);
    expect(Buffer.byteLength(left)).toBeLessThanOrEqual(2_048);
    expect(`${left}${right}${spoof}`).not.toMatch(
      /DEEP_SECRET|SECRET_GETTER|PRIVATE_DEEP_GETTER/,
    );
  });

  it("bounds an infinite fresh-next getter graph deterministically", () => {
    const makeFreshChain = () => {
      let getterReads = 0;
      const makeNode = (): Record<string, unknown> => {
        const node: Record<string, unknown> = {};
        Object.defineProperty(node, "next", {
          enumerable: true,
          get() {
            getterReads += 1;
            if (getterReads > 10_000) {
              throw new Error("PRIVATE_INFINITE_GETTER_TEST_FUSE");
            }
            return makeNode();
          },
        });
        return node;
      };
      return { root: makeNode(), getReads: () => getterReads };
    };
    const leftGraph = makeFreshChain();
    const rightGraph = makeFreshChain();
    const startedAt = Date.now();
    const left = createToolActionSignature(
      "deep_infinite_getter",
      wrapMixedGraph(leftGraph.root, 16),
    );
    const right = createToolActionSignature(
      "deep_infinite_getter",
      wrapMixedGraph(rightGraph.root, 16),
    );

    expect(left).toBe(right);
    expect(left).toContain("truncated");
    expect(leftGraph.getReads()).toBeLessThanOrEqual(8_192);
    expect(rightGraph.getReads()).toBeLessThanOrEqual(8_192);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(Buffer.byteLength(left)).toBeLessThanOrEqual(2_048);
    expect(`${left}${right}`).not.toContain("PRIVATE_INFINITE_GETTER_TEST_FUSE");
  });

  it("bounds a lazy finite 250k-node deep graph", () => {
    let getterReads = 0;
    const makeNode = (index: number): Record<string, unknown> => {
      const node: Record<string, unknown> = {};
      Object.defineProperty(node, "next", {
        enumerable: true,
        get() {
          getterReads += 1;
          return index + 1 < 250_000 ? makeNode(index + 1) : null;
        },
      });
      return node;
    };
    const signature = createToolActionSignature(
      "deep_finite_generator",
      wrapMixedGraph(makeNode(0), 16),
    );

    expect(getterReads).toBeLessThanOrEqual(8_192);
    expect(signature).toContain("truncated");
    expect(Buffer.byteLength(signature)).toBeLessThanOrEqual(2_048);
  });

  it("sorts shallow array tail keys numeric-then-lexical", () => {
    const makeArray = (namedOrder: string[]) => {
      const value: unknown[] & Record<string, unknown> = [];
      value.length = 100;
      value[97] = "late";
      value[33] = "early";
      for (const key of namedOrder) {
        value[key] = key === "alpha" ? 1 : 2;
      }
      return value;
    };
    const left = createToolActionSignature(
      "ordered_array_tail",
      makeArray(["zeta", "alpha"]),
    );
    const right = createToolActionSignature(
      "ordered_array_tail",
      makeArray(["alpha", "zeta"]),
    );

    expect(left).toBe(right);
    expect(Buffer.byteLength(left)).toBeLessThanOrEqual(2_048);
  });

  it("includes nonenumerable numeric own array indices in deep digests only", () => {
    const makeArray = (numericValue: unknown, hiddenValue: string, symbolValue: string) => {
      const value: unknown[] & Record<string | symbol, unknown> = [];
      value.length = 128;
      Object.defineProperty(value, "97", {
        configurable: true,
        enumerable: false,
        value: numericValue,
      });
      Object.defineProperty(value, "hidden", {
        configurable: true,
        enumerable: false,
        value: hiddenValue,
      });
      value[Symbol("ignored")] = symbolValue;
      return value;
    };
    const numericLeft = createToolActionSignature(
      "deep_numeric_own_index",
      wrapMixedGraph(
        makeArray(
          "https://numeric-own-alpha.invalid/private",
          "HIDDEN_ALPHA",
          "SYMBOL_ALPHA",
        ),
        16,
      ),
    );
    const numericRight = createToolActionSignature(
      "deep_numeric_own_index",
      wrapMixedGraph(
        makeArray(
          "https://numeric-own-bravo.invalid/private",
          "HIDDEN_BRAVO",
          "SYMBOL_BRAVO",
        ),
        16,
      ),
    );
    const stableNumericLeft = createToolActionSignature(
      "deep_numeric_hidden",
      wrapMixedGraph(makeArray(7, "HIDDEN_ALPHA", "SYMBOL_ALPHA"), 16),
    );
    const stableNumericRight = createToolActionSignature(
      "deep_numeric_hidden",
      wrapMixedGraph(makeArray(7, "HIDDEN_BRAVO", "SYMBOL_BRAVO"), 16),
    );
    const getterArray: unknown[] = [];
    getterArray.length = 128;
    Object.defineProperty(getterArray, "97", {
      enumerable: false,
      get() {
        throw new Error("PRIVATE_NUMERIC_GETTER_ALPHA");
      },
    });
    const equivalentGetterArray: unknown[] = [];
    equivalentGetterArray.length = 128;
    Object.defineProperty(equivalentGetterArray, "97", {
      enumerable: false,
      get() {
        throw new Error("PRIVATE_NUMERIC_GETTER_BRAVO");
      },
    });
    const holeArray: unknown[] = [];
    holeArray.length = 128;
    const getterSignature = createToolActionSignature(
      "deep_numeric_getter",
      wrapMixedGraph(getterArray, 16),
    );
    const equivalentGetterSignature = createToolActionSignature(
      "deep_numeric_getter",
      wrapMixedGraph(equivalentGetterArray, 16),
    );
    const holeSignature = createToolActionSignature(
      "deep_numeric_getter",
      wrapMixedGraph(holeArray, 16),
    );

    expect(numericLeft).not.toBe(numericRight);
    expect(stableNumericLeft).toBe(stableNumericRight);
    expect(getterSignature).toBe(equivalentGetterSignature);
    expect(getterSignature).not.toBe(holeSignature);
    expect(
      [numericLeft, numericRight, getterSignature].every(
        (signature) => Buffer.byteLength(signature) <= 2_048,
      ),
    ).toBe(true);
    expect(`${numericLeft}${numericRight}${getterSignature}`).not.toMatch(
      /numeric-own-(?:alpha|bravo)\.invalid|PRIVATE_NUMERIC_GETTER|HIDDEN_|SYMBOL_/,
    );
  });

  it("bounds deep key and string hash frames without leaking raw values", () => {
    const hugeKey = `PRIVATE_DEEP_KEY_${"k".repeat(50_000)}`;
    const left = createToolActionSignature(
      "deep_large_frames",
      wrapMixedGraph({ [hugeKey]: `PRIVATE_ALPHA_${"a".repeat(50_000)}` }, 16),
    );
    const repeated = createToolActionSignature(
      "deep_large_frames",
      wrapMixedGraph({ [hugeKey]: `PRIVATE_ALPHA_${"a".repeat(50_000)}` }, 16),
    );
    const changed = createToolActionSignature(
      "deep_large_frames",
      wrapMixedGraph({ [hugeKey]: `PRIVATE_BRAVO_${"b".repeat(50_000)}` }, 16),
    );

    expect(left).toBe(repeated);
    expect(left).not.toBe(changed);
    expect(Buffer.byteLength(left)).toBeLessThanOrEqual(2_048);
    expect(`${left}${repeated}${changed}`).not.toMatch(/PRIVATE_(?:DEEP_KEY|ALPHA|BRAVO)/);
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

function wrapMixedGraph(value: unknown, depth: number): unknown {
  let graph = value;
  for (let level = 0; level < depth; level += 1) {
    graph = level % 2 === 0 ? [graph] : { next: graph };
  }
  return graph;
}
