// Self-improvement scheduler (contracts v1.4 §7, P7 activation).
//
// Runs dream (history → persistent project memories + pruning) and distill
// (repeated workflows → packaged skills) on a schedule, alongside the existing
// 30-min memory-maintenance timer. Default OFF (ZEROX_SELF_IMPROVEMENT=off) —
// dream/distill incur background LLM cost; users opt in. The service is
// best-effort: failures log and reschedule, never blocking the main process.
//
// Slash-command entry points (/dream, /distill) are exposed via runNow() so a
// UI command can trigger an immediate cycle.

import { runDream } from "./dreamService";
import { runDistill } from "./distillService";
import type {
  MemoryRepository,
  RunRepository,
  SessionRepository,
  Storage,
  TrajectoryRepository,
} from "../../shared/storageContract";
import type { WorkflowRuntime } from "../workflow/workflowRuntime";

export type SelfImprovementMode = "on" | "off";

export function resolveSelfImprovementMode(
  env: NodeJS.ProcessEnv = process.env,
): SelfImprovementMode {
  return (env.ZEROX_SELF_IMPROVEMENT ?? "").toLowerCase() === "on" ? "on" : "off";
}

export interface SelfImprovementDeps {
  storage: Storage;
  memoryRepository: MemoryRepository;
  runRepository: RunRepository;
  trajectoryRepository: TrajectoryRepository;
  sessionRepository: SessionRepository;
  workflowRuntime: WorkflowRuntime;
  skillsDir: string;
  intervalMs?: number;
}

export interface SelfImprovementReport {
  dream: Awaited<ReturnType<typeof runDream>>;
  distill: Awaited<ReturnType<typeof runDistill>>;
  at: string;
}

export interface SelfImprovementService {
  start(): void;
  stop(): void;
  runNow(): Promise<SelfImprovementReport>;
  isRunning(): boolean;
}

export function createSelfImprovementService(
  deps: SelfImprovementDeps,
): SelfImprovementService {
  let timer: NodeJS.Timeout | null = null;
  const intervalMs = deps.intervalMs ?? 60 * 60 * 1000; // 1h default

  async function cycle(): Promise<SelfImprovementReport> {
    const at = new Date().toISOString();
    const siRunId = "self-improvement";
    emitEvent(deps.runRepository, siRunId, "dream_started", { at });
    const dream = await runDream({
      storage: deps.storage,
      memoryRepository: deps.memoryRepository,
      runRepository: deps.runRepository,
      trajectoryRepository: deps.trajectoryRepository,
      sessionRepository: deps.sessionRepository,
    }).catch((error) => {
      // eslint-disable-next-line no-console
      console.warn("[self-improvement] dream failed:", String(error));
      return { findingsConsidered: 0, memoriesWritten: 0, memoriesArchived: 0, candidatesQueued: 0 };
    });
    emitEvent(deps.runRepository, siRunId, "dream_completed", {
      findingsConsidered: dream.findingsConsidered,
      memoriesWritten: dream.memoriesWritten,
      memoriesArchived: dream.memoriesArchived,
      at: new Date().toISOString(),
    });
    emitEvent(deps.runRepository, siRunId, "distill_started", { at: new Date().toISOString() });
    const distill = await runDistill({
      storage: deps.storage,
      trajectoryRepository: deps.trajectoryRepository,
      workflowRuntime: deps.workflowRuntime,
      skillsDir: deps.skillsDir,
    }).catch((error) => {
      // eslint-disable-next-line no-console
      console.warn("[self-improvement] distill failed:", String(error));
      return { clustersConsidered: 0, skillsPackaged: 0, candidatesQueued: 0, packagedSkillIds: [] };
    });
    emitEvent(deps.runRepository, siRunId, "distill_completed", {
      clustersConsidered: distill.clustersConsidered,
      skillsPackaged: distill.skillsPackaged,
      packagedSkillIds: distill.packagedSkillIds,
      at: new Date().toISOString(),
    });
    return { dream, distill, at };
  }

  function emitEvent(
    runRepository: RunRepository,
    runId: string,
    type: "dream_started" | "dream_completed" | "distill_started" | "distill_completed",
    payload: Record<string, unknown>,
  ): void {
    try {
      runRepository.appendTrajectory(runId, {
        id: `evt-${type}-${Math.random().toString(36).slice(2, 10)}`,
        runId,
        type,
        sequence: Date.now(),
        payload,
        redaction: { containsApiKey: false, containsFileContent: false, containsUserText: false },
        createdAt: new Date().toISOString(),
      });
    } catch {
      // best-effort
    }
  }

  return {
    start() {
      if (timer) return;
      if (resolveSelfImprovementMode() === "off") return; // opt-in
      timer = setInterval(() => { void cycle(); }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    async runNow() {
      return cycle();
    },
    isRunning() {
      return timer !== null;
    },
  };
}
