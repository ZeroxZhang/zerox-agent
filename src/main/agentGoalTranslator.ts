import { randomUUID } from "node:crypto";
import type {
  AcceptanceCheck,
  AcceptanceCheckKind,
  GoalSelectedSkill,
  Milestone,
  SuccessCriterion,
} from "../shared/agentGoal";
import {
  normalizeGoalDraftCriteria,
  type GoalDraft,
} from "../shared/goalTranslation";
import type { SkillInputValue } from "../shared/skillExecutionContract";
import type { ChatClient, ChatMessage } from "./openAiCompatibleClient";
import type { AgentModelProfile } from "./agentRunnerService";
import {
  ModelServiceNoticeError,
  throwForModelServiceNotice,
} from "../shared/modelServiceNotice";
import { throwIfResponseBodyLimitError } from "./fetchWithTimeout";

type ParsedGoalDraft = {
  normalizedDescription?: unknown;
  successCriteria?: unknown;
  milestones?: unknown;
};

export type AgentGoalTranslator = {
  translate(input: {
    sessionId: string;
    workspaceId?: string;
    originMessageId: string | null;
    message: string;
    selectedSkill?: GoalSelectedSkill;
    selectedSkillInputValues?: Record<string, SkillInputValue>;
    signal?: AbortSignal;
  }): Promise<GoalDraft>;
};

export function createAgentGoalTranslator(options: {
  chatClient: ChatClient;
  getModelProfile: () => Promise<AgentModelProfile>;
  onDiagnostic?: (event: { message: string; error?: unknown }) => void;
  createId?: () => string;
  now?: () => string;
  maxTranslationAttempts?: number;
  retryDelayMs?: number;
}): AgentGoalTranslator {
  const createId = options.createId ?? (() => `goal_draft_${randomUUID()}`);
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async translate(input) {
      throwIfAborted(input.signal);
      const sourceMessage = input.message.trim();
      const translation = await translateWithModel(
        options,
        sourceMessage,
        input.signal,
      );
      const parsed = translation.parsed;
      const normalizedDescription =
        readString(parsed?.normalizedDescription) ||
        normalizeGoalDescription(sourceMessage);
      const baseCriteria = normalizeParsedCriteria(
        parsed?.successCriteria,
        normalizedDescription,
        sourceMessage,
      );
      const inferredCriteria = addSignalBasedChecks(baseCriteria, sourceMessage);
      const coverage = normalizeGoalDraftCriteria(inferredCriteria);
      const milestones = normalizeParsedMilestones(
        parsed?.milestones,
        coverage.successCriteria,
      );
      const resolvedMilestones = milestones.length
        ? milestones
        : [
            {
              id: "milestone_1",
              description: "执行目标并产出可验收结果",
              dependsOn: [],
              successCriteria: coverage.successCriteria,
              state: "ready" as const,
              runIds: [],
              attempts: 0,
            },
          ];
      const timestamp = now();

      return {
        id: createId(),
        sessionId: input.sessionId,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.originMessageId ? { originMessageId: input.originMessageId } : {}),
        sourceMessage,
        normalizedDescription,
        successCriteria: coverage.successCriteria,
        acceptanceCoverage: coverage.acceptanceCoverage,
        warnings: [
          ...coverage.warnings,
          ...(translation.warning ? [translation.warning] : []),
        ],
        milestones: resolvedMilestones,
        ...(input.selectedSkill ? { selectedSkill: input.selectedSkill } : {}),
        ...(input.selectedSkillInputValues
          ? { selectedSkillInputValues: input.selectedSkillInputValues }
          : {}),
        status: "draft",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },
  };
}

