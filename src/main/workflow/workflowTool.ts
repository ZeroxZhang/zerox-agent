// workflow tool (contracts v1.4 §6, P6 activation).
//
// Exposes workflow run/list to the model. operation: run (name+args) | list.
// Registered under source "builtin:workflow".

import type { ToolDefinition } from "../openAiCompatibleClient";
import type { DynamicToolRegistry, ToolHandler } from "../dynamicToolRegistry";
import type { WorkflowRuntime } from "./workflowRuntime";

export const WORKFLOW_TOOL_NAME = "workflow";

export const workflowToolDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: WORKFLOW_TOOL_NAME,
    description: "Run or list registered workflows (e.g. deep-research). op: run (name, args) | list.",
    parameters: {
      type: "object",
      properties: {
        op: { type: "string", enum: ["run", "list"] },
        name: { type: "string", description: "workflow name (run)" },
        args: { description: "workflow arguments (run)" },
        runId: { type: "string", description: "parent run id for journaling (run)" },
      },
      required: ["op"],
    },
  },
};

export interface WorkflowToolDeps {
  workflowRuntime: WorkflowRuntime;
}

export function createWorkflowToolHandler(deps: WorkflowToolDeps): ToolHandler {
  return async (args) => {
    const op = String(args.op ?? "");
    switch (op) {
      case "list":
        return { ok: true, result: { workflows: deps.workflowRuntime.list() } };
      case "run": {
        const name = String(args.name ?? "");
        if (!name) return { ok: false, error: "name required for run" };
        const result = await deps.workflowRuntime.run(name, args.args, {
          runId: String(args.runId ?? "workflow-run"),
        });
        return { ok: true, result: { status: result.status, ...(result.error ? { error: result.error } : {}), ...(result.value !== undefined ? { value: result.value } : {}), phases: result.phases.length, actorSpawns: result.actorSpawns.length } };
      }
      default:
        return { ok: false, error: `unknown op "${op}"` };
    }
  };
}

export function registerWorkflowTool(
  registry: DynamicToolRegistry,
  deps: WorkflowToolDeps,
): void {
  registry.register(workflowToolDefinition, createWorkflowToolHandler(deps), "builtin:workflow");
}
