import {
  assertGoalTransition,
  type Goal,
  type GoalStatus,
  type Milestone,
  type StopReason,
} from "../shared/agentGoal";
import {
  shouldRequestReview as shouldRequestGoalReview,
  type GoalReviewDecision,
} from "../shared/agentGoalReview";
import type { GoalProgressEvent } from "../shared/chat";
import type { AgentTrajectoryEvent, AgentTrajectoryEventType } from "../shared/agentTrajectory";
import type { AgentGoalAcceptance, AcceptanceContext, AcceptanceResult } from "./agentGoalAcceptance";
import type { AgentGoalPlanner } from "./agentGoalPlanner";
import type { AgentGoalStore } from "./agentGoalStore";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import type { ChatMessage } from "./openAiCompatibleClient";

export type GoalRuntimeRunResult = {
  runId: string;
  toolCallCount: number;
  status?: "succeeded" | "failed" | "canceled" | "paused";
  summary?: string;
  wallClockMs?: number;
  tokens?: number;
  transcriptMessages?: ChatMessage[];
};

export type GoalRuntimeEngine = {
  runMilestone(
    goal: Goal,
    milestone: Milestone,
    options?: { signal?: AbortSignal },
  ): Promise<GoalRuntimeRunResult>;
};

export type AgentGoalController = {
  start(goalId: string, options?: { signal?: AbortSignal }): Promise<Goal>;
  resume(goalId: string, options?: { signal?: AbortSignal }): Promise<Goal>;
  resolveReview(goalId: string, decision: GoalReviewDecision): Promise<Goal>;
};

