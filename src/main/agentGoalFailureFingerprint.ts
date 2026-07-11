import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import type {
  GoalAcceptanceCheckResult,
  GoalAcceptanceFailureRecord,
  GoalEvidenceManifest,
} from "../shared/agentGoal";

const UNREADABLE_MARKER = "[UNREADABLE]";
export const MAX_TOOL_ACTION_SIGNATURE_BYTES = 2_048;
export const MAX_PERSISTED_ACTION_SIGNATURE_BYTES = 8_192;
const MAX_CANONICAL_DEPTH = 16;
const MAX_CANONICAL_NODES = 8_192;
const MAX_CANONICAL_PROPERTY_INSPECTIONS = 32_768;
const MAX_CANONICAL_ARRAY_LENGTH = 32;
const MAX_CANONICAL_OBJECT_KEYS = 64;
const MAX_CANONICAL_STRING_BYTES = 512;
const MAX_DEEP_GRAPH_NODES = 8_192;
const MAX_DEEP_GRAPH_FRAME_BYTES = 512;

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
  | ["deep_digest", string, number, number, "complete" | "truncated"]
  | ["tail_digest", number, string]
  | ["array", number, CanonicalValue[], CanonicalValue]
  | ["object", number, Array<[string, CanonicalValue]>, CanonicalValue];

type CanonicalState = {
  ancestors: WeakSet<object>;
  budget: CanonicalBudget;
};

type CanonicalBudget = {
  nodes: number;
  propertyInspections: number;
  truncated: boolean;
};

type DeepTraversalTask =
  | { kind: "value"; value: unknown }
  | {
      kind: "container";
      value: object;
      keys: string[];
      index: number;
      containerKind: "array" | "object";
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
  return createAcceptanceFailureFingerprintInternal(input, true);
}

export function createAcceptanceLogicalFailureFingerprint(
  input: AcceptanceFailureFingerprintInput,
): string {
  return createAcceptanceFailureFingerprintInternal(input, false);
}

