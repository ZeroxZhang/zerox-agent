import type {
  ChatAttachmentMetadata,
  ChatStreamEvent,
  ChatTaskStatusEvent,
  SkillUserInputRequest,
} from "../shared/chat";
import type { ChatOutputPart } from "../shared/chatOutput";
import { redactCredentialString } from "../shared/credentialRedaction";

export type ChatStreamMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  createdAt: string;
  streamRequestId?: string;
  isStreaming?: boolean;
  outputParts?: ChatOutputPart[];
  attachments?: ChatAttachmentMetadata[];
  goalId?: string;
  goalEventRef?: string;
};

export type ChatToolCallPreview = {
  toolCallId: string;
  index?: number;
  toolName?: string;
  argumentsText: string;
};

export type ChatStreamState = {
  messages: ChatStreamMessage[];
  thinkingText: string;
  toolCallPreviews: ChatToolCallPreview[];
  pendingInputRequest: SkillUserInputRequest | null;
  lastSequenceByRequest: Record<string, number>;
  attemptStateByRequest: Record<string, {
    activeAttempt?: number;
    acceptedAttempt?: number;
    lastControlSequence: number;
  }>;
};

export type ActiveChatStream = {
  activeSessionId: string | null;
  activeRequestId: string | null;
};

export type ChatDisclosureGroupKind =
  | "attention"
  | "narrative"
  | "operations"
  | "context"
  | "result";

export type ChatDisclosureRow = {
  id: string;
  group: ChatDisclosureGroupKind;
  label: string;
  summary: string;
  occurredAt: string;
  sequence: number;
  attention: "normal" | "prominent" | "blocking";
  expandedByDefault: boolean;
  detail?: string;
};

export type ChatDisclosureGroup = {
  id: ChatDisclosureGroupKind;
  label: string;
  rows: ChatDisclosureRow[];
  expandedByDefault: boolean;
};

const MAX_TRANSIENT_REASONING_CHARS = 2_000;
const MAX_TRANSIENT_TOOL_PREVIEWS = 24;
const disclosureGroupOrder: readonly ChatDisclosureGroupKind[] = [
  "attention",
  "narrative",
  "operations",
  "context",
  "result",
];

export function projectChatDisclosureGroups(
  events: readonly ChatTaskStatusEvent[],
): ChatDisclosureGroup[] {
  const rowsById = new Map<string, ChatDisclosureRow>();
  for (const event of events) {
    const row = projectChatDisclosureRow(event);
    const current = rowsById.get(row.id);
    if (
      !current
      || row.sequence > current.sequence
      || (
        row.sequence === current.sequence
        && row.occurredAt > current.occurredAt
      )
    ) {
      rowsById.set(row.id, row);
    }
  }

  return disclosureGroupOrder.flatMap((group) => {
    const rows = [...rowsById.values()]
      .filter((row) => row.group === group)
      .sort((left, right) =>
        left.sequence - right.sequence
        || compareStableText(left.occurredAt, right.occurredAt)
        || compareStableText(left.id, right.id),
      );
    if (rows.length === 0) return [];
    return [{
      id: group,
      label: disclosureGroupLabel(group),
      rows,
      expandedByDefault:
        group === "attention"
        || group === "narrative"
        || group === "result"
        || rows.some((row) => row.expandedByDefault),
    }];
  });
}

export function resolveChatDisclosureExpanded(input: {
  explicit?: boolean;
  defaultExpanded: boolean;
}): boolean {
  return input.explicit ?? input.defaultExpanded;
}

function projectChatDisclosureRow(
  event: ChatTaskStatusEvent,
): ChatDisclosureRow {
  const group = disclosureGroupForStatus(event.state);
  const stableSubject =
    event.toolInvocationId
    ?? event.toolCallId
    ?? event.approvalId
    ?? event.checkpointId
    ?? event.settlementId
    ?? `${event.requestId ?? event.turnId ?? "legacy"}:${event.state}`;
  const summary = redactCredentialString(event.message);
  const blocking = [
    "waiting_for_input",
    "paused",
    "failed",
  ].includes(event.state);
  return {
    id: `chat-disclosure:${group}:${stableSubject}`,
    group,
    label: disclosureRowLabel(event),
    summary,
    occurredAt: event.createdAt,
    sequence: event.sequence ?? 0,
    attention: blocking
      ? "blocking"
      : event.state === "canceled"
        ? "prominent"
        : "normal",
    expandedByDefault: blocking,
    ...(event.toolName && event.toolName !== summary
      ? { detail: redactCredentialString(event.toolName) }
      : {}),
  };
}

