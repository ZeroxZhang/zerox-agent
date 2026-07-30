import type { DebateRoundKind } from "./planMode";

const MAX_STRUCTURED_OUTPUT_CHARS = 128_000;

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
  throw lastError instanceof Error
    ? lastError
    : new Error("规划模型返回的 JSON 对象未通过当前轮次合同校验。");
}

export function assertValidPlanRoundShape(
  kind: DebateRoundKind,
  value: Record<string, unknown>,
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

  assertProposalShape(value);
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

function assertProposalShape(value: Record<string, unknown>): void {
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
    },
    { requireNonEmpty: true },
  );
  assertStringArray(value.dependencies, "dependencies");
  assertObjectArray(value.risks, "risks", assertRiskShape);
  assertStringArray(value.acceptanceCriteria, "acceptanceCriteria", {
    requireNonEmpty: true,
  });
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
