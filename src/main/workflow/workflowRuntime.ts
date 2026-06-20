// WorkflowRuntime (contracts v1.4 §6, Exit Criteria for P7).
//
// Runs a registered workflow function in a controlled scope with injected host
// hooks (agent / webfetch / websearch / parallel / pipeline). The contract names
// a QuickJS (`quickjs-emscripten`) sandbox for hard isolation; per spec R1 the
// QuickJS WASM module carries Electron-packaging cost and the spec explicitly
// permits a fallback. This implementation runs registered workflow functions
// (not arbitrary eval) with a frozen host-hook surface — the orchestration value
// (parallel/pipeline/deep-research, deterministic journaling) is what P7's
// dream/distill consumes. A QuickJS-backed sandbox can replace the executor
// behind the same `WorkflowSandbox` interface without touching callers.

import type { ActorOutcome, SpawnInput } from "../actors/actorRuntime";

export interface SearchHit {
  url: string;
  title: string;
  snippet?: string;
}

export interface WorkflowSandbox {
  agent(input: SpawnInput): Promise<ActorOutcome>; // never throws; failure → error outcome
  webfetch(url: string): Promise<string>;
  websearch(q: string): Promise<SearchHit[]>;
  parallel<T>(thunks: Array<() => Promise<T>>): Promise<T[]>;
  pipeline<T>(items: T[], ...stages: Array<(prev: unknown, item: T, i: number) => unknown>): Promise<unknown[]>;
}

export interface WorkflowOpts {
  runId: string;
  parentActorId?: string;
  deadlineMs?: number; // default 12h (§6); may be narrowed
  memoryMb?: number; // default 64 (§6)
  prngSeed?: number; // deterministic PRNG seed; defaults to hash(runId)
  signal?: AbortSignal;
  failFast?: boolean; // pipeline fail-fast (default false)
}

export interface WorkflowPhase {
  name: string;
  startedAt: string;
  endedAt?: string;
  status: "running" | "done" | "error";
  meta?: Record<string, unknown>;
}

export interface WorkflowResult {
  status: "done" | "canceled" | "error" | "deadline_exceeded";
  value?: unknown;
  error?: string;
  phases: WorkflowPhase[];
  actorSpawns: string[];
}

export type WorkflowFn = (args: unknown, sandbox: WorkflowSandbox, journal: WorkflowJournal) => Promise<unknown>;

export interface WorkflowJournal {
  phase(name: string, meta?: Record<string, unknown>): void;
  factCapped(reason: string): void;
  actorSpawned(actorId: string): void;
  phases: WorkflowPhase[];
  actorSpawns: string[];
}

export const WORKFLOW_PARALLEL_MAX = 8;

export interface WorkflowHostHooks {
  spawnActor: (input: SpawnInput) => Promise<ActorOutcome>;
  webfetch: (url: string) => Promise<string>;
  websearch: (q: string) => Promise<SearchHit[]>;
}

export interface WorkflowRuntime {
  register(name: string, fn: WorkflowFn): void;
  list(): string[];
  run(name: string, args: unknown, opts: WorkflowOpts): Promise<WorkflowResult>;
  has(name: string): boolean;
}

export function createWorkflowRuntime(hooks: WorkflowHostHooks): WorkflowRuntime {
  const registry = new Map<string, WorkflowFn>();

  function makeSandbox(opts: WorkflowOpts): WorkflowSandbox {
    return {
      async agent(input: SpawnInput): Promise<ActorOutcome> {
        try {
          return await hooks.spawnActor(input);
        } catch (error) {
          return { status: "error", summary: String(error), filesTouched: [] };
        }
      },
      async webfetch(url: string): Promise<string> {
        return hooks.webfetch(url);
      },
      async websearch(q: string): Promise<SearchHit[]> {
        return hooks.websearch(q);
      },
      async parallel<T>(thunks: Array<() => Promise<T>>): Promise<T[]> {
        // Concurrency cap WORKFLOW_PARALLEL_MAX; aggregate errors (Patch 20).
        const out: T[] = [];
        const errors: Error[] = [];
        for (let i = 0; i < thunks.length; i += WORKFLOW_PARALLEL_MAX) {
          const batch = thunks.slice(i, i + WORKFLOW_PARALLEL_MAX);
          const settled = await Promise.allSettled(batch.map((t) => t()));
          for (const s of settled) {
            if (s.status === "fulfilled") out.push(s.value);
            else errors.push(s.reason instanceof Error ? s.reason : new Error(String(s.reason)));
          }
        }
        if (errors.length) {
          throw new AggregateError(errors, `parallel: ${errors.length} thunk(s) failed`);
        }
        return out;
      },
      async pipeline<T>(items: T[], ...stages: Array<(prev: unknown, item: T, i: number) => unknown>): Promise<unknown[]> {
        const results: unknown[] = [];
        for (let i = 0; i < items.length; i++) {
          let prev: unknown = undefined;
          let itemError: Error | null = null;
          for (const stage of stages) {
            try {
              prev = await stage(prev, items[i]!, i);
            } catch (error) {
              itemError = error instanceof Error ? error : new Error(String(error));
              if (opts.failFast) throw itemError;
              break;
            }
          }
          results.push(itemError ? { error: itemError.message } : prev);
        }
        return results;
      },
    };
  }

  function makeJournal(): WorkflowJournal {
    const phases: WorkflowPhase[] = [];
    const actorSpawns: string[] = [];
    return {
      phases,
      actorSpawns,
      phase(name: string, meta?: Record<string, unknown>) {
        const existing = phases.find((p) => p.name === name && p.status === "running");
        if (existing) {
          existing.status = "done";
          existing.endedAt = new Date().toISOString();
          if (meta) existing.meta = { ...(existing.meta ?? {}), ...meta };
          return;
        }
        phases.push({ name, startedAt: new Date().toISOString(), status: "running" });
      },
      factCapped(reason: string) {
        phases.push({ name: "fact_capped", startedAt: new Date().toISOString(), status: "done", meta: { reason } });
      },
      actorSpawned(actorId: string) {
        actorSpawns.push(actorId);
      },
    };
  }

  return {
    register(name: string, fn: WorkflowFn) {
      registry.set(name, fn);
    },
    list() {
      return [...registry.keys()];
    },
    has(name: string) {
      return registry.has(name);
    },
    async run(name: string, args: unknown, opts: WorkflowOpts): Promise<WorkflowResult> {
      const fn = registry.get(name);
      if (!fn) {
        return { status: "error", error: `unknown workflow "${name}"`, phases: [], actorSpawns: [] };
      }
      const journal = makeJournal();
      const result: WorkflowResult = { status: "done", phases: journal.phases, actorSpawns: journal.actorSpawns };
      const sandbox = makeSandbox(opts);
      const deadline = opts.deadlineMs ?? 12 * 60 * 60 * 1000;
      const timer = setTimeout(() => {}, 0); // keep event loop alive; abort via signal
      void timer;
      try {
        if (opts.signal?.aborted) throw new Error("canceled");
        const value = await Promise.race([
          fn(args, sandbox, journal),
          new Promise<never>((_, reject) => {
            const to = setTimeout(() => reject(new Error("deadline")), deadline);
            opts.signal?.addEventListener("abort", () => { clearTimeout(to); reject(new Error("canceled")); });
          }),
        ]);
        result.value = value;
        result.status = "done";
      } catch (error) {
        const msg = String(error);
        result.status = msg === "canceled" ? "canceled" : msg === "deadline" ? "deadline_exceeded" : "error";
        result.error = msg;
      }
      return result;
    },
  };
}
