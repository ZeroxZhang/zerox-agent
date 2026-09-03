import type { ProcessSandboxProvider } from "../processSandbox";
import { createHash, randomUUID } from "node:crypto";
import { GoalDraftConfirmResult } from "../../shared/goalTranslation";
import { GoalDraftEdit } from "../../shared/goalTranslation";
import { compileAgentTaskContract } from "../../shared/agentTaskContract";
import { milestoneDefinitionHash } from "./helpers";
import { AdoptGoalPlanResult } from "../../shared/planMode";
import { AdoptGoalPlanInput } from "../../shared/planMode";
import { createGoalContractRef } from "../goalPlanContractService";
import { isGoalContractSnapshot } from "../../shared/goalPlanContract";
import { GoalAmendmentOperationResult } from "../../shared/planMode";
import { ProposeGoalAmendmentInput } from "../../shared/planMode";
import { GoalPlanHistoryEntry } from "../../shared/goalPlanContract";
import { PlanRecord } from "../../shared/planMode";
import { GoalPlanRef } from "../../shared/goalPlanContract";
import { selectRuntimeDirectProfileId } from "../goalExecutionModel";
import { CreateRuntimeGoalPlanResult } from "../../shared/planMode";
import { GoalContractRef } from "../../shared/goalPlanContract";
import { GoalContractSnapshot } from "../../shared/goalPlanContract";
import { selectPlanExecutionModelBinding } from "../goalExecutionModel";
import { defaultSelectedSkillInputValues } from "./helpers";
import { GoalDraft } from "../../shared/goalTranslation";
import { buildGoalSuccessCriteriaFromPlan } from "./helpers";
import { validatePlanMilestoneGraph } from "../../shared/planValidation";
import { resolveSkillInput } from "../skillExecutionService";
import { discoverSkills } from "../skillRegistry";
import { verifySelectedSkillAuthority } from "../selectedSkillAuthority";
import { createPlanQualityReport } from "../plannerKernel";
import { PlanningStageKind } from "../../shared/planMode";
import { GoalSelectedSkill } from "../../shared/agentGoal";
import { verifyPlanEvidence } from "../planEvidenceVerifier";
import { derivePlanCriterionBindings } from "../plannerKernel";
import { isPlanConfirmable } from "../../shared/planMode";
import { planStatusForExecutionGoal } from "./helpers";
import { ConfirmPlanResult } from "../../shared/planMode";
import { ConfirmPlanInput } from "../../shared/planMode";
import { ChatSessionGoalSummary } from "../../shared/chat";
import type { Goal } from "../../shared/agentGoal";
import { createAgentGoalStore } from "../agentGoalStore";
import { createAgentGoalValidatorRegistry } from "../agentGoalValidatorRegistry";
import { createChatSessionStore } from "../chatSessionStore";
import { createGoalChatService } from "../goalChatService";
import { createGoalDraftService } from "../goalDraftService";
import { createPlanArtifactWriter } from "../planArtifactWriter";
import { createPlanDebateOrchestrator } from "../planDebateOrchestrator";
import { createPlanStore } from "../planStore";

import { createPlanAdoptionRuntime } from "./planAdoptionRuntime";
import { createPlanReplansRuntime } from "./planReplansRuntime";
import { createPlanAmendmentsRuntime } from "./planAmendmentsRuntime";

export type PlanOpsRuntime = {
  agentGoalStore: () => ReturnType<typeof createAgentGoalStore>;
  agentGoalValidatorRegistry: () => ReturnType<typeof createAgentGoalValidatorRegistry>;
  chatSessionStore: () => ReturnType<typeof createChatSessionStore>;
  goalChatService: () => ReturnType<typeof createGoalChatService>;
  goalDraftService: () => ReturnType<typeof createGoalDraftService>;
  planArtifactWriter: () => ReturnType<typeof createPlanArtifactWriter>;
  planDebateOrchestrator: () => ReturnType<typeof createPlanDebateOrchestrator>;
  planStore: () => ReturnType<typeof createPlanStore>;
  agentWorkspaceService: () => { resolveRunContext(input: { workspaceId?: string; sessionId?: string }): Promise<{ workspaceRoot?: string } | null>; };
  createToolExecutor: () => { getRegistry(): { getDefinitions(): Array<{ function: { name: string } }> }; };
  processSandboxProvider: () => ProcessSandboxProvider;
  serializePlanConfirmation: <T>(sessionId: string, operation: () => Promise<T>) => Promise<T>;
  serializeGoalReplan: <T>(goalId: string, operation: () => Promise<T>) => Promise<T>;
  serializeGoalAmendment: <T>(goalId: string, operation: () => Promise<T>) => Promise<T>;
  trackRuntimeInvocation: <T>(operation: () => Promise<T>) => Promise<T>;
  runGoalOperation: (goalId: string, operation: () => Promise<ChatSessionGoalSummary>, options?: { preempt?: boolean }) => Promise<{ ok: boolean; goal?: Goal; message?: string }>;
  skillsDir: string;
  runtimeShuttingDown: () => boolean;
  goalProgressDeliveryQueue: () => Promise<void>;
  setGoalProgressDeliveryQueue: (next: Promise<void>) => void;
};


export function createPlanOpsRuntime(rt: PlanOpsRuntime) {
  const adoption = createPlanAdoptionRuntime(
    rt as unknown as Parameters<typeof createPlanAdoptionRuntime>[0],
  );
  const replans = createPlanReplansRuntime(
    rt as unknown as Parameters<typeof createPlanReplansRuntime>[0],
  );
  const amendments = createPlanAmendmentsRuntime({
    ...rt,
    recordGoalPlanRejected: replans.recordGoalPlanRejected,
    createRuntimeGoalPlan: replans.createRuntimeGoalPlan,
  } as unknown as Parameters<typeof createPlanAmendmentsRuntime>[0]);
  return {
    confirmPlan: adoption.confirmPlan,
    createRuntimeGoalPlan: replans.createRuntimeGoalPlan,
    createRuntimeGoalPlanAccepted: replans.createRuntimeGoalPlanAccepted,
    toGoalPlanHistoryEntry: replans.toGoalPlanHistoryEntry,
    recordGoalPlanCandidate: replans.recordGoalPlanCandidate,
    recordGoalPlanRejected: replans.recordGoalPlanRejected,
    discardPlan: amendments.discardPlan,
    proposeGoalAmendment: amendments.proposeGoalAmendment,
    proposeGoalAmendmentAccepted: amendments.proposeGoalAmendmentAccepted,
    proposeGoalObjectiveAmendment: amendments.proposeGoalObjectiveAmendment,
    resolveGoalAmendment: amendments.resolveGoalAmendment,
    resolveGoalAmendmentAccepted: amendments.resolveGoalAmendmentAccepted,
    adoptGoalPlan: adoption.adoptGoalPlan,
    attachConfirmedPlanGoal: adoption.attachConfirmedPlanGoal,
    confirmGoalDraftAccepted: adoption.confirmGoalDraftAccepted,
  };
}