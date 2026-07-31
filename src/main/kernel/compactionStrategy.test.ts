import { describe, expect, it } from "vitest";
import { createContextManager } from "../contextManager";
import {
  createRebuildFromCheckpoint,
  createSummarizeCompaction,
  resolveCompactionFlag,
  selectCompactionStrategy,
} from "./compactionStrategy";
import { writeMarkdownCheckpoint, assertMarkdownCheckpointInvariants } from "./markdownCheckpointWriter";
import { createInMemoryStorage } from "../storage/storageDb";
import { createCheckpointRepository } from "../storage/repositories/checkpointRepository";
import { createMemoryRepository } from "../storage/repositories/memoryRepository";
import { NEVER_COMPACT_MARKER, REBUILD_BOUNDARY_MARKER, CONTEXT_BUDGET_RATIO } from "../../shared/compactionMarkers";
import type { ChatMessage } from "../openAiCompatibleClient";
import type { Goal } from "../../shared/agentGoal";

const contextManager = createContextManager({ maxTokens: 1000, recentTurnsToKeep: 2 });

function msg(role: ChatMessage["role"], content: string): ChatMessage {
  return { role, content };
}

function bigMessages(): ChatMessage[] {
  const out: ChatMessage[] = [msg("system", "sys")];
  for (let i = 0; i < 20; i++) {
    out.push(msg("user", `turn ${i} ` + "x".repeat(200)));
    out.push(msg("assistant", "y".repeat(200)));
  }
  return out;
}

function baseGoal(): Goal {
  return {
    id: "goal-1",
    description: "Rebuild context from checkpoint",
    successCriteria: [],
    milestones: [],
    status: "executing",
    budget: { maxTurns: 10, maxMinutes: 60, maxCostUsd: 1 } as Goal["budget"],
    executionUsage: { turns: 0, minutes: 0, costUsd: 0 } as Goal["executionUsage"],
    reviewPolicy: { mode: "human" } as Goal["reviewPolicy"],
    planVersion: 1,
    createdAt: "2026-06-19T00:00:00.000Z",
    updatedAt: "2026-06-19T00:00:00.000Z",
  };
}

describe("compactionMarkers", () => {
  it("exports the canonical markers + budget ratio", () => {
    expect(NEVER_COMPACT_MARKER).toContain("never compact");
    expect(REBUILD_BOUNDARY_MARKER).toContain("rebuilt");
    expect(CONTEXT_BUDGET_RATIO).toBe(0.7);
  });
});

describe("SummarizeCompaction", () => {
  it("is byte-equivalent to contextManager.compressMessages", async () => {
    const strategy = createSummarizeCompaction({ contextManager });
    const messages = bigMessages();
    const ctx = { messages, budget: 500, runId: "r1", protectedMarkers: [NEVER_COMPACT_MARKER] };
    const result = await strategy.compact(ctx);
    const direct = contextManager.compressMessages(messages, 500);
    expect(result.strategy).toBe("summarize");
    expect(result.messages).toEqual(direct);
    expect(result.compacted).toBe(true);
    expect(result.afterTokens).toBeLessThan(result.beforeTokens);
  });

  it("shouldCompact respects the budget", () => {
    const strategy = createSummarizeCompaction({ contextManager });
    expect(strategy.shouldCompact({ messages: bigMessages(), budget: 500, runId: "r1", protectedMarkers: [] })).toBe(true);
    expect(strategy.shouldCompact({ messages: [msg("system", "hi")], budget: 500, runId: "r1", protectedMarkers: [] })).toBe(false);
  });
});

