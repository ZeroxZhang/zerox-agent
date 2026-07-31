import { describe, expect, it } from "vitest";
import type { GoalSelectedSkill } from "../shared/agentGoal";
import type {
  PlanArtifact,
  PlanEvidenceItem,
  PlanningBrief,
} from "../shared/planMode";
import {
  applyPlanArtifactAutonomy,
  applyPlanningBriefAutonomy,
  applyPlanQualityGate,
  createPlanQualityReport,
  createPlanTaskProfile,
  routePlannerSkill,
  shouldEscalatePlanInvestigation,
} from "./plannerKernel";

describe("planner kernel v2", () => {
  it("turns preference questions into audited assumptions in automatic Goal mode", () => {
    const autonomousBrief = applyPlanningBriefAutonomy(
      brief({
        unresolvedQuestions: [
          "文稿以什么格式保存、目录和命名规则是什么？",
          "采用下载视频加 ASR，还是抓取页面字幕？",
          "复用现有项目还是新建目录？",
          "需要支持批量链接还是只处理单条？",
        ],
      }),
      "auto",
    );
    const autonomousArtifact = applyPlanArtifactAutonomy(
      {
        ...planArtifact(),
        unresolvedQuestions: ["输出目录如何命名？"],
        actionGate: "needs_input",
      },
      "auto",
    );

    expect(autonomousBrief.unresolvedQuestions).toEqual([]);
    expect(autonomousBrief.assumptions).toHaveLength(4);
    expect(autonomousBrief.assumptions[0]).toContain("自动模式决策");
    expect(autonomousArtifact.unresolvedQuestions).toEqual([]);
    expect(autonomousArtifact.assumptions).toEqual([
      expect.stringContaining("自动模式决策"),
    ]);
  });

  it("keeps questions that require user authority blocking in automatic Goal mode", () => {
    const result = applyPlanningBriefAutonomy(
      brief({
        unresolvedQuestions: [
          "请输入 API Key。",
          "要公开发布到哪个账号？",
          "输出目录如何命名？",
        ],
      }),
      "auto",
    );

    expect(result.unresolvedQuestions).toEqual([
      "请输入 API Key。",
      "要公开发布到哪个账号？",
    ]);
    expect(result.assumptions).toEqual([
      expect.stringContaining("输出目录如何命名"),
    ]);
  });

  it("adapts investigation depth from task risk, scale, and ambiguity", () => {
    expect(createPlanTaskProfile("解释这段只读文档").investigationDepth).toBe(
      "quick",
    );
    expect(
      createPlanTaskProfile("跨模块重构认证、权限和存储，并完成迁移和测试")
    ).toMatchObject({
      expectedScale: "large",
      investigationDepth: "deep",
    });
    expect(
      createPlanTaskProfile("删除 /tmp/a、/tmp/b 下所有数据")
        .investigationDepth,
    ).toBe("deep");
    expect(createPlanTaskProfile("研究这个领域的竞品")).toMatchObject({
      domain: "research",
      investigationDepth: "deep",
    });
  });

  it("escalates shallow investigation when the model cites no attempt evidence", () => {
    expect(
      shouldEscalatePlanInvestigation({
        depth: "quick",
        brief: brief(),
        evidence: [
          {
            id: "evidence_user_request",
            kind: "user",
            title: "用户需求",
            summary: "完成任务",
          },
        ],
        attemptEvidenceIds: [],
      }),
    ).toBe(true);
    expect(
      shouldEscalatePlanInvestigation({
        depth: "deep",
        brief: brief(),
        evidence: [],
        attemptEvidenceIds: [],
      }),
    ).toBe(false);
  });

  it("keeps an explicit Skill authoritative and validates required inputs", () => {
    const explicit = skill("explicit-skill", true);
    const routed = routePlannerSkill({
      brief: brief({
        recommendedSkillName: "other-skill",
        skillCandidates: [
          {
            name: "other-skill",
            reason: "模型推荐",
            evidenceRefs: ["evidence_user_request"],
          },
        ],
      }),
      skills: [explicit, skill("other-skill")],
      explicitSkill: explicit,
      workspaceRoot: "/workspace",
    });

    expect(routed.decision).toMatchObject({
      source: "explicit",
      selectedSkillName: "explicit-skill",
      missingInputFields: ["target"],
    });
    expect(routed.selectedSkill?.manifest.name).toBe("explicit-skill");
  });

  it("does not guess when multiple real Skills would change the result", () => {
    const routed = routePlannerSkill({
      brief: brief({
        skillCandidates: [
          { name: "skill-a", reason: "A", evidenceRefs: [] },
          { name: "skill-b", reason: "B", evidenceRefs: [] },
        ],
      }),
      skills: [skill("skill-a"), skill("skill-b")],
    });

    expect(routed.decision.source).toBe("none");
    expect(routed.decision.selectedSkillName).toBeUndefined();
    expect(routed.decision.alternatives).toHaveLength(2);
  });

  it("routes Skill-authoring work to skill-creator instead of a related domain Skill", () => {
    const routed = routePlannerSkill({
      brief: brief({
        objective: "创建一个抖音链接转文稿 Skill",
        deliverables: ["一个可调用的新 Skill"],
        recommendedSkillName: "huashu-douyin-script",
        recommendedSkillReason: "它能下载抖音视频",
        skillCandidates: [
          {
            name: "huashu-douyin-script",
            reason: "可作为实现参考",
            evidenceRefs: ["evidence_user_request"],
          },
        ],
      }),
      skills: [skill("huashu-douyin-script"), skill("skill-creator")],
    });

    expect(routed.decision).toMatchObject({
      source: "automatic",
      selectedSkillName: "skill-creator",
    });
    expect(routed.decision.alternatives.map((item) => item.name)).toEqual([
      "skill-creator",
    ]);
  });

  it("uses the ordinary Agent for Skill-authoring work when skill-creator is unavailable", () => {
    const routed = routePlannerSkill({
      brief: brief({
        objective: "创建一个抖音链接转文稿 Skill",
        deliverables: ["一个可调用的新 Skill"],
        recommendedSkillName: "huashu-douyin-script",
        skillCandidates: [
          {
            name: "huashu-douyin-script",
            reason: "可作为实现参考",
            evidenceRefs: ["evidence_user_request"],
          },
        ],
      }),
      skills: [skill("huashu-douyin-script")],
    });

    expect(routed.decision.source).toBe("none");
    expect(routed.decision.selectedSkillName).toBeUndefined();
    expect(routed.decision.alternatives).toEqual([]);
    expect(routed.decision.reason).toContain("交由普通执行 Agent 创建");
  });

  it("accepts auto-routed non-default Skill inputs only with evidence", () => {
    const selected = skill("auto-skill", true);
    const routed = routePlannerSkill({
      brief: brief({
        recommendedSkillName: "auto-skill",
        recommendedSkillInputValues: { target: "src/" },
        recommendedSkillInputEvidenceRefs: {
          target: ["evidence_user_request"],
        },
        skillCandidates: [
          {
            name: "auto-skill",
            reason: "唯一匹配",
            evidenceRefs: ["evidence_user_request"],
          },
        ],
      }),
      skills: [selected],
      workspaceRoot: "/workspace",
    });

    expect(routed.decision).toMatchObject({
      source: "automatic",
      selectedSkillName: "auto-skill",
      inputValues: { target: "src/" },
      inputEvidenceRefs: { target: ["evidence_user_request"] },
      invalidInputFields: [],
    });
  });

  it("never persists credential-shaped Skill inputs in a Plan", () => {
    const selected = skill("credential-skill");
    selected.manifest.inputs = [
      {
        name: "api_key",
        label: "API key",
        type: "string",
        required: true,
      },
    ];
    const routed = routePlannerSkill({
      brief: brief({
        recommendedSkillName: "credential-skill",
        recommendedSkillInputValues: { api_key: "sk-should-not-persist" },
        recommendedSkillInputEvidenceRefs: {
          api_key: ["evidence_user_request"],
        },
        skillCandidates: [
          {
            name: "credential-skill",
            reason: "唯一匹配",
            evidenceRefs: ["evidence_user_request"],
          },
        ],
      }),
      skills: [selected],
      workspaceRoot: "/workspace",
    });

    expect(routed.decision.inputValues).toEqual({});
    expect(routed.decision.invalidInputFields).toContain("api_key");
    expect(JSON.stringify(routed.decision)).not.toContain(
      "sk-should-not-persist",
    );
  });

  it("lets the code gate override a model ready suggestion", () => {
    const profile = createPlanTaskProfile("修复登录代码并运行测试");
    const evidence: PlanEvidenceItem[] = [
      {
        id: "evidence_user_request",
        kind: "user",
        title: "用户需求",
        summary: "修复登录代码并运行测试",
      },
    ];
    const artifact = planArtifact();
    artifact.actionGate = "ready";
    artifact.milestones[0]!.acceptanceChecks = [
      {
        id: "m1-review-only",
        kind: "model_review",
        description: "仅做语义复核",
        params: { evidenceRefs: ["evidence_user_request"] },
        requiresEvidence: true,
      },
    ];

    const report = createPlanQualityReport({
      artifact,
      profile,
      brief: brief(),
      evidence,
      workspaceRoot: "/workspace",
      now: "2026-07-31T00:00:00.000Z",
    });
    const gated = applyPlanQualityGate(artifact, report);

    expect(report.status).toBe("blocked");
    expect(report.blockingIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INSUFFICIENT_DETERMINISTIC_ACCEPTANCE",
        }),
      ]),
    );
    expect(gated.actionGate).toBe("blocked");
  });

  it("reports deterministic and evidence coverage for a runnable plan", () => {
    const artifact = planArtifact();
    const report = createPlanQualityReport({
      artifact,
      profile: createPlanTaskProfile("修复登录代码并运行测试"),
      brief: brief(),
      evidence: [
        {
          id: "evidence_user_request",
          kind: "user",
          title: "用户需求",
          summary: "修复登录代码并运行测试",
        },
      ],
      workspaceRoot: "/workspace",
      now: "2026-07-31T00:00:00.000Z",
    });

    expect(report.status).toBe("ready");
    expect(report.acceptanceCoverage).toMatchObject({
      deterministicChecks: 1,
      modelReviewChecks: 1,
      milestonesCovered: 1,
      milestonesTotal: 1,
    });
    expect(report.evidenceCoverage.missingRefs).toEqual([]);
  });

  it("keeps explicit external Skill artifacts confirmable while surfacing the runtime boundary", () => {
    const artifact = planArtifact();
    artifact.milestones[0]!.acceptanceChecks = [
      {
        id: "skill-file",
        kind: "file_exists",
        description: "共享 Skill 入口存在",
        params: {
          path: "/Users/test/.claude/skills/douyin-to-transcript/SKILL.md",
        },
        requiresEvidence: false,
      },
    ];

    const report = createPlanQualityReport({
      artifact,
      profile: createPlanTaskProfile("创建一个可供本地 Agent 调用的新 Skill"),
      brief: brief(),
      evidence: [
        {
          id: "evidence_user_request",
          kind: "user",
          title: "用户需求",
          summary: "创建一个可供本地 Agent 调用的新 Skill",
        },
      ],
      workspaceRoot: "/workspace",
      now: "2026-07-31T00:00:00.000Z",
    });

    expect(report.status).toBe("ready");
    expect(report.blockingIssues).toEqual([]);
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_ACCEPTANCE_CHECK",
          severity: "warning",
          checkId: "skill-file",
          message: expect.stringContaining("运行时授权与沙箱校验"),
        }),
      ]),
    );
  });

  it("blocks unresolved high-severity cold-review findings", () => {
    const report = createPlanQualityReport({
      artifact: planArtifact(),
      profile: createPlanTaskProfile("修复登录代码并运行测试"),
      brief: brief(),
      evidence: [
        {
          id: "evidence_user_request",
          kind: "user",
          title: "用户需求",
          summary: "修复登录代码并运行测试",
        },
      ],
      workspaceRoot: "/workspace",
      reviewIssues: [
        {
          code: "UNSUPPORTED_SCOPE",
          severity: "high",
          message: "候选计划包含没有证据支撑的范围。",
          repairable: false,
          repairInstruction: "",
        },
      ],
      now: "2026-07-31T00:00:00.000Z",
    });

    expect(report.status).toBe("blocked");
    expect(report.blockingIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MODEL_REVIEW_REJECTED" }),
      ]),
    );
  });

  it("rejects duplicate acceptance-check ids", () => {
    const artifact = planArtifact();
    artifact.acceptanceChecks![0]!.id =
      artifact.milestones[0]!.acceptanceChecks![0]!.id;
    const report = createPlanQualityReport({
      artifact,
      profile: createPlanTaskProfile("修复登录代码并运行测试"),
      brief: brief(),
      evidence: [
        {
          id: "evidence_user_request",
          kind: "user",
          title: "用户需求",
          summary: "修复登录代码并运行测试",
        },
      ],
      workspaceRoot: "/workspace",
      now: "2026-07-31T00:00:00.000Z",
    });
    expect(report.status).toBe("blocked");
    expect(report.blockingIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_ACCEPTANCE_CHECK",
          message: "验收检查 id 重复：m1-test。",
        }),
      ]),
    );
  });
});

