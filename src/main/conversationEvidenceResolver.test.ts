import { describe, expect, it } from "vitest";
import {
  createConversationDisclosureScope,
  projectConversationDisclosureSnapshot,
  type ConversationDisclosureFact,
} from "../shared/conversationDisclosure";
import {
  createConversationEvidenceResolver,
  type ConversationEvidenceBackendResult,
} from "./conversationEvidenceResolver";

describe("conversation evidence resolver", () => {
  it("binds target and trusted scope to a server-issued anchor", async () => {
    const snapshot = makeSnapshot("technical");
    const backend = async (): Promise<ConversationEvidenceBackendResult> => ({
      kind: "found",
      authorityRevision: "revision:1\0tool_result",
      entries: [{
        id: "event_1",
        kind: "tool_result",
        status: "completed",
        summary: "token=super-secret-value",
        occurredAt: "2026-08-25T00:00:00.000Z",
        sequence: 1,
        ...( {
          args: { password: "must-not-leak" },
          path: "/private/workspace/file",
        } as Record<string, unknown>),
      }],
      complete: true,
    });
    let authorizationCount = 0;
    const resolver = createConversationEvidenceResolver({
      getCurrentSnapshot: async () => snapshot,
      backend: { resolve: backend },
      canResolve: () => {
        authorizationCount += 1;
        return true;
      },
      secret: new Uint8Array(32).fill(7),
      now: () => 100,
    });
    const item = snapshot.items[0]!;
    const anchor = resolver.issueAnchor({ snapshot, itemId: item.id });
    const response = await resolver.resolve({
      schemaVersion: 1,
      anchor,
      target: item.evidenceTarget!,
    }, trustedContext());

    expect(response).toMatchObject({
      ok: true,
      result: {
        kind: "found",
        complete: true,
        entries: [{
          id: "event_1",
          kind: "tool_result",
          status: "completed",
        }],
      },
    });
    expect(JSON.stringify(response)).not.toContain("super-secret-value");
    expect(JSON.stringify(response)).not.toContain("must-not-leak");
    expect(JSON.stringify(response)).not.toContain("/private/workspace");
    expect(authorizationCount).toBe(2);

    await expect(resolver.resolve({
      schemaVersion: 1,
      anchor,
      target: {
        schemaVersion: 1,
        kind: "trajectory_event",
        runId: "run_1",
        eventId: "different",
      },
    }, trustedContext())).resolves.toMatchObject({
      ok: true,
      result: { kind: "incompatible", reasonCode: "target_mismatch" },
    });
    await expect(resolver.resolve({
      schemaVersion: 1,
      anchor,
      target: item.evidenceTarget!,
    }, {
      ...trustedContext(),
      scope: createConversationDisclosureScope({
        surface: "chat",
        sessionId: "session_1",
        runId: "run_1",
        queryHash: "query:other",
      }),
    })).resolves.toMatchObject({
      ok: true,
      result: { kind: "incompatible", reasonCode: "target_mismatch" },
    });
  });

  it("redacts path-shaped values inside allowlisted scalar fields", async () => {
    const snapshot = makeSnapshot("technical");
    const resolver = createConversationEvidenceResolver({
      getCurrentSnapshot: async () => snapshot,
      backend: {
        resolve: async () => ({
          kind: "found",
          authorityRevision: "revision:1\0tool_result",
          entries: [{
            id: "src/private/result.json",
            kind: "types/private/kind",
            status: "states/private/status",
            summary: "Read docs/private/input.txt",
            occurredAt: "dates/private/time",
          }],
          complete: true,
        }),
      },
      canResolve: () => true,
      secret: new Uint8Array(32).fill(14),
      now: () => 100,
    });
    const item = snapshot.items[0]!;
    const response = await resolver.resolve({
      schemaVersion: 1,
      anchor: resolver.issueAnchor({ snapshot, itemId: item.id }),
      target: item.evidenceTarget!,
    }, trustedContext());

    expect(response).toMatchObject({
      ok: true,
      result: {
        kind: "found",
        entries: [{
          id: "[redacted-path]",
          kind: "[redacted-path]",
          status: "[redacted-path]",
          summary: "Read [redacted-path]",
          occurredAt: "[redacted-path]",
        }],
      },
    });
    expect(JSON.stringify(response)).not.toMatch(
      /src\/private|types\/private|states\/private|docs\/private|dates\/private/,
    );
  });

  it("issues contributor targets from server-owned snapshot identity", async () => {
    const snapshot = makeContributorSnapshot();
    const positions: number[] = [];
    const resolver = createConversationEvidenceResolver({
      getCurrentSnapshot: async () => snapshot,
      backend: {
        resolve: async ({ target, position, expectedAuthorityRevision }) => {
          positions.push(position);
          expect(target).toMatchObject({
            kind: "contributor_page",
            scopeKey: snapshot.scope.key,
          });
          return {
            kind: "found",
            authorityRevision: expectedAuthorityRevision!,
            entries: [{
              id: "event_1",
              kind: "trajectory",
              status: "tool_result",
            }],
            complete: true,
          };
        },
      },
      canResolve: () => true,
      secret: new Uint8Array(32).fill(13),
      now: () => 100,
    });
    const item = snapshot.items[0]!;
    const issued = resolver.issueContributorAnchor({
      snapshot,
      itemId: item.id,
    });

    await expect(resolver.resolve({
      schemaVersion: 1,
      anchor: issued.anchor,
      target: issued.target,
      limit: 10,
    }, trustedContext())).resolves.toMatchObject({
      ok: true,
      result: {
        kind: "found",
        complete: true,
        entries: [{ id: "event_1", kind: "trajectory" }],
      },
    });
    expect(positions).toEqual([0]);
  });

  it("returns an incomplete bounded page without inventing a cursor", async () => {
    const snapshot = makeContributorSnapshot();
    const resolver = createConversationEvidenceResolver({
      getCurrentSnapshot: async () => snapshot,
      backend: {
        resolve: async ({ expectedAuthorityRevision }) => ({
          kind: "found",
          authorityRevision: expectedAuthorityRevision!,
          entries: [{
            id: "known_contributor",
            kind: "trajectory",
          }],
          complete: false,
        }),
      },
      canResolve: () => true,
      secret: new Uint8Array(32).fill(17),
      now: () => 100,
    });
    const item = snapshot.items[0]!;
    const issued = resolver.issueContributorAnchor({
      snapshot,
      itemId: item.id,
    });

    await expect(resolver.resolve({
      schemaVersion: 1,
      anchor: issued.anchor,
      target: issued.target,
      limit: 10,
    }, trustedContext())).resolves.toEqual({
      ok: true,
      result: {
        kind: "found",
        entries: [{ id: "known_contributor", kind: "trajectory" }],
        complete: false,
      },
    });
  });

  it("reauthorizes every page and binds its cursor to authority revision", async () => {
    const snapshot = makeSnapshot("technical");
    let revision = "revision:1\0tool_result";
    let authorizationCount = 0;
    const resolver = createConversationEvidenceResolver({
      getCurrentSnapshot: async () => snapshot,
      backend: {
        resolve: async ({ position }) => ({
          kind: "found",
          authorityRevision: revision,
          entries: [{
            id: `event_${position + 1}`,
            kind: "trajectory",
            sequence: position + 1,
          }],
          complete: position > 0,
          ...(position === 0 ? { nextPosition: 1 } : {}),
        }),
      },
      canResolve: () => {
        authorizationCount += 1;
        return true;
      },
      secret: new Uint8Array(32).fill(8),
      now: () => 100,
    });
    const item = snapshot.items[0]!;
    const anchor = resolver.issueAnchor({ snapshot, itemId: item.id });
    const first = await resolver.resolve({
      schemaVersion: 1,
      anchor,
      target: item.evidenceTarget!,
      limit: 1,
    }, trustedContext());
    if (!first.ok || first.result.kind !== "found") {
      throw new Error("expected first evidence page");
    }
    expect(first.result.nextCursor).toBeTruthy();
    const second = await resolver.resolve({
      schemaVersion: 1,
      anchor,
      target: item.evidenceTarget!,
      cursor: first.result.nextCursor,
      limit: 1,
    }, trustedContext());
    expect(second).toMatchObject({
      ok: true,
      result: { kind: "found", complete: true },
    });
    expect(authorizationCount).toBe(4);

    revision = "revision:2\0tool_result";
    await expect(resolver.resolve({
      schemaVersion: 1,
      anchor,
      target: item.evidenceTarget!,
      limit: 1,
    }, trustedContext())).resolves.toMatchObject({
      ok: true,
      result: { kind: "incompatible", reasonCode: "authority_changed" },
    });
    await expect(resolver.resolve({
      schemaVersion: 1,
      anchor,
      target: item.evidenceTarget!,
      cursor: first.result.nextCursor,
      limit: 1,
    }, trustedContext())).resolves.toMatchObject({
      ok: true,
      result: { kind: "incompatible", reasonCode: "authority_changed" },
    });
    expect(authorizationCount).toBe(8);
  });

  it("reauthorizes after the backend read before returning evidence", async () => {
    const snapshot = makeSnapshot("technical");
    let authorized = true;
    let authorizationCount = 0;
    const resolver = createConversationEvidenceResolver({
      getCurrentSnapshot: async () => snapshot,
      backend: {
        resolve: async () => {
          authorized = false;
          return {
            kind: "found",
            authorityRevision: "revision:1\0tool_result",
            entries: [{ id: "event_1", kind: "trajectory" }],
            complete: true,
          };
        },
      },
      canResolve: () => {
        authorizationCount += 1;
        return authorized;
      },
      secret: new Uint8Array(32).fill(18),
      now: () => 100,
    });
    const item = snapshot.items[0]!;

    await expect(resolver.resolve({
      schemaVersion: 1,
      anchor: resolver.issueAnchor({ snapshot, itemId: item.id }),
      target: item.evidenceTarget!,
    }, trustedContext())).resolves.toEqual({
      ok: true,
      result: { kind: "forbidden", reasonCode: "not_authorized" },
    });
    expect(authorizationCount).toBe(2);
  });

  it("rejects an anchor after the current materializer generation rotates", async () => {
    const snapshot = makeSnapshot("technical");
    let current = snapshot;
    let backendCalls = 0;
    const resolver = createConversationEvidenceResolver({
      getCurrentSnapshot: async () => current,
      backend: {
        resolve: async () => {
          backendCalls += 1;
          return {
            kind: "found",
            authorityRevision: "revision:1\0tool_result",
            entries: [{ id: "event_1", kind: "trajectory" }],
            complete: true,
          };
        },
      },
      canResolve: () => true,
      secret: new Uint8Array(32).fill(15),
      now: () => 100,
    });
    const item = snapshot.items[0]!;
    const anchor = resolver.issueAnchor({ snapshot, itemId: item.id });
    current = {
      ...snapshot,
      generation: "generation:rotated",
    };

    await expect(resolver.resolve({
      schemaVersion: 1,
      anchor,
      target: item.evidenceTarget!,
    }, trustedContext())).resolves.toMatchObject({
      ok: true,
      result: { kind: "incompatible", reasonCode: "authority_changed" },
    });
    expect(backendCalls).toBe(0);
  });

  it("advances a byte-truncated page by the entries actually returned", async () => {
    const snapshot = makeSnapshot("technical");
    const positions: number[] = [];
    const entries = Array.from({ length: 100 }, (_, index) => ({
      id: `event_${index}`,
      kind: "trajectory",
      summary: "x".repeat(2_048),
      sequence: index + 1,
    }));
    const resolver = createConversationEvidenceResolver({
      getCurrentSnapshot: async () => snapshot,
      backend: {
        resolve: async ({ position }) => {
          positions.push(position);
          return {
            kind: "found",
            authorityRevision: "revision:1\0tool_result",
            entries,
            complete: true,
            nextPosition: position + entries.length,
          };
        },
      },
      canResolve: () => true,
      secret: new Uint8Array(32).fill(12),
      now: () => 100,
    });
    const item = snapshot.items[0]!;
    const anchor = resolver.issueAnchor({ snapshot, itemId: item.id });
    const first = await resolver.resolve({
      schemaVersion: 1,
      anchor,
      target: item.evidenceTarget!,
      limit: 100,
    }, trustedContext());
    if (!first.ok || first.result.kind !== "found") {
      throw new Error("expected a byte-truncated evidence page");
    }
    expect(first.result.entries.length).toBeGreaterThan(0);
    expect(first.result.entries.length).toBeLessThan(entries.length);

    await resolver.resolve({
      schemaVersion: 1,
      anchor,
      target: item.evidenceTarget!,
      cursor: first.result.nextCursor,
      limit: 100,
    }, trustedContext());

    expect(positions).toEqual([0, first.result.entries.length]);
  });

  it("returns indistinguishable forbidden responses without backend access", async () => {
    const snapshot = makeSnapshot("restricted");
    let backendCalls = 0;
    const resolver = createConversationEvidenceResolver({
      getCurrentSnapshot: async () => snapshot,
      backend: {
        resolve: async () => {
          backendCalls += 1;
          return { kind: "missing" };
        },
      },
      canResolve: () => true,
      secret: new Uint8Array(32).fill(9),
      now: () => 100,
    });
    const item = snapshot.items[0]!;
    const response = await resolver.resolve({
      schemaVersion: 1,
      anchor: resolver.issueAnchor({ snapshot, itemId: item.id }),
      target: item.evidenceTarget!,
    }, {
      ...trustedContext(),
      allowRestricted: false,
    });
    expect(response).toEqual({
      ok: true,
      result: { kind: "forbidden", reasonCode: "not_authorized" },
    });
    expect(backendCalls).toBe(0);
  });

  it("rejects caller-downgraded sensitivity before backend access", async () => {
    const currentSnapshot = makeSnapshot("restricted");
    const forgedSnapshot = {
      ...currentSnapshot,
      items: currentSnapshot.items.map((item) => ({
        ...item,
        sensitivity: "public_summary" as const,
      })),
    };
    let backendCalls = 0;
    const resolver = createConversationEvidenceResolver({
      getCurrentSnapshot: async () => currentSnapshot,
      backend: {
        resolve: async () => {
          backendCalls += 1;
          return { kind: "missing" };
        },
      },
      canResolve: () => true,
      secret: new Uint8Array(32).fill(19),
      now: () => 100,
    });
    const item = forgedSnapshot.items[0]!;

    await expect(resolver.resolve({
      schemaVersion: 1,
      anchor: resolver.issueAnchor({
        snapshot: forgedSnapshot,
        itemId: item.id,
      }),
      target: item.evidenceTarget!,
    }, {
      ...trustedContext(),
      allowRestricted: false,
    })).resolves.toEqual({
      ok: true,
      result: { kind: "incompatible", reasonCode: "authority_changed" },
    });
    expect(backendCalls).toBe(0);
  });

  it("rejects tampered, cross-session, expired, and cross-limit cursors", async () => {
    let now = 100;
    const snapshot = makeSnapshot("technical");
    const resolver = createConversationEvidenceResolver({
      getCurrentSnapshot: async () => snapshot,
      backend: {
        resolve: async () => ({
          kind: "found",
          authorityRevision: "revision:1\0tool_result",
          entries: [{ id: "event_1", kind: "trajectory" }],
          complete: false,
          nextPosition: 1,
        }),
      },
      canResolve: () => true,
      secret: new Uint8Array(32).fill(10),
      now: () => now,
      anchorTtlMs: 10,
    });
    const item = snapshot.items[0]!;
    const anchor = resolver.issueAnchor({ snapshot, itemId: item.id });

    await expect(resolver.resolve({
      schemaVersion: 1,
      anchor: `${anchor}x`,
      target: item.evidenceTarget!,
    }, trustedContext())).resolves.toMatchObject({
      ok: true,
      result: { kind: "incompatible", reasonCode: "anchor_invalid" },
    });
    await expect(resolver.resolve({
      schemaVersion: 1,
      anchor,
      target: item.evidenceTarget!,
    }, trustedContext("session_other")))
      .resolves.toMatchObject({
        ok: true,
        result: { kind: "incompatible", reasonCode: "target_mismatch" },
      });
    const first = await resolver.resolve({
      schemaVersion: 1,
      anchor,
      target: item.evidenceTarget!,
      limit: 1,
    }, trustedContext());
    if (!first.ok || first.result.kind !== "found") {
      throw new Error("expected first evidence page");
    }
    await expect(resolver.resolve({
      schemaVersion: 1,
      anchor,
      target: item.evidenceTarget!,
      cursor: first.result.nextCursor,
      limit: 2,
    }, trustedContext())).resolves.toMatchObject({
      ok: true,
      result: { kind: "incompatible", reasonCode: "cursor_invalid" },
    });
    now = 111;
    await expect(resolver.resolve({
      schemaVersion: 1,
      anchor,
      target: item.evidenceTarget!,
    }, trustedContext())).resolves.toMatchObject({
      ok: true,
      result: { kind: "incompatible", reasonCode: "anchor_expired" },
    });
  });

  it("keeps infrastructure failure distinct from missing or forbidden", async () => {
    const snapshot = makeSnapshot("technical");
    const resolver = createConversationEvidenceResolver({
      getCurrentSnapshot: async () => snapshot,
      backend: {
        resolve: async () => {
          throw new Error("storage unavailable");
        },
      },
      canResolve: () => true,
      secret: new Uint8Array(32).fill(11),
      now: () => 100,
    });
    const item = snapshot.items[0]!;
    await expect(resolver.resolve({
      schemaVersion: 1,
      anchor: resolver.issueAnchor({ snapshot, itemId: item.id }),
      target: item.evidenceTarget!,
    }, trustedContext())).resolves.toEqual({
      ok: false,
      error: { code: "resolver_unavailable", retryable: true },
    });
  });
});

