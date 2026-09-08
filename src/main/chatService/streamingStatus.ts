import type { ChatOutputPart } from "../../shared/chatOutput";
import {
  redactCredentials,
  redactCredentialString,
} from "../../shared/credentialRedaction";
import {
  sanitizeSkillUserInputRequest,
  type ChatStreamEvent,
  type ChatTaskStatusEvent,
  type SkillPendingInputState,
  type SkillUserInputRequest,
} from "../../shared/chat";
import type { createChatOutputAssembler } from "../chatOutputAssembler";
import type { StreamEvent as ModelStreamEvent } from "../openAiCompatibleClient";

const defaultChatAgentLoopMaxTurns = 48;

// LD01 bounded publication. A turn must disclose text while it runs, but the
// renderer must never receive one IPC message per token. Text runs publish on a
// time-or-byte window and before any non-text stream event, which keeps causal
// order without unbounded buffering.
const defaultStreamFlushIntervalMs = 60;
const defaultStreamFlushMaxChars = 512;
// Tail held back between two consecutive text publications so a credential that
// straddles the window boundary is still redacted as one string. The durable
// assistant text is redacted as a whole, so this only protects the live view.
const streamRedactionCarryChars = 24;

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeAgentLoopMaxTurns(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultChatAgentLoopMaxTurns;
  }

  return Math.max(1, Math.floor(value));
}

