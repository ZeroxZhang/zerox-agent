import { createChatOutputAssembler } from "../chatOutputAssembler";
import { resolveSkillInput } from "../skillExecutionService";
import { appendChatAttachmentContext } from "../chatAttachmentProcessor";
import { ChatAttachmentValidationError } from "../chatAttachmentProcessor";
import { processChatAttachments } from "../chatAttachmentProcessor";
import { ProcessedChatAttachments } from "../chatAttachmentProcessor";
import { RequiredConversationSettlementError } from "../chatService";
import { SecretSafeFailureError } from "../../shared/secretSafeFailure";
import { createPendingSkillInputState } from "./modulemessages";
import { createSkillUserInputRequest } from "./modulemessages";
import { SkillInputResponseResult } from "../../shared/chat";
import { SkillInputResponse } from "../../shared/chat";
import { createLegacyChatRequestClaimFingerprint } from "../chatService";
import { CONVERSATION_REQUEST_FINGERPRINT_VERSION } from "../../shared/conversationCausalSpine";
import { createChatRequestClaimFingerprint } from "../chatService";
import { ChatRequestClaim } from "../chatService";
import { SendChatMessageResult } from "../../shared/chat";
import { PreparedChatMessageInput } from "../chatService";
import { SendChatMessageRuntimeOptions } from "../chatService";
import { SendChatMessageInput } from "../../shared/chat";
import { toRequiredSettlementTarget } from "./kernelSettlement";
import { createRequiredSettlementId } from "./kernelSettlement";
import { persistRequiredConversationSettlement } from "./modulesettlement";
import { ChatWorkspaceRunRecorder } from "./modulesettlement";
import { ChatTaskStatusEvent } from "../../shared/chat";
import { toInMemoryPendingSkillInputState } from "./modulemessages";
import { resolveRequestedSkill } from "./modulemessages";
import { findPersistedPendingSkillInputState } from "./modulemessages";
import { createRequiredChatEventFingerprint } from "./kernelSettlement";
import { resolveDurableConversationBinding } from "../../shared/conversationCausalSpine";
import { SkillPendingInputState } from "../../shared/chat";
import { matchesAttachmentMetadata } from "./modulemessages";
import { ChatAttachmentMetadata } from "../../shared/chat";
import { toHistoryAttachmentCacheKey } from "./modulemessages";
import { ChatAttachmentInput } from "../../shared/chat";
import { PENDING_ATTACHMENT_PAYLOAD_TTL_MS, PENDING_ATTACHMENT_PAYLOAD_MAX_BYTES, HISTORY_ATTACHMENT_PAYLOAD_TTL_MS, HISTORY_ATTACHMENT_PAYLOAD_MAX_BYTES, EXPIRED_PENDING_ATTACHMENT_MESSAGE, createChatPublicationAuthority } from "../chatService";
import type { ChatServiceOptions, PendingSkillInputState, CachedHistoryAttachmentPayload } from "../chatService";
import { createConversationTurnId } from "../../shared/conversationCausalSpine";
import { createChatStatusEmitter, getNowMs } from "./streamingStatus";
import { persistRequiredChatActivityEvent } from "./modulemessages";
import { resolveChatWorkspace } from "./moduleruntime";
import { createChatWorkspaceRunRecorder } from "./modulesettlement";


/** Outer factory identifiers threaded into the guided-input runtime. */
export type GuidedInputRuntime = {
  options: ChatServiceOptions;
  createId: () => string;
  sendMessageInternal: (input: unknown, runtimeOptions: unknown, extra?: unknown) => Promise<SendChatMessageResult>;
  state: {
    pendingSkillInputRequests: Map<string, PendingSkillInputState>;
    historyAttachmentPayloads: Map<string, CachedHistoryAttachmentPayload>;
  };
};

