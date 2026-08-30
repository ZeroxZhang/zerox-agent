import type { ChatTaskStatusEvent } from "../shared/chat";
import type {
  ConversationCausalRecord,
  ConversationRequiredSettlement,
} from "../shared/conversationCausalSpine";
import type { ConversationCausalStore } from "./conversationCausalStore";
import type { ChatSessionStore } from "./chatSessionStore";
import {
  createRequiredChatEventFingerprint,
  createWorkspaceStatusEventId,
  toWorkspaceRunEventInput,
  toWorkspaceRunStatus,
} from "./chatService";
import type { WorkspaceRunStore } from "./workspaceRunStore";

export type ConversationSettlementReconciliationResult = Readonly<{
  scanned: number;
  committed: number;
  failed: number;
  unchanged: number;
}>;

type ReconciliationCausalStore = Pick<
  ConversationCausalStore,
  "listRequests" | "settleRequiredSettlement" | "addRefs"
>;

/**
 * Reconciles every unresolved required settlement before runtime admission.
 * Sink facts remain authoritative; this coordinator only commits exact
 * deterministic receipts or writes a secret-safe recovery tombstone.
 */
export async function reconcileRequiredConversationSettlements(options: {
  conversationCausalStore: ReconciliationCausalStore;
  chatSessionStore: Pick<ChatSessionStore, "get" | "appendActivityEvent">;
  workspaceRunStore: Pick<
    WorkspaceRunStore,
    "getRun" | "settleLifecycle"
  >;
  now?: () => Date;
}): Promise<ConversationSettlementReconciliationResult> {
  const now = options.now ?? (() => new Date());
  let scanned = 0;
  let committed = 0;
  let failed = 0;
  let unchanged = 0;

  const records = await options.conversationCausalStore.listRequests();
  for (const record of records) {
    for (const settlement of record.requiredSettlements ?? []) {
      if (settlement.state === "committed") {
        if (isCommittedProcessingGuidedInput(settlement)) {
          scanned += 1;
          if (owningAttemptWasAccepted(record, settlement)) {
            unchanged += 1;
            continue;
          }
          await failAndCompensateSettlement(options, record, settlement, now);
          failed += 1;
          continue;
        }
        unchanged += 1;
        continue;
      }
      scanned += 1;
      if (
        settlement.state === "preparing"
        && await reconcilePreparingSettlement(options, record, settlement)
      ) {
        committed += 1;
        continue;
      }

      await failAndCompensateSettlement(options, record, settlement, now);
      failed += 1;
    }
  }

  return Object.freeze({ scanned, committed, failed, unchanged });
}

function isCommittedProcessingGuidedInput(
  settlement: ConversationRequiredSettlement,
): boolean {
  return settlement.targetState === "checkpoint_boundary"
    && Boolean(settlement.guidedInputRequestId);
}

function owningAttemptWasAccepted(
  record: ConversationCausalRecord,
  settlement: ConversationRequiredSettlement,
): boolean {
  const attempt = record.attempts.find(
    (candidate) => candidate.attempt === settlement.attempt,
  );
  return attempt?.state === "accepted"
    && attempt.assistantAcceptance?.state === "committed"
    && Boolean(attempt.acceptedSettlement);
}

