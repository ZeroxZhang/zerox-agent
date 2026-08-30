import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  createConversationContributorAuthorityRevision,
  createConversationDisclosureScope,
  redactConversationDisclosurePaths,
  sanitizeConversationDisclosureSummary,
  type ConversationDisclosureScope,
  type ConversationDisclosureSnapshot,
  type ConversationEvidenceTarget,
} from "../shared/conversationDisclosure";
import { redactCredentialString } from "../shared/credentialRedaction";
import {
  type ConversationEvidenceEntry,
  type ConversationEvidenceRequest,
  type ConversationEvidenceResponse,
} from "../shared/conversationEvidence";

export const CONVERSATION_EVIDENCE_MAX_ENTRIES = 100;
export const CONVERSATION_EVIDENCE_MAX_BYTES = 64 * 1024;
export const CONVERSATION_EVIDENCE_ANCHOR_TTL_MS = 5 * 60_000;

export type TrustedConversationEvidenceContext = {
  actorId: string;
  scope: ConversationDisclosureScope;
  workspaceId?: string;
  allowTechnical: boolean;
  allowRestricted: boolean;
};

export type ConversationEvidenceBackendResult =
  | {
      kind: "found";
      authorityRevision: string;
      entries: readonly ConversationEvidenceEntry[];
      complete: boolean;
      nextPosition?: number;
    }
  | { kind: "redacted" }
  | { kind: "missing" }
  | {
      kind: "incompatible";
      reasonCode: "authority_changed" | "target_mismatch";
    };

export type ConversationEvidenceBackend = {
  resolve(input: {
    target: ConversationEvidenceTarget;
    position: number;
    limit: number;
    expectedAuthorityRevision?: string;
    trustedContext: TrustedConversationEvidenceContext;
  }): Promise<ConversationEvidenceBackendResult>;
};

export type ConversationEvidenceResolver = {
  issueAnchor(input: {
    snapshot: ConversationDisclosureSnapshot;
    itemId: string;
  }): string;
  issueContributorAnchor(input: {
    snapshot: ConversationDisclosureSnapshot;
    itemId: string;
  }): {
    anchor: string;
    target: Extract<
      ConversationEvidenceTarget,
      { kind: "contributor_page" }
    >;
  };
  resolve(
    request: ConversationEvidenceRequest,
    trustedContext: TrustedConversationEvidenceContext,
  ): Promise<ConversationEvidenceResponse>;
};

type AnchorPayload = {
  version: 1;
  scopeKey: string;
  queryHash: string;
  sessionId?: string;
  goalId?: string;
  runId?: string;
  generation: string;
  projectionVersion: number;
  snapshotCursor: number;
  itemId: string;
  targetHash: string;
  authorityRevision?: string;
  sensitivity: "public_summary" | "technical" | "restricted";
  issuedAt: number;
  expiresAt: number;
};

type CursorPayload = {
  version: 1;
  anchorHash: string;
  targetHash: string;
  authorityRevision: string;
  position: number;
  limit: number;
};