async function translateWithModel(
  options: {
    chatClient: ChatClient;
    getModelProfile: () => Promise<AgentModelProfile>;
    onDiagnostic?: (event: { message: string; error?: unknown }) => void;
    maxTranslationAttempts?: number;
    retryDelayMs?: number;
  },
  message: string,
  signal: AbortSignal | undefined,
): Promise<{
  parsed: ParsedGoalDraft | null;
  warning?: {
    code: "planning_model_unavailable";
    severity: "warning";
    message: string;
  };
}> {
  throwIfAborted(signal);
  try {
    const profile = await options.getModelProfile();
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: [
          "You translate a user's natural-language intent into a measurable local-first agent goal draft.",
          "Return only compact JSON with fields normalizedDescription, successCriteria, and milestones.",
          "Each success criterion should include acceptanceChecks using only file_exists, command_exit_code, test_passes, assertion, or model_review.",
          "A model_review check must include params.evidenceRefs and requiresEvidence=true.",
        ].join("\n"),
      },
      {
        role: "user",
        content: message,
      },
    ];
    const maxAttempts = Math.max(1, options.maxTranslationAttempts ?? 2);
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      throwIfAborted(signal);
      try {
        const response = await options.chatClient.complete({
          ...profile,
          messages,
          temperature: Math.min(profile.temperature, 0.2),
          maxTokens: Math.min(profile.maxTokens, 1200),
          ...(signal ? { signal } : {}),
        });
        throwForModelServiceNotice(response.modelServiceNotice);
        const parsed = parseDraftJson(response.content);
        if (parsed) return { parsed };
        lastError = new Error(
          "Goal translation model returned an invalid goal draft.",
        );
      } catch (error) {
        throwIfResponseBodyLimitError(error);
        if (error instanceof ModelServiceNoticeError) throw error;
        if (signal?.aborted || isAbortError(error)) {
          throw signal?.reason ?? error;
        }
        lastError = error;
      }
      if (attempt < maxAttempts - 1) {
        await abortableDelay(options.retryDelayMs ?? 25, signal);
      }
    }
    const detail =
      lastError instanceof Error ? lastError.message : String(lastError);
    options.onDiagnostic?.({
      message: `Goal translation model failed: ${detail}`,
      error: lastError,
    });
    return {
      parsed: null,
      warning: planningFallbackWarning(),
    };
  } catch (error) {
    throwIfResponseBodyLimitError(error);
    if (signal?.aborted || isAbortError(error)) {
      throw signal?.reason ?? error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    options.onDiagnostic?.({
      message: `Goal translation model failed: ${detail}`,
      error,
    });
    return {
      parsed: null,
      warning: planningFallbackWarning(),
    };
  }
}

function abortableDelay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Canceled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function parseDraftJson(content: string | null): ParsedGoalDraft | null {
  if (!content) {
    return null;
  }
  const trimmed = content.trim();
  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
    trimmed.match(/\{[\s\S]*\}/)?.[0],
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as ParsedGoalDraft;
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // Try the next shape.
    }
  }
  return null;
}

function normalizeParsedCriteria(
  value: unknown,
  normalizedDescription: string,
  sourceMessage: string,
): SuccessCriterion[] {
  if (!Array.isArray(value)) {
    return [createModelReviewCriterion(normalizedDescription)];
  }

  const criteria = value
    .map((item, index): SuccessCriterion | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const description =
        readString(record.description) ||
        readString(record.title) ||
        normalizedDescription;
      const acceptanceChecks = normalizeParsedChecks(
        record.acceptanceChecks ?? record.checks,
        description,
        index,
      );
      return {
        id: readString(record.id) || `criterion_${index + 1}`,
        description,
        acceptanceChecks: acceptanceChecks.length
          ? acceptanceChecks
          : createModelReviewCriterion(description).acceptanceChecks,
      };
    })
    .filter((criterion): criterion is SuccessCriterion => Boolean(criterion));

  return criteria.length ? criteria : [createModelReviewCriterion(sourceMessage)];
}

function normalizeParsedChecks(
  value: unknown,
  description: string,
  criterionIndex: number,
): AcceptanceCheck[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index): AcceptanceCheck | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      return {
        id: readString(record.id) || `criterion_${criterionIndex + 1}_check_${index + 1}`,
        kind: readCheckKind(record.kind),
        description:
          readString(record.description) ||
          readString(record.title) ||
          description,
        params:
          record.params && typeof record.params === "object"
            ? (record.params as Record<string, unknown>)
            : {},
        requiresEvidence: Boolean(record.requiresEvidence),
      };
    })
    .filter((check): check is AcceptanceCheck => Boolean(check));
}

