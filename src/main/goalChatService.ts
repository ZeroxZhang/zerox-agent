import { randomUUID } from "node:crypto";
import {
  assertGoalTransition,
  upgradeGoalAcceptanceProtocol,
  type Goal,
  type GoalBudget,
  type GoalSelectedSkill,
  type Milestone,
  type SuccessCriterion,
} from "../shared/agentGoal";

import type { GoalReviewDecision } from "../shared/agentGoalReview";
import type { ChatSessionGoalSummary, GoalProgressEvent } from "../shared/chat";
import {
  compileAgentTaskContract,
  type AgentTaskContract,
} from "../shared/agentTaskContract";
import { createTaskContractSuccessCriterion } from "../shared/agentTaskContractAcceptance";
import type { SkillInputValue } from "../shared/skillExecutionContract";
import type { SkillRecord } from "../shared/skills";
import type { AgentGoalController } from "./agentGoalController";
import type { AgentGoalPlanner } from "./agentGoalPlanner";
import type { AgentGoalStore } from "./agentGoalStore";
import {
  normalizeGoalDraftCriteria,
  type GoalDraft,
  type GoalDraftEdit,
} from "../shared/goalTranslation";

export type GoalChatService = {
  createFromChat(input: {
    sessionId: string;
    workspaceId?: string;
    originMessageId: string | null;
    description: string;
    selectedSkill?: SkillRecord;
    selectedSkillInputValues?: Record<string, SkillInputValue>;
  }): Promise<ChatSessionGoalSummary>;
  createFromDraft(input: {
    draft: GoalDraft;
    edit?: GoalDraftEdit;
    goalId?: string;
  }): Promise<ChatSessionGoalSummary>;
  start(
    goalId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ChatSessionGoalSummary>;
  resume(
    goalId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ChatSessionGoalSummary>;
  pause(goalId: string): Promise<ChatSessionGoalSummary>;
  cancel(goalId: string): Promise<ChatSessionGoalSummary>;
  resolveReview(
    goalId: string,
    decision: GoalReviewDecision,
  ): Promise<ChatSessionGoalSummary>;
  continueAcceptance(
    goalId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ChatSessionGoalSummary>;
  markCompletedUnverified(goalId: string): Promise<ChatSessionGoalSummary>;
  replan(goalId: string, instructions: string): Promise<ChatSessionGoalSummary>;
  retry(goalId: string): Promise<ChatSessionGoalSummary>;
  shutdown(): Promise<void>;
};

export function createGoalChatService(options: {
  controller: Pick<
    AgentGoalController,
    | "start"
    | "resume"
    | "resolveReview"
    | "continueAcceptance"
    | "markCompletedUnverified"
  >;
  goalStore: Pick<AgentGoalStore, "save" | "get" | "appendLedger">;
  planner: Pick<AgentGoalPlanner, "plan" | "replan">;
  getAvailableTools?: () => string[];
  getAvailableSkills?: () => string[];
  createId?: () => string;
  now?: () => string;
  onDiagnostic?: (event: {
    phase: "planning";
    message: string;
    error: unknown;
  }) => void;
  onProgress?: (event: GoalProgressEvent) => void;
}): GoalChatService {
  const createId = options.createId ?? (() => `goal_${randomUUID()}`);
  const now = options.now ?? (() => new Date().toISOString());
  const activeGoalRuns = new Map<
    string,
    | {
        kind: "background";
        controller: AbortController;
        completion: Promise<void>;
      }
    | {
        kind: "operation";
        controller: AbortController;
        completion: Promise<Goal>;
      }
  >();
  const pendingGoalCancellations = new Map<string, Promise<void>>();
  const pendingRestarts = new Set<string>();
  let shuttingDown = false;

  function notifyProgress(
    event: GoalProgressEvent["event"],
    goal: Goal,
    message: string,
    milestoneId?: string,
  ) {
    options.onProgress?.({
      kind: "goal_progress",
      goalId: goal.id,
      sessionId: goal.chatSessionId,
      status: goal.status,
      milestoneId,
      event,
      message,
      timestamp: now(),
    });
  }

  function startBackgroundGoalRun(
    goalId: string,
    runOptions: { signal?: AbortSignal } | undefined,
    runner: (goalId: string, options: { signal?: AbortSignal }) => Promise<Goal>,
  ) {
    if (shuttingDown) return;
    const existing = activeGoalRuns.get(goalId);
    if (existing) {
      if (existing.controller.signal.aborted && !pendingRestarts.has(goalId)) {
        pendingRestarts.add(goalId);
        void existing.completion.finally(() => {
          pendingRestarts.delete(goalId);
          if (!shuttingDown) {
            startBackgroundGoalRun(goalId, runOptions, runner);
          }
        });
      }
      return;
    }

    const controller = new AbortController();
    const abortFromParent = () => controller.abort(runOptions?.signal?.reason);
    runOptions?.signal?.addEventListener("abort", abortFromParent, { once: true });
    if (runOptions?.signal?.aborted) {
      abortFromParent();
    }

    const completion = runner(goalId, { signal: controller.signal })
      .then(
        () => undefined,
        () => {
          // Errors are captured by the controller and surfaced via progress events.
        },
      )
      .finally(() => {
        runOptions?.signal?.removeEventListener("abort", abortFromParent);
        if (activeGoalRuns.get(goalId)?.controller === controller) {
          activeGoalRuns.delete(goalId);
        }
      });
    activeGoalRuns.set(goalId, {
      kind: "background",
      controller,
      completion,
    });
  }

  function abortBackgroundGoalRun(goalId: string) {
    const active = activeGoalRuns.get(goalId);
    if (active && !active.controller.signal.aborted) {
      active.controller.abort();
    }
  }

  function beginGoalCancellation(goalId: string): () => void {
    let settle: (() => void) | undefined;
    const completion = new Promise<void>((resolve) => {
      settle = resolve;
    });
    pendingGoalCancellations.set(goalId, completion);
    return () => {
      settle?.();
      if (pendingGoalCancellations.get(goalId) === completion) {
        pendingGoalCancellations.delete(goalId);
      }
    };
  }

  async function runAbortableGoalOperation(
    goalId: string,
    runOptions: { signal?: AbortSignal } | undefined,
    runner: (goalId: string, options: { signal?: AbortSignal }) => Promise<Goal>,
  ): Promise<Goal> {
    const existing = activeGoalRuns.get(goalId);
    if (existing) {
      if (existing.kind === "operation") {
        return existing.completion;
      }
      try {
        await existing.completion;
      } catch (error) {
        if (!existing.controller.signal.aborted) {
          throw error;
        }
      }
      if (existing.controller.signal.aborted) {
        await pendingGoalCancellations.get(goalId);
      }
      const canonical = await options.goalStore.get(goalId);
      if (!canonical) {
        throw new Error(`Goal "${goalId}" was not found.`);
      }
      if (
        canonical.status === "waiting_for_acceptance" &&
        !runOptions?.signal?.aborted
      ) {
        return runAbortableGoalOperation(goalId, runOptions, runner);
      }
      return canonical;
    }

    const controller = new AbortController();
    const abortFromParent = () => controller.abort(runOptions?.signal?.reason);
    runOptions?.signal?.addEventListener("abort", abortFromParent, { once: true });
    if (runOptions?.signal?.aborted) {
      abortFromParent();
    }

    const completion = (async (): Promise<Goal> => {
      try {
        let result: Goal;
        try {
          result = await runner(goalId, { signal: controller.signal });
        } catch (error) {
          if (!controller.signal.aborted) {
            throw error;
          }
          await pendingGoalCancellations.get(goalId);
          const canonical = await options.goalStore.get(goalId);
          if (canonical) {
            return canonical;
          }
          throw error;
        }
        if (controller.signal.aborted) {
          await pendingGoalCancellations.get(goalId);
        }
        let canonical = await options.goalStore.get(goalId);
        if (controller.signal.aborted) {
          await pendingGoalCancellations.get(goalId);
          canonical = (await options.goalStore.get(goalId)) ?? canonical;
        }
        return canonical ?? result;
      } finally {
        runOptions?.signal?.removeEventListener("abort", abortFromParent);
        if (activeGoalRuns.get(goalId)?.controller === controller) {
          activeGoalRuns.delete(goalId);
        }
      }
    })();
    activeGoalRuns.set(goalId, { kind: "operation", controller, completion });
    return completion;
  }

  async function queueGoalExecution(goal: Goal): Promise<Goal> {
    if (
      goal.status !== "planning" &&
      goal.status !== "executing" &&
      goal.status !== "waiting_for_review"
    ) {
      return goal;
    }

    let candidate = upgradeGoalAcceptanceProtocol(goal);
    const startedFromPlanning = candidate.status === "planning";
    if (startedFromPlanning) {
      assertGoalTransition(candidate.status, "executing");
      candidate = {
        ...candidate,
        status: "executing",
        updatedAt: now(),
      };
    }

    if (candidate === goal) {
      return goal;
    }

    const persisted = await options.goalStore.save(candidate);
    if (persisted.status !== candidate.status) {
      return persisted;
    }
    if (startedFromPlanning) {
      await options.goalStore.appendLedger(candidate.id, {
        at: candidate.updatedAt,
        kind: "goal_planned",
        summary: "Goal execution queued from chat.",
      });
      notifyProgress("started", persisted, "目标已开始执行。");
    }
    return persisted;
  }

  return {
    async createFromChat(input) {
      const goalId = createId();
      const description = input.description.trim() || "Chat goal";
      const taskContract = compileAgentTaskContract({
        description,
        chatSessionId: input.sessionId,
        ...(input.originMessageId
          ? { originMessageId: input.originMessageId }
          : {}),
      });
      const goalCriterion = createGoalSuccessCriterion(
        description,
        taskContract,
      );
      const milestones = await planGoalMilestones(
        description,
        goalCriterion,
        taskContract,
        input.selectedSkill,
      );

      const goal: Goal = upgradeGoalAcceptanceProtocol({
        id: goalId,
        chatSessionId: input.sessionId,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.originMessageId
          ? { originMessageId: input.originMessageId }
          : {}),
        description,
        ...(taskContract ? { taskContract } : {}),
        ...(input.selectedSkill
          ? { selectedSkill: snapshotSelectedSkill(input.selectedSkill) }
          : {}),
        ...(input.selectedSkillInputValues
          ? { selectedSkillInputValues: input.selectedSkillInputValues }
          : {}),
        successCriteria: [goalCriterion],
        milestones,
        status: "planning",
        executionUsage: {
          iterations: 0,
          toolCalls: 0,
          wallClockMs: 0,
          tokens: 0,
          replans: 0,
        },
        reviewPolicy: "review_high_risk_only",
        planVersion: 1,
        createdAt: now(),
        updatedAt: now(),
      });

      await options.goalStore.save(goal);
      await options.goalStore.appendLedger(goal.id, {
        at: goal.createdAt,
        kind: "goal_planned",
        summary: `Goal created from chat session ${input.sessionId}.`,
      });
      notifyProgress("started", goal, "目标已创建，等待启动。");
      return toGoalSummary(goal);
    },

    async createFromDraft(input) {
      const goalId = input.goalId ?? createId();
      const existingGoal = await options.goalStore.get(goalId);
      if (existingGoal) {
        return toGoalSummary(existingGoal);
      }
      const description =
        input.edit?.normalizedDescription?.trim() ||
        input.draft.normalizedDescription.trim() ||
        "Chat goal";
      const originalDescription = input.draft.sourceMessage.trim() || description;
      const normalizedCriteria = normalizeGoalDraftCriteria(
        input.edit?.successCriteria ?? input.draft.successCriteria,
      );
      const successCriteria = normalizedCriteria.successCriteria;
      const taskContract = compileAgentTaskContract({
        description: originalDescription,
        chatSessionId: input.draft.sessionId,
        ...(input.draft.originMessageId
          ? { originMessageId: input.draft.originMessageId }
          : {}),
      });
      const editedMilestones = input.edit?.milestones?.length
        ? input.edit.milestones
        : undefined;
      const draftMilestones = input.draft.milestones?.length
        ? input.draft.milestones
        : undefined;
      const milestones = editedMilestones
        ? normalizeDraftMilestones(editedMilestones, successCriteria)
        : draftMilestones
          ? normalizeDraftMilestones(draftMilestones, successCriteria)
          : await planGoalMilestones(
                originalDescription,
                successCriteria,
                taskContract,
                input.draft.selectedSkill,
              );

      const goal: Goal = upgradeGoalAcceptanceProtocol({
        id: goalId,
        chatSessionId: input.draft.sessionId,
        ...(input.draft.workspaceId ? { workspaceId: input.draft.workspaceId } : {}),
        ...(input.draft.originMessageId
          ? { originMessageId: input.draft.originMessageId }
          : {}),
        description,
        originalDescription,
        ...(input.draft.sourcePlanRef
          ? { sourcePlanRef: { ...input.draft.sourcePlanRef } }
          : {}),
        ...(input.draft.executionModelBinding
          ? {
              executionModelBinding: structuredClone(
                input.draft.executionModelBinding,
              ),
            }
          : {}),
        ...(taskContract ? { taskContract } : {}),
        ...(input.draft.selectedSkill
          ? { selectedSkill: snapshotSelectedSkill(input.draft.selectedSkill) }
          : {}),
        ...(input.draft.selectedSkillInputValues
          ? { selectedSkillInputValues: input.draft.selectedSkillInputValues }
          : {}),
        successCriteria,
        milestones,
        status: "planning",
        executionUsage: {
          iterations: 0,
          toolCalls: 0,
          wallClockMs: 0,
          tokens: 0,
          replans: 0,
        },
        reviewPolicy: "review_high_risk_only",
        planVersion: 1,
        createdAt: now(),
        updatedAt: now(),
      });

      await options.goalStore.save(goal);
      await options.goalStore.appendLedger(goal.id, {
        at: goal.createdAt,
        kind: "goal_planned",
        summary: `Goal created from confirmed draft ${input.draft.id}.`,
      });
      notifyProgress("started", goal, "目标草案已确认，等待启动。");
      return toGoalSummary(goal);
    },

    async start(goalId, runOptions) {
      const goal = await options.goalStore.get(goalId);
      if (!goal) {
        throw new Error(`Goal "${goalId}" was not found.`);
      }
      const queuedGoal = await queueGoalExecution(goal);
      if (queuedGoal.status === "executing") {
        startBackgroundGoalRun(goalId, runOptions, (id, runnerOptions) =>
          options.controller.start(id, runnerOptions),
        );
      }
      return toGoalSummary(
        (await options.goalStore.get(goalId)) ?? queuedGoal,
      );
    },

    async resume(goalId, runOptions) {
      const goal = await options.goalStore.get(goalId);
      if (!goal) {
        throw new Error(`Goal "${goalId}" was not found.`);
      }
      const queuedGoal = await queueGoalExecution(goal);
      if (queuedGoal.status === "executing") {
        startBackgroundGoalRun(goalId, runOptions, (id, runnerOptions) =>
          options.controller.resume(id, runnerOptions),
        );
      }
      return toGoalSummary(
        (await options.goalStore.get(goalId)) ?? queuedGoal,
      );
    },

    async pause(goalId) {
      const goal = await options.goalStore.get(goalId);
      if (!goal) {
        throw new Error(`Goal "${goalId}" was not found.`);
      }

      if (goal.status !== "waiting_for_review") {
        abortBackgroundGoalRun(goalId);
        assertGoalTransition(goal.status, "waiting_for_review");
        goal.status = "waiting_for_review";
        goal.milestones = goal.milestones.map((milestone) =>
          milestone.state === "running"
            ? { ...milestone, state: "ready" }
            : milestone,
        );
        goal.updatedAt = now();
        const persisted = await options.goalStore.save(goal);
        if (persisted.status !== goal.status) {
          return toGoalSummary(persisted);
        }
        await options.goalStore.appendLedger(goal.id, {
          at: goal.updatedAt,
          kind: "review_requested",
          summary: "Goal paused from chat and is waiting for review.",
        });
        notifyProgress("review_requested", persisted, "目标已暂停，等待审核。");
        return toGoalSummary(persisted);
      }

      return toGoalSummary(goal);
    },

    async cancel(goalId) {
      const goal = await options.goalStore.get(goalId);
      if (!goal) {
        throw new Error(`Goal "${goalId}" was not found.`);
      }

      if (goal.status !== "canceled") {
        assertGoalTransition(goal.status, "canceled");
      }
      const finishCancellation = beginGoalCancellation(goalId);
      try {
        abortBackgroundGoalRun(goalId);
        goal.status = "canceled";
        goal.stopReason = "user_canceled";
        goal.updatedAt = now();
        const persisted = await options.goalStore.save(goal);
        if (persisted.status !== goal.status) {
          return toGoalSummary(persisted);
        }
        await options.goalStore.appendLedger(goal.id, {
          at: goal.updatedAt,
          kind: "goal_stopped",
          summary: "Goal canceled from chat.",
        });
        notifyProgress("stopped", persisted, "目标已取消。");
        return toGoalSummary(persisted);
      } finally {
        finishCancellation();
      }
    },

    async resolveReview(goalId, decision) {
      return toGoalSummary(
        await options.controller.resolveReview(goalId, decision),
      );
    },

    async continueAcceptance(goalId, runOptions) {
      return toGoalSummary(
        await runAbortableGoalOperation(
          goalId,
          runOptions,
          (id, controllerOptions) =>
            options.controller.continueAcceptance(id, controllerOptions),
        ),
      );
    },

    async markCompletedUnverified(goalId) {
      return toGoalSummary(
        await options.controller.markCompletedUnverified(goalId),
      );
    },

    async replan(goalId, instructions) {
      const goal = await options.goalStore.get(goalId);
      if (!goal) {
        throw new Error(`Goal "${goalId}" was not found.`);
      }

      if (goal.status === "achieved" || goal.status === "canceled") {
        throw new Error(`Cannot replan a terminal ${goal.status} goal.`);
      }
      if (goal.status === "stopped_budget") {
        throw new Error(
          "Legacy budget-stopped goals are read-only and cannot be replanned.",
        );
      }
      if (
        goal.status === "stopped_blocked" &&
        goal.stopReason === "acceptance_integrity_failed"
      ) {
        throw new Error(
          "Cannot replan a goal whose acceptance certificate failed integrity verification.",
        );
      }
      const replanningGoal = structuredClone(goal);
      const milestones = await options.planner.replan(
        replanningGoal,
        instructions,
      );
      const candidate: Goal = {
        ...replanningGoal,
        milestones,
        ...(replanningGoal.status === "stopped_blocked" &&
        replanningGoal.acceptanceState
          ? {
              acceptanceState: {
                ...replanningGoal.acceptanceState,
                phase: "idle",
              },
            }
          : {}),
        updatedAt: now(),
      };
      const persisted = await options.goalStore.save(candidate);
      if (persisted.status !== candidate.status) {
        return toGoalSummary(persisted);
      }
      await options.goalStore.appendLedger(candidate.id, {
        at: candidate.updatedAt,
        kind: "goal_replanned",
        summary: `Replanned from chat recovery UI: ${instructions}`,
      });
      notifyProgress("replanned", persisted, "目标已重新规划。");
      return toGoalSummary(persisted);
    },

    async retry(goalId) {
      const goal = await options.goalStore.get(goalId);
      if (!goal) {
        throw new Error(`Goal "${goalId}" was not found.`);
      }

      if (
        goal.status === "stopped_blocked" &&
        goal.stopReason === "acceptance_unavailable" &&
        goal.milestones.length > 0 &&
        goal.milestones.every(
          (milestone) =>
            milestone.state === "accepted" || milestone.state === "skipped",
        )
      ) {
        // The stopped-blocked UI labels this action "retry acceptance". Route
        // completed goals through the final-acceptance recovery path so repaired
        // evidence is rebuilt instead of reviving a stale runtime/replay state.
        return toGoalSummary(
          await options.controller.continueAcceptance(goalId),
        );
      }
      if (goal.status === "stopped_budget") {
        throw new Error(
          "Legacy budget-stopped goals are read-only and cannot be retried.",
        );
      }

      if (
        goal.status === "stopped_blocked" &&
        goal.stopReason === "acceptance_integrity_failed"
      ) {
        throw new Error(
          "Cannot retry a goal whose acceptance certificate failed integrity verification.",
        );
      }

      if (
        goal.status === "stopped_blocked" &&
        goal.stopReason === "goal_impossible" &&
        goal.acceptanceState?.phase !== "idle"
      ) {
        throw new Error(
          "This goal is still impossible under the current plan. Adjust or replan it before retrying.",
        );
      }

      if (goal.status !== "failed" && goal.status !== "stopped_stalled") {
        assertGoalTransition(goal.status, "executing");
      }
      const upgraded = upgradeGoalAcceptanceProtocol(goal);
      const startsFreshRecoveryEpoch =
        goal.status === "failed" || goal.status === "stopped_stalled";
      const candidate: Goal = {
        ...upgraded,
        status: "executing",
        stopReason: undefined,
        modelServiceNotice: undefined,
        milestones: rearmGoalMilestonesForRetry(upgraded.milestones),
        ...(upgraded.acceptanceState && startsFreshRecoveryEpoch
          ? {
              acceptanceState: {
                ...upgraded.acceptanceState,
                phase: "idle",
                recentFailures: [],
                lastDecision: undefined,
              },
            }
          : upgraded.acceptanceState?.phase === "blocked"
          ? {
              acceptanceState: {
                ...upgraded.acceptanceState,
                phase: "idle",
              },
            }
          : {}),
        updatedAt: now(),
      };
      const persisted = await options.goalStore.save(candidate);
      if (persisted.status !== candidate.status) {
        return toGoalSummary(persisted);
      }
      await options.goalStore.appendLedger(candidate.id, {
        at: candidate.updatedAt,
        kind: "goal_planned",
        summary: "Goal retried from chat recovery UI.",
      });
      const canonicalAfterLedger =
        (await options.goalStore.get(candidate.id)) ?? persisted;
      if (canonicalAfterLedger.status !== "executing") {
        return toGoalSummary(canonicalAfterLedger);
      }
      notifyProgress("started", canonicalAfterLedger, "目标已恢复执行。");
      startBackgroundGoalRun(goalId, { signal: undefined }, (id, runnerOptions) =>
        options.controller.resume(id, runnerOptions),
      );
      return toGoalSummary(
        (await options.goalStore.get(goalId)) ?? canonicalAfterLedger,
      );
    },

    async shutdown() {
      shuttingDown = true;
      pendingRestarts.clear();
      const active = [...activeGoalRuns.values()];
      for (const run of active) {
        if (!run.controller.signal.aborted) {
          run.controller.abort("application_shutdown");
        }
      }
      await Promise.allSettled(active.map((run) => run.completion));
    },
  };

  async function planGoalMilestones(
    description: string,
    successCriteria: SuccessCriterion[] | SuccessCriterion,
    taskContract: AgentTaskContract | undefined,
    selectedSkill: SkillRecord | GoalSelectedSkill | undefined,
  ): Promise<Milestone[]> {
    const criteria = Array.isArray(successCriteria)
      ? successCriteria
      : [successCriteria];
    try {
      return await options.planner.plan(description, {
        successCriteria: criteria,
        availableTools: options.getAvailableTools?.() ?? [],
        availableSkills: options.getAvailableSkills?.() ?? [],
        ...(taskContract ? { taskContract } : {}),
        ...(selectedSkill ? { selectedSkill: snapshotSelectedSkill(selectedSkill) } : {}),
      });
    } catch (error) {
      options.onDiagnostic?.({
        phase: "planning",
        message: "Goal planner failed; using the local structured fallback.",
        error,
      });
      return [
        {
          id: "milestone_1",
          description: "执行目标并产出可验收结果",
          dependsOn: [],
          successCriteria: criteria,
          state: "ready",
          runIds: [],
          attempts: 0,
        },
      ];
    }
  }
}

function snapshotSelectedSkill(skill: SkillRecord | GoalSelectedSkill): GoalSelectedSkill {
  return {
    rootDir: skill.rootDir,
    skillFile: skill.skillFile,
    body: skill.body,
    manifest: JSON.parse(JSON.stringify(skill.manifest)) as SkillRecord["manifest"],
  };
}

function rearmGoalMilestonesForRetry(milestones: Milestone[]): Milestone[] {
  const milestoneIds = new Set(milestones.map((milestone) => milestone.id));
  const completedIds = new Set(
    milestones
      .filter(
        (milestone) =>
          milestone.state === "accepted" || milestone.state === "skipped",
      )
      .map((milestone) => milestone.id),
  );
  let hasReadyMilestone = milestones.some(
    (milestone) => milestone.state === "ready",
  );

  return milestones.map((milestone) => {
    const dependsOn = [
      ...new Set(
        milestone.dependsOn.filter(
          (dependencyId) =>
            dependencyId !== milestone.id && milestoneIds.has(dependencyId),
        ),
      ),
    ];
    if (
      !hasReadyMilestone &&
      (milestone.state === "rejected" ||
        milestone.state === "failed" ||
        milestone.state === "running") &&
      dependsOn.every((dependencyId) => completedIds.has(dependencyId))
    ) {
      hasReadyMilestone = true;
      return {
        ...milestone,
        dependsOn,
        state: "ready",
        lastAcceptanceSummary: undefined,
      };
    }
    return {
      ...milestone,
      dependsOn,
      ...(milestone.state === "running" ? { state: "pending" as const } : {}),
    };
  });
}

function normalizeDraftMilestones(
  milestones: Milestone[],
  successCriteria: SuccessCriterion[],
): Milestone[] {
  return milestones.map((milestone, index) => {
    const milestoneCriteria = milestone.successCriteria.length
      ? milestone.successCriteria
      : successCriteria;
    return {
      ...milestone,
      id: milestone.id.trim() || `milestone_${index + 1}`,
      description: milestone.description.trim(),
      // Plan-confirmed milestones and ordinary Goal drafts must cross the
      // same acceptance-contract boundary. Otherwise the goal-level checks
      // are canonical while milestone checks retain stale shell semantics.
      successCriteria: normalizeGoalDraftCriteria(milestoneCriteria)
        .successCriteria,
      state:
        index === 0 && milestone.state === "pending"
          ? "ready"
          : milestone.state,
      runIds: milestone.runIds ?? [],
      attempts: milestone.attempts ?? 0,
    };
  });
}

function createGoalSuccessCriterion(
  description: string,
  taskContract: AgentTaskContract | undefined,
): SuccessCriterion {
  const contractCriterion = taskContract
    ? createTaskContractSuccessCriterion(taskContract)
    : undefined;
  if (contractCriterion) {
    return contractCriterion;
  }

  return {
    id: "criterion_goal_satisfied",
    description: `Goal condition is satisfied: ${description}`,
    acceptanceChecks: [
      {
        id: "criterion_goal_satisfied_review",
        kind: "model_review",
        description:
          "An independent judge confirms the goal condition is satisfied from recorded execution evidence.",
        params: {
          condition: description,
          evidenceRefs: ["artifact:goalEvidence"],
        },
        requiresEvidence: true,
      },
    ],
  };
}

function toGoalSummary(goal: Goal): ChatSessionGoalSummary {
  return {
    id: goal.id,
    description: goal.description,
    status: goal.status,
  };
}