export function createConversationEvidenceResolver(options: {
  backend: ConversationEvidenceBackend;
  getCurrentSnapshot: (
    scope: ConversationDisclosureScope,
  ) => Promise<ConversationDisclosureSnapshot>;
  canResolve: (input: {
    target: ConversationEvidenceTarget;
    trustedContext: TrustedConversationEvidenceContext;
  }) => boolean | Promise<boolean>;
  secret?: Uint8Array;
  now?: () => number;
  anchorTtlMs?: number;
}): ConversationEvidenceResolver {
  const secret = Buffer.from(options.secret ?? randomBytes(32));
  if (secret.byteLength < 32) {
    throw new Error("conversation evidence resolver secret is too short");
  }
  const now = options.now ?? Date.now;
  const anchorTtlMs = normalizePositive(
    options.anchorTtlMs,
    CONVERSATION_EVIDENCE_ANCHOR_TTL_MS,
  );

  return {
    issueAnchor({ snapshot, itemId }) {
      const item = snapshot.items.find((candidate) => candidate.id === itemId);
      if (!item?.evidenceTarget) {
        throw new Error("conversation item has no evidence target");
      }
      const issuedAt = now();
      return signToken("eva1", {
        version: 1,
        scopeKey: snapshot.scope.key,
        queryHash: snapshot.scope.queryHash,
        ...(snapshot.scope.sessionId
          ? { sessionId: snapshot.scope.sessionId }
          : {}),
        ...(snapshot.scope.goalId ? { goalId: snapshot.scope.goalId } : {}),
        ...(snapshot.scope.runId ? { runId: snapshot.scope.runId } : {}),
        generation: snapshot.generation,
        projectionVersion: snapshot.projectionVersion,
        snapshotCursor: snapshot.cursor,
        itemId,
        targetHash: hashTarget(item.evidenceTarget),
        authorityRevision: sourceAuthorityRevision(item.primarySource),
        sensitivity: item.sensitivity,
        issuedAt,
        expiresAt: issuedAt + anchorTtlMs,
      } satisfies AnchorPayload, secret);
    },

    issueContributorAnchor({ snapshot, itemId }) {
      const item = snapshot.items.find((candidate) => candidate.id === itemId);
      if (!item || item.contributorCount === 0) {
        throw new Error("conversation item has no contributor evidence");
      }
      const target = {
        schemaVersion: 1 as const,
        kind: "contributor_page" as const,
        scopeKey: snapshot.scope.key,
        generation: snapshot.generation,
        itemId,
      };
      const issuedAt = now();
      return {
        anchor: signToken("eva1", {
          version: 1,
          scopeKey: snapshot.scope.key,
          queryHash: snapshot.scope.queryHash,
          ...(snapshot.scope.sessionId
            ? { sessionId: snapshot.scope.sessionId }
            : {}),
          ...(snapshot.scope.goalId
            ? { goalId: snapshot.scope.goalId }
            : {}),
          ...(snapshot.scope.runId ? { runId: snapshot.scope.runId } : {}),
          generation: snapshot.generation,
          projectionVersion: snapshot.projectionVersion,
          snapshotCursor: snapshot.cursor,
          itemId,
          targetHash: hashTarget(target),
          authorityRevision:
            createConversationContributorAuthorityRevision({
              generation: snapshot.generation,
              item,
            }),
          sensitivity: item.sensitivity,
          issuedAt,
          expiresAt: issuedAt + anchorTtlMs,
        } satisfies AnchorPayload, secret),
        target,
      };
    },

    async resolve(request, trustedContext) {
      try {
        if (request.schemaVersion !== 1) {
          return incompatible("anchor_invalid");
        }
        const anchor = verifyToken<AnchorPayload>(
          request.anchor,
          "eva1",
          secret,
        );
        if (!validAnchor(anchor)) return incompatible("anchor_invalid");
        if (anchor.expiresAt < now()) return incompatible("anchor_expired");
        if (
          anchor.targetHash !== hashTarget(request.target)
          || !scopeMatches(anchor, trustedContext)
        ) {
          return incompatible("target_mismatch");
        }
        if (
          (anchor.sensitivity === "restricted"
            && !trustedContext.allowRestricted)
          || (anchor.sensitivity === "technical"
            && !trustedContext.allowTechnical)
        ) {
          return forbidden();
        }
        if (!await options.canResolve({
          target: request.target,
          trustedContext,
        })) {
          return forbidden();
        }
        const currentAnchorMatches = async () => {
          const currentSnapshot = await options.getCurrentSnapshot(
            trustedContext.scope,
          );
          const currentItem = currentSnapshot.items.find(
            (candidate) => candidate.id === anchor.itemId,
          );
          const currentAuthorityRevision = currentItem
            ? request.target.kind === "contributor_page"
              ? createConversationContributorAuthorityRevision({
                  generation: currentSnapshot.generation,
                  item: currentItem,
                })
              : currentItem.evidenceTarget
                  && hashTarget(currentItem.evidenceTarget)
                    === anchor.targetHash
                ? sourceAuthorityRevision(currentItem.primarySource)
                : null
            : null;
          return currentSnapshot.scope.key === anchor.scopeKey
            && currentSnapshot.scope.queryHash === anchor.queryHash
            && currentSnapshot.generation === anchor.generation
            && currentSnapshot.projectionVersion === anchor.projectionVersion
            && currentItem?.sensitivity === anchor.sensitivity
            && currentAuthorityRevision === anchor.authorityRevision;
        };
        if (!await currentAnchorMatches()) {
          return incompatible("authority_changed");
        }

        const requestedLimit = normalizeLimit(request.limit);
        let position = 0;
        let expectedAuthorityRevision = anchor.authorityRevision;
        if (request.cursor) {
          const cursor = verifyToken<CursorPayload>(
            request.cursor,
            "evc1",
            secret,
          );
          if (
            !validCursor(cursor)
            || cursor.anchorHash !== tokenHash(request.anchor)
            || cursor.targetHash !== anchor.targetHash
            || cursor.limit !== requestedLimit
            || (
              anchor.authorityRevision
              && cursor.authorityRevision !== anchor.authorityRevision
            )
          ) {
            return incompatible("cursor_invalid");
          }
          position = cursor.position;
          expectedAuthorityRevision = cursor.authorityRevision;
        }

        const resolved = await options.backend.resolve({
          target: request.target,
          position,
          limit: requestedLimit,
          ...(expectedAuthorityRevision
            ? { expectedAuthorityRevision }
            : {}),
          trustedContext,
        });
        if (!await options.canResolve({
          target: request.target,
          trustedContext,
        })) {
          return forbidden();
        }
        if (!await currentAnchorMatches()) {
          return incompatible("authority_changed");
        }
        if (resolved.kind === "missing") {
          return { ok: true, result: {
            kind: "missing",
            reasonCode: "evidence_not_found",
          } };
        }
        if (resolved.kind === "redacted") {
          return { ok: true, result: {
            kind: "redacted",
            reasonCode: "sensitive_detail_redacted",
          } };
        }
        if (resolved.kind === "incompatible") {
          return incompatible(resolved.reasonCode);
        }
        if (
          expectedAuthorityRevision
          && expectedAuthorityRevision !== resolved.authorityRevision
        ) {
          return incompatible("authority_changed");
        }

        const entries = boundEntries(resolved.entries, requestedLimit);
        const locallyTruncated = entries.length < resolved.entries.length;
        const complete = resolved.complete && !locallyTruncated;
        const nextPosition = locallyTruncated
          ? position + entries.length
          : resolved.nextPosition;
        if (
          nextPosition !== undefined
          && (
            !Number.isSafeInteger(nextPosition)
            || nextPosition <= position
          )
        ) {
          throw new Error("evidence backend returned a non-advancing page");
        }
        const nextCursor = nextPosition === undefined
          ? undefined
          : signToken("evc1", {
              version: 1,
              anchorHash: tokenHash(request.anchor),
              targetHash: anchor.targetHash,
              authorityRevision: resolved.authorityRevision,
              position: nextPosition,
              limit: requestedLimit,
            } satisfies CursorPayload, secret);
        return {
          ok: true,
          result: {
            kind: "found",
            entries,
            complete: complete && nextCursor === undefined,
            ...(nextCursor ? { nextCursor } : {}),
          },
        };
      } catch {
        return {
          ok: false,
          error: {
            code: "resolver_unavailable",
            retryable: true,
          },
        };
      }
    },
  };
}

