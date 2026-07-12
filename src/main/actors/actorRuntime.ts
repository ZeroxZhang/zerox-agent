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
import { ActorInbox } from "./actorInbox";
import { validateOutputSchema } from "./actorOutputSchema";
import type { CachePrefix } from "../providers/provider";

export type ActorContextMode = "none" | "state" | "full";

export interface ForkContext {
  cachePrefix: CachePrefix; // P3 — byte-stable prefix for cache alignment
  parentRunId: string;
  frozenAt: number; // trajectory seq at capture time (Patch 16)
}

export interface SpawnInput {
  contextMode: ActorContextMode; // v0: "full" only; full: "none"|"state"|"full"
  toolWhitelist?: "inherit" | string[];
  lifecycle: "persistent" | "ephemeral";
  model?: string;
  task: string; // user-message instruction appended after the cached prefix (Patch 17)
  parentRunId?: string;
  forkContext?: ForkContext; // required for contextMode:"full"
  background?: boolean; // P6: return handle immediately, parent doesn't wait
  outputSchema?: Record<string, unknown>; // P6: JsonSchema subset for outcome value validation
  parentActorId?: string; // P6: peer-mode sender (for inbox lineage)
}

export interface ActorOutcome {
  status: "done" | "canceled" | "error";
  summary: string;
  filesTouched: string[];
  findingsWorthPromoting?: string[];
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  value?: unknown; // P6: validated against outputSchema
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
  /** Bounded in-memory cache for recently completed actor outcomes. */
  terminalOutcomeCacheLimit?: number;
}

export interface ActorRuntime {
  spawn(input: SpawnInput): ActorHandle;
  wait(actorId: string): Promise<ActorOutcome>;
  cancel(actorId: string, reason?: string): void;
  status(actorId: string): ActorStatus;
  isOwnedBy(actorId: string, parentRunId: string): boolean;
  send?(actorId: string, msg: unknown, fromActorId?: string): void; // P6 full
  shutdown?(): Promise<void>;
}

