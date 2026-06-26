import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHistoryIndexStore } from "./historyIndexStore";

describe("history index store", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "zerox-history-index-"));
    filePath = path.join(tempDir, "history.jsonl");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("persists raw history entries and searches across sessions", async () => {
    const store = createHistoryIndexStore({ filePath });
    await store.append({
      id: "history_1",
      sessionId: "session_1",
      workspaceId: "workspace_a",
      role: "user",
      content: "请使用 skill_load 加载 onepager 技能",
      createdAt: "2026-06-25T00:00:01.000Z",
      source: "chat",
    });
    await store.append({
      id: "history_2",
      sessionId: "session_2",
      role: "tool",
      toolName: "file_read",
      content: "README.md content",
      pathRefs: ["/repo/README.md"],
      createdAt: "2026-06-25T00:00:02.000Z",
      source: "tool",
    });

    const reloaded = createHistoryIndexStore({ filePath });
    await expect(reloaded.search({ query: "skill_load onepager", limit: 5 })).resolves.toEqual([
      expect.objectContaining({
        entry: expect.objectContaining({
          id: "history_1",
          content: "请使用 skill_load 加载 onepager 技能",
        }),
        matchedTerms: ["skill_load", "onepager"],
      }),
    ]);
  });

  it("scopes raw history search and surrounding context by workspace and session", async () => {
    const store = createHistoryIndexStore({ filePath });
    await store.append({
      id: "history_a",
      sessionId: "session_1",
      workspaceId: "workspace_a",
      role: "tool",
      toolName: "skill_load",
      content: "workspace a skill_load onepager",
      createdAt: "2026-06-25T00:00:01.000Z",
      source: "tool",
    });
    await store.append({
      id: "history_b",
      sessionId: "session_2",
      workspaceId: "workspace_b",
      role: "tool",
      toolName: "skill_load",
      content: "workspace b skill_load onepager",
      createdAt: "2026-06-25T00:00:02.000Z",
      source: "tool",
    });

    await expect(
      store.search({
        query: "skill_load onepager",
        workspaceId: "workspace_a",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        entry: expect.objectContaining({ id: "history_a" }),
      }),
    ]);

    await expect(
      store.around({
        entryId: "history_b",
        workspaceId: "workspace_a",
      }),
    ).resolves.toBeNull();
  });

  it("returns neighboring raw history entries around a matched item", async () => {
    const store = createHistoryIndexStore({ filePath });
    await store.append({
      id: "history_before",
      sessionId: "session_1",
      role: "user",
      content: "先分析项目",
      createdAt: "2026-06-25T00:00:01.000Z",
      source: "chat",
    });
    await store.append({
      id: "history_match",
      sessionId: "session_1",
      role: "tool",
      toolName: "skill_load",
      content: "onepager instructions",
      createdAt: "2026-06-25T00:00:02.000Z",
      source: "tool",
    });
    await store.append({
      id: "history_after",
      sessionId: "session_1",
      role: "assistant",
      content: "已加载技能",
      createdAt: "2026-06-25T00:00:03.000Z",
      source: "chat",
    });

    await expect(
      store.around({ entryId: "history_match", before: 1, after: 1 }),
    ).resolves.toEqual({
      anchor: expect.objectContaining({ id: "history_match" }),
      entries: [
        expect.objectContaining({ id: "history_before" }),
        expect.objectContaining({ id: "history_match" }),
        expect.objectContaining({ id: "history_after" }),
      ],
    });
  });
});
