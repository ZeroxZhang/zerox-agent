import { describe, expect, it } from "vitest";
import {
  applyChatStreamEvent,
  createChatStreamState,
  finalizeChatStreamFailure,
  finalizeChatStreamResult,
  getDurableChatTaskStatusSessionId,
  getDurableChatStreamSessionId,
  projectChatDisclosureGroups,
  resolveChatDisclosureExpanded,
} from "./chatStreamReducer";
import type {
  ChatStreamEvent,
  ChatTaskStatusEvent,
  SkillUserInputRequest,
} from "../shared/chat";
import type { ChatOutputPart } from "../shared/chatOutput";

let nextSequence = 0;

describe("chat stream reducer", () => {
  it("groups status events by stable authority identity without duplicating updates", () => {
    const groups = projectChatDisclosureGroups([
      createStatusEvent({
        state: "tool_call",
        sequence: 4,
        toolInvocationId: "invocation_1",
        toolName: "file_read",
        message: "Reading file",
      }),
      createStatusEvent({
        state: "tool_result",
        sequence: 5,
        toolInvocationId: "invocation_1",
        toolName: "file_read",
        message: "Read complete",
      }),
      createStatusEvent({
        state: "completed",
        sequence: 6,
        settlementId: "settlement_1",
        message: "Task completed",
      }),
      createStatusEvent({
        state: "workspace",
        sequence: 2,
        message: "Workspace ready",
      }),
      createStatusEvent({
        state: "model",
        sequence: 3,
        message: "Model ready",
      }),
    ]);

    expect(groups.map((group) => group.id)).toEqual(["operations", "result"]);
    expect(groups[0]?.rows).toEqual([
      expect.objectContaining({ id: "chat-disclosure:operations:request_1:workspace" }),
      expect.objectContaining({ id: "chat-disclosure:operations:request_1:model" }),
      expect.objectContaining({
        id: "chat-disclosure:operations:tool-invocation:invocation_1",
        label: "file_read 返回",
        summary: "Read complete",
        sequence: 5,
      }),
    ]);
    expect(groups[1]).toMatchObject({
      id: "result",
      expandedByDefault: true,
    });
  });

  it("keeps equal text identifiers from different authority domains distinct", () => {
    const groups = projectChatDisclosureGroups([
      createStatusEvent({
        state: "tool_invocation",
        sequence: 1,
        toolInvocationId: "shared_id",
        message: "Tool started",
      }),
      createStatusEvent({
        state: "checkpoint_boundary",
        sequence: 2,
        checkpointId: "shared_id",
        message: "Checkpoint created",
      }),
    ]);

    expect(groups[0]?.rows.map((row) => row.id)).toEqual([
      "chat-disclosure:operations:tool-invocation:shared_id",
      "chat-disclosure:operations:checkpoint:shared_id",
    ]);
  });

  it("keeps failures prominent and honors explicit user expansion state", () => {
    const groups = projectChatDisclosureGroups([
      createStatusEvent({
        state: "failed",
        sequence: 7,
        message: "Validation failed. Retry the affected step.",
      }),
    ]);

    expect(groups[0]).toMatchObject({
      id: "attention",
      expandedByDefault: true,
      rows: [
        expect.objectContaining({
          attention: "blocking",
          expandedByDefault: true,
        }),
      ],
    });
    expect(resolveChatDisclosureExpanded({
      explicit: false,
      defaultExpanded: true,
    })).toBe(false);
    expect(resolveChatDisclosureExpanded({
      explicit: true,
      defaultExpanded: false,
    })).toBe(true);
  });

  it("redacts credential-shaped status summaries before projection", () => {
    const groups = projectChatDisclosureGroups([
      createStatusEvent({
        state: "tool_call",
        sequence: 2,
        toolInvocationId: "invocation_secret",
        toolName: "web_fetch",
        message: "Authorization: Bearer secret-token",
      }),
    ]);

    expect(groups[0]?.rows[0]?.summary).not.toContain("secret-token");
    expect(groups[0]?.rows[0]?.summary).toContain("[redacted]");
  });

  it("requires positive provenance before promoting a status route into a durable session", () => {
    const routeOnlyStatus: ChatTaskStatusEvent = {
      sessionId: "runtime_chat_kernel_route_only",
      requestId: "request_route_only_status",
      state: "failed",
      message: "safe failure",
      createdAt: "2026-08-18T00:00:00.000Z",
      elapsedMs: 0,
      domainStateAvailable: false,
    };
    expect(getDurableChatTaskStatusSessionId(routeOnlyStatus)).toBeNull();
    expect(getDurableChatTaskStatusSessionId({
      ...routeOnlyStatus,
      sessionId: "unpersisted",
      domainStateAvailable: undefined,
    })).toBeNull();
    expect(getDurableChatTaskStatusSessionId({
      ...routeOnlyStatus,
      sessionId: "durable",
      domainStateAvailable: true,
    })).toBe("durable");
  });

  it("requires positive provenance before promoting a terminal route into a durable session", () => {
    const routeOnlyTerminal: ChatStreamEvent = {
      type: "failed",
      sessionId: "runtime_chat_kernel_route_only",
      requestId: "request_route_only",
      sequence: 1,
      turnId: "turn-request_route_only",
      createdAt: "2026-08-18T00:00:00.000Z",
      message: "user message persistence failed",
      domainStateAvailable: false,
    };
    const durableTerminal: ChatStreamEvent = {
      ...routeOnlyTerminal,
      sessionId: "unpersisted",
      requestId: "request_durable",
      turnId: "turn-request_durable",
      domainStateAvailable: true,
    };

    expect(getDurableChatStreamSessionId(routeOnlyTerminal)).toBeNull();
    expect(getDurableChatStreamSessionId(durableTerminal)).toBe("unpersisted");
    expect(getDurableChatStreamSessionId({
      ...durableTerminal,
      domainStateAvailable: undefined,
    })).toBeNull();
  });

  it("does not promote any event from a transport-only failure packet", () => {
    const routeOnlyDiagnostic: ChatStreamEvent = {
      type: "output_part",
      sessionId: "runtime_chat_kernel_route_only",
      requestId: "request_route_only_packet",
      sequence: 1,
      turnId: "turn-request_route_only_packet",
      createdAt: "2026-08-18T00:00:00.000Z",
      domainStateAvailable: false,
      part: {
        id: "diagnostic_route_only",
        type: "diagnostic",
        createdAt: "2026-08-18T00:00:00.000Z",
        severity: "error",
        title: "请求失败",
        message: "No durable Chat state was created.",
      },
    };
    const durableDiagnostic: ChatStreamEvent = {
      ...routeOnlyDiagnostic,
      sessionId: "unpersisted",
      requestId: "request_real_unpersisted",
      turnId: "turn-request_real_unpersisted",
      domainStateAvailable: true,
    };

    expect(getDurableChatStreamSessionId(routeOnlyDiagnostic)).toBeNull();
    expect(getDurableChatStreamSessionId(durableDiagnostic)).toBe("unpersisted");
    expect(getDurableChatStreamSessionId({
      ...durableDiagnostic,
      domainStateAvailable: undefined,
    })).toBeNull();
  });

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

  it("removes a superseded partial answer and rejects late deltas from the old attempt", () => {
    let state = createChatStreamState([]);
    state = applyChatStreamEvent(
      state,
      createStreamEvent({
        type: "attempt_control",
        operation: "begin",
        attempt: 1,
        controlSequence: 1,
      }),
      activeStream,
    );
    state = applyChatStreamEvent(
      state,
      createStreamEvent({ type: "answer_delta", text: "rejected partial", attempt: 1 }),
      activeStream,
    );
    state = applyChatStreamEvent(
      state,
      createStreamEvent({ type: "thinking_delta", text: "old thought", attempt: 1 }),
      activeStream,
    );
    state = applyChatStreamEvent(
      state,
      createStreamEvent({
        type: "output_part",
        attempt: 1,
        part: {
          id: "tool_old",
          type: "tool_call",
          toolCallId: "tool_old",
          toolName: "file_read",
          createdAt: "2026-06-23T08:00:00.000Z",
        },
      }),
      activeStream,
    );
    state = applyChatStreamEvent(
      state,
      createStreamEvent({
        type: "output_part",
        attempt: 1,
        part: {
          id: "tool_result_old",
          type: "tool_result",
          toolCallId: "tool_old",
          ok: true,
          resultPreview: "rejected evidence",
          createdAt: "2026-06-23T08:00:00.000Z",
        },
      }),
      activeStream,
    );
    state = applyChatStreamEvent(
      state,
      createStreamEvent({
        type: "attempt_control",
        operation: "supersede",
        attempt: 2,
        supersedesAttempt: 1,
        controlSequence: 2,
      }),
      activeStream,
    );
    state = applyChatStreamEvent(
      state,
      createStreamEvent({
        type: "attempt_control",
        operation: "begin",
        attempt: 2,
        controlSequence: 3,
      }),
      activeStream,
    );
    state = applyChatStreamEvent(
      state,
      createStreamEvent({ type: "answer_delta", text: "late old", attempt: 1 }),
      activeStream,
    );
    state = applyChatStreamEvent(
      state,
      createStreamEvent({
        type: "output_part",
        attempt: 1,
        part: {
          id: "tool_late",
          type: "tool_call",
          toolCallId: "tool_late",
          toolName: "shell_exec",
          createdAt: "2026-06-23T08:00:00.000Z",
        },
      }),
      activeStream,
    );
    state = applyChatStreamEvent(
      state,
      createStreamEvent({ type: "answer_delta", text: "accepted full", attempt: 2 }),
      activeStream,
    );
    state = applyChatStreamEvent(
      state,
      createStreamEvent({
        type: "attempt_control",
        operation: "accepted",
        attempt: 2,
        controlSequence: 4,
      }),
      activeStream,
    );
    state = applyChatStreamEvent(
      state,
      createStreamEvent({ type: "answer_delta", text: "late after accept", attempt: 2 }),
      activeStream,
    );

    expect(state.messages[0]?.content).toBe("accepted full");
    expect(state.messages[0]?.outputParts ?? []).toEqual([]);
    expect(state.thinkingText).toBe("");
    expect(state.attemptStateByRequest.request_1).toEqual({
      acceptedAttempt: 2,
      lastControlSequence: 4,
    });
  });

  it("clears rejected transient output when a missing supersede creates a sequence gap", () => {
    let state = createChatStreamState([]);
    state = applyChatStreamEvent(state, {
      ...createStreamEvent({
        type: "attempt_control",
        operation: "begin",
        attempt: 1,
        controlSequence: 1,
      }),
      sequence: 1,
    }, activeStream);
    state = applyChatStreamEvent(state, {
      ...createStreamEvent({ type: "answer_delta", text: "rejected partial", attempt: 1 }),
      sequence: 2,
    }, activeStream);
    state = applyChatStreamEvent(state, {
      ...createStreamEvent({
        type: "attempt_control",
        operation: "begin",
        attempt: 2,
        controlSequence: 3,
      }),
      sequence: 4,
    }, activeStream);
    const afterGap = state;
    state = applyChatStreamEvent(state, {
      ...createStreamEvent({
        type: "attempt_control",
        operation: "supersede",
        attempt: 2,
        supersedesAttempt: 1,
        controlSequence: 2,
      }),
      sequence: 3,
    }, activeStream);
    expect(state).toBe(afterGap);
    state = applyChatStreamEvent(state, {
      ...createStreamEvent({ type: "answer_delta", text: "accepted full", attempt: 2 }),
      sequence: 5,
    }, activeStream);

    expect(state.messages[0]?.content).toBe("accepted full");
    expect(state.attemptStateByRequest.request_1).toEqual({
      activeAttempt: 2,
      lastControlSequence: 3,
    });
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
      "tool_call",
      "tool_result",
      "text",
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

  it("settles a streamed diagnostic failure without appending a duplicate assistant message", () => {
    let state = applyChatStreamEvent(
      createChatStreamState([]),
      createStreamEvent({
        type: "output_part",
        part: {
          id: "diagnostic_1",
          type: "diagnostic",
          severity: "error",
          title: "请求失败",
          message: "Model unavailable.",
        } satisfies ChatOutputPart,
      }),
      activeStream,
    );

    state = finalizeChatStreamFailure(state, {
      requestId: "request_1",
      message: "Model unavailable.",
      createdAt: "2026-06-23T08:00:05.000Z",
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      role: "assistant",
      content: "",
      streamRequestId: "request_1",
      isStreaming: false,
      outputParts: [
        {
          id: "diagnostic_1",
          type: "diagnostic",
          message: "Model unavailable.",
        },
      ],
    });
  });

  it("keeps partial output and appends a diagnostic for a later transport failure", () => {
    let state = applyChatStreamEvent(
      createChatStreamState([]),
      createStreamEvent({
        type: "answer_delta",
        text: "Partial answer.",
      }),
      activeStream,
    );

    state = finalizeChatStreamFailure(state, {
      requestId: "request_1",
      message: "Connection reset.",
      createdAt: "2026-06-23T08:00:05.000Z",
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      content: "Partial answer.",
      isStreaming: false,
      outputParts: [
        {
          type: "diagnostic",
          severity: "error",
          message: "Connection reset.",
        },
      ],
    });
  });
});

const activeStream = {
  activeSessionId: "session_1",
  activeRequestId: "request_1",
};

function createStreamEvent(
  event:
    | Omit<
        Extract<ChatStreamEvent, { type: "attempt_control" }>,
        "sessionId" | "requestId" | "createdAt" | "sequence" | "turnId"
      >
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
    sequence: ++nextSequence,
    turnId: "turn-request_1",
    createdAt: "2026-06-23T08:00:00.000Z",
  } as ChatStreamEvent;
}

function createStatusEvent(
  overrides: Partial<ChatTaskStatusEvent> & Pick<ChatTaskStatusEvent, "state" | "message">,
): ChatTaskStatusEvent {
  return {
    sessionId: "session_1",
    requestId: "request_1",
    turnId: "turn-request_1",
    createdAt: "2026-08-25T00:00:00.000Z",
    elapsedMs: 10,
    ...overrides,
  };
}