export function createActorRuntime(
  options: CreateActorRuntimeOptions,
): ActorRuntime {
  const repo = options.actorRepository ?? (options.storage ? createActorRepository(options.storage) : null);
  const actors = new Map<string, { handle: ActorHandle; cancel: AbortController; record: ActorRecord; inbox: ActorInbox; input: SpawnInput }>();
  const terminalActors = new Map<string, {
    outcome: ActorOutcome;
    parentRunId?: string;
  }>();
  const requestedTerminalOutcomeCacheLimit =
    options.terminalOutcomeCacheLimit ?? 256;
  const terminalOutcomeCacheLimit =
    Number.isFinite(requestedTerminalOutcomeCacheLimit) &&
    requestedTerminalOutcomeCacheLimit > 0
      ? Math.max(1, Math.floor(requestedTerminalOutcomeCacheLimit))
      : 256;
  let shuttingDown = false;
  const now = () => new Date().toISOString();

  function validateOutcome(input: SpawnInput, outcome: ActorOutcome): ActorOutcome {
    if (input.outputSchema && outcome.status === "done" && outcome.value !== undefined) {
      const err = validateOutputSchema(outcome.value, input.outputSchema);
      if (err) return { ...outcome, status: "error", summary: `outputSchema validation failed: ${err}` };
    }
    return outcome;
  }

  function rememberTerminal(actorId: string, outcome: ActorOutcome): void {
    const entry = actors.get(actorId);
    terminalActors.set(actorId, {
      outcome,
      ...(entry?.input.parentRunId
        ? { parentRunId: entry.input.parentRunId }
        : {}),
    });
    actors.delete(actorId);

    while (terminalActors.size > terminalOutcomeCacheLimit) {
      const oldestActorId = terminalActors.keys().next().value as
        | string
        | undefined;
      if (!oldestActorId) break;
      terminalActors.delete(oldestActorId);
    }
  }

  return {
    spawn(input: SpawnInput): ActorHandle {
      if (shuttingDown) {
        throw new Error("Actor runtime is shutting down; new actors are not accepted.");
      }
      const actorId = randomUUID();
      const cancel = new AbortController();
      const record: Omit<ActorRecord, "id"> & { id: string } = {
        id: actorId,
        runId: input.parentRunId ?? actorId,
        contextMode: input.contextMode,
        status: "spawning",
        ...(input.task ? { task: input.task.slice(0, 200) } : {}),
        payload: { input, forkContext: input.forkContext },
        createdAt: now(),
        updatedAt: now(),
      };
      repo?.create(record);
      const running: ActorRecord = { ...record, status: "running" };
      repo?.updateStatus(actorId, "running");

      const outcome = options.deps.runActor(input, input.forkContext, cancel.signal)
        .then((result) => {
          const validated = cancel.signal.aborted
            ? {
                ...result,
                status: "canceled" as const,
                summary: String(cancel.signal.reason ?? "canceled"),
              }
            : validateOutcome(input, result);
          // Drain any undelivered inbox messages on terminal (post-stop re-entry cap).
          const entry = actors.get(actorId);
          if (entry && entry.inbox.pending(actorId) > 0) {
            entry.inbox.markUndelivered(actorId, now);
          }
          if (entry) {
            entry.record = {
              ...entry.record,
              status: validated.status,
              updatedAt: now(),
            };
          }
          repo?.updateStatus(actorId, validated.status);
          rememberTerminal(actorId, validated);
          return validated;
        })
        .catch((error) => {
          const status: ActorOutcome["status"] = cancel.signal.aborted ? "canceled" : "error";
          const summary = cancel.signal.aborted
            ? String(cancel.signal.reason ?? error)
            : String(error);
          const entry = actors.get(actorId);
          if (entry) {
            entry.record = {
              ...entry.record,
              status,
              updatedAt: now(),
            };
          }
          repo?.updateStatus(actorId, status);
          const failedOutcome: ActorOutcome = {
            status,
            summary,
            filesTouched: [],
          };
          rememberTerminal(actorId, failedOutcome);
          return failedOutcome;
        });

      const handle: ActorHandle = { actorId, outcome };
      actors.set(actorId, { handle, cancel, record: running, inbox: new ActorInbox(), input });
      return handle;
    },

    wait(actorId: string): Promise<ActorOutcome> {
      const entry = actors.get(actorId);
      if (entry) return entry.handle.outcome;
      const terminal = terminalActors.get(actorId);
      if (terminal) return Promise.resolve(terminal.outcome);
      return Promise.reject(new Error(`unknown actor ${actorId}`));
    },

    send(actorId: string, msg: unknown, fromActorId?: string): void {
      const entry = actors.get(actorId);
      if (!entry) return;
      entry.inbox.send(fromActorId ?? null, actorId, msg, now);
    },

    cancel(actorId: string, reason?: string): void {
      const entry = actors.get(actorId);
      if (!entry) return;
      entry.cancel.abort(new Error(reason ?? "canceled"));
      entry.record = {
        ...entry.record,
        status: "canceled",
        updatedAt: now(),
      };
      repo?.updateStatus(actorId, "canceled");
    },

    status(actorId: string): ActorStatus {
      const entry = actors.get(actorId);
      if (!entry) return terminalActors.get(actorId)?.outcome.status ?? "done";
      // The in-memory record's status is updated lazily via the outcome chain;
      // for a synchronous snapshot, derive from the abort + outcome state.
      if (entry.cancel.signal.aborted) return "canceled";
      return entry.record.status;
    },

    isOwnedBy(actorId: string, parentRunId: string): boolean {
      const entry = actors.get(actorId);
      const terminal = terminalActors.get(actorId);
      return Boolean(
        parentRunId &&
        (entry?.input.parentRunId === parentRunId ||
          terminal?.parentRunId === parentRunId),
      );
    },

    async shutdown() {
      // Close admission before taking the active snapshot so work that was
      // already accepted elsewhere cannot create an undrained late actor.
      shuttingDown = true;
      // Terminal actors are removed from `actors` immediately, so every
      // remaining entry still owns unsettled work even if cancel() already
      // changed its visible record status to "canceled".
      const active = [...actors.values()];
      for (const entry of active) {
        if (!entry.cancel.signal.aborted) {
          entry.cancel.abort("application_shutdown");
        }
      }
      await Promise.allSettled(active.map((entry) => entry.handle.outcome));
      actors.clear();
      terminalActors.clear();
    },
  };
}
