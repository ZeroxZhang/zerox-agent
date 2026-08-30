import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  applyConversationDisclosureDelta,
  createConversationContributorAuthorityRevision,
  createConversationContributorPage,
  createConversationDisclosureDeltaId,
  createConversationDisclosureScope,
  normalizeConversationContributorRefs,
  projectConversationDisclosureContributorSets,
  projectConversationDisclosureSnapshot,
  type ActiveConversationAttempt,
  type ConversationDisclosureDelta,
  type ConversationDisclosureItem,
  type ConversationProjectionSeed,
  type ConversationDisclosureScope,
  type ConversationDisclosureSourceRef,
  type ConversationDisclosureSnapshot,
  type ConversationAttemptSettlement,
  type ConversationSourceCut,
} from "../shared/conversationDisclosure";
import {
  adaptConversationDisclosureSources,
  type ConversationDisclosureAdapterReadSet,
} from "./conversationDisclosureAdapters";

export const CONVERSATION_DISCLOSURE_RING_DEFAULT_ENTRIES = 128;
export const CONVERSATION_DISCLOSURE_RING_DEFAULT_BYTES = 512 * 1024;
export const CONVERSATION_DISCLOSURE_RING_DEFAULT_AGE_MS = 5 * 60_000;

export type ConversationDisclosureMaterializationResult =
  | {
      kind: "snapshot";
      reason: "initial";
      snapshot: ConversationDisclosureSnapshot;
    }
  | {
      kind: "delta";
      delta: ConversationDisclosureDelta;
      snapshot: ConversationDisclosureSnapshot;
    }
  | {
      kind: "duplicate";
      snapshot: ConversationDisclosureSnapshot;
    }
  | {
      kind: "reset";
      reason: string;
      snapshot: ConversationDisclosureSnapshot;
    };

export type ConversationDisclosureReplayResult =
  | { kind: "deltas"; deltas: ConversationDisclosureDelta[] }
  | {
      kind: "reset";
      reason: string;
      snapshot: ConversationDisclosureSnapshot;
    };

export type ConversationDisclosureMaterializerPublication =
  | { kind: "delta"; delta: ConversationDisclosureDelta }
  | {
      kind: "reset";
      reason: string;
      snapshot: ConversationDisclosureSnapshot;
    };

export type ConversationDisclosureMaterializer = {
  refresh(
    scope: ConversationDisclosureScope,
    signal?: AbortSignal,
  ): Promise<ConversationDisclosureMaterializationResult>;
  snapshot(
    scope: ConversationDisclosureScope,
    signal?: AbortSignal,
  ): Promise<ConversationDisclosureSnapshot>;
  replay(
    scope: ConversationDisclosureScope,
    anchor: { generation: string; cursor: number },
    signal?: AbortSignal,
  ): Promise<ConversationDisclosureReplayResult>;
  replayRetention(
    scope: ConversationDisclosureScope,
    signal?: AbortSignal,
  ): Promise<{
    generation: string;
    cursor: number;
    ringEntries: number;
    protectedRingEntries: number;
    ringBytes: number;
  } | null>;
  connect(
    scope: ConversationDisclosureScope,
    listener: (publication: ConversationDisclosureMaterializerPublication) => void,
    signal?: AbortSignal,
  ): Promise<{
    snapshot: ConversationDisclosureSnapshot;
    close(): void;
  }>;
  contributorPage(
    scope: ConversationDisclosureScope,
    itemId: string,
    options: {
      expectedGeneration: string;
      afterInline?: boolean;
      position?: number;
      limit?: number;
    },
    signal?: AbortSignal,
  ): Promise<{
    kind: "page";
    refs: ConversationDisclosureSourceRef[];
    total: number;
    complete: boolean;
    nextPosition?: number;
    authorityRevision: string;
  } | { kind: "incompatible" } | null>;
  close(): Promise<void>;
};

type RingEntry = {
  delta: ConversationDisclosureDelta;
  bytes: number;
  createdAt: number;
  protected: boolean;
};

type ScopeState = {
  scope: ConversationDisclosureScope;
  snapshot: ConversationDisclosureSnapshot;
  contributors: Map<string, ConversationDisclosureSourceRef[]>;
  ring: RingEntry[];
  listeners: Set<{
    listener: (
      publication: ConversationDisclosureMaterializerPublication
    ) => void;
  }>;
  connectionClosers: Set<() => void>;
};

