// ActorRuntime v0 (contracts v1.4 §5.1/§5.2, Exit Criteria for P6).
//
// v0 implements `spawn` (`contextMode:"full"` only — used by the P5 checkpoint-
// writer fork agent) + `wait` + `cancel` + `status`. P6 extends to full
// (`send`/`background`/`outputSchema`/peer) WITHOUT breaking these v0 callers.
//
// The runtime records lifecycle in the P1 `actors` table (ActorRepository) and
// delegates the actual fork-agent execution to an injected `runActor` callback —
// this keeps the runtime testable without a real subprocess/LLM, and lets the
// checkpoint-writer actor plug in as one such callback.

import { randomUUID } from "node:crypto";
import type {
  ActorRecord,
  ActorRepository,
  ActorStatus,
  Storage,
} from "../../shared/storageContract";
import { createActorRepository } from "../storage/repositories/sessionRepository";
import type { CachePrefix } from "../providers/provider";

export type ActorContextMode = "none" | "state" | "full";

export interface ForkContext {
  cachePrefix: CachePrefix; // P3 — byte-stable prefix for cache alignment
  parentRunId: string;
  frozenAt: number; // trajectory seq at capture time (Patch 16)
}

export interface SpawnInput {
  contextMode: ActorContextMode; // v0: "full" only
  toolWhitelist?: "inherit" | string[];
  lifecycle: "persistent" | "ephemeral";
  model?: string;
  task: string; // user-message instruction appended after the cached prefix (Patch 17)
  parentRunId?: string;
  forkContext?: ForkContext; // required for contextMode:"full"
}

export interface ActorOutcome {
  status: "done" | "canceled" | "error";
  summary: string;
  filesTouched: string[];
  findingsWorthPromoting?: string[];
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ActorHandle {
  actorId: string;
  outcome: Promise<ActorOutcome>;
}

export interface RunActorDeps {
  /** Executes the fork actor's work; resolved via ActorRuntime.wait(). */
  runActor: (input: SpawnInput, forkContext: ForkContext | undefined, cancel: AbortSignal) => Promise<ActorOutcome>;
}

export interface CreateActorRuntimeOptions {
  storage?: Storage;
  actorRepository?: ActorRepository;
  deps: RunActorDeps;
}

export interface ActorRuntime {
  spawn(input: SpawnInput): ActorHandle;
  wait(actorId: string): Promise<ActorOutcome>;
  cancel(actorId: string, reason?: string): void;
  status(actorId: string): ActorStatus;
}

export function createActorRuntime(
  options: CreateActorRuntimeOptions,
): ActorRuntime {
  const repo = options.actorRepository ?? (options.storage ? createActorRepository(options.storage) : null);
  const actors = new Map<string, { handle: ActorHandle; cancel: AbortController; record: ActorRecord }>();

  return {
    spawn(input: SpawnInput): ActorHandle {
      const actorId = randomUUID();
      const now = new Date().toISOString();
      const cancel = new AbortController();
      const record: Omit<ActorRecord, "id"> & { id: string } = {
        id: actorId,
        runId: input.parentRunId ?? actorId,
        contextMode: input.contextMode,
        status: "spawning",
        ...(input.task ? { task: input.task.slice(0, 200) } : {}),
        payload: { input, forkContext: input.forkContext },
        createdAt: now,
        updatedAt: now,
      };
      repo?.create(record);
      // Transition to running immediately (fork actor begins work).
      const running: ActorRecord = { ...record, status: "running" };
      repo?.updateStatus(actorId, "running");

      const outcome = options.deps.runActor(input, input.forkContext, cancel.signal)
        .then((result) => {
          repo?.updateStatus(actorId, result.status);
          return result;
        })
        .catch((error) => {
          repo?.updateStatus(actorId, "error");
          return { status: "error" as const, summary: String(error), filesTouched: [] };
        });

      const handle: ActorHandle = { actorId, outcome };
      actors.set(actorId, { handle, cancel, record: running });
      return handle;
    },

    wait(actorId: string): Promise<ActorOutcome> {
      const entry = actors.get(actorId);
      if (!entry) return Promise.reject(new Error(`unknown actor ${actorId}`));
      return entry.handle.outcome;
    },

    cancel(actorId: string, reason?: string): void {
      const entry = actors.get(actorId);
      if (!entry) return;
      entry.cancel.abort(new Error(reason ?? "canceled"));
      repo?.updateStatus(actorId, "canceled");
    },

    status(actorId: string): ActorStatus {
      const entry = actors.get(actorId);
      if (!entry) return "done";
      // The in-memory record's status is updated lazily via the outcome chain;
      // for a synchronous snapshot, derive from the abort + outcome state.
      if (entry.cancel.signal.aborted) return "canceled";
      return entry.record.status;
    },
  };
}
