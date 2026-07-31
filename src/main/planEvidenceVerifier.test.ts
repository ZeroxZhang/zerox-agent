import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlanRecord } from "../shared/planMode";
import { verifyPlanEvidence } from "./planEvidenceVerifier";
import { readGitPlanningState } from "./nativeGitTools";

const execFileAsync = promisify(execFile);

describe("plan evidence verifier", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "zerox-plan-evidence-"));
  });

  afterEach(async () => {
    await rm(tempDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 20,
    });
  });

  it("detects source-file drift while ignoring the trusted .zerox projection directory", async () => {
    const sourcePath = path.join(tempDir, "README.md");
    await writeFile(sourcePath, "before\n");
    const inventory = "README.md";
    const plan = createPlan(tempDir, [
      {
        id: "inventory",
        kind: "workspace",
        title: "inventory",
        summary: inventory,
        sourceRef: tempDir,
        sha256: hash(inventory),
      },
      {
        id: "readme",
        kind: "file",
        title: "README.md",
        summary: "before",
        sourceRef: sourcePath,
        sha256: hash("before\n"),
      },
    ]);
    await mkdir(path.join(tempDir, ".zerox", "plans"), { recursive: true });
    await writeFile(path.join(tempDir, ".zerox", "plans", "plan.md"), "plan");
    await expect(verifyPlanEvidence(plan)).resolves.toEqual({
      ok: true,
      driftedEvidenceIds: [],
    });

    await writeFile(sourcePath, "after\n");
    await expect(verifyPlanEvidence(plan)).resolves.toEqual({
      ok: false,
      driftedEvidenceIds: ["readme"],
    });
  });

  it("detects HEAD, staged, and unstaged Git drift from a repository state fingerprint", async () => {
    await execFileAsync("git", ["init"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.name", "Zerox Test"], {
      cwd: tempDir,
    });
    await execFileAsync(
      "git",
      ["config", "user.email", "zerox@example.test"],
      { cwd: tempDir },
    );
    const sourcePath = path.join(tempDir, "README.md");
    await writeFile(sourcePath, "before\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: tempDir });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: tempDir });
    const state = await readGitPlanningState({ workspaceRoot: tempDir });
    const plan = createPlan(tempDir, [
      {
        id: "evidence_git_state",
        kind: "git",
        title: "Git 状态指纹",
        summary: state.summary,
        sourceRef: tempDir,
        sha256: state.sha256,
      },
    ]);

    await expect(verifyPlanEvidence(plan)).resolves.toEqual({
      ok: true,
      driftedEvidenceIds: [],
    });
    await writeFile(sourcePath, "after\n");
    await expect(verifyPlanEvidence(plan)).resolves.toEqual({
      ok: false,
      driftedEvidenceIds: ["evidence_git_state"],
    });
  });
});

function createPlan(
  workspaceRoot: string,
  evidence: PlanRecord["evidence"],
): PlanRecord {
  return {
    id: "plan-evidence",
    sessionId: "session",
    workspaceRoot,
    sourceMessage: "verify evidence",
    mode: "direct",
    status: "awaiting_confirmation",
    actionGate: "ready",
    revision: 1,
    taskContract: {
      objective: "verify evidence",
      audience: "user",
      inScope: [],
      outOfScope: [],
      constraints: [],
      successCriteria: [],
      assumptions: [],
    },
    evidence,
    requestedModelAssignments: {},
    frozenModelAssignments: {},
    rounds: [],
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
