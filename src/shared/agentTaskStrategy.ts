import { preferNativeToolForOperation } from "./agentToolCapabilities";

export type TaskDomain =
  | "files"
  | "code"
  | "web"
  | "data"
  | "writing"
  | "system"
  | "research"
  | "unknown";

export type TaskMode =
  | "deterministic"
  | "exploratory"
  | "interactive"
  | "long_running";

export type TaskRisk =
  | "read_only"
  | "writes_files"
  | "moves_data"
  | "deletes_data"
  | "external_side_effect";

export type ExpectedTaskScale = "small" | "medium" | "large";

export type RuntimeStrategy =
  | "quick_action"
  | "agent_loop"
  | "goal_mode"
  | "scripted_workflow";

export type ResolvedReference = {
  rawText: string;
  canonical: string;
  kind: "path" | "url" | "branch" | "env" | "artifact" | "account";
  exists?: boolean;
  confidence: number;
  alternatives: string[];
};

export type TaskFrame = {
  domain: TaskDomain;
  mode: TaskMode;
  risk: TaskRisk;
  expectedScale: ExpectedTaskScale;
  needsConfirmation: boolean;
  targetRefs: ResolvedReference[];
  ambiguity: Array<{ field: string; reason: string; options: string[] }>;
  recommendedRuntime: RuntimeStrategy;
};

export type StrategyPlanStep = {
  id: string;
  operation: string;
  toolName?: string;
  toolClass:
    | "batch_read"
    | "single_read"
    | "write"
    | "shell"
    | "browser"
    | "test"
    | "model";
  risk: "none" | "local_write" | "destructive" | "external";
  batchExpected: boolean;
  platformSensitive: boolean;
};

export type StrategyPlan = {
  runtime: RuntimeStrategy;
  confirmationGates: Array<{ id: string; beforeStepId: string; reason: string }>;
  steps: StrategyPlanStep[];
};

export type StrategyLintIssueCode =
  | "DETERMINISTIC_TASK_IN_GOAL_MODE"
  | "MISSING_SIDE_EFFECT_CONFIRMATION"
  | "SHELL_USED_FOR_DETERMINISTIC_WORK"
  | "FRAGMENTED_TOOL_CALLS"
  | "PREFER_NATIVE_TOOL";

export type StrategyLintIssue = {
  code: StrategyLintIssueCode;
  severity: "warn" | "error";
  message: string;
};

export type StrategyLintResult = {
  valid: boolean;
  issues: StrategyLintIssue[];
};

const pathCandidatePattern =
  /(?:~\/|\/)[^\n，,。；;]+?(?=$|[，,。；;])/g;

export function resolveUserReferences(message: string): ResolvedReference[] {
  const references: ResolvedReference[] = [];

  for (const match of message.matchAll(pathCandidatePattern)) {
    const rawText = match[0].trim();
    const canonical = stripNaturalLanguagePathSuffix(rawText);
    if (!canonical) {
      continue;
    }

    references.push({
      rawText,
      canonical,
      kind: "path",
      exists: undefined,
      confidence: canonical === rawText ? 0.9 : 0.95,
      alternatives: [],
    });
  }

  return references;
}

export function classifyTaskFrame(message: string): TaskFrame {
  const normalized = message.toLowerCase();
  const targetRefs = resolveUserReferences(message);
  const domain = classifyDomain(normalized, targetRefs);
  const risk = classifyRisk(normalized, domain);
  const mode = classifyMode(normalized, domain);
  const expectedScale = classifyExpectedScale(normalized);
  const needsConfirmation =
    risk === "moves_data" ||
    risk === "deletes_data" ||
    risk === "external_side_effect";

  return {
    domain,
    mode,
    risk,
    expectedScale,
    needsConfirmation,
    targetRefs,
    ambiguity: buildAmbiguity(targetRefs),
    recommendedRuntime: recommendRuntime(domain, mode, expectedScale),
  };
}

export function lintExecutionStrategy(
  frame: TaskFrame,
  plan: StrategyPlan,
): StrategyLintResult {
  const issues: StrategyLintIssue[] = [];

  if (
    frame.mode === "deterministic" &&
    frame.expectedScale === "small" &&
    plan.runtime === "goal_mode"
  ) {
    issues.push({
      code: "DETERMINISTIC_TASK_IN_GOAL_MODE",
      severity: "error",
      message:
        "Small deterministic work should use a quick action or scripted workflow, not Goal Mode.",
    });
  }

  if (
    requiresSideEffectConfirmation(frame, plan) &&
    plan.confirmationGates.length === 0
  ) {
    issues.push({
      code: "MISSING_SIDE_EFFECT_CONFIRMATION",
      severity: "error",
      message:
        "Plans with local writes, moves, destructive changes, or external side effects need a preview confirmation gate.",
    });
  }

  if (
    frame.mode === "deterministic" &&
    plan.steps.some((step) => step.toolName === "shell_exec")
  ) {
    issues.push({
      code: "SHELL_USED_FOR_DETERMINISTIC_WORK",
      severity: "error",
      message:
        "Deterministic local work should prefer typed native tools over platform-sensitive shell commands.",
    });
  }

  if (hasFragmentedRepeatedToolCalls(plan)) {
    issues.push({
      code: "FRAGMENTED_TOOL_CALLS",
      severity: "error",
      message:
        "Repeated single-item tool calls indicate missing batch or recursive strategy.",
    });
  }

  issues.push(...nativeToolPreferenceIssues(frame, plan));

  return {
    valid: issues.length === 0,
    issues,
  };
}

