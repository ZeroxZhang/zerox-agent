import { describe, expect, it } from "vitest";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import type { Goal } from "../shared/agentGoal";
import type {
  ConversationCausalRecord,
  ConversationRequiredSettlement,
  ToolApprovalIntent,
} from "../shared/conversationCausalSpine";
import {
  createConversationDisclosureScope,
  projectConversationDisclosureSnapshot,
} from "../shared/conversationDisclosure";
import {
  createConversationSourcePage,
} from "../shared/conversationEvidence";
import type { PlanRecord } from "../shared/planMode";
import type { ToolInvocationRecord } from "../shared/toolInvocationLedger";
import type { WorkspaceRun } from "../shared/workspaceRunLedger";
import {
  adaptConversationDisclosureSources,
  createRequiredChatEventFingerprint,
} from "./conversationDisclosureAdapters";

const scope = createConversationDisclosureScope({
  surface: "chat",
  sessionId: "session_1",
  queryHash: "query:all",
});

describe("conversation disclosure domain adapters", () => {
  it("preserves owning Goal, Plan, AgentRun, and Workspace lifecycle truth", () => {
    const goal = makeGoal();
    const plan = makePlan();
    const run = makeRun({ status: "failed", failureClass: "tool_error" });
    const workspaceRun = makeWorkspaceRun("paused");
    const batch = adaptConversationDisclosureSources({
      scope,
      goals: [goal],
      plans: [plan],
      scheduledRuns: [{
        taskId: run.taskId,
        runId: run.id,
        status: run.status,
        occurredAt: run.finishedAt || run.startedAt,
      }],
      agentRuns: [run],
      workspaceRuns: [{ run: workspaceRun }],
    });
    const snapshot = projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:1",
      expectedSourceCuts: batch.sourceCuts,
      seeds: batch.seeds,
      unknownFacts: batch.unknownFacts,
    });

    expect(itemFor(snapshot, "goal", goal.id)?.lifecycle)
      .toBe("waiting_for_acceptance");
    expect(itemFor(snapshot, "plan", plan.id)?.lifecycle).toBe("blocked");
    expect(itemFor(snapshot, "scheduled_run", run.id)?.lifecycle)
      .toBe("failed");
    expect(itemFor(snapshot, "agent_run", run.id)?.lifecycle).toBe("failed");
    expect(itemFor(
      snapshot,
      "workspace_run",
      workspaceRun.workspaceRunId,
    )?.lifecycle).toBe("paused");
  });

  it("uses the exact AgentRun owner for trajectory lifecycle", () => {
    const run = makeRun({ id: "run_1", status: "canceled" });
    const trajectory = makeTrajectory("run_1", "event_1", 1, {
      toolCallId: "call_1",
    });
    const batch = adaptConversationDisclosureSources({
      scope,
      agentRuns: [run],
      trajectory: [{
        runId: run.id,
        owner: run,
        events: trajectoryPage(run.id, [trajectory]),
      }],
      kernel: [{
        authorityRef: "kernel_1",
        runId: run.id,
        status: "succeeded",
        occurredAt: "2026-08-25T00:00:03.000Z",
      }],
    });
    const trajectoryFact = batch.seeds.find(
      (seed) => seed.primary.authorityRef === trajectory.id,
    )!.primary;
    const kernelFact = batch.seeds.find(
      (seed) => seed.primary.authorityRef === "kernel_1",
    )!.primary;

    expect(trajectoryFact.payload).toMatchObject({
      owningStatus: { kind: "run", status: "canceled" },
    });
    expect(kernelFact.durability).toBe("ephemeral");
  });

  it("rejects a trajectory owner that contradicts the AgentRun store", () => {
    const run = makeRun({ id: "run_1", status: "failed" });
    const event = makeTrajectory("run_1", "event_owner_conflict", 1, {
      toolCallId: "call_owner_conflict",
    });
    const batch = adaptConversationDisclosureSources({
      scope,
      agentRuns: [run],
      trajectory: [{
        runId: run.id,
        owner: { id: run.id, status: "succeeded" },
        events: trajectoryPage(run.id, [event]),
      }],
    });

    expect(batch.seeds.find(
      (seed) => seed.primary.authorityRef === event.id,
    )).toBeUndefined();
    expect(batch.sourceCuts).toContainEqual(expect.objectContaining({
      source: "trajectory",
      sourceIdentity: run.id,
      status: "incompatible",
      reasonCode: "source_identity_conflict",
    }));
  });

  it("rejects Trajectory events whose page owner differs from the read owner", () => {
    const event = makeTrajectory("run_other", "event_wrong_owner", 1, {
      toolCallId: "call_wrong_owner",
    });
    const batch = adaptConversationDisclosureSources({
      scope,
      trajectory: [{
        runId: "run_1",
        events: trajectoryPage("run_other", [event]),
      }],
    });

    expect(batch.seeds.find(
      (seed) => seed.primary.authorityRef === event.id,
    )).toBeUndefined();
    expect(batch.sourceCuts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "trajectory",
        sourceIdentity: "run_other",
        status: "incompatible",
        reasonCode: "source_identity_conflict",
      }),
      expect.objectContaining({
        source: "trajectory",
        sourceIdentity: "record:event_wrong_owner",
        status: "incompatible",
        reasonCode: "source_identity_conflict",
      }),
    ]));
  });

  it("marks missing explicit Goal and Chat scope owners unavailable", () => {
    const goalScope = createConversationDisclosureScope({
      surface: "goal",
      goalId: "goal_missing",
      queryHash: "query:missing-goal",
    });
    const missingGoal = adaptConversationDisclosureSources({
      scope: goalScope,
      goals: [],
    });
    const missingChat = adaptConversationDisclosureSources({
      scope,
      chatTranscript: {
        sessionId: "session_1",
        status: "unavailable",
        reasonCode: "required_owner_missing",
      },
      chatMessages: [],
    });

    expect(missingGoal.sourceCuts).toContainEqual({
      source: "goal",
      sourceIdentity: "record:goal_missing",
      requiredness: "required",
      status: "unavailable",
      reasonCode: "required_owner_missing",
    });
    expect(missingChat.sourceCuts).toContainEqual({
      source: "chat_message",
      sourceIdentity: "session_1",
      requiredness: "required",
      status: "unavailable",
      reasonCode: "required_owner_missing",
    });
    expect(projectConversationDisclosureSnapshot({
      scope: goalScope,
      generation: "generation:missing-goal",
      expectedSourceCuts: missingGoal.sourceCuts,
      seeds: missingGoal.seeds,
    }).coverage.state).toBe("degraded");
    expect(projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:missing-chat",
      expectedSourceCuts: missingChat.sourceCuts,
      seeds: missingChat.seeds,
    }).coverage.state).toBe("degraded");

    const runScope = createConversationDisclosureScope({
      surface: "run",
      runId: "run_missing",
      queryHash: "query:missing-run",
    });
    const missingRun = adaptConversationDisclosureSources({
      scope: runScope,
      runScopeAvailable: false,
    });
    expect(missingRun.sourceCuts).toContainEqual({
      source: "agent_run",
      sourceIdentity: "record:run_missing",
      requiredness: "required",
      status: "unavailable",
      reasonCode: "required_owner_missing",
    });
  });

  it("degrades when a Goal active Plan owner is absent", () => {
    const goal = makeGoal();
    const batch = adaptConversationDisclosureSources({
      scope,
      goals: [goal],
      plans: [],
    });

    expect(batch.sourceCuts).toContainEqual({
      source: "plan",
      sourceIdentity: "record:plan_1",
      requiredness: "required",
      status: "unavailable",
      reasonCode: "required_owner_missing",
    });
    expect(projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:missing-plan",
      expectedSourceCuts: batch.sourceCuts,
      seeds: batch.seeds,
    }).coverage.state).toBe("degraded");
  });

  it("binds Goal ledger evidence as bounded optional contributors", () => {
    const goal = makeGoal();
    const batch = adaptConversationDisclosureSources({
      scope,
      goals: [goal],
      plans: [makePlan()],
      goalLedgers: [{
        goalId: goal.id,
        sourceRevision: "goal-ledger:1",
        status: "complete",
        records: [{
          at: "2026-08-25T00:00:01.000Z",
          publicationKey: "planned",
          kind: "goal_planned",
          summary: "Goal plan persisted",
        }],
      }],
    });
    const goalSeed = batch.seeds.find(
      (seed) => seed.primary.authorityRef === goal.id,
    );

    expect(goalSeed?.contributorsComplete).toBe(true);
    expect(goalSeed?.contributors).toContainEqual(expect.objectContaining({
      kind: "goal",
      authorityRef: `ledger:${goal.id}:planned`,
    }));
    expect(batch.sourceCuts).toContainEqual(expect.objectContaining({
      source: "goal",
      sourceIdentity: `ledger:${goal.id}`,
      cursor: "goal-ledger:1",
      status: "complete",
    }));
  });

  it("degrades when a causal terminal owner is missing", () => {
    const causal = makeCausalRecord({
      refs: [{ kind: "agent_run", id: "run_missing" }],
    });
    const batch = adaptConversationDisclosureSources({
      scope,
      causalRecords: [causal],
      agentRuns: [],
    });

    expect(batch.sourceCuts).toContainEqual({
      source: "agent_run",
      sourceIdentity: "record:run_missing",
      requiredness: "required",
      status: "unavailable",
      reasonCode: "required_owner_missing",
    });
    expect(batch.diagnostics).toContainEqual({
      code: "required_owner_missing",
      source: "agent_run",
      authorityRef: "run_missing",
    });
  });

  it("degrades when bounded pages omit required message, tool, or settlement witnesses", () => {
    const causal = makeCausalRecord({
      refs: [{
        kind: "tool_invocation",
        runId: "run_1",
        id: "invocation_required",
      }],
      requiredSettlements: [{
        id: "settlement_required",
        attempt: 1,
        sourceSequence: 2,
        targetState: "paused",
        requiredDomains: ["chat", "workspace"],
        workspaceRunId: "workspace_1",
        preparedWorkspaceEventId: "workspace_event_required",
        workspaceEventId: "workspace_event_required",
        preparedChatEventFingerprint: "prepared",
        state: "committed",
        chatEventFingerprint: "committed",
        createdAt: "2026-08-25T00:00:00.000Z",
        updatedAt: "2026-08-25T00:00:01.000Z",
      }],
    });
    const batch = adaptConversationDisclosureSources({
      scope,
      causalRecords: [causal],
      chatActivity: createConversationSourcePage({
        source: "chat_activity",
        sourceId: "session_1",
        queryHash: "query:chat",
        sourceRevision: "cut:chat",
        status: "complete",
        records: [{
          eventId: "chat_event_wrong_lineage",
          sequence: 1,
          legacy: false,
          event: {
            sessionId: "session_other",
            requestId: "request_other",
            turnId: "turn_other",
            sequence: 1,
            state: "paused",
            message: "wrong lineage",
            settlementId: "settlement_required",
            createdAt: "2026-08-25T00:00:01.000Z",
            elapsedMs: 1,
          },
        }],
      }),
      workspaceRuns: [{
        run: makeWorkspaceRun("paused"),
        events: createConversationSourcePage({
          source: "workspace_run",
          sourceId: "workspace_1",
          queryHash: "query:workspace",
          sourceRevision: "cut:workspace",
          status: "complete",
          records: [{
            id: "workspace_event_required",
            workspaceRunId: "workspace_1",
            sessionId: "session_1",
            requestId: "request_other",
            seq: 1,
            type: "status",
            status: "paused",
            message: "wrong lineage",
            lifecycleStatus: "paused",
            payload: {},
            createdAt: "2026-08-25T00:00:01.000Z",
          }],
        }),
      }],
    });

    expect(batch.sourceCuts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "chat_message",
        sourceIdentity: "record:message_1",
        requiredness: "required",
        status: "unavailable",
        reasonCode: "required_witness_missing",
      }),
      expect.objectContaining({
        source: "chat_activity",
        sourceIdentity: "record:settlement:settlement_required",
        requiredness: "required",
        status: "unavailable",
        reasonCode: "required_witness_missing",
      }),
      expect.objectContaining({
        source: "workspace_run",
        sourceIdentity: "record:workspace_event_required",
        requiredness: "required",
        status: "unavailable",
        reasonCode: "required_witness_missing",
      }),
      expect.objectContaining({
        source: "tool_invocation",
        sourceIdentity: "record:invocation_required",
        requiredness: "required",
        status: "unavailable",
        reasonCode: "required_witness_missing",
      }),
    ]));
    expect(batch.diagnostics.filter(
      (entry) => entry.code === "required_witness_missing",
    )).toHaveLength(4);
  });

  it("accepts only a fully bound Chat and Workspace settlement witness", () => {
    const chatEvent = {
      sessionId: "session_1",
      requestId: "request_1",
      turnId: "turn_1",
      sequence: 7,
      state: "paused" as const,
      message: "paused",
      settlementId: "settlement_exact",
      createdAt: "2026-08-25T00:00:01.000Z",
      elapsedMs: 1,
    };
    const fingerprint = createRequiredChatEventFingerprint(chatEvent);
    const settlement = makeRequiredSettlement({
      id: "settlement_exact",
      sourceSequence: 7,
      targetState: "paused",
      preparedWorkspaceEventId: "workspace_event_exact",
      workspaceEventId: "workspace_event_exact",
      preparedChatEventFingerprint: fingerprint,
      chatEventFingerprint: fingerprint,
    });
    const batch = adaptConversationDisclosureSources({
      scope,
      chatTranscript: {
        sessionId: "session_1",
        sourceRevision: "cut:transcript",
        status: "complete",
      },
      causalRecords: [makeCausalRecord({
        userMessageId: undefined,
        requiredSettlements: [settlement],
      })],
      chatActivity: createConversationSourcePage({
        source: "chat_activity",
        sourceId: "session_1",
        queryHash: "query:chat",
        sourceRevision: "cut:chat",
        status: "complete",
        records: [{
          eventId: "chat_event_exact",
          sequence: 7,
          legacy: false,
          event: chatEvent,
        }],
      }),
      workspaceRuns: [{
        run: makeWorkspaceRun("paused"),
        events: createConversationSourcePage({
          source: "workspace_run",
          sourceId: "workspace_1",
          queryHash: "query:workspace",
          sourceRevision: "cut:workspace",
          status: "complete",
          records: [{
            id: "workspace_event_exact",
            workspaceRunId: "workspace_1",
            sessionId: "session_1",
            requestId: "request_1",
            seq: 1,
            type: "status",
            status: "paused",
            lifecycleStatus: "paused",
            causalRef: {
              turnId: "turn_1",
              sourceSequence: 7,
            },
            message: "paused",
            payload: {},
            createdAt: "2026-08-25T00:00:01.000Z",
          }],
        }),
      }],
    });

    expect(batch.sourceCuts.some(
      (cut) => cut.reasonCode === "required_witness_missing",
    )).toBe(false);
    expect(batch.seeds.find(
      (seed) => seed.primary.authorityRef === "chat_event_exact",
    )?.primary.requiredness).toBe("required");
    expect(batch.seeds.find(
      (seed) => seed.primary.authorityRef === "workspace_event_exact",
    )?.primary.requiredness).toBe("required");
  });

  it("rejects wrong-role Chat and mismatched AgentRun owners for required claims", () => {
    const causal = makeCausalRecord({
      agentRunAdmissions: [{
        runId: "run_1",
        taskId: "task_expected",
        executionRevision: 2,
        state: "settled",
        finalStatus: "succeeded",
        createdAt: "2026-08-25T00:00:00.000Z",
        updatedAt: "2026-08-25T00:00:01.000Z",
      }],
    });
    const batch = adaptConversationDisclosureSources({
      scope,
      causalRecords: [causal],
      chatMessages: [{
        id: "message_1",
        role: "assistant",
        content: "wrong role",
        requestId: "request_1",
        turnId: "turn_1",
        createdAt: "2026-08-25T00:00:00.000Z",
      }],
      agentRuns: [makeRun({
        id: "run_1",
        taskId: "task_wrong",
        executionRevision: 1,
        status: "succeeded",
      })],
    });

    expect(batch.seeds.find(
      (seed) => seed.primary.kind === "chat_message",
    )?.primary.requiredness).toBe("optional");
    expect(batch.seeds.find(
      (seed) => seed.primary.kind === "agent_run",
    )?.primary.requiredness).toBe("optional");
    expect(batch.sourceCuts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "chat_message",
        sourceIdentity: "record:message_1",
        status: "unavailable",
        reasonCode: "required_witness_missing",
      }),
      expect.objectContaining({
        source: "agent_run",
        sourceIdentity: "record:run_1",
        status: "unavailable",
        reasonCode: "required_owner_missing",
      }),
    ]));
  });

  it("rejects Plan, AgentRun, and approval rows owned by another scope", () => {
    const goal = makeGoal();
    const plan = {
      ...makePlan(),
      sessionId: "session_foreign",
    };
    const run = makeRun({
      runContext: {
        sessionId: "session_foreign",
      } as AgentRunRecord["runContext"],
    });
    const approval: ToolApprovalIntent = {
      schemaVersion: 1,
      id: "approval_foreign",
      revision: 1,
      state: "pending",
      requestFingerprint: "fingerprint",
      taskId: "task_foreign",
      taskName: "Foreign task",
      toolName: "read_file",
      safeArgsSummary: {},
      risk: {
        level: "normal",
        category: "filesystem",
        requiresConfirmation: true,
      },
      causalRef: {
        sessionId: "session_foreign",
        requestId: "request_foreign",
        turnId: "turn_foreign",
      },
      ownerProcessEpoch: "process_foreign",
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
      expiresAt: "2026-08-25T01:00:00.000Z",
    };

    const batch = adaptConversationDisclosureSources({
      scope,
      goals: [goal],
      plans: [plan],
      agentRuns: [run],
      approvals: [approval],
    });

    expect(batch.seeds.some((seed) =>
      [plan.id, run.id, approval.id].includes(seed.primary.authorityRef)))
      .toBe(false);
    expect(batch.sourceCuts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "plan",
        sourceIdentity: `record:${plan.id}`,
        requiredness: "required",
        status: "incompatible",
        reasonCode: "source_identity_conflict",
      }),
      expect.objectContaining({
        source: "agent_run",
        sourceIdentity: `record:${run.id}`,
        status: "incompatible",
        reasonCode: "source_identity_conflict",
      }),
      expect.objectContaining({
        source: "approval",
        sourceIdentity: `record:${approval.id}`,
        requiredness: "required",
        status: "incompatible",
        reasonCode: "source_identity_conflict",
      }),
    ]));
  });

  it("rejects a scoped approval without an exact causal request owner", () => {
    const approval: ToolApprovalIntent = {
      schemaVersion: 1,
      id: "approval_orphan",
      revision: 1,
      state: "pending",
      requestFingerprint: "fingerprint",
      taskId: "task_orphan",
      taskName: "Orphan task",
      toolName: "read_file",
      safeArgsSummary: {},
      risk: {
        level: "normal",
        category: "filesystem",
        requiresConfirmation: true,
      },
      causalRef: {
        sessionId: scope.sessionId,
        requestId: "request_orphan",
        turnId: "turn_orphan",
      },
      ownerProcessEpoch: "process_orphan",
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
      expiresAt: "2026-08-25T01:00:00.000Z",
    };

    const batch = adaptConversationDisclosureSources({
      scope,
      causalRecords: [makeCausalRecord()],
      approvals: [approval],
    });

    expect(batch.seeds.some(
      (seed) => seed.primary.authorityRef === approval.id,
    )).toBe(false);
    expect(batch.sourceCuts).toContainEqual({
      source: "approval",
      sourceIdentity: `record:${approval.id}`,
      requiredness: "required",
      status: "incompatible",
      reasonCode: "source_identity_conflict",
    });
  });

  it("emits a required cut when a causal approval row is missing", () => {
    const batch = adaptConversationDisclosureSources({
      scope,
      causalRecords: [makeCausalRecord({
        refs: [{ kind: "approval", id: "approval_missing" }],
      })],
      approvals: [],
    });

    expect(batch.sourceCuts).toContainEqual({
      source: "approval",
      sourceIdentity: "record:approval_missing",
      requiredness: "required",
      status: "unavailable",
      reasonCode: "required_witness_missing",
    });
  });

  it("rejects foreign Workspace, Scheduled, and Tool owners at the adapter", () => {
    const run = makeRun({
      id: "run_foreign",
      runContext: {
        sessionId: "session_foreign",
      } as AgentRunRecord["runContext"],
    });
    const workspaceRun = {
      ...makeWorkspaceRun("running"),
      workspaceRunId: "workspace_foreign",
      sessionId: "session_foreign",
    };
    const invocation = {
      ...makeInvocation(),
      id: "invocation_foreign",
      runId: run.id,
    };
    const causalRecord = makeCausalRecord({
      refs: [
        { kind: "agent_run", id: run.id },
        { kind: "workspace_run", id: workspaceRun.workspaceRunId },
        {
          kind: "tool_invocation",
          runId: run.id,
          id: invocation.id,
        },
      ],
    });

    const batch = adaptConversationDisclosureSources({
      scope,
      causalRecords: [causalRecord],
      scheduledRuns: [{
        taskId: run.taskId,
        runId: run.id,
        status: run.status,
        occurredAt: run.startedAt,
      }],
      agentRuns: [run],
      workspaceRuns: [{ run: workspaceRun }],
      toolInvocations: [invocation],
    });

    expect(batch.seeds.some((seed) => [
      run.id,
      workspaceRun.workspaceRunId,
      invocation.id,
    ].includes(seed.primary.authorityRef))).toBe(false);
    expect(batch.sourceCuts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "scheduled_run",
        sourceIdentity: `record:${run.id}`,
        requiredness: "required",
        status: "incompatible",
      }),
      expect.objectContaining({
        source: "workspace_run",
        sourceIdentity: `record:${workspaceRun.workspaceRunId}`,
        requiredness: "required",
        status: "incompatible",
      }),
      expect.objectContaining({
        source: "tool_invocation",
        sourceIdentity: `record:${invocation.id}`,
        requiredness: "required",
        status: "unavailable",
        reasonCode: "required_owner_missing",
      }),
    ]));
  });

  it("does not let causal refs substitute for missing Scheduled or Tool owners", () => {
    const invocation = makeInvocation();
    const causalRecord = makeCausalRecord({
      refs: [
        { kind: "agent_run", id: invocation.runId },
        {
          kind: "tool_invocation",
          runId: invocation.runId,
          id: invocation.id,
        },
      ],
    });
    const batch = adaptConversationDisclosureSources({
      scope,
      causalRecords: [causalRecord],
      scheduledRuns: [{
        taskId: "task_1",
        runId: invocation.runId,
        status: "succeeded",
        occurredAt: "2026-08-25T00:00:02.000Z",
      }],
      toolInvocations: [invocation],
    });

    expect(batch.seeds.some((seed) =>
      seed.primary.kind === "scheduled_run"
      || seed.primary.kind === "tool_invocation")).toBe(false);
    expect(batch.sourceCuts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "scheduled_run",
        sourceIdentity: `record:${invocation.runId}`,
        requiredness: "required",
        status: "unavailable",
        reasonCode: "required_owner_missing",
      }),
      expect.objectContaining({
        source: "tool_invocation",
        sourceIdentity: `record:${invocation.id}`,
        requiredness: "required",
        status: "unavailable",
        reasonCode: "required_owner_missing",
      }),
    ]));
  });

  it("rejects conflicting required obligations for one Chat message id", () => {
    const first = makeCausalRecord();
    const second = makeCausalRecord({
      requestId: "request_2",
      turnId: "turn_2",
    });
    const batch = adaptConversationDisclosureSources({
      scope,
      causalRecords: [first, second],
      chatMessages: [{
        id: "message_1",
        role: "user",
        content: "matches only the first obligation",
        requestId: "request_1",
        turnId: "turn_1",
        createdAt: "2026-08-25T00:00:00.000Z",
      }],
    });

    expect(batch.sourceCuts).toContainEqual({
      source: "chat_message",
      sourceIdentity: "record:message_1",
      requiredness: "required",
      status: "incompatible",
      reasonCode: "required_witness_conflict",
    });
    expect(batch.diagnostics).toContainEqual({
      code: "required_witness_conflict",
      source: "chat_message",
      authorityRef: "message_1",
    });
  });

  it("rejects Chat activity records outside the requested session", () => {
    const batch = adaptConversationDisclosureSources({
      scope,
      chatActivity: createConversationSourcePage({
        source: "chat_activity",
        sourceId: "session_1",
        queryHash: "query:chat",
        sourceRevision: "cut:chat",
        status: "complete",
        records: [{
          eventId: "activity_wrong_session",
          sequence: 1,
          legacy: false,
          event: {
            sessionId: "session_other",
            requestId: "request_1",
            turnId: "turn_1",
            sequence: 1,
            state: "model",
            message: "wrong session",
            createdAt: "2026-08-25T00:00:01.000Z",
            elapsedMs: 1,
          },
        }],
      }),
    });

    expect(batch.seeds).toEqual([]);
    expect(batch.sourceCuts).toContainEqual(expect.objectContaining({
      source: "chat_activity",
      sourceIdentity: "record:activity_wrong_session",
      status: "incompatible",
      reasonCode: "source_identity_conflict",
    }));
  });

  it("rejects conflicting Chat settlement obligations independently", () => {
    const settlement = makeRequiredSettlement({
      id: "settlement_shared",
      requiredDomains: ["chat"],
    });
    const first = makeCausalRecord({
      userMessageId: undefined,
      requiredSettlements: [settlement],
    });
    const second = makeCausalRecord({
      requestId: "request_2",
      turnId: "turn_2",
      userMessageId: undefined,
      requiredSettlements: [settlement],
    });
    const activity = {
      eventId: "activity_settlement_shared",
      sequence: 1,
      legacy: false,
      event: {
        sessionId: "session_1",
        requestId: "request_1",
        turnId: "turn_1",
        sequence: 1,
        state: "paused" as const,
        message: "paused",
        settlementId: settlement.id,
        createdAt: "2026-08-25T00:00:01.000Z",
        elapsedMs: 1,
      },
    };
    const batch = adaptConversationDisclosureSources({
      scope,
      causalRecords: [first, second],
      chatActivity: createConversationSourcePage({
        source: "chat_activity",
        sourceId: "session_1",
        queryHash: "query:chat",
        sourceRevision: "cut:chat",
        status: "complete",
        records: [activity],
      }),
    });

    expect(batch.sourceCuts).toContainEqual({
      source: "chat_activity",
      sourceIdentity: "record:settlement:settlement_shared",
      requiredness: "required",
      status: "incompatible",
      reasonCode: "required_witness_conflict",
    });
    expect(batch.seeds.find(
      (seed) => seed.primary.authorityRef === activity.eventId,
    )?.primary.requiredness).toBe("optional");
  });

  it("rejects conflicting AgentRun and Workspace owner obligations", () => {
    const first = makeCausalRecord({
      userMessageId: undefined,
      refs: [{ kind: "workspace_run", id: "workspace_1" }],
      agentRunAdmissions: [{
        runId: "run_1",
        taskId: "task_1",
        executionRevision: 1,
        state: "started",
        createdAt: "2026-08-25T00:00:00.000Z",
        updatedAt: "2026-08-25T00:00:01.000Z",
      }],
    });
    const second = makeCausalRecord({
      requestId: "request_2",
      turnId: "turn_2",
      userMessageId: undefined,
      refs: [{ kind: "workspace_run", id: "workspace_1" }],
      agentRunAdmissions: [{
        runId: "run_1",
        taskId: "task_2",
        executionRevision: 1,
        state: "started",
        createdAt: "2026-08-25T00:00:00.000Z",
        updatedAt: "2026-08-25T00:00:01.000Z",
      }],
    });
    const batch = adaptConversationDisclosureSources({
      scope,
      causalRecords: [first, second],
      agentRuns: [makeRun()],
      workspaceRuns: [{ run: makeWorkspaceRun("running") }],
    });

    expect(batch.sourceCuts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "agent_run",
        sourceIdentity: "record:run_1",
        status: "incompatible",
        reasonCode: "required_witness_conflict",
      }),
      expect.objectContaining({
        source: "workspace_run",
        sourceIdentity: "record:workspace_1",
        status: "incompatible",
        reasonCode: "required_witness_conflict",
      }),
    ]));
    expect(batch.seeds.find(
      (seed) => seed.primary.kind === "agent_run",
    )?.primary.requiredness).toBe("optional");
    expect(batch.seeds.find(
      (seed) => seed.primary.authorityRef === "workspace_1",
    )?.primary.requiredness).toBe("optional");
  });

  it("rejects conflicting Tool Invocation obligations", () => {
    const toolRef = {
      kind: "tool_invocation" as const,
      runId: "run_1",
      id: "invocation_1",
    };
    const first = makeCausalRecord({
      userMessageId: undefined,
      refs: [toolRef],
    });
    const second = makeCausalRecord({
      requestId: "request_2",
      turnId: "turn_2",
      userMessageId: undefined,
      refs: [toolRef],
    });
    const batch = adaptConversationDisclosureSources({
      scope,
      causalRecords: [first, second],
      agentRuns: [makeRun()],
      toolInvocations: [makeInvocation()],
    });

    expect(batch.sourceCuts).toContainEqual({
      source: "tool_invocation",
      sourceIdentity: "record:invocation_1",
      requiredness: "required",
      status: "incompatible",
      reasonCode: "required_witness_conflict",
    });
    expect(batch.seeds.find(
      (seed) => seed.primary.kind === "tool_invocation",
    )?.primary.requiredness).toBe("optional");
  });

  it("rejects conflicting Workspace settlement obligations independently", () => {
    const settlement = makeRequiredSettlement({
      id: "settlement_workspace_shared",
      requiredDomains: ["workspace"],
      workspaceEventId: "workspace_event_shared",
      preparedWorkspaceEventId: "workspace_event_shared",
    });
    const first = makeCausalRecord({
      userMessageId: undefined,
      requiredSettlements: [settlement],
    });
    const second = makeCausalRecord({
      requestId: "request_2",
      turnId: "turn_2",
      userMessageId: undefined,
      requiredSettlements: [settlement],
    });
    const batch = adaptConversationDisclosureSources({
      scope,
      causalRecords: [first, second],
      workspaceRuns: [{
        run: makeWorkspaceRun("paused"),
        events: createConversationSourcePage({
          source: "workspace_run",
          sourceId: "workspace_1",
          queryHash: "query:workspace",
          sourceRevision: "cut:workspace",
          status: "complete",
          records: [{
            id: "workspace_event_shared",
            workspaceRunId: "workspace_1",
            sessionId: "session_1",
            requestId: "request_1",
            seq: 1,
            type: "status",
            status: "paused",
            message: "matches only the first obligation",
            lifecycleStatus: "paused",
            payload: {},
            createdAt: "2026-08-25T00:00:01.000Z",
          }],
        }),
      }],
    });

    expect(batch.sourceCuts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "workspace_run",
        sourceIdentity: "record:workspace_event_shared",
        status: "incompatible",
        reasonCode: "required_witness_conflict",
      }),
      expect.objectContaining({
        source: "workspace_run",
        sourceIdentity: "record:workspace_1",
        status: "incompatible",
        reasonCode: "required_witness_conflict",
      }),
    ]));
    expect(batch.seeds.find(
      (seed) => seed.primary.authorityRef === "workspace_event_shared",
    )?.primary.requiredness).toBe("optional");
  });

  it("rejects a Workspace witness whose event embeds a different run id", () => {
    const causal = makeCausalRecord({
      requiredSettlements: [{
        id: "settlement_wrong_embedded_run",
        attempt: 1,
        sourceSequence: 2,
        targetState: "paused",
        requiredDomains: ["workspace"],
        workspaceRunId: "workspace_1",
        preparedWorkspaceEventId: "workspace_event_required",
        workspaceEventId: "workspace_event_required",
        preparedChatEventFingerprint: "prepared",
        state: "committed",
        createdAt: "2026-08-25T00:00:00.000Z",
        updatedAt: "2026-08-25T00:00:01.000Z",
      }],
    });
    const batch = adaptConversationDisclosureSources({
      scope,
      causalRecords: [causal],
      workspaceRuns: [{
        run: makeWorkspaceRun("paused"),
        events: createConversationSourcePage({
          source: "workspace_run",
          sourceId: "workspace_1",
          queryHash: "query:workspace",
          sourceRevision: "cut:workspace",
          status: "complete",
          records: [{
            id: "workspace_event_required",
            workspaceRunId: "workspace_wrong",
            sessionId: "session_1",
            requestId: "request_1",
            seq: 1,
            type: "status",
            status: "paused",
            message: "wrong embedded owner",
            lifecycleStatus: "paused",
            payload: {},
            createdAt: "2026-08-25T00:00:01.000Z",
          }],
        }),
      }],
    });

    expect(batch.sourceCuts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "workspace_run",
        sourceIdentity: "record:workspace_event_required",
        requiredness: "required",
        status: "incompatible",
        reasonCode: "source_identity_conflict",
      }),
      expect.objectContaining({
        source: "workspace_run",
        sourceIdentity: "record:workspace_event_required",
        requiredness: "required",
        status: "unavailable",
        reasonCode: "required_witness_missing",
      }),
    ]));
    expect(projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:workspace-owner-conflict",
      expectedSourceCuts: batch.sourceCuts,
      seeds: batch.seeds,
    }).sourceCuts).toContainEqual(expect.objectContaining({
      source: "workspace_run",
      sourceIdentity: "record:workspace_event_required",
      requiredness: "required",
      status: "incompatible",
      reasonCode:
        "required_witness_missing+source_identity_conflict",
    }));
    expect(batch.seeds.find(
      (seed) => seed.primary.authorityRef === "workspace_event_required",
    )).toBeUndefined();
  });

  it("rejects Workspace events read from a page for another owner", () => {
    const causal = makeCausalRecord({
      requiredSettlements: [{
        id: "settlement_wrong_page_owner",
        attempt: 1,
        sourceSequence: 2,
        targetState: "paused",
        requiredDomains: ["workspace"],
        workspaceRunId: "workspace_1",
        preparedWorkspaceEventId: "workspace_event_required",
        workspaceEventId: "workspace_event_required",
        preparedChatEventFingerprint: "prepared",
        state: "committed",
        createdAt: "2026-08-25T00:00:00.000Z",
        updatedAt: "2026-08-25T00:00:01.000Z",
      }],
    });
    const batch = adaptConversationDisclosureSources({
      scope,
      causalRecords: [causal],
      workspaceRuns: [{
        run: makeWorkspaceRun("paused"),
        events: createConversationSourcePage({
          source: "workspace_run",
          sourceId: "workspace_wrong",
          queryHash: "query:workspace",
          sourceRevision: "cut:workspace",
          status: "complete",
          records: [{
            id: "workspace_event_required",
            workspaceRunId: "workspace_1",
            sessionId: "session_1",
            requestId: "request_1",
            seq: 1,
            type: "status",
            status: "paused",
            message: "wrong page owner",
            lifecycleStatus: "paused",
            payload: {},
            createdAt: "2026-08-25T00:00:01.000Z",
          }],
        }),
      }],
    });

    expect(batch.sourceCuts).toContainEqual(expect.objectContaining({
      source: "workspace_run",
      sourceIdentity: "workspace_wrong",
      requiredness: "required",
      status: "incompatible",
      reasonCode: "source_identity_conflict",
    }));
    expect(batch.seeds.find(
      (seed) => seed.primary.authorityRef === "workspace_event_required",
    )).toBeUndefined();
  });

  it("does not accept prepared workspace evidence as a committed witness", () => {
    const causal = makeCausalRecord({
      requiredSettlements: [{
        id: "settlement_preparing",
        attempt: 1,
        sourceSequence: 2,
        targetState: "paused",
        requiredDomains: ["workspace"],
        workspaceRunId: "workspace_1",
        preparedWorkspaceEventId: "workspace_event_prepared",
        preparedChatEventFingerprint: "prepared",
        state: "preparing",
        createdAt: "2026-08-25T00:00:00.000Z",
        updatedAt: "2026-08-25T00:00:01.000Z",
      }],
    });
    const batch = adaptConversationDisclosureSources({
      scope,
      causalRecords: [causal],
      workspaceRuns: [{
        run: makeWorkspaceRun("paused"),
        events: createConversationSourcePage({
          source: "workspace_run",
          sourceId: "workspace_1",
          queryHash: "query:workspace",
          sourceRevision: "cut:workspace",
          status: "complete",
          records: [{
            id: "workspace_event_prepared",
            workspaceRunId: "workspace_1",
            sessionId: "session_1",
            requestId: "request_1",
            seq: 1,
            type: "status",
            status: "paused",
            message: "paused",
            lifecycleStatus: "paused",
            payload: {},
            createdAt: "2026-08-25T00:00:01.000Z",
          }],
        }),
      }],
    });

    expect(batch.sourceCuts).toContainEqual(expect.objectContaining({
      source: "workspace_run",
      sourceIdentity: "record:settlement:settlement_preparing",
      status: "unavailable",
      reasonCode: "required_settlement_incomplete",
    }));
    expect(batch.seeds.find(
      (seed) => seed.primary.authorityRef === "workspace_event_prepared",
    )?.primary.requiredness).toBe("optional");
  });

  it("associates tool evidence by run and call id without exposing raw payloads", () => {
    const first = makeTrajectory("run_1", "event_1", 1, {
      toolCallId: "call_reused",
      args: { password: "must-not-leak" },
    });
    const second = makeTrajectory("run_2", "event_2", 1, {
      toolCallId: "call_reused",
    });
    const invocation = makeInvocation();
    const owner = makeRun({ id: invocation.runId });
    const causalRecord = makeCausalRecord({
      refs: [{
        kind: "tool_invocation",
        runId: invocation.runId,
        id: invocation.id,
      }],
    });
    const batch = adaptConversationDisclosureSources({
      scope,
      causalRecords: [causalRecord],
      agentRuns: [owner],
      trajectory: [
        { runId: "run_1", events: trajectoryPage("run_1", [first]) },
        { runId: "run_2", events: trajectoryPage("run_2", [second]) },
      ],
      toolInvocations: [invocation],
    });
    const toolSeed = batch.seeds.find(
      (seed) => seed.primary.kind === "tool_invocation",
    )!;

    expect(toolSeed.contributors?.map((entry) => entry.authorityRef))
      .toEqual(["event_1"]);
    const serialized = JSON.stringify(batch);
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain(invocation.resultRef);
    expect(serialized).not.toContain("/private/workspace");
  });

  it("derives Tool contributor completeness only from relevant owned pages", () => {
    const invocation = makeInvocation();
    const owner = makeRun({ id: invocation.runId });
    const causalRecord = makeCausalRecord({
      refs: [{
        kind: "tool_invocation",
        runId: invocation.runId,
        id: invocation.id,
      }],
    });
    const relevant = makeTrajectory("run_1", "event_relevant", 1, {
      toolCallId: invocation.toolCallId,
    });
    const unrelatedPartial = createConversationSourcePage({
      source: "trajectory",
      sourceId: "run_2",
      queryHash: "query:unrelated",
      sourceRevision: "cut:unrelated",
      status: "partial",
      reasonCode: "source_page_incomplete",
      records: [makeTrajectory("run_2", "event_unrelated", 1, {})],
    });
    const complete = adaptConversationDisclosureSources({
      scope,
      causalRecords: [causalRecord],
      agentRuns: [owner],
      trajectory: [
        { runId: "run_1", events: trajectoryPage("run_1", [relevant]) },
        { runId: "run_2", events: unrelatedPartial },
      ],
      toolInvocations: [invocation],
    });
    expect(complete.seeds.find(
      (seed) => seed.primary.kind === "tool_invocation",
    )?.contributorsComplete).toBe(true);

    const missing = adaptConversationDisclosureSources({
      scope,
      causalRecords: [causalRecord],
      agentRuns: [owner],
      toolInvocations: [invocation],
    });
    expect(missing.seeds.find(
      (seed) => seed.primary.kind === "tool_invocation",
    )?.contributorsComplete).toBe(false);

    const mismatched = adaptConversationDisclosureSources({
      scope,
      causalRecords: [causalRecord],
      agentRuns: [owner],
      trajectory: [{
        runId: "run_1",
        events: createConversationSourcePage({
          source: "trajectory",
          sourceId: "foreign_run",
          queryHash: "query:mismatched",
          sourceRevision: "cut:mismatched",
          status: "complete",
          records: [relevant],
        }),
      }],
      toolInvocations: [invocation],
    });
    expect(mismatched.seeds.find(
      (seed) => seed.primary.kind === "tool_invocation",
    )?.contributorsComplete).toBe(false);

    const ownerConflict = adaptConversationDisclosureSources({
      scope,
      causalRecords: [causalRecord],
      agentRuns: [{ ...owner, status: "failed" }],
      trajectory: [{
        runId: "run_1",
        owner: { id: "run_1", status: "succeeded" },
        events: trajectoryPage("run_1", [relevant]),
      }],
      toolInvocations: [invocation],
    });
    const conflictedTool = ownerConflict.seeds.find(
      (seed) => seed.primary.kind === "tool_invocation",
    );
    expect(conflictedTool?.contributors).toEqual([]);
    expect(conflictedTool?.contributorsComplete).toBe(false);
    expect(ownerConflict.sourceCuts).toContainEqual(expect.objectContaining({
      source: "trajectory",
      status: "incompatible",
      reasonCode: "source_identity_conflict",
    }));
  });

  it("rejects conflicting immutable Tool identities before projection", () => {
    const invocation = makeInvocation();
    const causalRecord = makeCausalRecord({
      refs: [{
        kind: "tool_invocation",
        runId: invocation.runId,
        id: invocation.id,
      }],
    });
    const batch = adaptConversationDisclosureSources({
      scope,
      causalRecords: [causalRecord],
      agentRuns: [makeRun()],
      toolInvocations: [
        invocation,
        {
          ...invocation,
          toolName: "write_file",
          updatedAt: "2026-08-25T00:00:03.000Z",
        },
      ],
    });

    expect(batch.seeds.some(
      (seed) => seed.primary.kind === "tool_invocation",
    )).toBe(false);
    expect(batch.sourceCuts).toContainEqual({
      source: "tool_invocation",
      sourceIdentity: `record:${invocation.id}`,
      requiredness: "required",
      status: "incompatible",
      reasonCode: "source_identity_conflict",
    });
  });

  it("rejects equal-time conflicting Tool terminal states", () => {
    const invocation = makeInvocation();
    const causalRecord = makeCausalRecord({
      refs: [{
        kind: "tool_invocation",
        runId: invocation.runId,
        id: invocation.id,
      }],
    });
    const batch = adaptConversationDisclosureSources({
      scope,
      causalRecords: [causalRecord],
      agentRuns: [makeRun()],
      toolInvocations: [
        {
          ...invocation,
          status: "completed",
          ok: true,
        },
        {
          ...invocation,
          status: "aborted",
          ok: false,
        },
      ],
    });

    expect(batch.seeds.some(
      (seed) => seed.primary.kind === "tool_invocation",
    )).toBe(false);
    expect(batch.sourceCuts).toContainEqual({
      source: "tool_invocation",
      sourceIdentity: `record:${invocation.id}`,
      requiredness: "required",
      status: "incompatible",
      reasonCode: "source_identity_conflict",
    });
  });

  it("requires a committed matching settlement before guided input projection", () => {
    const state = {
      inputRequestId: "input_1",
      status: "pending" as const,
      settlementId: "settlement_1",
      sessionId: "session_1",
      requestId: "request_1",
      userMessage: "secret should stay out",
      selectedSkillName: "skill",
      partialValues: {},
    };
    const chatEvent = {
      sessionId: "session_1",
      requestId: "request_1",
      turnId: "turn_1",
      sequence: 1,
      state: "waiting_for_input" as const,
      message: "Input required",
      settlementId: "settlement_1",
      pendingSkillInput: state,
      createdAt: "2026-08-25T00:00:00.000Z",
      elapsedMs: 1,
    };
    const fingerprint = createRequiredChatEventFingerprint(chatEvent);
    const settlement: ConversationRequiredSettlement = {
      id: "settlement_1",
      attempt: 1,
      sourceSequence: 1,
      targetState: "waiting_for_input",
      guidedInputRequestId: "input_1",
      requiredDomains: ["chat"],
      preparedChatEventFingerprint: fingerprint,
      state: "committed",
      chatEventFingerprint: fingerprint,
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:00:00.000Z",
    };
    const settlementOwner = makeCausalRecord({
      requiredSettlements: [settlement],
    });
    const missing = adaptConversationDisclosureSources({
      scope,
      chatTranscript: {
        sessionId: "session_1",
        sourceRevision: "cut:transcript",
        status: "complete",
      },
      guidedInputs: [{
        state,
        settlement: {
          ...settlement,
          id: "settlement_unrelated",
        },
        settlementOwner,
        chatEvent,
        occurredAt: "2026-08-25T00:00:00.000Z",
      }],
    });
    expect(missing.seeds).toEqual([]);
    expect(missing.sourceCuts.find(
      (cut) =>
        cut.source === "guided_input"
        && cut.sourceIdentity === "record:input_1",
    )).toMatchObject({
      source: "guided_input",
      requiredness: "required",
      status: "unavailable",
      reasonCode: "required_settlement_incomplete",
    });

    const committed = adaptConversationDisclosureSources({
      scope,
      chatTranscript: {
        sessionId: "session_1",
        sourceRevision: "cut:transcript",
        status: "complete",
      },
      causalRecords: [settlementOwner],
      guidedInputs: [{
        state,
        settlement,
        settlementOwner,
        chatEvent,
        occurredAt: "2026-08-25T00:00:00.000Z",
      }],
    });
    expect(committed.seeds[0]?.primary).toMatchObject({
      kind: "guided_input",
      domainStatus: "pending",
      requiredness: "required",
    });
    expect(JSON.stringify(committed)).not.toContain("secret should stay out");
  });

  it("preserves source page cuts and never upgrades a partial legacy cut", () => {
    const chatPage = createConversationSourcePage({
      source: "chat_activity",
      sourceId: "session_1",
      queryHash: "query:chat",
      sourceRevision: "cut:legacy",
      status: "partial",
      reasonCode: "legacy_chat_activity_tail",
      records: [{
        eventId: "event_1",
        sequence: 1,
        legacy: true,
        event: {
          sessionId: "session_1",
          requestId: "request_1",
          sequence: 1,
          state: "started" as const,
          message: "started",
          createdAt: "2026-08-25T00:00:00.000Z",
          elapsedMs: 1,
        },
      }],
    });
    const batch = adaptConversationDisclosureSources({
      scope,
      chatTranscript: {
        sessionId: "session_1",
        sourceRevision: "cut:transcript",
        status: "complete",
      },
      chatActivity: chatPage,
    });
    const snapshot = projectConversationDisclosureSnapshot({
      scope,
      generation: "generation:1",
      expectedSourceCuts: batch.sourceCuts,
      seeds: batch.seeds,
    });

    expect(snapshot.coverage.state).toBe("partial");
    expect(snapshot.sourceCuts).toContainEqual(expect.objectContaining({
      source: "chat_activity",
      sourceIdentity: "session_1",
      cursor: "cut:legacy",
      status: "partial",
      reasonCode: "legacy_chat_activity_tail",
    }));
  });

  it("marks an unconsumed bounded page partial even when its cut is valid", () => {
    const batch = adaptConversationDisclosureSources({
      scope,
      agentRuns: [makeRun()],
      trajectory: [{
        runId: "run_1",
        events: createConversationSourcePage({
          source: "trajectory",
          sourceId: "run_1",
          queryHash: "query:trajectory",
          sourceRevision: "cut:trajectory",
          status: "complete",
          records: [makeTrajectory("run_1", "event_1", 1, {})],
          nextPosition: 1,
        }),
      }],
    });

    expect(batch.sourceCuts).toContainEqual({
      source: "trajectory",
      sourceIdentity: "run_1",
      cursor: "cut:trajectory",
      requiredness: "optional",
      status: "partial",
      reasonCode: "source_page_incomplete",
    });
  });

  it("deep-clones adapter output and keeps unknown facts explicit", () => {
    const unknown = {
      schemaVersion: 2,
      originalKind: "future_optional",
      authorityRef: "future_1",
      scope,
      domainStatus: "future",
      requiredness: "optional" as const,
      durability: "durable" as const,
      sensitivity: "technical" as const,
      occurredAt: "2026-08-25T00:00:00.000Z",
      semanticSlot: "future",
      safeSummary: "future",
    };
    const input = { scope, unknownFacts: [unknown] };
    const batch = adaptConversationDisclosureSources(input);
    unknown.safeSummary = "mutated";

    expect(batch.unknownFacts[0]?.safeSummary).toBe("future");
  });
});

