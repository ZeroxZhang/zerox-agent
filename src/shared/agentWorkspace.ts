import {
  isPathInsideLocationRoot,
  normalizeLocationBoundaryPath,
  normalizeLocationEnvironment,
  type LocationResourceEnvironment,
} from "./locationResource";

export type AgentWorkspaceKind =
  | "default"
  | "project"
  | "temporary"
  | "git_worktree";

export type AgentWorkspaceCleanup =
  | "keep"
  | "delete_on_success"
  | "delete_on_completion";

export type AgentWorkspaceGitMetadata = {
  repositoryRoot: string;
  branch: string;
  worktreePath: string;
};

export type AgentWorkspace = {
  id: string;
  name: string;
  rootPath: string;
  kind: AgentWorkspaceKind;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  git?: AgentWorkspaceGitMetadata;
  cleanup: AgentWorkspaceCleanup;
};

export type AgentSandboxMode = "workspace_write" | "read_only";

export type AgentSandboxNetworkMode =
  | "none"
  | "approved_domains"
  | "task_policy";

export type AgentSandboxShellMode =
  | "disabled"
  | "approved_commands"
  | "workspace_only";

export type AgentSandboxPolicy = {
  mode: AgentSandboxMode;
  network: AgentSandboxNetworkMode;
  shell: AgentSandboxShellMode;
  allowWorkspaceEscape: boolean;
  extraReadRoots: string[];
  extraWriteRoots: string[];
};

export type AgentRole =
  | "primary"
  | "researcher"
  | "planner"
  | "executor"
  | "reviewer"
  | "critic";

export type AgentRunContext = {
  workspaceId: string;
  workspaceRoot: string;
  sandbox: AgentSandboxPolicy;
  locationEnv?: Required<LocationResourceEnvironment>;
  runId?: string;
  goalId?: string;
  milestoneId?: string;
  parentRunId?: string;
  sessionId?: string;
  agentRole: AgentRole;
  depth: number;
};

export type MultiAgentSessionStatus =
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "canceled";

export type MultiAgentSession = {
  id: string;
  title: string;
  rootRunId?: string;
  status: MultiAgentSessionStatus;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  childRunIds: string[];
  roles: Record<string, AgentRole>;
};

export type BuildPrimaryRunContextInput = {
  workspaceId: string;
  workspaceRoot: string;
  sandbox?: AgentSandboxPolicy;
  locationEnv?: LocationResourceEnvironment;
  runId?: string;
  goalId?: string;
  milestoneId?: string;
  sessionId?: string;
  agentRole?: Extract<AgentRole, "primary">;
};

export type BuildChildRunContextInput = {
  parentRunId: string;
  agentRole: Exclude<AgentRole, "primary">;
  sessionId?: string;
  sandbox?: AgentSandboxPolicy;
};

export type RunContextPathAccess = "read" | "write";

export function buildDefaultSandboxPolicy(): AgentSandboxPolicy {
  return {
    mode: "workspace_write",
    network: "task_policy",
    shell: "approved_commands",
    allowWorkspaceEscape: false,
    extraReadRoots: [],
    extraWriteRoots: [],
  };
}