export function createGuidedInputRuntime(rt: GuidedInputRuntime) {
  const options = rt.options;
  const createId = rt.createId;
  const sendMessageInternal = rt.sendMessageInternal;
  const pendingSkillInputRequests = rt.state.pendingSkillInputRequests;
  const historyAttachmentPayloads = rt.state.historyAttachmentPayloads;
  function cachePendingSkillInput(
    inputRequestId: string,
    pending: PendingSkillInputState,
  ): void {
    pendingSkillInputRequests.set(inputRequestId, pending);
    prunePendingAttachmentPayloads(getNowMs(options.now));
  }

  function prunePendingAttachmentPayloads(nowMs: number): void {
    for (const entry of pendingSkillInputRequests.values()) {
      if (
        entry.attachments?.length &&
        nowMs - entry.createdAtMs > PENDING_ATTACHMENT_PAYLOAD_TTL_MS
      ) {
        entry.attachments = undefined;
      }
    }
    const entriesWithPayload = [...pendingSkillInputRequests.values()]
      .filter((entry) => entry.attachments?.length)
      .sort((left, right) => left.createdAtMs - right.createdAtMs);
    let totalBytes = entriesWithPayload.reduce(
      (sum, entry) =>
        sum +
        (entry.attachments ?? []).reduce(
          (attachmentSum, attachment) => attachmentSum + attachment.size,
          0,
        ),
      0,
    );
    for (const entry of entriesWithPayload) {
      if (totalBytes <= PENDING_ATTACHMENT_PAYLOAD_MAX_BYTES) {
        break;
      }
      totalBytes -= (entry.attachments ?? []).reduce(
        (sum, attachment) => sum + attachment.size,
        0,
      );
      entry.attachments = undefined;
    }
  }

  function cacheHistoryAttachmentPayloads(
    sessionId: string,
    attachments: ChatAttachmentInput[],
    nowMs: number,
  ): void {
    pruneHistoryAttachmentPayloads(nowMs);
    for (const attachment of attachments) {
      const key = toHistoryAttachmentCacheKey(sessionId, attachment.id);
      const existing = historyAttachmentPayloads.get(key);
      if (
        existing &&
        existing.input.dataBase64 !== attachment.dataBase64
      ) {
        // Attachment identifiers are expected to be unique. Fail closed on a
        // collision so an older turn can never be rebound to different bytes.
        historyAttachmentPayloads.delete(key);
        continue;
      }
      historyAttachmentPayloads.set(key, {
        input: attachment,
        lastAccessedAtMs: nowMs,
      });
    }
    pruneHistoryAttachmentPayloads(nowMs);
  }

  function pruneHistoryAttachmentPayloads(nowMs: number): void {
    for (const [key, entry] of historyAttachmentPayloads) {
      if (
        nowMs - entry.lastAccessedAtMs >
        HISTORY_ATTACHMENT_PAYLOAD_TTL_MS
      ) {
        historyAttachmentPayloads.delete(key);
      }
    }
    const entries = [...historyAttachmentPayloads.entries()].sort(
      ([, left], [, right]) => left.lastAccessedAtMs - right.lastAccessedAtMs,
    );
    let totalBytes = entries.reduce(
      (sum, [, entry]) => sum + entry.input.size,
      0,
    );
    for (const [key, entry] of entries) {
      if (totalBytes <= HISTORY_ATTACHMENT_PAYLOAD_MAX_BYTES) {
        break;
      }
      totalBytes -= entry.input.size;
      historyAttachmentPayloads.delete(key);
    }
  }

  function resolveHistoryAttachmentPayload(
    sessionId: string,
    metadata: ChatAttachmentMetadata,
    nowMs: number,
  ): ChatAttachmentInput | undefined {
    const entry = historyAttachmentPayloads.get(
      toHistoryAttachmentCacheKey(sessionId, metadata.id),
    );
    if (!entry || !matchesAttachmentMetadata(entry.input, metadata)) {
      return undefined;
    }
    entry.lastAccessedAtMs = nowMs;
    return entry.input;
  }

  async function hasDurableGuidedInputOwnership(
    persisted: SkillPendingInputState,
  ): Promise<boolean> {
    if (
      !options.conversationCausalStore
      || !options.chatSessionStore?.get
      || !persisted.userMessageId
      || !persisted.settlementId
    ) {
      return false;
    }
    const causalRecord = await options.conversationCausalStore.getRequest(
      persisted.requestId,
    ).catch(() => null);
    const binding = resolveDurableConversationBinding(causalRecord);
    const settlement = causalRecord?.requiredSettlements?.find(
      (candidate) => candidate.id === persisted.settlementId,
    );
    const session = await options.chatSessionStore.get(
      persisted.sessionId,
    ).catch(() => null);
    const sourceEvent = session?.activity?.statusEvents.find(
      (event) => event.settlementId === persisted.settlementId,
    );
    const sourceFingerprint = sourceEvent
      ? createRequiredChatEventFingerprint(sourceEvent)
      : undefined;
    return Boolean(
      binding
      && binding.sessionId === persisted.sessionId
      && binding.userMessageId === persisted.userMessageId
      && settlement?.state === "committed"
      && Boolean(settlement.preparedChatEventFingerprint)
      && settlement.chatEventFingerprint === settlement.preparedChatEventFingerprint
      && sourceFingerprint === settlement.preparedChatEventFingerprint
      && settlement.targetState === "waiting_for_input"
      && settlement.guidedInputRequestId === persisted.inputRequestId
      && causalRecord?.refs.some(
        (ref) => ref.kind === "guided_input" && ref.id === persisted.inputRequestId,
      ),
    );
  }

  async function compensateUnrecoverableGuidedInputSettlement(
    persisted: SkillPendingInputState,
  ): Promise<void> {
    if (
      !options.conversationCausalStore
      || !options.chatSessionStore?.get
      || !persisted.userMessageId
      || !persisted.settlementId
    ) {
      return;
    }
    const causalRecord = await options.conversationCausalStore.getRequest(
      persisted.requestId,
    ).catch(() => null);
    const binding = resolveDurableConversationBinding(causalRecord);
    const settlement = causalRecord?.requiredSettlements?.find(
      (candidate) =>
        candidate.id === persisted.settlementId
        && candidate.guidedInputRequestId === persisted.inputRequestId,
    );
    const owningAttempt = settlement
      ? causalRecord?.attempts.find(
          (candidate) => candidate.attempt === settlement.attempt,
        )
      : undefined;
    if (
      owningAttempt?.state === "accepted"
      && owningAttempt.assistantAcceptance?.state === "committed"
      && owningAttempt.acceptedSettlement
    ) {
      return;
    }
    if (
      !causalRecord
      || binding?.sessionId !== persisted.sessionId
      || binding.userMessageId !== persisted.userMessageId
      || !settlement
      || !causalRecord.refs.some(
        (ref) =>
          ref.kind === "guided_input"
          && ref.id === persisted.inputRequestId,
      )
    ) {
      return;
    }
    const session = await options.chatSessionStore.get(
      persisted.sessionId,
    ).catch(() => null);
    const events = session?.activity?.statusEvents ?? [];
    const sourceEvent = [...events].reverse().find(
      (event) =>
        event.settlementId === settlement.id
        && event.pendingSkillInput?.inputRequestId === persisted.inputRequestId,
    );
    if (settlement.state === "preparing") {
      const sourceFingerprint = sourceEvent
        ? createRequiredChatEventFingerprint(sourceEvent)
        : undefined;
      await options.conversationCausalStore.settleRequiredSettlement({
        requestId: persisted.requestId,
        id: settlement.id,
        state: "failed",
        ...(sourceFingerprint === settlement.preparedChatEventFingerprint
          ? {
              chatEventFingerprint: sourceFingerprint,
            }
          : {}),
        failureCode: "RECOVERY_INCOMPLETE",
      }).catch(() => undefined);
    }
    const tombstoneId = `${settlement.id}:recovery-tombstone`;
    if (!events.some((event) => event.settlementId === tombstoneId)) {
      const sequence = Math.max(
        settlement.sourceSequence,
        ...events
          .filter((event) => event.requestId === persisted.requestId)
          .map((event) => event.sequence ?? 0),
      ) + 1;
      await persistRequiredChatActivityEvent(options.chatSessionStore, {
        sessionId: persisted.sessionId,
        requestId: persisted.requestId,
        turnId: causalRecord.turnId,
        sequence,
        settlementId: tombstoneId,
        state: "failed",
        message: "Guided input recovery found an incomplete settlement.",
        createdAt: new Date(getNowMs(options.now)).toISOString(),
        elapsedMs: 0,
        domainStateAvailable: false,
        selectedSkillName: persisted.selectedSkillName,
        pendingSkillInput: {
          ...persisted,
          status: "failed",
          settlementId: settlement.id,
          attachmentPayloads: undefined,
        },
      }).catch(() => undefined);
    }
    await options.conversationCausalStore.settleAttempt({
      requestId: persisted.requestId,
      attempt: settlement.attempt,
      state: "interrupted",
    }).catch(() => undefined);
    await options.conversationCausalStore.addRefs({
      requestId: persisted.requestId,
      refs: [],
      coverage: {
        state: "degraded",
        reasonCodes: ["guided_input_recovery_incomplete"],
      },
    }).catch(() => undefined);
  }

  async function ensureGuidedInputCausalAttempt(
    persisted: SkillPendingInputState,
  ): Promise<number | null> {
    if (!options.conversationCausalStore) return 1;
    const record = await options.conversationCausalStore.getRequest(persisted.requestId);
    const lastAttempt = record?.attempts.at(-1);
    if (!lastAttempt) return null;
    if (lastAttempt.state === "active") return lastAttempt.attempt;
    if (
      lastAttempt.state !== "interrupted"
      && lastAttempt.state !== "reset"
      && lastAttempt.state !== "superseded"
    ) {
      return null;
    }
    const nextAttempt = lastAttempt.attempt + 1;
    const begun = await options.conversationCausalStore.beginAttempt({
      requestId: persisted.requestId,
      attempt: nextAttempt,
    });
    return begun.disposition === "applied" || begun.disposition === "duplicate"
      ? nextAttempt
      : null;
  }

  async function recoverPendingSkillInputState(
    inputRequestId: string,
  ): Promise<PendingSkillInputState | null> {
    const persisted = await findPersistedPendingSkillInputState({
      inputRequestId,
      chatSessionStore: options.chatSessionStore,
    });
    if (!persisted) {
      return null;
    }
    if (persisted.status === "processing") {
      await compensateUnrecoverableGuidedInputSettlement(persisted);
      return null;
    }
    if (persisted.status !== "pending") return null;
    if (!(await hasDurableGuidedInputOwnership(persisted))) {
      await compensateUnrecoverableGuidedInputSettlement(persisted);
      return null;
    }

    const requestedSkill = await resolveRequestedSkill({
      message: "",
      selectedSkillName: persisted.selectedSkillName,
      discoverSkills: options.discoverSkills,
    });
    if (requestedSkill?.kind !== "matched") {
      return null;
    }

    const workspaceResolution = await resolveChatWorkspace({
      workspaceService: options.workspaceService,
      workspaceId: persisted.workspaceId,
    });
    if (!workspaceResolution.ok) {
      return null;
    }

    const recovered = toInMemoryPendingSkillInputState({
      persisted,
      selectedSkill: requestedSkill.skill,
      createdAtMs: getNowMs(options.now),
      ...(persisted.attachmentPayloads?.length
        ? { attachments: persisted.attachmentPayloads }
        : {}),
      ...(workspaceResolution.runContext
        ? {
            runContext: {
              ...workspaceResolution.runContext,
              sessionId: persisted.sessionId,
            },
          }
        : {}),
    });
    cachePendingSkillInput(inputRequestId, recovered);
    return recovered;
  }

  async function persistSkillInputLifecycleState(
    pending: PendingSkillInputState,
    status: "processing" | "canceled",
    attempt: number,
  ): Promise<void> {
    const persistedSession = options.chatSessionStore?.get
      ? await options.chatSessionStore.get(pending.sessionId)
      : null;
    const nextSequence = Math.max(
      pending.streamSequence,
      ...(persistedSession?.activity?.statusEvents
        .filter((event) => event.requestId === pending.requestId)
        .map((event) => event.sequence ?? 0)
        ?? [0]),
    ) + 1;
    const event: ChatTaskStatusEvent = {
      sessionId: pending.sessionId,
      requestId: pending.requestId,
      turnId: createConversationTurnId(pending.requestId),
      sequence: nextSequence,
      state: status === "canceled" ? "canceled" : "checkpoint_boundary",
      message:
        status === "canceled"
          ? "Skill input request retired."
          : "Skill input execution claimed.",
      createdAt: new Date(getNowMs(options.now)).toISOString(),
      elapsedMs: 0,
      domainStateAvailable: true,
      selectedSkillName: pending.selectedSkill.manifest.name,
      ...(pending.inputRequest
        ? { inputRequest: pending.inputRequest }
        : {}),
      pendingSkillInput: {
        ...pending.persisted,
        status,
        ...(status === "canceled" ? { attachmentPayloads: undefined } : {}),
      },
    };
    let workspaceRunRecorder: ChatWorkspaceRunRecorder | null = null;
    try {
      workspaceRunRecorder = pending.runContext
        ? await createChatWorkspaceRunRecorder({
            workspaceRunStore: options.workspaceRunStore,
            sessionId: pending.sessionId,
            requestId: pending.requestId,
            runContext: pending.runContext,
            selectedSkillName: pending.selectedSkill.manifest.name,
            createdAt: event.createdAt,
          })
        : null;
      await persistRequiredConversationSettlement({
        requestId: pending.requestId,
        attempt,
        event,
        chatSessionStore: options.chatSessionStore,
        conversationCausalStore: options.conversationCausalStore,
        workspaceRunRecorder,
        workspaceUnavailableReasonCode:
          "guided_input_workspace_run_unavailable",
        failureReasonCode: "guided_input_lifecycle_settlement_failed",
      });
      pending.streamSequence = nextSequence;
    } catch (error) {
      const settlementId = event.settlementId
        ?? createRequiredSettlementId({
          requestId: pending.requestId,
          attempt,
          sourceSequence: nextSequence,
          targetState: toRequiredSettlementTarget(event) ?? "failed",
        });
      const tombstone: ChatTaskStatusEvent = {
        ...event,
        sequence: nextSequence + 1,
        settlementId: `${settlementId}:tombstone`,
        state: "failed",
        message: "Guided input lifecycle settlement failed.",
        pendingSkillInput: {
          ...pending.persisted,
          status: "failed",
          settlementId,
          attachmentPayloads: undefined,
        },
      };
      await persistRequiredChatActivityEvent(
        options.chatSessionStore,
        tombstone,
      ).catch(() => undefined);
      await workspaceRunRecorder?.appendStatusEvent(tombstone).catch(() => undefined);
      await options.conversationCausalStore?.settleAttempt({
        requestId: pending.requestId,
        attempt,
        state: "interrupted",
      }).catch(() => undefined);
      pendingSkillInputRequests.delete(pending.persisted.inputRequestId);
      throw error;
    }
  }

  function markPersistedSkillInputProcessing(
    pending: PendingSkillInputState,
    attempt: number,
  ) {
    return persistSkillInputLifecycleState(pending, "processing", attempt);
  }

  function markPersistedSkillInputCanceled(
    pending: PendingSkillInputState,
    attempt: number,
  ) {
    return persistSkillInputLifecycleState(pending, "canceled", attempt);
  }

  async function prepareChatMessageInput(
    input: SendChatMessageInput,
    runtimeOptions: SendChatMessageRuntimeOptions,
  ): Promise<
    | { ok: true; value: PreparedChatMessageInput }
    | { ok: false; result: Extract<SendChatMessageResult, { ok: false }> }
  > {
    if (runtimeOptions.signal?.aborted) {
      return {
        ok: false,
        result: {
          ok: false,
          code: "CANCELED",
          retryable: true,
          message: "已中断任务。",
        },
      };
    }
    let processedAttachments: ProcessedChatAttachments;
    try {
      processedAttachments = processChatAttachments(input.attachments);
    } catch (error) {
      return {
        ok: false,
        result: {
          ok: false,
          message:
            error instanceof ChatAttachmentValidationError
              ? error.message
              : "无法读取粘贴的附件。",
        },
      };
    }
    const userMessage = input.message.trim()
      ? input.message
      : processedAttachments.metadata.length
        ? "请分析这些附件。"
        : input.message;
    if (!userMessage.trim()) {
      return {
        ok: false,
        result: { ok: false, code: "EMPTY_MESSAGE", message: "消息不能为空。" },
      };
    }
    const modelUserMessage = appendChatAttachmentContext(
      userMessage,
      processedAttachments.textContext,
    );
    const hasAttachments = processedAttachments.metadata.length > 0;
    const preexistingInputRoutingPlan =
      options.planService && input.sessionId
        ? await options.planService.getInputRoutingPlan(input.sessionId)
        : null;
    if (runtimeOptions.signal?.aborted) {
      return {
        ok: false,
        result: {
          ok: false,
          code: "CANCELED",
          retryable: true,
          message: "已中断任务。",
        },
      };
    }
    if (
      processedAttachments.images.length > 0
      && (input.mode === "goal_plan" || preexistingInputRoutingPlan)
    ) {
      return {
        ok: false,
        result: {
          ok: false,
          message:
            "只读 Plan Mode 暂不支持图片附件。请先移除图片，或把关键信息转为文本附件后再规划。",
        },
      };
    }
    return {
      ok: true,
      value: {
        processedAttachments,
        userMessage,
        modelUserMessage,
        hasAttachments,
        preexistingInputRoutingPlan,
      },
    };
  }

  function claimChatRequest(input: {
    requestId: string;
    turnId: string;
    messageInput: SendChatMessageInput;
    preparedInput: PreparedChatMessageInput;
    createdAt: string;
  }): Promise<ChatRequestClaim | null> {
    if (!options.conversationCausalStore) {
      return Promise.resolve(null);
    }
    return options.conversationCausalStore.claimRequest({
      requestId: input.requestId,
      turnId: input.turnId,
      inputFingerprint: createChatRequestClaimFingerprint({
        input: input.messageInput,
        userMessage: input.preparedInput.userMessage,
        validatedAttachments:
          input.preparedInput.processedAttachments.validatedInputs,
      }),
      inputFingerprintVersion: CONVERSATION_REQUEST_FINGERPRINT_VERSION,
      legacyInputFingerprint: createLegacyChatRequestClaimFingerprint({
        input: input.messageInput,
        userMessage: input.preparedInput.userMessage,
        validatedAttachments:
          input.preparedInput.processedAttachments.validatedInputs,
      }),
      coverage: options.workspaceRunStore
        ? { state: "complete", reasonCodes: [] }
        : {
            state: "partial",
            reasonCodes: ["workspace_run_adapter_unavailable"],
          },
      createdAt: input.createdAt,
    });
  }

  async function respondSkillInputOnce(
    input: SkillInputResponse,
    runtimeOptions: SendChatMessageRuntimeOptions,
  ): Promise<SkillInputResponseResult> {
    prunePendingAttachmentPayloads(getNowMs(options.now));
    const cachedPending = pendingSkillInputRequests.get(input.inputRequestId);
    const pending =
      cachedPending ?? (await recoverPendingSkillInputState(input.inputRequestId));
    if (!pending) {
      return {
        ok: false,
        code: "UNKNOWN_SKILL_INPUT",
        message: "Unknown skill input request.",
      };
    }
    if (
      options.conversationCausalStore
      && !(await hasDurableGuidedInputOwnership(pending.persisted))
    ) {
      pendingSkillInputRequests.delete(input.inputRequestId);
      return {
        ok: false,
        code: "CONFLICT",
        message: "Guided input ownership could not be verified.",
      };
    }
    if (
      !pending.attachments?.length &&
      pending.persisted.attachmentPayloads?.length
    ) {
      pending.attachments = structuredClone(
        pending.persisted.attachmentPayloads,
      );
    }
    if (
      pending.persisted.attachments?.length &&
      !pending.attachments?.length
    ) {
      const expiryAttempt = await ensureGuidedInputCausalAttempt(
        pending.persisted,
      );
      if (!expiryAttempt) {
        pendingSkillInputRequests.delete(input.inputRequestId);
        return {
          ok: false,
          code: "CONFLICT",
          message: "Guided input expiration could not be settled.",
          domainStateAvailable: false,
        };
      }
      try {
        await markPersistedSkillInputCanceled(pending, expiryAttempt);
      } catch {
        return {
          ok: false,
          message: "Failed to persist skill input retirement.",
        };
      }
      pendingSkillInputRequests.delete(input.inputRequestId);
      return {
        ok: false,
        code: "ATTACHMENT_EXPIRED",
        message: EXPIRED_PENDING_ATTACHMENT_MESSAGE,
      };
    }

    const mergedValues = {
      ...pending.partialValues,
      ...input.values,
    };
    const inputResolution = resolveSkillInput({
      skill: pending.selectedSkill,
      values: mergedValues,
      runContext: pending.runContext,
    });
    if (inputResolution.status !== "complete") {
      const inputRequest = createSkillUserInputRequest({
        createId,
        inputRequestId: input.inputRequestId,
        sessionId: pending.sessionId,
        requestId: pending.requestId,
        skill: pending.selectedSkill,
        inputResolution,
        createdAt: new Date(getNowMs(options.now)).toISOString(),
      });
      const persisted = createPendingSkillInputState({
        inputRequest,
        sessionId: pending.sessionId,
        requestId: pending.requestId,
        userMessage: pending.userMessage,
        userMessageId: pending.userMessageId,
        selectedSkillName: pending.selectedSkill.manifest.name,
        ...(pending.workspaceId ? { workspaceId: pending.workspaceId } : {}),
        ...(pending.workspaceSummary
          ? { workspaceSummary: pending.workspaceSummary }
          : {}),
        partialValues: inputResolution.values,
        ...(pending.persisted.attachments?.length
          ? { attachments: pending.persisted.attachments }
          : {}),
        ...(pending.attachments?.length
          ? { attachmentPayloads: pending.attachments }
          : {}),
      });
      const guidedAttempt = await ensureGuidedInputCausalAttempt(pending.persisted);
      if (!guidedAttempt) {
        pendingSkillInputRequests.delete(input.inputRequestId);
        return {
          ok: false,
          code: "CONFLICT",
          message: "Guided input attempt could not be admitted.",
          domainStateAvailable: false,
        };
      }
      const admittedGuidedAttempt = guidedAttempt;
      const guidedPublicationAuthority = createChatPublicationAuthority();
      if (
        !pending.userMessageId
        || !guidedPublicationAuthority.markDurable(
          pending.sessionId,
          pending.userMessageId,
        )
      ) {
        pendingSkillInputRequests.delete(input.inputRequestId);
        return {
          ok: false,
          code: "CONFLICT",
          message: "Guided input durable publication could not be established.",
          domainStateAvailable: false,
        };
      }
      const skillWorkspaceRunRecorder = pending.runContext
        ? await createChatWorkspaceRunRecorder({
            workspaceRunStore: options.workspaceRunStore,
            sessionId: pending.sessionId,
            requestId: pending.requestId,
            runContext: pending.runContext,
            selectedSkillName: pending.selectedSkill.manifest.name,
            createdAt: inputRequest.createdAt,
          })
        : null;
      const guidedRefs = await options.conversationCausalStore?.addRefs({
        requestId: pending.requestId,
        refs: [
          { kind: "guided_input", id: inputRequest.id },
          ...(skillWorkspaceRunRecorder
            ? [{
                kind: "workspace_run" as const,
                id: skillWorkspaceRunRecorder.workspaceRunId,
              }]
            : []),
        ],
        ...(!skillWorkspaceRunRecorder
          ? {
              coverage: {
                state: "partial" as const,
                reasonCodes: ["guided_input_workspace_run_unavailable"],
              },
            }
          : {}),
      });
      if (
        guidedRefs
        && guidedRefs.disposition !== "applied"
        && guidedRefs.disposition !== "duplicate"
      ) {
        guidedPublicationAuthority.invalidate("guided_input_ref_conflict");
        pendingSkillInputRequests.delete(input.inputRequestId);
        return {
          ok: false,
          code: "CONFLICT",
          message: "Guided input references could not be established.",
          domainStateAvailable: false,
        };
      }
      const guidedInputRequestId = pending.requestId;
      async function persistGuidedInputStatus(
        event: ChatTaskStatusEvent,
        required: boolean,
      ) {
        if (!required) {
          await options.chatSessionStore?.appendActivityEvent?.(event.sessionId, event);
          if (skillWorkspaceRunRecorder) {
            await skillWorkspaceRunRecorder.appendStatusEvent(event);
          }
          return;
        }
        try {
          await persistRequiredConversationSettlement({
            requestId: guidedInputRequestId,
            attempt: admittedGuidedAttempt,
            event,
            chatSessionStore: options.chatSessionStore,
            conversationCausalStore: options.conversationCausalStore,
            workspaceRunRecorder: skillWorkspaceRunRecorder,
            workspaceUnavailableReasonCode:
              "guided_input_workspace_run_unavailable",
            failureReasonCode: "guided_input_required_settlement_failed",
          });
        } catch (error) {
          const targetState = toRequiredSettlementTarget(event);
          const settlementId = event.settlementId ?? (
            targetState
              ? createRequiredSettlementId({
                  requestId: guidedInputRequestId,
                  attempt: admittedGuidedAttempt,
                  sourceSequence: event.sequence ?? 0,
                  targetState,
                })
              : `required_settlement_unavailable_${guidedInputRequestId}`
          );
          const failedPending = event.pendingSkillInput
            ? {
                ...event.pendingSkillInput,
                status: "failed" as const,
                settlementId,
                attachmentPayloads: undefined,
              }
            : undefined;
          const tombstone: ChatTaskStatusEvent = {
            ...event,
            settlementId: `${settlementId}:tombstone`,
            state: "failed",
            message: "Guided input settlement failed.",
            ...(failedPending ? { pendingSkillInput: failedPending } : {}),
          };
          await persistRequiredChatActivityEvent(
            options.chatSessionStore,
            tombstone,
          ).catch(() => undefined);
          await skillWorkspaceRunRecorder?.appendStatusEvent(tombstone).catch(() => undefined);
          await options.conversationCausalStore?.settleAttempt({
            requestId: guidedInputRequestId,
            attempt: admittedGuidedAttempt,
            state: "interrupted",
          }).catch(() => undefined);
          await options.conversationCausalStore?.addRefs({
            requestId: guidedInputRequestId,
            refs: [],
            coverage: {
              state: "degraded",
              reasonCodes: ["guided_input_required_settlement_failed"],
            },
          }).catch(() => undefined);
          guidedPublicationAuthority.invalidate("guided_input_required_settlement_failed");
          pendingSkillInputRequests.delete(input.inputRequestId);
          throw new SecretSafeFailureError(
            error instanceof RequiredConversationSettlementError
              ? error.failureCode
              : "CROSS_DOMAIN_SETTLEMENT_FAILED",
            error,
          );
        }
      }
      const emitStatus = createChatStatusEmitter({
        sessionId: pending.sessionId,
        requestId: pending.requestId,
        startedAtMs: getNowMs(options.now),
        initialSequence: pending.streamSequence,
        now: options.now,
        onStatusEvent: runtimeOptions.onStatusEvent,
        onStreamEvent: runtimeOptions.onStreamEvent,
        getDomainStateAvailable: () =>
          guidedPublicationAuthority.domainStateAvailable(),
        onPersistEvent(event) {
          return persistGuidedInputStatus(event, false);
        },
        async onRequiredPersistEvent(event) {
          await persistGuidedInputStatus(event, true);
        },
      });
      try {
        await emitStatus.sendWaitingForInput(
          inputRequest,
          "Skill input required.",
          persisted,
        );
        emitStatus.sendStreamEvent({
          type: "output_part",
          part: createChatOutputAssembler(() =>
            new Date(getNowMs(options.now)).toISOString(),
          ).appendInputRequest(inputRequest),
        });
      } catch {
        guidedPublicationAuthority.invalidate("guided_input_publish_failed");
        const outputAssembler = createChatOutputAssembler(() =>
          new Date(getNowMs(options.now)).toISOString(),
        );
        emitStatus.sendStreamEvent({
          type: "output_part",
          part: outputAssembler.appendDiagnostic({
            severity: "error",
            title: "请求失败",
            message: "Failed to persist skill input request.",
          }),
        });
        emitStatus.sendTerminalEvent({
          type: "failed",
          message: "Failed to persist skill input request.",
        });
        return {
          ok: false,
          message: "Failed to persist skill input request.",
        };
      }
      cachePendingSkillInput(inputRequest.id, {
        ...toInMemoryPendingSkillInputState({
          persisted,
          selectedSkill: pending.selectedSkill,
          createdAtMs: pending.createdAtMs,
          ...(pending.attachments?.length
            ? { attachments: pending.attachments }
            : {}),
          ...(pending.runContext ? { runContext: pending.runContext } : {}),
        }),
        streamSequence: emitStatus.getSequence(),
      });
      return {
        ok: false,
        code: "SKILL_INPUT_REQUIRED",
        message: "Skill input required.",
      };
    }

    const executionAttempt = await ensureGuidedInputCausalAttempt(pending.persisted);
    if (!executionAttempt) {
      pendingSkillInputRequests.delete(input.inputRequestId);
      return {
        ok: false,
        code: "CONFLICT",
        message: "Guided input execution could not be admitted.",
        domainStateAvailable: false,
      };
    }
    try {
      await markPersistedSkillInputProcessing(pending, executionAttempt);
    } catch {
      return {
        ok: false,
        message: "Failed to persist skill input processing claim.",
      };
    }
    const result = await sendMessageInternal(
      {
        sessionId: pending.sessionId,
        requestId: pending.requestId,
        message: pending.userMessage,
        ...(pending.attachments?.length
          ? { attachments: pending.attachments }
          : {}),
        selectedSkillName: pending.selectedSkill.manifest.name,
        ...(pending.workspaceId ? { workspaceId: pending.workspaceId } : {}),
        ...(pending.workspaceSummary
          ? { workspaceSummary: pending.workspaceSummary }
          : {}),
      },
      runtimeOptions,
      {
        skipUserMessageAppend: true,
        userMessageId: pending.userMessageId,
        forcedSkill: pending.selectedSkill,
        resolvedSkillInput: inputResolution,
        ...(pending.runContext ? { preResolvedRunContext: pending.runContext } : {}),
        ...(pending.workspaceSummary
          ? { preResolvedWorkspaceSummary: pending.workspaceSummary }
          : {}),
        initialStreamSequence: pending.streamSequence,
      },
    );
    pendingSkillInputRequests.delete(input.inputRequestId);
    return result;
  }
  return {
    cachePendingSkillInput,
    prunePendingAttachmentPayloads,
    cacheHistoryAttachmentPayloads,
    pruneHistoryAttachmentPayloads,
    resolveHistoryAttachmentPayload,
    hasDurableGuidedInputOwnership,
    compensateUnrecoverableGuidedInputSettlement,
    ensureGuidedInputCausalAttempt,
    recoverPendingSkillInputState,
    persistSkillInputLifecycleState,
    markPersistedSkillInputProcessing,
    markPersistedSkillInputCanceled,
    prepareChatMessageInput,
    claimChatRequest,
    respondSkillInputOnce,
  };
}