function nativeToolPreferenceIssues(
  frame: TaskFrame,
  plan: StrategyPlan,
): StrategyLintIssue[] {
  return plan.steps.flatMap((step) => {
    const preference = preferNativeToolForOperation({
      domain: frame.domain,
      operation: step.operation,
      currentToolName: step.toolName,
    });

    return preference
      ? [
          {
            code: "PREFER_NATIVE_TOOL" as const,
            severity: "warn" as const,
            message: preference.reason,
          },
        ]
      : [];
  });
}

function classifyDomain(
  normalized: string,
  targetRefs: ResolvedReference[],
): TaskDomain {
  if (
    /(修复|测试|代码|bug|build|repo|pr|commit|diff)/i.test(normalized)
  ) {
    return "code";
  }

  if (
    targetRefs.some((reference) => reference.kind === "path") &&
    /(整理|清理|归档|分析|扫描|目录|文件夹|folder|directory|organize|clean|scan)/i.test(
      normalized,
    )
  ) {
    return "files";
  }

  if (/(网页|浏览器|url|website|page)/i.test(normalized)) {
    return "web";
  }

  if (/(数据|表格|csv|excel|sheet|dataset)/i.test(normalized)) {
    return "data";
  }

  if (/(报告|文章|文档|write|draft|markdown)/i.test(normalized)) {
    return "writing";
  }

  return "unknown";
}

function classifyMode(normalized: string, domain: TaskDomain): TaskMode {
  if (/(持续|长期|每天|每周|监控|long-running|monitor)/i.test(normalized)) {
    return "long_running";
  }

  if (domain === "files") {
    return "deterministic";
  }

  if (domain === "unknown") {
    return "interactive";
  }

  return "exploratory";
}

function classifyRisk(normalized: string, domain: TaskDomain): TaskRisk {
  if (/(删除|移除|清空|delete|remove)/i.test(normalized)) {
    return "deletes_data";
  }

  if (/(移动|整理|归类|归档|move|organize|archive)/i.test(normalized)) {
    return "moves_data";
  }

  if (/(发送|发布|部署|deploy|send|publish)/i.test(normalized)) {
    return "external_side_effect";
  }

  if (domain === "code" || /(修改|写入|更新|fix|change|edit)/i.test(normalized)) {
    return "writes_files";
  }

  return "read_only";
}

function classifyExpectedScale(normalized: string): ExpectedTaskScale {
  if (/(所有|递归|整个|全部|海量|大量|large|recursive|all)/i.test(normalized)) {
    return "medium";
  }

  return "small";
}

function recommendRuntime(
  domain: TaskDomain,
  mode: TaskMode,
  expectedScale: ExpectedTaskScale,
): RuntimeStrategy {
  if (mode === "long_running") {
    return "goal_mode";
  }

  if (mode === "deterministic" && expectedScale === "small") {
    return "quick_action";
  }

  if (domain === "unknown") {
    return "agent_loop";
  }

  return "agent_loop";
}

function buildAmbiguity(
  targetRefs: ResolvedReference[],
): TaskFrame["ambiguity"] {
  return targetRefs
    .filter((reference) => reference.confidence < 0.85)
    .map((reference) => ({
      field: "targetRefs",
      reason: `Low confidence ${reference.kind} reference: ${reference.rawText}`,
      options: [reference.canonical, ...reference.alternatives],
    }));
}

function requiresSideEffectConfirmation(
  frame: TaskFrame,
  plan: StrategyPlan,
): boolean {
  if (frame.needsConfirmation) {
    return true;
  }

  return plan.steps.some((step) =>
    step.risk === "local_write" ||
    step.risk === "destructive" ||
    step.risk === "external"
  );
}

function hasFragmentedRepeatedToolCalls(plan: StrategyPlan): boolean {
  const counts = new Map<string, number>();

  for (const step of plan.steps) {
    if (!step.toolName || step.batchExpected) {
      continue;
    }
    counts.set(step.toolName, (counts.get(step.toolName) ?? 0) + 1);
  }

  return Array.from(counts.values()).some((count) => count >= 4);
}

function stripNaturalLanguagePathSuffix(value: string): string {
  return value
    .trim()
    .replace(
      /\s*(这个|该|当前)?(文件夹|目录|folder|directory)(里|里面|中|下)?$/i,
      "",
    )
    .trim();
}