function createAcceptanceFailureFingerprintInternal(
  input: AcceptanceFailureFingerprintInput,
  includeActionSignatures: boolean,
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
      ...(includeActionSignatures
        ? {
            actionSignatures: sortedStringSet(
              safeArray(input.actionSignatures).map(safeString),
            ),
          }
        : {}),
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
  const canonical = canonicalJsonWithMetadata(args);
  const canonicalArgs = canonical.json;
  const signature = `${safeToolName}:${canonicalArgs}`;
  if (Buffer.byteLength(signature) <= MAX_TOOL_ACTION_SIGNATURE_BYTES) {
    return signature;
  }
  return `${safeToolName}:${JSON.stringify([
    "bounded_digest",
    createHash("sha256").update(canonicalArgs).digest("hex"),
    ...(canonical.truncated ? ["truncated"] : []),
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
  return canonicalJsonWithMetadata(value).json;
}

function canonicalJsonWithMetadata(value: unknown): {
  json: string;
  truncated: boolean;
} {
  const budget: CanonicalBudget = {
    nodes: 0,
    propertyInspections: 0,
    truncated: false,
  };
  try {
    const json = JSON.stringify(
      canonicalize(value, {
        ancestors: new WeakSet<object>(),
        budget,
      }, 0),
    );
    return { json, truncated: budget.truncated };
  } catch {
    return {
      json: JSON.stringify(special("unserializable")),
      truncated: budget.truncated,
    };
  }
}

function canonicalize(
  value: unknown,
  state: CanonicalState,
  depth: number,
): CanonicalValue {
  if (!consumeCanonicalNode(state.budget)) {
    return special("truncated");
  }
  if (depth >= MAX_CANONICAL_DEPTH) {
    return deepGraphDigest(value, state.budget, true);
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
  if (isProxy(value)) {
    return special("unreadable");
  }
  if (state.ancestors.has(value)) {
    return special("circular");
  }

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const length = readArrayLength(value, state.budget);
      const visibleLength = Math.min(length, MAX_CANONICAL_ARRAY_LENGTH);
      return [
        "array",
        length,
        Array.from(
          { length: visibleLength },
          (_, index) =>
            canonicalizeArrayValue(
              value,
              index,
              createVisibleEntryState(state),
              depth + 1,
            ),
        ),
        summarizeArrayTail(value, state, depth + 1),
      ];
    }

    let allKeys: string[];
    try {
      allKeys = Object.keys(value);
    } catch {
      return special("unserializable");
    }

    const sortedKeys = allKeys.sort();
    const visibleKeys = sortedKeys.slice(0, MAX_CANONICAL_OBJECT_KEYS);
    return [
      "object",
      allKeys.length,
      visibleKeys.map((key): [string, CanonicalValue] => [
        key,
        canonicalizeObjectEntry(
          value,
          key,
          createVisibleEntryState(state),
          depth + 1,
        ),
      ]),
      summarizeObjectTail(value, sortedKeys, state, depth + 1),
    ];
  } finally {
    state.ancestors.delete(value);
  }
}

function readArrayLength(value: unknown[], budget: CanonicalBudget): number {
  if (!consumeCanonicalPropertyInspection(budget)) return 0;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = descriptor && "value" in descriptor ? descriptor.value : 0;
    return Number.isSafeInteger(length) && length >= 0
      ? length
      : 0;
  } catch {
    return 0;
  }
}

function summarizeArrayTail(
  value: unknown[],
  state: CanonicalState,
  depth: number,
): CanonicalValue {
  let keys: string[];
  try {
    const enumerableKeys = Object.keys(value);
    const ownNames = Object.getOwnPropertyNames(value);
    const selected = new Set(
      enumerableKeys.filter((key) => {
        const index = parseCanonicalArrayIndex(key);
        return index === null || index >= MAX_CANONICAL_ARRAY_LENGTH;
      }),
    );
    for (const key of ownNames) {
      const index = parseCanonicalArrayIndex(key);
      if (index !== null && index >= MAX_CANONICAL_ARRAY_LENGTH) {
        selected.add(key);
      }
    }
    keys = [...selected];
  } catch {
    return special("unserializable");
  }
  keys.sort(compareDeepArrayKeys);
  const hash = createHash("sha256");
  let cardinality = 0;
  for (const key of keys) {
    if (!canConsumeCanonicalNode(state.budget)) {
      updateTailHash(hash, "[truncated]", special("truncated"));
      state.budget.truncated = true;
      break;
    }
    const index = parseCanonicalArrayIndex(key);
    const entryState = createTailEntryState(value, state.budget);
    const canonicalValue =
      index === null
        ? canonicalizeObjectEntry(value, key, entryState, depth)
        : canonicalizeArrayValue(value, index, entryState, depth);
    updateTailHash(hash, key, canonicalValue);
    cardinality += 1;
  }
  return ["tail_digest", cardinality, hash.digest("hex")];
}

function summarizeObjectTail(
  value: object,
  sortedKeys: string[],
  state: CanonicalState,
  depth: number,
): CanonicalValue {
  const hash = createHash("sha256");
  let cardinality = 0;
  for (const key of sortedKeys.slice(MAX_CANONICAL_OBJECT_KEYS)) {
    if (!canConsumeCanonicalNode(state.budget)) {
      updateTailHash(hash, "[truncated]", special("truncated"));
      state.budget.truncated = true;
      break;
    }
    const canonicalValue = canonicalizeObjectEntry(
      value,
      key,
      createTailEntryState(value, state.budget),
      depth,
    );
    updateTailHash(hash, key, canonicalValue);
    cardinality += 1;
  }
  return ["tail_digest", cardinality, hash.digest("hex")];
}

function createTailEntryState(
  parent: object,
  budget: CanonicalBudget,
): CanonicalState {
  const ancestors = new WeakSet<object>();
  ancestors.add(parent);
  return { ancestors, budget };
}

function createVisibleEntryState(state: CanonicalState): CanonicalState {
  return { ancestors: state.ancestors, budget: state.budget };
}

function deepGraphDigest(
  root: unknown,
  budget: CanonicalBudget,
  rootAlreadyCounted: boolean,
): CanonicalValue {
  const hash = createHash("sha256");
  const traversalIds = new WeakMap<object, number>();
  const tasks: DeepTraversalTask[] = [{ kind: "value", value: root }];
  let nextTraversalId = 1;
  let nodeCount = 0;
  let edgeCount = 0;
  let truncated = false;
  const markTruncated = () => {
    truncated = true;
    updateDeepHash(hash, "graph_truncated", String(nodeCount));
    updateDeepHash(hash, "graph_truncated_edges", String(edgeCount));
    updateDeepHash(
      hash,
      "graph_truncated_inspections",
      String(budget.propertyInspections),
    );
  };

  while (tasks.length > 0) {
    const task = tasks.pop()!;
    if (task.kind === "container") {
      if (task.index >= task.keys.length) {
        updateDeepHash(hash, `${task.containerKind}_end`);
        continue;
      }

      if (
        nodeCount >= MAX_DEEP_GRAPH_NODES ||
        !canInspectCanonicalProperty(budget)
      ) {
        markTruncated();
        break;
      }

      const key = task.keys[task.index]!;
      task.index += 1;
      tasks.push(task);
      if (!consumeCanonicalPropertyInspection(budget)) {
        markTruncated();
        break;
      }
      const arrayIndex =
        task.containerKind === "array" ? parseCanonicalArrayIndex(key) : null;
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(task.value, key);
      } catch {
        edgeCount += 1;
        updateDeepHash(
          hash,
          arrayIndex === null ? `${task.containerKind}_key` : "array_index",
          key,
        );
        updateDeepHash(hash, "unreadable_descriptor");
        continue;
      }
      if (
        descriptor !== undefined &&
        arrayIndex === null &&
        descriptor.enumerable !== true
      ) {
        continue;
      }

      edgeCount += 1;
      updateDeepHash(
        hash,
        arrayIndex === null
          ? `${task.containerKind}_key`
          : "array_index",
        key,
      );
      if (isSecretLikeKey(key)) {
        updateDeepHash(hash, "redacted");
        continue;
      }
      if (descriptor === undefined) {
        updateDeepHash(hash, "missing_property");
        continue;
      }
      try {
        if (!("value" in descriptor)) {
          if (
            !reserveCanonicalChildNode(budget) ||
            !consumeCanonicalPropertyInspection(budget)
          ) {
            markTruncated();
            break;
          }
        }
        tasks.push({
          kind: "value",
          value:
            "value" in descriptor
              ? descriptor.value
              : descriptor.get?.call(task.value),
        });
      } catch {
        updateDeepHash(hash, "unreadable");
      }
      continue;
    }

    const value = task.value;
    if (!(rootAlreadyCounted && nodeCount === 0)) {
      if (!consumeCanonicalNode(budget)) {
        markTruncated();
        break;
      }
    }
    if (value === null) {
      updateDeepHash(hash, "null");
      continue;
    }
    if (typeof value === "string") {
      if (containsPrivateString(value)) {
        updateDeepHash(hash, "private_string", scrubSecretsBeforeDigest(value));
      } else if (containsSecretString(value)) {
        updateDeepHash(hash, "redacted_string");
      } else {
        updateDeepHash(hash, "string", value);
      }
      continue;
    }
    if (typeof value === "boolean") {
      updateDeepHash(hash, "boolean", value ? "true" : "false");
      continue;
    }
    if (typeof value === "number") {
      updateDeepHash(hash, "number", normalizeDeepNumber(value));
      continue;
    }
    if (typeof value === "undefined") {
      updateDeepHash(hash, "undefined");
      continue;
    }
    if (typeof value === "bigint") {
      updateDeepHash(hash, "bigint", value.toString());
      continue;
    }
    if (typeof value === "symbol") {
      updateDeepHash(hash, "symbol");
      continue;
    }
    if (typeof value === "function") {
      updateDeepHash(hash, "function");
      continue;
    }
    if (typeof value !== "object") {
      updateDeepHash(hash, "unserializable");
      continue;
    }
    if (isProxy(value)) {
      updateDeepHash(hash, "unreadable_proxy");
      continue;
    }

    const existingId = traversalIds.get(value);
    if (existingId !== undefined) {
      updateDeepHash(hash, "reference", String(existingId));
      continue;
    }
    if (nodeCount >= MAX_DEEP_GRAPH_NODES) {
      markTruncated();
      break;
    }
    const traversalId = nextTraversalId;
    nextTraversalId += 1;
    traversalIds.set(value, traversalId);
    nodeCount += 1;

    let isArray: boolean;
    try {
      isArray = Array.isArray(value);
    } catch {
      updateDeepHash(hash, "unreadable_container", String(traversalId));
      continue;
    }
    const keys = readDeepContainerKeys(value, isArray);
    if (!keys) {
      updateDeepHash(hash, "unreadable_container", String(traversalId));
      continue;
    }
    if (isArray) {
      updateDeepHash(hash, "array_start", String(traversalId));
      updateDeepHash(hash, "array_length", String(readDeepArrayLength(value)));
    } else {
      updateDeepHash(hash, "object_start", String(traversalId));
    }
    tasks.push({
      kind: "container",
      value,
      keys,
      index: 0,
      containerKind: isArray ? "array" : "object",
    });
  }

  return [
    "deep_digest",
    hash.digest("hex"),
    nodeCount,
    edgeCount,
    truncated ? "truncated" : "complete",
  ];
}

function readDeepContainerKeys(
  value: object,
  isArray: boolean,
): string[] | null {
  try {
    if (!isArray) {
      // Non-enumerable named metadata is outside the action-identity contract
      // and must not consume the semantic traversal budget.
      return Object.keys(value).sort();
    }

    const keys = new Set(Object.keys(value));
    for (const key of Object.getOwnPropertyNames(value)) {
      // JSON-style arrays include numeric own elements even when their
      // descriptors are non-enumerable. Hidden named metadata remains ignored.
      if (parseCanonicalArrayIndex(key) !== null) keys.add(key);
    }
    return [...keys].sort(compareDeepArrayKeys);
  } catch {
    return null;
  }
}

function readDeepArrayLength(value: object): number {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = descriptor && "value" in descriptor ? descriptor.value : 0;
    return Number.isSafeInteger(length) && length >= 0 ? length : 0;
  } catch {
    return 0;
  }
}

function updateDeepHash(
  hash: ReturnType<typeof createHash>,
  tag: string,
  payload = "",
): void {
  hash.update(String(Buffer.byteLength(tag)));
  hash.update(":");
  hash.update(tag);
  hash.update(":");
  const payloadBytes = Buffer.byteLength(payload);
  if (payloadBytes <= MAX_DEEP_GRAPH_FRAME_BYTES) {
    hash.update("raw:");
    hash.update(String(payloadBytes));
    hash.update(":");
    hash.update(payload);
  } else {
    hash.update("digest:");
    hash.update(String(payloadBytes));
    hash.update(":");
    hash.update(createHash("sha256").update(payload).digest("hex"));
  }
  hash.update(";");
}

function normalizeDeepNumber(value: number): string {
  if (Number.isNaN(value)) return "nan";
  if (value === Number.POSITIVE_INFINITY) return "positive_infinity";
  if (value === Number.NEGATIVE_INFINITY) return "negative_infinity";
  return String(value);
}

function compareDeepArrayKeys(left: string, right: string): number {
  const leftIndex = parseCanonicalArrayIndex(left);
  const rightIndex = parseCanonicalArrayIndex(right);
  if (leftIndex !== null && rightIndex !== null) return leftIndex - rightIndex;
  if (leftIndex !== null) return -1;
  if (rightIndex !== null) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function updateTailHash(
  hash: ReturnType<typeof createHash>,
  key: string,
  value: CanonicalValue,
): void {
  const frame = JSON.stringify([key, value]);
  hash.update(String(Buffer.byteLength(frame)));
  hash.update(":");
  hash.update(frame);
  hash.update(";");
}

function parseCanonicalArrayIndex(key: string): number | null {
  if (!/^(?:0|[1-9][0-9]*)$/.test(key)) return null;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < 4_294_967_295
    ? index
    : null;
}

function canonicalizeObjectEntry(
  value: object,
  key: string,
  state: CanonicalState,
  depth: number,
): CanonicalValue {
  if (isSecretLikeKey(key)) return special("redacted");
  if (isPrivateValueKey(key)) {
    return canonicalizePrivateObjectValue(value, key, state, depth);
  }
  return canonicalizeObjectValue(value, key, state, depth);
}

function canonicalizeArrayValue(
  value: unknown[],
  index: number,
  state: CanonicalState,
  depth: number,
): CanonicalValue {
  if (!consumeCanonicalPropertyInspection(state.budget)) {
    return special("truncated");
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor) {
      return special("array_hole");
    }
    if ("value" in descriptor) {
      return canonicalize(descriptor.value, state, depth);
    }
    if (
      !reserveCanonicalChildNode(state.budget) ||
      !consumeCanonicalPropertyInspection(state.budget)
    ) {
      return special("truncated");
    }
    return canonicalize(descriptor.get?.call(value), state, depth);
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
  if (!consumeCanonicalPropertyInspection(state.budget)) {
    return special("truncated");
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return special("unreadable");
    if ("value" in descriptor) {
      return canonicalize(descriptor.value, state, depth);
    }
    if (
      !reserveCanonicalChildNode(state.budget) ||
      !consumeCanonicalPropertyInspection(state.budget)
    ) {
      return special("truncated");
    }
    return canonicalize(descriptor.get?.call(value), state, depth);
  } catch {
    return special("unreadable");
  }
}

function canConsumeCanonicalNode(budget: CanonicalBudget): boolean {
  return budget.nodes < MAX_CANONICAL_NODES;
}

function reserveCanonicalChildNode(budget: CanonicalBudget): boolean {
  if (canConsumeCanonicalNode(budget)) return true;
  budget.truncated = true;
  return false;
}

function consumeCanonicalNode(budget: CanonicalBudget): boolean {
  if (!canConsumeCanonicalNode(budget)) {
    budget.truncated = true;
    return false;
  }
  budget.nodes += 1;
  return true;
}

function canInspectCanonicalProperty(budget: CanonicalBudget): boolean {
  return budget.propertyInspections < MAX_CANONICAL_PROPERTY_INSPECTIONS;
}

function consumeCanonicalPropertyInspection(budget: CanonicalBudget): boolean {
  if (!canInspectCanonicalProperty(budget)) {
    budget.truncated = true;
    return false;
  }
  budget.propertyInspections += 1;
  return true;
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
  state: CanonicalState,
  depth: number,
): CanonicalValue {
  if (!consumeCanonicalPropertyInspection(state.budget)) {
    return special("truncated");
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return special("unreadable");
    let privateValue: unknown;
    if ("value" in descriptor) {
      privateValue = descriptor.value;
    } else {
      if (
        !reserveCanonicalChildNode(state.budget) ||
        !consumeCanonicalPropertyInspection(state.budget)
      ) {
        return special("truncated");
      }
      privateValue = descriptor.get?.call(value);
    }
    return privateDigest(privateValue, state, depth);
  } catch {
    return special("unreadable");
  }
}

function privateDigest(
  value: unknown,
  state?: CanonicalState,
  depth = 0,
): CanonicalValue {
  const raw =
    typeof value === "string"
      ? value
      : state
        ? JSON.stringify(canonicalize(value, state, depth))
        : canonicalJson(value);
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
