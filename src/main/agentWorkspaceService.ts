import { randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir } from "node:fs/promises";
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

export type CreateGitWorktreeWorkspaceInput = {
  name: string;
  repositoryRoot: string;
  branch: string;
  approval?: GitWorktreeCreationApproval;
};

export type GitWorktreeCreationApproval =
  | {
      kind: "explicit_user_approval";
      approvedAt: string;
      approvedBy: "user";
    }
  | {
      kind: "trusted_repository_policy";
      policyId: string;
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
      const rootPath = path.join(options.workspaceRoot, "temporary", id);
      await mkdir(rootPath, { recursive: true });

      return options.workspaceStore.create({
        name: input?.name ?? `Temporary Workspace ${id}`,
        rootPath,
        kind: "temporary",
        cleanup: input?.cleanup ?? "keep",
      });
    },

    async createGitWorktreeWorkspace(input) {
      const repositoryRoot = path.resolve(input.repositoryRoot);
      assertGitWorktreeCreationAllowed(
        repositoryRoot,
        input.approval,
        options.trustedGitWorktreeRepositories,
      );
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

function assertGitWorktreeCreationAllowed(
  repositoryRoot: string,
  approval: GitWorktreeCreationApproval | undefined,
  trustedPolicies: TrustedGitWorktreeRepositoryPolicy[] | undefined,
): void {
  if (approval?.kind === "explicit_user_approval") {
    return;
  }

  const matchingTrustedPolicy = trustedPolicies?.find((policy) =>
    isSameOrInsidePath(repositoryRoot, path.resolve(policy.repositoryRoot)),
  );
  if (matchingTrustedPolicy) {
    return;
  }

  if (approval?.kind === "trusted_repository_policy") {
    throw new Error(
      `Git worktree creation policy "${approval.policyId}" is not trusted for ${repositoryRoot}.`,
    );
  }

  throw new Error(
    "Git worktree creation requires explicit user approval or a trusted repository policy.",
  );
}

function isSameOrInsidePath(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
