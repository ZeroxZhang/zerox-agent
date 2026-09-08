import { describe, expect, it } from "vitest";
import type { ChatStreamEvent } from "../../shared/chat";
import type {
  ChatModelCallPart,
  ChatPlanStepPart,
  ChatReasoningPart,
} from "../../shared/chatOutput";
import { createChatOutputAssembler } from "../chatOutputAssembler";
import { createChatStatusEmitter, emitModelStreamEvent } from "./streamingStatus";

// LD01 / G0 baseline: a running turn must publish assistant text and reasoning
// on a bounded time-or-byte window, in causal order, before the turn settles.
// Before the bounded publication change every case below observes zero or
// reordered deltas until the terminal event.

function createHarness(startedAtMs = 0) {
  let clockMs = startedAtMs;
  const events: ChatStreamEvent[] = [];
  const emitter = createChatStatusEmitter({
    sessionId: "session-live",
    requestId: "request-live",
    startedAtMs,
    now: () => new Date(clockMs),
    onStreamEvent: (event) => {
      events.push(event);
    },
  });
  return {
    emitter,
    events,
    advance(ms: number) {
      clockMs += ms;
    },
    textEvents() {
      return events
        .filter(
          (
            event,
          ): event is Extract<
            ChatStreamEvent,
            { type: "answer_delta" | "thinking_delta" }
          > => event.type === "answer_delta" || event.type === "thinking_delta",
        )
        .map((event) => [event.type, event.text] as const);
    },
  };
}

describe("chat status emitter live publication", () => {
  it("publishes buffered text once the time window elapses, before the turn settles", () => {
    const harness = createHarness();
    const chunk = "a".repeat(100);

    harness.emitter.sendStreamEvent({ type: "answer_delta", text: chunk });
    expect(harness.textEvents()).toEqual([]);

    harness.advance(61);
    harness.emitter.sendStreamEvent({ type: "answer_delta", text: chunk });

    const beforeTerminal = harness
      .textEvents()
      .map(([, text]) => text)
      .join("");
    expect(beforeTerminal.length).toBeGreaterThan(0);

    harness.emitter.sendTerminalEvent({ type: "completed" });
    expect(
      harness
        .textEvents()
        .map(([, text]) => text)
        .join(""),
    ).toBe(chunk + chunk);
  });

  it("publishes buffered text once the byte window is reached, losslessly", () => {
    const harness = createHarness();
    const long = "x".repeat(600);

    harness.emitter.sendStreamEvent({ type: "answer_delta", text: long });

    const beforeTerminal = harness
      .textEvents()
      .map(([, text]) => text)
      .join("");
    expect(beforeTerminal.length).toBeGreaterThan(0);

    harness.emitter.sendTerminalEvent({ type: "completed" });
    expect(
      harness
        .textEvents()
        .map(([, text]) => text)
        .join(""),
    ).toBe(long);
  });

  it("does not publish a credential assignment that straddles a publication boundary", () => {
    const harness = createHarness();

    harness.emitter.sendStreamEvent({
      type: "answer_delta",
      text: `${"padding ".repeat(20)}api_key=abc123def456`,
    });
    harness.advance(61);
    harness.emitter.sendStreamEvent({
      type: "answer_delta",
      text: "ghi789 trailing text",
    });
    harness.emitter.sendTerminalEvent({ type: "completed" });

    const published = harness
      .textEvents()
      .map(([, text]) => text)
      .join("");
    expect(published).not.toContain("abc123def456ghi789");
  });

  it("joins same-type runs and keeps type order inside one publication window", () => {
    const harness = createHarness();

    harness.emitter.sendStreamEvent({ type: "answer_delta", text: "A" });
    harness.emitter.sendStreamEvent({ type: "thinking_delta", text: "T" });
    harness.emitter.sendStreamEvent({ type: "answer_delta", text: "B" });
    harness.emitter.sendTerminalEvent({ type: "completed" });

    expect(harness.textEvents()).toEqual([
      ["answer_delta", "AB"],
      ["thinking_delta", "T"],
    ]);
  });

  it("keeps buffering across a non-text event so a straddled credential is redacted", () => {
    const harness = createHarness();

    harness.emitter.sendStreamEvent({ type: "answer_delta", text: "api_key=" });
    harness.emitter.sendStreamEvent({
      type: "tool_call_preview",
      toolCallId: "call-1",
      toolName: "shell_exec",
    });
    harness.emitter.sendStreamEvent({
      type: "answer_delta",
      text: "interleaved-stream-canary",
    });
    harness.emitter.sendTerminalEvent({ type: "completed" });

    const published = harness
      .textEvents()
      .map(([, text]) => text)
      .join("");
    expect(published).toContain("[redacted]");
    expect(published).not.toContain("interleaved-stream-canary");
  });

  it("publishes remaining text before the terminal event", () => {
    const harness = createHarness();

    harness.emitter.sendStreamEvent({ type: "answer_delta", text: "tail" });
    harness.emitter.sendTerminalEvent({ type: "completed" });

    expect(harness.events.map((event) => event.type)).toEqual([
      "answer_delta",
      "completed",
    ]);
    expect(harness.textEvents()).toEqual([["answer_delta", "tail"]]);
  });

  it("keeps stream sequence strictly increasing across a live turn", () => {
    const harness = createHarness();

    harness.emitter.sendStreamEvent({ type: "answer_delta", text: "a" });
    harness.advance(61);
    harness.emitter.sendStreamEvent({ type: "answer_delta", text: "b" });
    harness.emitter.sendStreamEvent({ type: "thinking_delta", text: "c" });
    harness.advance(61);
    harness.emitter.sendStreamEvent({ type: "thinking_delta", text: "d" });
    harness.emitter.sendTerminalEvent({ type: "completed" });

    const sequences = harness.events.map((event) => event.sequence);
    expect(sequences.length).toBeGreaterThan(2);
    expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
    expect(new Set(sequences).size).toBe(sequences.length);
  });

  it("does not split a single delta run that stays inside both windows", () => {
    const harness = createHarness();

    harness.emitter.sendStreamEvent({ type: "answer_delta", text: "one" });
    harness.advance(10);
    harness.emitter.sendStreamEvent({ type: "answer_delta", text: "two" });
    harness.advance(10);
    harness.emitter.sendStreamEvent({ type: "answer_delta", text: "three" });
    harness.emitter.sendTerminalEvent({ type: "completed" });

    expect(harness.textEvents()).toEqual([["answer_delta", "onetwothree"]]);
  });
});

