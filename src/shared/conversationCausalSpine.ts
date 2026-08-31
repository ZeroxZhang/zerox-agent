import type { ConversationAcceptedAttemptSettlement } from "./conversationDisclosure";
import { sanitizeConversationDisclosureSummary } from "./conversationDisclosure";

export const CONVERSATION_CAUSAL_SCHEMA_VERSION = 1 as const;
export const CONVERSATION_REQUEST_FINGERPRINT_VERSION = "sha256-type-tagged-v2" as const;
export const LEGACY_CONVERSATION_REQUEST_FINGERPRINT_VERSION = "fnv1a64-canonical-v1" as const;
export type ConversationRequestFingerprintVersion =
  | typeof CONVERSATION_REQUEST_FINGERPRINT_VERSION
  | typeof LEGACY_CONVERSATION_REQUEST_FINGERPRINT_VERSION;

export type ConversationCausalCoverage = {
  state: "complete" | "partial" | "degraded";
  reasonCodes: string[];
};

export type ConversationCausalRef =
  | { kind: "agent_run"; id: string }
  | { kind: "trajectory_run"; id: string }
  | { kind: "trajectory_event"; runId: string; eventId: string }
  | { kind: "workspace_run"; id: string }
  | { kind: "workspace_event"; runId: string; eventId: string }
  | { kind: "kernel_run"; id: string }
  | { kind: "tool_invocation"; runId: string; id: string }
  | { kind: "approval"; id: string }
  | { kind: "guided_input"; id: string }
  | { kind: "evidence"; authority: string; id: string };

export type ConversationCausalAttemptState =
  | "active"
  | "superseded"
  | "reset"
  | "accepted"
  | "interrupted";

export type ConversationCausalAttempt = {
  attempt: number;
  state: ConversationCausalAttemptState;
  controlSequence: number;
  eventFingerprint: string;
  supersedesAttempt?: number;
  /**
   * Durable two-phase intent for a successful assistant turn. `preparing`
   * reserves the exact Chat receipt and optional Workspace commit identity;
   * only `committed` is allowed to project the attempt as accepted.
   */
  assistantAcceptance?: ConversationAssistantAcceptance;
  acceptedSettlement?: ConversationAcceptedAttemptSettlement;
  createdAt: string;
  updatedAt: string;
};

export type ConversationAssistantAcceptance = {
  state: "preparing" | "committed";
  acceptedSettlement: ConversationAcceptedAttemptSettlement;
  requiredDomains: Array<"chat" | "workspace">;
  workspaceRunId?: string;
  preparedWorkspaceEventId?: string;
  workspaceEventId?: string;
  createdAt: string;
  updatedAt: string;
};

export const CONVERSATION_REQUIRED_SETTLEMENT_FAILURE_CODES = [
  "CHAT_SETTLEMENT_FAILED",
  "WORKSPACE_SETTLEMENT_FAILED",
  "CROSS_DOMAIN_SETTLEMENT_FAILED",
  "RECOVERY_INCOMPLETE",
] as const;

export type ConversationRequiredSettlementFailureCode =
  typeof CONVERSATION_REQUIRED_SETTLEMENT_FAILURE_CODES[number];

export function isConversationRequiredSettlementFailureCode(
  value: unknown,
): value is ConversationRequiredSettlementFailureCode {
  return CONVERSATION_REQUIRED_SETTLEMENT_FAILURE_CODES.some(
    (candidate) => candidate === value,
  );
}

export type ConversationRequiredSettlement = {
  id: string;
  attempt: number;
  sourceSequence: number;
  targetState:
    | "waiting_for_input"
    | "waiting_for_approval"
    | "checkpoint_boundary"
    | "paused"
    | "failed"
    | "canceled";
  guidedInputRequestId?: string;
  requiredDomains: Array<"chat" | "workspace">;
  /** Optional schema-v1-compatible frozen Workspace owner for restart probing. */
  workspaceRunId?: string;
  /** Optional deterministic Workspace event identity frozen with workspaceRunId. */
  preparedWorkspaceEventId?: string;
  /** Frozen at prepare; a duplicate may reconcile only this exact Chat fact. */
  preparedChatEventFingerprint: string;
  state: "preparing" | "committed" | "failed";
  chatEventFingerprint?: string;
  workspaceEventId?: string;
  failureCode?: ConversationRequiredSettlementFailureCode;
  createdAt: string;
  updatedAt: string;
};

