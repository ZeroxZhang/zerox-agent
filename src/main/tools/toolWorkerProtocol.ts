// ToolWorker IPC protocol (contracts v1.4 §3.3, Exit Criteria for P5/P6).
//
// Side-effect tools execute out-of-process via child_process.fork. The parent
// (main process) holds only the result. This module defines the serializable
// IPC envelope and the `WorkerRunContext` — the subset of `AgentRunContext`
// injected by the parent so the child has no access to main-process singletons.
//
// Contract §3.3 lists the IPC payload as `(toolName, args, sandboxPolicy)`; per
// spec Q3 / Patch 5 we extend it to `WorkerRunContext` carrying `workspaceRoot`
// and provenance identity (side-effect tools need them to land artifacts).

import type { AgentSandboxPolicy } from "../../shared/agentWorkspace";

export interface WorkerRunContext {
  toolName: string;
  args: unknown;
  sandboxPolicy: AgentSandboxPolicy;
  workspaceRoot: string; // cwd / artifact root
  provenanceIdentity?: { runId: string; goalId?: string; milestoneId?: string };
  runId: string;
}

export type WorkerRequest =
  | { kind: "execute"; id: string; ctx: WorkerRunContext }
  | { kind: "ping"; id: string }
  | { kind: "shutdown" };

export type WorkerResponse =
  | { kind: "result"; id: string; ok: true; result: unknown }
  | { kind: "result"; id: string; ok: false; error: string };

export type WorkerMessage = WorkerRequest | WorkerResponse;

/** A tool handler that runs inside the worker (inproc or subprocess). */
export type ToolHandler = (
  args: unknown,
  ctx: WorkerRunContext,
) => Promise<unknown>;

export interface ToolResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}