function boundEntries(
  input: readonly ConversationEvidenceEntry[],
  limit: number,
): ConversationEvidenceEntry[] {
  const result: ConversationEvidenceEntry[] = [];
  let bytes = 2;
  for (const raw of input.slice(0, limit)) {
    const entry = allowlistEntry(raw);
    const nextBytes = Buffer.byteLength(JSON.stringify(entry), "utf8")
      + (result.length > 0 ? 1 : 0);
    if (bytes + nextBytes > CONVERSATION_EVIDENCE_MAX_BYTES) break;
    result.push(entry);
    bytes += nextBytes;
  }
  return result;
}

function allowlistEntry(input: ConversationEvidenceEntry): ConversationEvidenceEntry {
  return {
    id: safeEvidenceScalar(input.id, 256, 1),
    kind: safeEvidenceScalar(input.kind, 128, 1),
    ...(input.status
      ? { status: safeEvidenceScalar(input.status, 128, 1) }
      : {}),
    ...(input.summary
      ? {
          summary: safeEvidenceScalar(input.summary, 2_048, 8),
        }
      : {}),
    ...(input.occurredAt
      ? { occurredAt: safeEvidenceScalar(input.occurredAt, 64, 1) }
      : {}),
    ...(Number.isSafeInteger(input.sequence)
      ? { sequence: input.sequence }
      : {}),
    ...(Number.isSafeInteger(input.count) ? { count: input.count } : {}),
    ...(typeof input.ok === "boolean" ? { ok: input.ok } : {}),
  };
}

