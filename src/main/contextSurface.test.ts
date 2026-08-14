import { describe, expect, it } from "vitest";
import type { ContextSurfaceState } from "../shared/contextSurface";
import {
  createContextSurface,
  replayContextSurface,
} from "./contextSurface";
import type { ChatMessage } from "./openAiCompatibleClient";

describe("context surface", () => {
  it("replays immutable sources and a complete transitive replacement", () => {
    const surface = createContextSurface({
      runId: "run_replay",
      initialMessages: [
        { role: "system", content: "system" },
        { role: "user", content: "old request" },
      ],
      estimateMessageTokens: tokenLength,
      now: () => "2026-08-14T09:00:00.000Z",
    });
    surface.append({ role: "assistant", content: "old answer" });
    const shadowedNodeIds = surface.visibleNodeIds();

    const replacement = surface.replace(
      [
        { role: "system", content: "checkpoint summary" },
        { role: "user", content: "recent request" },
      ],
      {
        reason: "rebuild",
        strategy: "rebuild",
        checkpointRef: "checkpoints/run_replay/1",
      },
    );
    surface.append({ role: "assistant", content: "recent answer" });

    expect(replacement.shadowedNodeIds).toEqual(shadowedNodeIds);
    expect(replacement.sourceNodeIds).toEqual(shadowedNodeIds);
    expect(surface.snapshot().events.filter((event) => event.kind === "source"))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: { role: "user", content: "old request" },
          }),
          expect.objectContaining({
            message: { role: "assistant", content: "old answer" },
          }),
        ]),
      );

    const snapshot = surface.snapshot();
    const replayed = replayContextSurface(snapshot);
    expect(replayed.messages).toEqual(surface.messages());
    expect(replayed.visibleNodeIds).toEqual(surface.visibleNodeIds());
    expect(replayed.estimatedTokens).toBe(surface.estimatedTokens());
    expect(replayed.sourceNodeIds).toEqual(
      snapshot.events
        .filter((event) => event.kind === "source")
        .map((event) => event.id),
    );
    expect(replayed.replacementCount).toBe(1);
  });

  it("updates the token meter by node delta without rescanning on reads", () => {
    let estimatorCalls = 0;
    const surface = createContextSurface({
      runId: "run_meter",
      initialMessages: [
        { role: "system", content: "abcd" },
        { role: "user", content: "ef" },
      ],
      estimateMessageTokens(message) {
        estimatorCalls += 1;
        return tokenLength(message);
      },
    });

    expect(estimatorCalls).toBe(2);
    expect(surface.estimatedTokens()).toBe(6);
    expect(surface.estimatedTokens()).toBe(6);
    expect(surface.messages()).toHaveLength(2);
    expect(estimatorCalls).toBe(2);

    surface.append({ role: "assistant", content: "ghi" });
    expect(estimatorCalls).toBe(3);
    expect(surface.estimatedTokens()).toBe(9);

    surface.replace(
      [
        { role: "system", content: "sum" },
        { role: "user", content: "tail" },
      ],
      { reason: "summarize", strategy: "summarize" },
    );
    expect(estimatorCalls).toBe(5);
    expect(surface.estimatedTokens()).toBe(7);
    expect(surface.estimatedTokens()).toBe(7);
    expect(estimatorCalls).toBe(5);
  });

  it("rejects corrupt sequence, stale shadow references, and false lineage", () => {
    const valid = createContextSurface({
      runId: "run_corrupt",
      initialMessages: [{ role: "user", content: "source" }],
      estimateMessageTokens: tokenLength,
    }).snapshot();

    expect(() =>
      replayContextSurface({
        ...valid,
        events: valid.events.map((event) => ({ ...event, sequence: 2 })),
      }),
    ).toThrow(/sequence/i);

    const stale = withReplacement(valid, {
      shadowedNodeIds: ["missing"],
      sourceNodeIds: [valid.events[0]!.id],
    });
    expect(() => replayContextSurface(stale)).toThrow(/shadow/i);

    const falseLineage = withReplacement(valid, {
      shadowedNodeIds: [valid.events[0]!.id],
      sourceNodeIds: [],
    });
    expect(() => replayContextSurface(falseLineage)).toThrow(/lineage/i);
  });

  it("rejects replacement projections that split a completed tool pair", () => {
    const assistant: ChatMessage = {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "file_read", arguments: "{}" },
        },
      ],
    };
    const tool: ChatMessage = {
      role: "tool",
      tool_call_id: "call_1",
      name: "file_read",
      content: "result",
    };
    const surface = createContextSurface({
      runId: "run_pair",
      initialMessages: [assistant, tool],
      estimateMessageTokens: tokenLength,
    });

    expect(() =>
      surface.replace([tool], {
        reason: "summarize",
        strategy: "summarize",
      }),
    ).toThrow(/tool/i);

    expect(() =>
      surface.replace([assistant, tool], {
        reason: "summarize",
        strategy: "summarize",
      }),
    ).not.toThrow();
  });

  it("requires exact checkpoint projection parity on resume", () => {
    const original = createContextSurface({
      runId: "run_resume",
      initialMessages: [{ role: "user", content: "original" }],
      estimateMessageTokens: tokenLength,
    });

    expect(() =>
      createContextSurface({
        runId: "run_resume",
        state: original.snapshot(),
        expectedMessages: [{ role: "user", content: "different" }],
        estimateMessageTokens: tokenLength,
      }),
    ).toThrow(/parity/i);
  });
});

function tokenLength(message: ChatMessage): number {
  return message.content.length;
}

function withReplacement(
  state: ContextSurfaceState,
  values: {
    shadowedNodeIds: string[];
    sourceNodeIds: string[];
  },
): ContextSurfaceState {
  return {
    ...state,
    nextSequence: 3,
    events: [
      ...state.events,
      {
        kind: "replace",
        id: "surface:run_corrupt:event:2",
        sequence: 2,
        reason: "summarize",
        strategy: "summarize",
        shadowedNodeIds: values.shadowedNodeIds,
        sourceNodeIds: values.sourceNodeIds,
        replacementNodes: [
          {
            id: "surface:run_corrupt:replacement:2:1",
            message: { role: "user", content: "summary" },
            estimatedTokens: 7,
          },
        ],
        createdAt: "2026-08-14T09:00:00.000Z",
      },
    ],
  };
}
