import { describe, expect, it } from "vitest";
import type { AgentExecutionStatus } from "./agentExecution";
import type { GoalStatus } from "./agentGoal";
import type { KernelRunStatus } from "./kernelContract";
import type { PlanStatus } from "./planMode";
import type { ToolInvocationStatus } from "./toolInvocationLedger";
import type { WorkspaceRunStatus } from "./workspaceRunLedger";
import {
  CONVERSATION_DISCLOSURE_CONTRIBUTOR_PAGE_LIMIT,
  applyConversationDisclosureDelta,
  classifyConversationRuntimeObservation,
  createConversationContributorPage,
  createConversationAcceptedAttemptSettlement,
  createConversationDisclosureDeltaId,
  createConversationDisclosureItemId,
  createConversationDisclosureScope,
  createLegacyConversationRef,
  getActiveConversationAttempts,
  isKnownConversationDomainStatus,
  isKnownConversationFactKind,
  mapConversationFactLifecycle,
  projectConversationDisclosureItem,
  projectConversationDisclosureSnapshot,
  reduceConversationLiveAnswer,
  resolveConversationDisclosurePolicy,
  sanitizeConversationDisclosureSummary,
  type ConversationDisclosureDelta,
  type ConversationDisclosureFact,
  type ConversationDisclosureItem,
  type ConversationDisclosureScope,
  type ConversationAcceptedAttemptSettlement,
  type ConversationDomainStatusMap,
  type ConversationFactKind,
  type ConversationFactPayloadMap,
  type ConversationLiveAnswerState,
  type ConversationProjectionSeed,
  type ConversationUnknownFact,
} from "./conversationDisclosure";

const occurredAt = "2026-08-18T00:00:00.000Z";
const scope = createConversationDisclosureScope({
  surface: "chat",
  sessionId: "session:1",
  queryHash: "query:v1",
});

function fact<K extends ConversationFactKind>(
  kind: K,
  domainStatus: ConversationDomainStatusMap[K],
  payload: ConversationFactPayloadMap[K],
  overrides: Partial<ConversationDisclosureFact<K>> = {},
): ConversationDisclosureFact<K> {
  return {
    schemaVersion: 1,
    kind,
    authorityRef: `${kind}:authority`,
    scope: { ...scope },
    domainRevision: "revision:1",
    domainStatus,
    requiredness: "required",
    durability: "durable",
    sensitivity: "public_summary",
    occurredAt,
    payload,
    ...overrides,
  } as ConversationDisclosureFact<K>;
}

const basePayload = {
  semanticSlot: "progress",
  summary: "安全摘要",
  disclosureClass: "operation" as const,
};

function seedFor(
  primary: ConversationDisclosureFact,
  contributors: ConversationDisclosureFact[] = [],
): ConversationProjectionSeed {
  return { primary, contributors };
}

function emptySnapshot(inputScope: ConversationDisclosureScope = scope) {
  return projectConversationDisclosureSnapshot({
    scope: inputScope,
    generation: "generation:1",
    cursor: 0,
    expectedSourceCuts: [],
    seeds: [],
  });
}

function delta(
  snapshot = emptySnapshot(),
  overrides: Partial<ConversationDisclosureDelta> = {},
): ConversationDisclosureDelta {
  const { deltaId: explicitDeltaId, ...bodyOverrides } = overrides;
  const body: Omit<ConversationDisclosureDelta, "deltaId"> = {
    schemaVersion: 1,
    projectionVersion: 1,
    scopeKey: snapshot.scope.key,
    queryHash: snapshot.scope.queryHash,
    generation: snapshot.generation,
    fromCursor: snapshot.cursor,
    toCursor: snapshot.cursor + 1,
    sourceCutChanges: [],
    attemptControls: [],
    upserts: [],
    removals: [],
    ...bodyOverrides,
  };
  return {
    ...body,
    deltaId: explicitDeltaId ?? createConversationDisclosureDeltaId(body),
  };
}

function acceptedSettlementFixture(
  requestId: string,
  turnId = "turn:1",
): ConversationAcceptedAttemptSettlement {
  const begun = reduceConversationLiveAnswer({ streams: [] }, {
    requestId,
    turnId,
    attempt: 1,
    sequence: 1,
    operation: "begin",
  });
  if (begun.kind !== "applied") throw new Error("begin fixture failed");
  const accepted = reduceConversationLiveAnswer(begun.state, {
    requestId,
    turnId,
    attempt: 1,
    sequence: 2,
    operation: "accept",
    acceptedMessageId: `message:${requestId}`,
  }, {
    id: `message:${requestId}`,
    role: "assistant",
    requestId,
    turnId,
    content: `durable:${requestId}`,
  });
  if (accepted.kind !== "applied") throw new Error("accept fixture failed");
  const settlement = accepted.state.streams[0]?.settlement;
  if (settlement?.outcome !== "accepted") {
    throw new Error("accepted settlement fixture missing");
  }
  return settlement;
}

describe("conversation disclosure lifecycle contract", () => {
  it.each<[GoalStatus, string]>([
    ["planning", "queued"],
    ["executing", "running"],
    ["waiting_for_review", "waiting_for_review"],
    ["waiting_for_acceptance", "waiting_for_acceptance"],
    ["waiting_for_model", "waiting_for_model"],
    ["achieved", "succeeded"],
    ["completed_unverified", "completed_unverified"],
    ["stopped_budget", "blocked"],
    ["stopped_stalled", "blocked"],
    ["stopped_blocked", "blocked"],
    ["failed", "failed"],
    ["canceled", "canceled"],
  ])("maps Goal %s to %s", (status, lifecycle) => {
    expect(mapConversationFactLifecycle(fact("goal", status, {
      ...basePayload,
      goalId: "goal:1",
    }))).toBe(lifecycle);
  });

  it.each<[PlanStatus, string]>([
    ["drafting", "running"],
    ["paused", "paused"],
    ["awaiting_input", "waiting_for_user"],
    ["awaiting_confirmation", "waiting_for_user"],
    ["confirmed_pending_execution", "queued"],
    ["executing", "running"],
    ["steps_completed", "completed_unverified"],
    ["completed", "succeeded"],
    ["superseded", "canceled"],
    ["discarded", "canceled"],
    ["canceled", "canceled"],
    ["failed", "failed"],
  ])("maps Plan %s to %s", (status, lifecycle) => {
    expect(mapConversationFactLifecycle(fact("plan", status, {
      ...basePayload,
      planId: "plan:1",
      revision: 1,
      actionGate: "ready",
    }))).toBe(lifecycle);
  });

  it("lets an explicit Plan action gate override a nominal run state", () => {
    expect(mapConversationFactLifecycle(fact("plan", "executing", {
      ...basePayload,
      planId: "plan:1",
      revision: 1,
      actionGate: "blocked",
    }))).toBe("blocked");
  });

  const executionCases: Array<[AgentExecutionStatus, string]> = [
    ["queued", "queued"],
    ["running", "running"],
    ["waiting_for_approval", "waiting_for_approval"],
    ["paused", "paused"],
    ["succeeded", "succeeded"],
    ["failed", "failed"],
    ["canceled", "canceled"],
  ];

  it.each(executionCases)("maps Agent Run %s to %s", (status, lifecycle) => {
    expect(mapConversationFactLifecycle(fact("agent_run", status, {
      ...basePayload,
      runId: "run:1",
    }))).toBe(lifecycle);
  });

  it.each(executionCases)("maps Scheduled Run %s to %s", (status, lifecycle) => {
    expect(mapConversationFactLifecycle(fact("scheduled_run", status, {
      ...basePayload,
      taskId: "task:1",
      runId: "run:1",
    }))).toBe(lifecycle);
  });

  it.each<[WorkspaceRunStatus, string]>([
    ["queued", "queued"],
    ["running", "running"],
    ["waiting_for_user", "waiting_for_user"],
    ["waiting_for_approval", "waiting_for_approval"],
    ["paused", "paused"],
    ["succeeded", "succeeded"],
    ["failed", "failed"],
    ["canceled", "canceled"],
  ])("maps Workspace Run %s to %s", (status, lifecycle) => {
    expect(mapConversationFactLifecycle(fact("workspace_run", status, {
      ...basePayload,
      workspaceRunId: "workspace-run:1",
    }))).toBe(lifecycle);
  });

  it.each<[ToolInvocationStatus, string]>([
    ["proposed", "queued"],
    ["visible", "queued"],
    ["authorized", "queued"],
    ["waiting_approval", "waiting_for_approval"],
    ["running", "running"],
    ["completed", "succeeded"],
    ["error", "failed"],
    ["recovered", "succeeded"],
    ["aborted", "canceled"],
  ])("maps Tool Invocation %s to %s", (status, lifecycle) => {
    expect(mapConversationFactLifecycle(fact("tool_invocation", status, {
      ...basePayload,
      invocationId: "invocation:1",
      toolCallId: "call:1",
      toolName: "read_file",
    }))).toBe(lifecycle);
  });

  it.each<[KernelRunStatus, string]>(executionCases)(
    "maps Kernel %s to %s",
    (status, lifecycle) => {
      expect(mapConversationFactLifecycle(fact("kernel", status, {
        ...basePayload,
        runId: "run:1",
      }))).toBe(lifecycle);
    },
  );

  it("keeps observation statuses distinct from parent-run lifecycle", () => {
    expect(mapConversationFactLifecycle(fact("approval", "denied_or_interrupted", {
      ...basePayload,
      approvalId: "approval:1",
      decisionReasonClass: "user_denied",
    }))).toBe("canceled");
    expect(mapConversationFactLifecycle(fact("context", "compacted_degraded", {
      ...basePayload,
    }))).toBe("completed_unverified");
    expect(mapConversationFactLifecycle(fact("usage", "estimated", {
      ...basePayload,
    }))).toBe("completed_unverified");
  });

  it("does not infer lifecycle from a Trajectory event title", () => {
    const standalone = fact("trajectory", "failure_classified", {
      ...basePayload,
      eventId: "event:1",
      runId: "run:1",
      sequence: 1,
    });
    expect(mapConversationFactLifecycle(standalone)).toBe("unknown");
    expect(mapConversationFactLifecycle(fact("trajectory", "final_summary", {
      ...standalone.payload,
      owningStatus: { kind: "goal", status: "waiting_for_acceptance" },
    }))).toBe("waiting_for_acceptance");
  });
});

