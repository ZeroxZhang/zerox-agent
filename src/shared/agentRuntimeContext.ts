import type {
  CreateExecutionContextPackageInput,
  ExecutionContextMemoryScope,
  ExecutionContextPackage,
  ExecutionContextSkillSnapshot,
  ExecutionContextToolVisibility,
} from "./executionContextPackage";
import { createExecutionContextPackage } from "./executionContextPackage";
import type { AgentRunContext } from "./agentWorkspace";
import { getRunContextPathRoots } from "./agentWorkspace";

export const AGENT_RUNTIME_CONTEXT_SNAPSHOT_VERSION = 1;

export type AgentRuntimeSurface =
  | "chat"
  | "goal"
  | "scheduled_task"
  | "actor"
  | "workflow";

export type AgentRuntimeContextModel = {
  providerId: string;
  modelId: string;
  profile: string;
  capabilities: string[];
};

export type AgentRuntimeContextPermissionSnapshot = {
  taskId: string;
  runtimeTaskId: string;
  approvalMode: "manual" | "scheduled";
  policyLabel?: string;
};

export type AgentRuntimeContextSnapshot = {
  version: typeof AGENT_RUNTIME_CONTEXT_SNAPSHOT_VERSION;
  snapshotId: string;
  runId: string;
  surface: AgentRuntimeSurface;
  model: AgentRuntimeContextModel;
  time: {
    anchoredAt: string;
    timezone: string;
  };
  workspace?: {
    workspaceId?: string;
    workspaceRoot: string;
    sandboxMode: AgentRunContext["sandbox"]["mode"];
    shell: AgentRunContext["sandbox"]["shell"];
    network: AgentRunContext["sandbox"]["network"];
    readRoots: string[];
    writeRoots: string[];
    agentRole: AgentRunContext["agentRole"];
    depth: number;
    parentRunId?: string;
  };
  permissions: AgentRuntimeContextPermissionSnapshot;
  tools: {
    visible: ExecutionContextToolVisibility[];
    schemaHash: string;
    sources: string[];
  };
  skill?: ExecutionContextSkillSnapshot;
  memory: {
    scopes: ExecutionContextMemoryScope[];
    recallBudgetTokens: number;
    rawHistoryEnabled: boolean;
  };
  checkpoint: {
    strategy: ExecutionContextPackage["checkpoint"]["strategy"];
    preserveToolPairs: boolean;
    protectSkillLoads: boolean;
    checkpointId?: string;
    boundaryId?: string;
  };
  trajectory: {
    runId: string;
    workspaceRunId?: string;
    sessionId?: string;
    requestId?: string;
  };
  createdAt: string;
};

export type CreateAgentRuntimeContextSnapshotInput = Omit<
  AgentRuntimeContextSnapshot,
  "version" | "workspace" | "tools" | "memory" | "model"
> & {
  model: AgentRuntimeContextModel;
  runContext?: AgentRunContext;
  tools: {
    visible: ExecutionContextToolVisibility[];
  };
  memory: AgentRuntimeContextSnapshot["memory"];
};

export type AgentRuntimeContextSnapshotSummary = {
  snapshotId: string;
  runId: string;
  surface: AgentRuntimeSurface;
  workspaceId?: string;
  workspaceRoot?: string;
  skillName?: string;
  visibleToolCount: number;
  toolSchemaHash: string;
  memoryScopes: string[];
  permissionTaskId: string;
  checkpointStrategy: AgentRuntimeContextSnapshot["checkpoint"]["strategy"];
};