async function reconcilePreparingSettlement(
  options: {
    conversationCausalStore: ReconciliationCausalStore;
    chatSessionStore: Pick<ChatSessionStore, "get" | "appendActivityEvent">;
    workspaceRunStore: Pick<WorkspaceRunStore, "getRun" | "settleLifecycle">;
  },
  record: ConversationCausalRecord,
  settlement: ConversationRequiredSettlement,
): Promise<boolean> {
  const sessionId = record.sessionId?.trim();
  if (!sessionId || !record.userMessageId?.trim()) return false;
  const session = await options.chatSessionStore.get(sessionId);
  const sourceEvent = session?.activity?.statusEvents.find(
    (event) => event.settlementId === settlement.id,
  );
  if (
    !sourceEvent
    || createRequiredChatEventFingerprint(sourceEvent)
      !== settlement.preparedChatEventFingerprint
  ) {
    return false;
  }

  let workspaceEventId: string | undefined;
  if (settlement.requiredDomains.includes("workspace")) {
    const workspaceRunId = settlement.workspaceRunId?.trim();
    const preparedWorkspaceEventId =
      settlement.preparedWorkspaceEventId?.trim();
    if (!workspaceRunId || !preparedWorkspaceEventId) return false;
    const run = await options.workspaceRunStore.getRun(workspaceRunId);
    const workspaceEvent = toWorkspaceRunEventInput(sourceEvent);
    if (!run || !workspaceEvent) return false;
    try {
      const receipt = await options.workspaceRunStore.settleLifecycle({
        workspaceRunId,
        event: {
          ...workspaceEvent,
          id: preparedWorkspaceEventId,
          createdAt: sourceEvent.createdAt,
          causalRef: {
            turnId: sourceEvent.turnId ?? record.turnId,
            sourceSequence: sourceEvent.sequence ?? settlement.sourceSequence,
          },
        },
        snapshotStatus: toWorkspaceRunStatus(sourceEvent),
        summary: sourceEvent.message,
      });
      if (receipt.event.id !== preparedWorkspaceEventId) return false;
      workspaceEventId = receipt.event.id;
    } catch {
      return false;
    }
  }

  if (workspaceEventId && settlement.workspaceRunId) {
    const refs = await options.conversationCausalStore.addRefs({
      requestId: record.requestId,
      refs: [
        { kind: "workspace_run", id: settlement.workspaceRunId },
        {
          kind: "workspace_event",
          runId: settlement.workspaceRunId,
          eventId: workspaceEventId,
        },
      ],
    });
    if (refs.disposition !== "applied" && refs.disposition !== "duplicate") {
      return false;
    }
  }
  const settled = await options.conversationCausalStore.settleRequiredSettlement({
    requestId: record.requestId,
    id: settlement.id,
    state: "committed",
    chatEventFingerprint: settlement.preparedChatEventFingerprint,
    ...(workspaceEventId ? { workspaceEventId } : {}),
  });
  if (settled.disposition !== "applied" && settled.disposition !== "duplicate") {
    return false;
  }
  return true;
}

