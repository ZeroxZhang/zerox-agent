import { describe, expect, it } from "vitest";
import type { Goal, Milestone, SuccessCriterion } from "../shared/agentGoal";
import type { ChatSessionGoalSummary } from "../shared/chat";
import {
  buildGoalBudgetIncreaseDelta,
  buildGoalProgressViewModel,
  buildGoalStatusPresentation,
} from "./goalProgressViewModel";

describe("goal progress view model", () => {
  it("explains a planned chat goal as waiting to start", () => {
    const goal = createGoal({
      status: "planning",
      milestones: [milestone({ state: "ready" })],
    });

    const viewModel = buildGoalProgressViewModel(toSummary(goal), goal);

    expect(viewModel.statusLabel).toBe("已规划，待启动");
    expect(viewModel.statusDetail).toContain("还没有开始执行");
    expect(viewModel.nextActionLabel).toBe("开始执行");
    expect(viewModel.nextActionDetail).toContain("Milestone milestone_1");
    expect(viewModel.progressText).toBe("0/1 已完成");
    expect(viewModel.milestoneRows).toEqual([
      expect.objectContaining({
        description: "调研 serenity",
        stateLabel: "待执行",
      }),
    ]);
  });

  it("summarizes executing progress and the current milestone", () => {
    const goal = createGoal({
      status: "executing",
      milestones: [
        milestone({
          id: "milestone_done",
          state: "accepted",
          lastAcceptanceSummary: "资料源已验收。",
        }),
        milestone({ id: "milestone_running", state: "running" }),
      ],
      budgetUsage: {
        iterations: 1,
        toolCalls: 5,
        wallClockMs: 90_000,
        tokens: 0,
        replans: 0,
      },
    });

    const viewModel = buildGoalProgressViewModel(toSummary(goal), goal);

    expect(viewModel.statusLabel).toBe("执行中");
    expect(viewModel.nextActionLabel).toBe("当前阶段");
    expect(viewModel.nextActionDetail).toContain("Milestone milestone_running");
    expect(viewModel.progressText).toBe("1/2 已完成");
    expect(viewModel.metricCards).toEqual(
      expect.arrayContaining([
        { label: "迭代", value: "1" },
        { label: "工具调用", value: "5" },
        { label: "运行时间", value: "1.5 分钟" },
      ]),
    );
  });

  it("makes budget-stopped goals visibly terminal until the user resumes them", () => {
    const goal = createGoal({
      status: "stopped_budget",
      stopReason: "budget_exhausted",
      budgetUsage: {
        iterations: 8,
        toolCalls: 64,
        wallClockMs: 45 * 60 * 1000,
        tokens: 0,
        replans: 0,
      },
    });

    const viewModel = buildGoalProgressViewModel(toSummary(goal), goal);

    expect(viewModel.statusLabel).toBe("预算已用尽");
    expect(viewModel.statusDetail).toContain("不会在后台继续");
    expect(viewModel.nextActionLabel).toBe("需要你处理");
    expect(viewModel.metricCards.map((card) => card.label)).not.toContain("预算");
    expect(viewModel.metricCards.map((card) => card.value)).not.toContain("8/8");
  });

  it("keeps a fresh blocked session status authoritative while detail refreshes", () => {
    const staleDetail = createGoal({ status: "executing" });
    const freshSummary: ChatSessionGoalSummary = {
      id: staleDetail.id,
      description: staleDetail.description,
      status: "stopped_blocked",
    };

    const viewModel = buildGoalProgressViewModel(freshSummary, staleDetail);

    expect(viewModel.status).toBe("stopped_blocked");
    expect(viewModel.statusLabel).toBe("目标受阻");
    expect(viewModel.recoveryActions).toEqual([
      "retry_acceptance",
      "adjust_plan",
      "terminate",
    ]);
  });

  it("explains failed goals through explicit recovery actions", () => {
    const viewModel = buildGoalProgressViewModel(
      {
        id: "goal_failed",
        description: "深度调研 Serenity",
        status: "failed",
      },
      null,
    );

    expect(viewModel.statusLabel).toBe("失败");
    expect(viewModel.nextActionLabel).toBe("恢复路径");
    expect(viewModel.nextActionDetail).toContain("重试目标");
  });

  it("increases an overrun historical goal beyond its accumulated usage", () => {
    const goal = createGoal({
      status: "stopped_budget",
      budgetUsage: {
        iterations: 322,
        toolCalls: 2_105,
        wallClockMs: 53_905_191,
        tokens: 609_456,
        replans: 320,
      },
    });

    expect(buildGoalBudgetIncreaseDelta(goal)).toEqual({
      maxIterations: 322,
      maxToolCalls: 2_105,
      maxWallClockMs: 53_905_191,
      maxReplans: 320,
    });
  });

  it.each([
    [
      "validating",
      undefined,
      "正在验收",
      "正在运行确定性验收检查",
    ],
    [
      "repairing",
      repairDirective({ occurrence: 1, action: "repair_same_milestone" }),
      "正在修复验收问题（1/2）",
      "修复同一里程碑",
    ],
    [
      "repairing",
      repairDirective({ occurrence: 2, action: "retry_alternate_strategy" }),
      "已切换策略（2/2）",
      "切换执行策略",
    ],
  ] as const)(
    "projects the %s acceptance phase truthfully",
    (phase, lastDecision, statusLabel, detailFragment) => {
      const goal = createGoal({
        status: "executing",
        acceptanceProtocolVersion: 2,
        acceptanceState: {
          protocolVersion: 2,
          phase,
          attempt: 2,
          recentFailures: [],
          ...(lastDecision ? { lastDecision } : {}),
        },
      });

      const presentation = buildGoalStatusPresentation(goal.status, goal);

      expect(presentation.statusLabel).toBe(statusLabel);
      expect(presentation.statusDetail).toContain(detailFragment);
    },
  );

  it("explains a stalled goal as repeated acceptance failure, never completion", () => {
    const goal = createGoal({
      status: "stopped_stalled",
      stopReason: "progress_stalled",
      acceptanceProtocolVersion: 2,
      acceptanceState: {
        protocolVersion: 2,
        phase: "repairing",
        attempt: 3,
        recentFailures: [failureRecord({ occurrence: 3 })],
        lastDecision: repairDirective({
          occurrence: 3,
          action: "stop_stalled",
        }),
      },
    });

    const presentation = buildGoalStatusPresentation(goal.status, goal);

    expect(presentation.statusLabel).toBe("停滞停止");
    expect(presentation.statusDetail).toContain("重复验收失败");
    expect(presentation.statusLabel).not.toContain("完成");
  });

  it.each([
    ["external_blocked", "外部依赖"],
    ["goal_impossible", "条件被判定为无法实现"],
    ["acceptance_unavailable", "验收服务暂时不可用"],
  ] as const)(
    "projects %s as a recoverable blocked goal",
    (stopReason, detailFragment) => {
      const goal = createGoal({
        status: "stopped_blocked",
        stopReason,
        acceptanceProtocolVersion: 2,
        acceptanceState: {
          protocolVersion: 2,
          phase: "blocked",
          attempt: 1,
          recentFailures: [failureRecord()],
        },
      });

      expect(buildGoalStatusPresentation(goal.status, goal)).toMatchObject({
        statusLabel: "目标受阻",
        statusDetail: expect.stringContaining(detailFragment),
        recoveryActions: ["retry_acceptance", "adjust_plan", "terminate"],
      });
    },
  );

  it("projects a protocol-v2 certificate through an explicit safe allowlist", () => {
    const goal = createGoal({
      status: "achieved",
      stopReason: "goal_accepted",
      acceptanceProtocolVersion: 2,
      acceptanceState: {
        protocolVersion: 2,
        phase: "certified",
        attempt: 1,
        recentFailures: [],
      },
      acceptanceCertificate: certificate(),
    });

    const presentation = buildGoalStatusPresentation(goal.status, goal);

    expect(presentation).toMatchObject({
      statusLabel: "已达成",
      nextActionLabel: "查看验收证书",
      certificate: {
        acceptedAt: "2026-07-11T05:00:00.000Z",
        planVersion: 2,
        shortCertificateHash: "1234567890ab",
        checks: [
          {
            id: "safe_check",
            kind: "test_passes",
            passed: true,
            code: "tests_passed",
            evidenceRefs: ["artifact:report.md"],
          },
        ],
        artifacts: [
          {
            path: "/workspace/report.md",
            sizeBytes: 512,
            shortSha256: "abcdefabcdef",
          },
        ],
        judge: {
          model: "safe-model",
          promptVersion: "goal-acceptance-v2",
        },
      },
    });
    const serialized = JSON.stringify(presentation);
    expect(serialized).not.toContain("raw provider failure with sk-secret");
    expect(serialized).not.toContain("provider-secret");
    expect(serialized).not.toContain("message-secret");
    expect(serialized).not.toContain("full artifact body secret");
  });

  it("keeps legacy achieved goals truthful without fabricating a certificate", () => {
    const goal = createGoal({ status: "achieved", stopReason: "goal_accepted" });

    const presentation = buildGoalStatusPresentation(goal.status, goal);

    expect(presentation.statusLabel).toBe("已达成");
    expect(presentation.statusDetail).toContain("历史目标");
    expect(presentation.certificate).toBeUndefined();
    expect(presentation.nextActionLabel).toBe("历史验收记录");
  });

  it("bounds and deduplicates malformed legacy acceptance data without throwing", () => {
    const oversized = Array.from({ length: 40 }, (_, index) =>
      index % 2 === 0 ? `check_${index}` : "check_duplicate",
    );
    const unsafeGoal = createGoal({
      status: "stopped_blocked",
      stopReason: "acceptance_unavailable",
    }) as Goal & Record<string, unknown>;
    unsafeGoal.acceptanceState = {
      protocolVersion: 2,
      phase: "blocked",
      attempt: Number.NaN,
      recentFailures: [
        {
          ...failureRecord(),
          failedCheckIds: [...oversized, 42, null],
          evidenceRefs: Array.from(
            { length: 30 },
            (_, index) => `artifact:${"x".repeat(400)}-${index}`,
          ),
        },
      ],
      lastDecision: {
        ...repairDirective({ action: "stop_blocked" }),
        failedCheckIds: oversized,
      },
    } as never;
    unsafeGoal.acceptanceCertificate = {
      ...certificate(),
      checkResults: Array.from({ length: 30 }, (_, index) => ({
        ...certificate().checkResults[0],
        checkId: `check_${index}`,
        evidenceRefs: Array.from({ length: 40 }, (_, ref) => `ref_${ref}`),
      })),
      evidence: Array.from({ length: 30 }, (_, index) => ({
        ref: `artifact_${index}`,
        path: `/workspace/${"p".repeat(800)}-${index}`,
        sha256: "a".repeat(64),
        sizeBytes: index,
        provenanceRefs: [],
      })),
    } as never;

    expect(() => buildGoalStatusPresentation(unsafeGoal.status, unsafeGoal)).not.toThrow();
    const presentation = buildGoalStatusPresentation(unsafeGoal.status, unsafeGoal);

    expect(presentation.acceptance?.failedCheckIds.length).toBeLessThanOrEqual(10);
    expect(new Set(presentation.acceptance?.failedCheckIds).size).toBe(
      presentation.acceptance?.failedCheckIds.length,
    );
    expect(presentation.acceptance?.evidenceRefs.length).toBeLessThanOrEqual(20);
    expect(presentation.acceptance?.evidenceRefs.every((ref) => ref.length <= 240)).toBe(true);
    expect(presentation.certificate?.checks).toHaveLength(10);
    expect(presentation.certificate?.artifacts).toHaveLength(10);
    expect(presentation.certificate?.checks[0]?.evidenceRefs).toHaveLength(20);
    expect(presentation.certificate?.artifacts[0]?.path?.length).toBeLessThanOrEqual(500);
  });
});