export function buildPrimaryRunContext(
  input: BuildPrimaryRunContextInput,
): AgentRunContext {
  const locationEnv = normalizeLocationEnvironment({
    ...input.locationEnv,
    workspaceRoot: input.workspaceRoot,
  });

  return {
    workspaceId: input.workspaceId,
    workspaceRoot: locationEnv.workspaceRoot,
    sandbox: canonicalizeSandboxPolicy(
      input.sandbox ?? buildDefaultSandboxPolicy(),
      locationEnv,
    ),
    locationEnv,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.goalId ? { goalId: input.goalId } : {}),
    ...(input.milestoneId ? { milestoneId: input.milestoneId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    agentRole: input.agentRole ?? "primary",
    depth: 0,
  };
}

export function buildChildRunContext(
  parent: AgentRunContext,
  input: BuildChildRunContextInput,
): AgentRunContext {
  const locationEnv = getRunContextLocationEnv(parent);
  const sandbox = narrowSandboxPolicy(parent.sandbox, input.sandbox, locationEnv);

  return {
    workspaceId: parent.workspaceId,
    workspaceRoot: parent.workspaceRoot,
    sandbox,
    locationEnv,
    ...(parent.goalId ? { goalId: parent.goalId } : {}),
    ...(parent.milestoneId ? { milestoneId: parent.milestoneId } : {}),
    parentRunId: input.parentRunId,
    sessionId: input.sessionId ?? parent.sessionId,
    agentRole: input.agentRole,
    depth: parent.depth + 1,
  };
}

export function isPathInsideRunContext(
  candidatePath: string,
  context: AgentRunContext,
  access: RunContextPathAccess,
): boolean {
  const locationEnv = getRunContextLocationEnv(context);
  const roots = [
    context.workspaceRoot,
    ...(access === "read"
      ? context.sandbox.extraReadRoots
      : context.sandbox.extraWriteRoots),
  ];

  return roots.some((root) =>
    isPathInsideLocationRoot(candidatePath, root, locationEnv),
  );
}

export function isPathInsideDirectory(
  candidatePath: string,
  directoryPath: string,
): boolean {
  const candidate = normalizeBoundaryPath(candidatePath);
  const directory = normalizeBoundaryPath(directoryPath);

  return candidate === directory || candidate.startsWith(`${directory}/`);
}

export function normalizeBoundaryPath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+/g, "/");

  if (normalized === "/") {
    return normalized;
  }

  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function narrowSandboxPolicy(
  parent: AgentSandboxPolicy,
  child: AgentSandboxPolicy | undefined,
  env: LocationResourceEnvironment,
): AgentSandboxPolicy {
  if (!child) {
    return {
      ...parent,
      extraReadRoots: [...parent.extraReadRoots],
      extraWriteRoots: [...parent.extraWriteRoots],
    };
  }

  const canonicalChild = canonicalizeSandboxPolicy(child, env);

  return {
    mode:
      parent.mode === "read_only" || canonicalChild.mode === "read_only"
        ? "read_only"
        : "workspace_write",
    network: narrowNetworkMode(parent.network, canonicalChild.network),
    shell: narrowShellMode(parent.shell, canonicalChild.shell),
    allowWorkspaceEscape:
      parent.allowWorkspaceEscape && canonicalChild.allowWorkspaceEscape,
    extraReadRoots: canonicalChild.extraReadRoots.filter((root) =>
      parent.extraReadRoots.some((parentRoot) =>
        isPathInsideLocationRoot(root, parentRoot, env),
      ),
    ),
    extraWriteRoots: canonicalChild.extraWriteRoots.filter((root) =>
      parent.extraWriteRoots.some((parentRoot) =>
        isPathInsideLocationRoot(root, parentRoot, env),
      ),
    ),
  };
}

function canonicalizeSandboxPolicy(
  sandbox: AgentSandboxPolicy,
  env: LocationResourceEnvironment,
): AgentSandboxPolicy {
  return {
    ...sandbox,
    extraReadRoots: unique(
      sandbox.extraReadRoots.map((root) => normalizeLocationBoundaryPath(root, env)),
    ),
    extraWriteRoots: unique(
      sandbox.extraWriteRoots.map((root) => normalizeLocationBoundaryPath(root, env)),
    ),
  };
}

function getRunContextLocationEnv(
  context: AgentRunContext,
): Required<LocationResourceEnvironment> {
  return normalizeLocationEnvironment({
    ...context.locationEnv,
    workspaceRoot: context.workspaceRoot,
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function narrowNetworkMode(
  parent: AgentSandboxNetworkMode,
  child: AgentSandboxNetworkMode,
): AgentSandboxNetworkMode {
  if (parent === "none" || child === "none") {
    return "none";
  }

  if (parent === "approved_domains" || child === "approved_domains") {
    return "approved_domains";
  }

  return "task_policy";
}

function narrowShellMode(
  parent: AgentSandboxShellMode,
  child: AgentSandboxShellMode,
): AgentSandboxShellMode {
  if (parent === "disabled" || child === "disabled") {
    return "disabled";
  }

  if (parent === "approved_commands" || child === "approved_commands") {
    return "approved_commands";
  }

  return "workspace_only";
}