type LoadedProjection = {
  snapshot: ConversationDisclosureSnapshot;
  contributors: Map<string, ConversationDisclosureSourceRef[]>;
};

export function createConversationDisclosureMaterializer(options: {
  load: (
    scope: ConversationDisclosureScope,
    signal?: AbortSignal,
  ) => Promise<ConversationDisclosureAdapterReadSet>;
  createGenerationId?: () => string;
  now?: () => number;
  maxRingEntries?: number;
  maxRingBytes?: number;
  maxRingAgeMs?: number;
}): ConversationDisclosureMaterializer {
  const processEpoch = randomUUID();
  const createGenerationId = options.createGenerationId
    ?? (() => randomUUID());
  const now = options.now ?? Date.now;
  const maxRingEntries = positiveLimit(
    options.maxRingEntries,
    CONVERSATION_DISCLOSURE_RING_DEFAULT_ENTRIES,
  );
  const maxRingBytes = positiveLimit(
    options.maxRingBytes,
    CONVERSATION_DISCLOSURE_RING_DEFAULT_BYTES,
  );
  const maxRingAgeMs = positiveLimit(
    options.maxRingAgeMs,
    CONVERSATION_DISCLOSURE_RING_DEFAULT_AGE_MS,
  );
  const states = new Map<string, ScopeState>();
  const queues = new Map<string, Promise<void>>();
  let generationOrdinal = 0;
  let closed = false;

  const serialize = <T>(scopeKey: string, operation: () => Promise<T>) => {
    const current = queues.get(scopeKey) ?? Promise.resolve();
    const result = current.then(operation, operation);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    queues.set(scopeKey, settled);
    void settled.finally(() => {
      if (queues.get(scopeKey) === settled) queues.delete(scopeKey);
    });
    return result;
  };

  const newGeneration = () => {
    generationOrdinal += 1;
    return `generation:${processEpoch}:${generationOrdinal}:${createGenerationId()}`;
  };

  async function loadSnapshot(
    scope: ConversationDisclosureScope,
    generation: string,
    cursor: number,
    signal?: AbortSignal,
  ): Promise<LoadedProjection> {
    throwIfAborted(signal);
    const readSet = await options.load(scope, signal);
    throwIfAborted(signal);
    const canonicalScope = createConversationDisclosureScope(scope);
    if (
      readSet.scope.key !== canonicalScope.key
      || readSet.scope.queryHash !== canonicalScope.queryHash
    ) {
      throw new Error("materializer source loader returned a different scope");
    }
    const batch = adaptConversationDisclosureSources(readSet);
    const { activeAttempts, attemptSettlements } =
      projectCausalAttemptState(readSet);
    const snapshot = projectConversationDisclosureSnapshot({
      scope: canonicalScope,
      generation,
      cursor,
      expectedSourceCuts: batch.sourceCuts,
      seeds: batch.seeds,
      unknownFacts: batch.unknownFacts,
      activeAttempts,
      attemptSettlements,
    });
    return {
      snapshot,
      contributors: buildContributorSets(batch.seeds, snapshot),
    };
  }

  async function refreshLocked(
    scope: ConversationDisclosureScope,
    signal?: AbortSignal,
  ): Promise<ConversationDisclosureMaterializationResult> {
    assertOpen(closed);
    const canonicalScope = createConversationDisclosureScope(scope);
    const current = states.get(canonicalScope.key);
    if (!current) {
      const loaded = await loadSnapshot(
        canonicalScope,
        newGeneration(),
        0,
        signal,
      );
      states.set(canonicalScope.key, {
        scope: canonicalScope,
        snapshot: loaded.snapshot,
        contributors: loaded.contributors,
        ring: [],
        listeners: new Set(),
        connectionClosers: new Set(),
      });
      return {
        kind: "snapshot",
        reason: "initial",
        snapshot: clone(loaded.snapshot),
      };
    }

    const loaded = await loadSnapshot(
      canonicalScope,
      current.snapshot.generation,
      current.snapshot.cursor,
      signal,
    );
    const removedSource = current.snapshot.sourceCuts.some((cut) =>
      !isPreservedUnavailableCut(cut)
      && !loaded.snapshot.sourceCuts.some(
        (candidate) => sourceCutKey(candidate) === sourceCutKey(cut),
      ));
    const preserved = preserveTerminalTruth(current, loaded);
    const projected = preserved.snapshot;
    const rotationReason = removedSource
      ? "source_set_changed"
      : generationRotationReason(current.snapshot, projected);
    if (rotationReason) {
      return rotateAndPublish(
        current,
        projected,
        preserved.contributors,
        rotationReason,
        newGeneration(),
      );
    }
    const delta = createDelta(current.snapshot, projected);
    if (!delta) {
      return { kind: "duplicate", snapshot: clone(current.snapshot) };
    }
    const reduced = applyConversationDisclosureDelta(current.snapshot, delta);
    if (reduced.kind === "duplicate") {
      return { kind: "duplicate", snapshot: clone(current.snapshot) };
    }
    if (reduced.kind === "reset_required") {
      return rotateAndPublish(
        current,
        projected,
        preserved.contributors,
        reduced.reason,
        newGeneration(),
      );
    }
    const expectedSnapshot: ConversationDisclosureSnapshot = {
      ...projected,
      cursor: delta.toCursor,
      lastDeltaId: delta.deltaId,
    };
    if (!isDeepStrictEqual(reduced.state, expectedSnapshot)) {
      return rotateAndPublish(
        current,
        projected,
        preserved.contributors,
        "projection_delta_diverged",
        newGeneration(),
      );
    }
    const entry: RingEntry = {
      delta: clone(delta),
      bytes: utf8Bytes(delta),
      createdAt: now(),
      protected: isProtectedDelta(delta, current.snapshot),
    };
    current.snapshot = reduced.state;
    current.contributors = preserved.contributors;
    current.ring.push(entry);
    const ringResult = enforceRingBounds(
      current,
      now(),
      maxRingEntries,
      maxRingBytes,
      maxRingAgeMs,
    );
    if (ringResult === "rotate") {
      return rotateAndPublish(
        current,
        projected,
        preserved.contributors,
        "protected_replay_pressure",
        newGeneration(),
      );
    }
    notifyListeners(current, { kind: "delta", delta });
    return {
      kind: "delta",
      delta: clone(delta),
      snapshot: clone(current.snapshot),
    };
  }

  return {
    refresh(scope, signal) {
      const canonical = createConversationDisclosureScope(scope);
      return serialize(canonical.key, () => refreshLocked(canonical, signal));
    },

    snapshot(scope, signal) {
      const canonical = createConversationDisclosureScope(scope);
      return serialize(canonical.key, async () => {
        assertOpen(closed);
        throwIfAborted(signal);
        const existing = states.get(canonical.key);
        if (existing) return clone(existing.snapshot);
        const result = await refreshLocked(canonical, signal);
        return clone(result.snapshot);
      });
    },

    replay(scope, anchor, signal) {
      const canonical = createConversationDisclosureScope(scope);
      return serialize(canonical.key, async () => {
        assertOpen(closed);
        throwIfAborted(signal);
        const state = states.get(canonical.key);
        if (!state) {
          const result = await refreshLocked(canonical, signal);
          return {
            kind: "reset" as const,
            reason: "scope_not_materialized",
            snapshot: clone(result.snapshot),
          };
        }
        if (
          anchor.generation !== state.snapshot.generation
          || !Number.isSafeInteger(anchor.cursor)
          || anchor.cursor < 0
          || anchor.cursor > state.snapshot.cursor
        ) {
          return replayReset(state, "replay_anchor_mismatch");
        }
        if (anchor.cursor === state.snapshot.cursor) {
          return { kind: "deltas" as const, deltas: [] };
        }
        const available = state.ring.filter(
          (entry) => entry.delta.toCursor > anchor.cursor,
        );
        if (
          available.length === 0
          || available[0]!.delta.fromCursor !== anchor.cursor
          || available.some((entry, index) =>
            index > 0
            && entry.delta.fromCursor !== available[index - 1]!.delta.toCursor)
          || available.at(-1)!.delta.toCursor !== state.snapshot.cursor
        ) {
          return replayReset(state, "replay_ring_miss");
        }
        if (available.some((entry) => now() - entry.createdAt > maxRingAgeMs)) {
          return replayReset(state, "replay_ring_expired");
        }
        return {
          kind: "deltas" as const,
          deltas: available.map((entry) => clone(entry.delta)),
        };
      });
    },

    replayRetention(scope, signal) {
      const canonical = createConversationDisclosureScope(scope);
      return serialize(canonical.key, async () => {
        assertOpen(closed);
        throwIfAborted(signal);
        const state = states.get(canonical.key);
        if (!state) return null;
        return {
          generation: state.snapshot.generation,
          cursor: state.snapshot.cursor,
          ringEntries: state.ring.length,
          protectedRingEntries: state.ring.filter((entry) => entry.protected)
            .length,
          ringBytes: state.ring.reduce(
            (total, entry) => total + entry.bytes,
            0,
          ),
        };
      });
    },

    connect(scope, listener, signal) {
      const canonical = createConversationDisclosureScope(scope);
      return serialize(canonical.key, async () => {
        assertOpen(closed);
        throwIfAborted(signal);
        let state = states.get(canonical.key);
        if (!state) {
          await refreshLocked(canonical, signal);
          state = states.get(canonical.key)!;
        }
        const registration = { listener };
        state.listeners.add(registration);
        let active = true;
        const close = () => {
          if (!active) return;
          active = false;
          state!.listeners.delete(registration);
          state!.connectionClosers.delete(close);
          signal?.removeEventListener("abort", close);
        };
        state.connectionClosers.add(close);
        signal?.addEventListener("abort", close, { once: true });
        if (signal?.aborted) close();
        return {
          snapshot: clone(state.snapshot),
          close,
        };
      });
    },

    contributorPage(scope, itemId, pageOptions, signal) {
      const canonical = createConversationDisclosureScope(scope);
      return serialize(canonical.key, async () => {
        assertOpen(closed);
        throwIfAborted(signal);
        let state = states.get(canonical.key);
        if (!state) {
          await refreshLocked(canonical, signal);
          state = states.get(canonical.key)!;
        }
        if (state.snapshot.generation !== pageOptions.expectedGeneration) {
          return { kind: "incompatible" as const };
        }
        const item = state.snapshot.items.find(
          (candidate) => candidate.id === itemId,
        );
        if (!item) return null;
        const refs = state.contributors.get(itemId) ?? [];
        const basePosition = pageOptions.afterInline
          ? item.contributors.length
          : 0;
        const relativePosition = nonNegativeLimit(pageOptions.position, 0);
        const position = basePosition + relativePosition;
        if (position > refs.length) return null;
        const limit = Math.min(
          100,
          positiveLimit(pageOptions?.limit, 50),
        );
        const page = refs.slice(position, position + limit);
        const nextPosition = position + page.length;
        const knownSetComplete = nextPosition >= refs.length;
        return {
          kind: "page" as const,
          refs: clone(page),
          total: Math.max(0, refs.length - basePosition),
          complete:
            item.contributorSetComplete !== false && knownSetComplete,
          ...(!knownSetComplete
            ? { nextPosition: nextPosition - basePosition }
            : {}),
          authorityRevision: createConversationContributorAuthorityRevision({
            generation: state.snapshot.generation,
            item,
          }),
        };
      });
    },

    async close() {
      closed = true;
      await Promise.all([...queues.values()]);
      for (const state of states.values()) {
        for (const closeConnection of [...state.connectionClosers]) {
          closeConnection();
        }
        state.listeners.clear();
        state.connectionClosers.clear();
      }
      states.clear();
    },
  };
}

