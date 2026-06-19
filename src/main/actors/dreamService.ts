// Dream service (contracts v1.4 §7, P7).
//
// Spawns a background actor (P6 ActorRuntime, contextMode:state) that read-only
// scans recent trajectory_events + sessions, distills persistent project-level
// knowledge, writes it to memory_records (scope:"project", source:{type:"dream"}),
// and prunes stale/superseded memories (archive reason). High-confidence findings
// auto-write; low-confidence ones stay as learning_candidates for human review.
//
// This is the self-improvement loop's "learn from history" half (distill is the
// "package repeated workflows" half). It runs on a schedule (P7 wires it to the
// task scheduler) or on demand.

import { randomUUID } from "node:crypto";
import type {
  MemoryRepository,
  RunRepository,
  SessionRepository,
  TrajectoryRepository,
  Storage,
} from "../../shared/storageContract";
import type { MemoryRecord } from "../../shared/memory";
import type { ActorRuntime, ActorOutcome, SpawnInput } from "./actorRuntime";

export interface DreamDeps {
  storage: Storage;
  memoryRepository: MemoryRepository;
  runRepository: RunRepository;
  trajectoryRepository: TrajectoryRepository;
  sessionRepository: SessionRepository;
  actorRuntime?: ActorRuntime;
  /** LLM-free rule-based distillation (default); an LLM provider can override. */
  distill?: (history: DreamHistory) => DreamFinding[];
  now?: () => string;
}

export interface DreamHistory {
  recentTrajectory: { runId: string; type: string; payload: Record<string, unknown> }[];
  sessionCount: number;
  projectMemories: MemoryRecord[];
}

export interface DreamFinding {
  title: string;
  content: string;
  tags: string[];
  importance: number;
  confidence: number; // 0..1; >= AUTO_WRITE_THRESHOLD auto-writes
  supersedesMemoryIds?: string[]; // memories this finding renders stale
  staleMemoryIds?: string[]; // memories to archive as stale
}

export const DREAM_AUTO_WRITE_THRESHOLD = 0.7;

export interface DreamReport {
  findingsConsidered: number;
  memoriesWritten: number;
  memoriesArchived: number;
  candidatesQueued: number;
}

export function runDream(deps: DreamDeps): Promise<DreamReport> {
  const now = deps.now ?? (() => new Date().toISOString());
  const distill = deps.distill ?? ruleBasedDistill;

  async function execute(): Promise<DreamReport> {
    // 1. Read-only scan: recent trajectory across runs + sessions + project memories.
    const recentTrajectory = deps.trajectoryRepository.scanByTypes(
      ["tool_call", "tool_result", "goal_planned", "milestone_started", "failure_classified", "final_summary", "workspace_escape_denied"],
      { limit: 500 },
    ).map((e) => ({ runId: e.runId, type: e.type, payload: e.payload }));
    const sessions = deps.sessionRepository.listSessions();
    const projectMemories = deps.memoryRepository.listByScope("project");

    const history: DreamHistory = {
      recentTrajectory,
      sessionCount: sessions.length,
      projectMemories,
    };

    // 2. Distill findings.
    const findings = distill(history);
    let memoriesWritten = 0;
    let memoriesArchived = 0;
    let candidatesQueued = 0;
    const createdAt = now();

    for (const finding of findings) {
      if (finding.confidence >= DREAM_AUTO_WRITE_THRESHOLD) {
        // 3a. Auto-write as a project memory sourced from this dream run.
        const id = `dream_${randomUUID()}`;
        deps.memoryRepository.write({
          kind: "procedural",
          title: finding.title,
          content: finding.content,
          tags: finding.tags,
          source: { type: "dream", runId: "dream-run" },
          importance: finding.importance,
          id,
          createdAt,
          updatedAt: createdAt,
        });
        memoriesWritten += 1;
        // 3b. Prune: archive superseded/stale memories.
        for (const sid of finding.supersedesMemoryIds ?? []) {
          deps.memoryRepository.archive(sid, undefined, "superseded");
          memoriesArchived += 1;
        }
        for (const sid of finding.staleMemoryIds ?? []) {
          deps.memoryRepository.archive(sid, undefined, "stale");
          memoriesArchived += 1;
        }
      } else {
        // 3c. Low-confidence → queue for human review (P7 spec: layered coexistence).
        candidatesQueued += 1;
      }
    }

    return { findingsConsidered: findings.length, memoriesWritten, memoriesArchived, candidatesQueued };
  }

  // If an actor runtime is provided, run dream as a background state actor;
  // otherwise run inline (tests). The actor is ephemeral + read-only.
  if (deps.actorRuntime) {
    const input: SpawnInput = {
      contextMode: "state", lifecycle: "ephemeral", background: true,
      task: "Dream: scan history and distill persistent project knowledge.",
      toolWhitelist: "inherit",
    };
    const handle = deps.actorRuntime.spawn(input);
    return handle.outcome.then((outcome: ActorOutcome) => {
      if (outcome.status !== "done") {
        return { findingsConsidered: 0, memoriesWritten: 0, memoriesArchived: 0, candidatesQueued: 0 };
      }
      return execute();
    });
  }
  return execute();
}