function createChatStatusEmitter(options: {
  sessionId: string;
  requestId: string;
  startedAtMs: number;
  initialSequence?: number;
  now?: () => Date;
  /** Bounded publication window for buffered text runs. */
  streamFlushIntervalMs?: number;
  /** Bounded publication size for buffered text runs. */
  streamFlushMaxChars?: number;
  getDomainStateAvailable?: () => boolean;
  onStatusEvent?: (event: ChatTaskStatusEvent) => void;
  onStreamEvent?: (event: ChatStreamEvent) => void;
  onPersistEvent?: (event: ChatTaskStatusEvent) => void | Promise<void>;
  onRequiredPersistEvent?: (event: ChatTaskStatusEvent) => Promise<void>;
}) {
  let sessionId = options.sessionId;
  let assistantMessageId: string | undefined;
  let sequence = Math.max(0, options.initialSequence ?? 0);
  let currentAttempt = 1;
  let attemptControlSequence = 0;
  const turnId = `turn-${options.requestId}`;
  const bufferedTextEvents: Array<{
    type: "answer_delta" | "thinking_delta";
    text: string;
  }> = [];
  const streamFlushIntervalMs = normalizePositiveInteger(
    options.streamFlushIntervalMs,
    defaultStreamFlushIntervalMs,
  );
  const streamFlushMaxChars = normalizePositiveInteger(
    options.streamFlushMaxChars,
    defaultStreamFlushMaxChars,
  );
  let lastTextFlushAtMs = options.startedAtMs;
  const pendingTextCarry: Record<"answer_delta" | "thinking_delta", string> = {
    answer_delta: "",
    thinking_delta: "",
  };
  let persistenceQueue: Promise<void> = Promise.resolve();

  function enqueuePersistence(statusEvent: ChatTaskStatusEvent): Promise<void> {
    const operation = persistenceQueue.then(async () => {
      await options.onPersistEvent?.(statusEvent);
    });
    persistenceQueue = operation.catch(() => undefined);
    return operation;
  }

  function createStreamBase(createdAt: string) {
    return {
      sessionId,
      requestId: options.requestId,
      sequence: ++sequence,
      turnId,
      ...(assistantMessageId ? { assistantMessageId } : {}),
      attempt: currentAttempt,
      createdAt,
      domainStateAvailable: options.getDomainStateAvailable?.() === true,
    };
  }

  function createStatusEvent(
    event: Omit<ChatTaskStatusEvent, "sessionId" | "createdAt" | "elapsedMs">,
  ): ChatTaskStatusEvent {
    const safeEvent = redactCredentials(event) as typeof event;
    if (safeEvent.inputRequest) {
      safeEvent.inputRequest = sanitizeSkillUserInputRequest(
        safeEvent.inputRequest,
      );
    }
    if (safeEvent.pendingSkillInput?.inputRequest) {
      safeEvent.pendingSkillInput.inputRequest = sanitizeSkillUserInputRequest(
        safeEvent.pendingSkillInput.inputRequest,
      );
    }
    const nowMs = getNowMs(options.now);
    const createdAt = new Date(nowMs).toISOString();
    const streamBase = createStreamBase(createdAt);
    return {
      ...safeEvent,
      ...streamBase,
      domainStateAvailable:
        safeEvent.domainStateAvailable === false
          ? false
          : streamBase.domainStateAvailable,
      elapsedMs: Math.max(0, nowMs - options.startedAtMs),
    };
  }

  function publishStatusEvent(
    statusEvent: ChatTaskStatusEvent,
    optionsOverride: { persist: boolean },
  ) {
    if (optionsOverride.persist) {
      void enqueuePersistence(statusEvent).catch(() => undefined);
    }
    try {
      options.onStatusEvent?.(statusEvent);
    } catch {
      // Renderer observers are best-effort.
    }
    try {
      options.onStreamEvent?.({
        type: "status",
        status: statusEvent,
        sessionId: statusEvent.sessionId,
        requestId: statusEvent.requestId ?? options.requestId,
        sequence:
          statusEvent.sequence ?? createStreamBase(statusEvent.createdAt).sequence,
        turnId: statusEvent.turnId ?? turnId,
        ...(assistantMessageId ? { assistantMessageId } : {}),
        createdAt: statusEvent.createdAt,
        domainStateAvailable: statusEvent.domainStateAvailable === true,
      });
    } catch {
      // Renderer observers are best-effort.
    }
  }

  function publishTextRun(
    type: "answer_delta" | "thinking_delta",
    text: string,
  ) {
    const safeText = redactCredentialString(text);
    if (!safeText) {
      return;
    }
    const nowMs = getNowMs(options.now);
    try {
      options.onStreamEvent?.({
        type,
        text: safeText,
        ...createStreamBase(new Date(nowMs).toISOString()),
      });
    } catch {
      // Renderer observers are best-effort.
    }
  }

  /**
   * Publish the buffered text of one bounded window.
   *
   * Same-type runs are joined before redaction, which is what keeps a
   * credential assignment intact when the value arrives after a tool or status
   * event. The per-type tail is held back on a non-final flush so a credential
   * that straddles the publication boundary is still redacted as one string;
   * the held-back tail is published first on the next flush of that type.
   */
  function flushBufferedTextEvents(final: boolean) {
    const pending: Array<{ type: "answer_delta" | "thinking_delta"; text: string }> =
      bufferedTextEvents.splice(0);
    if (pending.length > 0) {
      lastTextFlushAtMs = getNowMs(options.now);
    }
    const types: Array<"answer_delta" | "thinking_delta"> = [
      ...new Set(pending.map((event) => event.type)),
    ];
    if (final) {
      // A final flush must also drain a held-back tail whose run is already
      // published, otherwise the last characters of the turn would be lost.
      for (const type of ["answer_delta", "thinking_delta"] as const) {
        if (!types.includes(type)) types.push(type);
      }
    } else if (pending.length === 0) {
      return;
    }
    for (const type of types) {
      const buffered = pending
        .filter((event) => event.type === type)
        .map((event) => event.text)
        .join("");
      const joined = pendingTextCarry[type] + buffered;
      if (!joined) {
        continue;
      }
      if (final) {
        pendingTextCarry[type] = "";
        publishTextRun(type, joined);
        continue;
      }
      if (joined.length > streamRedactionCarryChars) {
        pendingTextCarry[type] = joined.slice(-streamRedactionCarryChars);
        publishTextRun(type, joined.slice(0, -streamRedactionCarryChars));
      } else {
        pendingTextCarry[type] = joined;
      }
    }
  }

  function shouldFlushBufferedText(): boolean {
    if (bufferedTextEvents.length === 0) {
      return false;
    }
    const bufferedChars = bufferedTextEvents.reduce(
      (total, event) => total + event.text.length,
      0,
    );
    if (bufferedChars >= streamFlushMaxChars) {
      return true;
    }
    return getNowMs(options.now) - lastTextFlushAtMs >= streamFlushIntervalMs;
  }

  return {
    getSequence() {
      return sequence;
    },
    setSessionId(nextSessionId: string) {
      sessionId = nextSessionId;
    },
    send(event: Omit<ChatTaskStatusEvent, "sessionId" | "createdAt" | "elapsedMs">) {
      if (
        event.state === "paused"
        || event.state === "waiting_for_input"
        || (
          event.state === "tool_invocation"
          && event.invocationStatus === "waiting_approval"
        )
      ) {
        throw new Error(`Status ${event.state} requires durable publication.`);
      }
      publishStatusEvent(createStatusEvent(event), { persist: true });
    },
    sendPublishedOnly(
      event: Omit<ChatTaskStatusEvent, "sessionId" | "createdAt" | "elapsedMs">,
    ) {
      publishStatusEvent(createStatusEvent(event), { persist: false });
    },
    sendAttemptControl(event: {
      operation: "begin" | "supersede" | "reset" | "accepted";
      attempt: number;
      supersedesAttempt?: number;
    }) {
      flushBufferedTextEvents(true);
      currentAttempt = event.attempt;
      const nowMs = getNowMs(options.now);
      try {
        options.onStreamEvent?.({
          type: "attempt_control",
          operation: event.operation,
          controlSequence: ++attemptControlSequence,
          ...(event.supersedesAttempt
            ? { supersedesAttempt: event.supersedesAttempt }
            : {}),
          ...createStreamBase(new Date(nowMs).toISOString()),
        });
      } catch {
        // Renderer observers are best-effort.
      }
    },
    async sendWaitingForInput(
      inputRequest: SkillUserInputRequest,
      message: string,
      pendingSkillInput: SkillPendingInputState,
    ) {
      const publicInputRequest = sanitizeSkillUserInputRequest(inputRequest);
      const statusEvent = createStatusEvent({
        state: "waiting_for_input",
        message,
        selectedSkillName: publicInputRequest.skillName,
        inputRequest: publicInputRequest,
        pendingSkillInput,
      });
      if (!options.onRequiredPersistEvent) {
        throw new Error("Chat activity persistence is unavailable.");
      }
      await persistenceQueue;
      await options.onRequiredPersistEvent(statusEvent);
      if (statusEvent.pendingSkillInput?.settlementId) {
        pendingSkillInput.settlementId = statusEvent.pendingSkillInput.settlementId;
      }
      publishStatusEvent(
        {
          ...statusEvent,
          pendingSkillInput: statusEvent.pendingSkillInput
            ? { ...statusEvent.pendingSkillInput, attachmentPayloads: undefined }
            : undefined,
        },
        { persist: false },
      );
      const nowMs = getNowMs(options.now);
      try {
        options.onStreamEvent?.({
          type: "waiting_for_input",
          inputRequest: publicInputRequest,
          ...createStreamBase(new Date(nowMs).toISOString()),
        });
      } catch {
        // Renderer observers are best-effort.
      }
    },
    async sendRequired(
      event: Omit<ChatTaskStatusEvent, "sessionId" | "createdAt" | "elapsedMs">,
    ) {
      const statusEvent = createStatusEvent(event);
      if (!options.onRequiredPersistEvent) {
        await enqueuePersistence(statusEvent);
        publishStatusEvent(statusEvent, { persist: false });
        return;
      }
      await persistenceQueue;
      await options.onRequiredPersistEvent(statusEvent);
      publishStatusEvent(statusEvent, { persist: false });
    },
    setAssistantMessageId(nextAssistantMessageId: string | null | undefined) {
      assistantMessageId = nextAssistantMessageId ?? undefined;
    },
    async drainPersistence() {
      await persistenceQueue;
    },
    sendStreamEvent(event: ChatModelStreamEventInput) {
      if (event.type === "answer_delta" || event.type === "thinking_delta") {
        const previous = bufferedTextEvents.at(-1);
        if (previous?.type === event.type) previous.text += event.text;
        else bufferedTextEvents.push({ ...event });
        if (shouldFlushBufferedText()) {
          flushBufferedTextEvents(false);
        }
        return;
      }
      // Non-text events publish immediately. Buffered text deliberately keeps
      // spanning them: same-type runs are joined before redaction, so a
      // credential assignment whose value follows a tool or status event is
      // still redacted as one string. The bounded window keeps the delay small.
      const nowMs = getNowMs(options.now);
      try {
        const clonedEvent = cloneChatModelStreamEventInput(event);
        const safeEvent = event.type === "output_part"
          ? clonedEvent
          : redactCredentials(clonedEvent) as ChatModelStreamEventInput;
        options.onStreamEvent?.({
          ...safeEvent,
          ...createStreamBase(new Date(nowMs).toISOString()),
          ...(safeEvent.domainStateAvailable === false
            ? { domainStateAvailable: false as const }
            : {}),
        });
      } catch {
        // Renderer observers are best-effort.
      }
    },
    sendTerminalEvent(event: {
      type: "completed" | "failed" | "canceled";
      message?: string;
      finalMessageId?: string;
      domainStateAvailable?: false;
    }) {
      flushBufferedTextEvents(true);
      if (event.finalMessageId) {
        assistantMessageId = event.finalMessageId;
      }
      const nowMs = getNowMs(options.now);
      try {
        const safeEvent = redactCredentials(event) as typeof event;
        options.onStreamEvent?.({
          ...safeEvent,
          ...createStreamBase(new Date(nowMs).toISOString()),
          ...(safeEvent.domainStateAvailable === false
            ? { domainStateAvailable: false as const }
            : {}),
        });
      } catch {
        // Renderer observers are best-effort.
      }
    },
  };
}

