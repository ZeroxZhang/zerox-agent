// ToolWorker (contracts v1.4 §3.3, Exit Criteria for P5/P6).
//
// Side-effect tools execute out-of-process. `inproc` mode runs handlers in the
// current process (zero-overhead, the safe default during migration); `subprocess`
// mode forks `toolWorkerEntry` and round-trips requests over IPC. The parent
// holds only the result. P5 (checkpoint-writer fork agent) and P6 (actor
// isolation) reuse this fork/IPC base instead of managing their own subprocesses.

import { fork } from "node:child_process";
import path from "node:path";
import type { ToolHandler, ToolResult, WorkerRequest, WorkerResponse, WorkerRunContext } from "./toolWorkerProtocol";

export interface ToolWorker {
  execute(toolName: string, args: unknown, ctx: Omit<WorkerRunContext, "toolName" | "args"> & {
    toolName?: string;
    args?: unknown;
  }): Promise<ToolResult>;
  close(): void;
}

export interface CreateToolWorkerOptions {
  mode: "inproc" | "subprocess";
  /** Handlers for inproc mode (and the registry subprocess mode delegates to). */
  handlers?: Record<string, ToolHandler>;
  /** Path to the subprocess entry module (subprocess mode). */
  entryModulePath?: string;
  /** Per-request timeout ms (subprocess mode). */
  timeoutMs?: number;
}

export function createToolWorker(options: CreateToolWorkerOptions): ToolWorker {
  if (options.mode === "inproc") {
    return createInprocWorker(options.handlers ?? {});
  }
  return createSubprocessWorker(options);
}

function createInprocWorker(handlers: Record<string, ToolHandler>): ToolWorker {
  return {
    async execute(toolName, args, ctx) {
      const handler = handlers[toolName];
      if (!handler) {
        return { ok: false, error: `no handler registered for tool "${toolName}"` };
      }
      const workerCtx: WorkerRunContext = {
        toolName,
        args,
        sandboxPolicy: ctx.sandboxPolicy,
        workspaceRoot: ctx.workspaceRoot,
        ...(ctx.provenanceIdentity ? { provenanceIdentity: ctx.provenanceIdentity } : {}),
        runId: ctx.runId,
      };
      try {
        const result = await handler(args, workerCtx);
        return { ok: true, result };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },
    close() {
      /* no-op for inproc */
    },
  };
}

function createSubprocessWorker(options: CreateToolWorkerOptions): ToolWorker {
  const entryModulePath = options.entryModulePath ?? defaultEntryPath();
  const timeoutMs = options.timeoutMs ?? 300_000;
  let child: import("node:child_process").ChildProcess | null = null;
  const pending = new Map<string, { resolve: (r: ToolResult) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  let counter = 0;

  function ensureChild(): import("node:child_process").ChildProcess {
    if (child && !child.killed) return child;
    child = fork(entryModulePath, [], { stdio: ["inherit", "inherit", "inherit", "ipc"] });
    child.on("message", (msg: WorkerResponse) => {
      if (msg.kind !== "result") return;
      const entry = pending.get(msg.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(msg.id);
      if (msg.ok) entry.resolve({ ok: true, result: msg.result });
      else entry.resolve({ ok: false, error: msg.error });
    });
    child.on("exit", () => {
      child = null;
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error("tool worker subprocess exited"));
      }
      pending.clear();
    });
    return child;
  }

  return {
    async execute(toolName, args, ctx) {
      const id = `req-${++counter}`;
      const proc = ensureChild();
      const workerCtx: WorkerRunContext = {
        toolName,
        args,
        sandboxPolicy: ctx.sandboxPolicy,
        workspaceRoot: ctx.workspaceRoot,
        ...(ctx.provenanceIdentity ? { provenanceIdentity: ctx.provenanceIdentity } : {}),
        runId: ctx.runId,
      };
      const req: WorkerRequest = { kind: "execute", id, ctx: workerCtx };
      return new Promise<ToolResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, error: `tool worker timed out after ${timeoutMs}ms` });
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        proc.send(req);
      });
    },
    close() {
      if (child) {
        child.send({ kind: "shutdown" } satisfies WorkerRequest);
        setTimeout(() => child?.kill(), 1000);
      }
    },
  };
}

function defaultEntryPath(): string {
  // Compiled entry lives next to this module in dist-electron.
  return path.join(__dirname, "toolWorkerEntry.js");
}
