// P6 feature flags (contracts v1.4 §5/§6, Patch 7).

export type ActorRuntimeMode = "full" | "v0" | "legacy";
export type WorkflowRuntimeMode = "on" | "off";

export interface ActorWorkflowOptions {
  actorRuntime: ActorRuntimeMode;
  workflowRuntime: WorkflowRuntimeMode;
}

export function getActorWorkflowOptions(
  env: NodeJS.ProcessEnv = process.env,
): ActorWorkflowOptions {
  return {
    actorRuntime: resolveActorRuntime(env),
    workflowRuntime: resolveWorkflowRuntime(env),
  };
}

function resolveActorRuntime(env: NodeJS.ProcessEnv): ActorRuntimeMode {
  const raw = (env.ZEROX_ACTOR_RUNTIME ?? "").toLowerCase();
  if (raw === "v0") return "v0";
  if (raw === "legacy") return "legacy";
  return "full"; // default once P6 has landed (spec D4)
}

function resolveWorkflowRuntime(env: NodeJS.ProcessEnv): WorkflowRuntimeMode {
  const raw = (env.ZEROX_WORKFLOW_RUNTIME ?? "").toLowerCase();
  if (raw === "off") return "off";
  return "on";
}
