import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatTaskStatusEvent } from "../shared/chat";
import { createConversationCausalAttemptId } from "../shared/conversationCausalSpine";
import { createConversationCausalStore } from "./conversationCausalStore";
import {
  createRequiredChatEventFingerprint,
  createWorkspaceStatusEventId,
  toWorkspaceRunEventInput,
  toWorkspaceRunStatus,
} from "./chatService";
import { createChatSessionStore } from "./chatSessionStore";
import { reconcileRequiredConversationSettlements } from "./conversationSettlementReconciler";
import { createWorkspaceRunStore } from "./workspaceRunStore";

describe("conversation required settlement startup reconciler", () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) =>
      rm(dir, { recursive: true, force: true }),
    ));
  });

  async function setup(requestId: string) {
    const configDir = path.join(os.tmpdir(), `zerox-settlement-${randomUUID()}`);
    tempDirs.push(configDir);
    const causal = createConversationCausalStore({ configDir });
    const chat = createChatSessionStore({ configDir, backend: "json" });
    const workspace = createWorkspaceRunStore({ configDir });
    const appended = await chat.appendMessage({
      sessionId: "session_recovery",
      requestId,
      role: "user",
      content: "recover this turn",
    });
    await causal.claimRequest({
      requestId,
      turnId: `turn-${requestId}`,
      inputFingerprint: "a".repeat(64),
    });
    await causal.bindRequest({
      requestId,
      sessionId: appended.session.id,
      userMessageId: appended.message.id,
    });
    await causal.beginAttempt({ requestId, attempt: 1 });
    const workspaceRunId = `workspace_${requestId}`;
    await workspace.ensureRun({
      workspaceRunId,
      sessionId: appended.session.id,
      requestId,
      status: "running",
      createdAt: "2026-08-24T00:00:00.000Z",
    });
    return {
      configDir,
      causal,
      chat,
      workspace,
      workspaceRunId,
      sessionId: appended.session.id,
    };
  }

  function waitingEvent(
    requestId: string,
    settlementId: string,
    sessionId: string,
  ): ChatTaskStatusEvent {
    return {
      sessionId,
      requestId,
      turnId: `turn-${requestId}`,
      sequence: 1,
      settlementId,
      state: "waiting_for_input",
      message: "Input required.",
      createdAt: "2026-08-24T00:00:01.000Z",
      elapsedMs: 1_000,
      domainStateAvailable: true,
    };
  }

  async function prepare(
    setupResult: Awaited<ReturnType<typeof setup>>,
    requestId: string,
    event: ChatTaskStatusEvent,
  ) {
    const workspaceEventId = createWorkspaceStatusEventId(event);
    const prepared = await setupResult.causal.beginRequiredSettlement({
      requestId,
      id: event.settlementId!,
      attempt: 1,
      sourceSequence: event.sequence!,
      targetState: "waiting_for_input",
      requiredDomains: ["chat", "workspace"],
      workspaceRunId: setupResult.workspaceRunId,
      preparedWorkspaceEventId: workspaceEventId,
      preparedChatEventFingerprint: createRequiredChatEventFingerprint(event),
    });
    expect(prepared.disposition).toBe("applied");
    return workspaceEventId;
  }

  it("replays an exact Chat receipt into Workspace and commits the journal", async () => {
    const requestId = "request_chat_first";
    const stores = await setup(requestId);
    const event = waitingEvent(
      requestId,
      "settlement_chat_first",
      stores.sessionId,
    );
    const workspaceEventId = await prepare(stores, requestId, event);
    await stores.chat.appendActivityEvent(event.sessionId, event);
    const lifecycle: string[] = [];
    const causal = {
      ...stores.causal,
      async addRefs(input: Parameters<typeof stores.causal.addRefs>[0]) {
        lifecycle.push("refs");
        return stores.causal.addRefs(input);
      },
      async settleRequiredSettlement(
        input: Parameters<typeof stores.causal.settleRequiredSettlement>[0],
      ) {
        lifecycle.push("settlement");
        return stores.causal.settleRequiredSettlement(input);
      },
    };

    await expect(reconcileRequiredConversationSettlements({
      conversationCausalStore: causal,
      chatSessionStore: stores.chat,
      workspaceRunStore: stores.workspace,
      now: () => new Date("2026-08-24T00:00:02.000Z"),
    })).resolves.toEqual({ scanned: 1, committed: 1, failed: 0, unchanged: 0 });
    expect(lifecycle).toEqual(["refs", "settlement"]);

    const record = await stores.causal.getRequest(requestId);
    expect(record?.requiredSettlements?.[0]).toMatchObject({
      state: "committed",
      workspaceEventId,
      chatEventFingerprint: createRequiredChatEventFingerprint(event),
    });
    expect(await stores.workspace.getRun(stores.workspaceRunId)).toMatchObject({
      status: "waiting_for_user",
    });
  });

  it("recovers the crash after both sink receipts without rewriting either fact", async () => {
    const requestId = "request_both_sinks";
    const stores = await setup(requestId);
    const event = waitingEvent(
      requestId,
      "settlement_both_sinks",
      stores.sessionId,
    );
    const workspaceEventId = await prepare(stores, requestId, event);
    await stores.chat.appendActivityEvent(event.sessionId, event);
    const workspaceEvent = toWorkspaceRunEventInput(event)!;
    await stores.workspace.settleLifecycle({
      workspaceRunId: stores.workspaceRunId,
      event: {
        ...workspaceEvent,
        id: workspaceEventId,
        createdAt: event.createdAt,
        causalRef: { turnId: event.turnId!, sourceSequence: event.sequence! },
      },
      snapshotStatus: toWorkspaceRunStatus(event),
      summary: event.message,
    });

    const beforeEvents = await stores.workspace.listEvents(stores.workspaceRunId);
    await reconcileRequiredConversationSettlements({
      conversationCausalStore: stores.causal,
      chatSessionStore: stores.chat,
      workspaceRunStore: stores.workspace,
    });
    expect(await stores.workspace.listEvents(stores.workspaceRunId)).toEqual(beforeEvents);
    expect((await stores.causal.getRequest(requestId))?.requiredSettlements?.[0]?.state)
      .toBe("committed");
  });

  it("tombstones a committed guided-input processing claim before renderer restore", async () => {
    const requestId = "request_guided_processing";
    const stores = await setup(requestId);
    const inputRequest = {
      id: "input_guided_processing",
      executionId: "execution_guided_processing",
      sessionId: stores.sessionId,
      requestId,
      skillName: "research",
      reason: "Choose a source.",
      fields: [{
        name: "source",
        label: "Source",
        type: "path" as const,
        required: true,
      }],
      createdAt: "2026-08-24T00:00:01.000Z",
    };
    const event: ChatTaskStatusEvent = {
      sessionId: stores.sessionId,
      requestId,
      turnId: `turn-${requestId}`,
      sequence: 1,
      settlementId: "settlement_guided_processing",
      state: "checkpoint_boundary",
      message: "Skill input execution claimed.",
      createdAt: "2026-08-24T00:00:01.000Z",
      elapsedMs: 1_000,
      domainStateAvailable: true,
      inputRequest,
      pendingSkillInput: {
        inputRequestId: inputRequest.id,
        status: "processing",
        inputRequest,
        sessionId: stores.sessionId,
        requestId,
        userMessage: "research this",
        selectedSkillName: "research",
        partialValues: { source: "/workspace/docs" },
      },
    };
    const fingerprint = createRequiredChatEventFingerprint(event);
    await stores.causal.beginRequiredSettlement({
      requestId,
      id: event.settlementId!,
      attempt: 1,
      sourceSequence: 1,
      targetState: "checkpoint_boundary",
      guidedInputRequestId: inputRequest.id,
      requiredDomains: ["chat"],
      preparedChatEventFingerprint: fingerprint,
    });
    await stores.chat.appendActivityEvent(stores.sessionId, event);
    await stores.causal.settleRequiredSettlement({
      requestId,
      id: event.settlementId!,
      state: "committed",
      chatEventFingerprint: fingerprint,
    });
    for (let sequence = 2; sequence <= 90; sequence += 1) {
      await stores.chat.appendActivityEvent(stores.sessionId, {
        sessionId: stores.sessionId,
        requestId,
        turnId: `turn-${requestId}`,
        sequence,
        state: "started",
        message: `Later bounded activity ${sequence}.`,
        createdAt: new Date(
          Date.parse("2026-08-24T00:00:01.000Z") + sequence,
        ).toISOString(),
        elapsedMs: 1_000 + sequence,
        domainStateAvailable: true,
      });
    }
    expect(
      (await stores.chat.get(stores.sessionId))?.activity?.statusEvents.some(
        (candidate) => candidate.settlementId === event.settlementId,
      ),
    ).toBe(false);

    await expect(reconcileRequiredConversationSettlements({
      conversationCausalStore: stores.causal,
      chatSessionStore: stores.chat,
      workspaceRunStore: stores.workspace,
      now: () => new Date("2026-08-24T00:00:02.000Z"),
    })).resolves.toEqual({ scanned: 1, committed: 0, failed: 1, unchanged: 0 });

    expect((await stores.chat.get(stores.sessionId))?.activity?.statusEvents.at(-1))
      .toMatchObject({
        settlementId: "settlement_guided_processing:startup-recovery",
        state: "failed",
      });
    expect((await stores.causal.getRequest(requestId))?.requiredSettlements?.[0])
      .toMatchObject({ state: "committed" });
    expect((await stores.causal.getRequest(requestId))?.coverage)
      .toMatchObject({
        state: "degraded",
        reasonCodes: expect.arrayContaining([
          "required_settlement_startup_recovery_incomplete",
        ]),
      });
  });

  it("preserves accepted guided-input completion across cold start", async () => {
    const requestId = "request_guided_accepted";
    const stores = await setup(requestId);
    const inputRequest = {
      id: "input_guided_accepted",
      executionId: "execution_guided_accepted",
      sessionId: stores.sessionId,
      requestId,
      skillName: "research",
      reason: "Choose a source.",
      fields: [{
        name: "source",
        label: "Source",
        type: "path" as const,
        required: true,
      }],
      createdAt: "2026-08-24T00:00:01.000Z",
    };
    const event: ChatTaskStatusEvent = {
      sessionId: stores.sessionId,
      requestId,
      turnId: `turn-${requestId}`,
      sequence: 1,
      settlementId: "settlement_guided_accepted",
      state: "checkpoint_boundary",
      message: "Skill input execution claimed.",
      createdAt: "2026-08-24T00:00:01.000Z",
      elapsedMs: 1_000,
      domainStateAvailable: true,
      inputRequest,
      pendingSkillInput: {
        inputRequestId: inputRequest.id,
        status: "processing",
        inputRequest,
        sessionId: stores.sessionId,
        requestId,
        userMessage: "research this",
        selectedSkillName: "research",
        partialValues: { source: "/workspace/docs" },
      },
    };
    const fingerprint = createRequiredChatEventFingerprint(event);
    await stores.causal.beginRequiredSettlement({
      requestId,
      id: event.settlementId!,
      attempt: 1,
      sourceSequence: 1,
      targetState: "checkpoint_boundary",
      guidedInputRequestId: inputRequest.id,
      requiredDomains: ["chat"],
      preparedChatEventFingerprint: fingerprint,
    });
    await stores.chat.appendActivityEvent(stores.sessionId, event);
    await stores.causal.settleRequiredSettlement({
      requestId,
      id: event.settlementId!,
      state: "committed",
      chatEventFingerprint: fingerprint,
    });
    const acceptedMessage = await stores.chat.appendMessage({
      sessionId: stores.sessionId,
      requestId,
      turnId: `turn-${requestId}`,
      role: "assistant",
      content: "Accepted guided-input result.",
      turnSettlementStatus: "succeeded",
    });
    await expect(stores.causal.acceptAssistant({
      requestId,
      attempt: 1,
      persistedMessage: {
        id: acceptedMessage.message.id,
        role: "assistant",
        requestId,
        turnId: `turn-${requestId}`,
        content: acceptedMessage.message.content,
        turnSettlementStatus: "succeeded",
      },
    })).resolves.toMatchObject({ disposition: "applied" });

    await expect(reconcileRequiredConversationSettlements({
      conversationCausalStore: stores.causal,
      chatSessionStore: stores.chat,
      workspaceRunStore: stores.workspace,
      now: () => new Date("2026-08-24T00:00:02.000Z"),
    })).resolves.toEqual({ scanned: 1, committed: 0, failed: 0, unchanged: 1 });

    const record = await stores.causal.getRequest(requestId);
    expect(record?.attempts[0]).toMatchObject({
      state: "accepted",
      assistantAcceptance: { state: "committed" },
    });
    expect(record?.coverage.state).toBe("complete");
    expect(
      (await stores.chat.get(stores.sessionId))?.activity?.statusEvents.some(
        (candidate) =>
          candidate.settlementId ===
            "settlement_guided_accepted:startup-recovery"
          && candidate.state === "failed",
      ),
    ).toBe(false);
  });

  it("fails and tombstones every provable owner when Chat receipt is absent", async () => {
    const requestId = "request_workspace_first";
    const stores = await setup(requestId);
    const event = waitingEvent(
      requestId,
      "settlement_workspace_first",
      stores.sessionId,
    );
    const workspaceEventId = await prepare(stores, requestId, event);
    const workspaceEvent = toWorkspaceRunEventInput(event)!;
    await stores.workspace.settleLifecycle({
      workspaceRunId: stores.workspaceRunId,
      event: {
        ...workspaceEvent,
        id: workspaceEventId,
        createdAt: event.createdAt,
        causalRef: { turnId: event.turnId!, sourceSequence: event.sequence! },
      },
      snapshotStatus: toWorkspaceRunStatus(event),
      summary: event.message,
    });

    await expect(reconcileRequiredConversationSettlements({
      conversationCausalStore: stores.causal,
      chatSessionStore: stores.chat,
      workspaceRunStore: stores.workspace,
      now: () => new Date("2026-08-24T00:00:03.000Z"),
    })).resolves.toEqual({ scanned: 1, committed: 0, failed: 1, unchanged: 0 });

    const record = await stores.causal.getRequest(requestId);
    expect(record?.requiredSettlements?.[0]).toMatchObject({
      state: "failed",
      failureCode: "RECOVERY_INCOMPLETE",
    });
    const chatSession = await stores.chat.get(stores.sessionId);
    expect(chatSession?.activity?.statusEvents.at(-1)).toMatchObject({
      settlementId: "settlement_workspace_first:startup-recovery",
      state: "failed",
      domainStateAvailable: false,
    });
    expect(await stores.workspace.getRun(stores.workspaceRunId)).toMatchObject({
      status: "failed",
    });

    await expect(reconcileRequiredConversationSettlements({
      conversationCausalStore: stores.causal,
      chatSessionStore: stores.chat,
      workspaceRunStore: stores.workspace,
      now: () => new Date("2026-08-24T00:00:04.000Z"),
    })).resolves.toEqual({ scanned: 1, committed: 0, failed: 1, unchanged: 0 });
    expect((await stores.chat.get(stores.sessionId))?.activity?.statusEvents
      .filter((candidate) => candidate.settlementId?.endsWith(":startup-recovery")))
      .toHaveLength(1);
  });

  it("does not revive a stale preparing settlement after its attempt was interrupted", async () => {
    const requestId = "request_stale_preparing";
    const stores = await setup(requestId);
    const event = waitingEvent(
      requestId,
      "settlement_stale_preparing",
      stores.sessionId,
    );
    await prepare(stores, requestId, event);
    await stores.chat.appendActivityEvent(event.sessionId, event);
    await stores.causal.settleAttempt({
      requestId,
      attempt: 1,
      state: "interrupted",
    });

    await expect(reconcileRequiredConversationSettlements({
      conversationCausalStore: stores.causal,
      chatSessionStore: stores.chat,
      workspaceRunStore: stores.workspace,
      now: () => new Date("2026-08-24T00:00:05.000Z"),
    })).resolves.toEqual({ scanned: 1, committed: 0, failed: 1, unchanged: 0 });

    await expect(stores.causal.getRequest(requestId)).resolves.toMatchObject({
      attempts: [expect.objectContaining({ attempt: 1, state: "interrupted" })],
      requiredSettlements: [expect.objectContaining({
        id: "settlement_stale_preparing",
        state: "failed",
        failureCode: "RECOVERY_INCOMPLETE",
      })],
    });
    expect((await stores.chat.get(stores.sessionId))?.activity?.statusEvents.at(-1))
      .toMatchObject({
        settlementId: "settlement_stale_preparing:startup-recovery",
        state: "failed",
      });
    await expect(stores.workspace.getRun(stores.workspaceRunId)).resolves.toMatchObject({
      status: "failed",
    });
  });

  it("keeps a failed settlement as an acceptance fence throughout startup recovery", async () => {
    const requestId = "request_failed_acceptance_fence";
    const stores = await setup(requestId);
    const event = waitingEvent(
      requestId,
      "settlement_failed_acceptance_fence",
      stores.sessionId,
    );
    await prepare(stores, requestId, event);
    await stores.chat.appendActivityEvent(event.sessionId, event);
    await stores.causal.settleRequiredSettlement({
      requestId,
      id: event.settlementId!,
      state: "failed",
      chatEventFingerprint: createRequiredChatEventFingerprint(event),
      failureCode: "WORKSPACE_SETTLEMENT_FAILED",
    });

    await expect(reconcileRequiredConversationSettlements({
      conversationCausalStore: stores.causal,
      chatSessionStore: stores.chat,
      workspaceRunStore: stores.workspace,
      now: () => new Date("2026-08-24T00:00:06.000Z"),
    })).resolves.toEqual({ scanned: 1, committed: 0, failed: 1, unchanged: 0 });

    const persistedMessage = {
      id: "message:startup-fence",
      role: "assistant" as const,
      requestId,
      turnId: `turn-${requestId}`,
      content: "must not be promoted",
      turnSettlementStatus: "succeeded" as const,
    };
    await expect(stores.causal.acceptAssistant({
      requestId,
      attempt: 1,
      persistedMessage,
    })).resolves.toMatchObject({ disposition: "conflict" });
    await expect(stores.causal.reconcileAssistant({
      requestId,
      attempt: 1,
      causalAttemptId: createConversationCausalAttemptId({
        requestId,
        turnId: `turn-${requestId}`,
        attempt: 1,
      }),
      persistedMessage,
    })).resolves.toMatchObject({ disposition: "conflict" });
    await expect(stores.causal.getRequest(requestId)).resolves.toMatchObject({
      attempts: [expect.objectContaining({ attempt: 1, state: "active" })],
      requiredSettlements: [expect.objectContaining({
        state: "failed",
        targetState: "waiting_for_input",
        failureCode: "WORKSPACE_SETTLEMENT_FAILED",
      })],
    });
  });

  it("fails startup on a synthetic accepted-plus-preparing state without degrading authority", async () => {
    const requestId = "request_startup_accepted_preparing";
    const stores = await setup(requestId);
    await stores.causal.acceptAssistant({
      requestId,
      attempt: 1,
      persistedMessage: {
        id: "message:startup-accepted",
        role: "assistant",
        requestId,
        turnId: `turn-${requestId}`,
        content: "already accepted",
        turnSettlementStatus: "succeeded",
      },
    });
    const statePath = path.join(stores.configDir, "conversation-causal", "state.json");
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
      id: "settlement:startup-accepted-preparing",
      attempt: 1,
      sourceSequence: 1,
      targetState: "paused",
      requiredDomains: ["chat"],
      preparedChatEventFingerprint: "6".repeat(64),
      state: "preparing",
      createdAt: "2026-08-24T00:00:06.000Z",
      updatedAt: "2026-08-24T00:00:06.000Z",
    }];
    record.updatedAt = "2026-08-24T00:00:06.000Z";
    await writeFile(statePath, `${JSON.stringify(diskState, null, 2)}\n`, "utf8");
    const reopened = createConversationCausalStore({ configDir: stores.configDir });

    await expect(reconcileRequiredConversationSettlements({
      conversationCausalStore: reopened,
      chatSessionStore: stores.chat,
      workspaceRunStore: stores.workspace,
      now: () => new Date("2026-08-24T00:00:07.000Z"),
    })).rejects.toThrow("Required settlement recovery could not persist failure");
    await expect(reopened.getRequest(requestId)).resolves.toMatchObject({
      attempts: [expect.objectContaining({ state: "accepted" })],
      requiredSettlements: [expect.objectContaining({ state: "preparing" })],
      coverage: { state: "complete", reasonCodes: [] },
    });
  });

  it("rejects startup when the causal authority cannot persist recovery", async () => {
    const requestId = "request_recovery_authority_failure";
    const stores = await setup(requestId);
    const event = waitingEvent(
      requestId,
      "settlement_recovery_authority_failure",
      stores.sessionId,
    );
    await prepare(stores, requestId, event);

    await expect(reconcileRequiredConversationSettlements({
      conversationCausalStore: {
        ...stores.causal,
        async settleRequiredSettlement() {
          throw new Error("causal authority unavailable");
        },
      },
      chatSessionStore: stores.chat,
      workspaceRunStore: stores.workspace,
    })).rejects.toThrow("causal authority unavailable");
  });
});