export type ConversationAgentRunAdmission = {
  runId: string;
  taskId: string;
  sessionId?: string;
  /** Absent on schema-v1 legacy rows; interpreted as revision 1. */
  executionRevision?: number;
  /** Durable binding for resumed revision admission; absent on legacy/rev1. */
  executionEnvelopeFingerprint?: string;
  state: "admitted" | "started" | "settled" | "aborted";
  finalStatus?: "succeeded" | "paused" | "failed" | "canceled";
  failureCode?: ConversationAgentRunAdmissionFailureCode;
  createdAt: string;
  updatedAt: string;
};

export const CONVERSATION_AGENT_RUN_ADMISSION_FAILURE_CODES = [
  "AGENT_RUN_OWNER_MISSING",
  "AGENT_RUN_OWNER_CONFLICT",
  "AGENT_RUN_REVISION_GAP",
] as const;

export type ConversationAgentRunAdmissionFailureCode =
  typeof CONVERSATION_AGENT_RUN_ADMISSION_FAILURE_CODES[number];

export type ConversationAgentRunOwnerFact = Readonly<{
  runId: string;
  taskId: string;
  executionRevision?: number;
  status: NonNullable<ConversationAgentRunAdmission["finalStatus"]>;
}>;

export function resolveConversationAgentRunExecutionRevision(
  value: { executionRevision?: number },
): number {
  if (value.executionRevision === undefined) return 1;
  return Number.isSafeInteger(value.executionRevision)
    && value.executionRevision > 0
    ? value.executionRevision
    : Number.NaN;
}

export type ConversationCausalRecord = {
  schemaVersion: typeof CONVERSATION_CAUSAL_SCHEMA_VERSION;
  requestId: string;
  turnId: string;
  sessionId?: string;
  userMessageId?: string;
  inputFingerprint: string;
  /** Absent on legacy rows; inferred from the stored digest width on read. */
  inputFingerprintVersion?: ConversationRequestFingerprintVersion;
  revision: number;
  attempts: ConversationCausalAttempt[];
  /** Optional on schema-v1 legacy rows; mutations normalize it to an array. */
  requiredSettlements?: ConversationRequiredSettlement[];
  /** Owning admission facts created atomically with `agent_run` refs. */
  agentRunAdmissions?: ConversationAgentRunAdmission[];
  refs: ConversationCausalRef[];
  coverage: ConversationCausalCoverage;
  createdAt: string;
  updatedAt: string;
};

export type DurableConversationBinding = Readonly<{
  sessionId: string;
  userMessageId: string;
}>;

/** A session id alone is routing or legacy metadata, never durable proof. */
export function resolveDurableConversationBinding(
  record: Pick<ConversationCausalRecord, "sessionId" | "userMessageId"> | null | undefined,
): DurableConversationBinding | null {
  const sessionId = record?.sessionId?.trim();
  const userMessageId = record?.userMessageId?.trim();
  return sessionId && userMessageId ? { sessionId, userMessageId } : null;
}

export type ToolApprovalIntentState =
  | "pending"
  | "approved"
  | "denied"
  | "timed_out"
  | "aborted"
  | "interrupted";

export type ToolApprovalCausalRef = {
  sessionId?: string;
  requestId?: string;
  turnId?: string;
  attempt?: number;
  agentRunId?: string;
  trajectoryRunId?: string;
  workspaceRunId?: string;
  kernelRunId?: string;
  toolInvocationId?: string;
  toolInvocationRunId?: string;
  /**
   * Secret-safe frozen identity for cold-start reconciliation. Tool arguments
   * are deliberately excluded: startup only needs ownership and projection
   * keys to terminate an interrupted invocation.
   */
  toolInvocationIdentity?: ToolApprovalInvocationIdentity;
};

export type ToolApprovalInvocationIdentity = Readonly<{
  id: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  source: string;
  createdAt: string;
}>;

export function hasConsistentToolApprovalInvocationIdentity(
  causalRef: ToolApprovalCausalRef,
): boolean {
  const identity = causalRef.toolInvocationIdentity;
  if (!identity) return true;
  const bounded = [
    identity.id,
    identity.runId,
    identity.toolCallId,
    identity.toolName,
    identity.source,
  ].every((value) => value.length <= 256);
  return Boolean(
    bounded
    && identity.id.trim()
    && identity.runId.trim()
    && identity.toolCallId.trim()
    && identity.toolName.trim()
    && identity.source.trim()
    && !Number.isNaN(Date.parse(identity.createdAt))
    && causalRef.toolInvocationId === identity.id
    && causalRef.toolInvocationRunId === identity.runId
  );
}

export type ToolApprovalIntentDecision = {
  decisionId: string;
  outcome: Exclude<ToolApprovalIntentState, "pending">;
  automatic: boolean;
  reasonCode: string;
  decidedAt: string;
};

