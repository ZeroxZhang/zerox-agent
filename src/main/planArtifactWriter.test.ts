import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlanArtifact, PlanRecord } from "../shared/planMode";
import { createPlanArtifactWriter } from "./planArtifactWriter";

describe("plan artifact writer", () => {
  let tempDir: string;
  let workspaceRoot: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "zerox-plan-writer-"));
    workspaceRoot = path.join(tempDir, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes only the canonical .zerox/plans projection and verifies its hash", async () => {
    const writer = createPlanArtifactWriter({
      now: () => "2026-07-30T00:00:00.000Z",
    });
    const plan = createPlan(workspaceRoot);
    const artifact = createArtifact();
    const projection = await writer.write(plan, artifact);
    const projectedPlan = { ...plan, projection, finalArtifact: artifact };
    expect(projection.path).toBe(
      path.join(
        await realpath(workspaceRoot),
        ".zerox",
        "plans",
        `${plan.id}.md`,
      ),
    );
    await expect(writer.verify(projectedPlan)).resolves.toBe(true);
    await expect(
      writer.verify({
        ...projectedPlan,
        revision: 3,
        confirmedRevision: 1,
        status: "executing",
      }),
    ).resolves.toBe(true);

    await expect(
      writer.verify({
        ...projectedPlan,
        finalArtifact: { ...artifact, objective: "tampered objective" },
      }),
    ).resolves.toBe(false);

    await writeFile(projection.path, "# tampered\n");
    await expect(writer.verify(projectedPlan)).resolves.toBe(false);
  });

  it("rejects a FIFO projection without waiting for a writer", async () => {
    const writer = createPlanArtifactWriter();
    const plan = createPlan(workspaceRoot);
    const artifact = createArtifact();
    const projection = await writer.write(plan, artifact);
    await rm(projection.path);
    execFileSync("/usr/bin/mkfifo", [projection.path]);

    const result = await Promise.race([
      writer.verify({ ...plan, projection, finalArtifact: artifact }),
      new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), 1_000);
      }),
    ]);

    expect(result).toBe(false);
  });

  it("rejects a symlinked plans directory before writing", async () => {
    const outside = path.join(tempDir, "outside");
    await mkdir(path.join(workspaceRoot, ".zerox"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(workspaceRoot, ".zerox", "plans"));

    await expect(
      createPlanArtifactWriter().write(
        createPlan(workspaceRoot),
        createArtifact(),
      ),
    ).rejects.toThrow(/authorized child|symbolic|符号链接/i);
  });

  it("keeps a replaced plans directory outside the capability write boundary", async () => {
    const outside = path.join(tempDir, "outside-race");
    const plans = path.join(workspaceRoot, ".zerox", "plans");
    const displaced = path.join(workspaceRoot, ".zerox", "plans-displaced");
    await mkdir(outside, { recursive: true });
    let signalReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      signalReady = resolve;
    });
    const writer = createPlanArtifactWriter({
      safeFsTestDelayMs: 500,
      safeFsTestReadyStage: "projection-before-publish",
      safeFsTestOnReady: signalReady,
    });
    const outcome = writer.write(createPlan(workspaceRoot), createArtifact()).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await ready;
    await rename(plans, displaced);
    await symlink(outside, plans);

    const result = await outcome;
    expect(result.ok).toBe(false);
    expect(String(result.ok ? "" : result.error)).toMatch(
      /capability moved|identity changed/i,
    );
    await expect(access(path.join(outside, "plan-writer-test.md")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not replace a projection whose recorded authority has drifted", async () => {
    const writer = createPlanArtifactWriter();
    const plan = createPlan(workspaceRoot);
    const artifact = createArtifact();
    const projection = await writer.write(plan, artifact);
    const userModified = "# user modified projection\n";
    await writeFile(projection.path, userModified, "utf8");

    await expect(
      writer.write({ ...plan, projection }, artifact),
    ).rejects.toThrow(/content authority changed|digest changed/i);
    await expect(readFile(projection.path, "utf8")).resolves.toBe(userModified);
  });

  it("atomically replaces the exact previously authorized projection", async () => {
    const writer = createPlanArtifactWriter();
    const plan = createPlan(workspaceRoot);
    const artifact = createArtifact();
    const first = await writer.write(plan, artifact);
    const revisedArtifact = { ...artifact, summary: "revised summary" };

    const second = await writer.write(
      { ...plan, projection: first },
      revisedArtifact,
    );

    expect(second.sha256).not.toBe(first.sha256);
    await expect(
      writer.verify({
        ...plan,
        projection: second,
        finalArtifact: revisedArtifact,
      }),
    ).resolves.toBe(true);
    await expect(readFile(second.path, "utf8")).resolves.toContain(
      "revised summary",
    );
  });

  it("sanitizes diagnostic DTO fields before writing a workspace projection", async () => {
    const secret = "local-canary-plan-projection-0123456789abcdef";
    const writer = createPlanArtifactWriter();
    const plan: PlanRecord = {
      ...createPlan(workspaceRoot),
      planningStages: [
        {
          id: "review",
          kind: "review",
          runId: "review-run",
          status: "completed",
          evidenceRefs: [],
          reviewApproved: false,
          reviewIssues: [
            {
              code: `review-${secret}`,
              severity: "high",
              message: `review message ${secret}`,
              repairable: false,
              repairInstruction: `repair ${secret}`,
            },
          ],
        },
      ],
      qualityReport: {
        status: "blocked",
        blockingIssues: [
          {
            code: "MISSING_EVIDENCE",
            severity: "blocking",
            message: `missing ${secret}`,
            milestoneId: `milestone-${secret}`,
            checkId: `check-${secret}`,
            evidenceRefs: [`evidence-${secret}`],
          },
        ],
        warnings: [],
        evidenceCoverage: {
          referenced: 0,
          total: 1,
          missingRefs: [`missing-${secret}`],
        },
        acceptanceCoverage: {
          deterministicChecks: 0,
          modelReviewChecks: 0,
          totalChecks: 0,
          milestonesCovered: 0,
          milestonesTotal: 0,
        },
        generatedAt: "2026-09-01T00:00:00.000Z",
      },
      goalContractIssues: [
        {
          id: `issue-${secret}`,
          severity: "blocking",
          description: `diagnostic ${secret}`,
          evidenceRefs: [`evidence-${secret}`],
        },
      ],
    };
    const artifact: PlanArtifact = {
      ...createArtifact(),
      minorityOpinion: [`review ${secret}`],
      actionGate: "blocked",
      gateReason: `quality ${secret}`,
      markdown: `# raw ${secret}`,
      goalContractIssues: [
        {
          id: `artifact-issue-${secret}`,
          severity: "warning",
          description: `artifact diagnostic ${secret}`,
          evidenceRefs: [`artifact-evidence-${secret}`],
        },
      ],
    };

    const projection = await writer.write(plan, artifact);
    const markdown = await readFile(projection.path, "utf8");
    expect(markdown).not.toContain(secret);
    expect(markdown).toContain("原始诊断内容未保存");
  });
});

function createPlan(workspaceRoot: string): PlanRecord {
  return {
    id: "plan-writer-test",
    sessionId: "session",
    workspaceRoot,
    sourceMessage: "write plan",
    mode: "direct",
    status: "drafting",
    actionGate: "blocked",
    revision: 1,
    taskContract: {
      objective: "write plan",
      audience: "user",
      inScope: [],
      outOfScope: [],
      constraints: [],
      successCriteria: [],
      assumptions: [],
    },
    evidence: [],
    requestedModelAssignments: {},
    frozenModelAssignments: {},
    rounds: [],
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  };
}

function createArtifact(): PlanArtifact {
  return {
    title: "Writer Test",
    summary: "summary",
    objective: "objective",
    scope: { in: [], out: [] },
    assumptions: [],
    milestones: [
      {
        id: "m1",
        title: "Milestone",
        description: "Do it",
        acceptanceCriteria: ["Done"],
        dependencies: [],
      },
    ],
    dependencies: [],
    risks: [],
    acceptanceCriteria: ["Done"],
    claimLedger: [],
    unresolvedQuestions: [],
    minorityOpinion: [],
    actionGate: "ready",
    gateReason: "Ready",
    markdown: "",
  };
}
