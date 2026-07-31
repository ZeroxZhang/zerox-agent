export type SkillExecutionStage =
  | "resolving_skill"
  | "loading_resources"
  | "auditing_requirements"
  | "waiting_for_user_input"
  | "validating_input"
  | "configuring"
  | "planning"
  | "executing"
  | "waiting_for_approval"
  | "validating"
  | "finalizing"
  | "succeeded"
  | "failed"
  | "canceled";

export type SkillInputValue = string | number | boolean;

export type SkillInputResolution = {
  status: "complete" | "missing" | "invalid";
  values: Record<string, SkillInputValue>;
  missingFields: string[];
  invalidFields: string[];
};

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

/** @deprecated Legacy serialized limits; values are never execution stop gates. */
export type SkillExecutionBudgets = {
  maxTurns: number;
  usedTurns?: number;
  maxToolCalls?: number;
  maxWallClockMs?: number;
};

export type SkillExecutionPolicy = {
  /** Automatic persistence/visibility checkpoint interval, never a task limit. */
  checkpointEveryTurns: number;
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
  executionPolicy: SkillExecutionPolicy;
  /** @deprecated Read compatibility only. New snapshots do not write budgets. */
  budgets?: SkillExecutionBudgets;
  resources?: SkillExecutionResource[];
  createdAt: string;
};

export type SkillExecutionSnapshot = SkillExecutionContract & {
  stage: SkillExecutionStage;
  stageRecords: SkillStageRecord[];
  terminal: boolean;
  updatedAt: string;
  inputResolution?: SkillInputResolution;
  pendingInputRequestId?: string;
};

export type SkillExecutionTransitionOptions = {
  at?: string;
  message?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  inputResolution?: SkillInputResolution;
  pendingInputRequestId?: string;
};

const terminalSkillStages = new Set<SkillExecutionStage>([
  "succeeded",
  "failed",
  "canceled",
]);

const allowedSkillStageTransitions = {
  resolving_skill: ["loading_resources", "failed", "canceled"],
  loading_resources: ["auditing_requirements", "failed", "canceled"],
  auditing_requirements: [
    "waiting_for_user_input",
    "validating_input",
    "planning",
    "failed",
    "canceled",
  ],
  waiting_for_user_input: ["validating_input", "failed", "canceled"],
  validating_input: [
    "planning",
    "waiting_for_user_input",
    "failed",
    "canceled",
  ],
  configuring: ["planning", "failed", "canceled"],
  planning: ["executing", "failed", "canceled"],
  executing: ["waiting_for_approval", "validating", "failed", "canceled"],
  waiting_for_approval: ["executing", "failed", "canceled"],
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

  const nextSnapshot: SkillExecutionSnapshot = {
    ...snapshot,
    stage: to,
    stageRecords: [...snapshot.stageRecords, record],
    terminal: isTerminalSkillExecutionStage(to),
    updatedAt: enteredAt,
  };

  if (options.inputResolution !== undefined) {
    nextSnapshot.inputResolution = options.inputResolution;
  }
  if (options.pendingInputRequestId !== undefined) {
    nextSnapshot.pendingInputRequestId = options.pendingInputRequestId;
  } else if (to !== "waiting_for_user_input") {
    delete nextSnapshot.pendingInputRequestId;
  }

  return nextSnapshot;
}
