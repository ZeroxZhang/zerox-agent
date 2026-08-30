import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createConversationCausalStore } from "./conversationCausalStore";
import {
  CONVERSATION_CAUSAL_SCHEMA_VERSION,
  CONVERSATION_REQUEST_FINGERPRINT_VERSION,
  createLegacyConversationRequestFingerprint,
  createConversationCausalAttemptId,
  createConversationRequestFingerprint,
  type ToolApprovalIntent,
} from "../shared/conversationCausalSpine";

async function createFixture() {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "zerox-causal-"));
  let tick = 0;
  const store = createConversationCausalStore({
    configDir,
    createId: () => `id-${++tick}`,
    now: () => new Date(`2026-08-18T00:00:${String(++tick).padStart(2, "0")}.000Z`),
  });
  return { configDir, store };
}

describe("conversation causal store", () => {
  it("claims one request and rejects a conflicting input fingerprint", async () => {
    const { store } = await createFixture();
    const first = await store.claimRequest({
      requestId: "request:1",
      turnId: "turn:1",
      inputFingerprint: createConversationRequestFingerprint({ message: "one" }),
    });
    expect(first.disposition).toBe("applied");
    expect((await store.claimRequest({
      requestId: "request:1",
      turnId: "turn:1",
      inputFingerprint: createConversationRequestFingerprint({ message: "one" }),
    })).disposition).toBe("duplicate");
    expect((await store.claimRequest({
      requestId: "request:1",
      turnId: "turn:1",
      inputFingerprint: createConversationRequestFingerprint({ message: "different" }),
    })).disposition).toBe("conflict");
  });

  it("replays a persisted legacy v1 request without weakening new exact claims", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "zerox-causal-legacy-"));
    const stateDir = path.join(configDir, "conversation-causal");
    const value = { message: "same legacy request", mode: "chat" };
    const legacyInputFingerprint = createLegacyConversationRequestFingerprint(value);
    await mkdir(stateDir, { recursive: true });
    await writeFile(path.join(stateDir, "state.json"), JSON.stringify({
      schemaVersion: CONVERSATION_CAUSAL_SCHEMA_VERSION,
      records: [{
        schemaVersion: CONVERSATION_CAUSAL_SCHEMA_VERSION,
        requestId: "request:legacy",
        turnId: "turn:legacy",
        inputFingerprint: legacyInputFingerprint,
        revision: 1,
        attempts: [],
        refs: [],
        coverage: { state: "complete", reasonCodes: [] },
        createdAt: "2026-08-18T00:00:00.000Z",
        updatedAt: "2026-08-18T00:00:00.000Z",
      }],
      approvals: [],
    }), "utf8");
    const store = createConversationCausalStore({ configDir });

    await expect(store.claimRequest({
      requestId: "request:legacy",
      turnId: "turn:legacy",
      inputFingerprint: createConversationRequestFingerprint(value),
      inputFingerprintVersion: CONVERSATION_REQUEST_FINGERPRINT_VERSION,
      legacyInputFingerprint,
    })).resolves.toMatchObject({ disposition: "duplicate" });
    await expect(store.claimRequest({
      requestId: "request:legacy",
      turnId: "turn:legacy",
      inputFingerprint: createConversationRequestFingerprint({ message: "different" }),
      inputFingerprintVersion: CONVERSATION_REQUEST_FINGERPRINT_VERSION,
      legacyInputFingerprint: createLegacyConversationRequestFingerprint({ message: "different" }),
    })).resolves.toMatchObject({ disposition: "conflict" });
  });

  it("reserves request identity before session binding and treats caller session as routing context", async () => {
    const { store } = await createFixture();
    await store.claimRequest({
      requestId: "request:global",
      turnId: "turn:global",
      inputFingerprint: "input:global",
    });
    expect((await store.claimRequest({
      requestId: "request:global",
      turnId: "turn:global",
      inputFingerprint: "input:global",
    })).disposition).toBe("duplicate");
    expect((await store.bindRequest({
      requestId: "request:global",
      sessionId: "session:first",
      userMessageId: "message:first",
    })).disposition).toBe("applied");
    expect((await store.bindRequest({
      requestId: "request:global",
      sessionId: "session:other-window",
      userMessageId: "message:other",
    })).disposition).toBe("conflict");
    expect((await store.bindRequest({
      requestId: "request:global",
      sessionId: "session:first",
      userMessageId: "   ",
    })).disposition).toBe("conflict");
  });

  it("persists begin supersede retry and accepted assistant receipt idempotently", async () => {
    const { store } = await createFixture();
    await store.claimRequest({
      requestId: "request:1",
      turnId: "turn:1",
      inputFingerprint: "input:1",
    });
    expect((await store.beginAttempt({ requestId: "request:1", attempt: 1 })).disposition)
      .toBe("applied");
    expect((await store.settleAttempt({
      requestId: "request:1",
      attempt: 1,
      state: "superseded",
      supersedesAttempt: 1,
    })).disposition).toBe("applied");
    expect((await store.beginAttempt({ requestId: "request:1", attempt: 2 })).disposition)
      .toBe("applied");
    const message = {
      id: "message:1",
      role: "assistant" as const,
      requestId: "request:1",
      turnId: "turn:1",
      content: "durable answer",
      turnSettlementStatus: "succeeded" as const,
    };
    expect((await store.acceptAssistant({
      requestId: "request:1",
      attempt: 2,
      persistedMessage: message,
    })).disposition).toBe("applied");
    expect((await store.acceptAssistant({
      requestId: "request:1",
      attempt: 2,
      persistedMessage: message,
    })).disposition).toBe("duplicate");
    expect((await store.acceptAssistant({
      requestId: "request:1",
      attempt: 2,
      persistedMessage: { ...message, content: "tampered" },
    })).disposition).toBe("conflict");
    expect((await store.acceptAssistant({
      requestId: "request:1",
      attempt: 2,
      persistedMessage: { ...message, turnSettlementStatus: "paused" },
    })).disposition).toBe("conflict");
    expect((await store.beginAttempt({ requestId: "request:1", attempt: 3 })).disposition)
      .toBe("conflict");
  });

  it("prepares and atomically commits an exact Workspace-backed assistant acceptance", async () => {
    const { configDir, store } = await createFixture();
    const requestId = "request:assistant-two-phase";
    const turnId = "turn:assistant-two-phase";
    const persistedMessage = {
      id: "message:assistant-two-phase",
      role: "assistant" as const,
      requestId,
      turnId,
      content: "durable answer",
      turnSettlementStatus: "succeeded" as const,
    };
    await store.claimRequest({
      requestId,
      turnId,
      inputFingerprint: "input:assistant-two-phase",
    });
    await store.beginAttempt({ requestId, attempt: 1 });

    const prepared = await store.prepareAssistantAcceptance({
      requestId,
      attempt: 1,
      persistedMessage,
      workspaceRunId: "workspace:assistant-two-phase",
    });
    expect(prepared).toMatchObject({
      disposition: "applied",
      value: {
        attempts: [{
          state: "active",
          assistantAcceptance: {
            state: "preparing",
            requiredDomains: ["chat", "workspace"],
            workspaceRunId: "workspace:assistant-two-phase",
          },
        }],
      },
    });
    const acceptance = prepared.value!.attempts[0].assistantAcceptance!;
    expect(acceptance.preparedWorkspaceEventId).toBeTruthy();
    await expect(store.prepareAssistantAcceptance({
      requestId,
      attempt: 1,
      persistedMessage,
      workspaceRunId: "workspace:assistant-two-phase",
    })).resolves.toMatchObject({ disposition: "duplicate" });
    await expect(store.prepareAssistantAcceptance({
      requestId,
      attempt: 1,
      persistedMessage: { ...persistedMessage, content: "conflict" },
      workspaceRunId: "workspace:assistant-two-phase",
    })).resolves.toMatchObject({ disposition: "conflict" });
    await expect(store.commitAssistantAcceptance({
      requestId,
      attempt: 1,
      acceptanceReceiptFingerprint:
        acceptance.acceptedSettlement.acceptanceReceiptFingerprint,
    })).resolves.toMatchObject({ disposition: "conflict" });

    const reopened = createConversationCausalStore({ configDir });
    await expect(reopened.interruptActiveAttempts()).resolves.toBe(0);
    const committed = await reopened.commitAssistantAcceptance({
      requestId,
      attempt: 1,
      acceptanceReceiptFingerprint:
        acceptance.acceptedSettlement.acceptanceReceiptFingerprint,
      workspaceEventId: acceptance.preparedWorkspaceEventId,
    });
    expect(committed).toMatchObject({
      disposition: "applied",
      value: {
        attempts: [{
          state: "accepted",
          assistantAcceptance: {
            state: "committed",
            workspaceEventId: acceptance.preparedWorkspaceEventId,
          },
        }],
        refs: expect.arrayContaining([
          { kind: "workspace_run", id: "workspace:assistant-two-phase" },
          {
            kind: "workspace_event",
            runId: "workspace:assistant-two-phase",
            eventId: acceptance.preparedWorkspaceEventId,
          },
        ]),
      },
    });
    await expect(reopened.commitAssistantAcceptance({
      requestId,
      attempt: 1,
      acceptanceReceiptFingerprint:
        acceptance.acceptedSettlement.acceptanceReceiptFingerprint,
      workspaceEventId: acceptance.preparedWorkspaceEventId,
    })).resolves.toMatchObject({ disposition: "duplicate" });
  });

  it("binds distinct typed refs and never upgrades degraded coverage", async () => {
    const { store } = await createFixture();
    await store.claimRequest({
      requestId: "request:refs",
      turnId: "turn:refs",
      inputFingerprint: "input:refs",
    });
    const result = await store.addRefs({
      requestId: "request:refs",
      refs: [
        { kind: "trajectory_run", id: "same" },
        { kind: "agent_run", id: "same" },
        { kind: "tool_invocation", runId: "run:1", id: "tool:1" },
      ],
      coverage: { state: "degraded", reasonCodes: ["workspace_sink_failed"] },
    });
    expect(result.value?.refs).toHaveLength(3);
    expect((await store.addRefs({
      requestId: "request:refs",
      refs: [],
      coverage: { state: "complete", reasonCodes: [] },
    })).value?.coverage.state).toBe("degraded");
  });

  it("uses durable approval CAS and interrupts only prior process pending intents", async () => {
    const { store } = await createFixture();
    const intent = approvalIntent("approval:1", "epoch:old");
    expect((await store.createApprovalIntent(intent)).disposition).toBe("applied");
    expect((await store.createApprovalIntent(intent)).disposition).toBe("duplicate");
    const interrupted = await store.interruptPriorProcessPending({
      currentProcessEpoch: "epoch:new",
      decidedAt: "2026-08-18T00:01:00.000Z",
    });
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0]).toMatchObject({ state: "interrupted", revision: 2 });
    expect((await store.decideApproval({
      id: "approval:1",
      expectedRevision: 1,
      decision: interrupted[0]!.decision!,
    })).disposition).toBe("duplicate");
    expect((await store.decideApproval({
      id: "approval:1",
      expectedRevision: 1,
      decision: {
        decisionId: "opposite",
        outcome: "approved",
        automatic: false,
        reasonCode: "user_approved",
        decidedAt: "2026-08-18T00:01:01.000Z",
      },
    })).disposition).toBe("conflict");
  });

  it("never persists raw approval args or secret-shaped values", async () => {
    const { configDir, store } = await createFixture();
    const intent = approvalIntent("approval:secret", "epoch:1");
    intent.taskName = "Task sk-sp-STORE-BOUNDARY-SECRET";
    intent.safeArgsSummary = {
      command: "curl -H 'Authorization: Bearer secret-token' https://example.com",
    };
    await store.createApprovalIntent(intent);
    const disk = await readFile(
      path.join(configDir, "conversation-causal", "state.json"),
      "utf8",
    );
    expect(disk).not.toContain("secret-token");
    expect(disk).not.toContain("sk-sp-STORE-BOUNDARY-SECRET");
    expect(disk).not.toContain("rawArgs");
  });

  it("never upgrades a legacy session-only record into a durable binding", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "zerox-causal-session-only-"));
    const stateDir = path.join(configDir, "conversation-causal");
    await mkdir(stateDir, { recursive: true });
    await writeFile(path.join(stateDir, "state.json"), JSON.stringify({
      schemaVersion: CONVERSATION_CAUSAL_SCHEMA_VERSION,
      records: [{
        schemaVersion: CONVERSATION_CAUSAL_SCHEMA_VERSION,
        requestId: "request:session-only",
        turnId: "turn:session-only",
        sessionId: "session:routing-only",
        inputFingerprint: createConversationRequestFingerprint({ message: "legacy" }),
        inputFingerprintVersion: CONVERSATION_REQUEST_FINGERPRINT_VERSION,
        revision: 1,
        attempts: [],
        refs: [],
        coverage: { state: "degraded", reasonCodes: ["session_binding_unproven"] },
        createdAt: "2026-08-18T00:00:00.000Z",
        updatedAt: "2026-08-18T00:00:00.000Z",
      }],
      approvals: [],
    }), "utf8");
    const store = createConversationCausalStore({ configDir });

    await expect(store.bindRequest({
      requestId: "request:session-only",
      sessionId: "session:routing-only",
      userMessageId: "message:planted",
    })).resolves.toMatchObject({ disposition: "conflict" });
    const stored = await store.getRequest("request:session-only");
    expect(stored).toMatchObject({ sessionId: "session:routing-only" });
    expect(stored).not.toHaveProperty("userMessageId");
  });

  it("journals required settlement preparation and one terminal decision", async () => {
    const { store } = await createFixture();
    await store.claimRequest({
      requestId: "request:settlement",
      turnId: "turn:settlement",
      inputFingerprint: "input:settlement",
    });
    await store.bindRequest({
      requestId: "request:settlement",
      sessionId: "session:settlement",
      userMessageId: "message:user",
    });
    await store.beginAttempt({ requestId: "request:settlement", attempt: 1 });

    await expect(store.beginRequiredSettlement({
      requestId: "request:settlement",
      id: "settlement:invalid-fingerprint",
      attempt: 1,
      sourceSequence: 3,
      targetState: "waiting_for_input",
      requiredDomains: ["chat"],
      preparedChatEventFingerprint: "not-a-sha256-fingerprint",
    })).resolves.toMatchObject({ disposition: "conflict" });
    await expect(store.beginRequiredSettlement({
      requestId: "request:settlement",
      id: "settlement:1",
      attempt: 1,
      sourceSequence: 4,
      targetState: "waiting_for_input",
      requiredDomains: ["chat", "workspace"],
      workspaceRunId: "workspace-run:1",
      preparedWorkspaceEventId: "workspace:1",
      preparedChatEventFingerprint: "a".repeat(64),
    })).resolves.toMatchObject({ disposition: "applied" });
    await expect(store.beginRequiredSettlement({
      requestId: "request:settlement",
      id: "settlement:1",
      attempt: 1,
      sourceSequence: 4,
      targetState: "waiting_for_input",
      requiredDomains: ["workspace", "chat", "workspace"],
      workspaceRunId: "workspace-run:1",
      preparedWorkspaceEventId: "workspace:1",
      preparedChatEventFingerprint: "a".repeat(64),
    })).resolves.toMatchObject({ disposition: "duplicate" });
    await expect(store.beginRequiredSettlement({
      requestId: "request:settlement",
      id: "settlement:1",
      attempt: 1,
      sourceSequence: 4,
      targetState: "waiting_for_input",
      requiredDomains: ["chat", "workspace"],
      workspaceRunId: "workspace-run:1",
      preparedWorkspaceEventId: "workspace:1",
      preparedChatEventFingerprint: "b".repeat(64),
    })).resolves.toMatchObject({ disposition: "conflict" });
    await expect(store.beginRequiredSettlement({
      requestId: "request:settlement",
      id: "settlement:1",
      attempt: 1,
      sourceSequence: 4,
      targetState: "waiting_for_input",
      requiredDomains: ["chat", "workspace"],
      workspaceRunId: "workspace-run:changed",
      preparedWorkspaceEventId: "workspace:1",
      preparedChatEventFingerprint: "a".repeat(64),
    })).resolves.toMatchObject({ disposition: "conflict" });
    await expect(store.beginRequiredSettlement({
      requestId: "request:settlement",
      id: "settlement:1",
      attempt: 1,
      sourceSequence: 4,
      targetState: "waiting_for_input",
      requiredDomains: ["chat", "workspace"],
      workspaceRunId: "workspace-run:1",
      preparedWorkspaceEventId: "workspace:changed",
      preparedChatEventFingerprint: "a".repeat(64),
    })).resolves.toMatchObject({ disposition: "conflict" });
    await expect(store.settleRequiredSettlement({
      requestId: "request:settlement",
      id: "settlement:1",
      state: "committed",
      chatEventFingerprint: "a".repeat(64),
    })).resolves.toMatchObject({ disposition: "conflict" });
    await expect(store.settleRequiredSettlement({
      requestId: "request:settlement",
      id: "settlement:1",
      state: "committed",
      chatEventFingerprint: "a".repeat(64),
      workspaceEventId: "workspace:1",
    })).resolves.toMatchObject({ disposition: "applied" });
    await expect(store.settleRequiredSettlement({
      requestId: "request:settlement",
      id: "settlement:1",
      state: "failed",
      failureCode: "CROSS_DOMAIN_SETTLEMENT_FAILED",
    })).resolves.toMatchObject({ disposition: "conflict" });
  });

  it("requires a typed failure code and forbids one on committed settlements", async () => {
    const { store } = await createFixture();
    const requestId = "request:settlement-failure-code";
    await store.claimRequest({
      requestId,
      turnId: "turn:settlement-failure-code",
      inputFingerprint: "input:settlement-failure-code",
    });
    await store.bindRequest({
      requestId,
      sessionId: "session:settlement-failure-code",
      userMessageId: "message:user",
    });
    await store.beginAttempt({ requestId, attempt: 1 });
    await store.beginRequiredSettlement({
      requestId,
      id: "settlement:failed",
      attempt: 1,
      sourceSequence: 1,
      targetState: "failed",
      requiredDomains: ["chat"],
      preparedChatEventFingerprint: "c".repeat(64),
    });
    await store.beginRequiredSettlement({
      requestId,
      id: "settlement:committed",
      attempt: 1,
      sourceSequence: 2,
      targetState: "paused",
      requiredDomains: ["chat"],
      preparedChatEventFingerprint: "d".repeat(64),
    });

    await expect(store.settleRequiredSettlement({
      requestId,
      id: "settlement:failed",
      state: "failed",
    } as never)).resolves.toMatchObject({ disposition: "conflict" });
    await expect(store.settleRequiredSettlement({
      requestId,
      id: "settlement:failed",
      state: "failed",
      failureCode: "UNCLASSIFIED_FAILURE",
    } as never)).resolves.toMatchObject({ disposition: "conflict" });
    await expect(store.settleRequiredSettlement({
      requestId,
      id: "settlement:failed",
      state: "failed",
      failureCode: "CHAT_SETTLEMENT_FAILED",
    })).resolves.toMatchObject({ disposition: "applied" });
    await expect(store.settleRequiredSettlement({
      requestId,
      id: "settlement:failed",
      state: "failed",
      failureCode: "CHAT_SETTLEMENT_FAILED",
    })).resolves.toMatchObject({ disposition: "duplicate" });

    await expect(store.settleRequiredSettlement({
      requestId,
      id: "settlement:committed",
      state: "committed",
      chatEventFingerprint: "d".repeat(64),
      failureCode: "CHAT_SETTLEMENT_FAILED",
    } as never)).resolves.toMatchObject({ disposition: "conflict" });
  });

  it.each(["failed", "canceled"] as const)(
    "rejects assistant acceptance after a committed %s settlement",
    async (targetState) => {
      const { store } = await createFixture();
      const requestId = `request:accept-after-${targetState}`;
      const turnId = `turn:accept-after-${targetState}`;
      await store.claimRequest({ requestId, turnId, inputFingerprint: "input:terminal" });
      await store.beginAttempt({ requestId, attempt: 1 });
      await store.beginRequiredSettlement({
        requestId,
        id: `settlement:${targetState}`,
        attempt: 1,
        sourceSequence: 1,
        targetState,
        requiredDomains: ["chat"],
        preparedChatEventFingerprint: "f".repeat(64),
      });
      await store.settleRequiredSettlement({
        requestId,
        id: `settlement:${targetState}`,
        state: "committed",
        chatEventFingerprint: "f".repeat(64),
      });

      await expect(store.acceptAssistant({
        requestId,
        attempt: 1,
        persistedMessage: {
          id: `message:assistant:${targetState}`,
          role: "assistant",
          requestId,
          turnId,
          content: "must not coexist with a terminal settlement",
          turnSettlementStatus: "succeeded",
        },
      })).resolves.toMatchObject({ disposition: "conflict" });
      await expect(store.getRequest(requestId)).resolves.toMatchObject({
        attempts: [expect.objectContaining({ attempt: 1, state: "active" })],
      });
    },
  );

  it.each(["interrupted", "superseded", "newer"] as const)(
    "rejects a new required settlement commit after the owning attempt is %s",
    async (invalidation) => {
      const { store } = await createFixture();
      const requestId = `request:commit-after-${invalidation}`;
      const turnId = `turn:commit-after-${invalidation}`;
      await store.claimRequest({ requestId, turnId, inputFingerprint: "input:stale" });
      await store.beginAttempt({ requestId, attempt: 1 });
      await store.beginRequiredSettlement({
        requestId,
        id: `settlement:${invalidation}`,
        attempt: 1,
        sourceSequence: 1,
        targetState: "waiting_for_input",
        requiredDomains: ["chat"],
        preparedChatEventFingerprint: "1".repeat(64),
      });

      await store.settleAttempt({
        requestId,
        attempt: 1,
        state: invalidation === "newer" ? "interrupted" : invalidation,
        ...(invalidation === "superseded" ? { supersedesAttempt: 1 } : {}),
      });
      if (invalidation === "newer") {
        await store.beginAttempt({ requestId, attempt: 2 });
      }

      await expect(store.settleRequiredSettlement({
        requestId,
        id: `settlement:${invalidation}`,
        state: "committed",
        chatEventFingerprint: "1".repeat(64),
      })).resolves.toMatchObject({ disposition: "conflict" });
      await expect(store.getRequest(requestId)).resolves.toMatchObject({
        requiredSettlements: [expect.objectContaining({ state: "preparing" })],
      });
    },
  );

  it("rejects both commit and failure from a synthetic preparing journal after acceptance", async () => {
    const { configDir, store } = await createFixture();
    const requestId = "request:accepted-with-preparing";
    const turnId = "turn:accepted-with-preparing";
    await store.claimRequest({
      requestId,
      turnId,
      inputFingerprint: "input:accepted-with-preparing",
    });
    await store.beginAttempt({ requestId, attempt: 1 });
    await store.acceptAssistant({
      requestId,
      attempt: 1,
      persistedMessage: {
        id: "message:assistant:accepted-with-preparing",
        role: "assistant",
        requestId,
        turnId,
        content: "already accepted",
        turnSettlementStatus: "succeeded",
      },
    });
    const statePath = path.join(configDir, "conversation-causal", "state.json");
    const diskState = JSON.parse(await readFile(statePath, "utf8")) as {
      records: Array<{
        revision: number;
        requiredSettlements?: Array<Record<string, unknown>>;
        updatedAt: string;
      }>;
    };
    const record = diskState.records[0]!;
    record.revision += 1;
    record.requiredSettlements = [{
      id: "settlement:synthetic-preparing",
      attempt: 1,
      sourceSequence: 2,
      targetState: "paused",
      requiredDomains: ["chat"],
      preparedChatEventFingerprint: "5".repeat(64),
      state: "preparing",
      createdAt: "2026-08-18T00:02:00.000Z",
      updatedAt: "2026-08-18T00:02:00.000Z",
    }];
    record.updatedAt = "2026-08-18T00:02:00.000Z";
    await writeFile(statePath, `${JSON.stringify(diskState, null, 2)}\n`, "utf8");
    const reopened = createConversationCausalStore({ configDir });

    await expect(reopened.settleRequiredSettlement({
      requestId,
      id: "settlement:synthetic-preparing",
      state: "committed",
      chatEventFingerprint: "5".repeat(64),
    })).resolves.toMatchObject({ disposition: "conflict" });
    await expect(reopened.settleRequiredSettlement({
      requestId,
      id: "settlement:synthetic-preparing",
      state: "failed",
      failureCode: "CHAT_SETTLEMENT_FAILED",
    })).resolves.toMatchObject({ disposition: "conflict" });
    await expect(reopened.getRequest(requestId)).resolves.toMatchObject({
      attempts: [expect.objectContaining({ state: "accepted" })],
      requiredSettlements: [expect.objectContaining({ state: "preparing" })],
    });
  });

  it("keeps an exact committed settlement replay idempotent after attempt invalidation", async () => {
    const { store } = await createFixture();
    const requestId = "request:committed-replay-after-interrupt";
    await store.claimRequest({
      requestId,
      turnId: "turn:committed-replay-after-interrupt",
      inputFingerprint: "input:committed-replay",
    });
    await store.beginAttempt({ requestId, attempt: 1 });
    await store.beginRequiredSettlement({
      requestId,
      id: "settlement:committed-replay",
      attempt: 1,
      sourceSequence: 1,
      targetState: "waiting_for_input",
      requiredDomains: ["chat"],
      preparedChatEventFingerprint: "2".repeat(64),
    });
    await store.settleRequiredSettlement({
      requestId,
      id: "settlement:committed-replay",
      state: "committed",
      chatEventFingerprint: "2".repeat(64),
    });
    await store.settleAttempt({ requestId, attempt: 1, state: "interrupted" });

    await expect(store.settleRequiredSettlement({
      requestId,
      id: "settlement:committed-replay",
      state: "committed",
      chatEventFingerprint: "2".repeat(64),
    })).resolves.toMatchObject({ disposition: "duplicate" });
  });

  it.each([
    "waiting_for_input",
    "waiting_for_approval",
    "checkpoint_boundary",
    "paused",
    "failed",
    "canceled",
  ] as const)(
    "treats an unresolved or failed %s settlement as an acceptance fence",
    async (targetState) => {
      const { store } = await createFixture();
      const requestId = `request:failed-fence:${targetState}`;
      const turnId = `turn:failed-fence:${targetState}`;
      const persistedMessage = {
        id: `message:assistant:${targetState}`,
        role: "assistant" as const,
        requestId,
        turnId,
        content: "must remain read-only",
        turnSettlementStatus: "succeeded" as const,
      };
      await store.claimRequest({ requestId, turnId, inputFingerprint: "input:fence" });
      await store.beginAttempt({ requestId, attempt: 1 });
      await store.beginRequiredSettlement({
        requestId,
        id: `settlement:${targetState}`,
        attempt: 1,
        sourceSequence: 1,
        targetState,
        requiredDomains: ["chat"],
        preparedChatEventFingerprint: "3".repeat(64),
      });

      await expect(store.acceptAssistant({
        requestId,
        attempt: 1,
        persistedMessage,
      })).resolves.toMatchObject({ disposition: "conflict" });
      await expect(store.settleRequiredSettlement({
        requestId,
        id: `settlement:${targetState}`,
        state: "failed",
        failureCode: "CHAT_SETTLEMENT_FAILED",
      })).resolves.toMatchObject({ disposition: "applied" });
      await expect(store.acceptAssistant({
        requestId,
        attempt: 1,
        persistedMessage,
      })).resolves.toMatchObject({ disposition: "conflict" });
      await expect(store.reconcileAssistant({
        requestId,
        attempt: 1,
        causalAttemptId: createConversationCausalAttemptId({
          requestId,
          turnId,
          attempt: 1,
        }),
        persistedMessage,
      })).resolves.toMatchObject({ disposition: "conflict" });
      await expect(store.getRequest(requestId)).resolves.toMatchObject({
        attempts: [expect.objectContaining({ attempt: 1, state: "active" })],
        requiredSettlements: [expect.objectContaining({
          attempt: 1,
          targetState,
          state: "failed",
        })],
      });
    },
  );

  it("creates an AgentRun owning admission and causal ref atomically", async () => {
    const { store } = await createFixture();
    await store.claimRequest({
      requestId: "request:agent-run",
      turnId: "turn:agent-run",
      inputFingerprint: "input:agent-run",
    });

    const admitted = await store.admitAgentRun({
      requestId: "request:agent-run",
      runId: "run:owned",
      taskId: "task:1",
      sessionId: "session:1",
    });
    expect(admitted).toMatchObject({ disposition: "applied" });
    expect(admitted.value?.agentRunAdmissions).toEqual([
      expect.objectContaining({
        runId: "run:owned",
        executionRevision: 1,
        state: "admitted",
      }),
    ]);
    expect(admitted.value?.refs).toContainEqual({ kind: "agent_run", id: "run:owned" });

    await expect(store.settleAgentRunAdmission({
      requestId: "request:agent-run",
      runId: "run:owned",
      expectedExecutionRevision: 1,
      state: "started",
    })).resolves.toMatchObject({ disposition: "applied" });
    await expect(store.settleAgentRunAdmission({
      requestId: "request:agent-run",
      runId: "run:owned",
      expectedExecutionRevision: 1,
      state: "settled",
      finalStatus: "failed",
    })).resolves.toMatchObject({ disposition: "applied" });
  });

  it("fences paused AgentRun resume by a monotonic execution revision", async () => {
    const { store } = await createFixture();
    await store.claimRequest({
      requestId: "request:resume",
      turnId: "turn:resume",
      inputFingerprint: "input:resume",
    });
    await store.admitAgentRun({
      requestId: "request:resume",
      runId: "run:resume",
      taskId: "task:resume",
    });
    await store.settleAgentRunAdmission({
      requestId: "request:resume",
      runId: "run:resume",
      expectedExecutionRevision: 1,
      state: "started",
    });
    await store.settleAgentRunAdmission({
      requestId: "request:resume",
      runId: "run:resume",
      expectedExecutionRevision: 1,
      state: "settled",
      finalStatus: "paused",
    });

    const executionEnvelopeFingerprint = "a".repeat(64);
    await expect(store.beginAgentRunResume({
      runId: "run:resume",
      taskId: "task:resume",
      executionEnvelopeFingerprint,
    })).resolves.toEqual({
      disposition: "applied",
      value: {
        requestId: "request:resume",
        runId: "run:resume",
        taskId: "task:resume",
        executionRevision: 2,
        executionEnvelopeFingerprint,
      },
    });
    await expect(store.getRequest("request:resume")).resolves.toMatchObject({
      agentRunAdmissions: [{
        executionRevision: 2,
        executionEnvelopeFingerprint,
        state: "started",
      }],
    });
    await expect(store.beginAgentRunResume({
      runId: "run:resume",
      taskId: "task:resume",
      executionEnvelopeFingerprint,
    })).resolves.toMatchObject({ disposition: "conflict" });
    await expect(store.settleAgentRunAdmission({
      requestId: "request:resume",
      runId: "run:resume",
      expectedExecutionRevision: 1,
      state: "settled",
      finalStatus: "failed",
    })).resolves.toMatchObject({ disposition: "conflict" });
    await expect(store.settleAgentRunAdmission({
      requestId: "request:resume",
      runId: "run:resume",
      expectedExecutionRevision: 2,
      state: "settled",
      finalStatus: "succeeded",
    })).resolves.toMatchObject({ disposition: "applied" });
  });

  it("reconciles only exact owner revisions and aborts missing or gapped startup leases", async () => {
    const { store } = await createFixture();
    for (const suffix of [
      "owner",
      "missing",
      "missing-started",
      "historical",
    ] as const) {
      await store.claimRequest({
        requestId: `request:${suffix}`,
        turnId: `turn:${suffix}`,
        inputFingerprint: `input:${suffix}`,
      });
      await store.admitAgentRun({
        requestId: `request:${suffix}`,
        runId: `run:${suffix}`,
        taskId: `task:${suffix}`,
      });
    }
    await store.settleAgentRunAdmission({
      requestId: "request:owner",
      runId: "run:owner",
      expectedExecutionRevision: 1,
      state: "started",
    });
    await store.settleAgentRunAdmission({
      requestId: "request:missing-started",
      runId: "run:missing-started",
      expectedExecutionRevision: 1,
      state: "started",
    });
    await store.settleAgentRunAdmission({
      requestId: "request:historical",
      runId: "run:historical",
      expectedExecutionRevision: 1,
      state: "started",
    });
    await store.settleAgentRunAdmission({
      requestId: "request:historical",
      runId: "run:historical",
      expectedExecutionRevision: 1,
      state: "settled",
      finalStatus: "paused",
    });

    await expect(store.reconcileAgentRunAdmissions(new Map([
      ["run:owner", {
        runId: "run:owner",
        taskId: "task:owner",
        executionRevision: 1,
        status: "failed" as const,
      }],
      ["run:historical", {
        runId: "run:historical",
        taskId: "task:historical",
        executionRevision: 2,
        status: "succeeded" as const,
      }],
    ]))).resolves.toEqual({ reconciled: 4, settled: 1, aborted: 3 });

    await expect(store.getRequest("request:owner")).resolves.toMatchObject({
      agentRunAdmissions: [{
        runId: "run:owner",
        executionRevision: 1,
        state: "settled",
        finalStatus: "failed",
      }],
    });
    await expect(store.getRequest("request:missing")).resolves.toMatchObject({
      agentRunAdmissions: [{
        runId: "run:missing",
        executionRevision: 1,
        state: "aborted",
        failureCode: "AGENT_RUN_OWNER_MISSING",
      }],
    });
    await expect(store.getRequest("request:missing-started")).resolves.toMatchObject({
      agentRunAdmissions: [{
        runId: "run:missing-started",
        executionRevision: 1,
        state: "aborted",
        failureCode: "AGENT_RUN_OWNER_MISSING",
      }],
    });
    await expect(store.getRequest("request:historical")).resolves.toMatchObject({
      agentRunAdmissions: [{
        runId: "run:historical",
        executionRevision: 1,
        state: "aborted",
        failureCode: "AGENT_RUN_REVISION_GAP",
      }],
    });
    await expect(store.beginAgentRunResume({
      runId: "run:historical",
      taskId: "task:historical",
      executionEnvelopeFingerprint: "b".repeat(64),
    })).resolves.toMatchObject({ disposition: "conflict" });
    await expect(store.reconcileAgentRunAdmissions(new Map()))
      .resolves.toEqual({ reconciled: 0, settled: 0, aborted: 0 });
  });

  it.each(["succeeded", "paused", "failed", "canceled"] as const)(
    "reconciles the next %s owner only after its exact revision lease was admitted",
    async (status) => {
      const { store } = await createFixture();
      const requestId = `request:continuous:${status}`;
      const runId = `run:continuous:${status}`;
      const taskId = `task:continuous:${status}`;
      await store.claimRequest({
        requestId,
        turnId: `turn:continuous:${status}`,
        inputFingerprint: `input:continuous:${status}`,
      });
      await store.admitAgentRun({ requestId, runId, taskId });
      await store.settleAgentRunAdmission({
        requestId,
        runId,
        expectedExecutionRevision: 1,
        state: "started",
      });
      await store.settleAgentRunAdmission({
        requestId,
        runId,
        expectedExecutionRevision: 1,
        state: "settled",
        finalStatus: "paused",
      });
      await store.beginAgentRunResume({
        runId,
        taskId,
        executionEnvelopeFingerprint: "c".repeat(64),
      });

      await expect(store.reconcileAgentRunAdmissions(new Map([[runId, {
        runId,
        taskId,
        executionRevision: 2,
        status,
      }]]))).resolves.toEqual({ reconciled: 1, settled: 1, aborted: 0 });
      await expect(store.getRequest(requestId)).resolves.toMatchObject({
        agentRunAdmissions: [{
          executionRevision: 2,
          state: "settled",
          finalStatus: status,
        }],
      });
    },
  );

  it("fails closed when a settled paused lease loses or conflicts with its exact owner", async () => {
    const { store } = await createFixture();
    for (const suffix of ["missing", "conflict"] as const) {
      const requestId = `request:paused-owner-${suffix}`;
      const runId = `run:paused-owner-${suffix}`;
      await store.claimRequest({
        requestId,
        turnId: `turn:paused-owner-${suffix}`,
        inputFingerprint: `input:paused-owner-${suffix}`,
      });
      await store.admitAgentRun({ requestId, runId, taskId: `task:${suffix}` });
      await store.settleAgentRunAdmission({
        requestId,
        runId,
        expectedExecutionRevision: 1,
        state: "started",
      });
      await store.settleAgentRunAdmission({
        requestId,
        runId,
        expectedExecutionRevision: 1,
        state: "settled",
        finalStatus: "paused",
      });
    }

    await expect(store.reconcileAgentRunAdmissions(new Map([["run:paused-owner-conflict", {
      runId: "run:paused-owner-conflict",
      taskId: "task:conflict",
      executionRevision: 1,
      status: "succeeded",
    }]]))).resolves.toEqual({ reconciled: 2, settled: 0, aborted: 2 });
    await expect(store.getRequest("request:paused-owner-missing")).resolves.toMatchObject({
      agentRunAdmissions: [{
        state: "aborted",
        failureCode: "AGENT_RUN_OWNER_MISSING",
      }],
    });
    await expect(store.getRequest("request:paused-owner-conflict")).resolves.toMatchObject({
      agentRunAdmissions: [{
        state: "aborted",
        failureCode: "AGENT_RUN_OWNER_CONFLICT",
      }],
    });
  });

  it("reconciles an interrupted attempt only from its exact persisted assistant witness", async () => {
    const { store } = await createFixture();
    const requestId = "request:assistant-reconcile";
    const turnId = "turn:assistant-reconcile";
    await store.claimRequest({ requestId, turnId, inputFingerprint: "input:assistant" });
    await store.bindRequest({
      requestId,
      sessionId: "session:assistant",
      userMessageId: "message:user",
    });
    await store.beginAttempt({ requestId, attempt: 1 });
    await store.settleAttempt({ requestId, attempt: 1, state: "interrupted" });
    const causalAttemptId = createConversationCausalAttemptId({
      requestId,
      turnId,
      attempt: 1,
    });

    await expect(store.reconcileAssistant({
      requestId,
      attempt: 1,
      causalAttemptId: `${causalAttemptId}:wrong`,
      persistedMessage: {
        id: "message:assistant",
        role: "assistant",
        requestId,
        turnId,
        content: "durable answer",
        turnSettlementStatus: "succeeded",
      },
    })).resolves.toMatchObject({ disposition: "conflict" });

    await expect(store.reconcileAssistant({
      requestId,
      attempt: 1,
      causalAttemptId,
      persistedMessage: {
        id: "message:assistant",
        role: "assistant",
        requestId,
        turnId,
        content: "durable answer",
        turnSettlementStatus: "succeeded",
      },
    })).resolves.toMatchObject({ disposition: "applied" });
    await expect(store.getRequest(requestId)).resolves.toMatchObject({
      attempts: [expect.objectContaining({
        attempt: 1,
        state: "accepted",
        acceptedSettlement: expect.objectContaining({
          acceptedMessageId: "message:assistant",
        }),
      })],
    });
  });

  it("rejects reconciliation for an older attempt after a newer attempt exists", async () => {
    const { store } = await createFixture();
    const requestId = "request:assistant-old-attempt";
    const turnId = "turn:assistant-old-attempt";
    await store.claimRequest({ requestId, turnId, inputFingerprint: "input:assistant" });
    await store.bindRequest({
      requestId,
      sessionId: "session:assistant",
      userMessageId: "message:user",
    });
    await store.beginAttempt({ requestId, attempt: 1 });
    await store.settleAttempt({ requestId, attempt: 1, state: "interrupted" });
    await store.beginAttempt({ requestId, attempt: 2 });

    await expect(store.reconcileAssistant({
      requestId,
      attempt: 1,
      causalAttemptId: createConversationCausalAttemptId({
        requestId,
        turnId,
        attempt: 1,
      }),
      persistedMessage: {
        id: "message:assistant:old",
        role: "assistant",
        requestId,
        turnId,
        content: "stale durable answer",
        turnSettlementStatus: "succeeded",
      },
    })).resolves.toMatchObject({ disposition: "conflict" });
    await expect(store.getRequest(requestId)).resolves.toMatchObject({
      attempts: [
        expect.objectContaining({ attempt: 1, state: "interrupted" }),
        expect.objectContaining({ attempt: 2, state: "active" }),
      ],
    });
  });

  it.each(["failed", "canceled"] as const)(
    "rejects assistant reconciliation after a committed %s settlement",
    async (targetState) => {
      const { store } = await createFixture();
      const requestId = `request:assistant-terminal:${targetState}`;
      const turnId = `turn:assistant-terminal:${targetState}`;
      await store.claimRequest({ requestId, turnId, inputFingerprint: "input:assistant" });
      await store.bindRequest({
        requestId,
        sessionId: "session:assistant",
        userMessageId: "message:user",
      });
      await store.beginAttempt({ requestId, attempt: 1 });
      await store.beginRequiredSettlement({
        requestId,
        id: `settlement:${targetState}`,
        attempt: 1,
        sourceSequence: 1,
        targetState,
        requiredDomains: ["chat"],
        preparedChatEventFingerprint: "e".repeat(64),
      });
      await store.settleRequiredSettlement({
        requestId,
        id: `settlement:${targetState}`,
        state: "committed",
        chatEventFingerprint: "e".repeat(64),
      });

      await expect(store.reconcileAssistant({
        requestId,
        attempt: 1,
        causalAttemptId: createConversationCausalAttemptId({ requestId, turnId, attempt: 1 }),
        persistedMessage: {
          id: `message:assistant:${targetState}`,
          role: "assistant",
          requestId,
          turnId,
          content: "must not revive",
          turnSettlementStatus: "succeeded",
        },
      })).resolves.toMatchObject({ disposition: "conflict" });
      await expect(store.getRequest(requestId)).resolves.toMatchObject({
        attempts: [expect.objectContaining({ attempt: 1, state: "active" })],
      });
    },
  );

  it("creates and links an approval intent atomically with exact duplicate semantics", async () => {
    const { store } = await createFixture();
    const requestId = "request:approval-link";
    await store.claimRequest({
      requestId,
      turnId: "turn:approval-link",
      inputFingerprint: "input:approval-link",
    });
    const intent: ToolApprovalIntent = {
      ...approvalIntent("approval:linked", "epoch:linked"),
      causalRef: {
        ...approvalIntent("approval:linked", "epoch:linked").causalRef,
        requestId,
      },
    };

    await expect(store.createApprovalIntentAndLink({ requestId, intent }))
      .resolves.toMatchObject({
        disposition: "applied",
        value: {
          intent: expect.objectContaining({ id: "approval:linked" }),
          request: expect.objectContaining({
            refs: expect.arrayContaining([{ kind: "approval", id: "approval:linked" }]),
          }),
        },
      });
    await expect(store.createApprovalIntentAndLink({ requestId, intent }))
      .resolves.toMatchObject({ disposition: "duplicate" });
    await expect(store.createApprovalIntentAndLink({
      requestId,
      intent: { ...intent, toolName: "file_write" },
    })).resolves.toMatchObject({ disposition: "conflict" });
    await expect(store.getApprovalIntent("approval:linked")).resolves.toMatchObject({
      causalRef: { requestId },
    });

    const listed = await store.listRequests();
    expect(listed).toEqual([
      expect.objectContaining({
        requestId,
        refs: [{ kind: "approval", id: "approval:linked" }],
      }),
    ]);
    listed[0]!.refs.length = 0;
    await expect(store.listRequests()).resolves.toEqual([
      expect.objectContaining({
        requestId,
        refs: [{ kind: "approval", id: "approval:linked" }],
      }),
    ]);
  });

  it("serializes racing opposite approval decisions to one terminal outcome", async () => {
    const { store } = await createFixture();
    await store.createApprovalIntent(approvalIntent("approval:race", "epoch:1"));
    const results = await Promise.all([
      store.decideApproval({
        id: "approval:race",
        expectedRevision: 1,
        decision: {
          decisionId: "decision:yes",
          outcome: "approved",
          automatic: false,
          reasonCode: "user_approved",
          decidedAt: "2026-08-18T00:02:00.000Z",
        },
      }),
      store.decideApproval({
        id: "approval:race",
        expectedRevision: 1,
        decision: {
          decisionId: "decision:no",
          outcome: "denied",
          automatic: false,
          reasonCode: "user_denied",
          decidedAt: "2026-08-18T00:02:00.000Z",
        },
      }),
    ]);
    expect(results.map((result) => result.disposition).sort()).toEqual([
      "applied",
      "conflict",
    ]);
  });
});

function approvalIntent(id: string, ownerProcessEpoch: string): ToolApprovalIntent {
  return {
    schemaVersion: CONVERSATION_CAUSAL_SCHEMA_VERSION,
    id,
    revision: 1,
    state: "pending",
    requestFingerprint: `fingerprint:${id}`,
    taskId: "task:1",
    taskName: "Task",
    toolName: "shell_exec",
    safeArgsSummary: { command: "npm test" },
    risk: {
      level: "normal",
      category: "none",
      requiresConfirmation: false,
    },
    causalRef: { toolInvocationId: "tool:1", toolInvocationRunId: "run:1" },
    ownerProcessEpoch,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    expiresAt: "2026-08-18T00:01:00.000Z",
  };
}
