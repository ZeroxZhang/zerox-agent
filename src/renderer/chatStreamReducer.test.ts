import { describe, expect, it } from "vitest";
import {
  applyChatStreamEvent,
  createChatStreamState,
  finalizeChatStreamResult,
} from "./chatStreamReducer";
import type { ChatStreamEvent, SkillUserInputRequest } from "../shared/chat";
import type { ChatOutputPart } from "../shared/chatOutput";

describe("chat stream reducer", () => {
  it("streams answer deltas into one assistant placeholder and finalizes without a duplicate reply", () => {
    let state = createChatStreamState([
      {
        id: "user_1",
        role: "user",
        content: "Write the report",
        createdAt: "08:00",
      },
    ]);

    state = applyChatStreamEvent(
      state,
      createStreamEvent({ type: "answer_delta", text: "Drafting " }),
      activeStream,
    );
    state = applyChatStreamEvent(
      state,
      createStreamEvent({ type: "answer_delta", text: "now." }),
      activeStream,
    );
    state = finalizeChatStreamResult(state, {
      requestId: "request_1",
      sessionId: "session_1",
      reply: "Drafting now.",
      createdAt: "2026-06-23T08:00:05.000Z",
    });

    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]).toMatchObject({
      role: "assistant",
      content: "Drafting now.",
      streamRequestId: "request_1",
      isStreaming: false,
    });
    expect(state.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
  });

  it("removes routine orchestration replies when their state is rendered elsewhere", () => {
    let state = applyChatStreamEvent(
      createChatStreamState([]),
      createStreamEvent({ type: "answer_delta", text: "已生成计划" }),
      activeStream,
    );

    state = finalizeChatStreamResult(state, {
      requestId: "request_1",
      sessionId: "session_1",
      reply: "已生成计划，等待确认。",
      createdAt: "2026-07-31T00:00:01.000Z",
      suppressReply: true,
    });

    expect(state.messages).toEqual([]);
  });

  it("uses an ISO timestamp instead of a hardcoded relative label when finalizing non-streamed replies", () => {
    const state = finalizeChatStreamResult(createChatStreamState([]), {
      requestId: "request_1",
      sessionId: "session_1",
      reply: "Done.",
      createdAt: "2026-06-23T08:00:05.000Z",
    });

    expect(state.messages[0]).toMatchObject({
      role: "assistant",
      content: "Done.",
      createdAt: "2026-06-23T08:00:05.000Z",
    });
    expect(state.messages[0]?.createdAt).not.toBe("刚刚");
  });

  it("keeps thinking deltas and tool call previews separate from answer text", () => {
    let state = createChatStreamState([]);

    state = applyChatStreamEvent(
      state,
      createStreamEvent({ type: "thinking_delta", text: "Checking files." }),
      activeStream,
    );
    state = applyChatStreamEvent(
      state,
      createStreamEvent({
        type: "tool_call_preview",
        toolCallId: "tool_1",
        toolName: "file_read",
        argumentsDelta: '{"path":',
      }),
      activeStream,
    );
    state = applyChatStreamEvent(
      state,
      createStreamEvent({
        type: "tool_call_preview",
        toolCallId: "tool_1",
        argumentsDelta: '"notes.md"}',
      }),
      activeStream,
    );
    state = applyChatStreamEvent(
      state,
      createStreamEvent({ type: "answer_delta", text: "Done." }),
      activeStream,
    );

    expect(state.messages[0]?.content).toBe("Done.");
    expect(state.thinkingText).toBe("Checking files.");
    expect(state.toolCallPreviews).toEqual([
      {
        toolCallId: "tool_1",
        index: undefined,
        toolName: "file_read",
        argumentsText: '{"path":"notes.md"}',
      },
    ]);
  });

  it("ignores stale stream events for other sessions or requests", () => {
    const state = createChatStreamState([]);

    const nextState = applyChatStreamEvent(
      state,
      {
        ...createStreamEvent({ type: "answer_delta", text: "stale" }),
        requestId: "request_old",
      },
      activeStream,
    );

    expect(nextState).toBe(state);
    expect(nextState.messages).toEqual([]);
  });

  it("stores pending guided input requests from the active stream", () => {
    const inputRequest: SkillUserInputRequest = {
      id: "input_1",
      executionId: "execution_1",
      sessionId: "session_1",
      requestId: "request_1",
      skillName: "onepager",
      reason: "Missing fields.",
      fields: [
        { name: "title", label: "Title", type: "string", required: true },
        { name: "count", label: "Count", type: "number", required: false },
        { name: "source", label: "Source", type: "path", required: true },
        { name: "draft", label: "Draft", type: "boolean", required: false },
        {
          name: "format",
          label: "Format",
          type: "choice",
          required: true,
          choices: ["md", "html"],
        },
      ],
      createdAt: "2026-06-23T08:00:05.000Z",
    };

    const state = applyChatStreamEvent(
      createChatStreamState([]),
      createStreamEvent({ type: "waiting_for_input", inputRequest }),
      activeStream,
    );

    expect(state.pendingInputRequest).toBe(inputRequest);
  });

  it("stores live output parts in answer-led order when evidence arrives before text", () => {
    let state = createChatStreamState([]);

    state = applyChatStreamEvent(
      state,
      createStreamEvent({
        type: "output_part",
        part: {
          id: "tool_1",
          type: "tool_call",
          toolCallId: "call_1",
          toolName: "read_file",
          argsPreview: { path: "notes.md" },
          createdAt: "2026-06-23T08:00:01.000Z",
        } satisfies ChatOutputPart,
      }),
      activeStream,
    );
    state = applyChatStreamEvent(
      state,
      createStreamEvent({
        type: "output_part",
        part: {
          id: "tool_result_1",
          type: "tool_result",
          toolCallId: "call_1",
          ok: true,
          resultPreview: "notes",
          createdAt: "2026-06-23T08:00:02.000Z",
        } satisfies ChatOutputPart,
      }),
      activeStream,
    );
    state = applyChatStreamEvent(
      state,
      createStreamEvent({
        type: "output_part",
        part: {
          id: "answer_1",
          type: "text",
          text: "Answer first.\nDo not trim.  ",
          format: "markdown",
          createdAt: "2026-06-23T08:00:03.000Z",
        } satisfies ChatOutputPart,
      }),
      activeStream,
    );

    expect(state.messages[0]?.content).toBe("Answer first.\nDo not trim.  ");
    expect(state.messages[0]?.outputParts?.map((part) => part.type)).toEqual([
      "text",
      "tool_call",
      "tool_result",
    ]);
  });

  it("upserts live output parts by id", () => {
    let state = createChatStreamState([]);

    state = applyChatStreamEvent(
      state,
      createStreamEvent({
        type: "output_part",
        part: {
          id: "ledger_1",
          type: "ledger_event",
          status: "running",
          title: "Checking files",
        } satisfies ChatOutputPart,
      }),
      activeStream,
    );
    state = applyChatStreamEvent(
      state,
      createStreamEvent({
        type: "output_part",
        part: {
          id: "ledger_1",
          type: "ledger_event",
          status: "completed",
          title: "Checked files",
          detail: "2 files read",
        } satisfies ChatOutputPart,
      }),
      activeStream,
    );

    expect(state.messages[0]?.outputParts).toEqual([
      {
        id: "ledger_1",
        type: "ledger_event",
        status: "completed",
        title: "Checked files",
        detail: "2 files read",
      },
    ]);
  });
});