async function failAndCompensateSettlement(
  options: {
    conversationCausalStore: ReconciliationCausalStore;
    chatSessionStore: Pick<ChatSessionStore, "get" | "appendActivityEvent">;
    workspaceRunStore: Pick<WorkspaceRunStore, "getRun" | "settleLifecycle">;
  },
  record: ConversationCausalRecord,
  settlement: ConversationRequiredSettlement,
  now: () => Date,
): Promise<void> {
  const sessionId = record.sessionId?.trim();
  let chatCompensated = false;
  let workspaceCompensated = false;
  let recoveryEvent: ChatTaskStatusEvent | undefined;
  let sourceFingerprint: string | undefined;
  let chatRecoveryError: unknown;
  let workspaceRecoveryError: unknown;

  if (sessionId) {
    const session = await options.chatSessionStore.get(sessionId);
    const events = session?.activity?.statusEvents ?? [];
    const source = events.find((event) => event.settlementId === settlement.id);
    const candidateFingerprint = source
      ? createRequiredChatEventFingerprint(source)
      : undefined;
    sourceFingerprint = candidateFingerprint === settlement.preparedChatEventFingerprint
      ? candidateFingerprint
      : undefined;
    const settlementId = `${settlement.id}:startup-recovery`;
    recoveryEvent = events.find((event) => event.settlementId === settlementId)
      ?? createRecoveryEvent({
        record,
        settlement,
        sessionId,
        source,
        sequence: Math.max(
          settlement.sourceSequence,
          ...events
            .filter((event) => event.requestId === record.requestId)
            .map((event) => event.sequence ?? 0),
        ) + 1,
        createdAt: now().toISOString(),
      });
    try {
      const written = await options.chatSessionStore.appendActivityEvent(
        sessionId,
        recoveryEvent,
      );
      chatCompensated = Boolean(written);
      if (!written) {
        chatRecoveryError = new Error(
          `Required settlement Chat recovery returned no receipt: ${record.requestId}/${settlement.id}.`,
        );
      }
    } catch (error) {
      chatRecoveryError = error;
    }
  }

  if (
    recoveryEvent
    && settlement.workspaceRunId
    && settlement.requiredDomains.includes("workspace")
  ) {
    const run = await options.workspaceRunStore.getRun(settlement.workspaceRunId);
    const workspaceEvent = toWorkspaceRunEventInput(recoveryEvent);
    if (run && workspaceEvent) {
      try {
        const receipt = await options.workspaceRunStore.settleLifecycle({
          workspaceRunId: settlement.workspaceRunId,
          event: {
            ...workspaceEvent,
            id: createWorkspaceStatusEventId(recoveryEvent),
            createdAt: recoveryEvent.createdAt,
            causalRef: {
              turnId: recoveryEvent.turnId ?? record.turnId,
              sourceSequence: recoveryEvent.sequence ?? settlement.sourceSequence,
            },
          },
          snapshotStatus: "failed",
          summary: recoveryEvent.message,
        });
        workspaceCompensated = Boolean(receipt.event.id);
      } catch (error) {
        workspaceCompensated = false;
        workspaceRecoveryError = error;
      }
    }
  }

  if (settlement.state === "preparing") {
    const settled = await options.conversationCausalStore.settleRequiredSettlement({
      requestId: record.requestId,
      id: settlement.id,
      state: "failed",
      ...(sourceFingerprint ? { chatEventFingerprint: sourceFingerprint } : {}),
      failureCode: "RECOVERY_INCOMPLETE",
    });
    if (settled.disposition !== "applied" && settled.disposition !== "duplicate") {
      throw new Error(
        `Required settlement recovery could not persist failure: ${record.requestId}/${settlement.id}.`,
      );
    }
  }
  const coverage = await options.conversationCausalStore.addRefs({
    requestId: record.requestId,
    refs: [],
    coverage: {
      state: "degraded",
      reasonCodes: [
        "required_settlement_startup_recovery_incomplete",
        ...(!chatCompensated ? ["required_settlement_chat_recovery_failed"] : []),
        ...(settlement.requiredDomains.includes("workspace") && !workspaceCompensated
          ? ["required_settlement_workspace_recovery_failed"]
          : []),
      ],
    },
  });
  if (coverage.disposition !== "applied" && coverage.disposition !== "duplicate") {
    throw new Error(
      `Required settlement recovery could not persist degraded coverage: ${record.requestId}/${settlement.id}.`,
    );
  }
  if (chatRecoveryError || workspaceRecoveryError) {
    throw new Error(
      `Required settlement recovery could not persist every owned domain: ${record.requestId}/${settlement.id}.`,
      { cause: chatRecoveryError ?? workspaceRecoveryError },
    );
  }
}

function createRecoveryEvent(input: {
  record: ConversationCausalRecord;
  settlement: ConversationRequiredSettlement;
  sessionId: string;
  source?: ChatTaskStatusEvent;
  sequence: number;
  createdAt: string;
}): ChatTaskStatusEvent {
  return {
    sessionId: input.sessionId,
    requestId: input.record.requestId,
    turnId: input.record.turnId,
    sequence: input.sequence,
    settlementId: `${input.settlement.id}:startup-recovery`,
    state: "failed",
    message: "会话状态恢复不完整，已安全终止待处理操作。",
    createdAt: input.createdAt,
    elapsedMs: 0,
    domainStateAvailable: false,
    ...(input.source?.selectedSkillName
      ? { selectedSkillName: input.source.selectedSkillName }
      : {}),
    ...(input.source?.pendingSkillInput
      ? {
          pendingSkillInput: {
            ...input.source.pendingSkillInput,
            status: "failed",
            attachmentPayloads: undefined,
          },
        }
      : {}),
  };
}
