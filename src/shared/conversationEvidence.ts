import type {
  ConversationEvidenceTarget,
  ConversationFactKind,
} from "./conversationDisclosure";
import type { ChatTaskStatusEvent } from "./chat";

export const CONVERSATION_SOURCE_PAGE_SCHEMA_VERSION = 1 as const;
export const CONVERSATION_SOURCE_PAGE_DEFAULT_LIMIT = 50;
export const CONVERSATION_SOURCE_PAGE_MAX_LIMIT = 200;
export const CONVERSATION_SOURCE_PAGE_MAX_CURSOR_BYTES = 4_096;

export type ConversationPagedSource =
  | "chat_activity"
  | "trajectory"
  | "workspace_run";

export type ConversationSourcePageStatus =
  | "complete"
  | "partial"
  | "unavailable"
  | "incompatible";

export type ConversationSourcePageOptions = {
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
};

export type ConversationChatActivityRecord = {
  eventId: string;
  sequence: number;
  event: ChatTaskStatusEvent;
  legacy: boolean;
};

export type ConversationSourcePage<T> = {
  schemaVersion: 1;
  source: ConversationPagedSource;
  sourceId: string;
  queryHash: string;
  sourceRevision: string;
  status: ConversationSourcePageStatus;
  records: T[];
  nextCursor?: string;
  reasonCode?: string;
};

export type ConversationSourceCursorBinding = {
  source: ConversationPagedSource;
  sourceId: string;
  queryHash: string;
  sourceRevision: string;
  position: number;
};

export type ConversationEvidenceRequest = {
  schemaVersion: 1;
  anchor: string;
  target: ConversationEvidenceTarget;
  cursor?: string;
  limit?: number;
};

export type ConversationEvidenceEntry = {
  id: string;
  kind: string;
  status?: string;
  summary?: string;
  occurredAt?: string;
  sequence?: number;
  count?: number;
  ok?: boolean;
};

export type ConversationEvidenceOutcome =
  | {
      kind: "found";
      entries: ConversationEvidenceEntry[];
      complete: boolean;
      nextCursor?: string;
    }
  | {
      kind: "redacted";
      reasonCode: "sensitive_detail_redacted";
    }
  | {
      kind: "missing";
      reasonCode: "evidence_not_found";
    }
  | {
      kind: "forbidden";
      reasonCode: "not_authorized";
    }
  | {
      kind: "incompatible";
      reasonCode:
        | "anchor_invalid"
        | "anchor_expired"
        | "cursor_invalid"
        | "authority_changed"
        | "target_mismatch";
    };

export type ConversationEvidenceResponse =
  | {
      ok: true;
      result: ConversationEvidenceOutcome;
    }
  | {
      ok: false;
      error: {
        code: "resolver_unavailable";
        retryable: boolean;
      };
    };

export function normalizeConversationSourcePageLimit(
  value: number | undefined,
): number {
  const parsed = Math.floor(Number(value ?? CONVERSATION_SOURCE_PAGE_DEFAULT_LIMIT));
  if (!Number.isFinite(parsed)) return CONVERSATION_SOURCE_PAGE_DEFAULT_LIMIT;
  return Math.max(1, Math.min(parsed, CONVERSATION_SOURCE_PAGE_MAX_LIMIT));
}

export function createConversationSourceQueryHash(input: {
  source: ConversationPagedSource;
  sourceId: string;
  filters?: unknown;
}): string {
  return `query:${fnv1a64(canonicalSerialize([
    input.source,
    input.sourceId,
    input.filters ?? null,
  ]))}`;
}

export function createConversationSourceRevision(input: {
  source: ConversationPagedSource;
  sourceId: string;
  authority: unknown;
}): string {
  return `cut:${fnv1a64(canonicalSerialize([
    input.source,
    input.sourceId,
    input.authority,
  ]))}`;
}

export function createConversationSourceCursor(
  binding: ConversationSourceCursorBinding,
): string {
  assertCursorBinding(binding);
  const body = canonicalSerialize({
    position: binding.position,
    queryHash: binding.queryHash,
    source: binding.source,
    sourceId: binding.sourceId,
    sourceRevision: binding.sourceRevision,
    version: CONVERSATION_SOURCE_PAGE_SCHEMA_VERSION,
  });
  return `csp1.${fnv1a64(body)}.${encodeURIComponent(body)}`;
}

