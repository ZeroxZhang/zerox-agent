import { describe, expect, it } from "vitest";
import {
  summarizeTrajectoryEvent,
  summarizeTrajectoryInsights,
} from "./agentTrajectoryInsights";
import type { AgentTrajectoryEvent } from "./agentTrajectory";

describe("agent trajectory insights", () => {
  it("summarizes runtime reflection, model retry, and context compaction events", () => {
    const insights = summarizeTrajectoryInsights([
      createEvent("reflection_added", {
        toolName: "file_read",
        failureClass: "budget_exhausted",
        retryAllowed: false,
        suggestion: "abort",
      }),
      createEvent("model_retry", {
        attempt: 1,
        maxRetries: 2,
        delayMs: 1000,
        error: "LLM request failed with status 500: overloaded",
      }),
      createEvent("context_compacted", {
        originalMessageCount: 18,
        compactedMessageCount: 8,
        estimatedTokens: 12000,
        tokenBudget: 5734,
      }),
    ]);

    expect(insights).toEqual([
      {
        eventId: "event_1",
        tone: "warn",
        title: "恢复停止",
        detail: "file_read: budget_exhausted -> abort",
      },
      {
        eventId: "event_2",
        tone: "info",
        title: "模型重试",
        detail: "第 1/2 次重试，等待 1000ms",
      },
      {
        eventId: "event_3",
        tone: "info",
        title: "上下文压缩",
        detail: "18 -> 8 条消息，12000/5734 tokens",
      },
    ]);
  });

  it("summarizes strategy guard events as warning insights", () => {
    expect(
      summarizeTrajectoryEvent(createEvent("strategy_guard_triggered", {
        code: "FRAGMENTED_TOOL_CALLS",
        toolName: "file_list",
        count: 4,
      })),
    ).toEqual({
      eventId: "event_4",
      tone: "warn",
      title: "策略守护",
      detail: "FRAGMENTED_TOOL_CALLS: file_list 连续触发 4 次，建议切换批量或递归策略",
    });
  });

  it("returns null for low-signal trajectory events", () => {
    expect(summarizeTrajectoryEvent(createEvent("tool_result", { ok: true }))).toBeNull();
  });
});

function createEvent(
  type: AgentTrajectoryEvent["type"],
  payload: Record<string, unknown>,
): AgentTrajectoryEvent {
  const sequence = nextSequence();
  return {
    id: `event_${sequence}`,
    runId: "run_1",
    type,
    sequence,
    payload,
    redaction: {
      containsApiKey: false,
      containsFileContent: false,
      containsUserText: false,
    },
    createdAt: "2026-06-12T00:00:00.000Z",
  };
}

let sequence = 0;

function nextSequence() {
  sequence += 1;
  return sequence;
}