export function createAgentRuntimeContextSnapshot(
  input: CreateAgentRuntimeContextSnapshotInput,
): AgentRuntimeContextSnapshot {
  const visibleTools = uniqueVisibleTools(input.tools.visible);
  return {
    version: AGENT_RUNTIME_CONTEXT_SNAPSHOT_VERSION,
    snapshotId: input.snapshotId,
    runId: input.runId,
    surface: input.surface,
    model: {
      providerId: input.model.providerId,
      modelId: input.model.modelId,
      profile: input.model.profile,
      capabilities: uniqueStrings(input.model.capabilities).sort(),
    },
    time: { ...input.time },
    ...(input.runContext
      ? { workspace: projectWorkspaceSnapshot(input.runContext) }
      : {}),
    permissions: { ...input.permissions },
    tools: {
      visible: visibleTools,
      schemaHash: createStableSchemaHash(
        visibleTools.map((tool) => ({
          name: tool.name,
          source: tool.source,
          available: tool.available,
        })),
      ),
      sources: uniqueStrings(visibleTools.map((tool) => tool.source)).sort(),
    },
    ...(input.skill ? { skill: cloneSkillSnapshot(input.skill) } : {}),
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

export function summarizeAgentRuntimeContextSnapshot(
  snapshot: AgentRuntimeContextSnapshot,
): AgentRuntimeContextSnapshotSummary {
  return {
    snapshotId: snapshot.snapshotId,
    runId: snapshot.runId,
    surface: snapshot.surface,
    ...(snapshot.workspace?.workspaceId
      ? { workspaceId: snapshot.workspace.workspaceId }
      : {}),
    ...(snapshot.workspace?.workspaceRoot
      ? { workspaceRoot: snapshot.workspace.workspaceRoot }
      : {}),
    ...(snapshot.skill?.name ? { skillName: snapshot.skill.name } : {}),
    visibleToolCount: snapshot.tools.visible.filter((tool) => tool.available)
      .length,
    toolSchemaHash: snapshot.tools.schemaHash,
    memoryScopes: snapshot.memory.scopes.map(
      (scope) => `${scope.kind}:${scope.id}`,
    ),
    permissionTaskId: snapshot.permissions.taskId,
    checkpointStrategy: snapshot.checkpoint.strategy,
  };
}

export function projectSnapshotToExecutionContextPackage(
  snapshot: AgentRuntimeContextSnapshot,
): ExecutionContextPackage {
  const surface =
    snapshot.surface === "scheduled_task" ? "scheduled" : snapshot.surface;
  const runContext = projectRunContextFromSnapshot(snapshot);
  const input: CreateExecutionContextPackageInput = {
    packageId: snapshot.snapshotId,
    runId: snapshot.runId,
    surface,
    ...(runContext ? { runContext } : {}),
    ...(snapshot.skill ? { skill: cloneSkillSnapshot(snapshot.skill) } : {}),
    tools: {
      visible: snapshot.tools.visible.map((tool) => ({ ...tool })),
    },
    permissions: {
      interactive: snapshot.permissions.approvalMode === "manual",
      failClosedOnAsk: snapshot.permissions.approvalMode === "scheduled",
      ...(snapshot.permissions.policyLabel
        ? { policyLabel: snapshot.permissions.policyLabel }
        : {}),
    },
    memory: {
      scopes: snapshot.memory.scopes.map((scope) => ({ ...scope })),
      recallBudgetTokens: snapshot.memory.recallBudgetTokens,
      rawHistoryEnabled: snapshot.memory.rawHistoryEnabled,
    },
    checkpoint: {
      strategy: snapshot.checkpoint.strategy,
      preserveToolPairs: snapshot.checkpoint.preserveToolPairs,
      protectSkillLoads: snapshot.checkpoint.protectSkillLoads,
    },
    trajectory: { ...snapshot.trajectory },
    createdAt: snapshot.createdAt,
  };
  return createExecutionContextPackage(input);
}

function projectRunContextFromSnapshot(
  snapshot: AgentRuntimeContextSnapshot,
): AgentRunContext | undefined {
  const workspace = snapshot.workspace;
  if (!workspace) {
    return undefined;
  }
  return {
    workspaceId: workspace.workspaceId ?? "",
    workspaceRoot: workspace.workspaceRoot,
    sandbox: {
      mode: workspace.sandboxMode,
      network: workspace.network,
      shell: workspace.shell,
      allowWorkspaceEscape: false,
      extraReadRoots: workspace.readRoots.filter(
        (root) => root !== workspace.workspaceRoot,
      ),
      extraWriteRoots: workspace.writeRoots.filter(
        (root) => root !== workspace.workspaceRoot,
      ),
    },
    runId: snapshot.runId,
    ...(snapshot.trajectory.sessionId
      ? { sessionId: snapshot.trajectory.sessionId }
      : {}),
    ...(workspace.parentRunId ? { parentRunId: workspace.parentRunId } : {}),
    agentRole: workspace.agentRole,
    depth: workspace.depth,
  };
}

function projectWorkspaceSnapshot(
  runContext: AgentRunContext,
): NonNullable<AgentRuntimeContextSnapshot["workspace"]> {
  return {
    ...(runContext.workspaceId ? { workspaceId: runContext.workspaceId } : {}),
    workspaceRoot: runContext.workspaceRoot,
    sandboxMode: runContext.sandbox.mode,
    shell: runContext.sandbox.shell,
    network: runContext.sandbox.network,
    readRoots: getRunContextPathRoots(runContext, "read"),
    writeRoots: getRunContextPathRoots(runContext, "write"),
    agentRole: runContext.agentRole,
    depth: runContext.depth,
    ...(runContext.parentRunId ? { parentRunId: runContext.parentRunId } : {}),
  };
}

function uniqueVisibleTools(
  tools: ExecutionContextToolVisibility[],
): ExecutionContextToolVisibility[] {
  const seen = new Set<string>();
  const result: ExecutionContextToolVisibility[] = [];
  for (const tool of tools) {
    const key = `${tool.name}:${tool.source}`;
    if (!tool.name || !tool.source || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ ...tool });
  }
  return result.sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.source.localeCompare(right.source),
  );
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function cloneSkillSnapshot(
  skill: ExecutionContextSkillSnapshot,
): ExecutionContextSkillSnapshot {
  return {
    ...skill,
    resources: skill.resources.map((resource) => ({ ...resource })),
  };
}

function createStableSchemaHash(value: unknown): string {
  return `sha256:${sha256Hex(stableStringify(value))}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256Hex(input: string): string {
  const bytes = utf8Bytes(input);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) {
    bytes.push((high >>> shift) & 0xff);
  }
  for (let shift = 24; shift >= 0; shift -= 8) {
    bytes.push((low >>> shift) & 0xff);
  }

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Array<number>(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;
      words[index] =
        ((bytes[wordOffset] << 24) |
          (bytes[wordOffset + 1] << 16) |
          (bytes[wordOffset + 2] << 8) |
          bytes[wordOffset + 3]) >>>
        0;
    }
    for (let index = 16; index < 64; index += 1) {
      words[index] = add32(
        smallSigma1(words[index - 2]),
        words[index - 7],
        smallSigma0(words[index - 15]),
        words[index - 16],
      );
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const temp1 = add32(
        h,
        bigSigma1(e),
        choose(e, f, g),
        SHA256_K[index],
        words[index],
      );
      const temp2 = add32(bigSigma0(a), majority(a, b, c));
      h = g;
      g = f;
      f = e;
      e = add32(d, temp1);
      d = c;
      c = b;
      b = a;
      a = add32(temp1, temp2);
    }

    hash[0] = add32(hash[0], a);
    hash[1] = add32(hash[1], b);
    hash[2] = add32(hash[2], c);
    hash[3] = add32(hash[3], d);
    hash[4] = add32(hash[4], e);
    hash[5] = add32(hash[5], f);
    hash[6] = add32(hash[6], g);
    hash[7] = add32(hash[7], h);
  }
  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    let codePoint = input.charCodeAt(index);
    if (
      codePoint >= 0xd800 &&
      codePoint <= 0xdbff &&
      index + 1 < input.length
    ) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

function add32(...values: number[]): number {
  return values.reduce((sum, value) => (sum + value) >>> 0, 0);
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function bigSigma0(value: number): number {
  return rotateRight(value, 2) ^ rotateRight(value, 13) ^ rotateRight(value, 22);
}

function bigSigma1(value: number): number {
  return rotateRight(value, 6) ^ rotateRight(value, 11) ^ rotateRight(value, 25);
}

function smallSigma0(value: number): number {
  return rotateRight(value, 7) ^ rotateRight(value, 18) ^ (value >>> 3);
}

function smallSigma1(value: number): number {
  return rotateRight(value, 17) ^ rotateRight(value, 19) ^ (value >>> 10);
}

function choose(value: number, whenSet: number, whenUnset: number): number {
  return (value & whenSet) ^ (~value & whenUnset);
}

function majority(left: number, middle: number, right: number): number {
  return (left & middle) ^ (left & right) ^ (middle & right);
}