function normalizeParsedMilestones(
  value: unknown,
  successCriteria: SuccessCriterion[],
): Milestone[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index): Milestone | null => {
      const description =
        typeof item === "string"
          ? item.trim()
          : item && typeof item === "object"
            ? readString((item as Record<string, unknown>).description)
            : "";
      if (!description) {
        return null;
      }
      return {
        id:
          item && typeof item === "object"
            ? readString((item as Record<string, unknown>).id) ||
              `milestone_${index + 1}`
            : `milestone_${index + 1}`,
        description,
        dependsOn: [],
        successCriteria,
        state: index === 0 ? "ready" : "pending",
        runIds: [],
        attempts: 0,
      };
    })
    .filter((milestone): milestone is Milestone => Boolean(milestone));
}

function addSignalBasedChecks(
  criteria: SuccessCriterion[],
  sourceMessage: string,
): SuccessCriterion[] {
  const signals = inferAcceptanceChecks(sourceMessage);
  if (!signals.length) {
    return criteria;
  }

  const first = criteria[0] ?? createModelReviewCriterion(sourceMessage);
  const existingIds = new Set(
    criteria.flatMap((criterion) => criterion.acceptanceChecks.map((check) => check.id)),
  );
  const nextSignals = signals.filter((check) => !existingIds.has(check.id));
  if (!nextSignals.length) {
    return criteria;
  }

  return [
    {
      ...first,
      acceptanceChecks: [...nextSignals, ...first.acceptanceChecks],
    },
    ...criteria.slice(1),
  ];
}

function inferAcceptanceChecks(message: string): AcceptanceCheck[] {
  const checks: AcceptanceCheck[] = [];
  const testCommand =
    message.match(/\b(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:test|verify|build|smoke:[\w:-]+|harness:check)\b[^\n。；;]*/i)?.[0]?.trim() ??
    message.match(/\b(?:vitest|jest|pytest|go test|cargo test)\b[^\n。；;]*/i)?.[0]?.trim();

  if (testCommand) {
    checks.push({
      id: "check_declared_test_command",
      kind: /test|vitest|jest|pytest|go test|cargo test/i.test(testCommand)
        ? "test_passes"
        : "command_exit_code",
      description: `Command succeeds: ${testCommand}`,
      params: { command: testCommand, expectedExitCode: 0 },
      requiresEvidence: true,
    });
  }

  const filePath = message.match(
    /(?:^|\s)([\w./ -]+\.(?:ts|tsx|js|jsx|json|md|css|html|py|go|rs|yml|yaml))(?:\s|$)/,
  )?.[1]?.trim();
  if (filePath && !filePath.includes(" ")) {
    checks.push({
      id: "check_referenced_file_exists",
      kind: "file_exists",
      description: `Referenced file exists: ${filePath}`,
      params: { path: filePath },
      requiresEvidence: false,
    });
  }

  return checks;
}

function createModelReviewCriterion(description: string): SuccessCriterion {
  return {
    id: "criterion_goal_satisfied",
    description: `Goal condition is satisfied: ${description}`,
    acceptanceChecks: [
      {
        id: "criterion_goal_satisfied_review",
        kind: "model_review",
        description:
          "An independent judge confirms the goal condition is satisfied from recorded execution evidence.",
        params: {
          condition: description,
          evidenceRefs: ["artifact:goalEvidence"],
        },
        requiresEvidence: true,
      },
    ],
  };
}

function normalizeGoalDescription(message: string): string {
  const normalized = message
    .replace(/^\/(?:目标|goal)\s*/i, "")
    .replace(/^(把这轮设为目标|这轮目标是|接下来目标是|目标)\s*[:：]?\s*/i, "")
    .replace(/^\s*#{1,6}\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 96
    ? `${normalized.slice(0, 95).trimEnd()}…`
    : normalized;
}

function planningFallbackWarning() {
  return {
    code: "planning_model_unavailable" as const,
    severity: "warning" as const,
    message: "目标规划模型暂时不可用，已使用本地结构化降级方案。",
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException("Canceled", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readCheckKind(value: unknown): AcceptanceCheckKind {
  return typeof value === "string" ? (value as AcceptanceCheckKind) : "model_review";
}
