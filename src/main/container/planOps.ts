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
  const agentGoalStore = rt.agentGoalStore;
  const agentGoalValidatorRegistry = rt.agentGoalValidatorRegistry;
  const chatSessionStore = rt.chatSessionStore;
  const goalChatService = rt.goalChatService;
  const goalDraftService = rt.goalDraftService;
  const planArtifactWriter = rt.planArtifactWriter;
  const planDebateOrchestrator = rt.planDebateOrchestrator;
  const planStore = rt.planStore;
  const agentWorkspaceService = rt.agentWorkspaceService;
  const createToolExecutor = rt.createToolExecutor;
  const processSandboxProvider = rt.processSandboxProvider;
  const serializePlanConfirmation = rt.serializePlanConfirmation;
  const serializeGoalReplan = rt.serializeGoalReplan;
  const serializeGoalAmendment = rt.serializeGoalAmendment;
  const trackRuntimeInvocation = rt.trackRuntimeInvocation;
  const runGoalOperation = rt.runGoalOperation;
  const skillsDir = rt.skillsDir;
  const runtimeShuttingDown = rt.runtimeShuttingDown;
  async function confirmPlan(
    input: ConfirmPlanInput,
  ): Promise<ConfirmPlanResult> {
    if (runtimeShuttingDown()) {
      return { ok: false, message: "应用正在退出，未启动计划执行。" };
    }
    return trackRuntimeInvocation(async () => {
      const result = await serializePlanConfirmation<ConfirmPlanResult>(input.planId, async () => {
      let plan = await planStore().get(input.planId);
      if (!plan) {
        return { ok: false, message: "计划不存在。" };
      }
      if (plan.executionGoalId) {
        const existingGoal = await agentGoalStore().get(plan.executionGoalId);
        if (!existingGoal) {
          return { ok: false, message: "计划引用的执行目标不存在。", plan };
        }
        if (plan.status === "confirmed_pending_execution") {
          const resumedGoal = await goalChatService().resume(existingGoal.id);
          const latestPlan = (await planStore().get(plan.id)) ?? plan;
          if (latestPlan.status === "confirmed_pending_execution") {
            const nextStatus = planStatusForExecutionGoal(resumedGoal.status);
            plan = await planStore().save(
              {
                ...latestPlan,
                status: nextStatus,
              },
              latestPlan.revision,
              nextStatus === "executing"
                ? "plan_execution_started"
                : "plan_execution_finished",
              { goalId: resumedGoal.id, status: nextStatus },
            );
          } else {
            plan = latestPlan;
          }
          await attachConfirmedPlanGoal(plan, resumedGoal);
          return { ok: true, plan, activeGoal: resumedGoal };
        }
        if (plan.status === "executing") {
          const nextStatus = planStatusForExecutionGoal(existingGoal.status);
          if (nextStatus !== plan.status) {
            plan = await planStore().save(
              {
                ...plan,
                status: nextStatus,
              },
              plan.revision,
              "plan_execution_finished",
              { goalId: existingGoal.id, status: nextStatus },
            );
          }
        }
        return {
          ok: true,
          plan,
          activeGoal: {
            id: existingGoal.id,
            description: existingGoal.description,
            status: existingGoal.status,
          },
        };
      }
      const recovering =
        plan.status === "confirmed_pending_execution" &&
        !plan.executionGoalId;
      if (!recovering && plan.revision !== input.expectedRevision) {
        return { ok: false, message: "计划版本已变化，请刷新后重试。", plan };
      }
      if (!recovering && !isPlanConfirmable(plan)) {
        return {
          ok: false,
          message: "只有通过门禁且状态为 Ready 的计划可以确认。",
          plan,
        };
      }
      if (!plan.finalArtifact || !plan.projection) {
        return { ok: false, message: "计划终版或投影不存在。", plan };
      }
      const artifact = plan.finalArtifact;
      const projection = plan.projection;
      const confirmedCriterionBindings =
        plan.criterionBindings?.length || !plan.goalContractSnapshot
          ? plan.criterionBindings ?? []
          : derivePlanCriterionBindings(artifact, plan.goalContractSnapshot);
      const confirmedPlanRevision = plan.confirmedRevision ?? plan.revision;
      if (!(await planArtifactWriter().verify(plan))) {
        return {
          ok: false,
          message: "计划 Markdown 投影已变化，请重新生成后确认。",
          plan,
        };
      }
      const evidenceVerification = await verifyPlanEvidence(
        plan,
        processSandboxProvider(),
      );
      if (!evidenceVerification.ok) {
        return {
          ok: false,
          message: `工作区证据已漂移（${evidenceVerification.driftedEvidenceIds.join(
            "、",
          )}），请重新规划后再确认。`,
          plan,
        };
      }
      let canonicalSelectedSkill: GoalSelectedSkill | undefined;
      if ((plan.schemaVersion ?? 1) >= 2) {
        if (!plan.taskProfile || !plan.planningBrief || !plan.qualityReport) {
          return {
            ok: false,
            message: "v2 计划缺少任务画像、调查摘要或质量报告，请重新规划。",
            plan,
          };
        }
        const completedStageKinds = new Set(
          (plan.planningStages ?? [])
            .filter((stage) => stage.status === "completed")
            .map((stage) => stage.kind),
        );
        const requiredStageKinds: PlanningStageKind[] = [
          "triage",
          "investigation",
          "skill_route",
          "contract",
          "generation",
        ];
        if (plan.mode === "direct") requiredStageKinds.push("review");
        requiredStageKinds.push("quality");
        const missingStageKinds = requiredStageKinds.filter(
          (kind) => !completedStageKinds.has(kind),
        );
        if (missingStageKinds.length > 0) {
          return {
            ok: false,
            message: `v2 计划缺少已完成阶段：${missingStageKinds.join("、")}。`,
            plan,
          };
        }
        const completedReviewStage = [...(plan.planningStages ?? [])]
          .reverse()
          .find(
            (stage) =>
              stage.kind === "review" &&
              stage.status === "completed",
          );
        if (
          plan.mode === "direct" &&
          typeof completedReviewStage?.reviewApproved !== "boolean"
        ) {
          return {
            ok: false,
            message: "v2 Direct 计划缺少独立审查结论，请重新规划。",
            plan,
          };
        }
        const refreshedQuality = createPlanQualityReport({
          artifact,
          profile: plan.taskProfile,
          brief: plan.planningBrief,
          evidence: plan.evidence,
          skillDecision: plan.skillDecision,
          workspaceRoot: plan.workspaceRoot,
          availableToolNames: [
            ...createToolExecutor()
              .getRegistry()
              .getDefinitions()
              .map((definition) => definition.function.name),
            ...(plan.selectedSkill?.manifest.tools?.map(
              (tool) => tool.name,
            ) ?? []),
          ],
          reviewApproved: completedReviewStage?.reviewApproved,
          reviewIssues: completedReviewStage?.reviewIssues,
          goalContractSnapshot: plan.goalContractSnapshot,
          goalContractRef: plan.goalContractRef,
          criterionBindings: confirmedCriterionBindings,
          goalContractIssues: plan.goalContractIssues,
          availableAcceptanceKinds:
            agentGoalValidatorRegistry().listKinds(),
          now: new Date().toISOString(),
        });
        if (refreshedQuality.status !== "ready") {
          return {
            ok: false,
            message: `计划质量门禁已失效：${refreshedQuality.blockingIssues
              .map((issue) => issue.message)
              .join(" ")}`,
            plan,
          };
        }
        if (
          plan.skillDecision?.selectedSkillName !==
          plan.selectedSkill?.manifest.name
        ) {
          return {
            ok: false,
            message: "计划中的 Skill 决策与绑定快照不一致，请重新规划。",
            plan,
          };
        }
        if (
          plan.selectedSkill &&
          !plan.skillDecision?.snapshotSha256
        ) {
          return {
            ok: false,
            message: "计划绑定的 Skill 缺少快照哈希，请重新规划。",
            plan,
          };
        }
        if (plan.selectedSkill && plan.skillDecision?.snapshotSha256) {
          const skillAuthority = verifySelectedSkillAuthority({
            selectedSkill: plan.selectedSkill,
            snapshotSha256: plan.skillDecision.snapshotSha256,
            requireDigest: true,
            discoveredSkills: (
              await discoverSkills({ skillsDir, forceRefresh: true })
            ).skills,
          });
          if (!skillAuthority.ok) {
            return {
              ok: false,
              message:
                skillAuthority.reason === "missing"
                  ? "计划绑定的 Skill 已不存在，请重新规划后再确认。"
                  : "计划绑定的 Skill 快照已漂移，请重新规划后再确认。",
              plan,
            };
          }
          canonicalSelectedSkill = skillAuthority.selectedSkill;
          const inputResolution = resolveSkillInput({
            skill: canonicalSelectedSkill!,
            values: plan.selectedSkillInputValues,
            runContext: plan.workspaceRoot
              ? {
                  workspaceId: plan.workspaceId ?? "planner-workspace",
                  workspaceRoot: plan.workspaceRoot,
                  runMode: "plan",
                  agentRole: "planner",
                  depth: 0,
                  sandbox: {
                    mode: "read_only",
                    network: "none",
                    shell: "disabled",
                    allowWorkspaceEscape: false,
                    extraReadRoots: [],
                    extraWriteRoots: [],
                  },
                }
              : undefined,
          });
          if (inputResolution.status !== "complete") {
            return {
              ok: false,
              message: "计划绑定的 Skill 输入缺失或已失效，请补充信息后重新规划。",
              plan,
            };
          }
        }
      }
      if ((plan.schemaVersion ?? 1) < 2 && plan.selectedSkill) {
        const skillAuthority = verifySelectedSkillAuthority({
          selectedSkill: plan.selectedSkill,
          discoveredSkills: (
            await discoverSkills({ skillsDir, forceRefresh: true })
          ).skills,
        });
        if (!skillAuthority.ok) {
          return {
            ok: false,
            message:
              skillAuthority.reason === "missing"
                ? "计划绑定的 Skill 已不存在，请重新规划后再确认。"
                : "计划绑定的 Skill 快照已漂移，请重新规划后再确认。",
            plan,
          };
        }
        canonicalSelectedSkill = skillAuthority.selectedSkill;
      }
      let milestoneGraph: ReturnType<typeof validatePlanMilestoneGraph>;
      try {
        milestoneGraph = validatePlanMilestoneGraph(artifact.milestones);
      } catch (error) {
        return {
          ok: false,
          message: `计划执行图无效：${
            error instanceof Error ? error.message : "无法验证里程碑依赖。"
          }`,
          plan,
        };
      }
      if (!recovering) {
        plan = await planStore().save(
          {
            ...plan,
            status: "confirmed_pending_execution",
            confirmedRevision: confirmedPlanRevision,
            confirmedAt: new Date().toISOString(),
          },
          plan.revision,
          "plan_confirmed",
        );
      }

      const goalId = `goal_from_${plan.id}`;
      const criteria = artifact.acceptanceCriteria.length
        ? artifact.acceptanceCriteria
        : [`完成计划目标：${artifact.objective}`];
      const goalSuccessCriteria = plan.goalContractSnapshot
        ? buildGoalSuccessCriteriaFromPlan({
            ...plan,
            criterionBindings: confirmedCriterionBindings,
          })
        : (plan.schemaVersion ?? 1) >= 2 && artifact.acceptanceChecks?.length
          ? artifact.acceptanceChecks.map((check, index) => ({
              id: `criterion_${index + 1}`,
              description: check.description,
              acceptanceChecks: [structuredClone(check)],
            }))
          : criteria.map((description, index) => ({
              id: `criterion_${index + 1}`,
              description,
              acceptanceChecks: [
                {
                  id: `criterion_${index + 1}_review`,
                  kind: "model_review" as const,
                  description: "根据执行轨迹和产物验证计划验收条件。",
                  params: {
                    condition: description,
                    evidenceRefs: ["artifact:goalEvidence"],
                  },
                  requiresEvidence: true,
                },
              ],
            }));
      const milestoneChecks = artifact.milestones.flatMap(
        (milestone) => milestone.acceptanceChecks ?? [],
      );
      const confirmedPlanSchemaVersion = plan.schemaVersion;
      const allPlanChecks = [
        ...goalSuccessCriteria.flatMap(
          (criterion) => criterion.acceptanceChecks,
        ),
        ...milestoneChecks,
      ];
      const deterministicCheckCount = allPlanChecks.filter(
        (check) => check.kind !== "model_review",
      ).length;
      const modelReviewCheckCount = allPlanChecks.filter(
        (check) => check.kind === "model_review",
      ).length;
      const draft: GoalDraft = {
        id: plan.id,
        sessionId: plan.sessionId,
        ...(plan.workspaceId ? { workspaceId: plan.workspaceId } : {}),
        sourceMessage: plan.sourceMessage,
        ...(canonicalSelectedSkill
          ? { selectedSkill: structuredClone(canonicalSelectedSkill) }
          : {}),
        ...((plan.schemaVersion ?? 1) >= 2
          ? plan.selectedSkillInputValues &&
            Object.keys(plan.selectedSkillInputValues).length > 0
            ? {
                selectedSkillInputValues: structuredClone(
                  plan.selectedSkillInputValues,
                ),
              }
            : {}
          : defaultSelectedSkillInputValues(plan)),
        normalizedDescription:
          plan.goalContractSnapshot?.objective ?? artifact.objective,
        sourcePlanRef: {
          planId: plan.id,
          revision: confirmedPlanRevision,
          sha256: projection.sha256,
        },
        ...(plan.goalContractSnapshot && plan.goalContractRef
          ? {
              goalContractSnapshot: structuredClone(
                plan.goalContractSnapshot,
              ),
              goalContractRef: structuredClone(plan.goalContractRef),
              activePlanRef: {
                planId: plan.id,
                planRevision: confirmedPlanRevision,
                goalPlanVersion: plan.goalPlanVersion ?? 1,
                mode: plan.mode,
                purpose: plan.purpose ?? "initial",
                goalContractRef: structuredClone(plan.goalContractRef),
              },
              planHistory: [
                {
                  planId: plan.id,
                  planRevision: confirmedPlanRevision,
                  goalPlanVersion: plan.goalPlanVersion ?? 1,
                  mode: plan.mode,
                  purpose: plan.purpose ?? "initial",
                  goalContractRef: structuredClone(plan.goalContractRef),
                  trigger: structuredClone(
                    plan.trigger ?? {
                      kind: "initial_request" as const,
                      summary: "Initial confirmed plan.",
                      evidenceRefs: [],
                      at: plan.createdAt,
                    },
                  ),
                  outcome: "active" as const,
                  adoptedAt: new Date().toISOString(),
                },
              ],
            }
          : {}),
        ...(selectPlanExecutionModelBinding(plan)
          ? {
              executionModelBinding: structuredClone(
                selectPlanExecutionModelBinding(plan)!,
              ),
            }
          : {}),
        successCriteria: goalSuccessCriteria,
        acceptanceCoverage: {
          deterministicChecks: deterministicCheckCount,
          modelReviewChecks: modelReviewCheckCount,
          totalChecks: allPlanChecks.length,
          hasDeterministicCoverage: deterministicCheckCount > 0,
          hasModelReviewCoverage: modelReviewCheckCount > 0,
        },
        warnings: [],
        milestones: artifact.milestones.map((milestone) => ({
          id: milestone.id,
          description: `${milestone.title}：${milestone.description}`,
          state: milestoneGraph.rootIds.has(milestone.id) ? "ready" : "pending",
          successCriteria:
            (confirmedPlanSchemaVersion ?? 1) >= 2 &&
            milestone.acceptanceChecks?.length
              ? milestone.acceptanceChecks.map((check, criterionIndex) => ({
                  id: `${milestone.id}_criterion_${criterionIndex + 1}`,
                  description: check.description,
                  acceptanceChecks: [structuredClone(check)],
                }))
              : milestone.acceptanceCriteria.map(
                  (description, criterionIndex) => ({
                    id: `${milestone.id}_criterion_${criterionIndex + 1}`,
                    description,
                    acceptanceChecks: [
                      {
                        id: `${milestone.id}_criterion_${criterionIndex + 1}_review`,
                        kind: "model_review" as const,
                        description: "根据里程碑执行证据验证条件。",
                        params: {
                          condition: description,
                          evidenceRefs: ["artifact:goalEvidence"],
                        },
                        requiresEvidence: true,
                      },
                    ],
                  }),
                ),
          runIds: [],
          attempts: 0,
          dependsOn: milestoneGraph.dependenciesById.get(milestone.id) ?? [],
        })),
        status: "confirmed",
        createdAt: plan.createdAt,
        updatedAt: new Date().toISOString(),
      };
      const createdGoal = await goalChatService().createFromDraft({
        draft,
        goalId,
      });
      plan = await planStore().save(
        {
          ...plan,
          status: "confirmed_pending_execution",
          goalId: createdGoal.id,
          executionGoalId: createdGoal.id,
        },
        plan.revision,
        "plan_execution_goal_created",
        { goalId: createdGoal.id },
      );
      const activeGoal = await goalChatService().resume(createdGoal.id);
      const latestPlan = (await planStore().get(plan.id)) ?? plan;
      if (latestPlan.status === "confirmed_pending_execution") {
        const nextStatus = planStatusForExecutionGoal(activeGoal.status);
        plan = await planStore().save(
          {
            ...latestPlan,
            status: nextStatus,
          },
          latestPlan.revision,
          nextStatus === "executing"
            ? "plan_execution_started"
            : "plan_execution_finished",
          { goalId: activeGoal.id, status: nextStatus },
        );
      } else {
        plan = latestPlan;
      }
      await attachConfirmedPlanGoal(plan, activeGoal);
      return { ok: true, plan, activeGoal };
      });
      await rt.goalProgressDeliveryQueue();
      return result;
    });
  }

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

  async function discardPlan(planId: string, expectedRevision: number) {
    const result = await planDebateOrchestrator().discard(
      planId,
      expectedRevision,
    );
    if (result.ok && result.plan.purpose === "runtime_replan") {
      await recordGoalPlanRejected(result.plan);
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

    const planned = await createRuntimeGoalPlan(
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

  async function adoptGoalPlan(
    input: AdoptGoalPlanInput,
  ): Promise<AdoptGoalPlanResult> {
    return serializePlanConfirmation(input.planId, async () => {
      let plan = await planStore().get(input.planId);
      if (!plan) return { ok: false, message: "Plan 不存在。" };
      if (
        plan.purpose !== "runtime_replan" ||
        plan.mode !== "direct" ||
        !plan.goalId ||
        !plan.parentPlanRef ||
        !plan.goalPlanVersion ||
        !plan.goalContractSnapshot ||
        !plan.goalContractRef ||
        !plan.trigger ||
        !plan.finalArtifact ||
        !plan.projection
      ) {
        return { ok: false, message: "该记录不是可采用的运行期 Direct Plan。", plan };
      }
      let goal = await agentGoalStore().get(plan.goalId);
      if (!goal) return { ok: false, message: "Plan 关联的 Goal 不存在。", plan };
      const recoveringAdoption = goal.activePlanRef?.planId === plan.id;
      if (
        plan.goalPlanVersion !== input.expectedGoalPlanVersion ||
        (!recoveringAdoption && plan.revision !== input.expectedRevision)
      ) {
        return { ok: false, message: "Plan 或 Goal 版本已变化，请刷新后重试。", plan };
      }
      if (
        (!recoveringAdoption && !isPlanConfirmable(plan)) ||
        plan.qualityReport?.status !== "ready"
      ) {
        return { ok: false, message: "Plan 尚未通过确认与质量门禁。", plan };
      }
      if (!(await planArtifactWriter().verify(plan))) {
        return { ok: false, message: "Plan 投影已漂移，请重新生成。", plan };
      }
      const evidenceVerification = await verifyPlanEvidence(
        plan,
        processSandboxProvider(),
      );
      if (!evidenceVerification.ok) {
        return { ok: false, message: "Plan 反馈证据已漂移，请重新规划。", plan };
      }
      if (
        plan.skillDecision?.selectedSkillName !==
        plan.selectedSkill?.manifest.name
      ) {
        return {
          ok: false,
          message: "Plan 的 Skill 决策与绑定快照不一致，请重新规划。",
          plan,
        };
      }
      const adoptedSkillAuthority = verifySelectedSkillAuthority({
        selectedSkill: plan.selectedSkill,
        snapshotSha256: plan.skillDecision?.snapshotSha256,
        requireDigest: Boolean(plan.selectedSkill),
        discoveredSkills: (
          await discoverSkills({ skillsDir, forceRefresh: true })
        ).skills,
      });
      if (!adoptedSkillAuthority.ok) {
        return {
          ok: false,
          message:
            adoptedSkillAuthority.reason === "missing"
              ? "Plan 绑定的 Skill 已不存在，请重新规划。"
              : "Plan 绑定的 Skill 快照已漂移，请重新规划。",
          plan,
        };
      }
      if (adoptedSkillAuthority.selectedSkill) {
        const inputResolution = resolveSkillInput({
          skill: adoptedSkillAuthority.selectedSkill,
          values: plan.selectedSkillInputValues,
          runContext: plan.workspaceRoot
            ? {
                workspaceId: plan.workspaceId ?? "planner-workspace",
                workspaceRoot: plan.workspaceRoot,
                runMode: "plan",
                agentRole: "planner",
                depth: 0,
                sandbox: {
                  mode: "read_only",
                  network: "none",
                  shell: "disabled",
                  allowWorkspaceEscape: false,
                  extraReadRoots: [],
                  extraWriteRoots: [],
                },
              }
            : undefined,
        });
        if (inputResolution.status !== "complete") {
          return {
            ok: false,
            message: "Plan 绑定的 Skill 输入缺失或已失效，请重新规划。",
            plan,
          };
        }
      }
      if (
        !recoveringAdoption &&
        (goal.status === "achieved" || goal.status === "canceled")
      ) {
        return { ok: false, message: "终态 Goal 不允许采用新 Plan。", plan };
      }
      const currentContractMatchesPlan =
        goal.goalContractRef?.sha256 === plan.goalContractRef.sha256 &&
        goal.goalContractRef?.id === plan.goalContractRef.id &&
        goal.goalContractRef?.revision === plan.goalContractRef.revision;
      const amendment = goal.pendingGoalAmendment;
      const adoptingApprovedAmendment =
        !currentContractMatchesPlan &&
        plan.trigger?.kind === "goal_amendment" &&
        amendment?.status === "approved" &&
        amendment.candidatePlanId === plan.id &&
        amendment.baseContractRef.sha256 === goal.goalContractRef?.sha256 &&
        amendment.candidateContractRef.sha256 === plan.goalContractRef.sha256 &&
        amendment.candidateContractRef.revision ===
          plan.goalContractRef.revision;
      if (
        !recoveringAdoption &&
        (amendment?.status === "pending" ||
          (amendment?.status === "approved" && !adoptingApprovedAmendment))
      ) {
        return {
          ok: false,
          message: "Goal 存在尚未处理完成的目标修订，不能采用其他候选 Plan。",
          plan,
        };
      }
      if (!currentContractMatchesPlan && !adoptingApprovedAmendment) {
        return { ok: false, message: "GoalContract 已变化，不能采用旧候选 Plan。", plan };
      }
      if (
        !recoveringAdoption &&
        (goal.planVersion !== input.expectedGoalPlanVersion - 1 ||
          (goal.activePlanRef?.planId !== plan.parentPlanRef.planId ||
            goal.activePlanRef.goalPlanVersion !==
              plan.parentPlanRef.goalPlanVersion))
      ) {
        return { ok: false, message: "Goal 活动 Plan 已变化，采用冲突。", plan };
      }
      const adoptedAt = new Date().toISOString();
      if (!recoveringAdoption) {
        const milestoneGraph = validatePlanMilestoneGraph(
          plan.finalArtifact.milestones,
        );
        const nextMilestones = plan.finalArtifact.milestones.map(
          (milestone) => ({
            id: milestone.id,
            description: `${milestone.title}：${milestone.description}`,
            dependsOn:
              milestoneGraph.dependenciesById.get(milestone.id) ?? [],
            successCriteria: (milestone.acceptanceChecks ?? []).map(
              (check, index) => ({
                id: `${milestone.id}_criterion_${index + 1}`,
                description: check.description,
                acceptanceChecks: [structuredClone(check)],
              }),
            ),
            state: milestoneGraph.rootIds.has(milestone.id)
              ? ("ready" as const)
              : ("pending" as const),
            runIds: [],
            attempts: 0,
          }),
        );
        const oldMilestones = new Map(
          goal.milestones.map((milestone) => [milestone.id, milestone]),
        );
        const reusableMilestones = nextMilestones.map((milestone) => {
          const previous = oldMilestones.get(milestone.id);
          return previous?.state === "accepted" &&
            milestoneDefinitionHash(previous) ===
              milestoneDefinitionHash(milestone)
            ? structuredClone(previous)
            : milestone;
        });
        const activePlanRef: GoalPlanRef = {
          planId: plan.id,
          planRevision: plan.revision,
          goalPlanVersion: plan.goalPlanVersion,
          mode: "direct",
          purpose: "runtime_replan",
          goalContractRef: structuredClone(plan.goalContractRef),
        };
        const adoptedContract = adoptingApprovedAmendment && amendment
          ? structuredClone(amendment.candidateContract)
          : structuredClone(plan.goalContractSnapshot);
        const adoptedPlanId = plan.id;
        const adoptedPlanVersion = plan.goalPlanVersion;
        const adoptedParentPlanRef = structuredClone(plan.parentPlanRef);
        const adoptedTrigger = structuredClone(plan.trigger);
        const nextPlanHistory = (goal.planHistory ?? []).map((entry) => {
          if (entry.planId === adoptedPlanId) {
            return {
              ...entry,
              ...activePlanRef,
              parentPlanRef: structuredClone(adoptedParentPlanRef),
              trigger: structuredClone(adoptedTrigger),
              outcome: "active" as const,
              adoptedAt,
            };
          }
          if (
            entry.outcome === "candidate" &&
            entry.goalPlanVersion === adoptedPlanVersion &&
            entry.parentPlanRef?.planId === adoptedParentPlanRef.planId
          ) {
            return {
              ...entry,
              outcome: "rejected" as const,
              supersededAt: adoptedAt,
            };
          }
          return entry.outcome === "active"
            ? {
                ...entry,
                outcome: "superseded" as const,
                supersededAt: adoptedAt,
              }
            : entry;
        });
        if (!nextPlanHistory.some((entry) => entry.planId === adoptedPlanId)) {
          nextPlanHistory.push({
            ...activePlanRef,
            parentPlanRef: structuredClone(adoptedParentPlanRef),
            trigger: structuredClone(adoptedTrigger),
            outcome: "active",
            adoptedAt,
          });
        }
        const candidate: Goal = {
          ...goal,
          description: adoptedContract.objective,
          goalContractSnapshot: adoptedContract,
          goalContractRef: structuredClone(plan.goalContractRef),
          activePlanRef,
          planHistory: nextPlanHistory,
          ...(adoptingApprovedAmendment && amendment
            ? {
                pendingGoalAmendment: {
                  ...amendment,
                  status: "applied" as const,
                  candidatePlanId: plan.id,
                  appliedAt: adoptedAt,
                },
              }
            : {}),
          successCriteria: buildGoalSuccessCriteriaFromPlan(plan),
          taskContract: compileAgentTaskContract({
            description: adoptedContract.objective,
            ...(goal.chatSessionId ? { chatSessionId: goal.chatSessionId } : {}),
            ...(goal.originMessageId
              ? { originMessageId: goal.originMessageId }
              : {}),
          }),
          planVersion: plan.goalPlanVersion,
          milestones: reusableMilestones,
          status: "planning",
          stopReason: undefined,
          runtimeCheckpoint: undefined,
          executionModelBinding: selectPlanExecutionModelBinding(plan),
          selectedSkill: adoptedSkillAuthority.selectedSkill
            ? structuredClone(adoptedSkillAuthority.selectedSkill)
            : undefined,
          selectedSkillInputValues: adoptedSkillAuthority.selectedSkill
            ? plan.selectedSkillInputValues
            : undefined,
          executionUsage: {
            ...goal.executionUsage,
            replans: goal.executionUsage.replans + 1,
          },
          acceptanceState: goal.acceptanceState
            ? { ...goal.acceptanceState, phase: "idle", lastDecision: undefined }
            : goal.acceptanceState,
          acceptanceRetryState: undefined,
          manualCompletionAttestation: undefined,
          acceptanceCertificate: undefined,
          updatedAt: adoptedAt,
        };
        await agentGoalStore().appendLedgerIfAbsent(
          goal.id,
          `goal-plan-adoption-started:${plan.id}`,
          {
            at: adoptedAt,
            kind: "goal_replanned",
            summary: `Adopting Plan ${plan.id} v${plan.goalPlanVersion}.`,
          },
        );
        const savedGoal = await agentGoalStore().saveIfPlanVersion(
          candidate,
          goal.planVersion,
          plan.parentPlanRef.planId,
        );
        if (!savedGoal.saved || !savedGoal.goal) {
          return { ok: false, message: "Goal 版本并发冲突，未采用 Plan。", plan };
        }
        goal = savedGoal.goal;
      }
      const parentPlan = await planStore().get(plan.parentPlanRef.planId);
      if (parentPlan && parentPlan.status !== "superseded") {
        await planStore().save(
          {
            ...parentPlan,
            status: "superseded",
            supersededByPlanId: plan.id,
            supersededAt: adoptedAt,
          },
          parentPlan.revision,
          "plan_superseded",
          { supersededByPlanId: plan.id, goalId: goal.id },
        );
      }
      if (
        plan.executionGoalId !== goal.id ||
        plan.status === "awaiting_confirmation"
      ) {
        plan = await planStore().save(
          {
            ...plan,
            status: "confirmed_pending_execution",
            executionGoalId: goal.id,
            executionRunId: undefined,
            confirmedRevision: plan.confirmedRevision ?? plan.revision,
            confirmedAt: plan.confirmedAt ?? adoptedAt,
          },
          plan.revision,
          recoveringAdoption
            ? "goal_plan_adoption_link_recovered"
            : "goal_plan_adopted",
          { goalId: goal.id, goalPlanVersion: plan.goalPlanVersion },
        );
      }
      const resumed =
        goal.status === "executing" ||
        goal.status === "achieved" ||
        goal.status === "canceled"
          ? { id: goal.id, description: goal.description, status: goal.status }
          : await goalChatService().resume(goal.id);
      goal = (await agentGoalStore().get(goal.id)) ?? goal;
      const nextPlanStatus = planStatusForExecutionGoal(resumed.status);
      if (plan.status !== nextPlanStatus) {
        plan = await planStore().save(
          { ...plan, status: nextPlanStatus },
          plan.revision,
          recoveringAdoption
            ? "goal_plan_adoption_recovered"
            : "plan_execution_started",
          { goalId: goal.id },
        );
      }
      await agentGoalStore().appendLedgerIfAbsent(
        goal.id,
        `goal-plan-adopted:${plan.id}`,
        {
          at: new Date().toISOString(),
          kind: "goal_replanned",
          summary: `Adopted Plan ${plan.id} v${plan.goalPlanVersion}; execution resumed.`,
        },
      );
      return {
        ok: true,
        plan,
        goal,
        message: recoveringAdoption
          ? "已恢复完成 Plan 采用事务。"
          : "已采用新的 Direct Plan 并恢复 Goal。",
      };
    });
  }

  async function attachConfirmedPlanGoal(
    plan: PlanRecord,
    activeGoal: ChatSessionGoalSummary,
  ): Promise<void> {
    const session = await chatSessionStore().attachGoal(
      plan.sessionId,
      activeGoal,
    );
    const goalEventRef = `plan-confirmed:${plan.id}`;
    if (session.messages.some((message) => message.goalEventRef === goalEventRef)) {
      return;
    }
    await chatSessionStore().appendMessage({
      sessionId: plan.sessionId,
      role: "assistant",
      content: `计划已确认，开始执行目标：${activeGoal.description}。`,
      goalId: activeGoal.id,
      goalEventRef,
    });
  }

  async function confirmGoalDraftAccepted(
    draftId: string,
    edit?: GoalDraftEdit,
  ): Promise<GoalDraftConfirmResult> {
    try {
      const draft = goalDraftService().markConfirmed(draftId, edit);
      if (!draft) {
        return { ok: false, message: "目标草案不存在或已处理。" };
      }

      const draftSession = await chatSessionStore().get(draft.sessionId);
      const draftWithWorkspace =
        !draft.workspaceId && draftSession?.workspaceId
          ? { ...draft, workspaceId: draftSession.workspaceId }
          : draft;
      const createdGoal = await goalChatService().createFromDraft({
        draft: draftWithWorkspace,
      });
      const activeGoal = await goalChatService().resume(createdGoal.id);
      await chatSessionStore().attachGoal(draft.sessionId, activeGoal);
      await chatSessionStore().appendMessage({
        sessionId: draft.sessionId,
        role: "assistant",
        content: `已确认并开始执行目标：${activeGoal.description}。`,
        goalId: activeGoal.id,
        goalEventRef: "goal_started",
      });

      return {
        ok: true,
        draft,
        activeGoal,
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "无法确认目标草案。",
      };
    }
  }

  return {
    confirmPlan,
    createRuntimeGoalPlan,
    createRuntimeGoalPlanAccepted,
    toGoalPlanHistoryEntry,
    recordGoalPlanCandidate,
    recordGoalPlanRejected,
    discardPlan,
    proposeGoalAmendment,
    proposeGoalAmendmentAccepted,
    proposeGoalObjectiveAmendment,
    resolveGoalAmendment,
    resolveGoalAmendmentAccepted,
    adoptGoalPlan,
    attachConfirmedPlanGoal,
    confirmGoalDraftAccepted,
  };
}
