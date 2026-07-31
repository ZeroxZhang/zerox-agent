import { describe, expect, it } from "vitest";
import type {
  PlanArtifact,
  PlanTaskProfile,
  PlanningBrief,
} from "../shared/planMode";
import {
  createPlanQualityReport,
  createPlanTaskProfile,
} from "./plannerKernel";

describe("planner kernel v2 eval matrix", () => {
  it.each([
    ["code", "test_passes"],
    ["files", "file_exists"],
    ["research", "model_review"],
    ["writing", "model_review"],
  ] as const)(
    "produces an executable gate for %s work",
    (domain, checkKind) => {
      const artifact = fixtureArtifact(checkKind);
      const report = createPlanQualityReport({
        artifact,
        profile: profile(domain),
        brief: brief(),
        evidence: evidence(),
        workspaceRoot: "/workspace",
        availableToolNames: ["test_run", "file_read"],
        now: "2026-07-31T00:00:00.000Z",
      });

      expect(report.status).toBe("ready");
      expect(report.evidenceCoverage.missingRefs).toEqual([]);
      expect(report.acceptanceCoverage.milestonesCovered).toBe(1);
    },
  );

  it("routes a material ambiguity to needs_input", () => {
    const artifact = fixtureArtifact("model_review");
    const report = createPlanQualityReport({
      artifact,
      profile: profile("research"),
      brief: brief({
        unresolvedQuestions: ["目标市场是中国还是全球？"],
      }),
      evidence: evidence(),
      workspaceRoot: "/workspace",
      now: "2026-07-31T00:00:00.000Z",
    });

    expect(report.status).toBe("needs_input");
    expect(report.blockingIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNRESOLVED_AMBIGUITY" }),
      ]),
    );
  });

  it("blocks malicious capability requests and fabricated evidence", () => {
    const artifact = fixtureArtifact("test_passes");
    artifact.milestones[0]!.toolNames = ["unknown_write_everywhere"];
    artifact.claimLedger[0]!.evidenceRefs = ["invented_secret_evidence"];
    const report = createPlanQualityReport({
      artifact,
      profile: profile("code"),
      brief: brief(),
      evidence: evidence(),
      workspaceRoot: "/workspace",
      availableToolNames: ["test_run"],
      now: "2026-07-31T00:00:00.000Z",
    });

    expect(report.status).toBe("blocked");
    expect(report.blockingIssues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["UNKNOWN_TOOL", "MISSING_EVIDENCE"]),
    );
  });
});

function profile(
  domain: PlanTaskProfile["domain"],
): PlanTaskProfile {
  return {
    ...createPlanTaskProfile("完成一个可验证任务"),
    domain,
  };
}

function brief(overrides: Partial<PlanningBrief> = {}): PlanningBrief {
  return {
    objective: "完成可验证任务",
    deliverables: ["交付结果"],
    inScope: ["目标范围"],
    outOfScope: ["外部发布"],
    constraints: ["确认前只读"],
    assumptions: [],
    unresolvedQuestions: [],
    targetRefs: ["result"],
    evidenceRefs: ["evidence_user_request"],
    skillCandidates: [],
    ...overrides,
  };
}

function evidence() {
  return [
    {
      id: "evidence_user_request",
      kind: "user" as const,
      title: "用户需求",
      summary: "完成可验证任务",
    },
  ];
}

function fixtureArtifact(
  kind: "test_passes" | "file_exists" | "model_review",
): PlanArtifact {
  const milestoneCheck =
    kind === "test_passes"
      ? {
          id: "m1-test",
          kind,
          description: "测试通过",
          params: { command: "npm test", workspaceRoot: "." },
          requiresEvidence: false,
        }
      : kind === "file_exists"
        ? {
            id: "m1-file",
            kind,
            description: "交付文件存在",
            params: { path: "result.md" },
            requiresEvidence: false,
          }
        : {
            id: "m1-review",
            kind,
            description: "语义结果有证据支持",
            params: { evidenceRefs: ["evidence_user_request"] },
            requiresEvidence: true,
          };
  return {
    title: "Eval plan",
    summary: "可执行计划",
    objective: "完成可验证任务",
    scope: { in: ["目标范围"], out: ["外部发布"] },
    assumptions: [],
    milestones: [
      {
        id: "m1",
        title: "交付",
        description: "完成交付",
        acceptanceCriteria: ["完成"],
        dependencies: [],
        targetRefs: ["result"],
        evidenceRefs: ["evidence_user_request"],
        actions: ["完成并验证"],
        toolNames:
          kind === "test_passes"
            ? ["test_run"]
            : kind === "file_exists"
              ? ["file_read"]
              : [],
        acceptanceChecks: [milestoneCheck],
      },
    ],
    dependencies: [],
    risks: [],
    acceptanceCriteria: ["整体交付有证据"],
    acceptanceChecks: [
      {
        id: "goal-review",
        kind: "model_review",
        description: "整体复核",
        params: { evidenceRefs: ["evidence_user_request"] },
        requiresEvidence: true,
      },
    ],
    claimLedger: [
      {
        id: "claim-1",
        claim: "需求来自用户",
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
    gateReason: "model suggestion",
    markdown: "",
  };
}
