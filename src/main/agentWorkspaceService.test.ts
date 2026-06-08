import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentWorkspaceService } from "./agentWorkspaceService";
import { createAgentWorkspaceStore } from "./agentWorkspaceStore";

describe("agent workspace service", () => {
  let configDir: string;
  let workspaceRoot: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "zerox-workspace-config-"));
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "zerox-workspace-root-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("creates and reuses a default workspace for primary run contexts", async () => {
    let tick = 0;
    const store = createAgentWorkspaceStore({
      configDir,
      createId: () => "workspace_default",
      now: () =>
        new Date(
          [
            "2026-06-08T00:00:00.000Z",
            "2026-06-08T00:01:00.000Z",
          ][tick++]!,
        ),
    });
    const service = createAgentWorkspaceService({
      workspaceStore: store,
      workspaceRoot,
    });

    const first = await service.resolveRunContext();
    const second = await service.resolveRunContext();

    expect(first).toMatchObject({
      workspaceId: "workspace_default",
      workspaceRoot: path.join(workspaceRoot, "default"),
      agentRole: "primary",
      depth: 0,
    });
    expect(second.workspaceId).toBe(first.workspaceId);
    await expect(access(path.join(workspaceRoot, "default"))).resolves.toBeUndefined();
    await expect(store.list()).resolves.toHaveLength(1);
  });

  it("creates a temporary workspace with cleanup policy", async () => {
    const store = createAgentWorkspaceStore({
      configDir,
      createId: () => "workspace_temp",
      now: () => new Date("2026-06-08T00:00:00.000Z"),
    });
    const service = createAgentWorkspaceService({
      workspaceStore: store,
      workspaceRoot,
      createId: () => "run_tmp",
    });

    const workspace = await service.createTemporaryWorkspace({
      name: "Scratch run",
      cleanup: "delete_on_completion",
    });

    expect(workspace).toMatchObject({
      id: "workspace_temp",
      name: "Scratch run",
      rootPath: path.join(workspaceRoot, "temporary", "run_tmp"),
      kind: "temporary",
      cleanup: "delete_on_completion",
    });
    await expect(access(workspace.rootPath)).resolves.toBeUndefined();
  });

  it("creates and stores a git worktree workspace", async () => {
    const calls: Array<{
      command: string;
      args: string[];
      options: { cwd?: string };
    }> = [];
    const store = createAgentWorkspaceStore({
      configDir,
      createId: () => "workspace_git",
      now: () => new Date("2026-06-08T00:00:00.000Z"),
    });
    const service = createAgentWorkspaceService({
      workspaceStore: store,
      workspaceRoot,
      createId: () => "feature_branch",
      execFile: async (command, args, options) => {
        calls.push({ command, args, options });
      },
    });

    const workspace = await service.createGitWorktreeWorkspace({
      name: "Feature branch",
      repositoryRoot: "/Users/demo/repo",
      branch: "codex/feature",
    });

    const expectedPath = path.join(workspaceRoot, "worktrees", "feature_branch");
    expect(calls).toEqual([
      {
        command: "git",
        args: ["worktree", "add", expectedPath, "-b", "codex/feature"],
        options: { cwd: "/Users/demo/repo" },
      },
    ]);
    expect(workspace).toMatchObject({
      id: "workspace_git",
      name: "Feature branch",
      rootPath: expectedPath,
      kind: "git_worktree",
      git: {
        repositoryRoot: "/Users/demo/repo",
        branch: "codex/feature",
        worktreePath: expectedPath,
      },
    });
  });
});
