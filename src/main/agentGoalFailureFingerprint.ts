import { createHash } from "node:crypto";
import type {
  GoalAcceptanceCheckResult,
  GoalAcceptanceFailureRecord,
  GoalEvidenceManifest,
} from "../shared/agentGoal";

const REDACTED_MARKER = "[REDACTED]";
const CIRCULAR_MARKER = "[CIRCULAR]";
const UNDEFINED_MARKER = "[UNDEFINED]";
const NON_FINITE_MARKER = "[NON_FINITE]";
const UNREADABLE_MARKER = "[UNREADABLE]";
const UNSERIALIZABLE_MARKER = "[UNSERIALIZABLE]";

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
    identity = { malformedInput: UNSERIALIZABLE_MARKER };
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
    return JSON.stringify(UNSERIALIZABLE_MARKER);
  }
}

function canonicalize(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : NON_FINITE_MARKER;
  }
  if (typeof value === "undefined") {
    return UNDEFINED_MARKER;
  }
  if (typeof value === "bigint") {
    return `[BIGINT:${value.toString()}]`;
  }
  if (typeof value === "symbol") {
    return "[SYMBOL]";
  }
  if (typeof value === "function") {
    return "[FUNCTION]";
  }
  if (typeof value !== "object") {
    return UNSERIALIZABLE_MARKER;
  }
  if (ancestors.has(value)) {
    return CIRCULAR_MARKER;
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Array.from({ length: value.length }, (_, index) =>
        canonicalize(readArrayValue(value, index), ancestors),
      );
    }

    let keys: string[];
    try {
      keys = Object.keys(value).sort();
    } catch {
      return UNSERIALIZABLE_MARKER;
    }

    const normalized: Record<string, unknown> = {};
    for (const key of keys) {
      normalized[key] = isSecretLikeKey(key)
        ? REDACTED_MARKER
        : canonicalize(readObjectValue(value, key), ancestors);
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

function readArrayValue(value: unknown[], index: number): unknown {
  if (!(index in value)) {
    return UNDEFINED_MARKER;
  }
  try {
    return value[index];
  } catch {
    return UNREADABLE_MARKER;
  }
}

function readObjectValue(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return UNREADABLE_MARKER;
  }
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

function sortedCanonicalSet(values: unknown[]): unknown[] {
  const canonicalValues = values.map(canonicalJson);
  return [...new Set(canonicalValues)].sort().map((value) => JSON.parse(value));
}