export function createAgentGoalController(options: {
  goalStore: AgentGoalStore;
  runtimeEngine: GoalRuntimeEngine;
  acceptance: Pick<AgentGoalAcceptance, "evaluate" | "evaluateGoal">;
  planner: Pick<AgentGoalPlanner, "replan">;
  trajectoryStore: Pick<AgentTrajectoryStore, "append">;
  createAcceptanceContext?: (
    goal: Goal,
    milestone?: Milestone,
    runResult?: GoalRuntimeRunResult,
  ) => AcceptanceContext | Promise<AcceptanceContext>;
  stallThreshold?: number;
  createId?: () => string;
  nextSequence?: () => number;
  now?: () => string;
  onProgress?: (event: GoalProgressEvent) => void;
}): AgentGoalController {
  const stallThreshold = options.stallThreshold ?? 3;
  const activeRuns = new Map<string, Promise<Goal>>();

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
      timestamp: currentTime(),
    });
  }

  async function loadGoal(goalId: string): Promise<Goal> {
    const goal = await options.goalStore.get(goalId);
    if (!goal) {
      throw new Error(`Goal "${goalId}" was not found.`);
    }
    return goal;
  }

  async function runLoop(goal: Goal, runOptions?: { signal?: AbortSignal }) {
    if (activeRuns.has(goal.id)) {
      return activeRuns.get(goal.id)!;
    }

    const runPromise = runLoopInternal(goal, runOptions).finally(() => {
      activeRuns.delete(goal.id);
    });
    activeRuns.set(goal.id, runPromise);
    return runPromise;
  }

  async function runLoopInternal(
    goal: Goal,
    runOptions?: { signal?: AbortSignal },
  ) {
    let stalledIterations = 0;

    try {
      while (goal.status === "executing") {
        if (runOptions?.signal?.aborted) {
          return stopGoal(goal, "canceled", "user_canceled", "Goal canceled.");
        }

        if (isBudgetExhausted(goal)) {
        return stopGoal(
          goal,
          "stopped_budget",
          "budget_exhausted",
          "Goal budget exhausted before dispatching another milestone.",
        );
      }

      const nextMilestone = pickNextReadyMilestone(goal);
      if (!nextMilestone) {
        if (allMilestonesAccepted(goal)) {
          const result = await options.acceptance.evaluateGoal(
            goal,
            (await options.createAcceptanceContext?.(goal)) as never,
          );
          if (result.accepted) {
            return stopGoal(
              goal,
              "achieved",
              "goal_accepted",
              "Goal acceptance passed.",
            );
          }

          if (goal.budgetUsage.replans < goal.budget.maxReplans) {
            const reason = summarizeAcceptanceFailure(result);
            goal.milestones = await options.planner.replan(goal, reason);
            touch(goal);
            await options.goalStore.appendLedger(goal.id, {
              at: currentTime(),
              kind: "goal_replanned",
              summary: "Replanned after final goal acceptance needed more evidence.",
            });
            await emit(goal.id, "goal_replanned", {
              goalId: goal.id,
              planVersion: goal.planVersion,
              replans: goal.budgetUsage.replans,
              reason,
            });
            notifyProgress(
              "replanned",
              goal,
              "目标验收证据不足，已重新规划继续推进。",
            );
            await writeGoalCheckpoint(goal, "goal_acceptance_replanned");
            continue;
          }

          return stopGoal(
            goal,
            "failed",
            "unrecoverable_failure",
            summarizeAcceptanceFailure(result),
          );
        }

        stalledIterations += 1;
        if (stalledIterations >= stallThreshold) {
          return stopGoal(
            goal,
            "stopped_stalled",
            "progress_stalled",
            "No ready milestones are available; goal progress appears stalled.",
          );
        }
        continue;
      }

      stalledIterations = 0;
      const shouldSuspend = await runOneMilestone(
        goal,
        nextMilestone,
        runOptions,
      );
      if (shouldSuspend) {
        return goal;
      }
    }

      return goal;
    } catch (error) {
      const summary = error instanceof Error ? error.message : "目标运行时发生未知错误。";
      notifyProgress("stopped", goal, summary);
      return stopGoal(goal, "failed", "unrecoverable_failure", summary);
    }
  }

  async function runOneMilestone(
    goal: Goal,
    milestone: Milestone,
    runOptions?: { signal?: AbortSignal },
  ): Promise<boolean> {
    milestone.state = "running";
    milestone.attempts += 1;
    touch(goal);
    await options.goalStore.appendLedger(goal.id, {
      at: currentTime(),
      kind: "milestone_started",
      milestoneId: milestone.id,
      summary: `Started milestone "${milestone.id}".`,
    });
    await emit(goal.id, "milestone_started", {
      goalId: goal.id,
      milestoneId: milestone.id,
    });
    notifyProgress(
      "milestone_started",
      goal,
      `里程碑开始：${milestone.description}`,
      milestone.id,
    );

    const runResult = await options.runtimeEngine.runMilestone(
      goal,
      milestone,
      runOptions,
    );
    milestone.runIds.push(runResult.runId);
    milestone.lastRunStatus = runResult.status ?? "succeeded";
    if (runResult.summary) {
      milestone.lastRunSummary = runResult.summary;
    }
    goal.budgetUsage.iterations += 1;
    goal.budgetUsage.toolCalls += runResult.toolCallCount;
    goal.budgetUsage.wallClockMs += runResult.wallClockMs ?? 0;
    goal.budgetUsage.tokens += runResult.tokens ?? 0;

    const acceptance = await options.acceptance.evaluate(
      milestone,
      (await options.createAcceptanceContext?.(goal, milestone, runResult)) as never,
    );

    if (acceptance.accepted) {
      milestone.state = "accepted";
      milestone.lastAcceptanceSummary = summarizeAcceptanceSuccess(acceptance);
      touch(goal);
      await options.goalStore.appendLedger(goal.id, {
        at: currentTime(),
        kind: "milestone_accepted",
        milestoneId: milestone.id,
        summary: milestone.lastAcceptanceSummary,
      });
      await writeGoalCheckpoint(goal, "milestone_accepted");
      notifyProgress(
        "milestone_accepted",
        goal,
        milestone.lastAcceptanceSummary ?? `里程碑已完成：${milestone.description}`,
        milestone.id,
      );

      if (shouldRequestReview(goal, milestone)) {
        goal.status = "waiting_for_review";
        touch(goal);
        await options.goalStore.appendLedger(goal.id, {
          at: currentTime(),
          kind: "review_requested",
          milestoneId: milestone.id,
          summary: `Review requested after milestone "${milestone.id}".`,
        });
        await emit(goal.id, "goal_review_requested", {
          goalId: goal.id,
          milestoneId: milestone.id,
        });
        notifyProgress(
          "review_requested",
          goal,
          "里程碑完成，等待你审核。",
          milestone.id,
        );
        await options.goalStore.save(goal);
        return true;
      }

      return false;
    }

    milestone.state = "rejected";
    milestone.lastAcceptanceSummary = summarizeAcceptanceFailure(acceptance);
    touch(goal);
    await options.goalStore.appendLedger(goal.id, {
      at: currentTime(),
      kind: "milestone_rejected",
      milestoneId: milestone.id,
      summary: milestone.lastAcceptanceSummary,
    });
    notifyProgress(
      "milestone_rejected",
      goal,
      milestone.lastAcceptanceSummary ?? `里程碑未通过：${milestone.description}`,
      milestone.id,
    );

    if (goal.budgetUsage.replans < goal.budget.maxReplans) {
      goal.milestones = await options.planner.replan(
        goal,
        milestone.lastAcceptanceSummary,
      );
      touch(goal);
      await options.goalStore.appendLedger(goal.id, {
        at: currentTime(),
        kind: "goal_replanned",
        milestoneId: milestone.id,
        summary: `Replanned after milestone "${milestone.id}" was rejected.`,
      });
      await emit(goal.id, "goal_replanned", {
        goalId: goal.id,
        milestoneId: milestone.id,
        planVersion: goal.planVersion,
        replans: goal.budgetUsage.replans,
      });
      notifyProgress(
        "replanned",
        goal,
        "里程碑未通过，已重新规划。",
        milestone.id,
      );
      await writeGoalCheckpoint(goal, "goal_replanned");
      return false;
    }

    await stopGoal(
      goal,
      "failed",
      "review_rejected",
      "Milestone rejected and replan budget exhausted.",
    );
    return true;
  }

  async function stopGoal(
    goal: Goal,
    status: GoalStatus,
    stopReason: StopReason,
    summary: string,
  ): Promise<Goal> {
    assertGoalTransition(goal.status, status);
    goal.status = status;
    goal.stopReason = stopReason;
    touch(goal);
    await options.goalStore.appendLedger(goal.id, {
      at: currentTime(),
      kind: "goal_stopped",
      summary,
    });
    await emit(goal.id, "goal_stopped", {
      goalId: goal.id,
      status,
      stopReason,
      summary,
    });
    notifyProgress("stopped", goal, summary);
    await options.goalStore.save(goal);
    return goal;
  }

  async function writeGoalCheckpoint(
    goal: Goal,
    reason: string,
  ): Promise<void> {
    touch(goal);
    await options.goalStore.save(goal);
    await emit(goal.id, "checkpoint_written", {
      goalId: goal.id,
      status: goal.status,
      reason,
      planVersion: goal.planVersion,
      budgetUsage: goal.budgetUsage,
    });
    notifyProgress("checkpoint", goal, `目标状态已保存：${reason}`);
  }

  async function emit(
    runId: string,
    type: AgentTrajectoryEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const event: AgentTrajectoryEvent = {
      id: options.createId?.() ?? `${type}_${Date.now()}`,
      runId,
      type,
      sequence: options.nextSequence?.() ?? 0,
      payload,
      redaction: {
        containsApiKey: false,
        containsFileContent: false,
        containsUserText: true,
      },
      createdAt: currentTime(),
    };
    await options.trajectoryStore.append(runId, event);
  }

  function currentTime(): string {
    return options.now?.() ?? new Date().toISOString();
  }

  function touch(goal: Goal): void {
    goal.updatedAt = currentTime();
  }

  return {
    async start(goalId, runOptions) {
      const goal = await loadGoal(goalId);
      if (goal.status === "planning") {
        assertGoalTransition(goal.status, "executing");
        goal.status = "executing";
        touch(goal);
        await options.goalStore.appendLedger(goal.id, {
          at: currentTime(),
          kind: "goal_planned",
          summary: "Goal execution started.",
        });
        await emit(goal.id, "goal_planned", { goalId: goal.id });
        notifyProgress("started", goal, "目标已开始执行。");
        await options.goalStore.save(goal);
      }
      return runLoop(goal, runOptions);
    },

    async resume(goalId, runOptions) {
      const goal = await loadGoal(goalId);
      if (goal.status === "waiting_for_review") {
        return goal;
      }
      if (goal.status === "planning") {
        return this.start(goalId, runOptions);
      }
      return runLoop(goal, runOptions);
    },

    async resolveReview(goalId, decision) {
      const goal = await loadGoal(goalId);
      if (goal.status !== "waiting_for_review") {
        return goal;
      }

      await options.goalStore.appendLedger(goal.id, {
        at: currentTime(),
        kind: "review_resolved",
        summary: `Review resolved with "${decision.kind}".`,
      });

      if (decision.kind === "terminate") {
        return stopGoal(
          goal,
          "canceled",
          "review_rejected",
          "Goal terminated during review.",
        );
      }

      assertGoalTransition(goal.status, "executing");
      goal.status = "executing";

      if (decision.kind === "modify_plan") {
        goal.milestones = await options.planner.replan(
          goal,
          decision.instructions,
        );
        await emit(goal.id, "goal_replanned", {
          goalId: goal.id,
          planVersion: goal.planVersion,
          replans: goal.budgetUsage.replans,
        });
      }

      touch(goal);
      await options.goalStore.save(goal);
      return runLoop(goal);
    },
  };
}

