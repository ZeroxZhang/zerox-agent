export type SkillExecutionStage =
  | "resolving_skill"
  | "loading_resources"
  | "configuring"
  | "planning"
  | "executing"
  | "validating"
  | "finalizing"
  | "succeeded"
  | "failed"
  | "canceled";

export type SkillExecutionResourceKind =
  | "skill"
  | "reference"
  | "asset"
  | "script"
  | "other";

export type SkillExecutionResource = {
  kind: SkillExecutionResourceKind;
  relativePath: string;
  absolutePath: string;
  hash?: string;
  sizeBytes?: number;
};

export type SkillExecutionProvenance = {
  name: string;
  displayName?: string;
  version?: string;
  skillFile: string;
  rootDir: string;
  bodyHash: string;
  manifestHash: string;
};

export type SkillExecutionBudgets = {
  maxTurns: number;
  usedTurns?: number;
  maxToolCalls?: number;
  maxWallClockMs?: number;
};

export type SkillStageRecord = {
  stage: SkillExecutionStage;
  enteredAt: string;
  message?: string;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type SkillExecutionStageRecord = SkillStageRecord;

export type SkillExecutionContract = {
  schemaVersion: 1;
  executionId: string;
  taskId?: string;
  sessionId?: string;
  requestId?: string;
  workspaceId?: string;
  selectedSkillName: string;
  skill: SkillExecutionProvenance;
  budgets: SkillExecutionBudgets;
  resources?: SkillExecutionResource[];
  createdAt: string;
};

export type SkillExecutionSnapshot = SkillExecutionContract & {
  stage: SkillExecutionStage;
  stageRecords: SkillStageRecord[];
  terminal: boolean;
  updatedAt: string;
};

export type SkillExecutionTransitionOptions = {
  at?: string;
  message?: string;
  error?: string;
  metadata?: Record<string, unknown>;
};

const terminalSkillStages = new Set<SkillExecutionStage>([
  "succeeded",
  "failed",
  "canceled",
]);

const allowedSkillStageTransitions = {
  resolving_skill: ["loading_resources", "failed", "canceled"],
  loading_resources: ["configuring", "failed", "canceled"],
  configuring: ["planning", "failed", "canceled"],
  planning: ["executing", "failed", "canceled"],
  executing: ["validating", "failed", "canceled"],
  validating: ["finalizing", "failed", "canceled"],
  finalizing: ["succeeded", "failed", "canceled"],
  succeeded: [],
  failed: [],
  canceled: [],
} satisfies Record<SkillExecutionStage, readonly SkillExecutionStage[]>;

export function isTerminalSkillExecutionStage(
  stage: SkillExecutionStage,
): boolean {
  return terminalSkillStages.has(stage);
}

export function canTransitionSkillStage(
  from: SkillExecutionStage,
  to: SkillExecutionStage,
): boolean {
  if (isTerminalSkillExecutionStage(from) || from === to) {
    return false;
  }

  const nextStages: readonly SkillExecutionStage[] =
    allowedSkillStageTransitions[from];
  return nextStages.includes(to);
}

export function transitionSkillExecution(
  snapshot: SkillExecutionSnapshot,
  to: SkillExecutionStage,
  options: SkillExecutionTransitionOptions = {},
): SkillExecutionSnapshot {
  if (snapshot.terminal || isTerminalSkillExecutionStage(snapshot.stage)) {
    throw new Error(
      `Cannot transition terminal skill execution from "${snapshot.stage}" to "${to}".`,
    );
  }

  if (!canTransitionSkillStage(snapshot.stage, to)) {
    throw new Error(
      `Cannot transition skill execution from "${snapshot.stage}" to "${to}".`,
    );
  }

  const enteredAt = options.at ?? new Date().toISOString();
  const record: SkillStageRecord = {
    stage: to,
    enteredAt,
    ...(options.message ? { message: options.message } : {}),
    ...(options.error ? { error: options.error } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  };

  return {
    ...snapshot,
    stage: to,
    stageRecords: [...snapshot.stageRecords, record],
    terminal: isTerminalSkillExecutionStage(to),
    updatedAt: enteredAt,
  };
}