function disclosureGroupForStatus(
  status: ChatTaskStatusEvent["state"],
): ChatDisclosureGroupKind {
  if (["waiting_for_input", "paused", "failed"].includes(status)) {
    return "attention";
  }
  if (status === "context" || status === "memory" || status === "memory_scope") {
    return "context";
  }
  if (status === "completed" || status === "canceled") {
    return "result";
  }
  if (
    [
      "workspace",
      "skill",
      "skill_load",
      "history",
      "model",
      "reasoning",
      "streaming",
      "actor_spawned",
      "actor_done",
      "tool_invocation",
      "tool_call",
      "tool_result",
      "checkpoint_boundary",
    ].includes(status)
  ) {
    return "operations";
  }
  return "narrative";
}

function disclosureGroupLabel(group: ChatDisclosureGroupKind): string {
  if (group === "attention") return "需要处理";
  if (group === "operations") return "执行过程";
  if (group === "context") return "上下文";
  if (group === "result") return "结果";
  return "进展";
}

function disclosureRowLabel(event: ChatTaskStatusEvent): string {
  if (event.state === "failed") return "执行失败";
  if (event.state === "paused") return "执行已暂停";
  if (event.state === "waiting_for_input") return "等待输入";
  if (event.state === "completed") return "执行完成";
  if (event.state === "canceled") return "执行已取消";
  if (event.state === "context") return "上下文";
  if (event.state === "memory" || event.state === "memory_scope") return "记忆";
  if (event.state === "tool_call" || event.state === "tool_invocation") {
    return event.toolName ? `调用 ${event.toolName}` : "调用工具";
  }
  if (event.state === "tool_result") {
    return event.toolName ? `${event.toolName} 返回` : "工具返回";
  }
  if (event.state === "requirement") return "任务要求";
  return "执行进展";
}

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createChatStreamState(messages: ChatStreamMessage[]): ChatStreamState {
  return {
    messages,
    thinkingText: "",
    toolCallPreviews: [],
    pendingInputRequest: null,
    lastSequenceByRequest: {},
    attemptStateByRequest: {},
  };
}

export function getDurableChatStreamSessionId(
  event: ChatStreamEvent,
): string | null {
  return event.domainStateAvailable === true ? event.sessionId : null;
}

export function getDurableChatTaskStatusSessionId(
  event: ChatTaskStatusEvent,
): string | null {
  return event.domainStateAvailable === true ? event.sessionId : null;
}

export function applyChatStreamEvent(
  state: ChatStreamState,
  event: ChatStreamEvent,
  activeStream: ActiveChatStream,
): ChatStreamState {
  if (!isActiveStreamEvent(event, activeStream)) {
    return state;
  }
  const previousSequence = state.lastSequenceByRequest[event.requestId] ?? 0;
  if (event.sequence <= previousSequence) {
    return state;
  }
  const sequencedState: ChatStreamState = {
    ...state,
    lastSequenceByRequest: {
      ...state.lastSequenceByRequest,
      [event.requestId]: event.sequence,
    },
  };
  const reconciledState = previousSequence > 0 && event.sequence > previousSequence + 1
    ? clearTransientAttemptState(sequencedState, event.requestId)
    : sequencedState;

  if (event.type === "attempt_control") {
    return applyAttemptControl(reconciledState, event);
  }

  if (
    (
      event.type === "answer_delta"
      || event.type === "thinking_delta"
      || event.type === "tool_call_preview"
      || event.type === "output_part"
    )
    && !isCurrentAttemptEvent(reconciledState, event)
  ) {
    return reconciledState;
  }

  if (event.type === "answer_delta") {
    return upsertAssistantStreamMessage(reconciledState, event);
  }

  if (event.type === "output_part") {
    return upsertAssistantOutputPart(reconciledState, event);
  }

  if (event.type === "thinking_delta") {
    return {
      ...reconciledState,
      thinkingText: `${reconciledState.thinkingText}${event.text}`.slice(
        -MAX_TRANSIENT_REASONING_CHARS,
      ),
    };
  }

  if (event.type === "tool_call_preview") {
    return {
      ...reconciledState,
      toolCallPreviews: upsertToolCallPreview(
        reconciledState.toolCallPreviews,
        event,
      ).slice(-MAX_TRANSIENT_TOOL_PREVIEWS),
    };
  }

  if (event.type === "waiting_for_input") {
    return {
      ...reconciledState,
      pendingInputRequest: event.inputRequest,
    };
  }

  if (event.type === "completed" || event.type === "failed" || event.type === "canceled") {
    return {
      ...reconciledState,
      messages: reconciledState.messages.map((message) =>
        message.streamRequestId === event.requestId ? { ...message, isStreaming: false } : message,
      ),
    };
  }

  return reconciledState;
}

