import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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

  it("rewrites safe partial transaction bytes left by a pre-publication crash", async () => {
    const writer = createPlanArtifactWriter();
    const firstPlan = createPlan(workspaceRoot);
    const plansDir = path.join(workspaceRoot, ".zerox", "plans");
    await mkdir(plansDir, { recursive: true });
    const firstTransaction = path.join(
      plansDir,
      `.${firstPlan.id}.projection.transaction`,
    );
    await writeFile(firstTransaction, "PARTIAL-FIRST-PUBLICATION", {
      mode: 0o600,
    });

    const first = await writer.write(firstPlan, createArtifact());
    await expect(readFile(first.path, "utf8")).resolves.toContain(
      "# Writer Test",
    );

    const revised = { ...createArtifact(), summary: "recovered replacement" };
    const replacementTransaction = path.join(
      path.dirname(first.path),
      `.${firstPlan.id}.projection.transaction`,
    );
    await writeFile(replacementTransaction, "PARTIAL-REPLACEMENT", {
      mode: 0o600,
    });
    const second = await writer.write(
      { ...firstPlan, projection: first },
      revised,
    );

    await expect(readFile(second.path, "utf8")).resolves.toContain(
      "recovered replacement",
    );
    await expect(readFile(replacementTransaction, "utf8")).resolves.toBe("");
  });

  it("recovers idempotently when the canonical projection already has the next digest", async () => {
    const writer = createPlanArtifactWriter();
    const plan = createPlan(workspaceRoot);
    const first = await writer.write(plan, createArtifact());
    const revisedArtifact = { ...createArtifact(), summary: "idempotent next" };
    const second = await writer.write(
      { ...plan, projection: first },
      revisedArtifact,
    );

    const recovered = await writer.write(
      { ...plan, projection: first },
      revisedArtifact,
    );

    expect(recovered).toMatchObject({
      path: second.path,
      sha256: second.sha256,
    });
    await expect(readFile(second.path, "utf8")).resolves.toContain(
      "idempotent next",
    );
  });

  it("durably publishes the swap before scrubbing the retired descriptor", async () => {
    const baseWriter = createPlanArtifactWriter();
    const plan = createPlan(workspaceRoot);
    const first = await baseWriter.write(plan, createArtifact());
    let signalReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      signalReady = resolve;
    });
    const writer = createPlanArtifactWriter({
      safeFsTestDelayMs: 500,
      safeFsTestReadyStage: "projection-swap-durable",
      safeFsTestOnReady: signalReady,
    });
    const revised = { ...createArtifact(), summary: "durable before scrub" };
    const outcome = writer.write({ ...plan, projection: first }, revised);

    await ready;
    const transactionPath = path.join(
      path.dirname(first.path),
      `.${plan.id}.projection.transaction`,
    );
    await expect(readFile(first.path, "utf8")).resolves.toContain(
      "durable before scrub",
    );
    await expect(readFile(transactionPath, "utf8")).resolves.toContain(
      "# Writer Test",
    );

    await expect(outcome).resolves.toMatchObject({ path: first.path });
    await expect(readFile(transactionPath, "utf8")).resolves.toBe("");
  });

  it("recovers after a helper crash between durable swap and retired scrub", async () => {
    const baseWriter = createPlanArtifactWriter();
    const plan = createPlan(workspaceRoot);
    const first = await baseWriter.write(plan, createArtifact());
    const revised = { ...createArtifact(), summary: "crash-safe next" };
    const crashingWriter = createPlanArtifactWriter({
      safeFsTestReadyStage: "projection-swap-durable",
      safeFsTestCrashStage: "projection-swap-durable",
    });

    await expect(
      crashingWriter.write({ ...plan, projection: first }, revised),
    ).rejects.toThrow(/helper failed \(86\)/i);
    const transactionPath = path.join(
      path.dirname(first.path),
      `.${plan.id}.projection.transaction`,
    );
    await expect(readFile(first.path, "utf8")).resolves.toContain(
      "crash-safe next",
    );
    await expect(readFile(transactionPath, "utf8")).resolves.toContain(
      "# Writer Test",
    );

    await expect(
      baseWriter.write({ ...plan, projection: first }, revised),
    ).resolves.toMatchObject({ path: first.path });
    await expect(readFile(transactionPath, "utf8")).resolves.toBe("");
  });

  it("never swaps an attacker replacement from the retired leaf back into the canonical path", async () => {
    const baseWriter = createPlanArtifactWriter();
    const plan = createPlan(workspaceRoot);
    const first = await baseWriter.write(plan, createArtifact());
    const outside = path.join(tempDir, "attacker-target");
    await writeFile(outside, "attacker data", { mode: 0o600 });
    let signalReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      signalReady = resolve;
    });
    const writer = createPlanArtifactWriter({
      safeFsTestDelayMs: 500,
      safeFsTestReadyStage: "projection-published",
      safeFsTestOnReady: signalReady,
    });
    const revised = { ...createArtifact(), summary: "safe published next" };
    const outcome = writer.write({ ...plan, projection: first }, revised).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await ready;
    const plansDir = path.dirname(first.path);
    const retiredLeaf = (await readdir(plansDir)).find((name) =>
      name.endsWith(".projection.transaction")
    );
    expect(retiredLeaf).toBeDefined();
    await rm(path.join(plansDir, retiredLeaf!));
    await symlink(outside, path.join(plansDir, retiredLeaf!));

    const result = await outcome;
    expect(result.ok).toBe(false);
    expect((await lstat(first.path)).isSymbolicLink()).toBe(false);
    await expect(readFile(first.path, "utf8")).resolves.toContain(
      "safe published next",
    );
    await expect(readFile(outside, "utf8")).resolves.toBe("attacker data");
  });

  it("preserves a concurrent canonical replacement after publication without destructive rollback", async () => {
    const baseWriter = createPlanArtifactWriter();
    const plan = createPlan(workspaceRoot);
    const first = await baseWriter.write(plan, createArtifact());
    let signalReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      signalReady = resolve;
    });
    const writer = createPlanArtifactWriter({
      safeFsTestDelayMs: 500,
      safeFsTestReadyStage: "projection-published",
      safeFsTestOnReady: signalReady,
    });
    const revised = { ...createArtifact(), summary: "displaced safe next" };
    const outcome = writer.write({ ...plan, projection: first }, revised).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await ready;
    const displaced = path.join(tempDir, "published-next.md");
    await rename(first.path, displaced);
    await writeFile(first.path, "# concurrent user replacement\n", {
      mode: 0o600,
    });

    const result = await outcome;
    expect(result.ok).toBe(false);
    await expect(readFile(first.path, "utf8")).resolves.toBe(
      "# concurrent user replacement\n",
    );
    await expect(readFile(displaced, "utf8")).resolves.toContain(
      "displaced safe next",
    );
    await expect(readFile(path.join(
      path.dirname(first.path),
      `.${plan.id}.projection.transaction`,
    ), "utf8")).resolves.toBe("");
  });

  it("scrubs the deterministic retired transaction even when unlink would be blocked", async () => {
    const baseWriter = createPlanArtifactWriter();
    const plan = createPlan(workspaceRoot);
    const first = await baseWriter.write(plan, createArtifact());
    let signalReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      signalReady = resolve;
    });
    const delayedWriter = createPlanArtifactWriter({
      safeFsTestDelayMs: 500,
      safeFsTestReadyStage: "projection-before-success",
      safeFsTestOnReady: signalReady,
    });
    const revised = { ...createArtifact(), summary: "cleanup recovery" };
    const outcome = delayedWriter.write(
      { ...plan, projection: first },
      revised,
    ).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await ready;
    const transactionPath = path.join(
      path.dirname(first.path),
      `.${plan.id}.projection.transaction`,
    );
    execFileSync("/usr/bin/chflags", ["uchg", transactionPath]);
    const completed = await outcome;
    expect(completed.ok).toBe(true);
    await expect(readFile(transactionPath, "utf8")).resolves.toBe("");
    execFileSync("/usr/bin/chflags", ["nouchg", transactionPath]);
    const recovered = await baseWriter.write(
      { ...plan, projection: first },
      revised,
    );
    expect(recovered.sha256).not.toBe(first.sha256);
    await expect(readFile(transactionPath, "utf8")).resolves.toBe("");
    await expect(readFile(first.path, "utf8")).resolves.toContain(
      "cleanup recovery",
    );
  });

  it("serializes cooperating writers with a stable per-Plan lock", async () => {
    const baseWriter = createPlanArtifactWriter();
    const plan = createPlan(workspaceRoot);
    const first = await baseWriter.write(plan, createArtifact());
    let signalReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      signalReady = resolve;
    });
    const holdingWriter = createPlanArtifactWriter({
      safeFsTestDelayMs: 500,
      safeFsTestReadyStage: "projection-before-publish",
      safeFsTestOnReady: signalReady,
    });
    const firstOutcome = holdingWriter.write(
      { ...plan, projection: first },
      { ...createArtifact(), summary: "serialized winner" },
    );

    await ready;
    await expect(
      baseWriter.write(
        { ...plan, projection: first },
        { ...createArtifact(), summary: "concurrent loser" },
      ),
    ).rejects.toThrow(/already active/i);
    const winner = await firstOutcome;

    await expect(readFile(winner.path, "utf8")).resolves.toContain(
      "serialized winner",
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
