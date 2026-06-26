import { describe, expect, it } from "vitest";
import type {
  ChatOutputStreamEvent,
  ChatMessageRecord,
  ChatStreamEvent,
  ChatTaskStatusEvent,
  SkillInputResponse,
  SkillInputResponseResult,
  SkillUserInputRequest,
} from "./chat";
import type { ChatOutputPart } from "./chatOutput";

describe("chat stream contract", () => {
  it("accepts answer and thinking text chat-layer stream events", () => {
    const answerEvent = {
      type: "answer_delta",
      sessionId: "session_1",
      requestId: "request_1",
      sequence: 1,
      turnId: "turn_1",
      text: "I can do that.",
      createdAt: "2026-06-23T08:00:00.000Z",
    } satisfies ChatStreamEvent;
    const thinkingEvent = {
      type: "thinking_delta",
      sessionId: "session_1",
      requestId: "request_1",
      sequence: 2,
      turnId: "turn_1",
      text: "Checking the skill contract.",
      createdAt: "2026-06-23T08:00:01.000Z",
    } satisfies ChatStreamEvent;
    const toolPreviewEvent = {
      type: "tool_call_preview",
      sessionId: "session_1",
      requestId: "request_1",
      sequence: 3,
      turnId: "turn_1",
      toolCallId: "tool_call_1",
      index: 0,
      toolName: "file_read",
      argumentsDelta: '{"path":',
      createdAt: "2026-06-23T08:00:02.000Z",
    } satisfies ChatStreamEvent;

    expect([answerEvent.text, thinkingEvent.text]).toEqual([
      "I can do that.",
      "Checking the skill contract.",
    ]);
    expect(toolPreviewEvent).toMatchObject({
      toolCallId: "tool_call_1",
      index: 0,
      toolName: "file_read",
    });
    expect(answerEvent).not.toHaveProperty("delta");
    expect(thinkingEvent).not.toHaveProperty("delta");
  });

  it("accepts output parts on chat records and as stream events", () => {
    const part = {
      id: "part_1",
      type: "ledger_event",
      status: "running",
      title: "Tool started",
      detail: "rg --files",
    } satisfies ChatOutputPart;
    const message = {
      id: "message_1",
      role: "assistant",
      content: "Working through the repo",
      outputParts: [part],
      createdAt: "2026-06-23T08:00:01.000Z",
    } satisfies ChatMessageRecord;
    const event = {
      type: "output_part",
      sessionId: "session_1",
      requestId: "request_1",
      sequence: 4,
      turnId: "turn_1",
      assistantMessageId: "message_1",
      part,
      createdAt: "2026-06-23T08:00:02.000Z",
    } satisfies ChatStreamEvent;

    expect(message.outputParts?.[0]).toBe(part);
    expect(event.part).toBe(part);
    expect(event.assistantMessageId).toBe("message_1");
  });

  it("exports a named structured output stream event type", () => {
    const event = {
      type: "output_part",
      sessionId: "session_4",
      requestId: "request_4",
      sequence: 10,
      turnId: "turn_5",
      assistantMessageId: "message_4",
      part: {
        id: "part_4",
        type: "tool_result",
        toolCallId: "call_4",
        ok: false,
        error: "Permission denied",
      },
      createdAt: "2026-06-23T08:00:09.000Z",
    } satisfies ChatOutputStreamEvent;

    const sameEvent: ChatStreamEvent = event;

    expect(event.part.type).toBe("tool_result");
    expect(sameEvent.type).toBe("output_part");
  });

  it("accepts waiting input stream events with plan-shaped guided skill fields", () => {
    const inputRequest = {
      id: "input_1",
      executionId: "execution_1",
      sessionId: "session_1",
      requestId: "request_1",
      skillName: "onepager",
      reason: "Choose the source material before the skill continues.",
      createdAt: "2026-06-23T08:00:02.000Z",
      fields: [
        {
          name: "sourcePath",
          label: "Source path",
          type: "path",
          required: true,
          description: "A workspace-local file or directory.",
          defaultValue: "/workspace/project",
        },
        {
          name: "format",
          label: "Format",
          type: "choice",
          required: true,
          choices: ["markdown", "html"],
          defaultValue: "markdown",
        },
        {
          name: "includeResearch",
          label: "Include research",
          type: "boolean",
          required: false,
          defaultValue: false,
        },
      ],
    } satisfies SkillUserInputRequest;
    const event = {
      type: "waiting_for_input",
      sessionId: "session_1",
      requestId: "request_1",
      sequence: 5,
      turnId: "turn_2",
      inputRequest,
      createdAt: "2026-06-23T08:00:02.000Z",
    } satisfies ChatStreamEvent;
    const response = {
      inputRequestId: "input_1",
      values: {
        sourcePath: "/workspace/project/brief.md",
        format: "markdown",
        includeResearch: true,
      },
    } satisfies SkillInputResponse;

    expect(event.inputRequest.fields.map((field) => field.type)).toEqual([
      "path",
      "choice",
      "boolean",
    ]);
    expect(event.inputRequest).toMatchObject({
      executionId: "execution_1",
      reason: "Choose the source material before the skill continues.",
    });
    expect(event.inputRequest.fields[1]).toMatchObject({
      type: "choice",
      choices: ["markdown", "html"],
    });
    expect(response).not.toHaveProperty("requestId");
    expect(response.values.includeResearch).toBe(true);
    expect(inputRequest).not.toHaveProperty("skillDisplayName");
    expect(inputRequest).not.toHaveProperty("message");
    expect(inputRequest.fields[0]).not.toHaveProperty("placeholder");
    expect(inputRequest.fields[0]).not.toHaveProperty("value");
    expect(inputRequest.fields[1]).not.toHaveProperty("options");
    expect(inputRequest.fields[1]).toHaveProperty("choices");
  });

  it("accepts full chat send-result shape for successful guided input responses", () => {
    const result = {
      ok: true,
      reply: "Skill run completed.",
      sessionId: "session_1",
      relatedMemories: [],
      memoryId: null,
      selectedSkill: {
        name: "research",
        displayName: "Research",
      },
      agentStatus: {
        state: "completed",
        toolCallsExecuted: 0,
      },
    } satisfies SkillInputResponseResult;

    expect(result.reply).toBe("Skill run completed.");
    expect(result.selectedSkill.name).toBe("research");
  });

  it("accepts typed status stream events for streaming and guided input", () => {
    const inputRequest = {
      id: "input_2",
      executionId: "execution_2",
      sessionId: "session_2",
      requestId: "request_2",
      skillName: "research",
      reason: "Provide the missing topic.",
      fields: [
        {
          name: "topic",
          label: "Topic",
          type: "string",
          required: true,
        },
      ],
      createdAt: "2026-06-23T08:00:03.000Z",
    } satisfies SkillUserInputRequest;
    const streamingStatus = {
      sessionId: "session_2",
      state: "streaming",
      message: "Streaming answer",
      createdAt: "2026-06-23T08:00:04.000Z",
      elapsedMs: 1000,
    } satisfies ChatTaskStatusEvent;
    const waitingStatus = {
      sessionId: "session_2",
      state: "waiting_for_input",
      message: "Waiting for guided input",
      inputRequest,
      createdAt: "2026-06-23T08:00:05.000Z",
      elapsedMs: 2000,
    } satisfies ChatTaskStatusEvent;
    const statusEvent = {
      type: "status",
      sessionId: "session_2",
      requestId: "request_2",
      sequence: 6,
      turnId: "turn_3",
      status: streamingStatus,
      createdAt: "2026-06-23T08:00:04.000Z",
    } satisfies ChatStreamEvent;

    expect([streamingStatus.state, waitingStatus.state]).toEqual([
      "streaming",
      "waiting_for_input",
    ]);
    expect(statusEvent.status).toBe(streamingStatus);
    expect(waitingStatus.inputRequest.fields[0].name).toBe("topic");
  });

  it("accepts terminal stream events without requiring messages", () => {
    const terminalEvents = [
      {
        type: "completed",
        sessionId: "session_3",
        requestId: "request_3",
        sequence: 7,
        turnId: "turn_4",
        finalMessageId: "message_3",
        createdAt: "2026-06-23T08:00:06.000Z",
      },
      {
        type: "failed",
        sessionId: "session_3",
        requestId: "request_3",
        sequence: 8,
        turnId: "turn_4",
        createdAt: "2026-06-23T08:00:07.000Z",
      },
      {
        type: "canceled",
        sessionId: "session_3",
        requestId: "request_3",
        sequence: 9,
        turnId: "turn_4",
        createdAt: "2026-06-23T08:00:08.000Z",
      },
    ] satisfies ChatStreamEvent[];

    expect(terminalEvents.map((event) => event.type)).toEqual([
      "completed",
      "failed",
      "canceled",
    ]);
    expect(terminalEvents.every((event) => !("message" in event))).toBe(true);
  });
});
