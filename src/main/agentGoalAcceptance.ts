import { access } from "node:fs/promises";
import path from "node:path";
import type { AgentToolExecutor, AgentToolExecutionResult } from "./agentToolExecutor";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import type {
  ChatClient,
  ChatCompletionRequest,
} from "./openAiCompatibleClient";
import type {
  AcceptanceCheck,
  AcceptanceCheckKind,
  Goal,
  Milestone,
  SuccessCriterion,
} from "../shared/agentGoal";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";

export type AcceptanceResult = {
  accepted: boolean;
  checkResults: Array<{
    checkId: string;
    kind: AcceptanceCheckKind;
    passed: boolean;
    evidenceRefs: string[];
    detail: string;
  }>;
  inferentialUsed: boolean;
};

export type AcceptanceContext = {
  runId: string;
  goalId?: string;
  milestoneId?: string;
  workspacePath: string;
  toolExecutor: Pick<AgentToolExecutor, "execute">;
  trajectoryStore: Pick<AgentTrajectoryStore, "append">;
  chatClient?: ChatClient;
  modelProfile?: Pick<
    ChatCompletionRequest,
    "baseUrl" | "apiKey" | "model" | "temperature" | "maxTokens"
  >;
  artifacts?: Record<string, unknown>;
  createId?: () => string;
  nextSequence?: () => number;
  now?: () => string;
};

export type AgentGoalAcceptance = {
  evaluate(milestone: Milestone, ctx: AcceptanceContext): Promise<AcceptanceResult>;
  evaluateGoal(goal: Goal, ctx: AcceptanceContext): Promise<AcceptanceResult>;
};

type CheckResult = AcceptanceResult["checkResults"][number];

export function createAgentGoalAcceptance(): AgentGoalAcceptance {
  return {
    async evaluate(milestone, ctx) {
      const result = await evaluateCriteria(milestone.successCriteria, ctx);
      await emitAcceptanceChecked(ctx, result, {
        targetKind: "milestone",
        milestoneId: milestone.id,
      });
      return result;
    },

    async evaluateGoal(goal, ctx) {
      const result = await evaluateCriteria(goal.successCriteria, ctx);
      await emitAcceptanceChecked(ctx, result, {
        targetKind: "goal",
        goalId: goal.id,
      });
      return result;
    },
  };
}

async function evaluateCriteria(
  criteria: SuccessCriterion[],
  ctx: AcceptanceContext,
): Promise<AcceptanceResult> {
  const checks = criteria.flatMap((criterion) => criterion.acceptanceChecks);
  const deterministicChecks = checks.filter((check) => check.kind !== "model_review");
  const modelReviewChecks = checks.filter((check) => check.kind === "model_review");
  const checkResults: CheckResult[] = [];

  for (const check of deterministicChecks) {
    checkResults.push(await evaluateDeterministicCheck(check, ctx));
  }

  const deterministicPassed = checkResults.every((result) => result.passed);
  let inferentialUsed = false;

  if (deterministicPassed) {
    for (const check of modelReviewChecks) {
      const result = await evaluateModelReview(check, ctx);
      inferentialUsed = inferentialUsed || result.inferentialUsed;
      checkResults.push(result.checkResult);
    }
  }

  return {
    accepted:
      checkResults.length === checks.length &&
      checkResults.every((result) => result.passed),
    checkResults,
    inferentialUsed,
  };
}

async function evaluateDeterministicCheck(
  check: AcceptanceCheck,
  ctx: AcceptanceContext,
): Promise<CheckResult> {
  switch (check.kind) {
    case "file_exists":
      return evaluateFileExists(check, ctx);
    case "command_exit_code":
      return evaluateCommandExitCode(check, ctx);
    case "test_passes":
      return evaluateTestPasses(check, ctx);
    case "assertion":
      return evaluateAssertion(check, ctx);
    case "model_review":
      throw new Error("model_review is not deterministic.");
  }
}

