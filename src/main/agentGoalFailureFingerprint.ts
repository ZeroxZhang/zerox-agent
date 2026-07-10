import { createHash } from "node:crypto";
import type {
  GoalAcceptanceCheckResult,
  GoalAcceptanceFailureRecord,
  GoalEvidenceManifest,
} from "../shared/agentGoal";

const UNREADABLE_MARKER = "[UNREADABLE]";
export const MAX_TOOL_ACTION_SIGNATURE_BYTES = 2_048;
export const MAX_PERSISTED_ACTION_SIGNATURE_BYTES = 8_192;
const MAX_CANONICAL_DEPTH = 16;
const MAX_CANONICAL_NODES = 512;
const MAX_CANONICAL_ARRAY_LENGTH = 32;
const MAX_CANONICAL_OBJECT_KEYS = 64;
const MAX_CANONICAL_TAIL_ITEMS = 64;
const MAX_CANONICAL_STRING_BYTES = 512;

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
  | ["truncated"]
  | ["string_digest", string, number]
  | ["private_digest", string, number]
  | ["tail_digest", number, number, string]
  | ["array", number, CanonicalValue[], CanonicalValue]
  | ["object", number, Array<[string, CanonicalValue]>, CanonicalValue];

type CanonicalState = {
  ancestors: WeakSet<object>;
  nodes: number;
};

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
  const safeToolName = normalizeToolName(toolName);
  const canonicalArgs = canonicalJson(args);
  const signature = `${safeToolName}:${canonicalArgs}`;
  if (Buffer.byteLength(signature) <= MAX_TOOL_ACTION_SIGNATURE_BYTES) {
    return signature;
  }
  return `${safeToolName}:${JSON.stringify([
    "bounded_digest",
    createHash("sha256").update(canonicalArgs).digest("hex"),
  ])}`;
}

export function sanitizeActionSignaturesForPersistence(
  signatures: readonly unknown[],
): string[] {
  const sanitized: string[] = [];
  const seen = new Set<string>();
  for (const value of signatures.slice(0, 32)) {
    const candidate = sanitizeOpaqueActionSignature(value);
    if (seen.has(candidate)) continue;
    const next = [...sanitized, candidate];
    if (
      Buffer.byteLength(JSON.stringify(next)) >
      MAX_PERSISTED_ACTION_SIGNATURE_BYTES
    ) {
      break;
    }
    seen.add(candidate);
    sanitized.push(candidate);
  }
  return sanitized;
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
    return JSON.stringify(
      canonicalize(value, {
        ancestors: new WeakSet<object>(),
        nodes: 0,
      }, 0),
    );
  } catch {
    return JSON.stringify(special("unserializable"));
  }
}

function canonicalize(
  value: unknown,
  state: CanonicalState,
  depth: number,
): CanonicalValue {
  state.nodes += 1;
  if (state.nodes > MAX_CANONICAL_NODES || depth > MAX_CANONICAL_DEPTH) {
    return special("truncated");
  }
  if (value === null) {
    return ["null"];
  }
  if (typeof value === "string") {
    return canonicalizeString(value);
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
  if (state.ancestors.has(value)) {
    return special("circular");
  }

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const length = readArrayLength(value);
      const visibleLength = Math.min(length, MAX_CANONICAL_ARRAY_LENGTH);
      return [
        "array",
        length,
        Array.from(
          { length: visibleLength },
          (_, index) => canonicalizeArrayValue(value, index, state, depth + 1),
        ),
        summarizeArrayTail(value, length, state, depth + 1),
      ];
    }

    let allKeys: string[];
    try {
      allKeys = Object.keys(value);
    } catch {
      return special("unserializable");
    }

    const keys = selectSmallestSortedKeys(
      allKeys,
      MAX_CANONICAL_OBJECT_KEYS + MAX_CANONICAL_TAIL_ITEMS,
    );
    const visibleKeys = keys.slice(0, MAX_CANONICAL_OBJECT_KEYS);
    return [
      "object",
      allKeys.length,
      visibleKeys.map((key): [string, CanonicalValue] => [
        key,
        canonicalizeObjectEntry(value, key, state, depth + 1),
      ]),
      summarizeObjectTail(value, keys, allKeys.length, state, depth + 1),
    ];
  } finally {
    state.ancestors.delete(value);
  }
}

function readArrayLength(value: unknown[]): number {
  try {
    return Number.isSafeInteger(value.length) && value.length >= 0
      ? value.length
      : 0;
  } catch {
    return 0;
  }
}

function summarizeArrayTail(
  value: unknown[],
  length: number,
  state: CanonicalState,
  depth: number,
): CanonicalValue {
  const omitted = Math.max(0, length - MAX_CANONICAL_ARRAY_LENGTH);
  const inspected = Math.min(omitted, MAX_CANONICAL_TAIL_ITEMS);
  const tailState: CanonicalState = {
    ancestors: state.ancestors,
    nodes: 0,
  };
  const entries = Array.from({ length: inspected }, (_, offset) =>
    canonicalizeArrayValue(
      value,
      MAX_CANONICAL_ARRAY_LENGTH + offset,
      tailState,
      depth,
    ),
  );
  return tailDigest(inspected, omitted - inspected, entries);
}

function summarizeObjectTail(
  value: object,
  sortedKeys: string[],
  totalKeyCount: number,
  state: CanonicalState,
  depth: number,
): CanonicalValue {
  const omitted = Math.max(0, totalKeyCount - MAX_CANONICAL_OBJECT_KEYS);
  const inspected = Math.min(omitted, MAX_CANONICAL_TAIL_ITEMS);
  const tailState: CanonicalState = {
    ancestors: state.ancestors,
    nodes: 0,
  };
  const entries = sortedKeys
    .slice(
      MAX_CANONICAL_OBJECT_KEYS,
      MAX_CANONICAL_OBJECT_KEYS + inspected,
    )
    .map((key): [string, CanonicalValue] => [
      key,
      canonicalizeObjectEntry(value, key, tailState, depth),
    ]);
  return tailDigest(inspected, omitted - inspected, entries);
}