function itemFor(
  snapshot: ReturnType<typeof projectConversationDisclosureSnapshot>,
  kind: string,
  ref: string,
) {
  return snapshot.items.find(
    (item) => item.primarySource.kind === kind
      && item.primarySource.ref === ref,
  );
}

function makeGoal(): Goal {
  return {
    id: "goal_1",
    chatSessionId: "session_1",
    description: "goal",
    successCriteria: [],
    milestones: [],
    status: "waiting_for_acceptance",
    executionUsage: {
      iterations: 0,
      toolCalls: 0,
      wallClockMs: 0,
      tokens: 0,
      replans: 0,
    },
    reviewPolicy: "review_final_only",
    planVersion: 1,
    activePlanRef: {
      planId: "plan_1",
      planRevision: 2,
      goalPlanVersion: 1,
      mode: "direct",
      purpose: "initial",
      goalContractRef: {
        id: "goal-contract_1",
        revision: 1,
        sha256: "sha256:test",
      },
    },
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:02.000Z",
  };
}

function makePlan(): PlanRecord {
  return {
    id: "plan_1",
    sessionId: "session_1",
    sourceMessage: "plan",
    mode: "direct",
    status: "executing",
    actionGate: "blocked",
    revision: 2,
    taskContract: {} as PlanRecord["taskContract"],
    evidence: [],
    requestedModelAssignments: {},
    frozenModelAssignments: {} as PlanRecord["frozenModelAssignments"],
    goalId: "goal_1",
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:01.000Z",
    rounds: [],
  };
}

function makeRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: "run_1",
    taskId: "task_1",
    taskName: "task",
    skillName: "skill",
    status: "running",
    summary: "",
    events: [],
    runContext: {
      sessionId: "session_1",
    } as AgentRunRecord["runContext"],
    startedAt: "2026-08-25T00:00:00.000Z",
    finishedAt: "",
    ...overrides,
  };
}

function makeWorkspaceRun(status: WorkspaceRun["status"]): WorkspaceRun {
  return {
    workspaceRunId: "workspace_1",
    sessionId: "session_1",
    requestId: "request_1",
    status,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:01.000Z",
  };
}

function makeTrajectory(
  runId: string,
  id: string,
  sequence: number,
  payload: Record<string, unknown>,
): AgentTrajectoryEvent {
  return {
    id,
    runId,
    sequence,
    type: "tool_call",
    payload,
    redaction: {
      containsApiKey: false,
      containsFileContent: false,
      containsUserText: false,
    },
    createdAt: "2026-08-25T00:00:01.000Z",
  };
}

function trajectoryPage(
  runId: string,
  records: AgentTrajectoryEvent[],
) {
  return createConversationSourcePage({
    source: "trajectory",
    sourceId: runId,
    queryHash: `query:${runId}`,
    sourceRevision: `cut:${runId}`,
    status: "complete",
    records,
  });
}

