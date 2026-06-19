// registerWorkflowAsSkill placeholder (contracts v1.4 §6 Patch 24, P6 exit for P7).
//
// P6 exposes the signature so P7's distill can package a repeated manual workflow
// as a skill. P6 does NOT implement it (the spec's O7 defers the body to P7 to
// avoid P6 bloat). Calling it throws a clear "not implemented" until P7 lands.

import type { WorkflowRuntime } from "./workflowRuntime";

export interface SkillMeta {
  name: string;
  displayName: string;
  description: string;
  mode: "agent" | "script";
  agentPrompt?: string;
  workflowScript?: string;
  permissions: Record<string, unknown>;
  tools?: string[];
  sourceRunIds: string[];
}

export interface RegisterWorkflowAsSkillResult {
  skillId: string;
  skillPath: string;
  workflowId: string;
}

export function registerWorkflowAsSkill(
  _workflowRuntime: WorkflowRuntime,
  _workflowName: string,
  _skillMeta: SkillMeta,
): Promise<RegisterWorkflowAsSkillResult> {
  // P6 placeholder — P7 distill implements (spec O7).
  throw new Error("registerWorkflowAsSkill: not implemented in P6 (lands in P7 distill)");
}
