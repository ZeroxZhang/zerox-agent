// ToolWorker (contracts v1.4 §3.3, Exit Criteria for P5/P6).
//
// `inproc` mode runs registered handlers in the current process. `subprocess`
// mode is an available isolation transport for handlers explicitly registered
// in the worker entrypoint; callers must not infer that every tool is isolated
// merely because this infrastructure exists.

import { fork } from "node:child_process";
import path from "node:path";
import type { ToolHandler, ToolResult, WorkerRequest, WorkerResponse, WorkerRunContext } from "./toolWorkerProtocol";

export interface ToolWorker {
  execute(toolName: string, args: unknown, ctx: Omit<WorkerRunContext, "toolName" | "args"> & {
    toolName?: string;
    args?: unknown;
  }): Promise<ToolResult>;
  close(): Promise<void>;
}

export interface CreateToolWorkerOptions {
  mode: "inproc" | "subprocess";
  /** Handlers for inproc mode. Subprocess handlers live in the worker entrypoint. */
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
    async close() {
      /* no-op for inproc */
    },
  };
}

function createSubprocessWorker(options: CreateToolWorkerOptions): ToolWorker {
  const entryModulePath = options.entryModulePath ?? defaultEntryPath();
  const timeoutMs = options.timeoutMs ?? 300_000;
  let child: import("node:child_process").ChildProcess | null = null;
  const pending = new Map<string, {
    proc: import("node:child_process").ChildProcess;
    resolve: (r: ToolResult) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  let counter = 0;

  function ensureChild(): import("node:child_process").ChildProcess {
    if (child && !child.killed) return child;
    const spawned = fork(entryModulePath, [], { stdio: ["inherit", "inherit", "inherit", "ipc"] });
    child = spawned;
    spawned.on("message", (msg: WorkerResponse) => {
      if (msg.kind !== "result") return;
      const entry = pending.get(msg.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(msg.id);
      if (msg.ok) entry.resolve({ ok: true, result: msg.result });
      else entry.resolve({ ok: false, error: msg.error });
    });
    spawned.on("exit", () => {
      if (child === spawned) {
        child = null;
      }
      for (const [id, entry] of pending) {
        if (entry.proc !== spawned) continue;
        clearTimeout(entry.timer);
        entry.reject(new Error("tool worker subprocess exited"));
        pending.delete(id);
      }
    });
    return spawned;
  }

  function retireChild(proc: import("node:child_process").ChildProcess): void {
    if (child === proc) {
      child = null;
    }
    let exited = false;
    proc.once("exit", () => {
      exited = true;
    });
    if (!proc.killed) {
      proc.kill("SIGTERM");
    }
    const forceKillTimer = setTimeout(() => {
      if (!exited) {
        proc.kill("SIGKILL");
      }
    }, 1000);
    forceKillTimer.unref?.();
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
          retireChild(proc);
          resolve({ ok: false, error: `tool worker timed out after ${timeoutMs}ms` });
        }, timeoutMs);
        pending.set(id, { proc, resolve, reject, timer });
        try {
          proc.send(req);
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          resolve({ ok: false, error: `tool worker send failed: ${String(error)}` });
        }
      });
    },
    async close() {
      if (!child) return;
      const closingChild = child;
      child = null;
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(forceKill);
          resolve();
        };
        closingChild.once("exit", finish);
        const forceKill = setTimeout(() => {
          if (!closingChild.killed) closingChild.kill("SIGKILL");
          finish();
        }, 1000);
        forceKill.unref?.();
        try {
          closingChild.send({ kind: "shutdown" } satisfies WorkerRequest);
        } catch {
          closingChild.kill();
        }
      });
    },
  };
}

function defaultEntryPath(): string {
  // Compiled entry lives next to this module in dist-electron.
  return path.join(__dirname, "toolWorkerEntry.js");
}