describe("conversation disclosure identity, grouping, and policy", () => {
  it("creates delimiter-safe stable ids independent of ordering and timestamps", () => {
    const left = createConversationDisclosureItemId(
      { kind: "goal", ref: "a:b" },
      "c",
    );
    const right = createConversationDisclosureItemId(
      { kind: "goal", ref: "a" },
      "b:c",
    );
    expect(left).not.toBe(right);
    expect(createConversationDisclosureItemId(
      { kind: "goal", ref: "a:b" },
      "c",
    )).toBe(left);
    expect(createConversationDisclosureItemId(
      { kind: "unknown", originalKind: "future:a", ref: "same" },
      "slot",
    )).not.toBe(createConversationDisclosureItemId(
      { kind: "unknown", originalKind: "future:b", ref: "same" },
      "slot",
    ));
  });

  it("derives deterministic legacy refs without array indexes or timestamps", () => {
    const input = {
      kind: "legacy_tool",
      scopeKey: scope.key,
      semanticSlot: "same-operation",
      stableSummary: "same safe summary",
    };
    expect(createLegacyConversationRef(input)).toBe(createLegacyConversationRef(input));
    expect(createLegacyConversationRef({ ...input, stableSummary: "different" }))
      .not.toBe(createLegacyConversationRef(input));
  });

  it("bounds contributors, pages deterministically, and rejects stale cursors", () => {
    const primary = fact("goal", "executing", {
      ...basePayload,
      goalId: "goal:1",
    });
    const contributors = Array.from(
      { length: CONVERSATION_DISCLOSURE_CONTRIBUTOR_PAGE_LIMIT + 3 },
      (_, index) => fact("trajectory", "tool_result", {
        ...basePayload,
        eventId: `event:${index}`,
        runId: "run:1",
        sequence: index + 1,
      }, { authorityRef: `trajectory:${index}` }),
    );
    const item = projectConversationDisclosureItem(seedFor(primary, contributors));
    expect(item.contributors).toHaveLength(CONVERSATION_DISCLOSURE_CONTRIBUTOR_PAGE_LIMIT);
    expect(item.contributorCount).toBe(contributors.length);
    expect(item.contributorsComplete).toBe(false);
    expect(item.contributorCursor).toBeTruthy();

    const next = createConversationContributorPage({
      scopeKey: scope.key,
      itemId: item.id,
      contributors: contributors.map((entry) => ({
        kind: entry.kind,
        ref: entry.authorityRef,
        domainRevision: entry.domainRevision,
        domainStatus: entry.domainStatus,
        role: "contributor" as const,
      })),
      cursor: item.contributorCursor,
    });
    expect(next.kind).toBe("page");
    if (next.kind === "page") {
      expect(next.refs).toHaveLength(3);
      expect(next.complete).toBe(true);
    }

    expect(createConversationContributorPage({
      scopeKey: scope.key,
      itemId: item.id,
      contributors: contributors.slice(1).map((entry) => ({
        kind: entry.kind,
        ref: entry.authorityRef,
        domainRevision: entry.domainRevision,
        domainStatus: entry.domainStatus,
        role: "contributor" as const,
      })),
      cursor: item.contributorCursor,
    })).toEqual({
      kind: "reset_required",
      reason: "contributor_cursor_mismatch",
    });
  });

  it("deduplicates exact contributors without ordering opaque revisions", () => {
    const primary = fact("goal", "executing", {
      ...basePayload,
      goalId: "goal:1",
    });
    const oldContributor = fact("trajectory", "tool_result", {
      ...basePayload,
      eventId: "event:1",
      runId: "run:1",
      sequence: 1,
    }, { authorityRef: "trajectory:1", domainRevision: "1" });
    const newContributor = {
      ...oldContributor,
      domainRevision: "2",
    } satisfies ConversationDisclosureFact<"trajectory">;
    const first = projectConversationDisclosureItem(
      seedFor(primary, [oldContributor, newContributor]),
    );
    const second = projectConversationDisclosureItem(
      seedFor(primary, [newContributor, oldContributor]),
    );
    expect(first).toEqual(second);
    expect(first.contributors).toHaveLength(2);
    expect(first.contributors.map((entry) => entry.domainRevision))
      .toEqual(["1", "2"]);
  });

  it("rejects cross-scope contributors at the exported item projector boundary", () => {
    const otherScope = createConversationDisclosureScope({
      surface: "chat",
      sessionId: "session:other",
      queryHash: "query:v1",
    });
    const primary = fact("goal", "executing", {
      ...basePayload,
      goalId: "goal:1",
    });
    const contributor = fact("trajectory", "tool_result", {
      ...basePayload,
      eventId: "event:other",
      runId: "run:other",
      sequence: 1,
    }, { scope: otherScope });
    expect(() => projectConversationDisclosureItem(
      seedFor(primary, [contributor]),
    )).toThrow(/share primary scope/);
  });

  it("keeps blocking items visible and restricted details non-inline", () => {
    const item = projectConversationDisclosureItem(seedFor(fact(
      "approval",
      "pending",
      {
        ...basePayload,
        approvalId: "approval:1",
        actionRequired: true,
        detailAvailability: "inline",
      },
      { sensitivity: "restricted", durability: "ephemeral" },
    )));
    expect(item.attention).toBe("blocking");
    expect(resolveConversationDisclosurePolicy({
      item,
      preference: "closed",
    })).toMatchObject({
      visible: true,
      prominence: "prominent",
      expanded: false,
      detailMode: "none",
    });
    expect(resolveConversationDisclosurePolicy({ item })).toMatchObject({
      expanded: true,
      reason: "automatic_attention",
    });
  });

  it("does not share mutable scope or evidence references with adapter input", () => {
    const evidence = {
      schemaVersion: 1 as const,
      kind: "goal_record" as const,
      goalId: "goal:1",
      revision: 1,
    };
    const primary = fact("goal", "executing", {
      ...basePayload,
      goalId: "goal:1",
      evidenceTarget: evidence,
    });
    const item = projectConversationDisclosureItem(seedFor(primary));
    primary.scope.sessionId = "mutated-session";
    evidence.goalId = "mutated-goal";
    expect(item.scope.sessionId).toBe("session:1");
    expect(item.evidenceTarget).toMatchObject({ goalId: "goal:1" });
  });
});

