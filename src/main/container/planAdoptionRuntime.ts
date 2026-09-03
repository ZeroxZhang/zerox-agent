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

export type PlanAdoptionRuntime = PlanOpsRuntime;

export function createPlanAdoptionRuntime(rt: PlanAdoptionRuntime) {
  const agentGoalStore = rt.agentGoalStore;
  const agentGoalValidatorRegistry = rt.agentGoalValidatorRegistry;
  const chatSessionStore = rt.chatSessionStore;
  const goalChatService = rt.goalChatService;
  const goalDraftService = rt.goalDraftService;
  const planArtifactWriter = rt.planArtifactWriter;
  const planStore = rt.planStore;
  const createToolExecutor = rt.createToolExecutor;
  const processSandboxProvider = rt.processSandboxProvider;
  const serializePlanConfirmation = rt.serializePlanConfirmation;
  const trackRuntimeInvocation = rt.trackRuntimeInvocation;
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
    adoptGoalPlan,
    attachConfirmedPlanGoal,
    confirmGoalDraftAccepted,
  };
}