function repairDirective(
  overrides: Partial<NonNullable<Goal["acceptanceState"]>["lastDecision"]> = {},
): NonNullable<NonNullable<Goal["acceptanceState"]>["lastDecision"]> {
  return {
    action: "repair_same_milestone",
    summary: "check_failed; use alternate strategy",
    failedCheckIds: ["criterion_1_review", "criterion_1_review"],
    fingerprint: "f".repeat(64),
    occurrence: 1,
    instructions: ["never expose this raw instruction secret"],
    ...overrides,
  };
}

function failureRecord(
  overrides: Partial<NonNullable<Goal["acceptanceState"]>["recentFailures"][number]> = {},
): NonNullable<Goal["acceptanceState"]>["recentFailures"][number] {
  return {
    at: "2026-07-11T04:59:00.000Z",
    targetKind: "goal",
    targetId: "goal_1",
    fingerprint: "f".repeat(64),
    occurrence: 1,
    verdict: "acceptance_unavailable",
    failureClass: "judge_unavailable",
    failedCheckIds: ["criterion_1_review"],
    evidenceRefs: ["artifact:report.md"],
    actionSignatures: ["secret-action-signature"],
    ...overrides,
  };
}

function certificate(): NonNullable<Goal["acceptanceCertificate"]> {
  return {
    version: 1,
    goalId: "goal_1",
    acceptedAt: "2026-07-11T05:00:00.000Z",
    protocolVersion: 2,
    criteriaHash: "c".repeat(64),
    planVersion: 2,
    runIds: ["run-secret"],
    checkResults: [
      {
        checkId: "safe_check",
        kind: "test_passes",
        passed: true,
        code: "tests_passed",
        evidenceRefs: ["artifact:report.md"],
        detail: "raw provider failure with sk-secret",
      },
    ],
    evidence: [
      {
        ref: "artifact:report.md",
        path: "/workspace/report.md",
        sha256: `abcdefabcdef${"0".repeat(52)}`,
        sizeBytes: 512,
        provenanceRefs: ["full artifact body secret"],
      },
    ],
    judge: {
      providerId: "provider-secret",
      model: "safe-model",
      promptVersion: "goal-acceptance-v2",
      evaluatedMessageIds: ["message-secret"],
    },
    certificateHash: `1234567890ab${"0".repeat(52)}`,
  };
}