function applyAttemptControl(
  state: ChatStreamState,
  event: Extract<ChatStreamEvent, { type: "attempt_control" }>,
): ChatStreamState {
  const previous = state.attemptStateByRequest[event.requestId];
  if (previous && event.controlSequence <= previous.lastControlSequence) {
    return state;
  }
  if (previous?.acceptedAttempt !== undefined && event.operation !== "accepted") {
    return state;
  }

  const nextAttemptState = event.operation === "begin"
    ? { activeAttempt: event.attempt, lastControlSequence: event.controlSequence }
    : event.operation === "accepted"
      ? {
          acceptedAttempt: event.attempt,
          lastControlSequence: event.controlSequence,
        }
      : { lastControlSequence: event.controlSequence };
  const nextState: ChatStreamState = {
    ...state,
    attemptStateByRequest: {
      ...state.attemptStateByRequest,
      [event.requestId]: nextAttemptState,
    },
  };
  const switchedAttempt = event.operation === "begin"
    && previous?.activeAttempt !== undefined
    && previous.activeAttempt !== event.attempt;
  if (
    event.operation !== "supersede"
    && event.operation !== "reset"
    && !switchedAttempt
  ) {
    return nextState;
  }

  return clearTransientAttemptState(nextState, event.requestId);
}

function clearTransientAttemptState(
  state: ChatStreamState,
  requestId: string,
): ChatStreamState {
  return {
    ...state,
    messages: state.messages.map((message) =>
      message.role === "assistant" && message.streamRequestId === requestId
        ? {
            ...message,
            content: "",
            outputParts: message.outputParts?.filter(
              (part) => part.type !== "text" && part.type !== "tool_call",
            ),
            isStreaming: true,
          }
        : message,
    ),
    thinkingText: "",
    toolCallPreviews: [],
    pendingInputRequest:
      state.pendingInputRequest?.requestId === requestId
        ? null
        : state.pendingInputRequest,
  };
}

function isCurrentAttemptEvent(
  state: ChatStreamState,
  event: Extract<
    ChatStreamEvent,
    {
      type:
        | "answer_delta"
        | "thinking_delta"
        | "tool_call_preview"
        | "output_part";
    }
  >,
): boolean {
  const attemptState = state.attemptStateByRequest[event.requestId];
  if (!attemptState) return true;
  if (attemptState.acceptedAttempt !== undefined) return false;
  return attemptState.activeAttempt === (event.attempt ?? 1);
}

export function finalizeChatStreamResult(
  state: ChatStreamState,
  result: {
    requestId: string;
    sessionId: string;
    reply: string;
    createdAt: string;
    suppressReply?: boolean;
  },
): ChatStreamState {
  if (result.suppressReply) {
    return {
      ...state,
      messages: state.messages.filter((message) => message.streamRequestId !== result.requestId),
      pendingInputRequest:
        state.pendingInputRequest?.requestId === result.requestId
          ? null
          : state.pendingInputRequest,
    };
  }
  const existingIndex = state.messages.findIndex(
    (message) => message.role === "assistant" && message.streamRequestId === result.requestId,
  );

  if (existingIndex === -1) {
    return {
      ...state,
      messages: [
        ...state.messages,
        {
          id: createStreamMessageId(result.requestId),
          role: "assistant",
          content: result.reply,
          createdAt: result.createdAt,
          streamRequestId: result.requestId,
          isStreaming: false,
        },
      ],
      pendingInputRequest:
        state.pendingInputRequest?.requestId === result.requestId
          ? null
          : state.pendingInputRequest,
    };
  }

  return {
    ...state,
    messages: state.messages.map((message, index) =>
      index === existingIndex
        ? {
            ...message,
            content: result.reply,
            isStreaming: false,
          }
        : message,
    ),
    pendingInputRequest:
      state.pendingInputRequest?.requestId === result.requestId ? null : state.pendingInputRequest,
  };
}

export function finalizeChatStreamFailure(
  state: ChatStreamState,
  result: {
    requestId: string;
    message: string;
    createdAt: string;
  },
): ChatStreamState {
  const existingIndex = state.messages.findIndex(
    (message) =>
      message.role === "assistant" &&
      message.streamRequestId === result.requestId,
  );
  if (existingIndex === -1) {
    return {
      ...state,
      messages: [
        ...state.messages,
        {
          id: createStreamMessageId(result.requestId),
          role: "assistant",
          content: result.message,
          createdAt: result.createdAt,
          streamRequestId: result.requestId,
          isStreaming: false,
        },
      ],
      pendingInputRequest:
        state.pendingInputRequest?.requestId === result.requestId
          ? null
          : state.pendingInputRequest,
    };
  }

  return {
    ...state,
    messages: state.messages.map((message, index) =>
      index === existingIndex
        ? settleFailedStreamMessage(message, result)
        : message,
    ),
    pendingInputRequest:
      state.pendingInputRequest?.requestId === result.requestId
        ? null
        : state.pendingInputRequest,
  };
}