function createDelta(
  current: ConversationDisclosureSnapshot,
  next: ConversationDisclosureSnapshot,
): ConversationDisclosureDelta | null {
  const currentItems = new Map(current.items.map((item) => [item.id, item]));
  const nextItems = new Map(next.items.map((item) => [item.id, item]));
  const upserts = next.items.filter((item) =>
    JSON.stringify(currentItems.get(item.id)) !== JSON.stringify(item));
  const removals = current.items
    .filter((item) => !nextItems.has(item.id))
    .map((item) => item.id)
    .sort();
  const currentCuts = new Map(
    current.sourceCuts.map((cut) => [sourceCutKey(cut), cut]),
  );
  const sourceCutChanges = next.sourceCuts.filter((cut) =>
    JSON.stringify(currentCuts.get(sourceCutKey(cut))) !== JSON.stringify(cut));
  if (
    upserts.length === 0
    && removals.length === 0
    && sourceCutChanges.length === 0
    && JSON.stringify(current.coverage) === JSON.stringify(next.coverage)
    && JSON.stringify(current.attemptSettlements)
      === JSON.stringify(next.attemptSettlements)
  ) {
    return null;
  }
  const body = {
    schemaVersion: 1 as const,
    projectionVersion: 1 as const,
    scopeKey: current.scope.key,
    queryHash: current.scope.queryHash,
    generation: current.generation,
    fromCursor: current.cursor,
    toCursor: current.cursor + 1,
    sourceCutChanges,
    coverage: next.coverage,
    attemptControls: [],
    upserts,
    removals,
  };
  return {
    ...body,
    deltaId: createConversationDisclosureDeltaId(body),
  };
}