describe("RebuildFromCheckpoint", () => {
  it("degrades to summarize-degraded when no checkpoint exists", async () => {
    const storage = await createInMemoryStorage();
    const ck = createCheckpointRepository(storage);
    const strategy = createRebuildFromCheckpoint({
      contextManager,
      checkpointRepository: ck,
      memoryRepository: createMemoryRepository(storage),
    });
    const result = await strategy.compact({
      messages: bigMessages(), budget: 500, runId: "r1", protectedMarkers: [NEVER_COMPACT_MARKER],
    });
    expect(result.strategy).toBe("summarize-degraded");
    expect(result.degradedReason).toBe("no-checkpoint");
    storage.close();
  });

  it("rebuilds from a markdown checkpoint + memories, inserting a rebuild boundary", async () => {
    const storage = await createInMemoryStorage();
    const ck = createCheckpointRepository(storage);
    const mem = createMemoryRepository(storage);
    // Seed a memory whose terms overlap the goal description so BM25 recalls it.
    mem.write({
      kind: "procedural", title: "Checkpoint rebuild notes", content: "Rebuild context from checkpoint after overflow.",
      tags: ["rebuild"], source: { type: "manual" }, importance: 4,
      id: "mem-1", createdAt: "2026-06-19T00:00:00.000Z", updatedAt: "2026-06-19T00:00:00.000Z",
    });
    // Write a markdown checkpoint via the transition writer.
    writeMarkdownCheckpoint({ runId: "r1", goal: baseGoal(), checkpointRepository: ck, now: "2026-06-19T00:00:00.000Z" });

    const strategy = createRebuildFromCheckpoint({
      contextManager, checkpointRepository: ck, memoryRepository: mem,
    });
    const result = await strategy.compact({
      messages: bigMessages(), budget: 500, runId: "r1", protectedMarkers: [NEVER_COMPACT_MARKER],
    });
    expect(result.strategy).toBe("rebuild");
    expect(result.rebuilt).toBe(true);
    expect(result.checkpointRef).toBeTruthy();
    expect(result.memoryHits).toContain("mem-1");
    expect(result.messages.some((m) => m.content.includes(NEVER_COMPACT_MARKER))).toBe(true);
    expect(result.messages.some((m) => m.content.includes(REBUILD_BOUNDARY_MARKER))).toBe(true);
    storage.close();
  });

  it("preserves tool-call pairs when rebuilding a compacted tail", async () => {
    const storage = await createInMemoryStorage();
    const ck = createCheckpointRepository(storage);
    writeMarkdownCheckpoint({
      runId: "r1",
      goal: baseGoal(),
      checkpointRepository: ck,
      now: "2026-06-19T00:00:00.000Z",
    });
    const assistantCall: ChatMessage = {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call_file_read",
          type: "function",
          function: { name: "file_read", arguments: '{"path":"README.md"}' },
        },
      ],
    };
    const toolResult: ChatMessage = {
      role: "tool",
      tool_call_id: "call_file_read",
      name: "file_read",
      content: "README content",
    };
    const strategy = createRebuildFromCheckpoint({
      contextManager,
      checkpointRepository: ck,
      rebuildTailTokens: 1,
    });

    const result = await strategy.compact({
      messages: [msg("user", "old"), assistantCall, toolResult],
      budget: 1,
      runId: "r1",
      protectedMarkers: [NEVER_COMPACT_MARKER],
    });

    expect(result.messages).toEqual(
      expect.arrayContaining([assistantCall, toolResult]),
    );
    storage.close();
  });
});

describe("selectCompactionStrategy + flag", () => {
  it("summarize flag selects SummarizeCompaction", () => {
    const s = selectCompactionStrategy("summarize", { contextManager });
    expect(s.id).toBe("summarize");
  });
  it("auto/rebuild flag selects RebuildFromCheckpoint (degrades without checkpoint)", () => {
    expect(selectCompactionStrategy("auto", { contextManager }).id).toBe("rebuild");
    expect(selectCompactionStrategy("rebuild", { contextManager }).id).toBe("rebuild");
  });
  it("resolveCompactionFlag defaults to auto", () => {
    expect(resolveCompactionFlag({})).toBe("auto");
    expect(resolveCompactionFlag({ ZEROX_COMPACTION_STRATEGY: "summarize" })).toBe("summarize");
    expect(resolveCompactionFlag({ ZEROX_COMPACTION_STRATEGY: "rebuild" })).toBe("rebuild");
  });
});

describe("markdownCheckpointWriter", () => {
  it("writes a markdown-v1 checkpoint the repository can read back", async () => {
    const storage = await createInMemoryStorage();
    const ck = createCheckpointRepository(storage);
    const ref = writeMarkdownCheckpoint({ runId: "r1", goal: baseGoal(), checkpointRepository: ck });
    expect(ref).toBeTruthy();
    const latest = ck.latest("r1", "markdown");
    expect(latest).not.toBeNull();
    const data = latest!.payload as { format: string; content: string; source: string };
    expect(data.format).toBe("markdown-v1");
    expect(data.source).toBe("p2-transition");
    assertMarkdownCheckpointInvariants(data.content);
    storage.close();
  });

  it("rejects content missing invariants", () => {
    expect(() => assertMarkdownCheckpointInvariants("not a checkpoint")).toThrow();
  });
});

describe("RebuildFromCheckpoint P5 activation (checkpoint writer trigger)", () => {
  it("invokes the checkpoint writer before reading, then rebuilds from the written checkpoint", async () => {
    const storage = await createInMemoryStorage();
    const ck = createCheckpointRepository(storage);
    const mem = createMemoryRepository(storage);
    let writerCalls = 0;
    const strategy = createRebuildFromCheckpoint({
      contextManager,
      checkpointRepository: ck,
      memoryRepository: mem,
      checkpointWriter: {
        async maybeWriteCheckpoint(input: { parentRunId: string }) {
          writerCalls += 1;
          // Simulate the fork agent writing a checkpoint.
          ck.write(input.parentRunId, "markdown", { format: "markdown-v1", content: "# Checkpoint\n[Goal continuity checkpoint - never compact]\nrebuilt", source: "p5-fork", createdAt: "2026-06-19T00:00:00.000Z" });
        },
      },
    });
    const result = await strategy.compact({
      messages: bigMessages(), budget: 500, runId: "r1", protectedMarkers: [NEVER_COMPACT_MARKER],
    });
    expect(writerCalls).toBe(1);
    expect(result.strategy).toBe("rebuild");
    expect(result.checkpointRef).toBeTruthy();
    storage.close();
  });
});
