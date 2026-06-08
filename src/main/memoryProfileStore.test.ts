import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryProfileStore } from "./memoryProfileStore";
import type { MemoryRecord } from "../shared/memory";

describe("memory profile store", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-profile-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("creates a persona markdown profile from preference memories", async () => {
    const store = createMemoryProfileStore({
      configDir,
      now: () => new Date("2026-06-08T09:00:00.000Z"),
    });

    await store.updateFromMemories([
      createMemory({
        id: "mem_preference",
        content: "以后默认把报告保存成 Markdown",
      }),
    ]);

    await expect(
      readFile(path.join(configDir, "memory-persona.md"), "utf8"),
    ).resolves.toBe(
      [
        "# Memory Persona",
        "",
        "Updated: 2026-06-08T09:00:00.000Z",
        "",
        "## Preferences",
        "- [mem_preference] 以后默认把报告保存成 Markdown",
        "",
      ].join("\n"),
    );
  });

  it("does not duplicate preference bullets for the same memory id", async () => {
    const store = createMemoryProfileStore({
      configDir,
      now: () => new Date("2026-06-08T09:00:00.000Z"),
    });
    const memory = createMemory({
      id: "mem_preference",
      content: "以后默认把报告保存成 Markdown",
    });

    await store.updateFromMemories([memory]);
    await store.updateFromMemories([memory]);

    const content = await readFile(
      path.join(configDir, "memory-persona.md"),
      "utf8",
    );
    expect(content.match(/mem_preference/g)).toHaveLength(1);
  });

  it("ignores non-preference memories", async () => {
    const store = createMemoryProfileStore({
      configDir,
      now: () => new Date("2026-06-08T09:00:00.000Z"),
    });

    await store.updateFromMemories([
      createMemory({
        id: "mem_session",
        kind: "session",
        tags: ["chat", "session"],
        content: "用户：帮我整理下载文件夹",
      }),
    ]);

    await expect(
      readFile(path.join(configDir, "memory-persona.md"), "utf8"),
    ).resolves.toContain("## Preferences\n");
  });
});

function createMemory(
  partial: Pick<MemoryRecord, "id" | "content"> &
    Partial<Pick<MemoryRecord, "kind" | "tags">>,
): MemoryRecord {
  return {
    id: partial.id,
    kind: partial.kind ?? "semantic",
    title: "用户偏好",
    content: partial.content,
    tags: partial.tags ?? ["l1", "chat", "preference"],
    source: { type: "manual" },
    importance: 4,
    createdAt: "2026-06-08T09:00:00.000Z",
    updatedAt: "2026-06-08T09:00:00.000Z",
  };
}
