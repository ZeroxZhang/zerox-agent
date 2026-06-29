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
    switch (op) {
      case "run":
      case "spawn": {
        const task = String(args.task ?? "");
        if (!task) return { ok: false, error: "task required for run/spawn" };
        const parentRunId = deriveParentRunId(options);
        const handle = runtime.spawn({
          contextMode: (args.contextMode as ActorContextMode) ?? "state",
          lifecycle: "ephemeral",
          task,
          ...(parentRunId ? { parentRunId } : {}),
          ...(args.background !== undefined ? { background: Boolean(args.background) } : {}),
          ...(Array.isArray(args.toolWhitelist) ? { toolWhitelist: args.toolWhitelist as string[] } : {}),
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
        return { ok: true, result: { actorId, status: runtime.status(actorId) } };
      }
      case "wait": {
        const actorId = String(args.actorId ?? "");
        if (!actorId) return { ok: false, error: "actorId required" };
        const outcome = await runtime.wait(actorId);
        if (outcome.status !== "done") {
          return actorTerminalFailureResult(actorId, outcome);
        }
        return { ok: true, result: { actorId, ...outcome } };
      }
      case "cancel": {
        const actorId = String(args.actorId ?? "");
        if (!actorId) return { ok: false, error: "actorId required" };
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
        runtime.send?.(actorId, args.message, undefined);
        return { ok: true, result: { actorId, sent: true } };
      }
      default:
        return { ok: false, error: `unknown op "${op}"` };
    }
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
