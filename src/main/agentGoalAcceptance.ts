import { access, readFile, stat } from "node:fs/promises";
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
  extraReadRoots?: string[];
  extraWriteRoots?: string[];
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
  const candidatePath = resolveWorkspacePath(
    ctx.workspacePath,
    requestedPath,
    getAllowedExtraRoots(ctx),
  );
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
  const pathCheck = checkCommandPaths(
    check,
    command,
    ctx.workspacePath,
    getAllowedExtraRoots(ctx),
  );
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
  const pathCheck = checkCommandPaths(
    check,
    command,
    ctx.workspacePath,
    getAllowedExtraRoots(ctx),
  );
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
  extraRoots: string[] = [],
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
    if (resolveWorkspacePath(workspacePath, token, extraRoots) === null) {
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

  const evidence = await formatEvidenceForPrompt(evidenceRefs, ctx);
  if (evidence.missingArtifactRefs.length > 0) {
    return {
      checkResult: checkResult(
        check,
        false,
        evidenceRefs,
        `Missing required artifact evidence: ${evidence.missingArtifactRefs.join(", ")}.`,
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
          "You are an independent goal acceptance judge.",
          "Decide whether the requested condition is satisfied using only the evidence below.",
          `Condition: ${String(check.params.condition ?? check.description)}`,
          `Check: ${check.description}`,
          "Evidence:",
          ...evidence.lines,
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
  extraRoots: string[] = [],
): string | null {
  const workspaceRoot = path.resolve(workspacePath);
  const candidate = resolveRequestedPath(workspaceRoot, requestedPath);
  if (isPathInsideDirectory(candidate, workspaceRoot)) {
    return candidate;
  }

  for (const root of extraRoots) {
    if (isPathInsideDirectory(candidate, root)) {
      return candidate;
    }
  }
  return null;
}

function resolveRequestedPath(workspaceRoot: string, requestedPath: string): string {
  if (requestedPath.startsWith("~/")) {
    return path.join("__HOME__", requestedPath.slice(2));
  }

  return path.resolve(workspaceRoot, requestedPath);
}

function getAllowedExtraRoots(ctx: AcceptanceContext): string[] {
  return [
    ...(ctx.extraReadRoots ?? []),
    ...(ctx.extraWriteRoots ?? []),
  ];
}

function isPathInsideDirectory(
  candidatePath: string,
  directoryPath: string,
): boolean {
  const candidate = normalizeComparablePath(candidatePath);
  const directory = normalizeComparablePath(directoryPath);
  return candidate === directory || candidate.startsWith(`${directory}/`);
}

function normalizeComparablePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized || "/";
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

async function formatEvidenceForPrompt(
  evidenceRefs: string[],
  ctx: AcceptanceContext,
): Promise<{ lines: string[]; missingArtifactRefs: string[] }> {
  const lines: string[] = [];
  const missingArtifactRefs: string[] = [];
  for (const ref of evidenceRefs) {
    if (!ref.startsWith("artifact:")) {
      lines.push(`- ${ref}`);
      continue;
    }

    const artifactName = ref.slice("artifact:".length);
    const artifact = ctx.artifacts?.[artifactName];
    if (artifact === undefined) {
      const fileArtifact = await resolveArtifactEvidenceFile(artifactName, ctx);
      if (!fileArtifact) {
        missingArtifactRefs.push(ref);
      }
      lines.push(
        fileArtifact
          ? `- ${ref}: ${truncateEvidence(JSON.stringify(fileArtifact))}`
          : `- ${ref}: missing`,
      );
      continue;
    }

    lines.push(`- ${ref}: ${truncateEvidence(JSON.stringify(artifact))}`);
  }
  return { lines, missingArtifactRefs };
}

async function resolveArtifactEvidenceFile(
  artifactName: string,
  ctx: AcceptanceContext,
): Promise<Record<string, unknown> | null> {
  if (!isSafeArtifactName(artifactName)) {
    return null;
  }

  for (const candidatePath of getArtifactEvidenceCandidatePaths(artifactName, ctx)) {
    try {
      const stats = await stat(candidatePath);
      if (!stats.isFile()) {
        continue;
      }

      const content = await readFile(candidatePath, "utf8");
      return {
        path: candidatePath,
        sizeBytes: stats.size,
        contentPreview: truncateEvidence(content),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  return null;
}

function getArtifactEvidenceCandidatePaths(
  artifactName: string,
  ctx: AcceptanceContext,
): string[] {
  const fileNames = getArtifactEvidenceFileNames(artifactName);
  const roots = dedupePaths([ctx.workspacePath, ...getAllowedExtraRoots(ctx)]);
  const candidates: string[] = [];

  for (const root of roots) {
    for (const fileName of fileNames) {
      const candidatePath = path.resolve(root, fileName);
      if (isPathInsideDirectory(candidatePath, root)) {
        candidates.push(candidatePath);
      }
    }
  }

  return candidates;
}

function getArtifactEvidenceFileNames(artifactName: string): string[] {
  if (path.extname(artifactName)) {
    return [artifactName];
  }

  return [
    artifactName,
    `${artifactName}.md`,
    `${artifactName}.markdown`,
    `${artifactName}.txt`,
    `${artifactName}.json`,
  ];
}

function isSafeArtifactName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes("..");
}

function dedupePaths(paths: string[]): string[] {
  const normalized: string[] = [];
  for (const value of paths) {
    const candidate = normalizeComparablePath(path.resolve(value));
    if (!normalized.includes(candidate)) {
      normalized.push(candidate);
    }
  }
  return normalized;
}

function truncateEvidence(value: string): string {
  const maxChars = 4000;
  return value.length > maxChars
    ? `${value.slice(0, maxChars)}... [truncated]`
    : value;
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