async function evaluateFileExists(
  check: AcceptanceCheck,
  ctx: AcceptanceContext,
): Promise<CheckResult> {
  const requestedPath = String(check.params.path ?? "");
  const candidatePath = resolveWorkspacePath(ctx.workspacePath, requestedPath);
  if (!candidatePath) {
    return checkResult(check, false, [], "Path is outside the workspace.");
  }

  try {
    await access(candidatePath);
    return checkResult(check, true, [], `File exists: ${requestedPath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return checkResult(check, false, [], `File does not exist: ${requestedPath}`);
    }

    throw error;
  }
}

async function evaluateCommandExitCode(
  check: AcceptanceCheck,
  ctx: AcceptanceContext,
): Promise<CheckResult> {
  const command = String(check.params.command ?? "");
  const pathCheck = checkCommandPaths(check, command, ctx.workspacePath);
  if (pathCheck) {
    return pathCheck;
  }

  const expectedExitCode = Number(check.params.expectedExitCode ?? 0);
  const result = await ctx.toolExecutor.execute({
    toolName: "shell_exec",
    args: { command },
  });
  const exitCode = getExitCode(result);
  const passed = exitCode === expectedExitCode;

  return checkResult(
    check,
    passed,
    getEvidenceRefs(result),
    `Command exited with ${exitCode}; expected ${expectedExitCode}.`,
  );
}

async function evaluateTestPasses(
  check: AcceptanceCheck,
  ctx: AcceptanceContext,
): Promise<CheckResult> {
  const command = String(check.params.command ?? "");
  const pathCheck = checkCommandPaths(check, command, ctx.workspacePath);
  if (pathCheck) {
    return pathCheck;
  }

  const result = await ctx.toolExecutor.execute({
    toolName: "test_run",
    args: {
      command,
      workspaceRoot: String(check.params.workspaceRoot ?? ctx.workspacePath),
    },
  });
  const exitCode = getExitCode(result);
  const passed = result.ok && exitCode === 0;

  return checkResult(
    check,
    passed,
    getEvidenceRefs(result),
    passed
      ? "Test command passed."
      : `Test command failed with exit code ${exitCode}.`,
  );
}

function checkCommandPaths(
  check: AcceptanceCheck,
  command: string,
  workspacePath: string,
): CheckResult | null {
  // Split by common shell separators and strip simple quotes.
  const tokens = command.split(/[\s;"'`|&()]+/).filter(Boolean);
  for (const raw of tokens) {
    const token = raw.replace(/^["']+|["']+$/g, "");
    if (!token) continue;
    const hasParentTraversal = /(^|\/)\.\.(\/|$)/.test(token);
    if (!path.isAbsolute(token) && !hasParentTraversal) {
      continue;
    }
    if (resolveWorkspacePath(workspacePath, token) === null) {
      return checkResult(
        check,
        false,
        [],
        `Command references a path outside the workspace: ${token}`,
      );
    }
  }
  return null;
}

function evaluateAssertion(
  check: AcceptanceCheck,
  ctx: AcceptanceContext,
): CheckResult {
  const artifactRef = String(check.params.artifactRef ?? "");
  const assertionPath = String(check.params.path ?? "");
  const artifact = ctx.artifacts?.[artifactRef];
  const actual = readNestedValue(artifact, assertionPath);
  const expected = check.params.equals;
  const passed = deepEqual(actual, expected);

  return checkResult(
    check,
    passed,
    artifactRef ? [artifactRef] : [],
    passed
      ? `Assertion passed at ${artifactRef}.${assertionPath}.`
      : `Assertion failed at ${artifactRef}.${assertionPath}.`,
  );
}

async function evaluateModelReview(
  check: AcceptanceCheck,
  ctx: AcceptanceContext,
): Promise<{ checkResult: CheckResult; inferentialUsed: boolean }> {
  const evidenceRefs = parseEvidenceRefs(check.params.evidenceRefs);
  if (!check.requiresEvidence || evidenceRefs.length === 0) {
    return {
      checkResult: checkResult(
        check,
        false,
        evidenceRefs,
        "Model review requires non-empty evidence references.",
      ),
      inferentialUsed: false,
    };
  }

  if (!ctx.chatClient) {
    return {
      checkResult: checkResult(
        check,
        false,
        evidenceRefs,
        "Model review requires a chat client.",
      ),
      inferentialUsed: false,
    };
  }

  const response = await ctx.chatClient.complete({
    ...getModelProfile(ctx),
    messages: [
      {
        role: "user",
        content: [
          "Review the provided goal acceptance evidence.",
          `Check: ${check.description}`,
          `Evidence refs: ${evidenceRefs.join(", ")}`,
          "Return JSON: {\"accepted\":true|false,\"detail\":\"reason\"}",
        ].join("\n"),
      },
    ],
    tool_choice: "none",
  });
  const parsed = parseModelReview(response.content ?? "");
  return {
    checkResult: checkResult(
      check,
      parsed.accepted,
      evidenceRefs,
      parsed.detail,
    ),
    inferentialUsed: true,
  };
}

async function emitAcceptanceChecked(
  ctx: AcceptanceContext,
  result: AcceptanceResult,
  target: {
    targetKind: "goal" | "milestone";
    goalId?: string;
    milestoneId?: string;
  },
): Promise<void> {
  const payload: Record<string, unknown> = {
    targetKind: target.targetKind,
    goalId: target.goalId ?? ctx.goalId,
    accepted: result.accepted,
    inferentialUsed: result.inferentialUsed,
    checkResults: result.checkResults,
  };

  if (target.targetKind === "milestone") {
    payload.milestoneId = target.milestoneId ?? ctx.milestoneId;
  }

  const event: AgentTrajectoryEvent = {
    id: ctx.createId?.() ?? `acceptance_${Date.now()}`,
    runId: ctx.runId,
    type: "acceptance_checked",
    sequence: ctx.nextSequence?.() ?? 0,
    payload,
    redaction: {
      containsApiKey: false,
      containsFileContent: false,
      containsUserText: true,
    },
    createdAt: ctx.now?.() ?? new Date().toISOString(),
  };

  await ctx.trajectoryStore.append(ctx.runId, event);
}

function checkResult(
  check: AcceptanceCheck,
  passed: boolean,
  evidenceRefs: string[],
  detail: string,
): CheckResult {
  return {
    checkId: check.id,
    kind: check.kind,
    passed,
    evidenceRefs,
    detail,
  };
}

function resolveWorkspacePath(
  workspacePath: string,
  requestedPath: string,
): string | null {
  const workspaceRoot = path.resolve(workspacePath);
  const candidate = path.resolve(workspaceRoot, requestedPath);
  const relative = path.relative(workspaceRoot, candidate);
  // Reject any path that escapes the workspace. This covers relative ".." traversal
  // and absolute paths that resolve outside the workspace (including Windows drives).
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return candidate;
}

function getExitCode(result: AgentToolExecutionResult): number {
  const value = result.ok ? result.result.exitCode : result.errorDetails?.exitCode;
  return typeof value === "number" ? value : 0;
}

function getEvidenceRefs(result: AgentToolExecutionResult): string[] {
  const value = result.ok
    ? result.result.evidenceRefs
    : result.errorDetails?.evidenceRefs;
  return parseEvidenceRefs(value);
}

function parseEvidenceRefs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readNestedValue(value: unknown, dottedPath: string): unknown {
  if (!dottedPath) return value;
  return dottedPath.split(".").reduce<unknown>((current, part) => {
    if (
      typeof current === "object" &&
      current !== null &&
      !Array.isArray(current) &&
      part in current
    ) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getModelProfile(
  ctx: AcceptanceContext,
): Pick<
  ChatCompletionRequest,
  "baseUrl" | "apiKey" | "model" | "temperature" | "maxTokens"
> {
  return (
    ctx.modelProfile ?? {
      baseUrl: "http://local.invalid",
      apiKey: "",
      model: "goal-review",
      temperature: 0,
      maxTokens: 1000,
    }
  );
}

function parseModelReview(content: string): {
  accepted: boolean;
  detail: string;
} {
  try {
    const parsed = JSON.parse(content) as {
      accepted?: unknown;
      detail?: unknown;
    };
    return {
      accepted: parsed.accepted === true,
      detail: typeof parsed.detail === "string" ? parsed.detail : "",
    };
  } catch {
    return {
      accepted: false,
      detail: "Model review response was not valid JSON.",
    };
  }
}
