import {
  assertGoalTransition,
  type Goal,
  type GoalStatus,
  type Milestone,
  type StopReason,
  type SuccessCriterion,
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
  type ActiveRunEntry = {
    promise: Promise<Goal>;
    signal?: AbortSignal;
  };
  const activeRuns = new Map<string, ActiveRunEntry>();

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
    const existing = activeRuns.get(goal.id);
    if (existing && !existing.signal?.aborted) {
      return existing.promise;
    }

    const entry: ActiveRunEntry = {
      signal: runOptions?.signal,
      promise: Promise.resolve(goal),
    };
    entry.promise = runLoopInternal(goal, runOptions).finally(() => {
      if (activeRuns.get(goal.id) === entry) {
        activeRuns.delete(goal.id);
      }
    });
    activeRuns.set(goal.id, entry);
    return entry.promise;
  }

  async function latestGoalAfterAbort(
    goal: Goal,
    runOptions?: { signal?: AbortSignal },
  ): Promise<Goal | null> {
    if (!runOptions?.signal?.aborted) {
      return null;
    }
    return (await options.goalStore.get(goal.id)) ?? goal;
  }

  async function runLoopInternal(
    goal: Goal,
    runOptions?: { signal?: AbortSignal },
  ) {
    let stalledIterations = 0;

    try {
      while (goal.status === "executing") {
        const abortedGoal = await latestGoalAfterAbort(goal, runOptions);
        if (abortedGoal) {
          return abortedGoal;
        }

        const nextMilestone = pickNextReadyMilestone(goal);
        if (!nextMilestone) {
          if (allMilestonesAccepted(goal)) {
            if (canAcceptCoveredGoal(goal)) {
              return stopGoal(
                goal,
                "achieved",
                "goal_accepted",
                "Goal acceptance passed from accepted milestone evidence.",
              );
            }

            const result = await options.acceptance.evaluateGoal(
              goal,
              (await options.createAcceptanceContext?.(goal)) as never,
            );
            const abortedAfterGoalReview = await latestGoalAfterAbort(
              goal,
              runOptions,
            );
            if (abortedAfterGoalReview) {
              return abortedAfterGoalReview;
            }
            if (result.accepted) {
              return stopGoal(
                goal,
                "achieved",
                "goal_accepted",
                "Goal acceptance passed.",
              );
            }

            const reason = summarizeAcceptanceFailure(result);
            const budgetExhaustion = describeGoalBudgetExhaustion(goal, true);
            if (budgetExhaustion) {
              return stopForBudgetExhaustion(goal, budgetExhaustion);
            }

            const replannedMilestones = await options.planner.replan(goal, reason);
            const abortedAfterReplan = await latestGoalAfterAbort(
              goal,
              runOptions,
            );
            if (abortedAfterReplan) {
              return abortedAfterReplan;
            }
            goal.milestones = replannedMilestones;
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
            const checkpoint = await writeGoalCheckpoint(
              goal,
              "goal_acceptance_replanned",
            );
            if (checkpoint.status !== goal.status) {
              return checkpoint;
            }
            continue;
          }

          const budgetExhaustion = describeGoalBudgetExhaustion(goal, false);
          if (budgetExhaustion) {
            return stopForBudgetExhaustion(goal, budgetExhaustion);
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

        const budgetExhaustion = describeGoalBudgetExhaustion(goal, false);
        if (budgetExhaustion) {
          return stopForBudgetExhaustion(goal, budgetExhaustion);
        }

        stalledIterations = 0;
        const shouldSuspend = await runOneMilestone(
          goal,
          nextMilestone,
          runOptions,
        );
        if (shouldSuspend) {
          return (await options.goalStore.get(goal.id)) ?? goal;
        }
      }

      return goal;
    } catch (error) {
      const abortedGoal = await latestGoalAfterAbort(goal, runOptions);
      if (abortedGoal) {
        return abortedGoal;
      }
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
    const startedGoal = await options.goalStore.save(goal);
    if (startedGoal.status !== goal.status) {
      notifyProgress("stopped", startedGoal, terminalStatusMessage(startedGoal));
      return true;
    }
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
    if (await latestGoalAfterAbort(goal, runOptions)) {
      return true;
    }
    milestone.runIds.push(runResult.runId);
    milestone.lastRunStatus = runResult.status ?? "succeeded";
    if (runResult.summary) {
      milestone.lastRunSummary = runResult.summary;
    }
    goal.budgetUsage.iterations += 1;
    goal.budgetUsage.toolCalls += runResult.toolCallCount;
    goal.budgetUsage.wallClockMs += runResult.wallClockMs ?? 0;
    goal.budgetUsage.tokens += runResult.tokens ?? 0;
    touch(goal);
    const usageGoal = await options.goalStore.save(goal);
    if (usageGoal.status !== goal.status) {
      notifyProgress("stopped", usageGoal, terminalStatusMessage(usageGoal));
      return true;
    }

    const acceptance = await options.acceptance.evaluate(
      milestone,
      (await options.createAcceptanceContext?.(goal, milestone, runResult)) as never,
    );
    if (await latestGoalAfterAbort(goal, runOptions)) {
      return true;
    }

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
      const checkpoint = await writeGoalCheckpoint(goal, "milestone_accepted");
      if (checkpoint.status !== goal.status) {
        return true;
      }
      notifyProgress(
        "milestone_accepted",
        checkpoint,
        milestone.lastAcceptanceSummary ?? `里程碑已完成：${milestone.description}`,
        milestone.id,
      );

      if (shouldRequestReview(goal, milestone)) {
        goal.status = "waiting_for_review";
        touch(goal);
        const reviewGoal = await options.goalStore.save(goal);
        if (reviewGoal.status !== goal.status) {
          notifyProgress("stopped", reviewGoal, terminalStatusMessage(reviewGoal));
          return true;
        }
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
          reviewGoal,
          "里程碑完成，等待你审核。",
          milestone.id,
        );
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

    if (runResult.status === "paused") {
      milestone.state = "ready";
      touch(goal);
    }

    const operationalBudgetExhaustion = describeGoalBudgetExhaustion(goal, false);
    if (operationalBudgetExhaustion) {
      await stopForBudgetExhaustion(goal, operationalBudgetExhaustion);
      return true;
    }

    if (runResult.status === "paused") {
      assertGoalTransition(goal.status, "waiting_for_review");
      goal.status = "waiting_for_review";
      touch(goal);
      const pauseSummary = [
        "Milestone paused at its turn limit and is waiting for review.",
        runResult.summary,
      ]
        .filter(Boolean)
        .join(" ");
      const pausedGoal = await options.goalStore.save(goal);
      if (pausedGoal.status !== goal.status) {
        notifyProgress("stopped", pausedGoal, terminalStatusMessage(pausedGoal));
        return true;
      }
      await options.goalStore.appendLedger(goal.id, {
        at: currentTime(),
        kind: "review_requested",
        milestoneId: milestone.id,
        summary: pauseSummary,
      });
      await emit(goal.id, "goal_review_requested", {
        goalId: goal.id,
        milestoneId: milestone.id,
        reason: "turn_limit",
      });
      notifyProgress(
        "review_requested",
        pausedGoal,
        "里程碑达到本轮执行上限，目标已暂停；请审核后继续或调整计划。",
        milestone.id,
      );
      return true;
    }

    const replanBudgetExhaustion = describeGoalBudgetExhaustion(goal, true);
    if (replanBudgetExhaustion) {
      await stopForBudgetExhaustion(goal, replanBudgetExhaustion);
      return true;
    }

    const replannedMilestones = await options.planner.replan(
      goal,
      milestone.lastAcceptanceSummary,
    );
    if (await latestGoalAfterAbort(goal, runOptions)) {
      return true;
    }
    goal.milestones = replannedMilestones;
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
    const replannedGoal = await writeGoalCheckpoint(goal, "goal_replanned");
    return replannedGoal.status !== goal.status;
  }

  async function stopForBudgetExhaustion(
    goal: Goal,
    detail: string,
  ): Promise<Goal> {
    return stopGoal(
      goal,
      "stopped_budget",
      "budget_exhausted",
      `Goal budget exhausted: ${detail}.`,
    );
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
    const persisted = await options.goalStore.save(goal);
    if (persisted.status !== status) {
      notifyProgress("stopped", persisted, terminalStatusMessage(persisted));
      return persisted;
    }
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
    notifyProgress("stopped", persisted, summary);
    return persisted;
  }

  async function writeGoalCheckpoint(
    goal: Goal,
    reason: string,
  ): Promise<Goal> {
    touch(goal);
    const saved = await options.goalStore.save(goal);
    await emit(goal.id, "checkpoint_written", {
      goalId: goal.id,
      status: saved.status,
      reason,
      planVersion: saved.planVersion,
      budgetUsage: saved.budgetUsage,
    });
    const latest = await options.goalStore.get(goal.id);
    const persisted =
      latest && isIrreversibleGoalStatus(latest.status) ? latest : saved;
    notifyProgress("checkpoint", persisted, `目标状态已保存：${reason}`);
    return persisted;
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
        const persisted = await options.goalStore.save(goal);
        if (persisted.status !== goal.status) {
          return persisted;
        }
        await options.goalStore.appendLedger(goal.id, {
          at: currentTime(),
          kind: "goal_planned",
          summary: "Goal execution started.",
        });
        await emit(goal.id, "goal_planned", { goalId: goal.id });
        notifyProgress("started", persisted, "目标已开始执行。");
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
      }

      touch(goal);
      const persisted = await options.goalStore.save(goal);
      if (persisted.status !== goal.status) {
        return persisted;
      }

      if (decision.kind === "modify_plan") {
        await emit(goal.id, "goal_replanned", {
          goalId: goal.id,
          planVersion: persisted.planVersion,
          replans: persisted.budgetUsage.replans,
        });
      }

      notifyProgress("started", persisted, "审核已通过，目标继续执行。");
      void runLoop(persisted).catch(() => undefined);
      return persisted;
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

function describeGoalBudgetExhaustion(
  goal: Goal,
  includeReplans: boolean,
): string | null {
  if (goal.budgetUsage.iterations >= goal.budget.maxIterations) {
    return `iterations ${goal.budgetUsage.iterations}/${goal.budget.maxIterations}`;
  }
  if (goal.budgetUsage.toolCalls >= goal.budget.maxToolCalls) {
    return `tool calls ${goal.budgetUsage.toolCalls}/${goal.budget.maxToolCalls}`;
  }
  if (goal.budgetUsage.wallClockMs >= goal.budget.maxWallClockMs) {
    return `wall clock ${goal.budgetUsage.wallClockMs}/${goal.budget.maxWallClockMs}ms`;
  }
  if (
    goal.budget.maxTokens !== undefined &&
    goal.budgetUsage.tokens >= goal.budget.maxTokens
  ) {
    return `tokens ${goal.budgetUsage.tokens}/${goal.budget.maxTokens}`;
  }
  if (includeReplans && goal.budgetUsage.replans >= goal.budget.maxReplans) {
    return `replans ${goal.budgetUsage.replans}/${goal.budget.maxReplans}`;
  }
  return null;
}

function isIrreversibleGoalStatus(status: GoalStatus): boolean {
  return status === "achieved" || status === "canceled";
}

function terminalStatusMessage(goal: Goal): string {
  if (goal.status === "achieved") {
    return "目标已达成。";
  }
  if (goal.status === "canceled") {
    return "目标已取消。";
  }
  return "目标已停止。";
}

function canAcceptCoveredGoal(goal: Goal): boolean {
  const goalChecks = goal.successCriteria.flatMap(
    (criterion) => criterion.acceptanceChecks,
  );
  if (goalChecks.length === 0) {
    return false;
  }
  if (
    !isEvidenceBackedModelReviewOnly(goalChecks) &&
    !isProvenanceArtifactFileExistsOnly(goalChecks)
  ) {
    return false;
  }

  const acceptedMilestones = goal.milestones.filter(
    (milestone) => milestone.state === "accepted" || milestone.state === "skipped",
  );
  const coveredCheckSignatures = new Set(
    acceptedMilestones.flatMap((milestone) =>
      milestone.successCriteria.flatMap((criterion) =>
        criterion.acceptanceChecks.map(createAcceptanceCheckSignature),
      ),
    ),
  );
  const hasAcceptedRunEvidence = acceptedMilestones.some((milestone) =>
    Boolean(milestone.lastRunSummary?.trim() || milestone.lastAcceptanceSummary?.trim()),
  );

  return (
    hasAcceptedRunEvidence &&
    goalChecks.every((check) =>
      coveredCheckSignatures.has(createAcceptanceCheckSignature(check)),
    )
  );
}

function isEvidenceBackedModelReviewOnly(
  checks: SuccessCriterion["acceptanceChecks"],
): boolean {
  return checks.every(
    (check) => check.kind === "model_review" && check.requiresEvidence,
  );
}

function isProvenanceArtifactFileExistsOnly(
  checks: SuccessCriterion["acceptanceChecks"],
): boolean {
  return checks.every(
    (check) =>
      check.kind === "file_exists" &&
      check.params.requireProvenance === true &&
      typeof check.params.artifactRef === "string" &&
      check.params.artifactRef.trim().length > 0,
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

function createAcceptanceCheckSignature(
  check: SuccessCriterion["acceptanceChecks"][number],
): string {
  return JSON.stringify({
    kind: check.kind,
    description: check.description,
    requiresEvidence: check.requiresEvidence,
    params: stableJsonValue(check.params),
  });
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJsonValue(entry)]),
    );
  }
  return value;
}
