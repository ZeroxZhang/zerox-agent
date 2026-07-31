import {
  isPathInsideLocationRoot,
  normalizeLocationBoundaryPath,
  normalizeLocationEnvironment,
  validatePathInsideLocationRoots,
  type LocationPathBoundaryResult,
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
  runMode?: "execution" | "plan";
  agentRole: AgentRole;
  depth: number;
};

export type WorkspaceContract = {
  workspaceId: string;
  name: string;
  rootPath: string;
  kind: AgentWorkspaceKind;
  sandboxMode: AgentSandboxPolicy["mode"];
  writableRoots: string[];
  readableRoots: string[];
  networkAllowed: boolean;
  shellAllowed: boolean;
  git?: AgentWorkspaceGitMetadata;
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

export function toWorkspaceContract(
  workspace: AgentWorkspace,
  runContext: AgentRunContext,
): WorkspaceContract {
  const writableRoots =
    runContext.sandbox.mode === "workspace_write"
      ? unique([runContext.workspaceRoot, ...runContext.sandbox.extraWriteRoots])
      : [];
  const readableRoots = unique([
    runContext.workspaceRoot,
    ...runContext.sandbox.extraReadRoots,
    ...writableRoots,
  ]);

  return {
    workspaceId: workspace.id,
    name: workspace.name,
    rootPath: runContext.workspaceRoot,
    kind: workspace.kind,
    sandboxMode: runContext.sandbox.mode,
    writableRoots,
    readableRoots,
    networkAllowed: runContext.sandbox.network !== "none",
    shellAllowed: runContext.sandbox.shell !== "disabled",
    ...(workspace.git ? { git: workspace.git } : {}),
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
  return validatePathInsideRunContext(candidatePath, context, access).ok;
}

export function validatePathInsideRunContext(
  candidatePath: string,
  context: AgentRunContext,
  access: RunContextPathAccess,
): LocationPathBoundaryResult {
  const locationEnv = getRunContextLocationEnv(context);
  const roots = getRunContextPathRoots(context, access);

  return validatePathInsideLocationRoots(candidatePath, roots, locationEnv, {
    allowSymlinks: access === "read",
  });
}

export function getRunContextPathRoots(
  context: AgentRunContext,
  access: RunContextPathAccess,
): string[] {
  if (access === "write") {
    return context.sandbox.mode === "workspace_write"
      ? unique([context.workspaceRoot, ...context.sandbox.extraWriteRoots])
      : [];
  }

  const writableRoots =
    context.sandbox.mode === "workspace_write"
      ? context.sandbox.extraWriteRoots
      : [];
  return unique([
    context.workspaceRoot,
    ...context.sandbox.extraReadRoots,
    ...writableRoots,
  ]);
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

/**
 * Public wrapper around the private `narrowSandboxPolicy` (contract §5.2, Patch 15).
 * Narrows a parent sandbox policy by an optional child override (any unset field
 * inherits the parent's value). `workspaceRoot` derives the location environment
 * used for path-boundary checks. P5 (fork agent) and P6 (actor) reuse this to
 * narrow child sandboxes.
 */
export function buildChildSandboxPolicy(
  parent: AgentSandboxPolicy,
  child?: Partial<AgentSandboxPolicy>,
  workspaceRoot?: string,
): AgentSandboxPolicy {
  const env = normalizeLocationEnvironment({
    ...(workspaceRoot ? { workspaceRoot } : {}),
  });
  if (!child) {
    return narrowSandboxPolicy(parent, undefined, env);
  }
  // Merge the partial child onto the parent so narrowSandboxPolicy receives a
  // fully-formed policy (its internal canonicalize expects all fields present).
  const merged: AgentSandboxPolicy = {
    mode: child.mode ?? parent.mode,
    network: child.network ?? parent.network,
    shell: child.shell ?? parent.shell,
    allowWorkspaceEscape: child.allowWorkspaceEscape ?? parent.allowWorkspaceEscape,
    extraReadRoots: child.extraReadRoots ?? parent.extraReadRoots,
    extraWriteRoots: child.extraWriteRoots ?? parent.extraWriteRoots,
  };
  return narrowSandboxPolicy(parent, merged, env);
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

// Input for creating a workspace. Moved to shared so the storage contract
// (src/shared/storageContract.ts) can reference it.
export type AgentWorkspaceInput = {
  name: string;
  rootPath: string;
  kind: AgentWorkspaceKind;
  cleanup: AgentWorkspaceCleanup;
  git?: AgentWorkspaceGitMetadata;
};