export function parseConversationSourceCursor(
  cursor: string | undefined,
  expected: Omit<ConversationSourceCursorBinding, "position" | "sourceRevision">
    & { sourceRevision?: string },
):
  | { kind: "start"; position: 0 }
  | { kind: "position"; position: number; sourceRevision: string }
  | { kind: "incompatible"; reasonCode: "source_cursor_mismatch" } {
  if (!cursor) return { kind: "start", position: 0 };
  if (byteLength(cursor) > CONVERSATION_SOURCE_PAGE_MAX_CURSOR_BYTES) {
    return { kind: "incompatible", reasonCode: "source_cursor_mismatch" };
  }
  const [version, checksum, encodedBody, ...extra] = cursor.split(".");
  if (version !== "csp1" || !checksum || !encodedBody || extra.length > 0) {
    return { kind: "incompatible", reasonCode: "source_cursor_mismatch" };
  }
  try {
    const body = decodeURIComponent(encodedBody);
    if (fnv1a64(body) !== checksum) {
      return { kind: "incompatible", reasonCode: "source_cursor_mismatch" };
    }
    const parsed = JSON.parse(body) as Partial<ConversationSourceCursorBinding> & {
      version?: unknown;
    };
    if (
      parsed.version !== CONVERSATION_SOURCE_PAGE_SCHEMA_VERSION
      || parsed.source !== expected.source
      || parsed.sourceId !== expected.sourceId
      || parsed.queryHash !== expected.queryHash
      || (expected.sourceRevision !== undefined
        && parsed.sourceRevision !== expected.sourceRevision)
      || typeof parsed.sourceRevision !== "string"
      || !parsed.sourceRevision
      || !Number.isSafeInteger(parsed.position)
      || Number(parsed.position) < 0
    ) {
      return { kind: "incompatible", reasonCode: "source_cursor_mismatch" };
    }
    return {
      kind: "position",
      position: Number(parsed.position),
      sourceRevision: parsed.sourceRevision,
    };
  } catch {
    return { kind: "incompatible", reasonCode: "source_cursor_mismatch" };
  }
}

export function createConversationSourcePage<T>(input: {
  source: ConversationPagedSource;
  sourceId: string;
  queryHash: string;
  sourceRevision: string;
  status: ConversationSourcePageStatus;
  records: readonly T[];
  nextPosition?: number;
  reasonCode?: string;
}): ConversationSourcePage<T> {
  if (!input.sourceId || !input.queryHash || !input.sourceRevision) {
    throw new Error("conversation source page identity is incomplete");
  }
  if (input.status === "complete" && input.reasonCode) {
    throw new Error("complete conversation source page cannot have a reason");
  }
  if (input.status !== "complete" && !input.reasonCode) {
    throw new Error("incomplete conversation source page requires a reason");
  }
  if (
    input.nextPosition !== undefined
    && (!Number.isSafeInteger(input.nextPosition) || input.nextPosition < 0)
  ) {
    throw new Error("conversation source page next position is invalid");
  }
  return {
    schemaVersion: CONVERSATION_SOURCE_PAGE_SCHEMA_VERSION,
    source: input.source,
    sourceId: input.sourceId,
    queryHash: input.queryHash,
    sourceRevision: input.sourceRevision,
    status: input.status,
    records: structuredClone([...input.records]),
    ...(input.nextPosition !== undefined
      ? {
          nextCursor: createConversationSourceCursor({
            source: input.source,
            sourceId: input.sourceId,
            queryHash: input.queryHash,
            sourceRevision: input.sourceRevision,
            position: input.nextPosition,
          }),
        }
      : {}),
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
  };
}

export function isConversationFactSource(
  source: ConversationPagedSource,
): source is Extract<
  ConversationFactKind,
  "chat_activity" | "trajectory" | "workspace_run"
> {
  return source === "chat_activity"
    || source === "trajectory"
    || source === "workspace_run";
}

function assertCursorBinding(binding: ConversationSourceCursorBinding): void {
  if (
    !isConversationFactSource(binding.source)
    || !binding.sourceId
    || !binding.queryHash
    || !binding.sourceRevision
    || !Number.isSafeInteger(binding.position)
    || binding.position < 0
  ) {
    throw new Error("conversation source cursor binding is invalid");
  }
}

function canonicalSerialize(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(canonicalSerialize).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalSerialize(record[key])}`
    ).join(",")}}`;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  throw new Error(`unsupported conversation cursor value: ${typeof value}`);
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
