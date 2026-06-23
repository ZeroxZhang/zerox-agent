import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
  ChatStreamEvent,
  ChatTaskStatusEvent,
  SkillInputResponse,
  SkillUserInputRequest,
} from "./chat";

const chatSource = readFileSync(
  path.join(process.cwd(), "src/shared/chat.ts"),
  "utf8",
);

describe("chat stream contract", () => {
  it("accepts answer and thinking delta chat-layer stream events", () => {
    const answerEvent = {
      type: "answer_delta",
      sessionId: "session_1",
      requestId: "request_1",
      delta: "I can do that.",
      createdAt: "2026-06-23T08:00:00.000Z",
    } satisfies ChatStreamEvent;
    const thinkingEvent = {
      type: "thinking_delta",
      sessionId: "session_1",
      requestId: "request_1",
      delta: "Checking the skill contract.",
      createdAt: "2026-06-23T08:00:01.000Z",
    } satisfies ChatStreamEvent;

    expect([answerEvent.type, thinkingEvent.type]).toEqual([
      "answer_delta",
      "thinking_delta",
    ]);
    expect(chatSource).toContain('type: "answer_delta"');
    expect(chatSource).toContain('type: "thinking_delta"');
    expect(chatSource).toContain('type: "tool_call_delta"');
  });

  it("accepts waiting input stream events with guided skill fields", () => {
    const inputRequest = {
      id: "input_1",
      sessionId: "session_1",
      requestId: "request_1",
      skillName: "onepager",
      skillDisplayName: "OnePager",
      message: "Choose the source material before the skill continues.",
      createdAt: "2026-06-23T08:00:02.000Z",
      fields: [
        {
          name: "sourcePath",
          label: "Source path",
          type: "path",
          required: true,
          description: "A workspace-local file or directory.",
          placeholder: "/workspace/project/brief.md",
          defaultValue: "/workspace/project",
          value: "/workspace/project/brief.md",
          validationMessage: "Pick a path inside the workspace.",
        },
        {
          name: "format",
          label: "Format",
          type: "select",
          required: true,
          options: [
            { label: "Markdown", value: "markdown" },
            { label: "HTML", value: "html" },
          ],
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
      requestId: "request_1",
      inputRequestId: "input_1",
      values: {
        sourcePath: "/workspace/project/brief.md",
        format: "markdown",
        includeResearch: true,
      },
    } satisfies SkillInputResponse;

    expect(event.inputRequest.fields.map((field) => field.type)).toEqual([
      "path",
      "select",
      "boolean",
    ]);
    expect(response.values.includeResearch).toBe(true);
    expect(chatSource).toContain("export type SkillInputField");
    expect(chatSource).toContain("export type SkillUserInputRequest");
    expect(chatSource).toContain("export type SkillInputResponse");
  });

  it("accepts typed status states for streaming and guided input", () => {
    const inputRequest = {
      id: "input_2",
      sessionId: "session_2",
      requestId: "request_2",
      skillName: "research",
      skillDisplayName: "Research",
      message: "Provide the missing topic.",
      fields: [
        {
          name: "topic",
          label: "Topic",
          type: "text",
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

    expect([streamingStatus.state, waitingStatus.state]).toEqual([
      "streaming",
      "waiting_for_input",
    ]);
    expect(waitingStatus.inputRequest.fields[0].name).toBe("topic");
  });
});
