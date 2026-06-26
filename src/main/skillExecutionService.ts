import { createHash, randomUUID } from "node:crypto";
import {
  validatePathInsideRunContext,
  type AgentRunContext,
} from "../shared/agentWorkspace";
import type { SkillInput, SkillRecord } from "../shared/skills";
import {
  transitionSkillExecution,
  type SkillExecutionBudgets,
  type SkillExecutionSnapshot,
  type SkillExecutionStage,
  type SkillExecutionTransitionOptions,
  type SkillInputResolution,
  type SkillInputValue,
} from "../shared/skillExecutionContract";
import type { SkillExecutionResult } from "./skillExecutor";

export type SkillExecutionService = {
  execute(input: SkillExecutionServiceInput): Promise<SkillExecutionServiceResult>;
  resolveInput(input: SkillInputResolutionInput): SkillInputResolution;
};

export type SkillExecutionServiceInput = {
  skill: SkillRecord;
  taskId?: string;
  sessionId?: string;
  requestId?: string;
  workspaceId?: string;
  budgets: SkillExecutionBudgets;
  values?: Record<string, unknown>;
  runContext?: AgentRunContext;
  runAgentSkill?: (snapshot: SkillExecutionSnapshot) => Promise<SkillExecutionResult>;
};

export type SkillInputResolutionInput = {
  skill: SkillRecord;
  values?: Record<string, unknown>;
  runContext?: AgentRunContext;
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
    transitionOptions: Omit<SkillExecutionTransitionOptions, "at" | "message"> = {},
  ): SkillExecutionSnapshot {
    return emit(
      transitionSkillExecution(snapshot, stage, {
        at: now().toISOString(),
        ...(message ? { message } : {}),
        ...transitionOptions,
      }),
    );
  }

  return {
    resolveInput: resolveSkillInput,

    async execute(input) {
      let snapshot = emit(createInitialSnapshot(input, createId(), now().toISOString()));

      try {
        snapshot = transition(snapshot, "loading_resources");
        snapshot = transition(snapshot, "auditing_requirements");
        if (input.skill.manifest.inputs.length > 0) {
          const inputResolution = resolveSkillInput({
            skill: input.skill,
            values: input.values,
            runContext: input.runContext,
          });
          if (inputResolution.status !== "complete") {
            return {
              ok: false,
              error: "Skill input required.",
              snapshot: transition(
                snapshot,
                "waiting_for_user_input",
                "Skill input required.",
                { inputResolution },
              ),
            };
          }
          snapshot = transition(
            snapshot,
            "validating_input",
            "Skill input validated.",
            { inputResolution },
          );
        }
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

export function resolveSkillInput(
  input: SkillInputResolutionInput,
): SkillInputResolution {
  const values = input.values ?? {};
  const resolvedValues: Record<string, SkillInputValue> = {};
  const missingFields: string[] = [];
  const invalidFields: string[] = [];

  for (const field of input.skill.manifest.inputs) {
    const rawValue = Object.prototype.hasOwnProperty.call(values, field.name)
      ? values[field.name]
      : field.defaultValue;

    if (isMissingSkillInputValue(rawValue)) {
      if (field.required) {
        missingFields.push(field.name);
      }
      continue;
    }

    const validation = validateSkillInputValue(field, rawValue, input.runContext);
    if (!validation.ok) {
      invalidFields.push(field.name);
      continue;
    }

    resolvedValues[field.name] = validation.value;
  }

  return {
    status:
      missingFields.length > 0
        ? "missing"
        : invalidFields.length > 0
          ? "invalid"
          : "complete",
    values: resolvedValues,
    missingFields,
    invalidFields,
  };
}

function isMissingSkillInputValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0)
  );
}

function validateSkillInputValue(
  field: SkillInput,
  value: unknown,
  runContext: AgentRunContext | undefined,
): { ok: true; value: SkillInputValue } | { ok: false } {
  switch (field.type) {
    case "string":
      return typeof value === "string" ? { ok: true, value } : { ok: false };
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? { ok: true, value }
        : { ok: false };
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false };
    case "choice":
      return typeof value === "string" && field.choices?.includes(value)
        ? { ok: true, value }
        : { ok: false };
    case "path":
      if (typeof value !== "string" || !runContext) {
        return { ok: false };
      }
      {
        const readResult = validatePathInsideRunContext(value, runContext, "read");
        if (readResult.ok) {
          return { ok: true, value: readResult.path };
        }
        const writeResult = validatePathInsideRunContext(
          value,
          runContext,
          "write",
        );
        return writeResult.ok
          ? { ok: true, value: writeResult.path }
          : { ok: false };
      }
  }
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
