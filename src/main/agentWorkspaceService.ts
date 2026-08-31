import { randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  AgentRunContext,
  AgentSandboxPolicy,
  AgentWorkspace,
  AgentWorkspaceCleanup,
} from "../shared/agentWorkspace";
import {
  buildChildRunContext,
  buildDefaultSandboxPolicy,
  buildPrimaryRunContext,
} from "../shared/agentWorkspace";
import type { AgentWorkspaceStore } from "./agentWorkspaceStore";
import { assertSafeStoreEntityId } from "./storeEntityId";

const execFileAsync = promisify(execFileCallback);

export type ResolveRunContextInput = {
  workspaceId?: string;
  sandbox?: AgentSandboxPolicy;
  parentContext?: AgentRunContext;
  parentRunId?: string;
  agentRole?: "researcher" | "planner" | "executor" | "reviewer" | "critic";
  sessionId?: string;
};

export type CreateTemporaryWorkspaceInput = {
  name?: string;
  cleanup?: AgentWorkspaceCleanup;
};

export type CreateProjectWorkspaceInput = {
  rootPath: string;
  name?: string;
};

export type CreateGitWorktreeWorkspaceInput = {
  name: string;
  repositoryRoot: string;
  branch: string;
  approval?: GitWorktreeCreationApproval;
};

export type GitWorktreeCreationApproval =
  | {
      kind: "trusted_repository_policy";
      policyId: string;
    }
  | {
      kind: "tool_authorization_receipt";
      auditEventId: string;
    };

export type TrustedGitWorktreeRepositoryPolicy = {
  id: string;
  repositoryRoot: string;
};

export type AgentWorkspaceService = {
  resolveRunContext(input?: ResolveRunContextInput): Promise<AgentRunContext>;
  createTemporaryWorkspace(
    input?: CreateTemporaryWorkspaceInput,
  ): Promise<AgentWorkspace>;
  createProjectWorkspace(
    input: CreateProjectWorkspaceInput,
  ): Promise<AgentWorkspace>;
  createGitWorktreeWorkspace(
    input: CreateGitWorktreeWorkspaceInput,
  ): Promise<AgentWorkspace>;
  listWorkspaces(): Promise<AgentWorkspace[]>;
};

