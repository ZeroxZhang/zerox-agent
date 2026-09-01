import type { ConversationAcceptedAttemptSettlement } from "./conversationDisclosure";
import { sanitizeConversationDisclosureSummary } from "./conversationDisclosure";
import { sha256Hex } from "./sha256";

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

function bytesToHex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
