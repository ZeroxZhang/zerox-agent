import { access, mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentWorkspaceService } from "./agentWorkspaceService";
import { createAgentWorkspaceStore } from "./agentWorkspaceStore";
import { createToolAuditLog } from "./toolAuditLog";

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

  it("registers an existing project folder as a selectable workspace", async () => {
    const projectRoot = path.join(workspaceRoot, "client-project");
    await mkdir(projectRoot);
    const store = createAgentWorkspaceStore({
      configDir,
      createId: () => "workspace_project",
      now: () => new Date("2026-06-08T00:00:00.000Z"),
    });
    const service = createAgentWorkspaceService({
      workspaceStore: store,
      workspaceRoot,
    });

    const workspace = await service.createProjectWorkspace({
      rootPath: projectRoot,
    });

    expect(workspace).toMatchObject({
      id: "workspace_project",
      name: "client-project",
      rootPath: projectRoot,
      kind: "project",
      cleanup: "keep",
    });
    await expect(store.list()).resolves.toHaveLength(1);
  });

  it("reuses an already registered project folder instead of duplicating it", async () => {
    let tick = 0;
    const projectRoot = path.join(workspaceRoot, "client-project");
    await mkdir(projectRoot);
    const store = createAgentWorkspaceStore({
      configDir,
      createId: () => `workspace_project_${tick}`,
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

    const first = await service.createProjectWorkspace({
      rootPath: projectRoot,
    });
    const second = await service.createProjectWorkspace({
      rootPath: `${projectRoot}/.`,
      name: "Renamed duplicate",
    });

    expect(second.id).toBe(first.id);
    expect(second.name).toBe("client-project");
    await expect(store.list()).resolves.toHaveLength(1);
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
      trustedGitWorktreeRepositories: [{
        id: "trusted-demo-repo",
        repositoryRoot: "/Users/demo/repo",
      }],
    });

    const workspace = await service.createGitWorktreeWorkspace({
      name: "Feature branch",
      repositoryRoot: "/Users/demo/repo",
      branch: "codex/feature",
      approval: {
        kind: "trusted_repository_policy",
        policyId: "trusted-demo-repo",
      },
    });

    const expectedPath = path.join(workspaceRoot, "worktrees", "feature_branch");
    expect(calls).toEqual([
      {
        command: "git",
        args: ["worktree", "add", expectedPath, "-b", "codex/feature"],
        options: { cwd: path.resolve("/Users/demo/repo") },
      },
    ]);
    expect(workspace).toMatchObject({
      id: "workspace_git",
      name: "Feature branch",
      rootPath: expectedPath,
      kind: "git_worktree",
      git: {
        repositoryRoot: path.resolve("/Users/demo/repo"),
        branch: "codex/feature",
        worktreePath: expectedPath,
      },
    });
  });

  it("refuses git worktree creation before explicit approval or trusted policy", async () => {
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

    await expect(
      service.createGitWorktreeWorkspace({
        name: "Feature branch",
        repositoryRoot: "/Users/demo/repo",
        branch: "codex/feature",
      }),
    ).rejects.toThrow(/approval|trusted/i);

    expect(calls).toEqual([]);
    await expect(store.list()).resolves.toEqual([]);
  });

  it("accepts a non-forgeable ToolRuntime authorization receipt", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const store = createAgentWorkspaceStore({
      configDir,
      createId: () => "workspace_runtime_receipt",
      now: () => new Date("2026-08-18T00:00:00.000Z"),
    });
    const auditLog = createToolAuditLog({
      configDir,
      createId: () => "audit_worktree_1",
      now: () => new Date("2026-08-18T00:00:00.000Z"),
    });
    const authorizedRequest = {
      toolName: "git_worktree_add",
      args: {
        name: "Runtime-authorized worktree",
        repositoryRoot: path.resolve("/Users/demo/repo"),
        branch: "codex/runtime-receipt",
      },
    };
    const auditEvent = await auditLog.append({
      taskId: "agent_workspaces",
      request: authorizedRequest,
      decision: { allowed: true, reason: "user approved" },
    });
    const service = createAgentWorkspaceService({
      workspaceStore: store,
      workspaceRoot,
      createId: () => "runtime_receipt_branch",
      execFile: async (command, args) => {
        calls.push({ command, args });
      },
      consumeToolAuthorizationReceipt: (input) =>
        auditLog.consumeAuthorizationReceipt(input),
    });

    await expect(service.createGitWorktreeWorkspace({
      name: "Runtime-authorized worktree",
      repositoryRoot: "/Users/demo/repo",
      branch: "codex/runtime-receipt",
      approval: {
        kind: "tool_authorization_receipt",
        auditEventId: auditEvent.id,
      },
    })).resolves.toMatchObject({ kind: "git_worktree" });
    expect(calls).toHaveLength(1);

    await expect(service.createGitWorktreeWorkspace({
      name: "Runtime-authorized worktree",
      repositoryRoot: "/Users/demo/repo",
      branch: "codex/runtime-receipt",
      approval: {
        kind: "tool_authorization_receipt",
        auditEventId: auditEvent.id,
      },
    })).rejects.toThrow(/unused ToolRuntime/);
    expect(calls).toHaveLength(1);

    await expect(service.createGitWorktreeWorkspace({
      name: "Forged worktree",
      repositoryRoot: "/Users/demo/repo",
      branch: "codex/forged-receipt",
      approval: {
        kind: "tool_authorization_receipt",
        auditEventId: "audit_forged_nonempty",
      },
    })).rejects.toThrow(/authorization|trusted/i);

    await expect(service.createGitWorktreeWorkspace({
      name: "Runtime-authorized worktree",
      repositoryRoot: "/Users/demo/repo",
      branch: "codex/changed-after-approval",
      approval: {
        kind: "tool_authorization_receipt",
        auditEventId: auditEvent.id,
      },
    })).rejects.toThrow(/verified unused ToolRuntime/);
    expect(calls).toHaveLength(1);
  });
});