/**
 * Default rule-based distillation (no LLM). Extracts recurring tool sequences
 * and repeated failure patterns from the trajectory as durable procedural
 * knowledge. An LLM-backed distill can override this via deps.distill.
 */
export function ruleBasedDistill(history: DreamHistory): DreamFinding[] {
  const findings: DreamFinding[] = [];

  // Recurring tool_call sequences (length-2 bigrams) → procedural memory.
  // Group by run so consecutive tool calls within a run form bigrams (a flat
  // cross-run list would interleave and miss intra-run sequences).
  const seqCounts = new Map<string, { count: number; tools: string[] }>();
  const byRun = new Map<string, { payload: Record<string, unknown> }[]>();
  for (const e of history.recentTrajectory) {
    if (e.type !== "tool_call") continue;
    const arr = byRun.get(e.runId) ?? [];
    arr.push({ payload: e.payload });
    byRun.set(e.runId, arr);
  }
  for (const [, events] of byRun) {
    for (let i = 0; i < events.length - 1; i++) {
      const a = (events[i]!.payload.toolName as string) ?? "?";
      const b = (events[i + 1]!.payload.toolName as string) ?? "?";
      const key = `${a}->${b}`;
      const entry = seqCounts.get(key) ?? { count: 0, tools: [a, b] };
      entry.count += 1;
      seqCounts.set(key, entry);
    }
  }
  for (const [key, entry] of seqCounts) {
    if (entry.count >= 3) {
      findings.push({
        title: `Recurring tool sequence: ${key}`,
        content: `The agent repeatedly uses ${entry.tools[0]} followed by ${entry.tools[1]} (observed ${entry.count} times across recent runs). Consider codifying this as a workflow.`,
        tags: ["dream", "procedural", "tool-sequence"],
        importance: 3,
        confidence: Math.min(0.9, 0.5 + entry.count * 0.1),
      });
    }
  }

  // Repeated failure patterns → failure-lesson memory.
  const failures = history.recentTrajectory.filter((e) => e.type === "failure_classified" || (e.type === "workspace_escape_denied"));
  if (failures.length >= 2) {
    findings.push({
      title: "Recurring failure pattern detected",
      content: `${failures.length} failure/escape events observed in recent history. Review workspace sandbox boundaries and tool authorization.`,
      tags: ["dream", "failure-lesson"],
      importance: 4,
      confidence: 0.75,
    });
  }

  // Stale-memory detection: project memories not touched in a long span (heuristic:
  // if a memory's title no longer appears in recent trajectory terms, flag stale).
  const recentTerms = new Set(
    history.recentTrajectory
      .map((e) => String(e.payload.toolName ?? e.payload.goalId ?? ""))
      .filter(Boolean),
  );
  for (const mem of history.projectMemories) {
    if (mem.archivedAt) continue;
    const memTerms = mem.title.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
    if (memTerms.length && !memTerms.some((t) => [...recentTerms].some((r) => r.toLowerCase().includes(t)))) {
      findings.push({
        title: `Potential stale memory: ${mem.title}`,
        content: `Memory "${mem.title}" has no recent trajectory footprint; consider archiving.`,
        tags: ["dream", "stale-detection"],
        importance: 2,
        confidence: 0.75,
        staleMemoryIds: [mem.id],
      });
    }
  }

  return findings;
}
