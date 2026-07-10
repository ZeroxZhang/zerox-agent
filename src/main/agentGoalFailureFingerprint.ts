import { createHash } from "node:crypto";
import type {
  GoalAcceptanceCheckResult,
  GoalAcceptanceFailureRecord,
  GoalEvidenceManifest,
} from "../shared/agentGoal";

const UNREADABLE_MARKER = "[UNREADABLE]";

type CanonicalValue =
  | ["null"]
  | ["string", string]
  | ["boolean", boolean]
  | ["number", number]
  | ["non_finite", "nan" | "positive_infinity" | "negative_infinity"]
  | ["undefined"]
  | ["bigint", string]
  | ["symbol"]
  | ["function"]
  | ["circular"]
  | ["unreadable"]
  | ["unserializable"]
  | ["redacted"]
  | ["array_hole"]
  | ["array", CanonicalValue[]]
  | ["object", Array<[string, CanonicalValue]>];

export type AcceptanceFailureTarget = Pick<
  GoalAcceptanceFailureRecord,
  "targetKind" | "targetId"
>;

export type AcceptanceFailureFingerprintInput = {
  target: AcceptanceFailureTarget;
  failedChecks: GoalAcceptanceCheckResult[];
  evidenceManifest?: GoalEvidenceManifest;
  evidenceRefs?: string[];
  artifactHashes?: string[];
  actionSignatures?: string[];
  protocolVersion: number;
  validatorVersions: Record<string, string | number>;
};

export function createAcceptanceFailureFingerprint(
  input: AcceptanceFailureFingerprintInput,
): string {
  let identity: unknown;
  try {
    const failedChecks = safeArray(input.failedChecks)
      .filter((result) => result?.passed === false)
      .map((result) => ({
        checkId: safeString(result.checkId),
        kind: normalizeMachineValue(result.kind),
        failureClass: normalizeMachineValue(result.failureClass ?? "unknown"),
        code: normalizeMachineValue(result.code),
      }));
    const checkEvidenceRefs = safeArray(input.failedChecks).flatMap((result) =>
      safeArray(result?.evidenceRefs).map(safeString),
    );
    const manifestArtifacts = safeArray(input.evidenceManifest?.artifacts);

    identity = {
      target: {
        kind: input.target.targetKind,
        id: input.target.targetId,
      },
      failedChecks: sortedCanonicalSet(failedChecks),
      evidenceRefs: sortedStringSet([
        ...safeArray(input.evidenceRefs).map(safeString),
        ...checkEvidenceRefs,
        ...manifestArtifacts.map((artifact) => safeString(artifact?.ref)),
      ]),
      artifactHashes: sortedStringSet([
        ...safeArray(input.artifactHashes).map(safeString),
        ...manifestArtifacts.flatMap((artifact) =>
          artifact?.sha256 ? [safeString(artifact.sha256)] : [],
        ),
      ]),
      actionSignatures: sortedStringSet(
        safeArray(input.actionSignatures).map(safeString),
      ),
      protocolVersion: input.protocolVersion,
      validatorVersions: input.validatorVersions,
    };
  } catch {
    identity = { malformedInput: UNREADABLE_MARKER };
  }

  return createHash("sha256").update(canonicalJson(identity)).digest("hex");
}

export function createToolActionSignature(
  toolName: string,
  args: unknown,
): string {
  return `${safeString(toolName)}:${canonicalJson(args)}`;
}

export function countConsecutiveFingerprint(
  history: GoalAcceptanceFailureRecord[],
  target: AcceptanceFailureTarget,
  fingerprint: string,
): number {
  let count = 0;
  const records = safeArray(history);

  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (
      record?.targetKind !== target.targetKind ||
      record.targetId !== target.targetId
    ) {
      continue;
    }
    if (record.fingerprint !== fingerprint) {
      break;
    }
    count += 1;
  }

  return count;
}

function canonicalJson(value: unknown): string {
  try {
    return JSON.stringify(canonicalize(value, new WeakSet<object>()));
  } catch {
    return JSON.stringify(special("unserializable"));
  }
}

function canonicalize(value: unknown, ancestors: WeakSet<object>): CanonicalValue {
  if (value === null) {
    return ["null"];
  }
  if (typeof value === "string") {
    return ["string", value];
  }
  if (typeof value === "boolean") {
    return ["boolean", value];
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      return ["non_finite", "nan"];
    }
    if (value === Number.POSITIVE_INFINITY) {
      return ["non_finite", "positive_infinity"];
    }
    if (value === Number.NEGATIVE_INFINITY) {
      return ["non_finite", "negative_infinity"];
    }
    return ["number", value];
  }
  if (typeof value === "undefined") {
    return special("undefined");
  }
  if (typeof value === "bigint") {
    return ["bigint", value.toString()];
  }
  if (typeof value === "symbol") {
    return special("symbol");
  }
  if (typeof value === "function") {
    return special("function");
  }
  if (typeof value !== "object") {
    return special("unserializable");
  }
  if (ancestors.has(value)) {
    return special("circular");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return [
        "array",
        Array.from({ length: value.length }, (_, index) =>
          canonicalizeArrayValue(value, index, ancestors),
        ),
      ];
    }

    let keys: string[];
    try {
      keys = Object.keys(value).sort();
    } catch {
      return special("unserializable");
    }

    return [
      "object",
      keys.map((key): [string, CanonicalValue] => [
        key,
        isSecretLikeKey(key)
          ? special("redacted")
          : canonicalizeObjectValue(value, key, ancestors),
      ]),
    ];
  } finally {
    ancestors.delete(value);
  }
}

function canonicalizeArrayValue(
  value: unknown[],
  index: number,
  ancestors: WeakSet<object>,
): CanonicalValue {
  try {
    if (!(index in value)) {
      return special("array_hole");
    }
    return canonicalize(value[index], ancestors);
  } catch {
    return special("unreadable");
  }
}

function canonicalizeObjectValue(
  value: object,
  key: string,
  ancestors: WeakSet<object>,
): CanonicalValue {
  try {
    return canonicalize((value as Record<string, unknown>)[key], ancestors);
  } catch {
    return special("unreadable");
  }
}

function special(
  tag:
    | "undefined"
    | "symbol"
    | "function"
    | "circular"
    | "unreadable"
    | "unserializable"
    | "redacted"
    | "array_hole",
): CanonicalValue {
  return [tag];
}

function isSecretLikeKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return [
    "apikey",
    "authorization",
    "bearer",
    "token",
    "password",
    "passwd",
    "secret",
    "cookie",
    "credential",
    "privatekey",
    "accesskey",
    "sessionkey",
  ].some((secretKey) => normalized.includes(secretKey));
}

function normalizeMachineValue(value: unknown): string {
  return safeString(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function safeString(value: unknown): string {
  try {
    return typeof value === "string" ? value : String(value);
  } catch {
    return UNREADABLE_MARKER;
  }
}

function safeArray<T>(value: T[] | undefined): T[] {
  try {
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function sortedStringSet(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function sortedCanonicalSet<T>(values: T[]): T[] {
  const uniqueValues = new Map<string, T>();
  for (const value of values) {
    uniqueValues.set(canonicalJson(value), value);
  }
  return [...uniqueValues.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, value]) => value);
}
