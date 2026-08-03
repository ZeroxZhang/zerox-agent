import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
    ).rejects.toThrow(/符号链接/);
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
