import type { DebateRoundKind } from "./planMode";

const MAX_STRUCTURED_OUTPUT_CHARS = 128_000;
const MAX_SALVAGE_POSITIONS = 24;

export function parseUniquePlanRoundObject<T>(
  content: string,
  normalize: (value: Record<string, unknown>) => T,
): T {
  if (content.length > MAX_STRUCTURED_OUTPUT_CHARS) {
    throw new Error(
      `规划模型结构化输出超过 ${MAX_STRUCTURED_OUTPUT_CHARS} 个字符。`,
    );
  }
  const candidates = extractTopLevelJsonObjects(content);
  if (candidates.length === 0) {
    throw new Error("规划模型没有返回完整 JSON 对象。");
  }

  const valid: T[] = [];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      valid.push(normalize(assertRecord(JSON.parse(candidate), "root")));
    } catch (error) {
      lastError = error;
    }
  }
  if (valid.length === 1) {
    return valid[0]!;
  }
  if (valid.length > 1) {
    throw new Error("规划模型返回了多个符合当前轮次合同的 JSON 对象。");
  }

  // Observed in production (2026-08-02, contentSha256 805202…): the model
  // closed the root object one field too early (a single spurious `}` after
  // "assumptions"), splitting one plan JSON into fragments. The fragment
  // errors ("title 必须是非空字符串" on a bare milestone object) completely
  // masked the real syntax error — and the repair round, fed the misleading
  // error, regenerated the same slip. Analyze the outermost JSON span as a
  // whole before surfacing any fragment error.
  const whole = sliceOutermostJsonSpan(content);
  if (whole && candidates.length > 1) {
    const salvaged = salvageSinglePrematureBrace(whole, (value) =>
      normalize(assertRecord(value, "root")),
    );
    if (salvaged !== undefined) {
      return salvaged;
    }
    try {
      JSON.parse(whole);
    } catch (syntaxError) {
      const detail =
        syntaxError instanceof Error ? syntaxError.message : String(syntaxError);
      throw new Error(
        `规划输出 JSON 存在语法错误，响应被切成 ${candidates.length} 个片段（疑似多/缺括号）：${detail}`,
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("规划模型返回的 JSON 对象未通过当前轮次合同校验。");
}

/**
 * The span from the first `{` to the last `}` — the model's intended JSON
 * object when prose or a syntax slip surrounds/splits it.
 */
function sliceOutermostJsonSpan(content: string): string | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  return content.slice(start, end + 1);
}

/**
 * Bounded single-position salvage for the premature-`}` slip: when the root
 * object was closed one field too early, the remainder (`,"field":...}`)
 * still follows. Deleting exactly that one `}` rejoins the object. Only
 * positions where a `}` returns to depth 0 and the next token is `,` are
 * tried, at most MAX_SALVAGE_POSITIONS of them, and a candidate wins only
 * if it both parses and passes the round contract — fail-closed otherwise.
 */
function salvageSinglePrematureBrace<T>(
  whole: string,
  normalize: (value: Record<string, unknown>) => T,
): T | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let tried = 0;
  for (let index = 0; index < whole.length - 1; index += 1) {
    const character = whole[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"' && depth > 0) {
      inString = true;
      continue;
    }
    if (character === "{") {
      depth += 1;
      continue;
    }
    if (character !== "}") {
      continue;
    }
    depth -= 1;
    if (depth !== 0) {
      continue;
    }
    const rest = whole.slice(index + 1).trimStart();
    if (!rest.startsWith(",")) {
      continue;
    }
    tried += 1;
    if (tried > MAX_SALVAGE_POSITIONS) {
      return undefined;
    }
    const rejoined = whole.slice(0, index) + whole.slice(index + 1);
    try {
      return normalize(assertRecord(JSON.parse(rejoined), "root"));
    } catch {
      // This position was not the slip — keep scanning.
    }
  }
  return undefined;
}