function createGoal(overrides: Partial<Goal> = {}): Goal {
  const criterion: SuccessCriterion = {
    id: "criterion_1",
    description: "调研 serenity",
    acceptanceChecks: [
      {
        id: "criterion_1_review",
        kind: "model_review",
        description: "需要基于证据验收。",
        params: {},
        requiresEvidence: true,
      },
    ],
  };

  return {
    id: "goal_1",
    description: "帮我深度调研一下 serenity",
    successCriteria: [criterion],
    milestones: [milestone()],
    status: "planning",
    budget: {
      maxIterations: 8,
      maxToolCalls: 64,
      maxWallClockMs: 45 * 60 * 1000,
      maxReplans: 3,
    },
    budgetUsage: {
      iterations: 0,
      toolCalls: 0,
      wallClockMs: 0,
      tokens: 0,
      replans: 0,
    },
    reviewPolicy: "review_each_milestone",
    planVersion: 1,
    createdAt: "2026-06-13T13:30:00.000Z",
    updatedAt: "2026-06-13T13:35:00.000Z",
    ...overrides,
  };
}

function milestone(overrides: Partial<Milestone> = {}): Milestone {
  const criterion: SuccessCriterion = {
    id: "criterion_1",
    description: "调研 serenity",
    acceptanceChecks: [
      {
        id: "criterion_1_review",
        kind: "model_review",
        description: "需要基于证据验收。",
        params: {},
        requiresEvidence: true,
      },
    ],
  };

  return {
    id: "milestone_1",
    description: "调研 serenity",
    dependsOn: [],
    successCriteria: [criterion],
    state: "ready",
    runIds: [],
    attempts: 0,
    ...overrides,
  };
}

function toSummary(goal: Goal): ChatSessionGoalSummary {
  return {
    id: goal.id,
    description: goal.description,
    status: goal.status,
  };
}
