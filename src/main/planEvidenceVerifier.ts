import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { PlanEvidenceItem, PlanRecord } from "../shared/planMode";
import { readGitPlanningState } from "./nativeGitTools";

export type PlanEvidenceVerification = {
  ok: boolean;
  driftedEvidenceIds: string[];
};

export async function verifyPlanEvidence(
  plan: PlanRecord,
): Promise<PlanEvidenceVerification> {
  if (!plan.workspaceRoot) {
    return { ok: false, driftedEvidenceIds: ["workspace"] };
  }
  let root: string;
  try {
    root = await realpath(plan.workspaceRoot);
  } catch {
    return { ok: false, driftedEvidenceIds: ["workspace"] };
  }
  const driftedEvidenceIds: string[] = [];
  for (const evidence of plan.evidence) {
    let drifted = false;
    if (evidence.sha256 && evidence.sourceRef) {
      const current = await resolveCurrentEvidenceHash(root, evidence).catch(
        () => null,
      );
      drifted = current !== evidence.sha256;
    }
    for (const sourceHash of evidence.sourceHashes ?? []) {
      const current = await resolveCurrentSourceHash(
        root,
        sourceHash.sourceRef,
      ).catch(() => null);
      if (current !== sourceHash.sha256) {
        drifted = true;
        break;
      }
    }
    if (drifted) {
      driftedEvidenceIds.push(evidence.id);
    }
  }
  return {
    ok: driftedEvidenceIds.length === 0,
    driftedEvidenceIds,
  };
}

async function resolveCurrentSourceHash(
  root: string,
  sourceRef: string,
): Promise<string> {
  const source = await realpath(sourceRef);
  assertInside(root, source);
  return hash(await readFile(source));
}

async function resolveCurrentEvidenceHash(
  root: string,
  evidence: PlanEvidenceItem,
): Promise<string> {
  if (evidence.kind === "workspace") {
    const source = await realpath(evidence.sourceRef!);
    assertInside(root, source);
    const inventory = (await readdir(source))
      .filter((name) => name !== ".zerox")
      .sort()
      .slice(0, 80)
      .join("\n")
      .slice(0, 8_000);
    return hash(inventory);
  }
  if (evidence.kind === "git") {
    if (evidence.id === "evidence_git_state") {
      const source = await realpath(evidence.sourceRef!);
      assertInside(root, source);
      return (
        await readGitPlanningState({
          workspaceRoot: source,
        })
      ).sha256;
    }
    const gitDir = await realpath(evidence.sourceRef!);
    assertInside(root, gitDir);
    const head = (await readFile(path.join(gitDir, "HEAD"), "utf8")).trim();
    let revision = head;
    if (head.startsWith("ref: ")) {
      const ref = head.slice("ref: ".length).trim();
      if (!/^[a-zA-Z0-9_./-]+$/.test(ref) || ref.includes("..")) {
        throw new Error("Git ref 非法。");
      }
      revision = `${head}\n${(
        await readFile(path.join(gitDir, ref), "utf8")
      ).trim()}`;
    }
    return hash(revision);
  }
  if (evidence.kind === "file") {
    const source = await realpath(evidence.sourceRef!);
    assertInside(root, source);
    return hash(await readFile(source, "utf8"));
  }
  return evidence.sha256!;
}

function assertInside(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("计划证据路径越过工作区边界。");
  }
}

function hash(value: string | NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(value).digest("hex");
}