export function createAgentWorkspaceService(options: {
  workspaceStore: AgentWorkspaceStore;
  workspaceRoot: string;
  createId?: () => string;
  execFile?: (
    command: string,
    args: string[],
    options: { cwd?: string },
  ) => Promise<void>;
  trustedGitWorktreeRepositories?: TrustedGitWorktreeRepositoryPolicy[];
  consumeToolAuthorizationReceipt?: (input: {
    auditEventId: string;
    taskId: "agent_workspaces";
    request: {
      toolName: "git_worktree_add";
      args: { name: string; repositoryRoot: string; branch: string };
    };
  }) => Promise<boolean>;
}): AgentWorkspaceService {
  const createId = options.createId ?? randomUUID;
  const execFile =
    options.execFile ??
    (async (command, args, execOptions) => {
      await execFileAsync(command, args, execOptions);
    });

  async function ensureDefaultWorkspace(): Promise<AgentWorkspace> {
    const existing = (await options.workspaceStore.list()).find(
      (workspace) => workspace.kind === "default",
    );

    if (existing) {
      await mkdir(existing.rootPath, { recursive: true });
      return options.workspaceStore.touch(existing.id).then((workspace) => workspace ?? existing);
    }

    const rootPath = path.join(options.workspaceRoot, "default");
    await mkdir(rootPath, { recursive: true });
    return options.workspaceStore.create({
      name: "Default Workspace",
      rootPath,
      kind: "default",
      cleanup: "keep",
    });
  }

  async function resolveWorkspace(
    workspaceId: string | undefined,
  ): Promise<AgentWorkspace> {
    if (!workspaceId) {
      return ensureDefaultWorkspace();
    }

    const workspace = await options.workspaceStore.get(workspaceId);
    if (!workspace) {
      throw new Error(`Agent workspace "${workspaceId}" was not found.`);
    }

    await mkdir(workspace.rootPath, { recursive: true });
    return options.workspaceStore.touch(workspace.id).then((touched) => touched ?? workspace);
  }

  return {
    async resolveRunContext(input) {
      if (input?.parentContext) {
        return buildChildRunContext(input.parentContext, {
          parentRunId: input.parentRunId ?? "",
          agentRole: input.agentRole ?? "executor",
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          ...(input.sandbox ? { sandbox: input.sandbox } : {}),
        });
      }

      const workspace = await resolveWorkspace(input?.workspaceId);
      return buildPrimaryRunContext({
        workspaceId: workspace.id,
        workspaceRoot: workspace.rootPath,
        sandbox: input?.sandbox ?? buildDefaultSandboxPolicy(),
        ...(input?.sessionId ? { sessionId: input.sessionId } : {}),
      });
    },

    async createTemporaryWorkspace(input) {
      const id = createId();
      assertSafeStoreEntityId(id, "Temporary workspace id");
      const rootPath = path.join(options.workspaceRoot, "temporary", id);
      await mkdir(rootPath, { recursive: true });

      return options.workspaceStore.create({
        name: input?.name ?? `Temporary Workspace ${id}`,
        rootPath,
        kind: "temporary",
        cleanup: input?.cleanup ?? "keep",
      });
    },

    async createProjectWorkspace(input) {
      const rootPath = path.resolve(input.rootPath);
      const rootStats = await stat(rootPath);
      if (!rootStats.isDirectory()) {
        throw new Error(`Agent workspace path is not a directory: ${rootPath}`);
      }

      const existing = (await options.workspaceStore.list()).find((workspace) =>
        isSamePath(path.resolve(workspace.rootPath), rootPath),
      );
      if (existing) {
        return options.workspaceStore
          .touch(existing.id)
          .then((workspace) => workspace ?? existing);
      }

      return options.workspaceStore.create({
        name: input.name?.trim() || path.basename(rootPath) || rootPath,
        rootPath,
        kind: "project",
        cleanup: "keep",
      });
    },

    async createGitWorktreeWorkspace(input) {
      const repositoryRoot = path.resolve(input.repositoryRoot);
      await assertGitWorktreeCreationAllowed({
        input: { ...input, repositoryRoot },
        approval: input.approval,
        trustedPolicies: options.trustedGitWorktreeRepositories,
        consumeToolAuthorizationReceipt: options.consumeToolAuthorizationReceipt,
      });
      const id = createId();
      const worktreePath = path.join(
        options.workspaceRoot,
        "worktrees",
        sanitizePathSegment(id),
      );
      await mkdir(path.dirname(worktreePath), { recursive: true });
      await execFile(
        "git",
        ["worktree", "add", worktreePath, "-b", input.branch],
        { cwd: repositoryRoot },
      );

      return options.workspaceStore.create({
        name: input.name,
        rootPath: worktreePath,
        kind: "git_worktree",
        cleanup: "keep",
        git: {
          repositoryRoot,
          branch: input.branch,
          worktreePath,
        },
      });
    },

    listWorkspaces() {
      return options.workspaceStore.list();
    },
  };
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function assertGitWorktreeCreationAllowed(options: {
  input: Omit<CreateGitWorktreeWorkspaceInput, "approval">;
  approval: GitWorktreeCreationApproval | undefined;
  trustedPolicies: TrustedGitWorktreeRepositoryPolicy[] | undefined;
  consumeToolAuthorizationReceipt?: (input: {
    auditEventId: string;
    taskId: "agent_workspaces";
    request: {
      toolName: "git_worktree_add";
      args: { name: string; repositoryRoot: string; branch: string };
    };
  }) => Promise<boolean>;
}): Promise<void> {
  const {
    input,
    approval,
    trustedPolicies,
    consumeToolAuthorizationReceipt,
  } = options;
  if (approval?.kind === "tool_authorization_receipt") {
    const verified = Boolean(
      approval.auditEventId.trim()
      && consumeToolAuthorizationReceipt
      && await consumeToolAuthorizationReceipt({
        auditEventId: approval.auditEventId,
        taskId: "agent_workspaces",
        request: {
          toolName: "git_worktree_add",
          args: {
            name: input.name,
            repositoryRoot: input.repositoryRoot,
            branch: input.branch,
          },
        },
      }),
    );
    if (verified) return;
    throw new Error(
      "Git worktree creation requires a verified unused ToolRuntime authorization receipt.",
    );
  }

  const matchingTrustedPolicy = trustedPolicies?.find((policy) =>
    isSameOrInsidePath(input.repositoryRoot, path.resolve(policy.repositoryRoot)),
  );
  if (
    matchingTrustedPolicy
    && approval?.kind === "trusted_repository_policy"
    && approval.policyId === matchingTrustedPolicy.id
  ) {
    return;
  }

  if (approval?.kind === "trusted_repository_policy") {
    throw new Error(
      `Git worktree creation policy "${approval.policyId}" is not trusted for ${input.repositoryRoot}.`,
    );
  }

  throw new Error(
    "Git worktree creation requires a verified ToolRuntime receipt or a trusted repository policy.",
  );
}

function isSameOrInsidePath(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isSamePath(left: string, right: string): boolean {
  return path.relative(left, right) === "";
}
