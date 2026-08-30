import { describe, expect, it, vi } from "vitest";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import type { Goal } from "../shared/agentGoal";
import type { PlanRecord } from "../shared/planMode";
import type {
  ConversationCausalAttemptState,
  ConversationCausalRecord,
} from "../shared/conversationCausalSpine";
import {
  createConversationDisclosureScope,
} from "../shared/conversationDisclosure";
import { createConversationSourcePage } from "../shared/conversationEvidence";
import type { ToolInvocationRecord } from "../shared/toolInvocationLedger";
import {
  createConversationDisclosureMaterializer,
} from "./conversationDisclosureMaterializer";

const scope = createConversationDisclosureScope({
  surface: "scheduled",
  sessionId: "session_1",
  queryHash: "query:all",
});

describe("conversation disclosure materializer", () => {
  it("publishes an initial snapshot, one delta, duplicate, and replay", async () => {
    let run = makeRun("running");
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({ scope, agentRuns: [run] }),
      createGenerationId: sequence("g"),
      now: sequenceNumber(),
    });

    const initial = await materializer.refresh(scope);
    expect(initial).toMatchObject({
      kind: "snapshot",
      reason: "initial",
      snapshot: { cursor: 0 },
    });
    run = makeRun("succeeded");
    const changed = await materializer.refresh(scope);
    expect(changed).toMatchObject({
      kind: "delta",
      delta: { fromCursor: 0, toCursor: 1 },
      snapshot: { cursor: 1 },
    });
    if (changed.kind !== "delta") {
      throw new Error("expected one retained delta");
    }
    expect(await materializer.refresh(scope)).toMatchObject({
      kind: "duplicate",
      snapshot: { cursor: 1 },
    });
    await expect(materializer.replay(scope, {
      generation: initial.snapshot.generation,
      cursor: 0,
    })).resolves.toMatchObject({
      kind: "deltas",
      deltas: [{ fromCursor: 0, toCursor: 1 }],
    });
    await expect(materializer.replayRetention(scope)).resolves.toEqual({
      generation: initial.snapshot.generation,
      cursor: 1,
      ringEntries: 1,
      protectedRingEntries: 1,
      ringBytes: Buffer.byteLength(JSON.stringify(changed.delta), "utf8"),
    });
  });

  it("rotates generation when degraded coverage recovers", async () => {
    let requiredUnknown = true;
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({
        scope,
        unknownFacts: requiredUnknown
          ? [{
              schemaVersion: 2,
              originalKind: "future_required",
              authorityRef: "future_1",
              scope,
              domainStatus: "future",
              requiredness: "required",
              durability: "durable",
              sensitivity: "technical",
              occurredAt: "2026-08-25T00:00:00.000Z",
              semanticSlot: "future",
              safeSummary: "future",
            }]
          : [],
      }),
      createGenerationId: sequence("g"),
    });
    const first = await materializer.refresh(scope);
    expect(first.snapshot.coverage.state).toBe("degraded");
    requiredUnknown = false;

    const recovered = await materializer.refresh(scope);
    expect(recovered).toMatchObject({
      kind: "reset",
      reason: "source_set_changed",
      snapshot: { cursor: 0, coverage: { state: "complete" } },
    });
    expect(recovered.snapshot.generation).not.toBe(first.snapshot.generation);
  });

  it("resets replay outside an evicted ambient ring", async () => {
    let turn = 0;
    const materializer = createConversationDisclosureMaterializer({
      load: async () => {
        turn += 1;
        return {
          scope,
          kernel: [{
            authorityRef: "kernel_1",
            runId: "run_1",
            status: "running",
            occurredAt: `2026-08-25T00:00:0${turn}.000Z`,
            turn,
          }],
        };
      },
      createGenerationId: sequence("g"),
      now: sequenceNumber(),
      maxRingEntries: 2,
      maxRingBytes: 1024 * 1024,
    });
    const initial = await materializer.refresh(scope);
    await materializer.refresh(scope);
    await materializer.refresh(scope);
    await materializer.refresh(scope);

    await expect(materializer.replay(scope, {
      generation: initial.snapshot.generation,
      cursor: 0,
    })).resolves.toMatchObject({
      kind: "reset",
      reason: "replay_ring_miss",
    });
  });

  it("publishes an append-only observation without rotating generation", async () => {
    let observations = [{
      authorityRef: "kernel_1",
      runId: "run_1",
      status: "running" as const,
      occurredAt: "2026-08-25T00:00:00.000Z",
      turn: 1,
    }];
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({ scope, kernel: observations }),
      createGenerationId: sequence("g"),
    });
    const initial = await materializer.refresh(scope);
    observations = [...observations, {
      authorityRef: "kernel_2",
      runId: "run_2",
      status: "running",
      occurredAt: "2026-08-25T00:00:01.000Z",
      turn: 1,
    }];

    const result = await materializer.refresh(scope);

    expect(result).toMatchObject({
      kind: "delta",
      snapshot: {
        generation: initial.snapshot.generation,
        cursor: 1,
      },
    });
    await expect(materializer.replay(scope, {
      generation: initial.snapshot.generation,
      cursor: 0,
    })).resolves.toMatchObject({
      kind: "deltas",
      deltas: [{ fromCursor: 0, toCursor: 1 }],
    });
  });

  it("rotates instead of evicting a protected terminal delta", async () => {
    let run = makeRun("running");
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({ scope, agentRuns: [run] }),
      createGenerationId: sequence("g"),
      maxRingBytes: 1,
    });
    const initial = await materializer.refresh(scope);
    run = makeRun("succeeded");

    const result = await materializer.refresh(scope);
    expect(result).toMatchObject({
      kind: "reset",
      reason: "protected_replay_pressure",
      snapshot: { cursor: 0 },
    });
    expect(result.snapshot.generation).not.toBe(initial.snapshot.generation);
    await expect(materializer.refresh(scope)).resolves.toMatchObject({
      kind: "duplicate",
      snapshot: { generation: result.snapshot.generation },
    });
  });

  it("protects a source-cut degradation even when aggregate coverage is unchanged", async () => {
    let trajectoryStatus: "complete" | "partial" = "complete";
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({
        scope,
        trajectory: [{
          runId: "run_1",
          events: createConversationSourcePage({
            source: "trajectory",
            sourceId: "run_1",
            queryHash: "query:trajectory",
            sourceRevision: "cut:1",
            status: trajectoryStatus,
            ...(trajectoryStatus === "partial"
              ? { reasonCode: "corrupt_record" }
              : {}),
            records: [],
          }),
        }],
        unknownFacts: [{
          schemaVersion: 2,
          originalKind: "future_optional",
          authorityRef: "future_1",
          scope,
          domainStatus: "future",
          requiredness: "optional",
          durability: "durable",
          sensitivity: "technical",
          occurredAt: "2026-08-25T00:00:00.000Z",
          semanticSlot: "future",
          safeSummary: "future",
        }],
      }),
      createGenerationId: sequence("g"),
      maxRingBytes: 1,
    });
    const initial = await materializer.refresh(scope);
    expect(initial.snapshot.coverage.state).toBe("partial");
    trajectoryStatus = "partial";

    const result = await materializer.refresh(scope);

    expect(result).toMatchObject({
      kind: "reset",
      reason: "protected_replay_pressure",
      snapshot: { cursor: 0, coverage: { state: "partial" } },
    });
    expect(result.snapshot.generation).not.toBe(initial.snapshot.generation);
  });

  it("protects a terminal evidence delta from ring eviction", async () => {
    let status: "running" | "succeeded" = "running";
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({
        scope,
        kernel: [{
          authorityRef: "kernel_1",
          runId: "run_1",
          status,
          occurredAt: status === "running"
            ? "2026-08-25T00:00:00.000Z"
            : "2026-08-25T00:00:01.000Z",
        }],
      }),
      createGenerationId: sequence("g"),
      maxRingBytes: 1,
    });
    await materializer.refresh(scope);
    status = "succeeded";

    await expect(materializer.refresh(scope)).resolves.toMatchObject({
      kind: "reset",
      reason: "protected_replay_pressure",
      snapshot: { cursor: 0 },
    });
  });

  it("protects a prior terminal item when a source regresses to running", async () => {
    let run = makeRun("succeeded");
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({ scope, agentRuns: [run] }),
      createGenerationId: sequence("g"),
      maxRingBytes: 1,
    });
    await materializer.refresh(scope);
    run = makeRun("running");

    const result = await materializer.refresh(scope);
    expect(result).toMatchObject({
      kind: "reset",
      reason: "protected_replay_pressure",
      snapshot: {
        cursor: 0,
        coverage: {
          state: "partial",
          reasonCodes: expect.arrayContaining([
            "terminal_regression_preserved",
          ]),
        },
        items: [expect.objectContaining({ lifecycle: "succeeded" })],
      },
    });
  });

  it("rotates generation when a terminal source disappears", async () => {
    let runs = [makeRun("succeeded")];
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({ scope, agentRuns: runs }),
      createGenerationId: sequence("g"),
    });
    const initial = await materializer.refresh(scope);
    runs = [];

    const result = await materializer.refresh(scope);

    expect(result).toMatchObject({
      kind: "reset",
      reason: "source_set_changed",
      snapshot: {
        cursor: 0,
        items: [expect.objectContaining({ lifecycle: "succeeded" })],
      },
    });
    expect(result.snapshot.generation).not.toBe(initial.snapshot.generation);
    await expect(materializer.refresh(scope)).resolves.toMatchObject({
      kind: "duplicate",
      snapshot: { generation: result.snapshot.generation },
    });
  });

  it.each([
    {
      name: "revision",
      executionRevision: 1,
      finishedAt: "2026-08-25T00:00:03.000Z",
    },
    {
      name: "timestamp",
      executionRevision: 3,
      finishedAt: "2026-08-25T00:00:01.000Z",
    },
  ])("rejects an older $name of the same terminal lifecycle", async ({
    executionRevision,
    finishedAt,
  }) => {
    let run: AgentRunRecord = {
      ...makeRun("succeeded"),
      executionRevision: 2,
      finishedAt: "2026-08-25T00:00:02.000Z",
    };
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({ scope, agentRuns: [run] }),
      createGenerationId: sequence("g"),
    });
    await materializer.refresh(scope);
    run = {
      ...makeRun("succeeded"),
      executionRevision,
      finishedAt,
    };

    const result = await materializer.refresh(scope);

    expect(result.snapshot).toMatchObject({
      coverage: {
        state: "partial",
        reasonCodes: expect.arrayContaining(["terminal_regression_preserved"]),
      },
      items: [{
        lifecycle: "succeeded",
        occurredAt: "2026-08-25T00:00:02.000Z",
        primarySource: { domainRevision: "2" },
      }],
    });
  });

  it("rejects a changed terminal body at the same revision and newer time", async () => {
    let run: AgentRunRecord = {
      ...makeRun("failed"),
      executionRevision: 2,
      failureClass: "tool_error" as const,
      finishedAt: "2026-08-25T00:00:02.000Z",
    };
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({ scope, agentRuns: [run] }),
      createGenerationId: sequence("g"),
    });
    await materializer.refresh(scope);
    run = {
      ...run,
      failureClass: "model_error",
      finishedAt: "2026-08-25T00:00:03.000Z",
    };

    const result = await materializer.refresh(scope);

    expect(result.snapshot).toMatchObject({
      coverage: {
        state: "partial",
        reasonCodes: expect.arrayContaining(["terminal_regression_preserved"]),
      },
      items: [{
        summary: "Agent run failed (tool_error)",
        occurredAt: "2026-08-25T00:00:02.000Z",
        primarySource: { domainRevision: "2" },
      }],
    });
  });

  it("retains an incompatible cut for a same-revision terminal conflict", async () => {
    const original: AgentRunRecord = {
      ...makeRun("failed"),
      executionRevision: 2,
      failureClass: "tool_error",
      finishedAt: "2026-08-25T00:00:02.000Z",
    };
    let runs = [original];
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({
        scope,
        causalRecords: [makeRequiredRunRecord()],
        agentRuns: runs,
      }),
      createGenerationId: sequence("g"),
    });
    const initial = await materializer.refresh(scope);
    runs = [
      original,
      {
        ...original,
        failureClass: "model_error",
        finishedAt: "2026-08-25T00:00:03.000Z",
      },
    ];

    const result = await materializer.refresh(scope);

    expect(result).toMatchObject({
      kind: "reset",
      snapshot: {
        cursor: 0,
        coverage: { state: "degraded" },
        items: [{
          summary: "Agent run failed (tool_error)",
          primarySource: { domainRevision: "2" },
        }],
      },
    });
    expect(result.snapshot.generation).not.toBe(initial.snapshot.generation);
    expect(result.snapshot.sourceCuts).toContainEqual(expect.objectContaining({
      source: "agent_run",
      sourceIdentity: "record:run_1",
      status: "incompatible",
      reasonCode: "source_cut_changed",
    }));
  });

  it("protects completed-unverified Goal truth from a running regression", async () => {
    let goal = makeGoal("completed_unverified", 2);
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({ scope, goals: [goal] }),
      createGenerationId: sequence("g"),
    });
    await materializer.refresh(scope);
    goal = makeGoal("executing", 3);

    const result = await materializer.refresh(scope);

    expect(result.snapshot).toMatchObject({
      coverage: {
        state: "partial",
        reasonCodes: expect.arrayContaining(["terminal_regression_preserved"]),
      },
      items: [{
        lifecycle: "completed_unverified",
        primarySource: { domainRevision: "2" },
      }],
    });
  });

  it("allows completed-unverified Plan truth to advance to verified success", async () => {
    let plan = makePlan("steps_completed", 2);
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({ scope, plans: [plan] }),
      createGenerationId: sequence("g"),
    });
    await materializer.refresh(scope);
    plan = makePlan("completed", 3);

    const result = await materializer.refresh(scope);

    expect(result).toMatchObject({
      kind: "delta",
      snapshot: {
        coverage: { state: "complete" },
        items: [{
          lifecycle: "succeeded",
          primarySource: { domainRevision: "3" },
        }],
      },
    });
  });

  it("retains stricter new requiredness while preserving terminal truth", async () => {
    let run = makeRun("succeeded");
    let causalRecords: ConversationCausalRecord[] = [];
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({ scope, agentRuns: [run], causalRecords }),
      createGenerationId: sequence("g"),
    });
    await materializer.refresh(scope);
    run = makeRun("running");
    causalRecords = [makeRequiredRunRecord()];

    const result = await materializer.refresh(scope);
    const runCut = result.snapshot.sourceCuts.find(
      (cut) => cut.source === "agent_run"
        && cut.sourceIdentity === "record:run_1",
    );

    expect(result.snapshot.items[0]?.lifecycle).toBe("succeeded");
    expect(result.snapshot.coverage.state).toBe("degraded");
    expect(runCut).toEqual({
      source: "agent_run",
      sourceIdentity: "record:run_1",
      requiredness: "required",
      status: "unavailable",
      reasonCode: "terminal_regression_preserved",
    });
  });

  it("registers listener and snapshot under one serialized barrier", async () => {
    let run = makeRun("running");
    const observed: string[] = [];
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({ scope, agentRuns: [run] }),
      createGenerationId: sequence("g"),
    });
    const connection = await materializer.connect(scope, (publication) => {
      if (publication.kind !== "delta") return;
      observed.push(publication.delta.deltaId);
      publication.delta.upserts.length = 0;
    });
    run = makeRun("succeeded");
    const result = await materializer.refresh(scope);

    expect(connection.snapshot.cursor).toBe(0);
    expect(observed).toEqual([
      result.kind === "delta" ? result.delta.deltaId : "unexpected",
    ]);
    expect(result.snapshot.items).toHaveLength(1);
    connection.close();
  });

  it("keeps duplicate callback connections independently closable", async () => {
    let run = makeRun("running");
    const observed: string[] = [];
    const listener = (
      publication: { kind: string },
    ) => observed.push(publication.kind);
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({ scope, agentRuns: [run] }),
      createGenerationId: sequence("g"),
    });
    const first = await materializer.connect(scope, listener);
    const second = await materializer.connect(scope, listener);
    first.close();
    run = makeRun("succeeded");

    await materializer.refresh(scope);

    expect(observed).toEqual(["delta"]);
    second.close();
  });

  it("rotates and notifies subscribers when durable attempt state changes", async () => {
    let attemptState: ConversationCausalAttemptState = "active";
    const observed: Array<{ kind: string; reason?: string }> = [];
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({
        scope,
        causalRecords: [makeCausalRecord(attemptState)],
      }),
      createGenerationId: sequence("g"),
    });
    const connection = await materializer.connect(scope, (publication) => {
      observed.push({
        kind: publication.kind,
        ...(publication.kind === "reset"
          ? { reason: publication.reason }
          : {}),
      });
    });
    expect(connection.snapshot.activeAttempts).toHaveLength(1);
    attemptState = "reset";

    const result = await materializer.refresh(scope);

    expect(result).toMatchObject({
      kind: "reset",
      reason: "attempt_state_changed",
      snapshot: {
        cursor: 0,
        activeAttempts: [],
        attemptSettlements: [{ outcome: "reset" }],
      },
    });
    expect(result.snapshot.generation)
      .not.toBe(connection.snapshot.generation);
    expect(observed).toEqual([{
      kind: "reset",
      reason: "attempt_state_changed",
    }]);
  });

  it("removes a connected listener when its signal aborts", async () => {
    let run = makeRun("running");
    const controller = new AbortController();
    const observed: string[] = [];
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({ scope, agentRuns: [run] }),
      createGenerationId: sequence("g"),
    });
    await materializer.connect(scope, (publication) => {
      observed.push(publication.kind);
    }, controller.signal);
    controller.abort();
    run = makeRun("succeeded");

    await materializer.refresh(scope);

    expect(observed).toEqual([]);
  });

  it("serves complete contributor pages from server-owned materialization state", async () => {
    const events: AgentTrajectoryEvent[] = Array.from(
      { length: 25 },
      (_, index) => ({
        id: `event_${index}`,
        runId: "run_1",
        sequence: index + 1,
        type: "tool_call",
        payload: { toolCallId: "call_1" },
        redaction: {
          containsApiKey: false,
          containsFileContent: false,
          containsUserText: false,
        },
        createdAt: "2026-08-25T00:00:00.000Z",
      }),
    );
    const invocation: ToolInvocationRecord = {
      id: "invocation_1",
      runId: "run_1",
      toolCallId: "call_1",
      toolName: "read_file",
      source: "native",
      args: {},
      status: "completed",
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:01.000Z",
      history: [],
    };
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({
        scope,
        trajectory: [{
          runId: "run_1",
          events: createConversationSourcePage({
            source: "trajectory",
            sourceId: "run_1",
            queryHash: "query:trajectory",
            sourceRevision: "cut:trajectory",
            status: "complete",
            records: events,
          }),
        }],
        agentRuns: [makeRun("running")],
        toolInvocations: [invocation],
      }),
      createGenerationId: sequence("g"),
    });
    const snapshot = await materializer.snapshot(scope);
    const item = snapshot.items.find(
      (candidate) => candidate.primarySource.kind === "tool_invocation",
    )!;

    const first = await materializer.contributorPage(
      scope,
      item.id,
      { expectedGeneration: snapshot.generation, limit: 10 },
    );
    const second = await materializer.contributorPage(
      scope,
      item.id,
      {
        expectedGeneration: snapshot.generation,
        position: first?.kind === "page" ? first.nextPosition : undefined,
        limit: 10,
      },
    );

    expect(first).toMatchObject({
      kind: "page",
      total: 25,
      complete: false,
      nextPosition: 10,
    });
    expect(first?.kind === "page" ? first.refs : []).toHaveLength(10);
    expect(second?.kind === "page" ? second.refs : []).toHaveLength(10);
    expect(second?.kind === "page" ? second.authorityRevision : null)
      .toBe(first?.kind === "page" ? first.authorityRevision : null);
    if (first?.kind === "page") first.refs.length = 0;
    const cloned = await materializer.contributorPage(
      scope,
      item.id,
      { expectedGeneration: snapshot.generation, limit: 10 },
    );
    expect(cloned?.kind === "page" ? cloned.refs : []).toHaveLength(10);
    const continuation = await materializer.contributorPage(
      scope,
      item.id,
      {
        expectedGeneration: snapshot.generation,
        afterInline: true,
        limit: 100,
      },
    );
    const completeRefs = [
      ...item.contributors,
      ...(continuation?.kind === "page" ? continuation.refs : []),
    ];
    expect(continuation).toMatchObject({
      kind: "page",
      total: 9,
      complete: true,
    });
    expect(new Set(completeRefs.map((ref) => ref.ref)).size).toBe(25);
    await expect(materializer.contributorPage(
      scope,
      item.id,
      { expectedGeneration: "stale-generation", limit: 10 },
    )).resolves.toEqual({ kind: "incompatible" });
  });

  it("does not claim a complete contributor set from a partial source page", async () => {
    const invocation: ToolInvocationRecord = {
      id: "invocation_partial",
      runId: "run_1",
      toolCallId: "call_partial",
      toolName: "read_file",
      source: "native",
      args: {},
      status: "completed",
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:01.000Z",
      history: [],
    };
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({
        scope,
        trajectory: [{
          runId: "run_1",
          events: createConversationSourcePage({
            source: "trajectory",
            sourceId: "run_1",
            queryHash: "query:partial-contributors",
            sourceRevision: "cut:partial-contributors",
            status: "partial",
            reasonCode: "source_page_incomplete",
            records: [{
              id: "event_partial",
              runId: "run_1",
              sequence: 1,
              type: "tool_call",
              payload: { toolCallId: "call_partial" },
              redaction: {
                containsApiKey: false,
                containsFileContent: false,
                containsUserText: false,
              },
              createdAt: "2026-08-25T00:00:00.000Z",
            }],
          }),
        }],
        agentRuns: [makeRun("running")],
        toolInvocations: [invocation],
      }),
      createGenerationId: sequence("g"),
    });

    const snapshot = await materializer.snapshot(scope);
    const item = snapshot.items.find(
      (candidate) => candidate.primarySource.ref === invocation.id,
    )!;
    const page = await materializer.contributorPage(
      scope,
      item.id,
      { expectedGeneration: snapshot.generation, limit: 100 },
    );

    expect(item.contributorsComplete).toBe(false);
    expect(page).toMatchObject({
      kind: "page",
      refs: [expect.objectContaining({ ref: "event_partial" })],
      total: 1,
      complete: false,
    });
    expect(page).not.toHaveProperty("nextPosition");
  });

  it("unions known terminal contributors when their source page becomes partial", async () => {
    const makeEvent = (id: string, sequence: number): AgentTrajectoryEvent => ({
      id,
      runId: "run_1",
      sequence,
      type: "tool_result",
      payload: { toolCallId: "call_1" },
      redaction: {
        containsApiKey: false,
        containsFileContent: false,
        containsUserText: false,
      },
      createdAt: `2026-08-25T00:00:0${sequence}.000Z`,
    });
    let events = [
      makeEvent("event_terminal_1", 1),
      makeEvent("event_terminal_2", 2),
    ];
    const invocation: ToolInvocationRecord = {
      id: "invocation_terminal",
      runId: "run_1",
      toolCallId: "call_1",
      toolName: "read_file",
      source: "native",
      args: {},
      status: "completed",
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:01.000Z",
      history: [],
    };
    let sourceStatus: "complete" | "partial" = "complete";
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({
        scope,
        causalRecords: [makeRequiredToolRecord(invocation)],
        trajectory: [{
          runId: "run_1",
          events: createConversationSourcePage({
            source: "trajectory",
            sourceId: "run_1",
            queryHash: "query:terminal-contributor",
            sourceRevision: "cut:terminal-contributor",
            status: sourceStatus,
            ...(sourceStatus === "partial"
              ? { reasonCode: "corrupt_record" }
              : {}),
            records: events,
          }),
        }],
        agentRuns: [makeRun("running")],
        toolInvocations: [invocation],
      }),
      createGenerationId: sequence("g"),
    });
    const initial = await materializer.refresh(scope);
    const initialTool = initial.snapshot.items.find(
      (item) => item.primarySource.ref === invocation.id,
    )!;
    expect(initialTool.contributorCount).toBe(2);
    sourceStatus = "partial";
    events = [
      makeEvent("event_terminal_1", 1),
      makeEvent("event_terminal_3", 3),
    ];

    const result = await materializer.refresh(scope);
    const tool = result.snapshot.items.find(
      (item) => item.primarySource.ref === invocation.id,
    )!;
    const page = await materializer.contributorPage(
      scope,
      tool.id,
      { expectedGeneration: result.snapshot.generation, limit: 10 },
    );

    expect(result.snapshot.coverage.state).not.toBe("complete");
    expect(tool.contributorCount).toBe(3);
    expect(tool.contributorSetComplete).toBe(false);
    expect(result.snapshot.sourceCuts).toContainEqual(expect.objectContaining({
      source: "tool_invocation",
      sourceIdentity: `record:${invocation.id}`,
      requiredness: "required",
      status: "complete",
    }));
    expect(result.snapshot.sourceCuts).toContainEqual(expect.objectContaining({
      source: "trajectory",
      sourceIdentity: "record:event_terminal_2",
      requiredness: "optional",
      status: "unavailable",
      reasonCode: "terminal_contributor_regression_preserved",
    }));
    expect(page?.kind === "page"
      ? page.refs.map((ref) => ref.ref).sort()
      : []).toEqual([
        "event_terminal_1",
        "event_terminal_2",
        "event_terminal_3",
      ]);
    expect(page).toMatchObject({ kind: "page", complete: false });
    await expect(materializer.refresh(scope)).resolves.toMatchObject({
      kind: "duplicate",
      snapshot: { generation: result.snapshot.generation },
    });
  });

  it("keeps a monotonic complete contributor set during primary regression", async () => {
    const makeEvent = (id: string, sequence: number): AgentTrajectoryEvent => ({
      id,
      runId: "run_1",
      sequence,
      type: "tool_result",
      payload: { toolCallId: "call_primary_regression" },
      redaction: {
        containsApiKey: false,
        containsFileContent: false,
        containsUserText: false,
      },
      createdAt: `2026-08-25T00:00:0${sequence}.000Z`,
    });
    let events = [makeEvent("event_primary_1", 1)];
    let invocation: ToolInvocationRecord = {
      id: "invocation_primary_regression",
      runId: "run_1",
      toolCallId: "call_primary_regression",
      toolName: "read_file",
      source: "native",
      args: {},
      status: "completed",
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:02.000Z",
      history: [],
    };
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({
        scope,
        trajectory: [{
          runId: "run_1",
          events: createConversationSourcePage({
            source: "trajectory",
            sourceId: "run_1",
            queryHash: "query:primary-regression-contributors",
            sourceRevision: `cut:${events.length}`,
            status: "complete",
            records: events,
          }),
        }],
        agentRuns: [makeRun("running")],
        toolInvocations: [invocation],
      }),
      createGenerationId: sequence("g"),
    });
    await materializer.refresh(scope);
    events = [
      ...events,
      makeEvent("event_primary_2", 2),
    ];
    invocation = {
      ...invocation,
      status: "running",
      updatedAt: "2026-08-25T00:00:03.000Z",
    };

    const result = await materializer.refresh(scope);
    const item = result.snapshot.items.find(
      (candidate) => candidate.primarySource.ref === invocation.id,
    )!;

    expect(item).toMatchObject({
      lifecycle: "succeeded",
      contributorCount: 2,
      contributorsComplete: true,
      contributorSetComplete: true,
    });
    await expect(materializer.contributorPage(
      scope,
      item.id,
      { expectedGeneration: result.snapshot.generation, limit: 10 },
    )).resolves.toMatchObject({
      kind: "page",
      total: 2,
      complete: true,
    });
  });

  it("preserves a missing contributor revision as an incomplete set", async () => {
    let event: AgentTrajectoryEvent = {
      id: "event_revision",
      runId: "run_1",
      sequence: 1,
      type: "tool_result",
      payload: { toolCallId: "call_revision" },
      redaction: {
        containsApiKey: false,
        containsFileContent: false,
        containsUserText: false,
      },
      createdAt: "2026-08-25T00:00:01.000Z",
    };
    const invocation: ToolInvocationRecord = {
      id: "invocation_revision",
      runId: "run_1",
      toolCallId: "call_revision",
      toolName: "read_file",
      source: "native",
      args: {},
      status: "completed",
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:02.000Z",
      history: [],
    };
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({
        scope,
        trajectory: [{
          runId: "run_1",
          events: createConversationSourcePage({
            source: "trajectory",
            sourceId: "run_1",
            queryHash: "query:contributor-revision",
            sourceRevision: `cut:${event.sequence}`,
            status: "complete",
            records: [event],
          }),
        }],
        agentRuns: [makeRun("running")],
        toolInvocations: [invocation],
      }),
      createGenerationId: sequence("g"),
    });
    await materializer.refresh(scope);
    event = {
      ...event,
      sequence: 2,
      createdAt: "2026-08-25T00:00:02.000Z",
    };

    const result = await materializer.refresh(scope);
    const item = result.snapshot.items.find(
      (candidate) => candidate.primarySource.ref === invocation.id,
    )!;

    expect(item).toMatchObject({
      contributorCount: 2,
      contributorsComplete: false,
      contributorSetComplete: false,
    });
    expect(result.snapshot.sourceCuts).toContainEqual(expect.objectContaining({
      source: "trajectory",
      sourceIdentity: "record:event_revision",
      status: "unavailable",
      reasonCode: "terminal_contributor_regression_preserved",
    }));
  });

  it("preserves an incompatible cut during contributor regression", async () => {
    const baseEvent: AgentTrajectoryEvent = {
      id: "event_contributor_conflict",
      runId: "run_1",
      sequence: 1,
      type: "tool_result",
      payload: { toolCallId: "call_contributor_conflict" },
      redaction: {
        containsApiKey: false,
        containsFileContent: false,
        containsUserText: false,
      },
      createdAt: "2026-08-25T00:00:01.000Z",
    };
    let events = [baseEvent];
    const invocation: ToolInvocationRecord = {
      id: "invocation_contributor_conflict",
      runId: "run_1",
      toolCallId: "call_contributor_conflict",
      toolName: "read_file",
      source: "native",
      args: {},
      status: "completed",
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:03.000Z",
      history: [],
    };
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({
        scope,
        agentRuns: [makeRun("running")],
        trajectory: [{
          runId: "run_1",
          events: createConversationSourcePage({
            source: "trajectory",
            sourceId: "run_1",
            queryHash: "query:contributor-conflict",
            sourceRevision: `cut:${events.length}`,
            status: "complete",
            records: events,
          }),
        }],
        toolInvocations: [invocation],
      }),
      createGenerationId: sequence("g"),
    });
    await materializer.refresh(scope);
    events = [
      { ...baseEvent, sequence: 2, type: "tool_call" },
      { ...baseEvent, sequence: 2, type: "tool_result" },
    ];

    const result = await materializer.refresh(scope);
    const item = result.snapshot.items.find(
      (candidate) => candidate.primarySource.ref === invocation.id,
    )!;

    expect(item.contributorSetComplete).toBe(false);
    expect(result.snapshot.sourceCuts).toContainEqual(expect.objectContaining({
      source: "trajectory",
      sourceIdentity: "record:event_contributor_conflict",
      status: "incompatible",
      reasonCode: "source_cut_changed",
    }));
  });

  it("retains contributor sets from every conflicting source seed", async () => {
    const workspaceRun = {
      workspaceRunId: "workspace_conflict",
      sessionId: "session_1",
      requestId: "request_1",
      status: "succeeded" as const,
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:02.000Z",
    };
    const event = {
      id: "workspace_event_conflict",
      workspaceRunId: workspaceRun.workspaceRunId,
      sessionId: workspaceRun.sessionId,
      requestId: workspaceRun.requestId,
      seq: 1,
      type: "status" as const,
      status: "succeeded" as const,
      lifecycleStatus: "succeeded" as const,
      createdAt: "2026-08-25T00:00:01.000Z",
    };
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({
        scope,
        workspaceRuns: [
          {
            run: {
              ...workspaceRun,
              status: "running",
              updatedAt: "2026-08-25T00:00:00.000Z",
            },
            events: createConversationSourcePage({
              source: "workspace_run",
              sourceId: workspaceRun.workspaceRunId,
              queryHash: "query:workspace-conflict",
              sourceRevision: "cut:workspace-conflict",
              status: "complete",
              records: [{
                ...event,
                status: "running",
                lifecycleStatus: "running",
                createdAt: "2026-08-25T00:00:00.000Z",
              }],
            }),
          },
          {
            run: workspaceRun,
            events: createConversationSourcePage({
              source: "workspace_run",
              sourceId: workspaceRun.workspaceRunId,
              queryHash: "query:workspace-conflict",
              sourceRevision: "cut:workspace-conflict",
              status: "complete",
              records: [event],
            }),
          },
          {
            run: {
              ...workspaceRun,
              status: "failed",
              updatedAt: "2026-08-25T00:00:03.000Z",
            },
            events: createConversationSourcePage({
              source: "workspace_run",
              sourceId: workspaceRun.workspaceRunId,
              queryHash: "query:workspace-conflict",
              sourceRevision: "cut:workspace-conflict",
              status: "complete",
              records: [{
                ...event,
                status: "failed",
                lifecycleStatus: "failed",
              }],
            }),
          },
        ],
      }),
      createGenerationId: sequence("g"),
    });

    const snapshot = await materializer.snapshot(scope);
    const item = snapshot.items.find(
      (candidate) => candidate.primarySource.ref === event.id,
    )!;
    const page = await materializer.contributorPage(
      scope,
      item.id,
      { expectedGeneration: snapshot.generation, limit: 100 },
    );

    expect(item).toMatchObject({
      lifecycle: "failed",
      contributorCount: 3,
      contributorsComplete: true,
    });
    expect(page).toMatchObject({
      kind: "page",
      total: 3,
      complete: true,
    });
    expect(page?.kind === "page"
      ? page.refs.map((ref) => ref.domainStatus).sort()
      : []).toEqual(["failed", "running", "succeeded"]);
  });

  it("serializes concurrent refreshes per canonical scope", async () => {
    let active = 0;
    let maxActive = 0;
    const materializer = createConversationDisclosureMaterializer({
      load: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return { scope, agentRuns: [makeRun("running")] };
      },
      createGenerationId: sequence("g"),
    });

    await Promise.all([
      materializer.refresh(scope),
      materializer.refresh(scope),
      materializer.snapshot(scope),
    ]);
    expect(maxActive).toBe(1);
  });

  it("deep-clones snapshots and rejects use after close", async () => {
    const controller = new AbortController();
    const materializer = createConversationDisclosureMaterializer({
      load: async () => ({ scope, agentRuns: [makeRun("running")] }),
      createGenerationId: sequence("g"),
    });
    const removeListener = vi.spyOn(
      controller.signal,
      "removeEventListener",
    );
    await materializer.connect(scope, () => undefined, controller.signal);
    const first = await materializer.snapshot(scope);
    first.items[0]!.summary = "mutated";
    expect((await materializer.snapshot(scope)).items[0]!.summary)
      .toBe("Agent run running");

    await materializer.close();
    expect(removeListener).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
    );
    await expect(materializer.snapshot(scope)).rejects.toThrow(
      "materializer is closed",
    );
  });
});