function signToken(prefix: string, payload: unknown, secret: Buffer): string {
  const encoded = Buffer.from(canonicalJson(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${prefix}.${encoded}.${signature}`;
}

function verifyToken<T>(
  token: string,
  prefix: string,
  secret: Buffer,
): T | null {
  if (typeof token !== "string" || token.length > 16_384) return null;
  const [actualPrefix, encoded, signature, ...extra] = token.split(".");
  if (
    actualPrefix !== prefix
    || !encoded
    || !signature
    || extra.length > 0
  ) {
    return null;
  }
  const expected = createHmac("sha256", secret)
    .update(encoded)
    .digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function scopeMatches(
  anchor: AnchorPayload,
  context: TrustedConversationEvidenceContext,
): boolean {
  const canonical = createConversationDisclosureScope(context.scope);
  if (
    canonical.key !== context.scope.key
    || canonical.queryHash !== context.scope.queryHash
  ) {
    return false;
  }
  return anchor.scopeKey === context.scope.key
    && anchor.queryHash === context.scope.queryHash
    && anchor.sessionId === context.scope.sessionId
    && anchor.goalId === context.scope.goalId
    && anchor.runId === context.scope.runId;
}

function validAnchor(value: AnchorPayload | null): value is AnchorPayload {
  return Boolean(
    value
    && value.version === 1
    && value.scopeKey
    && value.queryHash
    && value.generation
    && value.projectionVersion === 1
    && Number.isSafeInteger(value.snapshotCursor)
    && value.snapshotCursor >= 0
    && value.itemId
    && value.targetHash
    && (
      value.authorityRevision === undefined
      || (
        typeof value.authorityRevision === "string"
        && value.authorityRevision.length > 0
      )
    )
    && ["public_summary", "technical", "restricted"].includes(value.sensitivity)
    && Number.isSafeInteger(value.issuedAt)
    && Number.isSafeInteger(value.expiresAt)
    && value.expiresAt >= value.issuedAt,
  );
}

function validCursor(value: CursorPayload | null): value is CursorPayload {
  return Boolean(
    value
    && value.version === 1
    && value.anchorHash
    && value.targetHash
    && value.authorityRevision
    && Number.isSafeInteger(value.position)
    && value.position >= 0
    && Number.isSafeInteger(value.limit)
    && value.limit >= 1
    && value.limit <= CONVERSATION_EVIDENCE_MAX_ENTRIES,
  );
}

function forbidden(): ConversationEvidenceResponse {
  return {
    ok: true,
    result: {
      kind: "forbidden",
      reasonCode: "not_authorized",
    },
  };
}

function incompatible(
  reasonCode:
    | "anchor_invalid"
    | "anchor_expired"
    | "cursor_invalid"
    | "authority_changed"
    | "target_mismatch",
): ConversationEvidenceResponse {
  return { ok: true, result: { kind: "incompatible", reasonCode } };
}

function normalizeLimit(value: number | undefined): number {
  const parsed = Math.floor(Number(value ?? 50));
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(parsed, CONVERSATION_EVIDENCE_MAX_ENTRIES));
}

function safeEvidenceScalar(
  value: string,
  maxBytes: number,
  maxLines: number,
): string {
  return sanitizeConversationDisclosureSummary(
    redactConversationDisclosurePaths(redactCredentialString(value)),
    { maxBytes, maxLines },
  ).text;
}

function hashTarget(target: ConversationEvidenceTarget): string {
  return createHmac("sha256", "conversation-evidence-target-v1")
    .update(canonicalJson(target))
    .digest("hex");
}

function sourceAuthorityRevision(
  source: ConversationDisclosureSnapshot["items"][number]["primarySource"],
): string {
  return `${source.domainRevision ?? "legacy"}\0${source.domainStatus}`;
}

function tokenHash(token: string): string {
  return createHmac("sha256", "conversation-evidence-anchor-v1")
    .update(token)
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  throw new Error(`unsupported evidence token value: ${typeof value}`);
}

function normalizePositive(value: number | undefined, fallback: number): number {
  const parsed = Math.floor(Number(value ?? fallback));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
