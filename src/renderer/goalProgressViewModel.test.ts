import { describe, expect, it } from "vitest";
import type { Goal, Milestone, SuccessCriterion } from "../shared/agentGoal";
import type { ChatSessionGoalSummary } from "../shared/chat";
import {
  createGoalAcceptanceCertificate,
  verifyGoalAcceptanceCertificate,
} from "../main/agentGoalAcceptanceCertificate";
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

  it("projects a bounded, action-free retrying final acceptance state", () => {
    const goal = createGoal({
      status: "executing",
      acceptanceProtocolVersion: 2,
      acceptanceState: {
        protocolVersion: 2,
        phase: "retrying",
        attempt: 2,
        recentFailures: [failureRecord()],
      },
      acceptanceRetryState: {
        cycle: 1,
        attempt: 2,
        maxAttempts: 3,
        lastCode: "judge_timeout",
        lastDetail: "unsafe raw provider detail sk-secret",
        nextRetryAt: "2026-07-12T04:05:06.000Z",
        evidenceFingerprint: "a".repeat(64),
        resumeFrom: "final_judge",
      },
    });

    const presentation = buildGoalStatusPresentation(goal.status, goal);

    expect(presentation.statusLabel).toBe("正在重试最终验收（2/3）");
    expect(presentation.statusDetail).toContain("最终裁判");
    expect(presentation.statusDetail).toContain(
      "任务产物与已完成里程碑不会重新执行",
    );
    expect(presentation.statusDetail).not.toContain("sk-secret");
    expect(presentation.nextActionDetail).toContain("下次重试");
    expect(presentation.recoveryActions).toEqual([]);
    expect(presentation.acceptance?.retry).toEqual({
      cycle: 1,
      attempt: 2,
      maxAttempts: 3,
      lastCode: "judge_timeout",
      nextRetryAt: "2026-07-12T04:05:06.000Z",
    });
  });

  it.each([
    ["judge_timeout", "最终裁判超时"],
    ["rate_limited", "请求过于频繁"],
    ["provider_unavailable", "验收服务暂时不可用"],
    ["network_reset", "网络连接意外中断"],
  ] as const)(
    "projects exhausted %s retries as acceptance waiting",
    (lastCode, detailFragment) => {
      const goal = waitingForAcceptanceGoal(lastCode);

      const presentation = buildGoalStatusPresentation(goal.status, goal);

      expect(presentation).toMatchObject({
        statusLabel: "任务产物已完成，等待最终验收",
        recoveryActions: [
          "continue_acceptance",
          "mark_completed_unverified",
          "terminate",
        ],
      });
      expect(presentation.statusDetail).toContain(detailFragment);
      expect(presentation.nextActionDetail).toContain(
        "任务产物与已完成里程碑不会重新执行",
      );
      expect(presentation.certificate).toBeUndefined();
      expect(presentation.acceptance?.retry).toMatchObject({
        cycle: 1,
        attempt: 3,
        maxAttempts: 3,
        lastCode,
      });
    },
  );

  it("uses a neutral bounded waiting explanation for unknown failure codes", () => {
    const goal = waitingForAcceptanceGoal(
      `unknown_${"x".repeat(500)}`,
      "provider secret must not reach the renderer",
    );

    const presentation = buildGoalStatusPresentation(goal.status, goal);

    expect(presentation.statusDetail).toBe(
      "最终验收暂时未能完成。任务产物和当前进度已保留，请选择继续验收或手动处理。",
    );
    expect(presentation.statusDetail).not.toContain("provider secret");
  });

  it("does not treat inherited object keys as known acceptance codes", () => {
    const presentation = buildGoalStatusPresentation(
      "waiting_for_acceptance",
      waitingForAcceptanceGoal("toString"),
    );

    expect(presentation.statusDetail).toBe(
      "最终验收暂时未能完成。任务产物和当前进度已保留，请选择继续验收或手动处理。",
    );
  });

  it("never presents manual completion as certified success", () => {
    const certified = certifiedGoal();
    const goal = createGoal({
      status: "completed_unverified",
      stopReason: "user_marked_complete",
      acceptanceProtocolVersion: 2,
      acceptanceState: {
        protocolVersion: 2,
        phase: "awaiting_user",
        attempt: 3,
        recentFailures: [failureRecord()],
      },
      acceptanceCertificate: certified.acceptanceCertificate,
      manualCompletionAttestation: {
        version: 1,
        goalId: "goal_1",
        completedAt: "2026-07-12T04:06:00.000Z",
        reason: "user_marked_complete",
        failedCheckIds: ["criterion_1_review"],
        evidenceRefs: ["artifact:report.md"],
        evidenceFingerprint: "a".repeat(64),
        lastFailureCode: "judge_timeout",
        retryCycles: 1,
      },
    });

    const presentation = buildGoalStatusPresentation(goal.status, goal);

    expect(presentation.statusLabel).toBe("手动完成 · 未经机器认证");
    expect(presentation.statusDetail).toContain("未生成机器验收证书");
    expect(presentation.certificate).toBeUndefined();
    expect(presentation.recoveryActions).toEqual([]);
    expect(presentation.acceptance?.manualCompletion).toEqual({
      completedAt: "2026-07-12T04:06:00.000Z",
      lastFailureCode: "judge_timeout",
      retryCycles: 1,
      failedCheckIds: ["criterion_1_review"],
      evidenceRefs: ["artifact:report.md"],
    });
  });

  it("bounds and redacts manual completion metadata", () => {
    const goal = createGoal({
      status: "completed_unverified",
      stopReason: "user_marked_complete",
      acceptanceProtocolVersion: 2,
      acceptanceState: {
        protocolVersion: 2,
        phase: "awaiting_user",
        attempt: 3,
        recentFailures: [],
      },
      manualCompletionAttestation: {
        version: 1,
        goalId: "goal_1",
        completedAt: "2026-07-12T04:06:00.000Z",
        reason: "user_marked_complete",
        failedCheckIds: Array.from(
          { length: 30 },
          (_, index) => `check_${index}?token=sk-proj-secret-${index}`,
        ),
        evidenceRefs: Array.from(
          { length: 40 },
          (_, index) => `artifact:${index}?password=hunter-${index}`,
        ),
        evidenceFingerprint: "a".repeat(64),
        lastFailureCode: "provider_secret_sk-proj-123456789",
        retryCycles: 999,
      },
    });

    const metadata = buildGoalStatusPresentation(goal.status, goal).acceptance
      ?.manualCompletion;
    const serialized = JSON.stringify(metadata);

    expect(metadata?.lastFailureCode).toBe("unknown");
    expect(metadata?.retryCycles).toBe(999);
    expect(metadata?.failedCheckIds).toHaveLength(10);
    expect(metadata?.evidenceRefs).toHaveLength(20);
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).not.toContain("sk-proj-secret");
    expect(serialized).not.toContain("hunter-");
  });

  it("does not claim an inspectable manual record when attestation is invalid", () => {
    const goal = createGoal({
      status: "completed_unverified",
      stopReason: "user_marked_complete",
      acceptanceProtocolVersion: 2,
      acceptanceState: {
        protocolVersion: 2,
        phase: "awaiting_user",
        attempt: 3,
        recentFailures: [],
      },
      manualCompletionAttestation: undefined,
    });

    const presentation = buildGoalStatusPresentation(goal.status, goal);

    expect(presentation.acceptance?.manualCompletion).toBeUndefined();
    expect(presentation.nextActionLabel).toBe("手动完成记录不可用");
    expect(presentation.nextActionDetail).toContain("不会补造");
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

  it("keeps canonical blocked detail authoritative over a stale session summary", () => {
    const canonicalDetail = createGoal({
      status: "stopped_blocked",
      stopReason: "acceptance_unavailable",
    });
    const staleSummary: ChatSessionGoalSummary = {
      id: canonicalDetail.id,
      description: canonicalDetail.description,
      status: "executing",
    };

    const viewModel = buildGoalProgressViewModel(staleSummary, canonicalDetail);

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

  it("fails closed when a protocol-v2 completion certificate loses integrity", () => {
    const goal = createGoal({
      status: "stopped_blocked",
      stopReason: "acceptance_integrity_failed",
      acceptanceProtocolVersion: 2,
      acceptanceState: {
        protocolVersion: 2,
        phase: "blocked",
        attempt: 1,
        recentFailures: [],
      },
    });

    const presentation = buildGoalStatusPresentation(goal.status, goal);

    expect(presentation).toMatchObject({
      statusLabel: "目标受阻",
      statusDetail: expect.stringContaining("证书校验失败"),
      nextActionDetail: expect.stringContaining("不会把它当作已完成"),
      recoveryActions: [],
    });
    expect(presentation.statusLabel).not.toContain("达成");
    expect(presentation.certificate).toBeUndefined();
  });

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
    const goal = certifiedGoal();

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
            id: "criterion_1_review",
            kind: "model_review",
            passed: true,
            code: "accepted",
            evidenceRefs: ["artifact:report.md"],
          },
        ],
        artifacts: [
          {
            path: "…/workspace/report.md",
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

  it.each([
    ["fake certificate hash", (goal: Goal) => {
      goal.acceptanceCertificate!.certificateHash = "fake-hash";
    }],
    ["failed check", (goal: Goal) => {
      goal.acceptanceCertificate!.checkResults[0]!.passed = false;
    }],
    ["unknown check", (goal: Goal) => {
      goal.acceptanceCertificate!.checkResults[0]!.checkId = "unknown_check";
    }],
    ["kind mismatch", (goal: Goal) => {
      goal.acceptanceCertificate!.checkResults[0]!.kind = "test_passes";
    }],
    ["missing check coverage", (goal: Goal) => {
      goal.acceptanceCertificate!.checkResults = [];
    }],
    ["goal identity mismatch", (goal: Goal) => {
      goal.acceptanceCertificate!.goalId = "other_goal";
    }],
    ["plan mismatch", (goal: Goal) => {
      goal.acceptanceCertificate!.planVersion += 1;
    }],
    ["certificate version mismatch", (goal: Goal) => {
      goal.acceptanceCertificate!.version = 2 as 1;
    }],
    ["certificate protocol mismatch", (goal: Goal) => {
      goal.acceptanceCertificate!.protocolVersion = 1 as 2;
    }],
    ["malformed criteria hash", (goal: Goal) => {
      goal.acceptanceCertificate!.criteriaHash = "short";
    }],
    ["malformed evidence hash", (goal: Goal) => {
      goal.acceptanceCertificate!.evidence[0]!.sha256 = "short";
    }],
    ["malformed evidence size", (goal: Goal) => {
      goal.acceptanceCertificate!.evidence[0]!.sizeBytes = -1;
    }],
    ["missing semantic judge", (goal: Goal) => {
      goal.acceptanceCertificate!.judge = undefined;
    }],
    ["uncertified acceptance phase", (goal: Goal) => {
      goal.acceptanceState!.phase = "validating";
    }],
    ["non-achieved goal", (goal: Goal) => {
      goal.status = "executing";
    }],
  ] as const)("rejects certificate projection for %s", (_label, mutate) => {
    const goal = certifiedGoal();
    mutate(goal);

    expect(buildGoalStatusPresentation(goal.status, goal).certificate).toBeUndefined();
  });

  it("redacts secrets from every projected certificate string and shortens home paths", () => {
    const secretValues = [
      "bearer-value-123",
      "sk-proj-1234567890",
      "ghp_1234567890abcdef",
      "hunter2-value",
      "query-secret-value",
      "xoxb-1234567890-secret",
      "json-password-value",
    ];
    const secretCheck = {
      id: `check?token=${secretValues[4]}`,
      kind: `validator:local/report?api_key=${secretValues[1]}` as const,
      description: "secret-bearing check",
      params: {},
      requiresEvidence: true,
    };
    const goal = createGoal({
      successCriteria: [{
        id: "criterion_secret",
        description: "redaction",
        acceptanceChecks: [secretCheck],
      }],
      status: "achieved",
      stopReason: "goal_accepted",
      planVersion: 2,
      acceptanceProtocolVersion: 2,
      acceptanceState: certifiedAcceptanceState(),
    });
    goal.acceptanceCertificate = certificateForGoal(goal, {
      checkResults: [{
        checkId: secretCheck.id,
        kind: secretCheck.kind,
        passed: true,
        code: `Bearer ${secretValues[0]} {"password":"${secretValues[6]}"} password=${secretValues[3]}`,
        evidenceRefs: [`artifact:report.md?secret=${secretValues[4]}`],
        detail: "raw secret detail",
      }],
      evidence: [{
        ref: `artifact:report.md?secret=${secretValues[4]}`,
        path: `/Users/alice/private/api_key=${secretValues[1]}/report.md?password=${secretValues[3]}`,
        sha256: "a".repeat(64),
        sizeBytes: 64,
        provenanceRefs: [],
      }],
      judge: {
        model: `model Bearer ${secretValues[0]} ${secretValues[2]}`,
        promptVersion: `prompt?token=${secretValues[5]}`,
        evaluatedMessageIds: ["message_1"],
      },
    });

    const certificate = buildGoalStatusPresentation(goal.status, goal).certificate;
    const serialized = JSON.stringify(certificate);

    expect(certificate?.artifacts[0]?.path).toMatch(/^…\//);
    expect(serialized).toContain("[REDACTED]");
    for (const secret of secretValues) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain("/Users/alice");
  });

  it("redacts credential vocabulary and URL userinfo from a cryptographically valid certificate", () => {
    const secrets = {
      credential: "credential-value-9e31",
      credentials: "credentials-value-4af2",
      clientSecret: "client-secret-value-7bc3",
      userinfo: "userinfo-password-5dd4",
      pathCredential: "path-credential-value-6ee5",
      pwd: "pwd-value-11f6",
      passphrase: "passphrase-value-22a7",
      secretKey: "secret-key-value-33b8",
      compactSecretKey: "secretkey-value-44c9",
      webhookSecret: "webhook-secret-value-55da",
      awsSecretAccessKey: "aws-secret-access-key-value-66eb",
    };
    const artifactRef =
      `https://leaky-user:${secrets.userinfo}@evidence.local/report` +
      `?credential=${secrets.credential}` +
      `&secret_key=${secrets.secretKey}` +
      `&webhook_secret=${secrets.webhookSecret}`;
    const goal = createGoal({
      status: "executing",
      planVersion: 2,
      acceptanceProtocolVersion: 2,
    });
    const acceptanceCertificate = createGoalAcceptanceCertificate({
      goal,
      acceptedAt: "2026-07-11T05:00:00.000Z",
      runIds: ["run_credential_redaction"],
      checkResults: [{
        checkId: "criterion_1_review",
        kind: "model_review",
        passed: true,
        code:
          `pwd=${secrets.pwd}; passphrase=${secrets.passphrase}; ` +
          "monkey=banana",
        evidenceRefs: [artifactRef],
        detail: "accepted",
      }],
      evidenceManifest: {
        version: 1,
        generatedAt: "2026-07-11T04:59:59.000Z",
        totalRenderedChars: 0,
        truncated: false,
        artifacts: [{
          ref: artifactRef,
          path:
            `/Users/alice/client_secret=${secrets.clientSecret}/` +
            `credential=${secrets.pathCredential}/` +
            `secretkey=${secrets.compactSecretKey}/` +
            `aws_secret_access_key=${secrets.awsSecretAccessKey}/report.md`,
          mediaType: "text/markdown",
          sizeBytes: 128,
          sha256: "a".repeat(64),
          excerpts: [],
        }],
      },
      judge: {
        model:
          `https://model-user:${secrets.userinfo}@model.local/v1 ` +
          `credential=${secrets.credential}`,
        promptVersion: `goal-v2?credentials=${secrets.credentials}`,
        evaluatedMessageIds: ["message_credential_redaction"],
      },
    });
    const certified = {
      ...goal,
      status: "achieved" as const,
      stopReason: "goal_accepted" as const,
      acceptanceState: certifiedAcceptanceState(),
      acceptanceCertificate,
    };

    expect(verifyGoalAcceptanceCertificate(certified)).toEqual({ ok: true });
    const projected = buildGoalStatusPresentation(
      certified.status,
      certified,
    ).certificate;
    const serialized = JSON.stringify(projected);

    expect(projected).toBeDefined();
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("monkey=banana");
    expect(projected?.artifacts[0]?.path).toContain("report.md");
    for (const secret of Object.values(secrets)) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain("leaky-user:");
    expect(serialized).not.toContain("model-user:");
    expect(serialized).not.toContain("/Users/alice");
  });

  it("redacts webhook URLs and AWS session credentials from a valid certificate", () => {
    const slackWebhookUrl =
      "https://hooks.slack.com/services/T01234567/B01234567/SlackWebhookSecret99";
    const awsSessionToken = "aws-session-token-value-77fc";
    const awsSecurityToken = "aws-security-token-value-88ad";
    const artifactRef =
      `https://evidence.local/report?aws_session_token=${awsSessionToken}`;
    const goal = createGoal({
      status: "executing",
      planVersion: 2,
      acceptanceProtocolVersion: 2,
    });
    const acceptanceCertificate = createGoalAcceptanceCertificate({
      goal,
      acceptedAt: "2026-07-11T05:10:00.000Z",
      runIds: ["run_webhook_redaction"],
      checkResults: [{
        checkId: "criterion_1_review",
        kind: "model_review",
        passed: true,
        code:
          `webhook=${slackWebhookUrl}; webhook delivery completed; ` +
          "monkey=banana",
        evidenceRefs: [artifactRef],
        detail: "accepted",
      }],
      evidenceManifest: {
        version: 1,
        generatedAt: "2026-07-11T05:09:59.000Z",
        totalRenderedChars: 0,
        truncated: false,
        artifacts: [{
          ref: artifactRef,
          path:
            `/workspace/aws_security_token=${awsSecurityToken}/report.md`,
          mediaType: "text/markdown",
          sizeBytes: 256,
          sha256: "b".repeat(64),
          excerpts: [],
        }],
      },
      judge: {
        model: `judge ${slackWebhookUrl}`,
        promptVersion: `goal-v2?webhook_url=${slackWebhookUrl}`,
        evaluatedMessageIds: ["message_webhook_redaction"],
      },
    });
    const certified = {
      ...goal,
      status: "achieved" as const,
      stopReason: "goal_accepted" as const,
      acceptanceState: certifiedAcceptanceState(),
      acceptanceCertificate,
    };

    expect(verifyGoalAcceptanceCertificate(certified)).toEqual({ ok: true });
    const projected = buildGoalStatusPresentation(
      certified.status,
      certified,
    ).certificate;
    const serialized = JSON.stringify(projected);

    expect(projected).toBeDefined();
    expect(projected?.checks[0]?.code).toContain("webhook delivery completed");
    expect(projected?.checks[0]?.code).toContain("monkey=banana");
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).not.toContain(slackWebhookUrl);
    expect(serialized).not.toContain("SlackWebhookSecret99");
    expect(serialized).not.toContain(awsSessionToken);
    expect(serialized).not.toContain(awsSecurityToken);
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
    expect(() => buildGoalStatusPresentation(unsafeGoal.status, unsafeGoal)).not.toThrow();
    const presentation = buildGoalStatusPresentation(unsafeGoal.status, unsafeGoal);

    expect(presentation.acceptance?.failedCheckIds.length).toBeLessThanOrEqual(10);
    expect(new Set(presentation.acceptance?.failedCheckIds).size).toBe(
      presentation.acceptance?.failedCheckIds.length,
    );
    expect(presentation.acceptance?.evidenceRefs.length).toBeLessThanOrEqual(20);
    expect(presentation.acceptance?.evidenceRefs.every((ref) => ref.length <= 240)).toBe(true);
  });

  it("bounds structurally valid oversized certificates", () => {
    const checks = Array.from({ length: 30 }, (_, index) => ({
      id: `check_${index}`,
      kind: "assertion" as const,
      description: `check ${index}`,
      params: {},
      requiresEvidence: false,
    }));
    const goal = createGoal({
      successCriteria: [{
        id: "criterion_many",
        description: "many checks",
        acceptanceChecks: checks,
      }],
      status: "achieved",
      stopReason: "goal_accepted",
      planVersion: 2,
      acceptanceProtocolVersion: 2,
      acceptanceState: certifiedAcceptanceState(),
    });
    goal.acceptanceCertificate = certificateForGoal(goal, {
      checkResults: checks.map((check) => ({
        checkId: check.id,
        kind: check.kind,
        passed: true,
        code: "accepted",
        evidenceRefs: [],
        detail: "accepted",
      })),
      evidence: Array.from({ length: 30 }, (_, index) => ({
        ref: `artifact_${index}`,
        path: `/workspace/${"p".repeat(800)}-${index}`,
        sha256: "a".repeat(64),
        sizeBytes: index,
        provenanceRefs: [],
      })),
    });

    const certificate = buildGoalStatusPresentation(goal.status, goal).certificate;

    expect(certificate?.checks).toHaveLength(10);
    expect(certificate?.artifacts).toHaveLength(10);
    expect(certificate?.artifacts[0]?.path?.length).toBeLessThanOrEqual(500);
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

function certifiedAcceptanceState(): NonNullable<Goal["acceptanceState"]> {
  return {
    protocolVersion: 2,
    phase: "certified",
    attempt: 1,
    recentFailures: [],
  };
}

function certifiedGoal(): Goal {
  const goal = createGoal({
    status: "achieved",
    stopReason: "goal_accepted",
    planVersion: 2,
    acceptanceProtocolVersion: 2,
    acceptanceState: certifiedAcceptanceState(),
  });
  goal.acceptanceCertificate = certificateForGoal(goal);
  return goal;
}

function waitingForAcceptanceGoal(
  lastCode: string,
  lastDetail = "raw provider detail",
): Goal {
  return createGoal({
    status: "waiting_for_acceptance",
    stopReason: "acceptance_unavailable",
    acceptanceProtocolVersion: 2,
    acceptanceState: {
      protocolVersion: 2,
      phase: "awaiting_user",
      attempt: 3,
      recentFailures: [failureRecord()],
    },
    acceptanceRetryState: {
      cycle: 1,
      attempt: 3,
      maxAttempts: 3,
      lastCode,
      lastDetail,
      evidenceFingerprint: "a".repeat(64),
      resumeFrom: "final_judge",
    },
  });
}

function certificateForGoal(
  goal: Goal,
  overrides: Partial<NonNullable<Goal["acceptanceCertificate"]>> = {},
): NonNullable<Goal["acceptanceCertificate"]> {
  const checks = goal.successCriteria.flatMap((criterion) =>
    criterion.acceptanceChecks,
  );
  return {
    version: 1,
    goalId: goal.id,
    acceptedAt: "2026-07-11T05:00:00.000Z",
    protocolVersion: 2,
    criteriaHash: "c".repeat(64),
    planVersion: goal.planVersion,
    runIds: ["run-secret"],
    checkResults: checks.map((check) => ({
        checkId: check.id,
        kind: check.kind,
        passed: true,
        code: "accepted",
        evidenceRefs: ["artifact:report.md"],
        detail: "raw provider failure with sk-secret",
      })),
    evidence: [
      {
        ref: "artifact:report.md",
        path: "/Users/alice/workspace/report.md",
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
    ...overrides,
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
