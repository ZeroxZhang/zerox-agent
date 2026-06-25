import type { AgentRunContext } from "./agentWorkspace";

export const EXECUTION_CONTEXT_PACKAGE_VERSION = 1;

export type ExecutionSurface =
  | "chat"
  | "scheduled"
  | "goal"
  | "actor"
  | "workflow";

export type ExecutionContextMemoryScopeKind =
  | "session"
  | "workspace"
  | "skill"
  | "goal"
  | "project";

export type ExecutionContextMemoryScope = {
  kind: ExecutionContextMemoryScopeKind;
  id: string;
};

export type ExecutionContextSkillResource = {
  kind: "skill" | "reference" | "asset" | "script";
  path: string;
  sha256?: string;
};

export type ExecutionContextSkillSnapshot = {
  name: string;
  displayName: string;
  rootDir: string;
  manifestHash?: string;
  resources: ExecutionContextSkillResource[];
};

export type ExecutionContextToolVisibility = {
  name: string;
  source: string;
  riskLevel?: "low" | "medium" | "high";
  available: boolean;
  reason?: string;
};

export type ExecutionContextPackage = {
  version: typeof EXECUTION_CONTEXT_PACKAGE_VERSION;
  packageId: string;
  runId: string;
  surface: ExecutionSurface;
  workspace?: {
    workspaceId?: string;
    workspaceRoot: string;
    sandboxMode: AgentRunContext["sandbox"]["mode"];
    shell: AgentRunContext["sandbox"]["shell"];
    network: AgentRunContext["sandbox"]["network"];
  };
  skill?: ExecutionContextSkillSnapshot;
  tools: {
    visible: ExecutionContextToolVisibility[];
  };
  permissions: {
    interactive: boolean;
    failClosedOnAsk: boolean;
    policyLabel?: string;
  };
  memory: {
    scopes: ExecutionContextMemoryScope[];
    recallBudgetTokens: number;
    rawHistoryEnabled: boolean;
  };
  checkpoint: {
    strategy: "summarize" | "rebuild" | "boundary";
    preserveToolPairs: boolean;
    protectSkillLoads: boolean;
  };
  trajectory: {
    runId: string;
    workspaceRunId?: string;
    sessionId?: string;
    requestId?: string;
  };
  createdAt: string;
};

export type CreateExecutionContextPackageInput = Omit<
  ExecutionContextPackage,
  "version" | "workspace"
> & {
  runContext?: AgentRunContext;
};

export type ExecutionContextPackageSummary = {
  packageId: string;
  runId: string;
  surface: ExecutionSurface;
  workspaceId?: string;
  skillName?: string;
  visibleToolCount: number;
  memoryScopes: string[];
  checkpointStrategy: ExecutionContextPackage["checkpoint"]["strategy"];
};

export function createExecutionContextPackage(
  input: CreateExecutionContextPackageInput,
): ExecutionContextPackage {
  return {
    version: EXECUTION_CONTEXT_PACKAGE_VERSION,
    packageId: input.packageId,
    runId: input.runId,
    surface: input.surface,
    ...(input.runContext ? { workspace: projectWorkspace(input.runContext) } : {}),
    ...(input.skill ? { skill: input.skill } : {}),
    tools: {
      visible: input.tools.visible.map((tool) => ({ ...tool })),
    },
    permissions: { ...input.permissions },
    memory: {
      scopes: uniqueMemoryScopes(input.memory.scopes),
      recallBudgetTokens: input.memory.recallBudgetTokens,
      rawHistoryEnabled: input.memory.rawHistoryEnabled,
    },
    checkpoint: { ...input.checkpoint },
    trajectory: { ...input.trajectory },
    createdAt: input.createdAt,
  };
}

export function summarizeExecutionContextPackage(
  pkg: ExecutionContextPackage,
): ExecutionContextPackageSummary {
  return {
    packageId: pkg.packageId,
    runId: pkg.runId,
    surface: pkg.surface,
    ...(pkg.workspace?.workspaceId ? { workspaceId: pkg.workspace.workspaceId } : {}),
    ...(pkg.skill?.name ? { skillName: pkg.skill.name } : {}),
    visibleToolCount: pkg.tools.visible.filter((tool) => tool.available).length,
    memoryScopes: pkg.memory.scopes.map(
      (scope) => `${scope.kind}:${scope.id}`,
    ),
    checkpointStrategy: pkg.checkpoint.strategy,
  };
}

function projectWorkspace(runContext: AgentRunContext): NonNullable<
  ExecutionContextPackage["workspace"]
> {
  return {
    ...(runContext.workspaceId ? { workspaceId: runContext.workspaceId } : {}),
    workspaceRoot: runContext.workspaceRoot,
    sandboxMode: runContext.sandbox.mode,
    shell: runContext.sandbox.shell,
    network: runContext.sandbox.network,
  };
}

function uniqueMemoryScopes(
  scopes: ExecutionContextMemoryScope[],
): ExecutionContextMemoryScope[] {
  const seen = new Set<string>();
  const result: ExecutionContextMemoryScope[] = [];
  for (const scope of scopes) {
    const key = `${scope.kind}:${scope.id}`;
    if (!scope.id || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ ...scope });
  }
  return result;
}
