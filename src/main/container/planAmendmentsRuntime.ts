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

type RuntimeGoalPlanOptions = {
  amendmentId?: string;
  goalContractSnapshot?: GoalContractSnapshot;
  goalContractRef?: GoalContractRef;
};
export type PlanAmendmentsRuntime = PlanOpsRuntime & {
  recordGoalPlanRejected: (plan: PlanRecord) => Promise<void>;
  createRuntimeGoalPlan: (goalId: string, instructions: string, runtimeOptions?: RuntimeGoalPlanOptions) => Promise<CreateRuntimeGoalPlanResult>;
};

export function createPlanAmendmentsRuntime(rt: PlanAmendmentsRuntime) {
  const agentGoalStore = rt.agentGoalStore;
  const goalChatService = rt.goalChatService;
  const planDebateOrchestrator = rt.planDebateOrchestrator;
  const planStore = rt.planStore;
  const serializeGoalAmendment = rt.serializeGoalAmendment;
  const runGoalOperation = rt.runGoalOperation;

  async function discardPlan(planId: string, expectedRevision: number) {
    const result = await planDebateOrchestrator().discard(
      planId,
      expectedRevision,
    );
    if (result.ok && result.plan.purpose === "runtime_replan") {
      await rt.recordGoalPlanRejected(result.plan);
    }
    return result;
  }
  function proposeGoalAmendment(
    input: ProposeGoalAmendmentInput,
  ): Promise<GoalAmendmentOperationResult> {
    return serializeGoalAmendment(input.goalId, () =>
      proposeGoalAmendmentAccepted(input),
    );
  }
  async function proposeGoalAmendmentAccepted(
    input: ProposeGoalAmendmentInput,
  ): Promise<GoalAmendmentOperationResult> {
    let goal = await agentGoalStore().get(input.goalId);
    if (!goal) return { ok: false, message: "目标不存在。" };
    if (goal.status === "achieved" || goal.status === "canceled") {
      return { ok: false, message: "终态 Goal 不允许修改。" };
    }
    if (
      goal.pendingGoalAmendment?.status === "pending" ||
      goal.pendingGoalAmendment?.status === "approved"
    ) {
      return {
        ok: false,
        message: "当前 Goal 已有待处理的修订提案，请先批准、拒绝或撤销该提案。",
      };
    }
    if (!goal.goalContractRef || !isGoalContractSnapshot(input.candidateContract)) {
      return { ok: false, message: "候选 GoalContract 非法。" };
    }
    if (
      input.candidateContract.id !== goal.goalContractRef.id ||
      input.candidateContract.revision !== goal.goalContractRef.revision + 1
    ) {
      return { ok: false, message: "候选 GoalContract 必须基于当前契约递增一个 revision。" };
    }
    const pausedExecution = goal.status === "executing";
    if (pausedExecution) {
      const goalId = goal.id;
      const paused = await runGoalOperation(
        goalId,
        () => goalChatService().pause(goalId),
        { preempt: true },
      );
      if (!paused.ok || !paused.goal) {
        return {
          ok: false,
          message: paused.message ?? "创建目标修订前无法暂停当前 Goal。",
        };
      }
      goal = paused.goal;
      if (
        goal.goalContractRef?.id !== input.candidateContract.id ||
        goal.goalContractRef.revision + 1 !== input.candidateContract.revision
      ) {
        return {
          ok: false,
          message: "暂停 Goal 期间目标契约已变化，请基于最新状态重新提出修订。",
        };
      }
    }
    if (!goal.goalContractRef) {
      return {
        ok: false,
        message: "目标缺少可验证的当前 GoalContract 引用。",
      };
    }
    const createdAt = new Date().toISOString();
    const candidateContractRef = createGoalContractRef(input.candidateContract);
    const proposal = {
      id: `goal_amendment_${randomUUID()}`,
      goalId: goal.id,
      baseContractRef: structuredClone(goal.goalContractRef),
      candidateContract: structuredClone(input.candidateContract),
      candidateContractRef,
      reason: input.reason.trim() || "User requested a Goal amendment.",
      status: "pending" as const,
      ...(pausedExecution ? { pausedExecution: true } : {}),
      createdAt,
    };
    const saved = await agentGoalStore().saveIfPlanVersion(
      {
        ...goal,
        pendingGoalAmendment: proposal,
        updatedAt: createdAt,
      },
      goal.planVersion,
      goal.activePlanRef?.planId,
    );
    if (
      !saved.saved ||
      saved.goal?.pendingGoalAmendment?.id !== proposal.id
    ) {
      return {
        ok: false,
        message: "Goal 状态已并发变化，目标修订提案未写入。",
      };
    }
    await agentGoalStore().appendLedger(goal.id, {
      at: createdAt,
      kind: "goal_replanned",
      summary: `Goal amendment ${proposal.id} proposed; no semantics changed yet.`,
    });
    return {
      ok: true,
      proposal,
      message: pausedExecution
        ? "目标修订提案已创建，原执行路径已安全暂停并等待明确批准。"
        : "目标修订提案已创建，等待明确批准。",
    };
  }
  async function proposeGoalObjectiveAmendment(
    goalId: string,
    objective: string,
    reason: string,
  ): Promise<GoalAmendmentOperationResult> {
    const goal = await agentGoalStore().get(goalId);
    if (!goal?.goalContractSnapshot) {
      return { ok: false, message: "目标缺少可修订的 GoalContract。" };
    }
    const normalizedObjective = objective.trim();
    if (!normalizedObjective) {
      return { ok: false, message: "修改后的目标结果不能为空。" };
    }
    const createdAt = new Date().toISOString();
    return proposeGoalAmendment({
      goalId,
      reason,
      candidateContract: {
        ...structuredClone(goal.goalContractSnapshot),
        revision: goal.goalContractSnapshot.revision + 1,
        source: {
          kind: "goal_amendment",
          ref: goalId,
          summary: reason,
        },
        objective: normalizedObjective,
        createdAt,
      },
    });
  }
  function resolveGoalAmendment(
    goalId: string,
    proposalId: string,
    decision: "approve" | "reject",
  ): Promise<GoalAmendmentOperationResult> {
    return serializeGoalAmendment(goalId, () =>
      resolveGoalAmendmentAccepted(goalId, proposalId, decision),
    );
  }
  async function resolveGoalAmendmentAccepted(
    goalId: string,
    proposalId: string,
    decision: "approve" | "reject",
  ): Promise<GoalAmendmentOperationResult> {
    let goal = await agentGoalStore().get(goalId);
    let proposal = goal?.pendingGoalAmendment;
    if (
      !goal ||
      !proposal ||
      proposal.id !== proposalId ||
      proposal.status === "applied" ||
      proposal.status === "rejected"
    ) {
      return { ok: false, message: "待处理的目标修订提案不存在。" };
    }
    if (goal.status === "achieved" || goal.status === "canceled") {
      return { ok: false, message: "终态 Goal 不允许修改。" };
    }
    const resolvedAt = new Date().toISOString();
    if (decision === "reject") {
      const shouldResumePreviousPlan =
        proposal.pausedExecution === true &&
        goal.status === "waiting_for_review";
      const resolvedProposal = {
        ...proposal,
        status: "rejected" as const,
        resolvedAt,
      };
      const saved = await agentGoalStore().saveIfPlanVersion(
        {
          ...goal,
          pendingGoalAmendment: resolvedProposal,
          updatedAt: resolvedAt,
        },
        goal.planVersion,
        goal.activePlanRef?.planId,
      );
      const savedGoal = saved.goal;
      if (
        !saved.saved ||
        !savedGoal ||
        savedGoal.pendingGoalAmendment?.id !== proposal.id ||
        savedGoal.pendingGoalAmendment.status !== "rejected"
      ) {
        return {
          ok: false,
          message: "Goal 状态已并发变化，目标修订拒绝结果未写入。",
        };
      }
      await agentGoalStore().appendLedger(goal.id, {
        at: resolvedAt,
        kind: "review_resolved",
        summary: `Goal amendment ${proposal.id} rejected; active contract and Plan retained.`,
      });
      if (proposal.candidatePlanId) {
        const candidatePlan = await planStore().get(proposal.candidatePlanId);
        if (
          candidatePlan &&
          !candidatePlan.executionGoalId &&
          candidatePlan.status !== "discarded" &&
          candidatePlan.status !== "superseded"
        ) {
          await discardPlan(candidatePlan.id, candidatePlan.revision).catch(
            () => undefined,
          );
        }
      }
      let resumedPreviousPlan = false;
      if (shouldResumePreviousPlan) {
        const goalId = goal.id;
        const resumed = await runGoalOperation(
          goalId,
          () => goalChatService().resume(goalId),
        );
        resumedPreviousPlan = resumed.ok && resumed.goal?.status === "executing";
      }
      return {
        ok: true,
        proposal: resolvedProposal,
        message: resumedPreviousPlan
          ? "已撤销目标修订，并恢复原 Goal 与活动 Plan。"
          : "已拒绝目标修订，当前 Goal 和活动 Plan 保持不变。",
      };
    }

    if (proposal.status === "pending") {
      const pausedExecutionForApproval = goal.status === "executing";
      if (pausedExecutionForApproval) {
        const goalId = goal.id;
        const paused = await runGoalOperation(
          goalId,
          () => goalChatService().pause(goalId),
          { preempt: true },
        );
        if (!paused.ok) {
          return {
            ok: false,
            message: paused.message ?? "批准修订前无法暂停当前 Goal。",
          };
        }
        goal = (await agentGoalStore().get(goalId)) ?? goal;
        proposal = goal.pendingGoalAmendment;
        if (!proposal || proposal.id !== proposalId || proposal.status !== "pending") {
          return {
            ok: false,
            message: "暂停 Goal 期间修订提案已变化，请刷新后重试。",
          };
        }
      }
      const approvedProposal = {
        ...proposal,
        status: "approved" as const,
        pausedExecution:
          proposal.pausedExecution === true || pausedExecutionForApproval,
        resolvedAt,
      };
      const saved = await agentGoalStore().saveIfPlanVersion(
        {
          ...goal,
          pendingGoalAmendment: approvedProposal,
          updatedAt: resolvedAt,
        },
        goal.planVersion,
        goal.activePlanRef?.planId,
      );
      const approvedGoal = saved.goal;
      if (
        !saved.saved ||
        !approvedGoal ||
        approvedGoal.pendingGoalAmendment?.id !== proposal.id ||
        approvedGoal.pendingGoalAmendment.status !== "approved" ||
        approvedGoal.goalContractRef?.sha256 !== proposal.baseContractRef.sha256
      ) {
        return {
          ok: false,
          message: "Goal 状态已并发变化，目标修订批准结果未写入。",
        };
      }
      goal = approvedGoal;
      proposal = approvedGoal.pendingGoalAmendment;
    }

    if (!proposal) {
      return {
        ok: false,
        message: "目标修订状态已变化，请刷新后重试。",
      };
    }

    const planned = await rt.createRuntimeGoalPlan(
      goal.id,
      `已批准目标修订：${proposal.reason}`,
      {
        amendmentId: proposal.id,
        goalContractSnapshot: proposal.candidateContract,
        goalContractRef: proposal.candidateContractRef,
      },
    );
    if (!planned.ok) {
      return {
        ok: true,
        proposal,
        message: `目标修订已批准，但尚未应用；新 Direct Plan 暂未生成：${planned.message}`,
      };
    }
    const latestGoal = await agentGoalStore().get(goal.id);
    const latestProposal = latestGoal?.pendingGoalAmendment ?? proposal;
    return {
      ok: true,
      proposal: latestProposal,
      plan: planned.plan,
      message: "目标修订已批准但尚未应用；新的 Direct Plan 已生成并等待采用。",
    };
  }

  return {
    discardPlan,
    proposeGoalAmendment,
    proposeGoalAmendmentAccepted,
    proposeGoalObjectiveAmendment,
    resolveGoalAmendment,
    resolveGoalAmendmentAccepted,
  };
}