function preserveTerminalTruth(
  current: ScopeState,
  loaded: LoadedProjection,
): LoadedProjection {
  const nextItems = new Map(
    loaded.snapshot.items.map((item) => [item.id, item]),
  );
  const nextCuts = new Map(
    loaded.snapshot.sourceCuts.map((cut) => [sourceCutKey(cut), cut]),
  );
  const contributors = new Map(loaded.contributors);
  const preservationReasons = new Set<string>();
  let changed = false;
  for (const previous of current.snapshot.items) {
    if (!isTerminalLifecycle(previous.lifecycle)) continue;
    const next = nextItems.get(previous.id);
    const primaryIsMonotonic = Boolean(
      next && isMonotonicTerminalUpdate(previous, next),
    );
    const contributorsAreMonotonic =
      terminalContributorsAreMonotonic(current, loaded, previous.id);
    if (
      primaryIsMonotonic
      && contributorsAreMonotonic
    ) {
      continue;
    }
    changed = true;
    const previousContributors = current.contributors.get(previous.id);
    const nextContributors = loaded.contributors.get(previous.id);
    const mergedContributors = normalizeConversationContributorRefs([
      ...(previousContributors ?? []),
      ...(nextContributors ?? []),
    ]);
    const preservedItem = clone(primaryIsMonotonic ? next! : previous);
    if (mergedContributors.length > 0) {
      const page = createConversationContributorPage({
        scopeKey: previous.scope.key,
        itemId: previous.id,
        contributors: mergedContributors,
      });
      if (page.kind === "page") {
        const contributorSetComplete =
          contributorsAreMonotonic
          && next?.contributorSetComplete !== false;
        preservedItem.contributors = page.refs;
        preservedItem.contributorCount = page.total;
        preservedItem.contributorsComplete =
          page.complete && contributorSetComplete;
        preservedItem.contributorSetComplete = contributorSetComplete;
        if (page.nextCursor) {
          preservedItem.contributorCursor = page.nextCursor;
        } else {
          delete preservedItem.contributorCursor;
        }
      }
      contributors.set(previous.id, mergedContributors);
    } else if (previousContributors) {
      contributors.set(previous.id, clone(previousContributors));
    }
    nextItems.set(previous.id, preservedItem);
    if (!primaryIsMonotonic) {
      preservationReasons.add("terminal_regression_preserved");
      const key = sourceCutKeyForItem(previous);
      const previousCut = current.snapshot.sourceCuts.find(
        (cut) => sourceCutKey(cut) === key,
      );
      const nextCut = nextCuts.get(key);
      const requiredness = stricterRequiredness(
        previousCut?.requiredness ?? "optional",
        nextCut?.requiredness ?? "ignorable",
      );
      nextCuts.set(key, nextCut?.status === "incompatible"
        ? { ...nextCut, requiredness }
        : {
            source: previous.primarySource.kind,
            sourceIdentity: `record:${previous.primarySource.ref}`,
            requiredness,
            status: "unavailable",
            reasonCode: "terminal_regression_preserved",
          });
    }
    if (!contributorsAreMonotonic) {
      preservationReasons.add("terminal_contributor_regression_preserved");
      const nextContributorIdentities = new Set(
        (nextContributors ?? []).map(contributorIdentity),
      );
      for (const contributor of previousContributors ?? []) {
        const key = sourceRefCutKey(contributor);
        if (nextContributorIdentities.has(contributorIdentity(contributor))) {
          continue;
        }
        const previousCut = current.snapshot.sourceCuts.find(
          (cut) => sourceCutKey(cut) === key,
        );
        const nextCut = nextCuts.get(key);
        const requiredness = stricterRequiredness(
          previousCut?.requiredness ?? "optional",
          nextCut?.requiredness ?? "ignorable",
        );
        nextCuts.set(key, nextCut?.status === "incompatible"
          ? { ...nextCut, requiredness }
          : {
              source: contributor.kind,
              ...(contributor.kind === "unknown"
                ? { originalKind: contributor.originalKind }
                : {}),
              sourceIdentity: `record:${contributor.ref}`,
              requiredness,
              status: "unavailable",
              reasonCode: "terminal_contributor_regression_preserved",
            });
      }
    }
  }
  if (!changed) return loaded;
  const sourceCuts = [...nextCuts.values()].sort((left, right) =>
    compareCanonicalStrings(sourceCutKey(left), sourceCutKey(right)));
  const hasRequiredIncomplete = sourceCuts.some(
    (cut) => cut.requiredness === "required" && cut.status !== "complete",
  );
  const hasIncompatible = sourceCuts.some(
    (cut) => cut.status === "incompatible",
  );
  const hasIncomplete = sourceCuts.some((cut) => cut.status !== "complete");
  return {
    snapshot: {
      ...loaded.snapshot,
      sourceCuts,
      coverage: {
        state: hasRequiredIncomplete || hasIncompatible
          ? "degraded"
          : hasIncomplete
            ? "partial"
            : "complete",
        reasonCodes: [...new Set([
          ...loaded.snapshot.coverage.reasonCodes,
          ...preservationReasons,
        ])].sort(),
      },
      items: [...nextItems.values()].sort((left, right) =>
        compareCanonicalStrings(left.id, right.id)),
    },
    contributors,
  };
}