export function assertValidPlanRoundShape(
  kind: DebateRoundKind,
  value: Record<string, unknown>,
  schemaVersion: 1 | 2 = 1,
): void {
  if (kind === "b1" || kind === "b2") {
    assertNonEmptyString(value.summary, "summary");
    assertObjectArray(value.issues, "issues", (issue, index) => {
      const prefix = `issues[${index}]`;
      for (const key of [
        "id",
        "target",
        "claim",
        "evidenceOrCounterexample",
        "requestedChange",
      ] as const) {
        assertNonEmptyString(issue[key], `${prefix}.${key}`);
      }
      assertEnum(
        issue.severity,
        ["low", "medium", "high", "critical"],
        `${prefix}.severity`,
      );
      assertEnum(
        issue.status,
        ["open", "accepted", "rejected", "resolved"],
        `${prefix}.status`,
      );
    });
    assertStringArray(value.minorityOpinion, "minorityOpinion");
    assertObjectArray(value.unresolvedRisks, "unresolvedRisks", assertRiskShape);
    return;
  }

  assertProposalShape(value, schemaVersion);
  if (kind === "a2") {
    assertObjectArray(value.decisions, "decisions", (decision, index) => {
      const prefix = `decisions[${index}]`;
      assertNonEmptyString(decision.issueId, `${prefix}.issueId`);
      assertEnum(
        decision.decision,
        ["accepted", "rejected", "partially_accepted"],
        `${prefix}.decision`,
      );
      assertNonEmptyString(decision.reason, `${prefix}.reason`);
      assertStringArray(decision.changedSections, `${prefix}.changedSections`);
    });
  }
  if (kind === "direct" || kind === "c") {
    assertObjectArray(value.claimLedger, "claimLedger", (claim, index) => {
      const prefix = `claimLedger[${index}]`;
      assertNonEmptyString(claim.id, `${prefix}.id`);
      assertNonEmptyString(claim.claim, `${prefix}.claim`);
      assertStringArray(claim.evidenceRefs, `${prefix}.evidenceRefs`);
      assertStringArray(claim.counterexamples, `${prefix}.counterexamples`);
      assertStringArray(claim.conditions, `${prefix}.conditions`);
      if (
        typeof claim.confidence !== "number" ||
        !Number.isFinite(claim.confidence) ||
        claim.confidence < 0 ||
        claim.confidence > 1
      ) {
        throw new Error(`${prefix}.confidence 必须是 0 到 1 的数字。`);
      }
      assertEnum(
        claim.status,
        ["verified", "contested", "unverified", "rejected"],
        `${prefix}.status`,
      );
    });
    assertStringArray(value.unresolvedQuestions, "unresolvedQuestions");
    assertStringArray(value.minorityOpinion, "minorityOpinion");
    assertEnum(value.actionGate, ["ready", "needs_input", "blocked"], "actionGate");
    assertNonEmptyString(value.gateReason, "gateReason");
  }
}

