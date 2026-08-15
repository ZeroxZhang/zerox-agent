import type {
  ChatAttachmentMetadata,
  ChatStreamEvent,
  SkillUserInputRequest,
} from "../shared/chat";
import type { ChatOutputPart } from "../shared/chatOutput";

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
};

export type ActiveChatStream = {
  activeSessionId: string | null;
  activeRequestId: string | null;
};

const MAX_TRANSIENT_REASONING_CHARS = 2_000;
const MAX_TRANSIENT_TOOL_PREVIEWS = 24;

export function createChatStreamState(messages: ChatStreamMessage[]): ChatStreamState {
  return {
    messages,
    thinkingText: "",
    toolCallPreviews: [],
    pendingInputRequest: null,
    lastSequenceByRequest: {},
  };
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

  if (event.type === "answer_delta") {
    return upsertAssistantStreamMessage(sequencedState, event);
  }

  if (event.type === "output_part") {
    return upsertAssistantOutputPart(sequencedState, event);
  }

  if (event.type === "thinking_delta") {
    return {
      ...sequencedState,
      thinkingText: `${sequencedState.thinkingText}${event.text}`.slice(
        -MAX_TRANSIENT_REASONING_CHARS,
      ),
    };
  }

  if (event.type === "tool_call_preview") {
    return {
      ...sequencedState,
      toolCallPreviews: upsertToolCallPreview(
        sequencedState.toolCallPreviews,
        event,
      ).slice(-MAX_TRANSIENT_TOOL_PREVIEWS),
    };
  }

  if (event.type === "waiting_for_input") {
    return {
      ...sequencedState,
      pendingInputRequest: event.inputRequest,
    };
  }

  if (event.type === "completed" || event.type === "failed" || event.type === "canceled") {
    return {
      ...sequencedState,
      messages: sequencedState.messages.map((message) =>
        message.streamRequestId === event.requestId ? { ...message, isStreaming: false } : message,
      ),
    };
  }

  return sequencedState;
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