type ChatModelStreamEventInput = { domainStateAvailable?: false } & (
  | { type: "answer_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "output_part"; part: ChatOutputPart }
  | {
      type: "tool_call_preview";
      toolCallId: string;
      toolName?: string;
      argumentsDelta?: string;
    }
);

function cloneChatModelStreamEventInput(
  event: ChatModelStreamEventInput,
): ChatModelStreamEventInput {
  if (event.type !== "output_part") {
    return event;
  }

  return {
    ...event,
    part: structuredClone(event.part),
  };
}

function emitModelStreamEvent(
  emitter: ReturnType<typeof createChatStatusEmitter>,
  outputAssembler: ReturnType<typeof createChatOutputAssembler>,
  event: ModelStreamEvent,
) {
  if (event.type === "content_delta") {
    emitter.sendStreamEvent({ type: "answer_delta", text: event.text });
    outputAssembler.appendText(event.text);
    return;
  }

  if (event.type === "reasoning_delta") {
    emitter.sendStreamEvent({ type: "thinking_delta", text: event.text });
    return;
  }

  if (event.type === "tool_call_delta") {
    const index = normalizeToolCallPreviewIndex(event.index);
    const toolCallId = event.id || (index !== undefined ? `index:${index}` : "");
    emitter.sendStreamEvent({
      type: "tool_call_preview",
      toolCallId,
      ...(index !== undefined ? { index } : {}),
      ...(event.name ? { toolName: event.name } : {}),
      // Raw streaming argument chunks are not independently redactable: a
      // credential key/value can straddle chunk boundaries. The accompanying
      // output_part is assembled and sanitized before renderer publication.
    });
    emitter.sendStreamEvent({
      type: "output_part",
      part: outputAssembler.appendToolCall({
        toolCallId,
        ...(event.name ? { toolName: event.name } : {}),
        ...(event.arguments ? { argumentsText: event.arguments } : {}),
      }),
    });
  }
}

function normalizeToolCallPreviewIndex(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}

function getNowMs(now: (() => Date) | undefined): number {
  return now ? now().getTime() : Date.now();
}

export {
  normalizeAgentLoopMaxTurns,
  createChatStatusEmitter,
  emitModelStreamEvent,
  getNowMs,
};
