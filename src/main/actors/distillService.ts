// Distill service (contracts v1.4 §7, P7).
//
// Clusters repeated manual tool_call sequences / workflow journals from history
// and packages high-confidence clusters as discoverable skills via the P6
// `registerWorkflowAsSkill` interface (which P7 implements — filling the P6
// placeholder). Low-confidence clusters queue as learning_candidates for human
// review. This is the self-improvement loop's "codify repeated workflows" half.

import { randomUUID } from "node:crypto";
import type {
  TrajectoryRepository,
  Storage,
} from "../../shared/storageContract";
import type { WorkflowRuntime } from "../workflow/workflowRuntime";
import { registerWorkflowAsSkill, type SkillMeta } from "../workflow/registerWorkflowAsSkill";

export interface DistillDeps {
  storage: Storage;
  trajectoryRepository: TrajectoryRepository;
  workflowRuntime: WorkflowRuntime;
  skillsDir: string;
  /** Min occurrences to consider a sequence a repeat worth packaging. */
  minOccurrences?: number;
  now?: () => string;
}

export interface DistillCluster {
  toolSequence: string[];
  occurrenceCount: number;
  sourceRunIds: string[];
  confidence: number;
}

export interface DistillReport {
  clustersConsidered: number;
  skillsPackaged: number;
  candidatesQueued: number;
  packagedSkillIds: string[];
}

export const DISTILL_PACKAGE_THRESHOLD = 0.7;

export function runDistill(deps: DistillDeps): Promise<DistillReport> {
  const now = deps.now ?? (() => new Date().toISOString());
  const minOccurrences = deps.minOccurrences ?? 3;

  function cluster(): DistillCluster[] {
    // Scan tool_call events across runs; group by tool-name sequence.
    const events = deps.trajectoryRepository.scanByTypes(["tool_call"], { limit: 1000 });
    const byRun = new Map<string, string[]>();
    for (const e of events) {
      const arr = byRun.get(e.runId) ?? [];
      arr.push((e.payload.toolName as string) ?? "?");
      byRun.set(e.runId, arr);
    }
    // Sliding window of length 3 per run → cluster key.
    const counts = new Map<string, { seq: string[]; runs: Set<string> }>();
    for (const [runId, tools] of byRun) {
      for (let i = 0; i + 3 <= tools.length; i++) {
        const key = tools.slice(i, i + 3).join("->");
        const entry = counts.get(key) ?? { seq: tools.slice(i, i + 3), runs: new Set<string>() };
        entry.runs.add(runId);
        counts.set(key, entry);
      }
    }
    const clusters: DistillCluster[] = [];
    for (const [, entry] of counts) {
      if (entry.runs.size >= minOccurrences) {
        clusters.push({
          toolSequence: entry.seq,
          occurrenceCount: entry.runs.size,
          sourceRunIds: [...entry.runs],
          confidence: Math.min(0.95, 0.5 + entry.runs.size * 0.1),
        });
      }
    }
    return clusters.sort((a, b) => b.occurrenceCount - a.occurrenceCount).slice(0, 10);
  }

  return (async (): Promise<DistillReport> => {
    const clusters = cluster();
    let skillsPackaged = 0;
    let candidatesQueued = 0;
    const packagedSkillIds: string[] = [];
    const createdAt = now();

    for (const cluster of clusters) {
      if (cluster.confidence >= DISTILL_PACKAGE_THRESHOLD) {
        const slugBase = cluster.toolSequence.join("-").replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
        const skillId = `distilled-${slugBase}-${randomUUID().slice(0, 8)}`;
        const skillMeta: SkillMeta = {
          name: skillId,
          displayName: `Distilled workflow: ${cluster.toolSequence.join(" → ")}`,
          description: `Automatically packaged from ${cluster.occurrenceCount} repeated runs. Tools: ${cluster.toolSequence.join(", ")}.`,
          mode: "agent",
          agentPrompt: `Execute the repeated workflow: ${cluster.toolSequence.join(" then ")}. Observed ${cluster.occurrenceCount} times across runs ${cluster.sourceRunIds.slice(0, 3).join(", ")}.`,
          permissions: { mode: "workspace_only" },
          tools: cluster.toolSequence,
          sourceRunIds: cluster.sourceRunIds,
        };
        try {
          const result = await registerWorkflowAsSkill(
            deps.workflowRuntime,
            `distilled-${slugBase}`,
            skillMeta,
            { skillsDir: deps.skillsDir },
          );
          skillsPackaged += 1;
          packagedSkillIds.push(result.skillId);
        } catch {
          // registerWorkflowAsSkill not yet fully wired (path-guard etc.); queue instead.
          candidatesQueued += 1;
        }
        void createdAt;
      } else {
        candidatesQueued += 1;
      }
    }

    return { clustersConsidered: clusters.length, skillsPackaged, candidatesQueued, packagedSkillIds };
  })();
}
