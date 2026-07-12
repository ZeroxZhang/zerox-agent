// actor tool (contracts v1.4 §5, P6 activation).
//
// Exposes actor spawn/wait/status/cancel/send to the model via the
// DynamicToolRegistry. operation: run | spawn | status | wait | cancel | send.
// Registered under source "builtin:actor".

import type { ToolDefinition } from "../openAiCompatibleClient";
import type { DynamicToolRegistry, ToolHandler } from "../dynamicToolRegistry";
import type { ToolExecutionOptions } from "../dynamicToolRegistry";
import type { ActorRuntime } from "./actorRuntime";
import type { ActorContextMode, ActorOutcome } from "./actorRuntime";

export const ACTOR_TOOL_NAME = "actor";

export const actorToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: ACTOR_TOOL_NAME,
    description:
      "Spawn or control a sub-agent actor. op: run (spawn+wait, returns outcome), spawn (returns actorId), status, wait, cancel, send.",
    parameters: {
      type: "object",
      properties: {
        op: { type: "string", enum: ["run", "spawn", "status", "wait", "cancel", "send"] },
        task: { type: "string", description: "task instruction (run/spawn)" },
        actorId: { type: "string", description: "actor id (status/wait/cancel/send)" },
        contextMode: { type: "string", enum: ["none", "state", "full"], description: "default state" },
        background: { type: "boolean" },
        message: { description: "message payload (send)" },
        toolWhitelist: { type: "array", items: { type: "string" } },
      },
      required: ["op"],
    },
  },
};

export interface ActorToolDeps {
  actorRuntime: ActorRuntime;
}

export function createActorToolHandler(deps: ActorToolDeps): ToolHandler {
  return async (args, options) => {
    const op = String(args.op ?? "");
    const runtime = deps.actorRuntime;
    const parentRunId = deriveParentRunId(options);
    switch (op) {
      case "run":
      case "spawn": {
        const task = String(args.task ?? "");
        if (!task) return { ok: false, error: "task required for run/spawn" };
        if (!parentRunId) {
          return { ok: false, error: "actor operations require a parent run context" };
        }
        // A pre-aborted request must fail before ActorRuntime synchronously
        // enters runActor; otherwise even a canceled call can execute a
        // side-effecting synchronous prefix.
        const lifecycleSignal = op === "spawn"
          ? (options?.parentSignal ?? options?.signal)
          : options?.signal;
        if (lifecycleSignal?.aborted) {
          return { ok: false, error: "actor operation aborted before spawn" };
        }
        const handle = runtime.spawn({
          contextMode: (args.contextMode as ActorContextMode) ?? "state",
          lifecycle: "ephemeral",
          task,
          ...(parentRunId ? { parentRunId } : {}),
          ...(args.background !== undefined ? { background: Boolean(args.background) } : {}),
          ...(Array.isArray(args.toolWhitelist) ? { toolWhitelist: args.toolWhitelist as string[] } : {}),
        });
        // A spawned actor outlives this tool invocation, so bind it to the
        // parent run. Foreground `run` must instead honor the executor's
        // combined signal, which includes both parent cancellation and the
        // per-tool deadline.
        const cancelFromParent = () =>
          runtime.cancel(handle.actorId, "parent tool execution aborted");
        if (lifecycleSignal?.aborted) {
          cancelFromParent();
        } else {
          lifecycleSignal?.addEventListener("abort", cancelFromParent, { once: true });
        }
        void handle.outcome.finally(() => {
          lifecycleSignal?.removeEventListener("abort", cancelFromParent);
        });
        options?.onRuntimeEvent?.({
          type: "actor_spawned",
          actorId: handle.actorId,
          task,
          status: "running",
        });
        if (op === "spawn") {
          return { ok: true, result: { actorId: handle.actorId } };
        }
        const outcome = await runtime.wait(handle.actorId);
        if (outcome.status !== "done") {
          return actorTerminalFailureResult(handle.actorId, outcome);
        }
        return { ok: true, result: { actorId: handle.actorId, ...outcome } };
      }
      case "status": {
        const actorId = String(args.actorId ?? "");
        if (!actorId) return { ok: false, error: "actorId required" };
        if (!runtime.isOwnedBy(actorId, parentRunId)) return actorOwnershipFailure();
        return { ok: true, result: { actorId, status: runtime.status(actorId) } };
      }
      case "wait": {
        const actorId = String(args.actorId ?? "");
        if (!actorId) return { ok: false, error: "actorId required" };
        if (!runtime.isOwnedBy(actorId, parentRunId)) return actorOwnershipFailure();
        // Waiting is a foreground tool operation and must stop on its own
        // timeout as well as on parent-run cancellation.
        const lifecycleSignal = options?.signal;
        const cancelFromParent = () =>
          runtime.cancel(actorId, "parent tool execution aborted while waiting");
        if (lifecycleSignal?.aborted) {
          cancelFromParent();
        } else {
          lifecycleSignal?.addEventListener("abort", cancelFromParent, { once: true });
        }
        const outcome = await runtime.wait(actorId).finally(() => {
          lifecycleSignal?.removeEventListener("abort", cancelFromParent);
        });
        if (outcome.status !== "done") {
          return actorTerminalFailureResult(actorId, outcome);
        }
        return { ok: true, result: { actorId, ...outcome } };
      }
      case "cancel": {
        const actorId = String(args.actorId ?? "");
        if (!actorId) return { ok: false, error: "actorId required" };
        if (!runtime.isOwnedBy(actorId, parentRunId)) return actorOwnershipFailure();
        const reason = String(args.reason ?? "canceled by model");
        runtime.cancel(actorId, reason);
        return actorTerminalFailureResult(actorId, {
          status: "canceled",
          summary: reason,
          filesTouched: [],
        });
      }
      case "send": {
        const actorId = String(args.actorId ?? "");
        if (!actorId) return { ok: false, error: "actorId required" };
        if (!runtime.isOwnedBy(actorId, parentRunId)) return actorOwnershipFailure();
        runtime.send?.(actorId, args.message, undefined);
        return { ok: true, result: { actorId, sent: true } };
      }
      default:
        return { ok: false, error: `unknown op "${op}"` };
    }
  };
}

function actorOwnershipFailure() {
  return {
    ok: false as const,
    error: "actor handle is unknown or not owned by the current run",
  };
}

function deriveParentRunId(options: ToolExecutionOptions | undefined): string {
  return options?.runContext?.runId ?? options?.runContext?.parentRunId ?? "";
}

function actorTerminalFailureResult(actorId: string, outcome: ActorOutcome) {
  return {
    ok: false as const,
    error: outcome.summary || `Actor execution ${outcome.status}.`,
    errorDetails: {
      actorId,
      status: outcome.status,
      summary: outcome.summary,
      filesTouched: outcome.filesTouched,
    },
  };
}

export function registerActorTool(
  registry: DynamicToolRegistry,
  deps: ActorToolDeps,
): void {
  registry.register(actorToolDefinition, createActorToolHandler(deps), "builtin:actor");
}