function makeInvocation(): ToolInvocationRecord {
  return {
    id: "invocation_1",
    runId: "run_1",
    toolCallId: "call_reused",
    toolName: "shell_exec",
    source: "native",
    args: {
      command: "cat /private/workspace/file",
      password: "must-not-leak",
    },
    status: "completed",
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:02.000Z",
    ok: true,
    resultRef: "tool-result-refs/private-result.json",
    history: [{
      status: "completed",
      at: "2026-08-25T00:00:02.000Z",
      ok: true,
      resultRef: "tool-result-refs/private-result.json",
    }],
  };
}

function makeRequiredSettlement(
  overrides: Partial<ConversationRequiredSettlement> = {},
): ConversationRequiredSettlement {
  return {
    id: "settlement_1",
    attempt: 1,
    sourceSequence: 1,
    targetState: "paused",
    requiredDomains: ["chat", "workspace"],
    workspaceRunId: "workspace_1",
    preparedWorkspaceEventId: "workspace_event_1",
    workspaceEventId: "workspace_event_1",
    preparedChatEventFingerprint: "prepared",
    state: "committed",
    chatEventFingerprint: "committed",
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:01.000Z",
    ...overrides,
  };
}

function makeCausalRecord(
  overrides: Partial<ConversationCausalRecord> = {},
): ConversationCausalRecord {
  return {
    schemaVersion: 1,
    requestId: "request_1",
    turnId: "turn_1",
    sessionId: "session_1",
    userMessageId: "message_1",
    inputFingerprint: "fingerprint",
    revision: 1,
    attempts: [],
    refs: [],
    coverage: { state: "complete", reasonCodes: [] },
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}