describe("conversation disclosure snapshot and unknown compatibility", () => {
  function unknown(
    originalKind: string,
    requiredness: "required" | "optional" | "ignorable",
    overrides: Partial<ConversationUnknownFact> = {},
  ): ConversationUnknownFact {
    return {
      schemaVersion: 99,
      originalKind,
      authorityRef: `${originalKind}:1`,
      scope,
      domainStatus: "future_status",
      requiredness,
      durability: "durable",
      sensitivity: "technical",
      occurredAt,
      semanticSlot: "future",
      safeSummary: "未来能力",
      ...overrides,
    };
  }

  it("degrades for required unknown data without inventing an item", () => {
    const snapshot = projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:1",
      expectedSourceCuts: [],
      seeds: [],
      unknownFacts: [unknown("future_required", "required")],
    });
    expect(snapshot.coverage.state).toBe("degraded");
    expect(snapshot.items).toEqual([]);
    expect(snapshot.sourceCuts[0]).toMatchObject({
      source: "unknown",
      status: "incompatible",
    });
  });

  it("projects optional unknown data as typed generic evidence", () => {
    const snapshot = projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:1",
      expectedSourceCuts: [],
      seeds: [],
      unknownFacts: [unknown("future_optional", "optional")],
    });
    expect(snapshot.coverage.state).toBe("partial");
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]?.primarySource).toMatchObject({
      kind: "unknown",
      originalKind: "future_optional",
    });
    expect(snapshot.items[0]?.evidenceTarget?.kind).toBe("generic_source");
  });

  it("counts and drops replayed ignorable unknown data without degrading coverage", () => {
    const repeated = unknown("future_ignorable", "ignorable");
    const snapshot = projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:1",
      expectedSourceCuts: [],
      seeds: [],
      unknownFacts: [repeated, repeated],
    });
    expect(snapshot.coverage.state).toBe("complete");
    expect(snapshot.items).toEqual([]);
    expect(snapshot.sourceCuts[0]).toMatchObject({
      status: "complete",
      ignoredUnknownCount: 1,
    });
  });

  it("merges conflicting unknown replay conservatively and independently of order", () => {
    const required = unknown("future_conflict", "required", {
      durability: "durable",
      sensitivity: "public_summary",
    });
    const ignorable = unknown("future_conflict", "ignorable", {
      durability: "ephemeral",
      sensitivity: "restricted",
    });
    const project = (unknownFacts: ConversationUnknownFact[]) =>
      projectConversationDisclosureSnapshot({
        scope,
        generation: "generation:1",
        expectedSourceCuts: [],
        seeds: [],
        unknownFacts,
      });
    const forward = project([required, ignorable]);
    const reverse = project([ignorable, required]);
    expect(forward).toEqual(reverse);
    expect(forward.coverage.state).toBe("degraded");
    expect(forward.items).toEqual([]);
    expect(forward.sourceCuts[0]).toMatchObject({
      requiredness: "required",
      status: "incompatible",
    });
  });

  it("keeps different unknown kinds distinct even when ref and slot collide", () => {
    const first = unknown("future_a", "optional", { authorityRef: "same" });
    const second = unknown("future_b", "optional", { authorityRef: "same" });
    const snapshot = projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:1",
      expectedSourceCuts: [],
      seeds: [],
      unknownFacts: [first, second],
    });
    expect(snapshot.items).toHaveLength(2);
    expect(new Set(snapshot.items.map((item) => item.id)).size).toBe(2);
  });

  it("requires callers to declare unavailable expected sources", () => {
    const snapshot = projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:1",
      expectedSourceCuts: [{
        source: "goal",
        requiredness: "required",
        status: "unavailable",
        reasonCode: "goal_store_unavailable",
      }],
      seeds: [],
    });
    expect(snapshot.coverage.state).toBe("degraded");
    expect(snapshot.coverage.reasonCodes).toContain("goal_store_unavailable");
  });

  it("reports a required ephemeral observation source as degraded coverage", () => {
    const approval = fact("approval", "pending", {
      ...basePayload,
      approvalId: "approval:1",
    }, { durability: "ephemeral" });
    const snapshot = projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:1",
      expectedSourceCuts: [{
        source: "approval",
        requiredness: "optional",
        status: "unavailable",
      }],
      seeds: [seedFor(approval)],
    });
    expect(snapshot.coverage.state).toBe("degraded");
    expect(snapshot.coverage.reasonCodes).toContain("ephemeral_source");
  });

  it("degrades instead of leaking facts from another projection scope", () => {
    const otherScope = { ...scope, sessionId: "session:other" };
    const otherGoal = fact("goal", "executing", {
      ...basePayload,
      goalId: "goal:other",
    }, { scope: otherScope });
    const snapshot = projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:1",
      expectedSourceCuts: [],
      seeds: [seedFor(otherGoal)],
    });
    expect(snapshot.items).toEqual([]);
    expect(snapshot.coverage.state).toBe("degraded");
    expect(snapshot.sourceCuts[0]).toMatchObject({
      source: "goal",
      status: "incompatible",
      reasonCode: "fact_scope_mismatch",
    });
  });

  it("drops cross-scope contributors and degrades their source cut", () => {
    const otherScope = createConversationDisclosureScope({
      surface: "run",
      runId: "run:other",
      queryHash: "query:v1",
    });
    const primary = fact("goal", "executing", {
      ...basePayload,
      goalId: "goal:1",
    });
    const contributor = fact("trajectory", "tool_result", {
      ...basePayload,
      eventId: "event:other",
      runId: "run:other",
      sequence: 1,
    }, { scope: otherScope });
    const snapshot = projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:1",
      expectedSourceCuts: [],
      seeds: [seedFor(primary, [contributor])],
    });
    expect(snapshot.items[0]?.contributors).toEqual([]);
    expect(snapshot.coverage.state).toBe("degraded");
    expect(snapshot.sourceCuts).toContainEqual(expect.objectContaining({
      source: "trajectory",
      status: "incompatible",
      reasonCode: "contributor_scope_mismatch",
    }));
  });

  it("selects the same newest primary and source cut across seed reorder", () => {
    const older = fact("goal", "executing", {
      ...basePayload,
      goalId: "goal:1",
    }, {
      authorityRef: "goal:stable",
      domainRevision: "revision:1",
      occurredAt: "2026-08-18T00:00:00.000Z",
      requiredness: "optional",
    });
    const newer = fact("goal", "achieved", {
      ...basePayload,
      goalId: "goal:1",
    }, {
      authorityRef: "goal:stable",
      domainRevision: "revision:2",
      occurredAt: "2026-08-18T00:01:00.000Z",
      requiredness: "required",
    });
    const project = (seeds: ConversationProjectionSeed[]) =>
      projectConversationDisclosureSnapshot({
        scope,
        generation: "generation:1",
        expectedSourceCuts: [],
        seeds,
      });
    const forward = project([seedFor(older), seedFor(newer)]);
    const reverse = project([seedFor(newer), seedFor(older)]);
    expect(forward).toEqual(reverse);
    expect(forward.items[0]?.lifecycle).toBe("succeeded");
    expect(forward.sourceCuts[0]).toMatchObject({
      requiredness: "required",
      cursor: "revision:2",
    });
  });

  it("degrades same-time opaque revision conflicts without hiding failure", () => {
    const succeeded = fact("goal", "achieved", {
      ...basePayload,
      goalId: "goal:1",
    }, {
      authorityRef: "goal:stable",
      domainRevision: "opaque-z",
      occurredAt,
    });
    const failed = fact("goal", "failed", {
      ...basePayload,
      goalId: "goal:1",
    }, {
      authorityRef: "goal:stable",
      domainRevision: "opaque-a",
      occurredAt,
    });
    const project = (seeds: ConversationProjectionSeed[]) =>
      projectConversationDisclosureSnapshot({
        scope,
        generation: "generation:1",
        expectedSourceCuts: [],
        seeds,
      });
    const forward = project([seedFor(succeeded), seedFor(failed)]);
    const reverse = project([seedFor(failed), seedFor(succeeded)]);

    expect(forward).toEqual(reverse);
    expect(forward.items[0]?.lifecycle).toBe("failed");
    expect(forward.items[0]?.primarySource)
      .not.toHaveProperty("domainRevision");
    expect(forward.sourceCuts).toEqual([{
      source: "goal",
      sourceIdentity: "record:goal:stable",
      requiredness: "required",
      status: "incompatible",
      reasonCode: "source_cut_changed",
    }]);
    expect(forward.coverage.state).toBe("degraded");
  });

  it("chooses the safer lifecycle before the stable body tie-break", () => {
    const canceled = fact("goal", "canceled", {
      ...basePayload,
      goalId: "goal:1",
    }, {
      authorityRef: "goal:stable",
      domainRevision: "opaque-canceled",
      occurredAt,
    });
    const running = fact("goal", "executing", {
      ...basePayload,
      goalId: "goal:1",
    }, {
      authorityRef: "goal:stable",
      domainRevision: "opaque-running",
      occurredAt,
    });
    const project = (seeds: ConversationProjectionSeed[]) =>
      projectConversationDisclosureSnapshot({
        scope,
        generation: "generation:1",
        expectedSourceCuts: [],
        seeds,
      });

    const forward = project([seedFor(canceled), seedFor(running)]);
    const reverse = project([seedFor(running), seedFor(canceled)]);

    expect(forward).toEqual(reverse);
    expect(forward.items[0]?.lifecycle).toBe("canceled");
    expect(forward.sourceCuts[0]).toMatchObject({
      status: "incompatible",
      reasonCode: "source_cut_changed",
    });
  });

  it("unions contributors from every same-time conflicting seed", () => {
    const succeeded = fact("goal", "achieved", {
      ...basePayload,
      goalId: "goal:1",
    }, {
      authorityRef: "goal:stable",
      domainRevision: "opaque-succeeded",
      occurredAt,
    });
    const failed = fact("goal", "failed", {
      ...basePayload,
      goalId: "goal:1",
    }, {
      authorityRef: "goal:stable",
      domainRevision: "opaque-failed",
      occurredAt,
    });
    const firstContributor = fact("trajectory", "tool_call", {
      ...basePayload,
      eventId: "event:1",
      runId: "run:1",
      sequence: 1,
    }, {
      authorityRef: "event:1",
      domainRevision: "opaque-1",
    });
    const secondContributor = fact("trajectory", "tool_result", {
      ...basePayload,
      eventId: "event:2",
      runId: "run:1",
      sequence: 2,
    }, {
      authorityRef: "event:2",
      domainRevision: "opaque-2",
    });
    const project = (seeds: ConversationProjectionSeed[]) =>
      projectConversationDisclosureSnapshot({
        scope,
        generation: "generation:1",
        expectedSourceCuts: [],
        seeds,
      });

    const forward = project([
      seedFor(succeeded, [firstContributor]),
      seedFor(failed, [secondContributor]),
    ]);
    const reverse = project([
      seedFor(failed, [secondContributor]),
      seedFor(succeeded, [firstContributor]),
    ]);

    expect(forward).toEqual(reverse);
    expect(forward.items[0]).toMatchObject({
      lifecycle: "failed",
      contributorCount: 2,
      contributorsComplete: true,
    });
    expect(forward.items[0]?.contributors.map((ref) => ref.ref).sort())
      .toEqual(["event:1", "event:2"]);
    expect(forward.items[0]?.contributors.map(
      (ref) => ref.domainRevision,
    ).sort()).toEqual(["opaque-1", "opaque-2"]);
  });

  it("selects three same-time conflicts independently of seed order", () => {
    const seeds = ["A", "B", "C"].map((summary, index) =>
      seedFor(
        fact("goal", "failed", {
          ...basePayload,
          summary,
          goalId: "goal:1",
        }, {
          authorityRef: "goal:stable",
          domainRevision: `opaque-${summary}`,
          occurredAt,
        }),
        [fact("trajectory", "tool_result", {
          ...basePayload,
          eventId: `event:${summary}`,
          runId: "run:1",
          sequence: index + 1,
        }, {
          authorityRef: `event:${summary}`,
          domainRevision: `opaque-${summary}`,
        })],
      ));
    const permutations = [
      [seeds[0]!, seeds[1]!, seeds[2]!],
      [seeds[0]!, seeds[2]!, seeds[1]!],
      [seeds[1]!, seeds[0]!, seeds[2]!],
      [seeds[1]!, seeds[2]!, seeds[0]!],
      [seeds[2]!, seeds[0]!, seeds[1]!],
      [seeds[2]!, seeds[1]!, seeds[0]!],
    ];
    const snapshots = permutations.map((ordered) =>
      projectConversationDisclosureSnapshot({
        scope,
        generation: "generation:1",
        expectedSourceCuts: [],
        seeds: ordered,
      }));

    for (const snapshot of snapshots.slice(1)) {
      expect(snapshot).toEqual(snapshots[0]);
    }
    expect(snapshots[0]!.items[0]).toMatchObject({
      lifecycle: "failed",
      contributorCount: 3,
      contributorsComplete: true,
    });
  });

  it("uses locale-independent code-unit ordering for conflicting bodies", () => {
    const seeds = ["z", "\u00e4"].map((summary) =>
      seedFor(fact("goal", "failed", {
        ...basePayload,
        summary,
        goalId: "goal:1",
      }, {
        authorityRef: "goal:stable",
        domainRevision: "opaque-conflict",
        occurredAt,
      })));
    const project = (ordered: ConversationProjectionSeed[]) =>
      projectConversationDisclosureSnapshot({
        scope,
        generation: "generation:1",
        expectedSourceCuts: [],
        seeds: ordered,
      });

    const forward = project(seeds);
    const reverse = project([...seeds].reverse());

    expect(forward).toEqual(reverse);
    expect(forward.items[0]).toMatchObject({
      summary: "\u00e4",
      lifecycle: "failed",
    });
    expect(forward.sourceCuts).toContainEqual(expect.objectContaining({
      sourceIdentity: "record:goal:stable",
      status: "incompatible",
      reasonCode: "source_cut_changed",
    }));
  });

  it("degrades equal-time durability conflicts independently of order", () => {
    const durable = fact("goal", "executing", {
      ...basePayload,
      goalId: "goal:1",
    }, {
      authorityRef: "goal:stable",
      durability: "durable",
      occurredAt,
    });
    const ephemeral = {
      ...durable,
      durability: "ephemeral" as const,
    };
    const project = (seeds: ConversationProjectionSeed[]) =>
      projectConversationDisclosureSnapshot({
        scope,
        generation: "generation:1",
        expectedSourceCuts: [],
        seeds,
      });

    const forward = project([seedFor(durable), seedFor(ephemeral)]);
    const reverse = project([seedFor(ephemeral), seedFor(durable)]);

    expect(forward).toEqual(reverse);
    expect(forward.coverage.state).toBe("degraded");
    expect(forward.sourceCuts).toContainEqual(expect.objectContaining({
      sourceIdentity: "record:goal:stable",
      status: "incompatible",
      reasonCode: "source_cut_changed",
    }));
  });

  it("selects a higher numeric revision before a newer timestamp", () => {
    const revisionTwo = fact("goal", "executing", {
      ...basePayload,
      summary: "revision two",
      goalId: "goal:1",
    }, {
      authorityRef: "goal:stable",
      domainRevision: "2",
      occurredAt: "2026-08-18T00:00:00.000Z",
    });
    const revisionOne = fact("goal", "executing", {
      ...basePayload,
      summary: "revision one",
      goalId: "goal:1",
    }, {
      authorityRef: "goal:stable",
      domainRevision: "1",
      occurredAt: "2026-08-18T00:01:00.000Z",
    });
    const project = (seeds: ConversationProjectionSeed[]) =>
      projectConversationDisclosureSnapshot({
        scope,
        generation: "generation:1",
        expectedSourceCuts: [],
        seeds,
      });

    const forward = project([seedFor(revisionTwo), seedFor(revisionOne)]);
    const reverse = project([seedFor(revisionOne), seedFor(revisionTwo)]);

    expect(forward).toEqual(reverse);
    expect(forward.items[0]).toMatchObject({
      summary: "revision two",
      primarySource: { domainRevision: "2" },
    });
    expect(forward.sourceCuts).toContainEqual(expect.objectContaining({
      sourceIdentity: "record:goal:stable",
      cursor: "2",
      status: "complete",
    }));
  });

  it("degrades conflicting bodies at the same numeric revision across timestamps", () => {
    const earlier = fact("goal", "executing", {
      ...basePayload,
      summary: "earlier body",
      goalId: "goal:1",
    }, {
      authorityRef: "goal:stable",
      domainRevision: "2",
      occurredAt: "2026-08-18T00:00:00.000Z",
    });
    const later = fact("goal", "failed", {
      ...basePayload,
      summary: "later body",
      goalId: "goal:1",
    }, {
      authorityRef: "goal:stable",
      domainRevision: "2",
      occurredAt: "2026-08-18T00:01:00.000Z",
    });
    const project = (seeds: ConversationProjectionSeed[]) =>
      projectConversationDisclosureSnapshot({
        scope,
        generation: "generation:1",
        expectedSourceCuts: [],
        seeds,
      });

    const forward = project([seedFor(earlier), seedFor(later)]);
    const reverse = project([seedFor(later), seedFor(earlier)]);

    expect(forward).toEqual(reverse);
    expect(forward.items[0]?.lifecycle).toBe("failed");
    expect(forward.items[0]?.primarySource)
      .not.toHaveProperty("domainRevision");
    expect(forward.sourceCuts).toContainEqual(expect.objectContaining({
      sourceIdentity: "record:goal:stable",
      status: "incompatible",
      reasonCode: "source_cut_changed",
    }));
    expect(forward.coverage.state).toBe("degraded");
  });

  it("selects mixed numeric and opaque revisions independently of seed order", () => {
    const numeric = fact("goal", "executing", {
      ...basePayload,
      summary: "numeric",
      goalId: "goal:1",
    }, {
      authorityRef: "goal:stable",
      domainRevision: "2",
      occurredAt: "2026-08-18T00:00:00.000Z",
    });
    const opaqueEarlier = fact("goal", "failed", {
      ...basePayload,
      summary: "opaque earlier",
      goalId: "goal:1",
    }, {
      authorityRef: "goal:stable",
      domainRevision: "opaque-a",
      occurredAt: "2026-08-18T00:01:00.000Z",
    });
    const opaqueLater = fact("goal", "canceled", {
      ...basePayload,
      summary: "opaque later",
      goalId: "goal:1",
    }, {
      authorityRef: "goal:stable",
      domainRevision: "opaque-b",
      occurredAt: "2026-08-18T00:02:00.000Z",
    });
    const seeds = [
      seedFor(numeric),
      seedFor(opaqueEarlier),
      seedFor(opaqueLater),
    ];
    const permutations = [
      seeds,
      [seeds[0]!, seeds[2]!, seeds[1]!],
      [seeds[1]!, seeds[0]!, seeds[2]!],
      [seeds[1]!, seeds[2]!, seeds[0]!],
      [seeds[2]!, seeds[0]!, seeds[1]!],
      [seeds[2]!, seeds[1]!, seeds[0]!],
    ];
    const snapshots = permutations.map((ordered) =>
      projectConversationDisclosureSnapshot({
        scope,
        generation: "generation:1",
        expectedSourceCuts: [],
        seeds: ordered,
      }));

    for (const snapshot of snapshots.slice(1)) {
      expect(snapshot).toEqual(snapshots[0]);
    }
    expect(snapshots[0]!.items[0]).toMatchObject({
      summary: "numeric",
    });
    expect(snapshots[0]!.items[0]?.primarySource)
      .not.toHaveProperty("domainRevision");
    expect(snapshots[0]!.coverage.state).toBe("degraded");
  });

  it("classifies known observations and preserves unknown kinds/statuses", () => {
    expect(isKnownConversationFactKind("goal")).toBe(true);
    expect(isKnownConversationFactKind("future_kind")).toBe(false);
    expect(isKnownConversationDomainStatus("goal", "waiting_for_review")).toBe(true);
    expect(isKnownConversationDomainStatus("goal", "future_status")).toBe(false);
    expect(classifyConversationRuntimeObservation({
      kind: "goal",
      domainStatus: "waiting_for_review",
      requiredness: "required",
      authorityRef: "goal:1",
      scope,
      semanticSlot: "goal-status",
      safeSummary: "待复核",
      occurredAt,
    })).toEqual({
      kind: "known",
      factKind: "goal",
      domainStatus: "waiting_for_review",
    });
    const future = classifyConversationRuntimeObservation({
      kind: "goal",
      domainStatus: "future_status",
      requiredness: "optional",
      durability: "ephemeral",
      sensitivity: "restricted",
      domainRevision: "future:2",
      scope,
      semanticSlot: "goal-status",
      safeSummary: "未来状态",
      occurredAt,
    });
    expect(future.kind).toBe("unknown");
    if (future.kind === "unknown") {
      expect(future.fact.originalKind).toBe("goal");
      expect(future.fact.domainStatus).toBe("future_status");
      expect(future.fact.authorityRef).toMatch(/^legacy:/);
      expect(future.fact).toMatchObject({
        domainRevision: "future:2",
        durability: "ephemeral",
        sensitivity: "restricted",
      });
    }
    const missingAuthority = classifyConversationRuntimeObservation({
      kind: "goal",
      domainStatus: "executing",
      requiredness: "optional",
      requestId: "request:stable",
      sequence: 4,
      scope,
      semanticSlot: "goal-status",
      safeSummary: "缺少权威 id",
      occurredAt,
    });
    expect(missingAuthority.kind).toBe("unknown");
    if (missingAuthority.kind === "unknown") {
      expect(missingAuthority.fact.authorityRef).toMatch(/^legacy:/);
    }
  });
});

