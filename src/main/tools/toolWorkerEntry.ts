// ToolWorker subprocess entry (contracts v1.4 §3.3).
//
// Loaded via `child_process.fork` by `toolWorkerHost`. Receives `WorkerRequest`
// IPC messages, dispatches to a registered handler map, and returns
// `WorkerResponse`. NEVER imports main-process singletons — the parent injects
// `WorkerRunContext` (workspaceRoot, sandbox, provenance identity, runId).
//
// This module is the template P5/P6 actor entries extend: same IPC envelope,
// same handler-registration shape, no main-process coupling.

import type { ToolHandler, WorkerRequest, WorkerResponse } from "./toolWorkerProtocol";

// Handler registry. P5/P6 (and P4's side-effect tools) register handlers here.
const handlers = new Map<string, ToolHandler>();

export function registerToolHandler(name: string, handler: ToolHandler): void {
  handlers.set(name, handler);
}

export function clearToolHandlers(): void {
  handlers.clear();
}

// Built-in echo handler (used by tests to verify the IPC round-trip without
// pulling in real tool implementations).
registerToolHandler("echo", async (args) => ({ echoed: args }));

async function handleRequest(req: WorkerRequest): Promise<void> {
  if (req.kind === "ping") {
    if (process.send) process.send({ kind: "result", id: req.id, ok: true, result: "pong" } satisfies WorkerResponse);
    return;
  }
  if (req.kind === "shutdown") {
    process.exit(0);
  }
  if (req.kind === "execute") {
    const { toolName, args, ...rest } = req.ctx;
    const handler = handlers.get(toolName);
    if (!handler) {
      if (process.send) process.send({ kind: "result", id: req.id, ok: false, error: `no handler for "${toolName}"` } satisfies WorkerResponse);
      return;
    }
    try {
      const result = await handler(args, { toolName, args, ...rest });
      if (process.send) process.send({ kind: "result", id: req.id, ok: true, result } satisfies WorkerResponse);
    } catch (error) {
      if (process.send) process.send({ kind: "result", id: req.id, ok: false, error: String(error) } satisfies WorkerResponse);
    }
  }
}

if (process.send) {
  process.on("message", (msg: WorkerRequest) => {
    void handleRequest(msg);
  });
}
