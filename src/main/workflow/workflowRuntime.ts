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

import type {
  ActorOutcome,
  ActorRuntime,
  SpawnInput,
} from "../actors/actorRuntime";

export interface SearchHit {
  url: string;
  title: string;
  snippet?: string;
}

export interface WorkflowSandbox {
  signal: AbortSignal;
  agent(input: SpawnInput): Promise<ActorOutcome>;
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
  spawnActor: (
    input: SpawnInput,
    options: WorkflowHostOperationOptions,
  ) => Promise<ActorOutcome>;
  webfetch: (
    url: string,
    options: WorkflowHostOperationOptions,
  ) => Promise<string>;
  websearch: (
    q: string,
    options: WorkflowHostOperationOptions,
  ) => Promise<SearchHit[]>;
}

export interface WorkflowHostOperationOptions {
  signal: AbortSignal;
  runId: string;
  parentActorId?: string;
}

export interface WorkflowRuntime {
  register(name: string, fn: WorkflowFn): void;
  list(): string[];
  run(name: string, args: unknown, opts: WorkflowOpts): Promise<WorkflowResult>;
  has(name: string): boolean;
}

export function createWorkflowRuntime(hooks: WorkflowHostHooks): WorkflowRuntime {
  const registry = new Map<string, WorkflowFn>();

  function makeSandbox(options: {
    opts: WorkflowOpts;
    signal: AbortSignal;
    hostOperations: Set<Promise<unknown>>;
    isAdmissionOpen: () => boolean;
  }): WorkflowSandbox {
    const hostOptions: WorkflowHostOperationOptions = {
      signal: options.signal,
      runId: options.opts.runId,
      ...(options.opts.parentActorId
        ? { parentActorId: options.opts.parentActorId }
        : {}),
    };

    function assertAdmission(): void {
      throwIfWorkflowAborted(options.signal);
      if (!options.isAdmissionOpen()) {
        throw new Error("Workflow host operation admission is closed.");
      }
    }

    function track<T>(operation: Promise<T>): Promise<T> {
      options.hostOperations.add(operation);
      void operation.then(
        () => options.hostOperations.delete(operation),
        () => options.hostOperations.delete(operation),
      );
      return operation;
    }

    return {
      signal: options.signal,
      agent(input: SpawnInput): Promise<ActorOutcome> {
        assertAdmission();
        const operation = Promise.resolve()
          .then(() =>
            hooks.spawnActor(
              {
                ...input,
                parentRunId: input.parentRunId ?? options.opts.runId,
              },
              hostOptions,
            ),
          )
          .then(
            (outcome) => {
              throwIfWorkflowAborted(options.signal);
              return outcome;
            },
            (error: unknown) => {
              throwIfWorkflowAborted(options.signal);
              return {
                status: "error" as const,
                summary: String(error),
                filesTouched: [],
              };
            },
          );
        return track(operation);
      },
      webfetch(url: string): Promise<string> {
        assertAdmission();
        return track(
          Promise.resolve()
            .then(() => hooks.webfetch(url, hostOptions))
            .then((result) => {
              throwIfWorkflowAborted(options.signal);
              return result;
            }),
        );
      },
      websearch(q: string): Promise<SearchHit[]> {
        assertAdmission();
        return track(
          Promise.resolve()
            .then(() => hooks.websearch(q, hostOptions))
            .then((result) => {
              throwIfWorkflowAborted(options.signal);
              return result;
            }),
        );
      },
      parallel<T>(thunks: Array<() => Promise<T>>): Promise<T[]> {
        assertAdmission();
        // Concurrency cap WORKFLOW_PARALLEL_MAX; aggregate errors (Patch 20).
        return track((async () => {
          const out: T[] = [];
          const errors: Error[] = [];
          for (let i = 0; i < thunks.length; i += WORKFLOW_PARALLEL_MAX) {
            assertAdmission();
            const batch = thunks.slice(i, i + WORKFLOW_PARALLEL_MAX);
            const settled = await Promise.allSettled(
              batch.map(async (thunk) => {
                assertAdmission();
                const value = await thunk();
                throwIfWorkflowAborted(options.signal);
                return value;
              }),
            );
            throwIfWorkflowAborted(options.signal);
            for (const s of settled) {
              if (s.status === "fulfilled") out.push(s.value);
              else errors.push(s.reason instanceof Error ? s.reason : new Error(String(s.reason)));
            }
          }
          if (errors.length) {
            throw new AggregateError(errors, `parallel: ${errors.length} thunk(s) failed`);
          }
          return out;
        })());
      },
      pipeline<T>(items: T[], ...stages: Array<(prev: unknown, item: T, i: number) => unknown>): Promise<unknown[]> {
        assertAdmission();
        return track((async () => {
          const results: unknown[] = [];
          for (let i = 0; i < items.length; i++) {
            assertAdmission();
            let prev: unknown = undefined;
            let itemError: Error | null = null;
            for (const stage of stages) {
              try {
                assertAdmission();
                prev = await stage(prev, items[i]!, i);
                throwIfWorkflowAborted(options.signal);
              } catch (error) {
                throwIfWorkflowAborted(options.signal);
                itemError = error instanceof Error ? error : new Error(String(error));
                if (options.opts.failFast) throw itemError;
                break;
              }
            }
            results.push(itemError ? { error: itemError.message } : prev);
          }
          return results;
        })());
      },
    };
  }

  function makeJournal(
    signal: AbortSignal,
    isAdmissionOpen: () => boolean,
  ): WorkflowJournal {
    const phases: WorkflowPhase[] = [];
    const actorSpawns: string[] = [];
    const assertAdmission = () => {
      throwIfWorkflowAborted(signal);
      if (!isAdmissionOpen()) {
        throw new Error("Workflow journal admission is closed.");
      }
    };
    return {
      phases,
      actorSpawns,
      phase(name: string, meta?: Record<string, unknown>) {
        assertAdmission();
        closeRunningPhases(phases, "done");
        const existing = phases.find((p) => p.name === name && p.status === "running");
        if (existing) {
          existing.status = "done";
          existing.endedAt = new Date().toISOString();
          if (meta) existing.meta = { ...(existing.meta ?? {}), ...meta };
          return;
        }
        phases.push({
          name,
          startedAt: new Date().toISOString(),
          status: "running",
          ...(meta ? { meta } : {}),
        });
      },
      factCapped(reason: string) {
        assertAdmission();
        phases.push({ name: "fact_capped", startedAt: new Date().toISOString(), status: "done", meta: { reason } });
      },
      actorSpawned(actorId: string) {
        assertAdmission();
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
      const controller = new AbortController();
      const hostOperations = new Set<Promise<unknown>>();
      let admissionOpen = true;
      let terminalReason: "canceled" | "deadline_exceeded" | null = null;
      const abortFromParent = () => {
        if (controller.signal.aborted) return;
        terminalReason = "canceled";
        controller.abort(
          opts.signal?.reason ??
            new DOMException("Workflow canceled.", "AbortError"),
        );
      };
      if (opts.signal?.aborted) {
        abortFromParent();
      } else {
        opts.signal?.addEventListener("abort", abortFromParent, { once: true });
      }
      const journal = makeJournal(
        controller.signal,
        () => admissionOpen,
      );
      const result: WorkflowResult = { status: "done", phases: journal.phases, actorSpawns: journal.actorSpawns };
      const sandbox = makeSandbox({
        opts,
        signal: controller.signal,
        hostOperations,
        isAdmissionOpen: () => admissionOpen,
      });
      const deadline = Math.max(
        1,
        Math.floor(opts.deadlineMs ?? 12 * 60 * 60 * 1000),
      );
      let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
      let value: unknown;
      let failure: unknown;
      try {
        if (!controller.signal.aborted) {
          deadlineTimer = setTimeout(() => {
            if (controller.signal.aborted) return;
            terminalReason = "deadline_exceeded";
            controller.abort(
              new Error(`Workflow deadline exceeded after ${deadline}ms.`),
            );
          }, deadline);
          value = await fn(args, sandbox, journal);
        } else {
          failure = controller.signal.reason;
        }
      } catch (error) {
        failure = error;
      } finally {
        admissionOpen = false;
        await drainHostOperations(hostOperations);
        if (deadlineTimer) clearTimeout(deadlineTimer);
        opts.signal?.removeEventListener("abort", abortFromParent);
      }

      if (terminalReason) {
        result.status = terminalReason;
        result.error = errorMessage(controller.signal.reason);
        closeRunningPhases(journal.phases, "error");
      } else if (failure !== undefined) {
        result.status = "error";
        result.error = errorMessage(failure);
        closeRunningPhases(journal.phases, "error");
      } else {
        result.value = value;
        result.status = "done";
        closeRunningPhases(journal.phases, "done");
      }
      return result;
    },
  };
}

export function createWorkflowActorHostHook(
  runtime: Pick<ActorRuntime, "spawn" | "wait" | "cancel">,
): WorkflowHostHooks["spawnActor"] {
  return async (input, options) => {
    throwIfWorkflowAborted(options.signal);
    const handle = runtime.spawn(input);
    const cancelFromWorkflow = () => {
      runtime.cancel(handle.actorId, errorMessage(options.signal.reason));
    };
    if (options.signal.aborted) {
      cancelFromWorkflow();
    } else {
      options.signal.addEventListener("abort", cancelFromWorkflow, {
        once: true,
      });
    }
    try {
      const outcome = await runtime.wait(handle.actorId);
      throwIfWorkflowAborted(options.signal);
      return outcome;
    } finally {
      options.signal.removeEventListener("abort", cancelFromWorkflow);
    }
  };
}

async function drainHostOperations(
  hostOperations: Set<Promise<unknown>>,
): Promise<void> {
  while (hostOperations.size > 0) {
    await Promise.allSettled([...hostOperations]);
  }
}

function throwIfWorkflowAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) {
    throw signal.reason;
  }
  throw new DOMException("Workflow canceled.", "AbortError");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

function closeRunningPhases(
  phases: WorkflowPhase[],
  status: Extract<WorkflowPhase["status"], "done" | "error">,
) {
  const endedAt = new Date().toISOString();
  for (const phase of phases) {
    if (phase.status === "running") {
      phase.status = status;
      phase.endedAt = endedAt;
    }
  }
}
