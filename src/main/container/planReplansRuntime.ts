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

import type { PlanOpsRuntime } from "./planOps";

export type PlanReplansRuntime = PlanOpsRuntime;

export function createPlanReplansRuntime(rt: PlanReplansRuntime) {
  const agentGoalStore = rt.agentGoalStore;
  const goalChatService = rt.goalChatService;
  const planDebateOrchestrator = rt.planDebateOrchestrator;
  const planStore = rt.planStore;
  const agentWorkspaceService = rt.agentWorkspaceService;
  const serializeGoalReplan = rt.serializeGoalReplan;
  const runGoalOperation = rt.runGoalOperation;
  const runtimeShuttingDown = rt.runtimeShuttingDown;

  type RuntimeGoalPlanOptions = {
    amendmentId?: string;
    goalContractSnapshot?: GoalContractSnapshot;
    goalContractRef?: GoalContractRef;
  };
  function createRuntimeGoalPlan(
    goalId: string,
    instructions: string,
    runtimeOptions?: RuntimeGoalPlanOptions,
  ): Promise<CreateRuntimeGoalPlanResult> {
    return serializeGoalReplan(goalId, () =>
      createRuntimeGoalPlanAccepted(goalId, instructions, runtimeOptions),
    );
  }
  async function createRuntimeGoalPlanAccepted(
    goalId: string,
    instructions: string,
    runtimeOptions?: RuntimeGoalPlanOptions,
  ): Promise<CreateRuntimeGoalPlanResult> {
    if (runtimeShuttingDown()) {
      return { ok: false, message: "应用正在退出，未创建运行期 Plan。" };
    }
    const requestedChange = instructions.trim();
    if (!requestedChange) {
      return { ok: false, message: "调整计划的说明不能为空。" };
    }
    try {
      let goal = await agentGoalStore().get(goalId);
      if (!goal) return { ok: false, message: "目标不存在。" };
      if (goal.status === "achieved" || goal.status === "canceled") {
        return { ok: false, message: `已 ${goal.status} 的目标不能调整计划。` };
      }
      if (!goal.goalContractSnapshot || !goal.goalContractRef) {
        return { ok: false, message: "目标缺少可验证的 GoalContract。" };
      }
      if (
        !runtimeOptions?.amendmentId &&
        (goal.pendingGoalAmendment?.status === "pending" ||
          goal.pendingGoalAmendment?.status === "approved")
      ) {
        return {
          ok: false,
          message: "Goal 存在待处理的目标修订，请先完成或撤销修订。",
        };
      }
      const canonicalGoalId = goal.id;
      const amendment = runtimeOptions?.amendmentId
        ? goal.pendingGoalAmendment
        : undefined;
      if (runtimeOptions?.amendmentId) {
        if (
          !amendment ||
          amendment.id !== runtimeOptions.amendmentId ||
          amendment.status !== "approved" ||
          amendment.baseContractRef.sha256 !== goal.goalContractRef.sha256 ||
          amendment.candidateContractRef.sha256 !==
            runtimeOptions.goalContractRef?.sha256 ||
          amendment.candidateContractRef.revision !==
            runtimeOptions.goalContractRef?.revision
        ) {
          return {
            ok: false,
            message: "目标修订状态已变化，不能基于过期契约生成 Plan。",
          };
        }
      }
      const currentGoalContractRef = structuredClone(goal.goalContractRef);
      const goalContractSnapshot = structuredClone(
        runtimeOptions?.goalContractSnapshot ?? goal.goalContractSnapshot,
      );
      const goalContractRef = structuredClone(
        runtimeOptions?.goalContractRef ?? goal.goalContractRef,
      );
      const parentPlanId =
        goal.activePlanRef?.planId ?? goal.sourcePlanRef?.planId;
      const parentPlan = parentPlanId
        ? await planStore().get(parentPlanId)
        : null;
      if (!parentPlan && goal.activePlanRef?.mode !== "legacy") {
        return { ok: false, message: "当前目标缺少可追溯的活动 Plan。" };
      }
      const inheritedProfileId = parentPlan
        ? selectRuntimeDirectProfileId(parentPlan, goal)
        : goal.executionModelBinding?.profileId;
      if (!inheritedProfileId) {
        return {
          ok: false,
          message: "无法解析运行期 Direct 综合模型；未静默切换其他模型。",
        };
      }
      if (goal.status === "executing") {
        const paused = await runGoalOperation(
          canonicalGoalId,
          () => goalChatService().pause(canonicalGoalId),
          { preempt: true },
        );
        if (!paused.ok) {
          return { ok: false, message: paused.message ?? "无法暂停当前目标。" };
        }
        goal = (await agentGoalStore().get(canonicalGoalId)) ?? goal;
      }
      const ledger = await agentGoalStore().readLedger(goal.id);
      let workspaceRoot: string | undefined = parentPlan?.workspaceRoot;
      if (!workspaceRoot) {
        try {
          const resolvedRunContext = await agentWorkspaceService().resolveRunContext({
            workspaceId: goal.workspaceId,
            ...(goal.chatSessionId ? { sessionId: goal.chatSessionId } : {}),
          });
          workspaceRoot = resolvedRunContext?.workspaceRoot ?? undefined;
        } catch {
          workspaceRoot = undefined;
        }
      }
      const createdAt = new Date().toISOString();
      const feedbackEvidence = [
        {
          id: "evidence_goal_runtime_state",
          kind: "user" as const,
          title: "Current Goal runtime state",
          summary: JSON.stringify({
            status: goal.status,
            stopReason: goal.stopReason,
            planVersion: goal.planVersion,
            milestones: goal.milestones.map((milestone) => ({
              id: milestone.id,
              state: milestone.state,
              attempts: milestone.attempts,
              lastAcceptanceSummary: milestone.lastAcceptanceSummary,
            })),
          }).slice(0, 24_000),
          sha256: createHash("sha256")
            .update(JSON.stringify(goal.milestones))
            .digest("hex"),
        },
        {
          id: "evidence_goal_ledger",
          kind: "user" as const,
          title: "Recent Goal ledger",
          summary: JSON.stringify(ledger.slice(-40)).slice(0, 32_000),
          sha256: createHash("sha256")
            .update(JSON.stringify(ledger.slice(-40)))
            .digest("hex"),
        },
        {
          id: "evidence_parent_plan_outcome",
          kind: "user" as const,
          title: "Parent Plan outcome",
          summary: JSON.stringify({
            id: parentPlan?.id ?? goal.activePlanRef?.planId,
            mode: parentPlan?.mode ?? "legacy",
            status: parentPlan?.status ?? "legacy_compacted",
            qualityReport: parentPlan?.qualityReport,
            finalArtifact: parentPlan?.finalArtifact,
          }).slice(0, 32_000),
          sha256: createHash("sha256")
            .update(
              JSON.stringify({
                status: parentPlan?.status ?? "legacy_compacted",
                qualityReport: parentPlan?.qualityReport,
                finalArtifact: parentPlan?.finalArtifact,
              }),
            )
            .digest("hex"),
        },
      ];
      const parentPlanRef: GoalPlanRef = goal.activePlanRef
        ? structuredClone(goal.activePlanRef)
        : {
            planId: parentPlan!.id,
            planRevision: parentPlan!.revision,
            goalPlanVersion: goal.planVersion,
            mode: parentPlan!.mode,
            purpose: parentPlan!.purpose ?? "initial",
            goalContractRef: currentGoalContractRef,
          };
      const existingCandidate = (await planStore().listBySession(
        goal.chatSessionId ?? parentPlan?.sessionId ?? goal.id,
      )).find(
        (candidate) =>
          candidate.purpose === "runtime_replan" &&
          candidate.goalId === goal.id &&
          candidate.parentPlanRef?.planId === parentPlanRef.planId &&
          candidate.goalPlanVersion === goal.planVersion + 1 &&
          candidate.goalContractRef?.sha256 === goalContractRef.sha256 &&
          candidate.trigger?.summary === requestedChange &&
          candidate.status !== "discarded" &&
          candidate.status !== "superseded",
      );
      if (existingCandidate) {
        await recordGoalPlanCandidate(
          existingCandidate,
          runtimeOptions?.amendmentId,
        );
        return {
          ok: true,
          plan: existingCandidate,
          message: "已存在同一契约和反馈生成的运行期 Direct Plan。",
        };
      }
      const plan = await planDebateOrchestrator().createPlan({
        sessionId: goal.chatSessionId ?? parentPlan?.sessionId ?? goal.id,
        ...(goal.workspaceId ? { workspaceId: goal.workspaceId } : {}),
        ...(workspaceRoot ? { workspaceRoot } : {}),
        sourceMessage: `调整当前 Goal 的执行路径：${requestedChange}`,
        mode: "direct",
        autonomyMode: parentPlan?.autonomyMode,
        modelAssignments: { direct: inheritedProfileId },
        purpose: "runtime_replan",
        goalId: goal.id,
        parentPlanRef,
        goalPlanVersion: goal.planVersion + 1,
        goalContractSnapshot,
        goalContractRef,
        trigger: {
          kind: amendment ? "goal_amendment" : "user_adjustment",
          summary: requestedChange,
          evidenceRefs: feedbackEvidence.map((item) => item.id),
          at: createdAt,
        },
        feedbackEvidence,
      });
      await recordGoalPlanCandidate(plan, runtimeOptions?.amendmentId);
      await agentGoalStore().appendLedger(goal.id, {
        at: createdAt,
        kind: "goal_replanned",
        summary: `Created runtime Direct Plan ${plan.id} v${plan.goalPlanVersion}.`,
      });
      return {
        ok: true,
        plan,
        message: "已生成运行期 Direct Plan，采用前不会覆盖当前 Goal。",
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "无法生成运行期 Direct Plan。",
      };
    }
  }
  function toGoalPlanHistoryEntry(
    plan: PlanRecord,
    outcome: GoalPlanHistoryEntry["outcome"],
  ): GoalPlanHistoryEntry {
    if (
      !plan.goalContractRef ||
      !plan.parentPlanRef ||
      !plan.goalPlanVersion ||
      !plan.trigger
    ) {
      throw new Error("运行期 Plan 缺少可记录的 Goal 谱系字段。");
    }
    return {
      planId: plan.id,
      planRevision: plan.revision,
      goalPlanVersion: plan.goalPlanVersion,
      mode: plan.mode,
      purpose: plan.purpose ?? "runtime_replan",
      goalContractRef: structuredClone(plan.goalContractRef),
      parentPlanRef: structuredClone(plan.parentPlanRef),
      trigger: structuredClone(plan.trigger),
      outcome,
    };
  }
  async function recordGoalPlanCandidate(
    plan: PlanRecord,
    amendmentId?: string,
  ): Promise<void> {
    if (!plan.goalId) return;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const goal = await agentGoalStore().get(plan.goalId);
      if (!goal || goal.status === "achieved" || goal.status === "canceled") {
        return;
      }
      const entry = toGoalPlanHistoryEntry(plan, "candidate");
      const existingIndex = (goal.planHistory ?? []).findIndex(
        (candidate) => candidate.planId === plan.id,
      );
      const planHistory = [...(goal.planHistory ?? [])];
      if (existingIndex >= 0) {
        planHistory[existingIndex] = {
          ...planHistory[existingIndex]!,
          ...entry,
          outcome:
            planHistory[existingIndex]!.outcome === "active"
              ? "active"
              : "candidate",
        };
      } else {
        planHistory.push(entry);
      }
      const pendingGoalAmendment =
        amendmentId &&
        goal.pendingGoalAmendment?.id === amendmentId &&
        goal.pendingGoalAmendment.status === "approved"
          ? {
              ...goal.pendingGoalAmendment,
              candidatePlanId: plan.id,
            }
          : goal.pendingGoalAmendment;
      const saved = await agentGoalStore().saveIfPlanVersion(
        {
          ...goal,
          planHistory,
          ...(pendingGoalAmendment ? { pendingGoalAmendment } : {}),
          updatedAt: new Date().toISOString(),
        },
        goal.planVersion,
        goal.activePlanRef?.planId,
      );
      if (saved.saved) return;
    }
    throw new Error("Goal 状态持续变化，未能记录运行期 Plan 候选谱系。");
  }
  async function recordGoalPlanRejected(plan: PlanRecord): Promise<void> {
    if (!plan.goalId) return;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const goal = await agentGoalStore().get(plan.goalId);
      if (!goal || goal.activePlanRef?.planId === plan.id) return;
      const rejectedEntry = toGoalPlanHistoryEntry(plan, "rejected");
      const existingIndex = (goal.planHistory ?? []).findIndex(
        (candidate) => candidate.planId === plan.id,
      );
      const planHistory = [...(goal.planHistory ?? [])];
      if (existingIndex >= 0) {
        planHistory[existingIndex] = {
          ...planHistory[existingIndex]!,
          ...rejectedEntry,
          outcome: "rejected",
        };
      } else {
        planHistory.push(rejectedEntry);
      }
      let pendingGoalAmendment = goal.pendingGoalAmendment;
      if (
        pendingGoalAmendment?.status === "approved" &&
        pendingGoalAmendment.candidatePlanId === plan.id
      ) {
        const amendmentWithoutCandidate = structuredClone(
          pendingGoalAmendment,
        );
        delete amendmentWithoutCandidate.candidatePlanId;
        pendingGoalAmendment = amendmentWithoutCandidate;
      }
      const saved = await agentGoalStore().saveIfPlanVersion(
        {
          ...goal,
          planHistory,
          ...(pendingGoalAmendment ? { pendingGoalAmendment } : {}),
          updatedAt: new Date().toISOString(),
        },
        goal.planVersion,
        goal.activePlanRef?.planId,
      );
      if (saved.saved) return;
    }
  }

  return {
    createRuntimeGoalPlan,
    createRuntimeGoalPlanAccepted,
    toGoalPlanHistoryEntry,
    recordGoalPlanCandidate,
    recordGoalPlanRejected,
  };
}