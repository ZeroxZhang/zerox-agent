import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentWorkspaceStore } from "./agentWorkspaceStore";

describe("agent workspace store", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "zerox-workspaces-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("creates and persists a project workspace", async () => {
    const store = createAgentWorkspaceStore({
      configDir,
      createId: () => "workspace_1",
      now: () => new Date("2026-06-08T00:00:00.000Z"),
    });

    const workspace = await store.create({
      name: "Project",
      rootPath: "/Users/demo/project",
      kind: "project",
      cleanup: "keep",
    });

    expect(workspace).toEqual({
      id: "workspace_1",
      name: "Project",
      rootPath: "/Users/demo/project",
      kind: "project",
      createdAt: "2026-06-08T00:00:00.000Z",
      updatedAt: "2026-06-08T00:00:00.000Z",
      lastUsedAt: null,
      cleanup: "keep",
    });
    await expect(store.get("workspace_1")).resolves.toEqual(workspace);
    const raw = await readFile(
      path.join(configDir, "agent-workspaces.json"),
      "utf8",
    );
    expect(JSON.parse(raw)).toMatchObject({
      schemaVersion: 1,
      workspaces: [workspace],
    });
  });

  it("touches a workspace and lists most recently used first", async () => {
    let tick = 0;
    const dates = [
      "2026-06-08T00:00:00.000Z",
      "2026-06-08T00:01:00.000Z",
      "2026-06-08T00:02:00.000Z",
      "2026-06-08T00:03:00.000Z",
    ];
    const store = createAgentWorkspaceStore({
      configDir,
      createId: () => `workspace_${tick + 1}`,
      now: () => new Date(dates[tick++] ?? dates.at(-1)!),
    });

    const first = await store.create({
      name: "First",
      rootPath: "/tmp/first",
      kind: "default",
      cleanup: "keep",
    });
    const second = await store.create({
      name: "Second",
      rootPath: "/tmp/second",
      kind: "temporary",
      cleanup: "delete_on_completion",
    });

    await expect(store.touch(first.id)).resolves.toMatchObject({
      id: first.id,
      lastUsedAt: "2026-06-08T00:02:00.000Z",
      updatedAt: "2026-06-08T00:02:00.000Z",
    });
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ id: first.id }),
      expect.objectContaining({ id: second.id }),
    ]);
  });

  it("saves git worktree metadata and deletes by id", async () => {
    const store = createAgentWorkspaceStore({
      configDir,
      createId: () => "workspace_git",
      now: () => new Date("2026-06-08T00:00:00.000Z"),
    });

    await store.create({
      name: "Feature worktree",
      rootPath: "/tmp/worktrees/feature",
      kind: "git_worktree",
      cleanup: "keep",
      git: {
        repositoryRoot: "/tmp/repo",
        branch: "codex/feature",
        worktreePath: "/tmp/worktrees/feature",
      },
    });

    await expect(store.get("workspace_git")).resolves.toMatchObject({
      kind: "git_worktree",
      git: {
        repositoryRoot: "/tmp/repo",
        branch: "codex/feature",
        worktreePath: "/tmp/worktrees/feature",
      },
    });
    await expect(store.delete("missing")).resolves.toBe(false);
    await expect(store.delete("workspace_git")).resolves.toBe(true);
    await expect(store.get("workspace_git")).resolves.toBeNull();
  });
});