function isTerminalLifecycle(
  lifecycle: ConversationDisclosureItem["lifecycle"],
): boolean {
  return lifecycle === "succeeded"
    || lifecycle === "completed_unverified"
    || lifecycle === "failed"
    || lifecycle === "canceled";
}

function isMonotonicTerminalUpdate(
  previous: ConversationDisclosureItem,
  next: ConversationDisclosureItem,
): boolean {
  if (
    next.lifecycle !== previous.lifecycle
    && !(
      previous.lifecycle === "completed_unverified"
      && next.lifecycle === "succeeded"
    )
  ) {
    return false;
  }
  if (
    next.primarySource.kind !== previous.primarySource.kind
    || next.primarySource.ref !== previous.primarySource.ref
    || Boolean(next.primarySource.domainRevision)
      !== Boolean(previous.primarySource.domainRevision)
  ) {
    return false;
  }
  const revisionOrder = compareNumericRevisions(
    previous.primarySource.domainRevision,
    next.primarySource.domainRevision,
  );
  if (revisionOrder !== null && revisionOrder < 0) return false;
  if (revisionOrder === 0) {
    return isDeepStrictEqual(
      terminalPrimaryBody(previous),
      terminalPrimaryBody(next),
    );
  }
  const timeOrder = compareCanonicalStrings(
    next.occurredAt,
    previous.occurredAt,
  );
  if (timeOrder !== 0) return timeOrder > 0;
  return revisionOrder !== null && revisionOrder >= 0;
}