function selectSmallestSortedKeys(keys: string[], limit: number): string[] {
  const selected: string[] = [];
  for (const key of keys) {
    if (selected.length === limit && key >= selected[selected.length - 1]!) {
      continue;
    }
    let low = 0;
    let high = selected.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (selected[middle]! < key) low = middle + 1;
      else high = middle;
    }
    selected.splice(low, 0, key);
    if (selected.length > limit) selected.pop();
  }
  return selected;
}

function tailDigest(
  inspected: number,
  uninspected: number,
  entries: unknown,
): CanonicalValue {
  return [
    "tail_digest",
    inspected,
    uninspected,
    createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
  ];
}

function canonicalizeObjectEntry(
  value: object,
  key: string,
  state: CanonicalState,
  depth: number,
): CanonicalValue {
  if (isSecretLikeKey(key)) return special("redacted");
  if (isPrivateValueKey(key)) return canonicalizePrivateObjectValue(value, key);
  return canonicalizeObjectValue(value, key, state, depth);
}

function canonicalizeArrayValue(
  value: unknown[],
  index: number,
  state: CanonicalState,
  depth: number,
): CanonicalValue {
  try {
    if (!(index in value)) {
      return special("array_hole");
    }
    return canonicalize(value[index], state, depth);
  } catch {
    return special("unreadable");
  }
}

function canonicalizeObjectValue(
  value: object,
  key: string,
  state: CanonicalState,
  depth: number,
): CanonicalValue {
  try {
    return canonicalize((value as Record<string, unknown>)[key], state, depth);
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
    | "array_hole"
    | "truncated",
): CanonicalValue {
  return [tag];
}

function canonicalizeString(value: string): CanonicalValue {
  if (containsPrivateString(value)) {
    return privateDigest(value);
  }
  if (containsSecretString(value)) {
    return special("redacted");
  }
  const size = Buffer.byteLength(value);
  if (size > MAX_CANONICAL_STRING_BYTES) {
    return [
      "string_digest",
      createHash("sha256").update(value).digest("hex"),
      size,
    ];
  }
  return ["string", value];
}

function isPrivateValueKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return [
    "body",
    "callbackurl",
    "cmd",
    "code",
    "command",
    "content",
    "document",
    "endpoint",
    "filecontent",
    "href",
    "payload",
    "prompt",
    "script",
    "shell",
    "text",
    "uri",
    "url",
  ].some((sensitiveKey) => normalized === sensitiveKey || normalized.endsWith(sensitiveKey));
}

function containsSecretString(value: string): boolean {
  return (
    /\bbearer\s+[a-z0-9._~+\/-]+/i.test(value) ||
    /(?:^|[?&\s])(?:api[_-]?key|access[_-]?token|authorization|password|secret|token)=/i.test(
      value,
    )
  );
}

function containsPrivateString(value: string): boolean {
  return (
    /https?:\/\//i.test(value) ||
    /^\s*(?:sudo\s+)?(?:bash|sh|zsh|curl|wget|npm|npx|node|python|git|rm|cp|mv|echo)\b/i.test(
      value,
    )
  );
}

function canonicalizePrivateObjectValue(
  value: object,
  key: string,
): CanonicalValue {
  try {
    return privateDigest((value as Record<string, unknown>)[key]);
  } catch {
    return special("unreadable");
  }
}

function privateDigest(value: unknown): CanonicalValue {
  const raw =
    typeof value === "string" ? value : canonicalJson(value);
  const scrubbed = scrubSecretsBeforeDigest(raw);
  return [
    "private_digest",
    createHash("sha256").update(scrubbed).digest("hex"),
    Buffer.byteLength(raw),
  ];
}

function scrubSecretsBeforeDigest(value: string): string {
  return value
    .replace(/\bbearer\s+[a-z0-9._~+\/-]+/gi, "Bearer [redacted]")
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|authorization|password|secret|token)=)[^&#\s]*/gi,
      "$1[redacted]",
    )
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, "$1[redacted]@")
    .replace(
      /((?:api[_-]?key|access[_-]?token|authorization|password|secret|token)=)[^&\s]+/gi,
      "$1[redacted]",
    );
}

function normalizeToolName(value: unknown): string {
  const raw = safeString(value).slice(0, 128);
  const normalized = raw.replace(/[^A-Za-z0-9_.-]/g, "_");
  return normalized || "tool";
}

function sanitizeOpaqueActionSignature(value: unknown): string {
  const raw = safeString(value);
  const separator = raw.indexOf(":");
  const toolName = normalizeToolName(separator >= 0 ? raw.slice(0, separator) : raw);
  const looksCanonical =
    separator >= 0 && /^\s*\[/.test(raw.slice(separator + 1));
  if (
    !looksCanonical ||
    Buffer.byteLength(raw) > MAX_TOOL_ACTION_SIGNATURE_BYTES ||
    containsSecretString(raw) ||
    containsPrivateString(raw) ||
    /\["(?:body|callbackUrl|cmd|code|command|content|document|endpoint|filecontent|href|payload|prompt|script|shell|text|uri|url)",\["string"/i.test(
      raw,
    )
  ) {
    return `${toolName}:${JSON.stringify(["redacted"])}`;
  }
  return raw;
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
