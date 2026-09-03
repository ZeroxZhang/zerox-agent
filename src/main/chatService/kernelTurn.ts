import { waitForTurnOrAbort } from "./moduleruntime";
import { toSecretSafeFailure } from "../../shared/secretSafeFailure";
import { SecretSafeFailureError } from "../../shared/secretSafeFailure";
import { ChatKernelSettlement } from "../kernel/chatKernelSegment";
import { ChatTaskStatusEvent } from "../../shared/chat";
import { ChatStreamEvent } from "../../shared/chat";
import { ChatWorkspaceRunRecorder } from "./modulesettlement";
import { findPersistedRequestTurn } from "./modulemessages";
import { resolveDurableConversationBinding } from "../../shared/conversationCausalSpine";
import { ChatRequestClaim } from "../chatService";
import { createChatKernelRunId } from "./kernelSettlement";
import { AssistantAcceptanceRecoveryRequiredError } from "../chatService";
import { SendChatMessageResult } from "../../shared/chat";
import { ChatTurnInternalOptions } from "../chatService";
import { SendChatMessageRuntimeOptions } from "../chatService";
import { SendChatMessageInput } from "../../shared/chat";
import type { ChatServiceOptions } from "../chatService";
import { createGuidedInputRuntime } from "./guidedInput";
import { getNowMs } from "./streamingStatus";
import { createConversationTurnId } from "../../shared/conversationCausalSpine";
import { persistRequiredConversationSettlement } from "./modulesettlement";
import { createChatPublicationAuthority } from "../chatService";
import { createRequiredChatEventFingerprint, toChatKernelStatus } from "./kernelSettlement";
import { runChatKernelSegment } from "../kernel/chatKernelSegment";

/** Outer factory identifiers threaded into the kernel-turn runtime. */
export type KernelTurnRuntime = {
  options: ChatServiceOptions;
  guidedInput: ReturnType<typeof createGuidedInputRuntime>;
  processChatSessionRequestTails: Map<string, Promise<void>>;
  inFlightSkillInputResponses: Set<string>;
  executeMessageInternal: (input: unknown, runtimeOptions: unknown, extra?: unknown) => Promise<SendChatMessageResult>;
};