const activeStream = {
  activeSessionId: "session_1",
  activeRequestId: "request_1",
};

function createStreamEvent(
  event:
    | Omit<
        Extract<ChatStreamEvent, { type: "answer_delta" }>,
        "sessionId" | "requestId" | "createdAt" | "sequence" | "turnId"
      >
    | Omit<
        Extract<ChatStreamEvent, { type: "thinking_delta" }>,
        "sessionId" | "requestId" | "createdAt" | "sequence" | "turnId"
      >
    | Omit<
        Extract<ChatStreamEvent, { type: "tool_call_preview" }>,
        "sessionId" | "requestId" | "createdAt" | "sequence" | "turnId"
      >
    | Omit<
        Extract<ChatStreamEvent, { type: "output_part" }>,
        "sessionId" | "requestId" | "createdAt" | "sequence" | "turnId"
      >
    | Omit<
        Extract<ChatStreamEvent, { type: "waiting_for_input" }>,
        "sessionId" | "requestId" | "createdAt" | "sequence" | "turnId"
      >,
): ChatStreamEvent {
  return {
    ...event,
    sessionId: "session_1",
    requestId: "request_1",
    sequence: 1,
    turnId: "turn-request_1",
    createdAt: "2026-06-23T08:00:00.000Z",
  } as ChatStreamEvent;
}