function makeRun(status: AgentRunRecord["status"]): AgentRunRecord {
  return {
    id: "run_1",
    taskId: "task_1",
    taskName: "task",
    skillName: "skill",
    status,
    summary: "",
    events: [],
    executionRevision: 1,
    startedAt: "2026-08-25T00:00:00.000Z",
    finishedAt: status === "running"
      ? ""
      : "2026-08-25T00:00:01.000Z",
  };
}

function makeGoal(
  status: Goal["status"],
  planVersion: number,
): Goal {
  return {
    id: "goal_1",
    chatSessionId: "session_1",
    description: "goal",
    successCriteria: [],
    milestones: [],
    status,
    executionUsage: {
      iterations: 0,
      toolCalls: 0,
      wallClockMs: 0,
      tokens: 0,
      replans: 0,
    },
    reviewPolicy: "review_final_only",
    planVersion,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: `2026-08-25T00:00:0${planVersion}.000Z`,
  };
}

function makePlan(
  status: PlanRecord["status"],
  revision: number,
): PlanRecord {
  return {
    id: "plan_1",
    sessionId: "session_1",
    sourceMessage: "plan",
    mode: "direct",
    status,
    actionGate: "ready",
    revision,
    taskContract: {} as PlanRecord["taskContract"],
    evidence: [],
    requestedModelAssignments: {},
    frozenModelAssignments: {} as PlanRecord["frozenModelAssignments"],
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: `2026-08-25T00:00:0${revision}.000Z`,
    rounds: [],
  };
}