function makeSnapshot(
  sensitivity: ConversationDisclosureFact<"trajectory">["sensitivity"],
) {
  const scope = createConversationDisclosureScope({
    surface: "chat",
    sessionId: "session_1",
    runId: "run_1",
    queryHash: "query:all",
  });
  const fact: ConversationDisclosureFact<"trajectory"> = {
    schemaVersion: 1,
    kind: "trajectory",
    authorityRef: "event_1",
    scope,
    domainRevision: "revision:1",
    domainStatus: "tool_result",
    requiredness: "optional",
    durability: "durable",
    sensitivity,
    occurredAt: "2026-08-25T00:00:00.000Z",
    payload: {
      semanticSlot: "trajectory:event_1",
      summary: "tool result",
      disclosureClass: "evidence",
      eventId: "event_1",
      runId: "run_1",
      sequence: 1,
      evidenceTarget: {
        schemaVersion: 1,
        kind: "trajectory_event",
        runId: "run_1",
        eventId: "event_1",
      },
    },
  };
  return projectConversationDisclosureSnapshot({
    scope,
    generation: "generation:1",
    expectedSourceCuts: [],
    seeds: [{ primary: fact }],
  });
}

function makeContributorSnapshot() {
  const snapshot = makeSnapshot("technical");
  const scope = snapshot.scope;
  const primary: ConversationDisclosureFact<"trajectory"> = {
    schemaVersion: 1,
    kind: "trajectory",
    authorityRef: "event_primary",
    scope,
    domainRevision: "1",
    domainStatus: "tool_result",
    requiredness: "optional",
    durability: "durable",
    sensitivity: "technical",
    occurredAt: "2026-08-25T00:00:00.000Z",
    payload: {
      semanticSlot: "trajectory:event_primary",
      summary: "tool result",
      disclosureClass: "evidence",
      eventId: "event_primary",
      runId: "run_1",
      sequence: 1,
    },
  };
  const contributor: ConversationDisclosureFact<"trajectory"> = {
    ...primary,
    authorityRef: "event_1",
    domainRevision: "2",
    payload: {
      ...primary.payload,
      semanticSlot: "trajectory:event_1",
      eventId: "event_1",
      sequence: 2,
    },
  };
  return projectConversationDisclosureSnapshot({
    scope,
    generation: "generation:1",
    expectedSourceCuts: [],
    seeds: [{ primary, contributors: [contributor] }],
  });
}

function trustedContext(sessionId = "session_1") {
  return {
    actorId: "user_1",
    scope: createConversationDisclosureScope({
      surface: "chat",
      sessionId,
      runId: "run_1",
      queryHash: "query:all",
    }),
    allowTechnical: true,
    allowRestricted: true,
  };
}
