import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatMessage } from "../openAiCompatibleClient";
import { createKernelCheckpointStore } from "./checkpointStore";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("kernel checkpoint store", () => {
  it("writes and rebuilds full pre-compaction messages", async () => {
    const configDir = await createTempDir();
    const store = createKernelCheckpointStore({
      configDir,
      createId: () => "checkpoint_1",
      now: () => "2026-06-16T00:00:00.000Z",
    });
    const fullMessages = createMessages();

    const written = await store.writeCheckpoint({
      runId: "run_1",
      turn: 4,
      fullMessages,
      goalContinuity: "continuity snapshot",
      planSnapshot: { version: 2 },
    });

    expect(written).toMatchObject({
      ref: "kernel-checkpoints/run_1/checkpoint_1.json",
      runId: "run_1",
      turn: 4,
      fullMessages,
      goalContinuity: "continuity snapshot",
      planSnapshot: { version: 2 },
      createdAt: "2026-06-16T00:00:00.000Z",
    });

    await expect(store.readCheckpoint(written.ref)).resolves.toEqual(written);
    await expect(store.rebuild(written.ref)).resolves.toEqual({
      checkpoint: written,
      messages: fullMessages,
    });
  });

  it("returns null for missing or out-of-root refs", async () => {
    const configDir = await createTempDir();
    const store = createKernelCheckpointStore({
      configDir,
      createId: () => "checkpoint_1",
    });

    await expect(store.rebuild("kernel-checkpoints/run_1/missing.json")).resolves.toBeNull();
    await expect(store.rebuild("../outside.json")).resolves.toBeNull();
    await expect(store.readCheckpoint("kernel-checkpoints/../../outside.json")).resolves.toBeNull();
  });
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zerox-kernel-checkpoints-"));
  tempDirs.push(dir);
  return dir;
}

function createMessages(): ChatMessage[] {
  return [
    {
      role: "system",
      content: "System prompt",
    },
    {
      role: "user",
      content: "Inspect the repo",
    },
    {
      role: "tool",
      tool_call_id: "call_1",
      content: JSON.stringify({
        type: "tool_result",
        tool: "file_read",
        ok: true,
        result: {
          content: "large output",
        },
      }),
    },
  ];
}