export type ToolApprovalIntent = {
  schemaVersion: typeof CONVERSATION_CAUSAL_SCHEMA_VERSION;
  id: string;
  revision: number;
  state: ToolApprovalIntentState;
  requestFingerprint: string;
  taskId: string;
  taskName: string;
  toolName: string;
  safeArgsSummary: Record<string, string | number | boolean | null>;
  risk: {
    level: "normal" | "high" | "critical";
    category: string;
    requiresConfirmation: boolean;
  };
  causalRef: ToolApprovalCausalRef;
  ownerProcessEpoch: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  decision?: ToolApprovalIntentDecision;
};

export type CausalMutationDisposition =
  | "applied"
  | "duplicate"
  | "conflict"
  | "not_found";

export function createConversationTurnId(requestId: string): string {
  return `turn-${requestId}`;
}

export function createConversationRequestFingerprint(value: unknown): string {
  return sha256Hex(new TextEncoder().encode(canonicalSerializeExact(value)));
}

/** Compatibility only: never use this compact digest for a new request claim. */
export function createLegacyConversationRequestFingerprint(value: unknown): string {
  return fingerprintConversationCausalValue(value);
}

export function resolveConversationRequestFingerprintVersion(input: {
  inputFingerprint: string;
  inputFingerprintVersion?: ConversationRequestFingerprintVersion;
}): ConversationRequestFingerprintVersion {
  if (input.inputFingerprintVersion) return input.inputFingerprintVersion;
  return /^[0-9a-f]{64}$/.test(input.inputFingerprint)
    ? CONVERSATION_REQUEST_FINGERPRINT_VERSION
    : LEGACY_CONVERSATION_REQUEST_FINGERPRINT_VERSION;
}

export function createConversationCausalAttemptId(input: {
  requestId: string;
  turnId: string;
  attempt: number;
}): string {
  return createTupleIdentity("causal-attempt", [
    input.requestId,
    input.turnId,
    String(input.attempt),
  ]);
}

export function createConversationAssistantAcceptanceWorkspaceEventId(input: {
  requestId: string;
  attempt: number;
  acceptanceReceiptFingerprint: string;
}): string {
  return createTupleIdentity("assistant-acceptance-workspace-event", [
    input.requestId,
    String(input.attempt),
    input.acceptanceReceiptFingerprint,
  ]);
}

export function createConversationToolInvocationId(input: {
  runId: string;
  toolCallId: string;
}): string {
  return createTupleIdentity("tool-invocation", [input.runId, input.toolCallId]);
}

export function fingerprintConversationCausalValue(value: unknown): string {
  return fnv1a64(canonicalSerialize(value));
}

export function fingerprintConversationAttemptControl(input: {
  requestId: string;
  turnId: string;
  attempt: number;
  controlSequence: number;
  state: ConversationCausalAttemptState;
  supersedesAttempt?: number;
  acceptedReceiptFingerprint?: string;
}): string {
  return fingerprintConversationCausalValue(input);
}

export function mergeConversationCausalRefs(
  current: ConversationCausalRef[],
  additions: ConversationCausalRef[],
): ConversationCausalRef[] {
  const refs = new Map<string, ConversationCausalRef>();
  for (const ref of [...current, ...additions]) {
    refs.set(conversationCausalRefKey(ref), structuredClone(ref));
  }
  return [...refs.values()].sort((left, right) =>
    conversationCausalRefKey(left).localeCompare(conversationCausalRefKey(right)),
  );
}

export function conversationCausalRefKey(ref: ConversationCausalRef): string {
  switch (ref.kind) {
    case "agent_run":
    case "trajectory_run":
    case "workspace_run":
    case "kernel_run":
    case "approval":
    case "guided_input":
      return createTupleIdentity(ref.kind, [ref.id]);
    case "trajectory_event":
    case "workspace_event":
    case "tool_invocation":
      return createTupleIdentity(ref.kind, [ref.runId, ref.kind === "tool_invocation" ? ref.id : ref.eventId]);
    case "evidence":
      return createTupleIdentity(ref.kind, [ref.authority, ref.id]);
  }
}

export function normalizeConversationCausalCoverage(
  coverage: ConversationCausalCoverage,
): ConversationCausalCoverage {
  return {
    state: coverage.state,
    reasonCodes: [...new Set(coverage.reasonCodes.filter(Boolean))].sort(),
  };
}

export function mergeConversationCausalCoverage(
  left: ConversationCausalCoverage,
  right: ConversationCausalCoverage,
): ConversationCausalCoverage {
  const rank = { complete: 0, partial: 1, degraded: 2 } as const;
  return normalizeConversationCausalCoverage({
    state: rank[left.state] >= rank[right.state] ? left.state : right.state,
    reasonCodes: [...left.reasonCodes, ...right.reasonCodes],
  });
}