function terminalPrimaryBody(item: ConversationDisclosureItem) {
  const {
    contributors: _contributors,
    contributorCount: _contributorCount,
    contributorsComplete: _contributorsComplete,
    contributorSetComplete: _contributorSetComplete,
    contributorCursor: _contributorCursor,
    ...primaryBody
  } = item;
  return primaryBody;
}

function terminalContributorsAreMonotonic(
  current: ScopeState,
  loaded: LoadedProjection,
  itemId: string,
): boolean {
  const previous = current.contributors.get(itemId) ?? [];
  const next = loaded.contributors.get(itemId) ?? [];
  if (next.length < previous.length) return false;
  const nextRefs = new Set(next.map(contributorIdentity));
  return previous.every((ref) => nextRefs.has(contributorIdentity(ref)));
}

function contributorIdentity(ref: ConversationDisclosureSourceRef): string {
  return JSON.stringify([
    ref.kind,
    ref.kind === "unknown" ? ref.originalKind : null,
    ref.ref,
    ref.domainRevision ?? null,
    ref.domainStatus,
  ]);
}

function compareNumericRevisions(
  previous: string | undefined,
  next: string | undefined,
): number | null {
  if (previous === next) return 0;
  if (
    !previous
    || !next
    || !/^\d+$/.test(previous)
    || !/^\d+$/.test(next)
  ) {
    return null;
  }
  const previousRevision = BigInt(previous);
  const nextRevision = BigInt(next);
  return nextRevision < previousRevision
    ? -1
    : nextRevision > previousRevision
      ? 1
      : 0;
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceCutKeyForItem(item: ConversationDisclosureItem): string {
  return sourceRefCutKey(item.primarySource);
}

function sourceRefCutKey(ref: ConversationDisclosureSourceRef): string {
  return `${ref.kind}:${
    ref.kind === "unknown" ? ref.originalKind ?? "" : ""
  }:record:${ref.ref}`;
}

function isPreservedUnavailableCut(cut: ConversationSourceCut): boolean {
  return cut.status === "unavailable"
    && Boolean(cut.reasonCode?.includes("terminal_"))
    && Boolean(cut.reasonCode?.includes("_regression_preserved"));
}

function generationRotationReason(
  current: ConversationDisclosureSnapshot,
  next: ConversationDisclosureSnapshot,
): string | null {
  if (
    !isDeepStrictEqual(current.activeAttempts, next.activeAttempts)
    || !isDeepStrictEqual(
      current.attemptSettlements,
      next.attemptSettlements,
    )
  ) {
    // The bounded owning-store read does not contain every live answer delta,
    // so it cannot safely synthesize a gap-free attempt control sequence.
    return "attempt_state_changed";
  }
  const currentCuts = new Map(
    current.sourceCuts.map((cut) => [sourceCutKey(cut), cut]),
  );
  const nextCuts = new Map(
    next.sourceCuts.map((cut) => [sourceCutKey(cut), cut]),
  );
  if (
    [...currentCuts.keys()].some((key) => !nextCuts.has(key))
  ) {
    return "source_set_changed";
  }
  for (const [key, currentCut] of currentCuts) {
    const nextCut = nextCuts.get(key)!;
    if (
      requirednessRank(nextCut.requiredness)
        < requirednessRank(currentCut.requiredness)
    ) {
      return "requiredness_weakened";
    }
    if (sourceStatusRank(nextCut.status) < sourceStatusRank(currentCut.status)) {
      return "source_coverage_recovered";
    }
  }
  if (
    coverageRank(next.coverage.state) < coverageRank(current.coverage.state)
  ) {
    return "coverage_recovered";
  }
  return null;
}

function rotateAndPublish(
  state: ScopeState,
  projected: ConversationDisclosureSnapshot,
  contributors: Map<string, ConversationDisclosureSourceRef[]>,
  reason: string,
  generation: string,
): ConversationDisclosureMaterializationResult {
  const result = rotateState(
    state,
    projected,
    contributors,
    reason,
    generation,
  );
  notifyListeners(state, {
    kind: "reset",
    reason,
    snapshot: result.snapshot,
  });
  return result;
}

function rotateState(
  state: ScopeState,
  projected: ConversationDisclosureSnapshot,
  contributors: Map<string, ConversationDisclosureSourceRef[]>,
  reason: string,
  generation: string,
): ConversationDisclosureMaterializationResult {
  const snapshot = {
    ...projected,
    generation,
    cursor: 0,
    lastDeltaId: undefined,
  };
  state.snapshot = snapshot;
  state.contributors = contributors;
  state.ring = [];
  return { kind: "reset", reason, snapshot: clone(snapshot) };
}

function buildContributorSets(
  seeds: ConversationProjectionSeed[],
  snapshot: ConversationDisclosureSnapshot,
): Map<string, ConversationDisclosureSourceRef[]> {
  const selectedSets = new Map(
    projectConversationDisclosureContributorSets({
      scope: snapshot.scope,
      seeds,
    }).map((entry) => [entry.itemId, entry.refs]),
  );
  const contributors = new Map<string, ConversationDisclosureSourceRef[]>();
  for (const item of snapshot.items) {
    const refs = selectedSets.get(item.id) ?? [];
    if (
      refs.length !== item.contributorCount
      || !isDeepStrictEqual(
        refs.slice(0, item.contributors.length),
        item.contributors,
      )
    ) {
      continue;
    }
    contributors.set(item.id, refs);
  }
  return contributors;
}

function notifyListeners(
  state: ScopeState,
  publication: ConversationDisclosureMaterializerPublication,
): void {
  for (const registration of [...state.listeners]) {
    try {
      registration.listener(clone(publication));
    } catch {
      // Projection listeners are non-authoritative.
    }
  }
}

function projectCausalAttemptState(
  readSet: ConversationDisclosureAdapterReadSet,
): {
  activeAttempts: ActiveConversationAttempt[];
  attemptSettlements: ConversationAttemptSettlement[];
} {
  const activeAttempts: ActiveConversationAttempt[] = [];
  const attemptSettlements: ConversationAttemptSettlement[] = [];
  for (const record of readSet.causalRecords ?? []) {
    for (const attempt of record.attempts) {
      if (attempt.state === "active") {
        activeAttempts.push({
          requestId: record.requestId,
          turnId: record.turnId,
          attempt: attempt.attempt,
          lastSequence: attempt.controlSequence,
          answerText: "",
        });
        continue;
      }
      if (attempt.acceptedSettlement) {
        attemptSettlements.push(attempt.acceptedSettlement);
        continue;
      }
      if (attempt.state === "reset" || attempt.state === "superseded") {
        attemptSettlements.push({
          requestId: record.requestId,
          turnId: record.turnId,
          attempt: attempt.attempt,
          outcome: attempt.state,
          lastSequence: attempt.controlSequence,
          lastEventFingerprint: attempt.eventFingerprint,
        });
      }
    }
  }
  return { activeAttempts, attemptSettlements };
}

function enforceRingBounds(
  state: ScopeState,
  currentTime: number,
  maxEntries: number,
  maxBytes: number,
  maxAgeMs: number,
): "ok" | "rotate" {
  let bytes = state.ring.reduce((sum, entry) => sum + entry.bytes, 0);
  while (
    state.ring.length > 0
    && (
      state.ring.length > maxEntries
      || bytes > maxBytes
      || currentTime - state.ring[0]!.createdAt > maxAgeMs
    )
  ) {
    if (state.ring[0]!.protected) return "rotate";
    bytes -= state.ring.shift()!.bytes;
  }
  return "ok";
}

function isProtectedDelta(
  delta: ConversationDisclosureDelta,
  previous: ConversationDisclosureSnapshot,
): boolean {
  if (delta.attemptControls.length > 0) return true;
  if (coverageRank(delta.coverage?.state ?? previous.coverage.state)
      > coverageRank(previous.coverage.state)) {
    return true;
  }
  const previousCuts = new Map(
    previous.sourceCuts.map((cut) => [sourceCutKey(cut), cut]),
  );
  if (delta.sourceCutChanges.some((change) => {
    const prior = previousCuts.get(sourceCutKey(change));
    return !prior
      ? change.status !== "complete"
        || change.requiredness === "required"
      : sourceStatusRank(change.status) > sourceStatusRank(prior.status)
        || requirednessRank(change.requiredness)
          > requirednessRank(prior.requiredness);
  })) {
    return true;
  }
  const protectedItem = (item: ConversationDisclosureItem) =>
    item.attention !== "normal"
    || item.disclosureClass === "gate"
    || [
      "failed",
      "blocked",
      "canceled",
      "succeeded",
      "completed_unverified",
    ].includes(item.lifecycle);
  const previousItems = new Map(previous.items.map((item) => [item.id, item]));
  if (delta.upserts.some((item) =>
    protectedItem(item)
    || (
      previousItems.has(item.id)
      && protectedItem(previousItems.get(item.id)!)
    ))) {
    return true;
  }
  return delta.removals.some((id) => {
    const item = previousItems.get(id);
    return item ? protectedItem(item) : false;
  });
}

function replayReset(
  state: ScopeState,
  reason: string,
): ConversationDisclosureReplayResult {
  return { kind: "reset", reason, snapshot: clone(state.snapshot) };
}

function sourceCutKey(cut: ConversationSourceCut): string {
  return `${cut.source}:${cut.originalKind ?? ""}:${cut.sourceIdentity ?? ""}`;
}

function requirednessRank(value: ConversationSourceCut["requiredness"]): number {
  return value === "required" ? 2 : value === "optional" ? 1 : 0;
}

function stricterRequiredness(
  left: ConversationSourceCut["requiredness"],
  right: ConversationSourceCut["requiredness"],
): ConversationSourceCut["requiredness"] {
  return requirednessRank(left) >= requirednessRank(right) ? left : right;
}

function sourceStatusRank(value: ConversationSourceCut["status"]): number {
  switch (value) {
    case "complete":
      return 0;
    case "ephemeral":
      return 1;
    case "partial":
      return 2;
    case "unavailable":
      return 3;
    case "incompatible":
      return 4;
  }
}

function coverageRank(value: ConversationDisclosureSnapshot["coverage"]["state"]): number {
  return value === "complete" ? 0 : value === "partial" ? 1 : 2;
}

function positiveLimit(value: number | undefined, fallback: number): number {
  const parsed = Math.floor(Number(value ?? fallback));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeLimit(value: number | undefined, fallback: number): number {
  const parsed = Math.floor(Number(value ?? fallback));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function utf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("Conversation materialization was canceled.", "AbortError");
}

function assertOpen(closed: boolean): void {
  if (closed) throw new Error("conversation disclosure materializer is closed");
}