function skill(name: string, requiredInput = false): GoalSelectedSkill {
  return {
    rootDir: `/skills/${name}`,
    skillFile: `/skills/${name}/SKILL.md`,
    body: `# ${name}`,
    manifest: {
      name,
      displayName: name,
      description: `${name} description`,
      version: "1.0.0",
      execution: { mode: "agent", entrypoint: null },
      inputs: requiredInput
        ? [
            {
              name: "target",
              label: "Target",
              type: "string",
              required: true,
            },
          ]
        : [],
      permissions: {
        files: { read: [], write: [] },
        shell: { commands: [] },
        web: { search: false, fetchDomains: [] },
        memory: { read: false, write: false },
      },
    },
  };
}

function brief(overrides: Partial<PlanningBrief> = {}): PlanningBrief {
  return {
    objective: "完成任务",
    deliverables: ["可验证交付"],
    inScope: ["工作区实现"],
    outOfScope: ["外部发布"],
    constraints: ["确认前只读"],
    assumptions: [],
    unresolvedQuestions: [],
    targetRefs: ["src/"],
    evidenceRefs: ["evidence_user_request"],
    skillCandidates: [],
    ...overrides,
  };
}

function planArtifact(): PlanArtifact {
  return {
    title: "登录修复计划",
    summary: "修复并验证",
    objective: "修复登录代码",
    scope: { in: ["代码"], out: ["发布"] },
    assumptions: [],
    milestones: [
      {
        id: "m1",
        title: "修复",
        description: "修改登录逻辑",
        acceptanceCriteria: ["测试通过"],
        dependencies: [],
        targetRefs: ["src/"],
        evidenceRefs: ["evidence_user_request"],
        actions: ["修复代码", "运行测试"],
        toolNames: ["test_run"],
        acceptanceChecks: [
          {
            id: "m1-test",
            kind: "test_passes",
            description: "运行项目测试",
            params: { command: "npm test", workspaceRoot: "." },
            requiresEvidence: false,
          },
        ],
      },
    ],
    dependencies: [],
    risks: [],
    acceptanceCriteria: ["整体交付可复核"],
    acceptanceChecks: [
      {
        id: "goal-review",
        kind: "model_review",
        description: "复核整体交付",
        params: {
          condition: "整体交付可复核",
          evidenceRefs: ["evidence_user_request"],
        },
        requiresEvidence: true,
      },
    ],
    claimLedger: [
      {
        id: "claim-1",
        claim: "任务来自用户",
        evidenceRefs: ["evidence_user_request"],
        counterexamples: [],
        conditions: [],
        confidence: 1,
        status: "verified",
      },
    ],
    unresolvedQuestions: [],
    minorityOpinion: [],
    actionGate: "ready",
    gateReason: "模型建议 ready",
    markdown: "",
  };
}