function assertProposalShape(
  value: Record<string, unknown>,
  schemaVersion: 1 | 2,
): void {
  for (const key of ["title", "summary", "objective"] as const) {
    assertNonEmptyString(value[key], key);
  }
  const scope = assertRecord(value.scope, "scope");
  assertStringArray(scope.in, "scope.in");
  assertStringArray(scope.out, "scope.out");
  assertStringArray(value.assumptions, "assumptions");
  assertObjectArray(
    value.milestones,
    "milestones",
    (milestone, index) => {
      const prefix = `milestones[${index}]`;
      for (const key of ["id", "title", "description"] as const) {
        assertNonEmptyString(milestone[key], `${prefix}.${key}`);
      }
      assertStringArray(
        milestone.acceptanceCriteria,
        `${prefix}.acceptanceCriteria`,
        { requireNonEmpty: true },
      );
      assertStringArray(milestone.dependencies, `${prefix}.dependencies`);
      if (schemaVersion === 2) {
        assertStringArray(milestone.targetRefs, `${prefix}.targetRefs`);
        assertStringArray(milestone.evidenceRefs, `${prefix}.evidenceRefs`);
        assertStringArray(milestone.actions, `${prefix}.actions`, {
          requireNonEmpty: true,
        });
        assertStringArray(milestone.toolNames, `${prefix}.toolNames`);
        assertObjectArray(
          milestone.acceptanceChecks,
          `${prefix}.acceptanceChecks`,
          assertAcceptanceCheckShape,
          { requireNonEmpty: true },
        );
      }
    },
    { requireNonEmpty: true },
  );
  assertStringArray(value.dependencies, "dependencies");
  assertObjectArray(value.risks, "risks", assertRiskShape);
  assertStringArray(value.acceptanceCriteria, "acceptanceCriteria", {
    requireNonEmpty: true,
  });
  if (schemaVersion === 2) {
    assertObjectArray(
      value.acceptanceChecks,
      "acceptanceChecks",
      assertAcceptanceCheckShape,
      { requireNonEmpty: true },
    );
  }
}

function assertAcceptanceCheckShape(
  check: Record<string, unknown>,
  index: number,
): void {
  const prefix = `acceptanceChecks[${index}]`;
  assertNonEmptyString(check.id, `${prefix}.id`);
  assertNonEmptyString(check.kind, `${prefix}.kind`);
  assertNonEmptyString(check.description, `${prefix}.description`);
  assertRecord(check.params, `${prefix}.params`);
  if (typeof check.requiresEvidence !== "boolean") {
    throw new Error(
      `规划输出字段 ${prefix}.requiresEvidence 必须是布尔值。`,
    );
  }
}

function assertRiskShape(
  risk: Record<string, unknown>,
  index: number,
): void {
  const prefix = `risks[${index}]`;
  for (const key of ["id", "description", "mitigation"] as const) {
    assertNonEmptyString(risk[key], `${prefix}.${key}`);
  }
  assertEnum(
    risk.severity,
    ["low", "medium", "high", "critical"],
    `${prefix}.severity`,
  );
  assertEnum(
    risk.status,
    ["resolved", "open", "accepted"],
    `${prefix}.status`,
  );
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`规划输出字段 ${field} 必须是非空字符串。`);
  }
}

function assertStringArray(
  value: unknown,
  field: string,
  options: { requireNonEmpty?: boolean } = {},
): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    (options.requireNonEmpty && value.length === 0) ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new Error(
      `规划输出字段 ${field} 必须是${
        options.requireNonEmpty ? "非空" : ""
      }字符串数组。`,
    );
  }
}

function assertObjectArray(
  value: unknown,
  field: string,
  validate: (item: Record<string, unknown>, index: number) => void,
  options: { requireNonEmpty?: boolean } = {},
): void {
  if (
    !Array.isArray(value) ||
    (options.requireNonEmpty && value.length === 0)
  ) {
    throw new Error(
      `规划输出字段 ${field} 必须是${
        options.requireNonEmpty ? "非空" : ""
      }对象数组。`,
    );
  }
  value.forEach((item, index) => {
    validate(assertRecord(item, `${field}[${index}]`), index);
  });
}

function assertRecord(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`规划输出字段 ${field} 必须是对象。`);
  }
  return value as Record<string, unknown>;
}

function assertEnum(
  value: unknown,
  allowed: readonly string[],
  field: string,
): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(
      `规划输出字段 ${field} 必须是 ${allowed.join("、")} 之一。`,
    );
  }
}

function extractTopLevelJsonObjects(content: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"' && depth > 0) {
      inString = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (character !== "}" || depth === 0) continue;
    depth -= 1;
    if (depth === 0 && start >= 0) {
      candidates.push(content.slice(start, index + 1));
      start = -1;
    }
  }
  return candidates;
}