function makeRequiredRunRecord(): ConversationCausalRecord {
  return {
    schemaVersion: 1,
    requestId: "request_required_run",
    turnId: "turn_required_run",
    sessionId: "session_1",
    inputFingerprint: "fingerprint",
    revision: 1,
    attempts: [],
    refs: [{ kind: "agent_run", id: "run_1" }],
    coverage: { state: "complete", reasonCodes: [] },
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:01.000Z",
  };
}

function makeRequiredToolRecord(
  invocation: ToolInvocationRecord,
): ConversationCausalRecord {
  return {
    schemaVersion: 1,
    requestId: "request_required_tool",
    turnId: "turn_required_tool",
    sessionId: "session_1",
    inputFingerprint: "fingerprint",
    revision: 1,
    attempts: [],
    refs: [{
      kind: "tool_invocation",
      runId: invocation.runId,
      id: invocation.id,
    }],
    coverage: { state: "complete", reasonCodes: [] },
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:01.000Z",
  };
}

function makeCausalRecord(
  state: ConversationCausalAttemptState,
): ConversationCausalRecord {
  return {
    schemaVersion: 1,
    requestId: "request_1",
    turnId: "turn_1",
    sessionId: "session_1",
    userMessageId: "message_1",
    inputFingerprint: "fingerprint",
    revision: 1,
    attempts: [{
      attempt: 1,
      state,
      controlSequence: state === "active" ? 1 : 2,
      eventFingerprint: `fingerprint:${state}`,
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:01.000Z",
    }],
    refs: [],
    coverage: { state: "complete", reasonCodes: [] },
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:01.000Z",
  };
}

function sequence(prefix: string) {
  let value = 0;
  return () => `${prefix}${++value}`;
}

function sequenceNumber() {
  let value = 0;
  return () => ++value;
}