export function createKernelTurnRuntime(rt: KernelTurnRuntime) {
  const options = rt.options;
  const guidedInput = rt.guidedInput;
  const processChatSessionRequestTails = rt.processChatSessionRequestTails;
  const inFlightSkillInputResponses = rt.inFlightSkillInputResponses;
  const executeMessageInternal = rt.executeMessageInternal;
  async function executeMessageWithKernel(
    input: SendChatMessageInput,
    runtimeOptions: SendChatMessageRuntimeOptions,
    internalOptions: ChatTurnInternalOptions,
  ): Promise<SendChatMessageResult> {
    const preparation = await guidedInput.prepareChatMessageInput(
      input,
      runtimeOptions,
    );
    if (!preparation.ok) {
      return preparation.result;
    }
    if (runtimeOptions.signal?.aborted) {
      return {
        ok: false,
        code: "CANCELED",
        retryable: true,
        message: "已中断任务。",
      };
    }
    if (!options.productionKernelDriver) {
      const publicationAuthority =
        internalOptions.publicationAuthority ?? createChatPublicationAuthority();
      let result: SendChatMessageResult;
      try {
        result = await executeMessageInternal(
          input,
          runtimeOptions,
          {
            ...internalOptions,
            preparedInput: preparation.value,
            publicationAuthority,
          },
        );
      } catch (error) {
        if (!(error instanceof AssistantAcceptanceRecoveryRequiredError)) {
          throw error;
        }
        result = error.result;
      }
      return result.ok
        ? {
            ...result,
            domainStateAvailable:
              result.domainStateAvailable === false
                ? false
                : publicationAuthority.domainStateAvailable(),
          }
        : result;
    }

    const requestId =
      input.requestId ?? `request_${getNowMs(options.now)}`;
    const normalizedInput = { ...input, requestId };
    const runId = createChatKernelRunId(requestId);
    const requestClaim: ChatRequestClaim | null = (
      internalOptions.skipUserMessageAppend
      && options.conversationCausalStore
    )
      ? await options.conversationCausalStore.getRequest(requestId).then(
          (record): ChatRequestClaim =>
            record
              ? { disposition: "duplicate", value: record }
              : { disposition: "not_found" },
        )
      : await guidedInput.claimChatRequest({
          requestId,
          turnId: createConversationTurnId(requestId),
          messageInput: normalizedInput,
          preparedInput: preparation.value,
          createdAt: new Date(getNowMs(options.now)).toISOString(),
        });
    const claimedRecord = requestClaim?.value;
    const claimedBinding = resolveDurableConversationBinding(claimedRecord);
    const latestClaimAttempt = claimedRecord?.attempts.at(-1);

    if (requestClaim?.disposition === "conflict") {
      return {
        ok: false,
        code: "CONFLICT",
        message: "相同 requestId 已绑定到不同输入，未改变原请求状态。",
      };
    }
    if (requestClaim && !claimedRecord) {
      return {
        ok: false,
        code: "CONFLICT",
        message: "请求归属无法确认，未开始执行。",
      };
    }
    if (options.conversationCausalStore && !options.chatSessionStore) {
      return {
        ok: false,
        code: "CONFLICT",
        retryable: true,
        message: "Chat persistence is unavailable, so execution was not admitted.",
      };
    }
    if (requestClaim?.disposition === "duplicate" && !claimedBinding) {
      return {
        ok: false,
        code: "CONFLICT",
        retryable: true,
        message: claimedRecord?.sessionId
          ? "旧版请求缺少持久化用户消息证明，请使用新的 requestId 重新发送。"
          : "相同请求仍在处理中，未启动第二次执行。",
      };
    }
    if (
      requestClaim?.disposition === "duplicate"
      && internalOptions.skipUserMessageAppend
      && (
        !claimedBinding
        || claimedBinding.sessionId !== normalizedInput.sessionId
        || claimedBinding.userMessageId !== internalOptions.userMessageId
      )
    ) {
      return {
        ok: false,
        code: "CONFLICT",
        message: "引导输入与原请求的持久化归属不一致，未恢复执行。",
      };
    }
    if (
      requestClaim?.disposition === "duplicate"
      && !internalOptions.skipUserMessageAppend
    ) {
      const durableReplayTurn =
        claimedBinding && options.chatSessionStore?.get
          ? await findPersistedRequestTurn(
              options.chatSessionStore,
              claimedBinding.sessionId,
              requestId,
            )
          : null;
      if (
        latestClaimAttempt?.state === "accepted"
        || Boolean(durableReplayTurn?.assistant)
      ) {
        const replayAuthority = createChatPublicationAuthority();
        if (claimedBinding) {
          replayAuthority.markDurable(
            claimedBinding.sessionId,
            claimedBinding.userMessageId,
          );
        }
        let replayResult: SendChatMessageResult;
        try {
          replayResult = await executeMessageInternal(normalizedInput, runtimeOptions, {
            ...internalOptions,
            preparedInput: preparation.value,
            requestClaim,
            publicationAuthority: replayAuthority,
          });
        } catch (error) {
          if (!(error instanceof AssistantAcceptanceRecoveryRequiredError)) {
            throw error;
          }
          replayResult = error.result;
        }
        return replayResult.ok
          ? {
              ...replayResult,
              domainStateAvailable:
                replayResult.domainStateAvailable === false
                  ? false
                  : replayAuthority.domainStateAvailable(),
            }
          : replayResult;
      }
      return {
        ok: false,
        code: "CONFLICT",
        retryable: true,
        message: "相同请求仍在处理中，未启动第二次执行。",
      };
    }
    if (options.conversationCausalStore) {
      const refMutation = await options.conversationCausalStore.addRefs({
        requestId,
        refs: [{ kind: "kernel_run", id: runId }],
      });
      if (
        refMutation.disposition !== "applied"
        && refMutation.disposition !== "duplicate"
      ) {
        throw new Error(
          "Chat Kernel admission requires a durable causal run reference.",
        );
      }
    }

    const publicationAuthority = createChatPublicationAuthority();
    let kernelWorkspaceRunRecorder: ChatWorkspaceRunRecorder | null = null;
    const preparedInternalOptions: ChatTurnInternalOptions = {
      ...internalOptions,
      preparedInput: preparation.value,
      requestClaim,
      publicationAuthority,
      onDurableSessionResolved(sessionId) {
        internalOptions.onDurableSessionResolved?.(sessionId);
      },
      onDomainStateUnavailable() {
        internalOptions.onDomainStateUnavailable?.();
        publicationAuthority.invalidate("domain_state_unavailable");
      },
      onWorkspaceRunRecorderResolved(recorder) {
        kernelWorkspaceRunRecorder = recorder;
        internalOptions.onWorkspaceRunRecorderResolved?.(recorder);
      },
    };

    const terminalEvents: Array<
      Extract<
        ChatStreamEvent,
        { type: "completed" | "failed" | "canceled" }
      >
    > = [];
    let bufferedTerminalStatusEvents: ChatTaskStatusEvent[] = [];
    let publishedTerminalEvent = false;
    let lastStreamEvent: ChatStreamEvent | undefined;
    let lastStatusEvent: ChatTaskStatusEvent | undefined;
    const isTerminalStatusEvent = (event: ChatTaskStatusEvent) =>
      event.state === "completed"
      || event.state === "failed"
      || event.state === "canceled";
    const publishStatusObserver = (event: ChatTaskStatusEvent) => {
      try {
        runtimeOptions.onStatusEvent?.(event);
      } catch {
        // User observers are not part of Kernel settlement.
      }
      try {
        runtimeOptions.onStreamEvent?.({
          type: "status",
          status: event,
          sessionId: event.sessionId,
          requestId: event.requestId ?? requestId,
          sequence: event.sequence ?? 0,
          turnId: event.turnId ?? createConversationTurnId(requestId),
          createdAt: event.createdAt,
          domainStateAvailable: event.domainStateAvailable === true,
        });
      } catch {
        // User observers are not part of Kernel settlement.
      }
    };
    const publishTerminalObserver = (
      event: Extract<ChatStreamEvent, { type: "completed" | "failed" | "canceled" }>,
    ) => {
      if (publishedTerminalEvent) return;
      publishedTerminalEvent = true;
      try {
        runtimeOptions.onStreamEvent?.(event);
      } catch {
        // User observers are not part of Kernel settlement.
      }
    };
    const wrappedRuntimeOptions: SendChatMessageRuntimeOptions = {
      ...runtimeOptions,
      onStatusEvent(event) {
        lastStatusEvent = event;
        if (isTerminalStatusEvent(event)) {
          bufferedTerminalStatusEvents.push(event);
          return;
        }
        publishStatusObserver(event);
      },
      onStreamEvent(event) {
        lastStreamEvent = event;
        if (event.type === "status" && isTerminalStatusEvent(event.status)) {
          return;
        }
        if (
          event.type === "completed" ||
          event.type === "failed" ||
          event.type === "canceled"
        ) {
          terminalEvents.push(event);
          return;
        }
        try {
          runtimeOptions.onStreamEvent?.(event);
        } catch {
          // User observers are not part of Kernel settlement.
        }
      },
    };
    const persistTerminalActivity = async (
      status: "paused" | "failed" | "canceled",
      message: string,
      sessionId: string | undefined,
    ): Promise<ChatTaskStatusEvent | null> => {
      if (!sessionId) return null;
      if (!options.chatSessionStore?.appendActivityEvent) {
        throw new Error(
          "Chat Kernel terminal activity persistence is unavailable.",
        );
      }
      const persistedSession = options.chatSessionStore.get
        ? await options.chatSessionStore.get(sessionId)
        : null;
      const causalRecord = options.conversationCausalStore
        ? await options.conversationCausalStore.getRequest(requestId)
        : null;
      const binding = resolveDurableConversationBinding(causalRecord);
      if (options.conversationCausalStore && binding?.sessionId !== sessionId) {
        throw new Error(
          "Chat Kernel terminal settlement lacks an exact durable binding.",
        );
      }
      const existingEvent = [
        ...(persistedSession?.activity?.statusEvents ?? []),
      ].reverse().find(
        (event) => event.requestId === requestId && event.state === status,
      );
      if (existingEvent) {
        if (!options.conversationCausalStore) return existingEvent;
        const existingSettlement = causalRecord?.requiredSettlements?.find(
          (candidate) =>
            candidate.id === existingEvent.settlementId
            && candidate.state === "committed"
            && Boolean(candidate.preparedChatEventFingerprint)
            && candidate.chatEventFingerprint
              === candidate.preparedChatEventFingerprint
            && createRequiredChatEventFingerprint(existingEvent)
              === candidate.preparedChatEventFingerprint,
        );
        if (existingSettlement) return existingEvent;
      }
      const activeAttempt = [...(causalRecord?.attempts ?? [])].reverse().find(
        (attempt) => attempt.state === "active",
      );
      if (options.conversationCausalStore && !activeAttempt) {
        throw new Error(
          "Chat Kernel terminal settlement lacks an active causal attempt.",
        );
      }
      const persistedSequence = persistedSession?.activity?.statusEvents.reduce(
        (highest, event) =>
          event.requestId === requestId
            ? Math.max(highest, event.sequence ?? 0)
            : highest,
        0,
      ) ?? 0;
      const event: ChatTaskStatusEvent = {
        sessionId,
        requestId,
        turnId:
          lastStatusEvent?.turnId
          ?? lastStreamEvent?.turnId
          ?? createConversationTurnId(requestId),
        sequence: Math.max(
          persistedSequence,
          lastStatusEvent?.sequence ?? 0,
          lastStreamEvent?.sequence ?? 0,
        ) + 1,
        state: status,
        message,
        createdAt: new Date(getNowMs(options.now)).toISOString(),
        elapsedMs: 0,
        domainStateAvailable: true,
      };
      await persistRequiredConversationSettlement({
        requestId,
        attempt: activeAttempt?.attempt ?? 1,
        event,
        chatSessionStore: options.chatSessionStore,
        conversationCausalStore: options.conversationCausalStore,
        workspaceRunRecorder: kernelWorkspaceRunRecorder,
        workspaceUnavailableReasonCode: "workspace_run_unavailable",
        failureReasonCode: "kernel_terminal_settlement_failed",
      });
      return event;
    };

    const stageSyntheticTerminal = (
      type: "completed" | "failed" | "canceled",
      message: string,
      sessionId: string | undefined,
    ) => {
      const event: Extract<
        ChatStreamEvent,
        { type: "completed" | "failed" | "canceled" }
      > = {
        type,
        sessionId:
          sessionId
          ?? lastStatusEvent?.sessionId
          ?? lastStreamEvent?.sessionId
          ?? normalizedInput.sessionId
          ?? `runtime_${runId}`,
        requestId,
        sequence: (lastStreamEvent?.sequence ?? 0) + 1,
        turnId: lastStreamEvent?.turnId ?? `turn-${requestId}`,
        createdAt: new Date(getNowMs(options.now)).toISOString(),
        message,
        domainStateAvailable: Boolean(sessionId),
      };
      terminalEvents.push(event);
      lastStreamEvent = event;
      return event;
    };

    const settleResult = async (
      result: SendChatMessageResult,
    ): Promise<ChatKernelSettlement<SendChatMessageResult>> => {
      const terminalBeforeSettlement = terminalEvents.at(-1);
      const status = toChatKernelStatus(
        result,
        terminalBeforeSettlement,
        lastStatusEvent,
      );
      const message = result.ok ? result.reply : result.message;
      const sessionId = publicationAuthority.durableSessionId();
      if (terminalEvents.length === 0) {
        stageSyntheticTerminal(
          status === "failed"
            ? "failed"
            : status === "canceled"
              ? "canceled"
              : "completed",
          message,
          sessionId,
        );
      }
      const terminal = terminalEvents.at(-1)!;
      const needsTerminalActivity =
        status === "failed" || status === "canceled";
      const terminalActivityEvent = needsTerminalActivity
        ? await persistTerminalActivity(status, message, sessionId)
        : null;
      if (needsTerminalActivity && !terminalActivityEvent) {
        throw new SecretSafeFailureError("SETTLEMENT_COMPENSATION_INCOMPLETE");
      }
      const assistantMessageId = terminal.finalMessageId?.trim();

      if (terminalActivityEvent) {
        bufferedTerminalStatusEvents = [];
        publishStatusObserver(terminalActivityEvent);
      } else {
        const publishableStatusEvents = result.turnSettlementStatus === "unknown"
          ? bufferedTerminalStatusEvents.splice(0).filter((event) =>
              event.state !== "completed"
              && event.state !== "failed"
              && event.state !== "canceled",
            )
          : bufferedTerminalStatusEvents.splice(0);
        for (const event of publishableStatusEvents) {
          publishStatusObserver(event);
        }
      }
      publishTerminalObserver(terminal);

      return {
        status,
        summary: message,
        result,
        persistence: {
          requiredStatePersisted: true,
          ...(assistantMessageId ? { assistantMessageId } : {}),
          ...(status === "paused"
            ? result.turnSettlementStatus === "unknown"
              ? { reconciliationRequired: true as const }
              : { continuationPersisted: true as const }
            : {}),
          ...(terminalActivityEvent
            ? { terminalActivityPersisted: true as const }
            : {}),
          ...(!sessionId && !requestClaim && !options.conversationCausalStore
            ? { noDomainStateCreated: true as const }
            : {}),
        },
        streamTerminals: [terminal],
      };
    };

    const outcome = await runChatKernelSegment<SendChatMessageResult>({
      driver: options.productionKernelDriver,
      runId,
      async execute() {
        try {
          return settleResult(
            await executeMessageInternal(
              normalizedInput,
              wrappedRuntimeOptions,
              preparedInternalOptions,
            ),
          );
        } catch (error) {
          if (!(error instanceof AssistantAcceptanceRecoveryRequiredError)) {
            throw error;
          }
          return settleResult(error.result);
        }
      },
      async settleAborted() {
        throw new Error(
          "Chat Kernel wrapper does not own surface cancellation.",
        );
      },
      async settleFailed(error) {
        let failure = toSecretSafeFailure(error, "INTERNAL_FAILURE");
        let sessionId = publicationAuthority.durableSessionId();
        let terminalActivityEvent: ChatTaskStatusEvent | null = null;
        try {
          terminalActivityEvent = await persistTerminalActivity(
            failure.terminal,
            failure.publicMessage,
            sessionId,
          );
        } catch {
          publicationAuthority.invalidate("kernel_failure_activity_write_failed");
          internalOptions.onDomainStateUnavailable?.();
          failure = toSecretSafeFailure(
            new SecretSafeFailureError("SETTLEMENT_COMPENSATION_INCOMPLETE"),
          );
          await options.conversationCausalStore?.addRefs({
            requestId,
            refs: [],
            coverage: {
              state: "degraded",
              reasonCodes: [...failure.coverageReasonCodes],
            },
          }).catch(() => undefined);
        }
        terminalEvents.length = 0;
        bufferedTerminalStatusEvents = [];
        const safeTerminal = stageSyntheticTerminal(
          failure.terminal,
          failure.publicMessage,
          terminalActivityEvent ? sessionId : undefined,
        );
        if (terminalActivityEvent) {
          publishStatusObserver(terminalActivityEvent);
        } else {
          publishStatusObserver({
            sessionId:
              lastStatusEvent?.sessionId
              ?? normalizedInput.sessionId
              ?? `runtime_${runId}`,
            requestId,
            turnId: lastStatusEvent?.turnId ?? createConversationTurnId(requestId),
            sequence: Math.max(lastStatusEvent?.sequence ?? 0, safeTerminal.sequence),
            state: "failed",
            message: failure.publicMessage,
            createdAt: safeTerminal.createdAt,
            elapsedMs: 0,
            domainStateAvailable: false,
          });
        }
        publishTerminalObserver(safeTerminal);
        return {
          status: "failed",
          summary: failure.publicMessage,
          failure,
          result: {
            ok: false as const,
            code: "INTERNAL_ERROR" as const,
            retryable: failure.retryable,
            message: failure.publicMessage,
          },
          persistence: {
            ...(terminalActivityEvent
              ? {
                  requiredStatePersisted: true as const,
                  terminalActivityPersisted: true as const,
                }
              : {
                  requiredStatePersisted: false as const,
                  settlementRecoveryRequired: true as const,
                  settlementFailureCode: failure.code,
                }),
          },
          streamTerminals: [terminalEvents.at(-1)!],
        };
      },
    });
    return outcome.settlement.result.ok
      ? {
          ...outcome.settlement.result,
          domainStateAvailable:
            outcome.settlement.result.domainStateAvailable === false
              ? false
              : publicationAuthority.domainStateAvailable(),
        }
      : outcome.settlement.result;
  }

  async function sendMessageInternal(
    input: SendChatMessageInput,
    runtimeOptions: SendChatMessageRuntimeOptions = {},
    internalOptions: ChatTurnInternalOptions = {},
  ): Promise<SendChatMessageResult> {
    const sessionKey = input.sessionId?.trim();
    if (!sessionKey) {
      return executeMessageWithKernel(input, runtimeOptions, internalOptions);
    }

    const previous = processChatSessionRequestTails.get(sessionKey)
      ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    processChatSessionRequestTails.set(sessionKey, tail);
    try {
      const ready = await waitForTurnOrAbort(previous, runtimeOptions.signal);
      if (!ready) {
        return { ok: false, code: "CANCELED", retryable: true, message: "已中断任务。" };
      }
      return await executeMessageWithKernel(
        input,
        runtimeOptions,
        internalOptions,
      );
    } finally {
      release();
      void tail.finally(() => {
        if (processChatSessionRequestTails.get(sessionKey) === tail) {
          processChatSessionRequestTails.delete(sessionKey);
        }
      });
    }
  }


  return {
    executeMessageWithKernel,
    sendMessageInternal,
  };
}
