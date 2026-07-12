// P6 feature flags (contracts v1.4 §5/§6, Patch 7).

import { readFeatureFlags } from "../../shared/featureFlags";

export type ActorRuntimeMode = "full" | "v0" | "legacy";
export type WorkflowRuntimeMode = "on" | "off";

export interface ActorWorkflowOptions {
  actorRuntime: ActorRuntimeMode;
  workflowRuntime: WorkflowRuntimeMode;
}

export function getActorWorkflowOptions(
  env: NodeJS.ProcessEnv = process.env,
): ActorWorkflowOptions {
  const flags = readFeatureFlags(env);
  return {
    actorRuntime: flags.ZEROX_ACTOR_RUNTIME,
    workflowRuntime: flags.ZEROX_WORKFLOW_RUNTIME,
  };
}
