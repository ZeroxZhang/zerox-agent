import { describe, expect, it } from "vitest";
import type {
  ChatStreamEvent,
  ChatTaskStatusEvent,
  SkillInputResponse,
  SkillUserInputRequest,
} from "./chat";

describe("chat stream contract", () => {
  it("accepts answer and thinking text chat-layer stream events", () => {
    const answerEvent = {
      type: "answer_delta",
      sessionId: "session_1",
      requestId: "request_1",
      text: "I can do that.",
      createdAt: "2026-06-23T08:00:00.000Z",
    } satisfies ChatStreamEvent;
    const thinkingEvent = {
      type: "thinking_delta",
      sessionId: "session_1",
      requestId: "request_1",
      text: "Checking the skill contract.",
      createdAt: "2026-06-23T08:00:01.000Z",
    } satisfies ChatStreamEvent;
    const toolPreviewEvent = {
      type: "tool_call_preview",
      sessionId: "session_1",
      requestId: "request_1",
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
        createdAt: "2026-06-23T08:00:06.000Z",
      },
      {
        type: "failed",
        sessionId: "session_3",
        requestId: "request_3",
        createdAt: "2026-06-23T08:00:07.000Z",
      },
      {
        type: "canceled",
        sessionId: "session_3",
        requestId: "request_3",
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
