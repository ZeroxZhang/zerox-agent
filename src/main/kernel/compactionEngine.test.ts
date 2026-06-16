import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatMessage } from "../openAiCompatibleClient";
import { createKernelCheckpointStore } from "./checkpointStore";
import { compactKernelContext } from "./compactionEngine";
import { KernelEventBus } from "./eventBus";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("compactKernelContext", () => {
  it("writes a checkpoint before replacing bulky historical tool results", async () => {
    const configDir = await createTempDir();
    const checkpointStore = createKernelCheckpointStore({
      configDir,
      createId: () => "checkpoint_1",
      now: () => "2026-06-16T00:00:00.000Z",
    });
    const bus = new KernelEventBus();
    const messages = createLongMessages();

    const result = await compactKernelContext({
      runId: "run_1",
      turn: 4,
      messages,
      checkpointStore,
      bus,
      now: () => "2026-06-16T00:00:01.000Z",
    }, {
      budget: 180,
      triggerRatio: 0.1,
      tailTurns: 1,
    });

    expect(result.compacted).toBe(true);
    expect(result.checkpointRef).toBe("kernel-checkpoints/run_1/checkpoint_1.json");
    expect(result.beforeTokens).toBeGreaterThan(result.afterTokens);
    expect(result.messages[0]).toEqual(messages[0]);
    expect(result.messages).toContainEqual({
      role: "user",
      content: "Recent request",
    });
    expect(result.messages).toContainEqual({
      role: "assistant",
      content: "Recent answer",
    });
    expect(JSON.stringify(result.messages)).not.toContain("X".repeat(400));

    const compactedTool = result.messages.find((message) => message.role === "tool");
    expect(JSON.parse(compactedTool?.content ?? "{}")).toEqual(
      expect.objectContaining({
        type: "tool_result_checkpoint_ref",
        checkpoint_ref: "kernel-checkpoints/run_1/checkpoint_1.json",
        original_chars: expect.any(Number),
      }),
    );

    await expect(checkpointStore.rebuild(result.checkpointRef ?? "")).resolves.toMatchObject({
      messages: [
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({
          role: "tool",
          content: expect.stringContaining("X".repeat(400)),
        }),
        expect.any(Object),
        expect.any(Object),
      ],
    });
    expect(bus.history().map((event) => event.type)).toEqual([
      "checkpoint_written",
      "compaction",
    ]);
    expect(bus.history()[1]).toMatchObject({
      type: "compaction",
      checkpointRef: "kernel-checkpoints/run_1/checkpoint_1.json",
    });
  });

  it("returns unchanged messages below the trigger threshold", async () => {
    const configDir = await createTempDir();
    const checkpointStore = createKernelCheckpointStore({
      configDir,
      createId: () => "checkpoint_1",
    });
    const bus = new KernelEventBus();
    const messages: ChatMessage[] = [
      { role: "system", content: "Short system" },
      { role: "user", content: "Short request" },
    ];

    const result = await compactKernelContext({
      runId: "run_1",
      turn: 1,
      messages,
      checkpointStore,
      bus,
    }, {
      budget: 4000,
      triggerRatio: 0.85,
      tailTurns: 1,
    });

    expect(result).toMatchObject({
      compacted: false,
      beforeTokens: result.afterTokens,
      checkpointRef: undefined,
    });
    expect(result.messages).toEqual(messages);
    expect(bus.history()).toEqual([]);
  });
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zerox-kernel-compaction-"));
  tempDirs.push(dir);
  return dir;
}

function createLongMessages(): ChatMessage[] {
  return [
    {
      role: "system",
      content: "[Goal continuity checkpoint - never compact]\nGoal: preserve this anchor",
    },
    {
      role: "user",
      content: "Older request",
    },
    {
      role: "assistant",
      content: "Older answer with tool call",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "file_read",
            arguments: JSON.stringify({ path: "large.txt" }),
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "call_1",
      content: JSON.stringify({
        type: "tool_result",
        tool: "file_read",
        ok: true,
        result: {
          content: "X".repeat(1600),
        },
      }),
    },
    {
      role: "user",
      content: "Recent request",
    },
    {
      role: "assistant",
      content: "Recent answer",
    },
  ];
}
