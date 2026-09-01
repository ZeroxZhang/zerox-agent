import type {
  AgentRuntimeContextSnapshot,
  AgentRuntimeSurface,
} from "../shared/agentRuntimeContext";
import { createAgentRuntimeContextSnapshot } from "../shared/agentRuntimeContext";
import type { AgentRunContext } from "../shared/agentWorkspace";
import type { ExecutionContextMemoryScope } from "../shared/executionContextPackage";
import type { SkillSnapshotSource } from "../shared/skills";
import type { ToolDefinition } from "./openAiCompatibleClient";

export type RuntimeContextFactoryModelProfile = {
  model: string;
  providerId?: string;
  profile?: string;
  capabilities?: string[];
  thinking?: { type: "enabled" | "disabled"; budgetTokens?: number };
};

export type RuntimeContextFactoryPermissionInput = {
  taskId: string;
  runtimeTaskId: string;
  approvalMode: "manual" | "scheduled";
  policyLabel?: string;
};

export type RuntimeContextFactoryMemoryInput = {
  scopes?: ExecutionContextMemoryScope[];
  recallBudgetTokens?: number;
  rawHistoryEnabled?: boolean;
};

export type RuntimeContextFactoryCheckpointInput = Partial<
  AgentRuntimeContextSnapshot["checkpoint"]
>;

export type RuntimeContextFactoryTrajectoryInput = Partial<
  Omit<AgentRuntimeContextSnapshot["trajectory"], "runId">
>;

export type CreateRuntimeContextSnapshotForRunInput = {
  surface: AgentRuntimeSurface;
  runId: string;
  runContext?: AgentRunContext;
  modelProfile: RuntimeContextFactoryModelProfile;
  tools?: ToolDefinition[];
  getToolSource?: (toolName: string) => string | null;
  selectedSkill?: SkillSnapshotSource;
  permission: RuntimeContextFactoryPermissionInput;
  memory?: RuntimeContextFactoryMemoryInput;
  checkpoint?: RuntimeContextFactoryCheckpointInput;
  trajectory?: RuntimeContextFactoryTrajectoryInput;
  createId?: () => string;
  now?: () => string;
  systemTimeZone?: string;
};

export function createRuntimeContextSnapshotForRun(
  input: CreateRuntimeContextSnapshotForRunInput,
): AgentRuntimeContextSnapshot {
  const createdAt = input.now?.() ?? new Date().toISOString();
  const profile = input.modelProfile.profile ?? input.surface;
  return createAgentRuntimeContextSnapshot({
    snapshotId: input.createId?.() ?? `runtime_snapshot_${input.runId}`,
    runId: input.runId,
    surface: input.surface,
    model: {
      providerId: input.modelProfile.providerId ?? "openai-compatible",
      modelId: input.modelProfile.model,
      profile,
      capabilities: inferModelCapabilities(input.modelProfile, input.tools),
    },
    time: {
      anchoredAt: createdAt,
      timezone: input.systemTimeZone ?? "UTC",
    },
    ...(input.runContext ? { runContext: input.runContext } : {}),
    permissions: {
      taskId: input.permission.taskId,
      runtimeTaskId: input.permission.runtimeTaskId,
      approvalMode: input.permission.approvalMode,
      ...(input.permission.policyLabel
        ? { policyLabel: input.permission.policyLabel }
        : {}),
    },
    tools: {
      visible: toToolVisibility(input.tools ?? [], input.getToolSource),
    },
    ...(input.selectedSkill ? { skill: toSkillSnapshot(input.selectedSkill) } : {}),
    memory: {
      scopes: input.memory?.scopes ?? [],
      recallBudgetTokens: input.memory?.recallBudgetTokens ?? 0,
      rawHistoryEnabled: input.memory?.rawHistoryEnabled ?? false,
    },
    checkpoint: {
      strategy: input.checkpoint?.strategy ?? "summarize",
      preserveToolPairs: input.checkpoint?.preserveToolPairs ?? true,
      protectSkillLoads: input.checkpoint?.protectSkillLoads ?? true,
      ...(input.checkpoint?.checkpointId
        ? { checkpointId: input.checkpoint.checkpointId }
        : {}),
      ...(input.checkpoint?.boundaryId
        ? { boundaryId: input.checkpoint.boundaryId }
        : {}),
    },
    trajectory: {
      runId: input.runId,
      ...(input.trajectory?.workspaceRunId
        ? { workspaceRunId: input.trajectory.workspaceRunId }
        : {}),
      ...(input.trajectory?.sessionId
        ? { sessionId: input.trajectory.sessionId }
        : {}),
      ...(input.trajectory?.requestId
        ? { requestId: input.trajectory.requestId }
        : {}),
    },
    createdAt,
  });
}

function inferModelCapabilities(
  profile: RuntimeContextFactoryModelProfile,
  tools: ToolDefinition[] | undefined,
): string[] {
  if (profile.capabilities) {
    return [
      ...profile.capabilities,
      ...(profile.thinking?.type === "enabled" ? ["thinking"] : []),
    ];
  }
  return [
    ...(tools?.length ? ["tools"] : []),
    ...(profile.thinking?.type === "enabled" ? ["thinking"] : []),
  ];
}

function toToolVisibility(
  tools: ToolDefinition[],
  getToolSource?: (toolName: string) => string | null,
) {
  return tools.map((tool) => {
    const name = tool.function.name;
    return {
      name,
      source: getToolSource?.(name) ?? "built-in",
      available: true,
    };
  });
}

function toSkillSnapshot(skill: SkillSnapshotSource) {
  const extendedResources = (
    skill as SkillSnapshotSource & {
      resources?: Array<{
        kind: "skill" | "reference" | "asset" | "script";
        path: string;
        sha256?: string;
      }>;
    }
  ).resources;
  const resources =
    Array.isArray(extendedResources) && extendedResources.length > 0
      ? extendedResources.map((resource) => ({ ...resource }))
      : [
          {
            kind: "skill" as const,
            path: skill.skillFile || `${skill.rootDir}/SKILL.md`,
          },
        ];
  return {
    name: skill.manifest.name,
    displayName: skill.manifest.displayName,
    rootDir: skill.rootDir,
    manifestHash: resources.find((resource) => resource.kind === "skill")
      ?.sha256,
    resources,
  };
}
