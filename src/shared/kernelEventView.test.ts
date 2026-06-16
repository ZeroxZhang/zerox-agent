import { describe, expect, it } from "vitest";
import type { KernelEvent } from "./kernelContract";
import {
  reduceKernelEventsToRunViews,
  summarizeKernelEventForTimeline,
} from "./kernelEventView";

describe("kernel event view", () => {
  it("reduces kernel events into run views", () => {
    const views = reduceKernelEventsToRunViews([
      event({
        type: "turn_start",
        turn: 2,
        maxTurns: 8,
      }),
      event({
        type: "retry",
        attempt: 1,
        maxRetries: 2,
        afterMs: 500,
        error: "status 429",
      }),
      event({
        type: "judge_verdict",
        decision: {
          stop: false,
          reason: "missing report",
          missing: ["report.md"],
        },
      }),
      event({
        type: "run_end",
        status: "paused",
        reason: "max turns exhausted",
      }),
    ]);

    expect(views).toEqual([
      expect.objectContaining({
        runId: "run_1",
        mode: "goal",
        turn: 2,
        maxTurns: 8,
        status: "paused",
        contextUsageRatio: 0,
        lastJudgeVerdict: {
          stop: false,
          reason: "missing report",
          missing: ["report.md"],
        },
      }),
    ]);
  });

  it("summarizes long-task kernel events for timeline cards", () => {
    expect(summarizeKernelEventForTimeline(event({
      type: "compaction",
      beforeTokens: 12000,
      afterTokens: 5400,
      prunedTurns: [1, 2],
      checkpointRef: "kernel-checkpoints/run_1/checkpoint_1.json",
    }))).toEqual({
      tone: "info",
      title: "Context compacted",
      detail: "12000 -> 5400 tokens, checkpoint checkpoint_1.json",
    });
    expect(summarizeKernelEventForTimeline(event({
      type: "checkpoint_written",
      ref: "kernel-checkpoints/run_1/checkpoint_2.json",
      turn: 4,
    }))).toMatchObject({
      title: "Checkpoint written",
      detail: "turn 4, checkpoint_2.json",
    });
    expect(summarizeKernelEventForTimeline(event({
      type: "retry",
      attempt: 1,
      maxRetries: 2,
      afterMs: 500,
      error: "status 429",
    }))).toMatchObject({
      title: "Retry scheduled",
      detail: "attempt 1/2 after 500ms",
    });
    expect(summarizeKernelEventForTimeline(event({
      type: "judge_verdict",
      decision: {
        stop: true,
        reason: "all evidence present",
        evidence: ["npm run verify -> passed"],
      },
    }))).toMatchObject({
      tone: "success",
      title: "Judge verdict",
      detail: "all evidence present",
    });
  });
});

type KernelEventInput = KernelEvent extends infer TEvent
  ? TEvent extends KernelEvent
    ? Omit<TEvent, "v" | "runId" | "createdAt">
    : never
  : never;

function event(input: KernelEventInput): KernelEvent {
  return {
    v: 1,
    runId: "run_1",
    createdAt: "2026-06-16T00:00:00.000Z",
    ...input,
  } as unknown as KernelEvent;
}