function settleFailedStreamMessage(
  message: ChatStreamMessage,
  result: {
    requestId: string;
    message: string;
    createdAt: string;
  },
): ChatStreamMessage {
  const outputParts = message.outputParts ?? [];
  const hasMatchingDiagnostic = outputParts.some(
    (part) =>
      part.type === "diagnostic" &&
      part.severity === "error" &&
      part.message === result.message,
  );
  return {
    ...message,
    isStreaming: false,
    ...(!hasMatchingDiagnostic
      ? {
          outputParts: [
            ...outputParts,
            {
              id: `diagnostic-${result.requestId}`,
              type: "diagnostic" as const,
              severity: "error" as const,
              title: "请求失败",
              message: result.message,
              createdAt: result.createdAt,
            },
          ],
        }
      : {}),
  };
}

function isActiveStreamEvent(event: ChatStreamEvent, activeStream: ActiveChatStream): boolean {
  if (!activeStream.activeRequestId) {
    return false;
  }

  if (event.requestId !== activeStream.activeRequestId) {
    return false;
  }

  if (activeStream.activeSessionId && event.sessionId !== activeStream.activeSessionId) {
    return false;
  }

  return true;
}

function upsertAssistantOutputPart(
  state: ChatStreamState,
  event: Extract<ChatStreamEvent, { type: "output_part" }>,
): ChatStreamState {
  let didUpdate = false;
  const messages = state.messages.map((message) => {
    if (message.role !== "assistant" || message.streamRequestId !== event.requestId) {
      return message;
    }

    didUpdate = true;
    return {
      ...message,
      content: event.part.type === "text" ? event.part.text : message.content,
      isStreaming: true,
      outputParts: upsertOutputPart(message.outputParts ?? [], event.part),
    };
  });

  if (didUpdate) {
    return { ...state, messages };
  }

  return {
    ...state,
    messages: [
      ...state.messages,
      {
        id: createStreamMessageId(event.requestId),
        role: "assistant",
        content: event.part.type === "text" ? event.part.text : "",
        createdAt: event.createdAt,
        streamRequestId: event.requestId,
        isStreaming: true,
        outputParts: upsertOutputPart([], event.part),
      },
    ],
  };
}

function upsertOutputPart(outputParts: ChatOutputPart[], part: ChatOutputPart): ChatOutputPart[] {
  let didUpdate = false;
  const nextParts = outputParts.map((existingPart) => {
    if (existingPart.id !== part.id) {
      return existingPart;
    }

    didUpdate = true;
    return part;
  });

  return didUpdate ? nextParts : [...nextParts, part];
}

function upsertAssistantStreamMessage(
  state: ChatStreamState,
  event: Extract<ChatStreamEvent, { type: "answer_delta" }>,
): ChatStreamState {
  let didUpdate = false;
  const messages = state.messages.map((message) => {
    if (message.role !== "assistant" || message.streamRequestId !== event.requestId) {
      return message;
    }

    didUpdate = true;
    return {
      ...message,
      content: `${message.content}${event.text}`,
      isStreaming: true,
    };
  });

  if (didUpdate) {
    return { ...state, messages };
  }

  return {
    ...state,
    messages: [
      ...state.messages,
      {
        id: createStreamMessageId(event.requestId),
        role: "assistant",
        content: event.text,
        createdAt: event.createdAt,
        streamRequestId: event.requestId,
        isStreaming: true,
      },
    ],
  };
}

function upsertToolCallPreview(
  previews: ChatToolCallPreview[],
  event: Extract<ChatStreamEvent, { type: "tool_call_preview" }>,
): ChatToolCallPreview[] {
  let didUpdate = false;
  const nextPreviews = previews.map((preview) => {
    if (preview.toolCallId !== event.toolCallId) {
      return preview;
    }

    didUpdate = true;
    return {
      ...preview,
      ...(event.toolName ? { toolName: event.toolName } : {}),
      argumentsText: `${preview.argumentsText}${event.argumentsDelta ?? ""}`,
    };
  });

  if (didUpdate) {
    return nextPreviews;
  }

  return [
    ...previews,
    {
      toolCallId: event.toolCallId,
      index: event.index,
      toolName: event.toolName,
      argumentsText: event.argumentsDelta ?? "",
    },
  ];
}

function createStreamMessageId(requestId: string): string {
  return `assistant-stream-${requestId}`;
}