// LD02 / G1: reasoning must become a durable, bounded, redacted process fact
// delivered as an output part, not only a transient thinking_delta string.
describe("chat status emitter reasoning facts", () => {
  function createReasoningHarness() {
    let clockMs = 0;
    const events: ChatStreamEvent[] = [];
    const emitter = createChatStatusEmitter({
      sessionId: "session-reasoning",
      requestId: "request-reasoning",
      startedAtMs: 0,
      now: () => new Date(clockMs),
      onStreamEvent: (event) => {
        events.push(event);
      },
    });
    const assembler = createChatOutputAssembler(
      () => "2026-09-08T00:00:00.000Z",
    );
    return {
      emitter,
      assembler,
      events,
      feed(event: Parameters<typeof emitModelStreamEvent>[2]) {
        emitModelStreamEvent(emitter, assembler, event);
      },
      reasoningParts(): ChatReasoningPart[] {
        return events.flatMap((event) =>
          event.type === "output_part" && event.part.type === "reasoning"
            ? [event.part]
            : [],
        );
      },
      advance(ms: number) {
        clockMs += ms;
      },
    };
  }

  it("delivers a bounded reasoning output part alongside the legacy thinking delta", () => {
    const harness = createReasoningHarness();

    harness.feed({ type: "reasoning_delta", text: "weighing options" });

    const parts = harness.reasoningParts();
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: "reasoning",
      text: "weighing options",
      redacted: false,
      truncated: false,
      streaming: true,
    });
    expect(
      harness.events.filter((event) => event.type === "thinking_delta"),
    ).toEqual([]);
    // The legacy channel still delivers the same text once the window closes.
    harness.emitter.sendTerminalEvent({ type: "completed" });
    expect(
      harness.events.filter((event) => event.type === "thinking_delta"),
    ).toEqual([
      expect.objectContaining({ type: "thinking_delta", text: "weighing options" }),
    ]);
  });

  it("redacts credentials and paths from the delivered reasoning part", () => {
    const harness = createReasoningHarness();

    harness.feed({
      type: "reasoning_delta",
      text: "read api_key=reasoning-canary from /Users/secret/project/notes.md",
    });

    const parts = harness.reasoningParts();
    expect(parts).toHaveLength(1);
    expect(parts[0]?.text).toContain("[redacted]");
    expect(parts[0]?.text).not.toContain("reasoning-canary");
    expect(parts[0]?.text).not.toContain("/Users/secret/project/notes.md");
    expect(parts[0]?.redacted).toBe(true);
  });

  it("closes the reasoning part once the answer text starts", () => {
    const harness = createReasoningHarness();

    harness.feed({ type: "reasoning_delta", text: "thinking" });
    harness.feed({ type: "content_delta", text: "answer" });

    const parts = harness.reasoningParts();
    expect(parts.at(-1)).toMatchObject({
      type: "reasoning",
      text: "thinking",
      streaming: false,
    });
  });
});

