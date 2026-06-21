import { createHash, randomUUID } from "node:crypto";
import type { SkillRecord } from "../shared/skills";
import {
  transitionSkillExecution,
  type SkillExecutionBudgets,
  type SkillExecutionSnapshot,
  type SkillExecutionStage,
} from "../shared/skillExecutionContract";
import type { SkillExecutionResult } from "./skillExecutor";

export type SkillExecutionService = {
  execute(input: SkillExecutionServiceInput): Promise<SkillExecutionServiceResult>;
};

export type SkillExecutionServiceInput = {
  skill: SkillRecord;
  taskId?: string;
  sessionId?: string;
  requestId?: string;
  workspaceId?: string;
  budgets: SkillExecutionBudgets;
  runAgentSkill?: (snapshot: SkillExecutionSnapshot) => Promise<SkillExecutionResult>;
};

export type SkillExecutionServiceResult =
  | {
      ok: true;
      result: Record<string, unknown>;
      snapshot: SkillExecutionSnapshot;
    }
  | {
      ok: false;
      error: string;
      snapshot: SkillExecutionSnapshot;
    };

export function createSkillExecutionService(options: {
  createId?: () => string;
  now?: () => Date;
  onSnapshot?: (snapshot: SkillExecutionSnapshot) => void;
} = {}): SkillExecutionService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  function emit(snapshot: SkillExecutionSnapshot): SkillExecutionSnapshot {
    options.onSnapshot?.(snapshot);
    return snapshot;
  }

  function transition(
    snapshot: SkillExecutionSnapshot,
    stage: SkillExecutionStage,
    message?: string,
  ): SkillExecutionSnapshot {
    return emit(
      transitionSkillExecution(snapshot, stage, {
        at: now().toISOString(),
        ...(message ? { message } : {}),
      }),
    );
  }

  return {
    async execute(input) {
      let snapshot = emit(createInitialSnapshot(input, createId(), now().toISOString()));

      try {
        snapshot = transition(snapshot, "loading_resources");
        snapshot = transition(snapshot, "configuring");
        snapshot = transition(snapshot, "planning");
        snapshot = transition(snapshot, "executing");
        const result = input.runAgentSkill
          ? await input.runAgentSkill(snapshot)
          : { ok: true as const, result: {} };
        if (!result.ok) {
          return {
            ok: false,
            error: result.error,
            snapshot: transitionToTerminal(snapshot, "failed", now, emit, result.error),
          };
        }

        snapshot = transition(snapshot, "validating");
        snapshot = transition(snapshot, "finalizing");
        snapshot = transition(snapshot, "succeeded");
        return { ok: true, result: result.result, snapshot };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Skill execution failed.";
        return {
          ok: false,
          error: message,
          snapshot: transitionToTerminal(snapshot, "failed", now, emit, message),
        };
      }
    },
  };
}

function createInitialSnapshot(
  input: SkillExecutionServiceInput,
  id: string,
  createdAt: string,
): SkillExecutionSnapshot {
  return {
    schemaVersion: 1,
    executionId: `skill_exec_${id}`,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    selectedSkillName: input.skill.manifest.name,
    skill: {
      name: input.skill.manifest.name,
      displayName: input.skill.manifest.displayName,
      version: input.skill.manifest.version,
      skillFile: input.skill.skillFile,
      rootDir: input.skill.rootDir,
      bodyHash: hashValue(input.skill.body),
      manifestHash: hashValue(JSON.stringify(input.skill.manifest)),
    },
    budgets: input.budgets,
    resources: [
      {
        kind: "skill",
        relativePath: "SKILL.md",
        absolutePath: input.skill.skillFile,
        hash: hashValue(input.skill.body),
        sizeBytes: Buffer.byteLength(input.skill.body, "utf8"),
      },
    ],
    stage: "resolving_skill",
    stageRecords: [
      {
        stage: "resolving_skill",
        enteredAt: createdAt,
        message: "created",
      },
    ],
    terminal: false,
    createdAt,
    updatedAt: createdAt,
  };
}

function transitionToTerminal(
  snapshot: SkillExecutionSnapshot,
  terminalStage: Extract<SkillExecutionStage, "failed" | "canceled">,
  now: () => Date,
  emit: (snapshot: SkillExecutionSnapshot) => SkillExecutionSnapshot,
  error: string,
): SkillExecutionSnapshot {
  return emit(
    transitionSkillExecution(snapshot, terminalStage, {
      at: now().toISOString(),
      error,
    }),
  );
}

function hashValue(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