export function sanitizeToolApprovalIntentSummary(
  input: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {};
  for (const key of Object.keys(input).sort().slice(0, 24)) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      output[key] = value;
      continue;
    }
    if (typeof value === "boolean" || value === null) {
      output[key] = value;
      continue;
    }
    const serialized = typeof value === "string" ? value : canonicalSerialize(value);
    output[key] = sanitizeConversationDisclosureSummary(serialized, {
      maxBytes: 240,
      maxLines: 2,
    }).text;
  }
  return output;
}

export function sanitizeToolApprovalIntentLabel(value: unknown): string {
  const sanitized = sanitizeConversationDisclosureSummary(String(value ?? ""), {
    maxBytes: 160,
    maxLines: 1,
  }).text.trim();
  return sanitized || "受保护的本地任务";
}

function createTupleIdentity(prefix: string, values: string[]): string {
  return `${prefix}:${values.map((value) => `${value.length}:${value}`).join(":")}`;
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

function canonicalSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return JSON.stringify(value.toString());
    if (value === undefined) return '"[undefined]"';
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalSerialize).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalSerialize(record[key])}`)
    .join(",")}}`;
}

/**
 * Type-tagged canonical encoding for exact request claims. This deliberately
 * differs from the compact disclosure/event fingerprint above: request claims
 * are an authorization and idempotency boundary, so `undefined`, strings,
 * bigint, numeric edge cases, arrays, and objects must never share an encoding.
 */
function canonicalSerializeExact(value: unknown, seen = new Set<object>()): string {
  switch (typeof value) {
    case "undefined":
      return "u";
    case "boolean":
      return value ? "b1" : "b0";
    case "string":
      return `s${new TextEncoder().encode(value).byteLength}:${value}`;
    case "number":
      if (Number.isNaN(value)) return "dNaN";
      if (value === Infinity) return "d+Infinity";
      if (value === -Infinity) return "d-Infinity";
      if (Object.is(value, -0)) return "d-0";
      return `d${String(value)}`;
    case "bigint":
      return `i${value.toString()}`;
    case "object": {
      if (value === null) return "n";
      if (seen.has(value)) {
        throw new TypeError("Conversation request fingerprint cannot encode cyclic input.");
      }
      seen.add(value);
      try {
        if (Array.isArray(value)) {
          const entries = value.map((entry) => canonicalSerializeExact(entry, seen));
          return `a${entries.length}:${entries.map(withEncodedLength).join("")}`;
        }
        if (value instanceof Date) {
          return `t${value.toISOString()}`;
        }
        if (value instanceof Uint8Array) {
          return `y${value.byteLength}:${bytesToHex(value)}`;
        }
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        return `o${keys.length}:${keys.map((key) => {
          const encodedKey = canonicalSerializeExact(key, seen);
          const encodedValue = canonicalSerializeExact(record[key], seen);
          return `${withEncodedLength(encodedKey)}${withEncodedLength(encodedValue)}`;
        }).join("")}`;
      } finally {
        seen.delete(value);
      }
    }
    default:
      throw new TypeError(
        `Conversation request fingerprint cannot encode ${typeof value}.`,
      );
  }
}

function withEncodedLength(value: string): string {
  return `${new TextEncoder().encode(value).byteLength}:${value}`;
}

const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Synchronous, dependency-free SHA-256 for shared Browser/CommonJS builds. */
function sha256Hex(input: Uint8Array): string {
  const bitLength = input.byteLength * 8;
  const paddedLength = Math.ceil((input.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.byteLength] = 0x80;
  const paddedView = new DataView(padded.buffer);
  paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  paddedView.setUint32(paddedLength - 4, bitLength >>> 0);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = paddedView.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = schedule[index - 15]!;
      const right = schedule[index - 2]!;
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      schedule[index] = (
        schedule[index - 16]! + sigma0 + schedule[index - 7]! + sigma1
      ) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temporary1 = (
        h! + sigma1 + choice + SHA256_ROUND_CONSTANTS[index]! + schedule[index]!
      ) >>> 0;
      const sigma0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temporary2 = (sigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = (hash[0]! + a!) >>> 0;
    hash[1] = (hash[1]! + b!) >>> 0;
    hash[2] = (hash[2]! + c!) >>> 0;
    hash[3] = (hash[3]! + d!) >>> 0;
    hash[4] = (hash[4]! + e!) >>> 0;
    hash[5] = (hash[5]! + f!) >>> 0;
    hash[6] = (hash[6]! + g!) >>> 0;
    hash[7] = (hash[7]! + h!) >>> 0;
  }
  return [...hash].map((value) => value.toString(16).padStart(8, "0")).join("");
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

function bytesToHex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