// LD04 / G6: plan steps and turn progress must become process facts, not just
// status summaries that the inline stream cannot see.
describe("chat status emitter plan and progress facts", () => {
  function createPlanHarness() {
    const events: ChatStreamEvent[] = [];
    const assembler = createChatOutputAssembler(
      () => "2026-09-08T00:00:00.000Z",
    );
    const emitter = createChatStatusEmitter({
      sessionId: "session-plan",
      requestId: "request-plan",
      startedAtMs: 0,
      now: () => new Date(0),
      outputAssembler: assembler,
      onStreamEvent: (event) => {
        events.push(event);
      },
    });
    return {
      emitter,
      events,
      planStepParts(): ChatPlanStepPart[] {
        return events.flatMap((event) =>
          event.type === "output_part" && event.part.type === "plan_step"
            ? [event.part]
            : [],
        );
      },
      modelCallParts(): ChatModelCallPart[] {
        return events.flatMap((event) =>
          event.type === "output_part" && event.part.type === "model_call"
            ? [event.part]
            : [],
        );
      },
    };
  }

  it("publishes one plan-step part that accumulates ordered requirements", () => {
    const harness = createPlanHarness();

    harness.emitter.send({
      state: "requirement",
      message: "子任务：更新中文小节",
      payload: {
        requirementId: "goal-requirement-1",
        label: "更新中文小节",
        status: "active",
      },
    });
    harness.emitter.send({
      state: "requirement",
      message: "子任务：同步英文小节",
      payload: {
        requirementId: "goal-requirement-2",
        label: "同步英文小节",
        status: "pending",
      },
    });

    const parts = harness.planStepParts();
    expect(parts.length).toBeGreaterThan(0);
    const latest = parts.at(-1)!;
    expect(latest.total).toBe(2);
    expect(latest.currentIndex).toBe(0);
    expect(latest.steps.map((step) => [step.id, step.status])).toEqual([
      ["goal-requirement-1", "active"],
      ["goal-requirement-2", "pending"],
    ]);
  });

  it("publishes a turn-progress part for each model turn", () => {
    const harness = createPlanHarness();

    harness.emitter.send({
      state: "model",
      message: "正在调用模型（第 2 轮）",
      turn: 2,
      toolCallsExecuted: 3,
    });

    const parts = harness.modelCallParts();
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: "model_call",
      turn: 2,
      toolCallsExecuted: 3,
    });
    // elapsedMs is derived from the emitter clock, not the caller payload.
    expect(typeof parts[0]?.elapsedMs).toBe("number");
  });

  it("does not publish process facts for unrelated status states", () => {
    const harness = createPlanHarness();

    harness.emitter.send({ state: "workspace", message: "正在确定工作区" });

    expect(harness.planStepParts()).toEqual([]);
    expect(harness.modelCallParts()).toEqual([]);
  });
});
