import {
  assertGoalTransition,
  type AcceptanceFailureClass,
  type AcceptanceRepairDirective,
  type Goal,
  type GoalAcceptanceState,
  type GoalEvidenceManifest,
  type GoalStatus,
  type Milestone,
  type ProgressLedgerEvent,
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
import {
  countConsecutiveFingerprint,
  createAcceptanceFailureFingerprint,
} from "./agentGoalFailureFingerprint";
import {
  appendAcceptanceFailure,
  decideAcceptanceRepair,
  type AcceptanceRepairDecision,
} from "./agentGoalRepairPolicy";
import { createGoalAcceptanceCertificate } from "./agentGoalAcceptanceCertificate";

export type GoalRuntimeRunResult = {
  runId: string;
  toolCallCount: number;
  status?: "succeeded" | "failed" | "canceled" | "paused";
  summary?: string;
  wallClockMs?: number;
  tokens?: number;
  transcriptMessages?: ChatMessage[];
  actionSignatures?: string[];
};

export type GoalRuntimeEngine = {
  runMilestone(
    goal: Goal,
    milestone: Milestone,
    options?: {
      signal?: AbortSignal;
      repairDirective?: AcceptanceRepairDirective;
    },
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
  const publishedTerminalKeys = new Set<string>();
  const recentActionSignatures = new Map<string, string[]>();

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

  async function canonicalInterruption(
    goal: Goal,
    runOptions?: { signal?: AbortSignal },
  ): Promise<Goal | null> {
    const latest = await options.goalStore.get(goal.id);
    if (!latest) {
      return runOptions?.signal?.aborted ? goal : null;
    }
    if (
      runOptions?.signal?.aborted ||
      latest.status !== "executing" ||
      isIrreversibleGoalStatus(latest.status)
    ) {
      await publishCanonicalTerminal(latest);
      return latest;
    }
    return null;
  }

  async function publishCanonicalTerminal(goal: Goal): Promise<void> {
    if (goal.status === "executing" || goal.status === "planning") {
      return;
    }
    const key = `${goal.id}:${goal.status}:${goal.updatedAt}`;
    if (publishedTerminalKeys.has(key)) {
      return;
    }
    publishedTerminalKeys.add(key);
    await emit(goal.id, "goal_stopped", {
      goalId: goal.id,
      status: goal.status,
      stopReason: goal.stopReason,
      summary: terminalStatusMessage(goal),
    });
    notifyProgress("stopped", goal, terminalStatusMessage(goal));
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
            const validatingGoal = await persistAcceptancePhase(
              goal,
              "validating",
              true,
            );
            if (validatingGoal.status !== "executing") {
              return validatingGoal;
            }
            goal = validatingGoal;
            const result = await options.acceptance.evaluateGoal(
              goal,
              (await options.createAcceptanceContext?.(goal)) as never,
            );
            const interruptedAfterGoalReview = await canonicalInterruption(
              goal,
              runOptions,
            );
            if (interruptedAfterGoalReview) {
              return interruptedAfterGoalReview;
            }
            await recordAcceptanceManifest(goal, null, result);
            const interruptedAfterManifest = await canonicalInterruption(
              goal,
              runOptions,
            );
            if (interruptedAfterManifest) {
              return interruptedAfterManifest;
            }
            if (result.accepted) {
              return certifyOrAchieveGoal(goal, result, runOptions);
            }
            const decisionResult = await applyAcceptanceDecision(
              goal,
              null,
              result,
              recentActionSignatures.get(goal.id) ?? [],
              runOptions,
            );
            goal = decisionResult.goal;
            if (decisionResult.suspend) return goal;
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
        const milestoneResult = await runOneMilestone(
          goal,
          nextMilestone,
          runOptions,
        );
        goal = milestoneResult.goal;
        if (milestoneResult.suspend) {
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
  ): Promise<{ goal: Goal; suspend: boolean }> {
    const repairDirective = repairDirectiveForMilestone(goal, milestone);
    milestone.state = "running";
    milestone.attempts += 1;
    touch(goal);
    const startedGoal = await options.goalStore.save(goal);
    if (startedGoal.status !== goal.status) {
      notifyProgress("stopped", startedGoal, terminalStatusMessage(startedGoal));
      return { goal: startedGoal, suspend: true };
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
      {
        ...(runOptions?.signal ? { signal: runOptions.signal } : {}),
        ...(repairDirective
          ? { repairDirective }
          : {}),
      },
    );
    recentActionSignatures.set(
      goal.id,
      [...new Set(runResult.actionSignatures ?? [])].slice(0, 32),
    );
    const abortedAfterRuntime = await latestGoalAfterAbort(goal, runOptions);
    if (abortedAfterRuntime) {
      return { goal: abortedAfterRuntime, suspend: true };
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
      return { goal: usageGoal, suspend: true };
    }

    const validatingGoal = await persistAcceptancePhase(
      goal,
      "validating",
      true,
    );
    if (validatingGoal.status !== "executing") {
      return { goal: validatingGoal, suspend: true };
    }
    const acceptance = await options.acceptance.evaluate(
      milestone,
      (await options.createAcceptanceContext?.(goal, milestone, runResult)) as never,
    );
    const interruptedAfterAcceptance = await canonicalInterruption(goal, runOptions);
    if (interruptedAfterAcceptance) {
      return { goal: interruptedAfterAcceptance, suspend: true };
    }
    await recordAcceptanceManifest(goal, milestone, acceptance);
    const interruptedAfterManifest = await canonicalInterruption(goal, runOptions);
    if (interruptedAfterManifest) {
      return { goal: interruptedAfterManifest, suspend: true };
    }

    if (acceptance.accepted) {
      milestone.state = "accepted";
      milestone.lastAcceptanceSummary = summarizeAcceptanceSuccess(acceptance);
      if (goal.acceptanceState) {
        goal.acceptanceState = {
          ...goal.acceptanceState,
          phase: "idle",
          lastDecision: undefined,
        };
      }
      touch(goal);
      await options.goalStore.appendLedger(goal.id, {
        at: currentTime(),
        kind: "milestone_accepted",
        milestoneId: milestone.id,
        summary: milestone.lastAcceptanceSummary,
      });
      const checkpoint = await writeGoalCheckpoint(goal, "milestone_accepted");
      if (checkpoint.status !== goal.status) {
        return { goal: checkpoint, suspend: true };
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
          return { goal: reviewGoal, suspend: true };
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
        return { goal: reviewGoal, suspend: true };
      }

      return { goal: checkpoint, suspend: false };
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
    if (operationalBudgetExhaustion && runResult.status === "paused") {
      return {
        goal: await stopForBudgetExhaustion(goal, operationalBudgetExhaustion),
        suspend: true,
      };
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
        return { goal: pausedGoal, suspend: true };
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
      return { goal: pausedGoal, suspend: true };
    }

    const decisionResult = await applyAcceptanceDecision(
      goal,
      milestone,
      acceptance,
      runResult.actionSignatures ?? [],
      runOptions,
    );
    return decisionResult;
  }

  async function applyAcceptanceDecision(
    goal: Goal,
    target: Milestone | null,
    result: AcceptanceResult,
    actionSignatures: string[],
    runOptions?: { signal?: AbortSignal },
  ): Promise<{ goal: Goal; suspend: boolean }> {
    const targetIdentity = {
      targetKind: target ? ("milestone" as const) : ("goal" as const),
      targetId: target?.id ?? goal.id,
    };
    const state = ensureAcceptanceState(goal);
    const evidenceRefs = safeAcceptanceEvidenceRefs(result);
    const fingerprint = createAcceptanceFailureFingerprint({
      target: targetIdentity,
      failedChecks: result.checkResults,
      ...(result.evidenceManifest
        ? { evidenceManifest: result.evidenceManifest }
        : {}),
      evidenceRefs,
      actionSignatures,
      protocolVersion: goal.acceptanceProtocolVersion ?? 1,
      validatorVersions: { acceptance: "goal-acceptance-v2" },
    });
    const occurrence =
      countConsecutiveFingerprint(
        state.recentFailures,
        targetIdentity,
        fingerprint,
      ) + 1;
    const verdict = result.verdict ?? "rejected_repairable";
    const failureClass = acceptanceFailureClass(result);
    goal.acceptanceState = appendAcceptanceFailure(state, {
      at: currentTime(),
      ...targetIdentity,
      fingerprint,
      occurrence,
      verdict: verdict === "accepted" ? "rejected_repairable" : verdict,
      failureClass,
      failedCheckIds: failedCheckIds(result),
      evidenceRefs,
      actionSignatures: [...new Set(actionSignatures)].slice(0, 32),
    });
    touch(goal);
    let persisted = await options.goalStore.save(goal);
    if (persisted.status !== "executing") {
      await publishCanonicalTerminal(persisted);
      return { goal: persisted, suspend: true };
    }

    const decision = decideAcceptanceRepair({
      verdict,
      occurrence,
      fingerprint,
      checkResults: result.checkResults,
    });
    await appendAcceptanceEvent(
      persisted,
      "acceptance_failure_classified",
      target,
      decision,
      evidenceRefs,
    );
    const interruptedAfterClassification = await canonicalInterruption(
      persisted,
      runOptions,
    );
    if (interruptedAfterClassification) {
      return { goal: interruptedAfterClassification, suspend: true };
    }

    const operationalBudgetExhaustion = describeGoalBudgetExhaustion(
      persisted,
      false,
    );
    if (operationalBudgetExhaustion) {
      return {
        goal: await stopForBudgetExhaustion(
          persisted,
          operationalBudgetExhaustion,
        ),
        suspend: true,
      };
    }

    if (decision.action === "repair_same_milestone" ||
        decision.action === "retry_alternate_strategy") {
      persisted.acceptanceState = {
        ...ensureAcceptanceState(persisted),
        phase: "repairing",
        lastDecision: toRepairDirective(decision),
      };
      if (target) {
        const currentTarget = persisted.milestones.find(
          (milestone) => milestone.id === target.id,
        );
        if (currentTarget) currentTarget.state = "ready";
      } else {
        scheduleFinalRepairMilestone(persisted, decision);
      }
      touch(persisted);
      persisted = await options.goalStore.save(persisted);
      if (persisted.status !== "executing") {
        await publishCanonicalTerminal(persisted);
        return { goal: persisted, suspend: true };
      }
      await appendAcceptanceEvent(
        persisted,
        decision.action === "retry_alternate_strategy"
          ? "acceptance_strategy_changed"
          : "acceptance_repair_scheduled",
        target,
        decision,
        evidenceRefs,
      );
      const interruptedAfterRepair = await canonicalInterruption(
        persisted,
        runOptions,
      );
      return interruptedAfterRepair
        ? { goal: interruptedAfterRepair, suspend: true }
        : { goal: persisted, suspend: false };
    }

    if (decision.action === "stop_stalled") {
      persisted.acceptanceState = {
        ...ensureAcceptanceState(persisted),
        phase: "idle",
        lastDecision: toRepairDirective(decision),
      };
      touch(persisted);
      persisted = await options.goalStore.save(persisted);
      return {
        goal: await stopGoal(
          persisted,
          "stopped_stalled",
          "progress_stalled",
          decision.summary,
        ),
        suspend: true,
      };
    }

    if (decision.action === "stop_blocked") {
      if (!("blockedVerdict" in decision)) {
        throw new Error("Blocked acceptance decision is missing its verdict.");
      }
      persisted.acceptanceState = {
        ...ensureAcceptanceState(persisted),
        phase: "blocked",
        lastDecision: toRepairDirective(decision),
      };
      touch(persisted);
      persisted = await options.goalStore.save(persisted);
      if (persisted.status !== "executing") {
        await publishCanonicalTerminal(persisted);
        return { goal: persisted, suspend: true };
      }
      await appendAcceptanceEvent(
        persisted,
        "acceptance_blocked",
        target,
        decision,
        evidenceRefs,
      );
      const interruptedAfterBlocked = await canonicalInterruption(
        persisted,
        runOptions,
      );
      if (interruptedAfterBlocked) {
        return { goal: interruptedAfterBlocked, suspend: true };
      }
      return {
        goal: await stopGoal(
          persisted,
          "stopped_blocked",
          blockedStopReason(decision.blockedVerdict),
          decision.summary,
        ),
        suspend: true,
      };
    }

    const replanBudgetExhaustion = describeGoalBudgetExhaustion(persisted, true);
    if (replanBudgetExhaustion) {
      return {
        goal: await stopForBudgetExhaustion(persisted, replanBudgetExhaustion),
        suspend: true,
      };
    }
    persisted.acceptanceState = {
      ...ensureAcceptanceState(persisted),
      phase: "repairing",
      lastDecision: toRepairDirective(decision),
    };
    touch(persisted);
    persisted = await options.goalStore.save(persisted);
    if (persisted.status !== "executing") {
      await publishCanonicalTerminal(persisted);
      return { goal: persisted, suspend: true };
    }
    const replannedMilestones = await options.planner.replan(
      persisted,
      decision.summary,
    );
    const interruptedAfterReplan = await canonicalInterruption(
      persisted,
      runOptions,
    );
    if (interruptedAfterReplan) {
      return { goal: interruptedAfterReplan, suspend: true };
    }
    persisted.milestones = replannedMilestones;
    touch(persisted);
    persisted = await options.goalStore.save(persisted);
    if (persisted.status !== "executing") {
      await publishCanonicalTerminal(persisted);
      return { goal: persisted, suspend: true };
    }
    await options.goalStore.appendLedger(persisted.id, {
      at: currentTime(),
      kind: "goal_replanned",
      ...(target ? { milestoneId: target.id } : {}),
      summary: decision.summary,
      evidenceRefs,
    });
    await emit(persisted.id, "goal_replanned", {
      goalId: persisted.id,
      targetId: target?.id ?? persisted.id,
      fingerprint,
      occurrence,
      failedCheckIds: decision.failedCheckIds,
      action: decision.action,
      evidenceRefs,
      planVersion: persisted.planVersion,
      replans: persisted.budgetUsage.replans,
    });
    const interruptedAfterReplanEvent = await canonicalInterruption(
      persisted,
      runOptions,
    );
    if (interruptedAfterReplanEvent) {
      return { goal: interruptedAfterReplanEvent, suspend: true };
    }
    notifyProgress(
      "replanned",
      persisted,
      "验收发现结构性问题，已重新规划。",
      target?.id,
    );
    return { goal: persisted, suspend: false };
  }

  async function certifyOrAchieveGoal(
    goal: Goal,
    result: AcceptanceResult,
    runOptions?: { signal?: AbortSignal },
  ): Promise<Goal> {
    if (goal.acceptanceProtocolVersion !== 2) {
      return stopGoal(
        goal,
        "achieved",
        "goal_accepted",
        "Goal acceptance passed.",
      );
    }

    let certificate: Goal["acceptanceCertificate"];
    try {
      const runIds = [
        ...goal.milestones.flatMap((milestone) => milestone.runIds),
        ...(result.judge?.runIds ?? []),
      ];
      const evidenceManifest =
        result.evidenceManifest ?? emptyEvidenceManifest();
      const provenanceRefs = collectCertificateProvenanceRefs(
        result,
        evidenceManifest,
      );
      certificate = createGoalAcceptanceCertificate({
        goal,
        acceptedAt: currentTime(),
        runIds,
        checkResults: result.checkResults,
        evidenceManifest,
        ...(Object.keys(provenanceRefs).length > 0 ? { provenanceRefs } : {}),
        ...(result.judge
          ? {
              judge: {
                ...(result.judge.providerId
                  ? { providerId: result.judge.providerId }
                  : {}),
                model: result.judge.model,
                promptVersion: result.judge.promptVersion,
                evaluatedMessageIds: result.judge.evaluatedMessageIds,
              },
            }
          : {}),
      });
    } catch {
      const unavailable: AcceptanceResult = {
        accepted: false,
        verdict: "acceptance_unavailable",
        failureClass: "validator_unavailable",
        inferentialUsed: result.inferentialUsed,
        checkResults: [
          {
            checkId: result.checkResults[0]?.checkId ?? "certificate",
            kind: result.checkResults[0]?.kind ?? "assertion",
            passed: false,
            code: "certificate_invalid",
            failureClass: "validator_unavailable",
            evidenceRefs: [],
            detail: "Acceptance certificate could not be created from validated evidence.",
          },
        ],
      };
      return (
        await applyAcceptanceDecision(
          goal,
          null,
          unavailable,
          recentActionSignatures.get(goal.id) ?? [],
          runOptions,
        )
      ).goal;
    }

    const interruptedBeforeCertificate = await canonicalInterruption(
      goal,
      runOptions,
    );
    if (interruptedBeforeCertificate) {
      return interruptedBeforeCertificate;
    }
    assertGoalTransition(goal.status, "achieved");
    goal.status = "achieved";
    goal.stopReason = "goal_accepted";
    goal.acceptanceState = {
      ...ensureAcceptanceState(goal),
      phase: "certified",
      lastDecision: undefined,
    };
    goal.acceptanceCertificate = certificate;
    touch(goal);
    const persisted = await options.goalStore.save(goal);
    if (persisted.status !== "achieved") {
      await publishCanonicalTerminal(persisted);
      return persisted;
    }
    const certificatePayload = {
      goalId: persisted.id,
      targetId: persisted.id,
      fingerprint: persisted.acceptanceCertificate?.certificateHash ?? "",
      occurrence: 1,
      failedCheckIds: [] as string[],
      action: "certify",
      evidenceRefs: persisted.acceptanceCertificate?.evidence.map(
        (entry) => entry.ref,
      ) ?? [],
      certificateHash: persisted.acceptanceCertificate?.certificateHash,
    };
    await options.goalStore.appendLedger(persisted.id, {
      at: currentTime(),
      kind: "acceptance_certified",
      summary: "Goal acceptance certificate created.",
      evidenceRefs: certificatePayload.evidenceRefs,
    });
    await emit(persisted.id, "acceptance_certified", certificatePayload);
    notifyProgress(
      "acceptance_certified",
      persisted,
      "目标已通过最终验收并生成证书。",
    );
    await options.goalStore.appendLedger(persisted.id, {
      at: currentTime(),
      kind: "goal_stopped",
      summary: "Goal acceptance passed.",
    });
    await emit(persisted.id, "goal_stopped", {
      goalId: persisted.id,
      status: persisted.status,
      stopReason: persisted.stopReason,
      summary: "Goal acceptance passed.",
    });
    notifyProgress("stopped", persisted, "Goal acceptance passed.");
    return persisted;
  }

  async function persistAcceptancePhase(
    goal: Goal,
    phase: GoalAcceptanceState["phase"],
    incrementAttempt: boolean,
  ): Promise<Goal> {
    if (goal.acceptanceProtocolVersion !== 2) {
      return goal;
    }
    const state = ensureAcceptanceState(goal);
    goal.acceptanceState = {
      ...state,
      phase,
      attempt: state.attempt + (incrementAttempt ? 1 : 0),
    };
    touch(goal);
    const persisted = await options.goalStore.save(goal);
    if (persisted.status !== goal.status) {
      await publishCanonicalTerminal(persisted);
    }
    return persisted;
  }

  async function recordAcceptanceManifest(
    goal: Goal,
    target: Milestone | null,
    result: AcceptanceResult,
  ): Promise<void> {
    const evidenceRefs = safeAcceptanceEvidenceRefs(result);
    const targetIdentity = {
      targetKind: target ? ("milestone" as const) : ("goal" as const),
      targetId: target?.id ?? goal.id,
    };
    const fingerprint = createAcceptanceFailureFingerprint({
      target: targetIdentity,
      failedChecks: result.checkResults,
      ...(result.evidenceManifest
        ? { evidenceManifest: result.evidenceManifest }
        : {}),
      evidenceRefs,
      actionSignatures: recentActionSignatures.get(goal.id) ?? [],
      protocolVersion: goal.acceptanceProtocolVersion ?? 1,
      validatorVersions: { acceptance: "goal-acceptance-v2" },
    });
    const occurrence = result.accepted
      ? 0
      : countConsecutiveFingerprint(
          ensureAcceptanceState(goal).recentFailures,
          targetIdentity,
          fingerprint,
        ) + 1;
    await options.goalStore.appendLedger(goal.id, {
      at: currentTime(),
      kind: "acceptance_manifest_created",
      summary: "Acceptance evidence manifest created.",
      evidenceRefs,
    });
    await emit(goal.id, "acceptance_manifest_created", {
      goalId: goal.id,
      targetId: targetIdentity.targetId,
      fingerprint,
      occurrence,
      failedCheckIds: failedCheckIds(result),
      action: "validate",
      evidenceRefs,
    });
    notifyProgress(
      "acceptance_manifest_created",
      goal,
      "验收证据清单已生成。",
      target?.id,
    );
  }

  async function appendAcceptanceEvent(
    goal: Goal,
    kind: Extract<
      ProgressLedgerEvent["kind"],
      | "acceptance_failure_classified"
      | "acceptance_repair_scheduled"
      | "acceptance_strategy_changed"
      | "acceptance_blocked"
    >,
    target: Milestone | null,
    decision: AcceptanceRepairDecision,
    evidenceRefs: string[],
  ): Promise<void> {
    const payload = {
      goalId: goal.id,
      targetId: target?.id ?? goal.id,
      fingerprint: decision.fingerprint,
      occurrence: decision.occurrence,
      failedCheckIds: decision.failedCheckIds,
      action: decision.action,
      evidenceRefs,
    };
    await options.goalStore.appendLedger(goal.id, {
      at: currentTime(),
      kind,
      summary: decision.summary,
      ...(target ? { milestoneId: target.id } : {}),
      evidenceRefs,
    });
    await emit(goal.id, kind, payload);
    const progressMessage = {
      acceptance_failure_classified: `验收失败已分类，涉及 ${decision.failedCheckIds.length} 项检查。`,
      acceptance_repair_scheduled: `已安排定向验收修复（${Math.min(decision.occurrence, 2)}/2）。`,
      acceptance_strategy_changed: "验收修复已切换策略（2/2）。",
      acceptance_blocked: "目标验收受阻，需要人工处理后再继续。",
    }[kind];
    notifyProgress(kind, goal, progressMessage, target?.id);
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

function ensureAcceptanceState(goal: Goal): GoalAcceptanceState {
  return (
    goal.acceptanceState ?? {
      protocolVersion: 2,
      phase: "idle",
      attempt: 0,
      recentFailures: [],
    }
  );
}

function acceptanceFailureClass(result: AcceptanceResult): AcceptanceFailureClass {
  return (
    result.failureClass ??
    result.checkResults.find((check) => !check.passed)?.failureClass ??
    "unknown"
  );
}

function failedCheckIds(result: AcceptanceResult): string[] {
  return [
    ...new Set(
      result.checkResults
        .filter((check) => !check.passed)
        .map((check) => check.checkId),
    ),
  ].sort();
}

function safeAcceptanceEvidenceRefs(result: AcceptanceResult): string[] {
  const refs = [
    ...result.checkResults.flatMap((check) => check.evidenceRefs),
    ...(result.evidenceManifest?.artifacts.map((artifact) => artifact.ref) ?? []),
  ];
  return [...new Set(refs.map(redactEvidenceRef).filter(Boolean))]
    .sort()
    .slice(0, 64);
}

function redactEvidenceRef(ref: string): string {
  const bounded = String(ref).slice(0, 512);
  return bounded.replace(
    /((?:api[_-]?key|access[_-]?token|authorization|password|secret)=)[^&\s]+/gi,
    "$1[redacted]",
  );
}

function toRepairDirective(
  decision: AcceptanceRepairDecision,
): AcceptanceRepairDirective {
  if (decision.action === "certify") {
    throw new Error("Certification is not a repair directive.");
  }
  return {
    action: decision.action,
    summary: decision.summary,
    failedCheckIds: [...decision.failedCheckIds],
    fingerprint: decision.fingerprint,
    occurrence: decision.occurrence,
    instructions: [...decision.instructions],
  };
}

function blockedStopReason(
  verdict: "blocked_external" | "impossible" | "acceptance_unavailable",
): StopReason {
  return {
    blocked_external: "external_blocked",
    impossible: "goal_impossible",
    acceptance_unavailable: "acceptance_unavailable",
  }[verdict] as StopReason;
}

function scheduleFinalRepairMilestone(
  goal: Goal,
  decision: Exclude<AcceptanceRepairDecision, { action: "certify" }>,
): void {
  const repairId = `repair_${decision.fingerprint.slice(0, 12)}`;
  const failedIds = new Set(decision.failedCheckIds);
  const successCriteria = goal.successCriteria
    .map((criterion) => ({
      ...criterion,
      acceptanceChecks: criterion.acceptanceChecks.filter((check) =>
        failedIds.has(check.id),
      ),
    }))
    .filter((criterion) => criterion.acceptanceChecks.length > 0);
  const dependencies = goal.milestones
    .filter(
      (milestone) =>
        milestone.id !== repairId &&
        (milestone.state === "accepted" || milestone.state === "skipped"),
    )
    .map((milestone) => milestone.id);
  const existing = goal.milestones.find((milestone) => milestone.id === repairId);
  if (existing) {
    existing.description = `Repair final acceptance checks: ${decision.failedCheckIds.join(", ")}`;
    existing.dependsOn = dependencies;
    existing.successCriteria = successCriteria;
    existing.state = "ready";
    return;
  }
  goal.milestones.push({
    id: repairId,
    description: `Repair final acceptance checks: ${decision.failedCheckIds.join(", ")}`,
    dependsOn: dependencies,
    successCriteria,
    state: "ready",
    runIds: [],
    attempts: 0,
  });
}

function repairDirectiveForMilestone(
  goal: Goal,
  milestone: Milestone,
): AcceptanceRepairDirective | undefined {
  const directive = goal.acceptanceState?.lastDecision;
  const lastFailure = goal.acceptanceState?.recentFailures.at(-1);
  if (!directive || !lastFailure) return undefined;
  if (
    lastFailure.targetId === milestone.id ||
    (lastFailure.targetKind === "goal" &&
      milestone.id === `repair_${lastFailure.fingerprint.slice(0, 12)}`)
  ) {
    return directive;
  }
  return undefined;
}

function emptyEvidenceManifest() {
  return {
    version: 1 as const,
    generatedAt: new Date(0).toISOString(),
    artifacts: [],
    totalRenderedChars: 0,
    truncated: false,
  };
}

function collectCertificateProvenanceRefs(
  result: AcceptanceResult,
  manifest: GoalEvidenceManifest,
): Record<string, string[]> {
  const manifestRefs = new Set(manifest.artifacts.map((artifact) => artifact.ref));
  const collected = new Map<string, Set<string>>();
  for (const check of result.checkResults) {
    const artifactRefs = check.evidenceRefs.filter((ref) => manifestRefs.has(ref));
    const provenanceRefs = check.evidenceRefs.filter(
      (ref) => ref.startsWith("provenance:") || ref.startsWith("trajectory_"),
    );
    const owners =
      artifactRefs.length > 0
        ? artifactRefs
        : manifest.artifacts.length === 1
          ? [manifest.artifacts[0]!.ref]
          : [];
    for (const owner of owners) {
      const refs = collected.get(owner) ?? new Set<string>();
      for (const ref of provenanceRefs) refs.add(ref);
      if (refs.size > 0) collected.set(owner, refs);
    }
  }
  return Object.fromEntries(
    [...collected.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([ref, refs]) => [ref, [...refs].sort()]),
  );
}