describe("conversation disclosure delta reducer", () => {
  it("applies an exact next delta and keeps deterministic ordering", () => {
    const snapshot = emptySnapshot();
    const item = projectConversationDisclosureItem(seedFor(fact("goal", "executing", {
      ...basePayload,
      goalId: "goal:1",
    })));
    const result = applyConversationDisclosureDelta(snapshot, delta(snapshot, {
      upserts: [item],
    }));
    expect(result.kind).toBe("applied");
    expect(result.state.cursor).toBe(1);
    expect(result.state.items).toEqual([item]);
  });

  it("treats exact stale delivery as a no-op with original identity", () => {
    const base = { ...emptySnapshot(), cursor: 1 };
    const replay = delta(base, {
      fromCursor: 1,
      toCursor: 2,
    });
    const snapshot = { ...base, cursor: 2, lastDeltaId: replay.deltaId };
    const result = applyConversationDisclosureDelta(snapshot, replay);
    expect(result.kind).toBe("duplicate");
    expect(result.state).toBe(snapshot);
  });

  it("rejects a different payload that claims the current cursor range", () => {
    const base = { ...emptySnapshot(), cursor: 1 };
    const accepted = delta(base, { fromCursor: 1, toCursor: 2 });
    const snapshot = { ...base, cursor: 2, lastDeltaId: accepted.deltaId };
    const result = applyConversationDisclosureDelta(snapshot, delta(snapshot, {
      fromCursor: 1,
      toCursor: 2,
      removals: ["different-payload"],
    }));
    expect(result).toMatchObject({
      kind: "reset_required",
      reason: "conflicting_duplicate_delta",
    });
    expect(result.state).toBe(snapshot);
  });

  it("requires replay-ring proof instead of accepting an older delta blindly", () => {
    const snapshot = { ...emptySnapshot(), cursor: 4 };
    const result = applyConversationDisclosureDelta(snapshot, delta(snapshot, {
      fromCursor: 1,
      toCursor: 2,
    }));
    expect(result).toMatchObject({
      kind: "reset_required",
      reason: "historical_delta_unverified",
    });
    expect(result.state).toBe(snapshot);
  });

  it.each([
    ["cursor_overlap", { fromCursor: 1, toCursor: 3 }],
    ["cursor_gap", { fromCursor: 3, toCursor: 4 }],
    ["generation_mismatch", { generation: "generation:2" }],
    ["scope_mismatch", { queryHash: "other-query" }],
    ["projection_mismatch", { projectionVersion: 2 }],
  ] as const)("requests reset for %s", (reason, changes) => {
    const snapshot = { ...emptySnapshot(), cursor: 2 };
    const result = applyConversationDisclosureDelta(
      snapshot,
      delta(snapshot, changes as Partial<ConversationDisclosureDelta>),
    );
    expect(result).toMatchObject({ kind: "reset_required", reason });
    expect(result.state).toBe(snapshot);
  });

  it("rejects coverage that claims complete over a partial source cut", () => {
    const snapshot = emptySnapshot();
    const result = applyConversationDisclosureDelta(snapshot, delta(snapshot, {
      sourceCutChanges: [{
        source: "approval",
        requiredness: "optional",
        status: "ephemeral",
      }],
    }));
    expect(result).toMatchObject({
      kind: "reset_required",
      reason: "dishonest_coverage",
    });
    expect(result.state).toBe(snapshot);
  });

  it("does not let a delta weaken source requiredness or improve its cut in-generation", () => {
    const snapshot = projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:1",
      expectedSourceCuts: [{
        source: "goal",
        requiredness: "required",
        status: "partial",
      }],
      seeds: [],
    });
    const result = applyConversationDisclosureDelta(snapshot, delta(snapshot, {
      sourceCutChanges: [{
        source: "goal",
        requiredness: "ignorable",
        status: "complete",
      }],
      coverage: { state: "complete", reasonCodes: [] },
    }));
    expect(result).toMatchObject({
      kind: "reset_required",
      reason: "source_cut_improved",
    });
    expect(result.state).toBe(snapshot);
  });

  it("forces snapshot reload when a required source becomes incompatible", () => {
    const snapshot = emptySnapshot();
    const result = applyConversationDisclosureDelta(snapshot, delta(snapshot, {
      sourceCutChanges: [{
        source: "goal",
        requiredness: "required",
        status: "incompatible",
      }],
      coverage: { state: "degraded", reasonCodes: ["future_goal"] },
    }));
    expect(result).toMatchObject({
      kind: "reset_required",
      reason: "required_source_incompatible",
    });
  });

  it("keeps distinct owning records in one domain as distinct source cuts", () => {
    const first = fact("plan", "executing", {
      ...basePayload,
      planId: "plan:1",
      revision: 1,
      actionGate: "ready",
    }, {
      authorityRef: "plan:1",
      domainRevision: "1",
    });
    const second = fact("plan", "completed", {
      ...basePayload,
      planId: "plan:2",
      revision: 2,
      actionGate: "ready",
    }, {
      authorityRef: "plan:2",
      domainRevision: "2",
    });
    const snapshot = projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:1",
      expectedSourceCuts: [],
      seeds: [seedFor(first), seedFor(second)],
    });

    expect(snapshot.coverage.state).toBe("complete");
    expect(snapshot.sourceCuts.filter((cut) => cut.source === "plan"))
      .toEqual([
        expect.objectContaining({
          sourceIdentity: "record:plan:1",
          cursor: "1",
          status: "complete",
        }),
        expect.objectContaining({
          sourceIdentity: "record:plan:2",
          cursor: "2",
          status: "complete",
        }),
      ]);
  });

  it("marks conflicting opaque cuts incompatible without choosing a cursor", () => {
    const snapshot = projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:1",
      expectedSourceCuts: [
        {
          source: "trajectory",
          sourceIdentity: "run_1",
          cursor: "opaque-z",
          requiredness: "optional",
          status: "complete",
        },
        {
          source: "trajectory",
          sourceIdentity: "run_1",
          cursor: "opaque-a",
          requiredness: "optional",
          status: "complete",
        },
      ],
      seeds: [],
    });

    expect(snapshot.sourceCuts).toEqual([{
      source: "trajectory",
      sourceIdentity: "run_1",
      requiredness: "optional",
      status: "incompatible",
      reasonCode: "source_cut_changed",
    }]);
    expect(snapshot.coverage.state).toBe("degraded");
  });

  it("never orders opaque source revisions lexicographically", () => {
    const snapshot = projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:1",
      expectedSourceCuts: [{
        source: "trajectory",
        sourceIdentity: "run_1",
        cursor: "opaque-z",
        requiredness: "optional",
        status: "complete",
      }],
      seeds: [],
    });
    const result = applyConversationDisclosureDelta(snapshot, delta(snapshot, {
      sourceCutChanges: [{
        source: "trajectory",
        sourceIdentity: "run_1",
        cursor: "opaque-a",
        requiredness: "optional",
        status: "complete",
      }],
      coverage: {
        state: "complete",
        reasonCodes: [],
      },
    }));
    expect(result.kind).toBe("applied");
    expect(result.state.sourceCuts).toContainEqual(expect.objectContaining({
      source: "trajectory",
      sourceIdentity: "run_1",
      cursor: "opaque-a",
    }));
  });

  it("rejects a delta id that does not fingerprint its complete body", () => {
    const snapshot = emptySnapshot();
    const result = applyConversationDisclosureDelta(snapshot, delta(snapshot, {
      deltaId: "delta:forged",
    }));
    expect(result).toMatchObject({
      kind: "reset_required",
      reason: "invalid_delta_id",
    });
  });

  it("clones delta upserts before publishing the accepted snapshot", () => {
    const snapshot = emptySnapshot();
    const item = projectConversationDisclosureItem(seedFor(fact("goal", "executing", {
      ...basePayload,
      goalId: "goal:1",
    })));
    const result = applyConversationDisclosureDelta(snapshot, delta(snapshot, {
      upserts: [item],
    }));
    expect(result.kind).toBe("applied");
    item.summary = "mutated after apply";
    expect(result.state.items[0]?.summary).toBe("安全摘要");
  });

  it("tracks attempt settlements per request and prevents resurrection", () => {
    const snapshot = emptySnapshot();
    const begun = applyConversationDisclosureDelta(snapshot, delta(snapshot, {
      attemptControls: [{
        requestId: "request:1",
        turnId: "turn:1",
        attempt: 1,
        sequence: 1,
        operation: "begin",
      }],
    }));
    expect(begun.kind).toBe("applied");
    const reset = applyConversationDisclosureDelta(begun.state, delta(begun.state, {
      attemptControls: [{
        requestId: "request:1",
        turnId: "turn:1",
        attempt: 1,
        sequence: 2,
        operation: "reset",
      }],
    }));
    expect(reset.kind).toBe("applied");
    expect(reset.state.attemptSettlements[0]).toMatchObject({
      requestId: "request:1",
      turnId: "turn:1",
      attempt: 1,
      outcome: "reset",
    });
    const resurrection = applyConversationDisclosureDelta(reset.state, delta(reset.state, {
      attemptControls: [{
        requestId: "request:1",
        turnId: "turn:1",
        attempt: 1,
        sequence: 3,
        operation: "begin",
      }],
    }));
    expect(resurrection).toMatchObject({
      kind: "reset_required",
      reason: "attempt_begin_gap",
    });
  });

  it("rejects a bare delta accept without a canonical durable witness", () => {
    const snapshot = projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:1",
      expectedSourceCuts: [],
      seeds: [],
      activeAttempts: [{
        requestId: "request:bare",
        turnId: "turn:1",
        attempt: 1,
        lastSequence: 1,
        answerText: "partial",
      }],
    });
    const result = applyConversationDisclosureDelta(snapshot, delta(snapshot, {
      attemptControls: [{
        requestId: "request:bare",
        turnId: "turn:1",
        attempt: 1,
        sequence: 2,
        operation: "accept",
        acceptedMessageId: "message:bare",
      }] as never,
    }));
    expect(result).toMatchObject({
      kind: "reset_required",
      reason: "attempt_accept_witness_invalid",
    });
    expect(result.state).toBe(snapshot);
  });

  it("accepts only the canonical reducer's persisted assistant settlement", () => {
    const witness = acceptedSettlementFixture("request:witness");
    const snapshot = projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:1",
      expectedSourceCuts: [],
      seeds: [],
      activeAttempts: [{
        requestId: "request:witness",
        turnId: "turn:1",
        attempt: 1,
        lastSequence: 1,
        answerText: "partial",
      }],
    });
    const result = applyConversationDisclosureDelta(snapshot, delta(snapshot, {
      attemptControls: [{
        requestId: "request:witness",
        turnId: "turn:1",
        attempt: 1,
        sequence: 2,
        operation: "accept",
        acceptedSettlement: witness,
      }],
    }));
    expect(result.kind).toBe("applied");
    expect(result.state.activeAttempts).toEqual([]);
    expect(result.state.attemptSettlements).toEqual([witness]);
  });

  it("binds durable content fingerprint into the accepted receipt", () => {
    const witness = acceptedSettlementFixture("request:tampered-content");
    const tampered = {
      ...witness,
      acceptedContentFingerprint: "0000000000000000",
    };
    expect(() => projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:1",
      expectedSourceCuts: [],
      seeds: [],
      attemptSettlements: [tampered],
    })).toThrow(/accepted_settlement_witness_invalid/);

    const snapshot = projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:1",
      expectedSourceCuts: [],
      seeds: [],
      activeAttempts: [{
        requestId: "request:tampered-content",
        turnId: "turn:1",
        attempt: 1,
        lastSequence: 1,
        answerText: "partial",
      }],
    });
    const result = applyConversationDisclosureDelta(snapshot, delta(snapshot, {
      attemptControls: [{
        requestId: "request:tampered-content",
        turnId: "turn:1",
        attempt: 1,
        sequence: 2,
        operation: "accept",
        acceptedSettlement: tampered,
      }],
    }));
    expect(result).toMatchObject({
      kind: "reset_required",
      reason: "attempt_accept_witness_invalid",
    });
    expect(result.state).toBe(snapshot);
  });

  it("rejects an initial active attempt that conflicts with accepted truth", () => {
    const witness = acceptedSettlementFixture("request:conflict");
    expect(() => projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:1",
      expectedSourceCuts: [],
      seeds: [],
      activeAttempts: [{
        requestId: "request:conflict",
        turnId: "turn:1",
        attempt: 2,
        lastSequence: 3,
        answerText: "must not exist",
      }],
      attemptSettlements: [witness],
    })).toThrow(/accepted_with_active_attempt/);
  });

  it.each(["reset", "supersede"] as const)(
    "does not let %s overwrite accepted truth",
    (operation) => {
      const witness = acceptedSettlementFixture("request:terminal");
      const snapshot = projectConversationDisclosureSnapshot({
        scope,
        generation: "generation:1",
        expectedSourceCuts: [],
        seeds: [],
        attemptSettlements: [witness],
      });
      const result = applyConversationDisclosureDelta(snapshot, delta(snapshot, {
        attemptControls: [operation === "reset"
          ? {
              requestId: "request:terminal",
              turnId: "turn:1",
              attempt: 1,
              sequence: 3,
              operation,
            }
          : {
              requestId: "request:terminal",
              turnId: "turn:1",
              attempt: 2,
              sequence: 3,
              operation,
              supersedesAttempt: 1,
            }],
      }));
      expect(result).toMatchObject({
        kind: "reset_required",
        reason: "attempt_already_accepted",
      });
    },
  );

  it("does not evict accepted tombstones at an arbitrary global stream cap", () => {
    const settlements = Array.from({ length: 70 }, (_, index) =>
      acceptedSettlementFixture(`request:${String(index).padStart(2, "0")}`));
    const snapshot = projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:1",
      expectedSourceCuts: [],
      seeds: [],
      attemptSettlements: settlements,
    });
    expect(snapshot.attemptSettlements).toHaveLength(70);
    const result = applyConversationDisclosureDelta(snapshot, delta(snapshot, {
      attemptControls: [{
        requestId: "request:00",
        turnId: "turn:1",
        attempt: 2,
        sequence: 3,
        operation: "begin",
      }],
    }));
    expect(result).toMatchObject({
      kind: "reset_required",
      reason: "attempt_already_accepted",
    });
  });
});