function pickNextReadyMilestone(goal: Goal): Milestone | null {
  for (const milestone of goal.milestones) {
    if (
      milestone.state === "pending" &&
      milestone.dependsOn.every((dependencyId) =>
        goal.milestones.some(
          (candidate) =>
            candidate.id === dependencyId && candidate.state === "accepted",
        ),
      )
    ) {
      milestone.state = "ready";
    }

    if (milestone.state === "ready") {
      return milestone;
    }
  }

  return null;
}

function allMilestonesAccepted(goal: Goal): boolean {
  return (
    goal.milestones.length > 0 &&
    goal.milestones.every(
      (milestone) =>
        milestone.state === "accepted" || milestone.state === "skipped",
    )
  );
}

function isBudgetExhausted(goal: Goal): boolean {
  return (
    goal.budgetUsage.iterations >= goal.budget.maxIterations ||
    goal.budgetUsage.toolCalls >= goal.budget.maxToolCalls ||
    goal.budgetUsage.wallClockMs >= goal.budget.maxWallClockMs ||
    (goal.budget.maxTokens !== undefined &&
      goal.budgetUsage.tokens >= goal.budget.maxTokens)
  );
}

function shouldRequestReview(goal: Goal, milestone: Milestone): boolean {
  return shouldRequestGoalReview(
    goal.reviewPolicy,
    milestone,
    allMilestonesAccepted(goal),
  );
}

function summarizeAcceptanceSuccess(result: AcceptanceResult): string {
  return (
    result.checkResults.find((checkResult) => checkResult.detail)?.detail ??
    "Milestone accepted."
  );
}

function summarizeAcceptanceFailure(result: AcceptanceResult): string {
  return (
    result.checkResults.find((checkResult) => !checkResult.passed)?.detail ??
    "Acceptance rejected."
  );
}