describe("canonical live answer reducer", () => {
  const begin = {
    requestId: "request:1",
    turnId: "turn:1",
    attempt: 1,
    sequence: 1,
    operation: "begin" as const,
  };

  it("creates the same durable accepted receipt without persisting answer text", () => {
    const receipt = createConversationAcceptedAttemptSettlement({
      requestId: "request:receipt",
      turnId: "turn:receipt",
      attempt: 2,
      sequence: 7,
      acceptedMessageId: "message:receipt",
      persistedMessage: {
        id: "message:receipt",
        role: "assistant",
        requestId: "request:receipt",
        turnId: "turn:receipt",
        content: "durable answer that stays in Chat storage",
      },
    });
    expect(receipt).toMatchObject({
      outcome: "accepted",
      attempt: 2,
      lastSequence: 7,
      acceptedMessageRole: "assistant",
      acceptedContentFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/),
      acceptanceReceiptFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
    expect(() => createConversationAcceptedAttemptSettlement({
      requestId: "request:receipt",
      turnId: "turn:receipt",
      attempt: 2,
      sequence: 7,
      acceptedMessageId: "message:receipt",
      persistedMessage: {
        id: "message:receipt",
        role: "user",
        requestId: "request:receipt",
        turnId: "turn:receipt",
        content: "forged",
      },
    })).toThrow(/assistant message/);
  });

  function apply(
    state: ConversationLiveAnswerState,
    event: Parameters<typeof reduceConversationLiveAnswer>[1],
    persisted?: Parameters<typeof reduceConversationLiveAnswer>[2],
  ) {
    const result = reduceConversationLiveAnswer(state, event, persisted);
    expect(result.kind).toBe("applied");
    return result.state;
  }

  it("assembles one answer channel and ignores exact duplicates", () => {
    const initial: ConversationLiveAnswerState = { streams: [] };
    const begun = apply(initial, begin);
    const event = {
      schemaVersion: 1 as const,
      requestId: "request:1",
      turnId: "turn:1",
      attempt: 1,
      sequence: 2,
      channel: "answer" as const,
      text: "第一段",
    };
    const streamed = apply(begun, event);
    expect(getActiveConversationAttempts(streamed)[0]?.answerText).toBe("第一段");
    const replay = reduceConversationLiveAnswer(streamed, event);
    expect(replay.kind).toBe("duplicate");
    expect(replay.state).toBe(streamed);
  });

  it("rejects conflicting duplicates and sequence gaps without mutation", () => {
    const begun = apply({ streams: [] }, begin);
    const gap = reduceConversationLiveAnswer(begun, {
      schemaVersion: 1,
      requestId: "request:1",
      turnId: "turn:1",
      attempt: 1,
      sequence: 3,
      channel: "answer",
      text: "gap",
    });
    expect(gap).toMatchObject({ kind: "reset_required", reason: "attempt_sequence_gap" });
    expect(gap.state).toBe(begun);

    const first = apply(begun, {
      schemaVersion: 1,
      requestId: "request:1",
      turnId: "turn:1",
      attempt: 1,
      sequence: 2,
      channel: "answer",
      text: "first",
    });
    const conflict = reduceConversationLiveAnswer(first, {
      schemaVersion: 1,
      requestId: "request:1",
      turnId: "turn:1",
      attempt: 1,
      sequence: 2,
      channel: "answer",
      text: "different",
    });
    expect(conflict).toMatchObject({
      kind: "reset_required",
      reason: "conflicting_duplicate",
    });
    expect(conflict.state).toBe(first);
  });

  it("settles reset, erases partial text, and requires the next attempt", () => {
    let state = apply({ streams: [] }, begin);
    state = apply(state, {
      schemaVersion: 1,
      requestId: "request:1",
      turnId: "turn:1",
      attempt: 1,
      sequence: 2,
      channel: "answer",
      text: "must disappear",
    });
    state = apply(state, { ...begin, sequence: 3, operation: "reset" });
    expect(getActiveConversationAttempts(state)).toEqual([]);
    expect(state.streams[0]?.settlement).toMatchObject({
      requestId: "request:1",
      turnId: "turn:1",
      outcome: "reset",
      attempt: 1,
    });
    const oldAttempt = reduceConversationLiveAnswer(state, {
      ...begin,
      sequence: 4,
    });
    expect(oldAttempt).toMatchObject({
      kind: "reset_required",
      reason: "attempt_number_gap",
    });
    const retry = apply(state, {
      ...begin,
      attempt: 2,
      sequence: 4,
    });
    expect(getActiveConversationAttempts(retry)[0]).toMatchObject({
      attempt: 2,
      answerText: "",
    });
  });

  it("settles superseded attempts and refuses late output", () => {
    let state = apply({ streams: [] }, begin);
    state = apply(state, {
      ...begin,
      attempt: 2,
      sequence: 2,
      operation: "supersede",
      supersedesAttempt: 1,
    });
    const late = reduceConversationLiveAnswer(state, {
      schemaVersion: 1,
      requestId: "request:1",
      turnId: "turn:1",
      attempt: 1,
      sequence: 3,
      channel: "answer",
      text: "late",
    });
    expect(late).toMatchObject({
      kind: "reset_required",
      reason: "delta_for_inactive_attempt",
    });
  });

  it("accepts only a persisted assistant message with matching lineage", () => {
    let state = apply({ streams: [] }, begin);
    state = apply(state, {
      schemaVersion: 1,
      requestId: "request:1",
      turnId: "turn:1",
      attempt: 1,
      sequence: 2,
      channel: "answer",
      text: "partial",
    });
    const missing = reduceConversationLiveAnswer(state, {
      ...begin,
      sequence: 3,
      operation: "accept",
      acceptedMessageId: "message:1",
    });
    expect(missing).toMatchObject({
      kind: "rejected",
      reason: "accepted_message_not_persisted",
    });
    expect(missing.state).toBe(state);

    const mismatch = reduceConversationLiveAnswer(state, {
      ...begin,
      sequence: 3,
      operation: "accept",
      acceptedMessageId: "message:1",
    }, {
      id: "message:1",
      role: "assistant",
      requestId: "other-request",
      turnId: "turn:1",
      content: "durable",
    });
    expect(mismatch).toMatchObject({
      kind: "reset_required",
      reason: "accepted_message_lineage_mismatch",
    });

    const userMessage = reduceConversationLiveAnswer(state, {
      ...begin,
      sequence: 3,
      operation: "accept",
      acceptedMessageId: "message:1",
    }, {
      id: "message:1",
      role: "user",
      requestId: "request:1",
      turnId: "turn:1",
      content: "not an assistant answer",
    });
    expect(userMessage).toMatchObject({
      kind: "rejected",
      reason: "accepted_message_not_assistant",
    });

    const accepted = reduceConversationLiveAnswer(state, {
      ...begin,
      sequence: 3,
      operation: "accept",
      acceptedMessageId: "message:1",
    }, {
      id: "message:1",
      role: "assistant",
      requestId: "request:1",
      turnId: "turn:1",
      content: "durable canonical answer",
    });
    expect(accepted.kind).toBe("applied");
    expect(getActiveConversationAttempts(accepted.state)).toEqual([]);
    expect(accepted.state.streams[0]?.settlement).toMatchObject({
      outcome: "accepted",
      acceptedMessageId: "message:1",
      acceptedContentFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
    const reopened = reduceConversationLiveAnswer(accepted.state, {
      ...begin,
      attempt: 2,
      sequence: 4,
    });
    expect(reopened).toMatchObject({
      kind: "reset_required",
      reason: "attempt_already_accepted",
    });

    const alternative = reduceConversationLiveAnswer(state, {
      ...begin,
      sequence: 3,
      operation: "accept",
      acceptedMessageId: "message:1",
    }, {
      id: "message:1",
      role: "assistant",
      requestId: "request:1",
      turnId: "turn:1",
      content: "different durable answer",
    });
    expect(alternative.kind).toBe("applied");
    const acceptedSettlement = accepted.state.streams[0]?.settlement;
    const alternativeSettlement = alternative.state.streams[0]?.settlement;
    if (
      acceptedSettlement?.outcome !== "accepted"
      || alternativeSettlement?.outcome !== "accepted"
    ) throw new Error("accepted settlement missing");
    expect(alternativeSettlement.acceptedContentFingerprint)
      .not.toBe(acceptedSettlement.acceptedContentFingerprint);
  });

  it("keeps interleaved request/turn streams independent", () => {
    let state = apply({ streams: [] }, begin);
    state = apply(state, {
      ...begin,
      requestId: "request:2",
      turnId: "turn:2",
    });
    state = apply(state, {
      schemaVersion: 1,
      requestId: "request:2",
      turnId: "turn:2",
      attempt: 1,
      sequence: 2,
      channel: "answer",
      text: "second",
    });
    expect(getActiveConversationAttempts(state)).toHaveLength(2);
    expect(getActiveConversationAttempts(state)[1]?.answerText).toBe("second");
  });
});

describe("safe summary boundary", () => {
  it("redacts before applying UTF-8 byte and line bounds", () => {
    const fakeSecret = "sk-fake000000000000000000000000";
    const summary = sanitizeConversationDisclosureSummary(
      `开始 ${fakeSecret}\n第二行🙂🙂🙂\n第三行`,
      { maxBytes: 36, maxLines: 2 },
    );
    expect(summary.redacted).toBe(true);
    expect(summary.truncated).toBe(true);
    expect(summary.text).not.toContain(fakeSecret);
    expect(new TextEncoder().encode(summary.text).byteLength).toBeLessThanOrEqual(36);
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(
      new TextEncoder().encode(summary.text),
    )).not.toThrow();
  });

  it.each([
    "Bearer abcdefghijklmnop",
    "api_key=abcdef1234567890",
    "https://example.test?a=1&access_token=abcdef1234567890",
    "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    "Authorization: Basic YWJjZGVmZ2hpamts",
    "OPENAI_API_KEY=abcdef1234567890",
    "postgres://user:supersecret@example.test/db",
    "eyJabcdefghijk.abcdefghijkl.abcdefghijkl",
  ])("removes secret-shaped text: %s", (secret) => {
    const result = sanitizeConversationDisclosureSummary(`prefix ${secret} suffix`);
    expect(result.redacted).toBe(true);
    expect(result.text).not.toContain("abcdef1234567890");
    expect(result.text).not.toContain("PRIVATE KEY-----\nabc");
  });

  it.each([
    "/Users/private/workspace/result.json",
    "~/private/input.txt",
    "../private/input.txt",
    "src/private/input.txt",
    "[src/private/input.txt]",
    "{../private/input.txt}",
    String.raw`C:\Users\private\result.json`,
    String.raw`src\private\result.json`,
    "file:///Users/private/workspace/result.json",
  ])("removes path-shaped summary text: %s", (path) => {
    const result = sanitizeConversationDisclosureSummary(
      `Evidence stored at ${path}`,
    );
    expect(result.redacted).toBe(true);
    expect(result.text).toContain("[redacted-path]");
    expect(result.text).not.toContain(path);
  });

  it("never exceeds a byte cap smaller than the ellipsis itself", () => {
    const result = sanitizeConversationDisclosureSummary("🙂secret", {
      maxBytes: 1,
      maxLines: 1,
    });
    expect(result.truncated).toBe(true);
    expect(new TextEncoder().encode(result.text).byteLength).toBeLessThanOrEqual(1);
  });

  it("exposes only bounded safe payload fields and no raw reasoning contract", () => {
    const item: ConversationDisclosureItem = projectConversationDisclosureItem(
      seedFor(fact("trajectory", "model_reasoning", {
        ...basePayload,
        eventId: "event:reasoning",
        runId: "run:1",
        sequence: 1,
        summary: "模型处理中",
      })),
    );
    expect(item.summary).toBe("模型处理中");
    expect(item).not.toHaveProperty("rawPayload");
    expect(item).not.toHaveProperty("reasoning");
    expect(item).not.toHaveProperty("toolArgs");
  });
});
