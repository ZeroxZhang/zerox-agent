import {
  assertGoalTransition,
  upgradeGoalAcceptanceProtocol,
  type AcceptanceFailureClass,
  type AcceptanceRepairDirective,
  type Goal,
  type GoalAcceptanceState,
  type GoalEvidenceManifest,
  type GoalManualCompletionAttestation,
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
  createAcceptanceLogicalFailureFingerprint,
  sanitizeActionSignaturesForPersistence,
} from "./agentGoalFailureFingerprint";
import {
  appendAcceptanceFailure,
  decideAcceptanceRepair,
  type AcceptanceRepairDecision,
} from "./agentGoalRepairPolicy";
import { createGoalAcceptanceCertificate } from "./agentGoalAcceptanceCertificate";
import {
  redactAndBoundAcceptanceSummary,
  redactAndBoundEvidenceRef,
} from "./agentGoalRedaction";
import {
  decideFinalAcceptanceRetry,
  FINAL_ACCEPTANCE_MAX_ATTEMPTS,
} from "./agentGoalAcceptanceRetryPolicy";
import { boundRuntimeTranscript } from "./runtimeTranscript";

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

export type GoalRuntimeProgressCheckpoint = {
  transcriptMessages: ChatMessage[];
  toolCallCount: number;
  wallClockMs: number;
  tokens: number;
  nextAction: string;
};

export type GoalRuntimeEngine = {
  runMilestone(
    goal: Goal,
    milestone: Milestone,
    options?: {
      signal?: AbortSignal;
      repairDirective?: AcceptanceRepairDirective;
      resumeMessages?: ChatMessage[];
      onCheckpoint?: (
        checkpoint: GoalRuntimeProgressCheckpoint,
      ) => Promise<void>;
    },
  ): Promise<GoalRuntimeRunResult>;
};

export type AgentGoalController = {
  start(goalId: string, options?: { signal?: AbortSignal }): Promise<Goal>;
  resume(goalId: string, options?: { signal?: AbortSignal }): Promise<Goal>;
  continueAcceptance(
    goalId: string,
    options?: { signal?: AbortSignal },
  ): Promise<Goal>;
  markCompletedUnverified(goalId: string): Promise<Goal>;
  resolveReview(goalId: string, decision: GoalReviewDecision): Promise<Goal>;
};

export function createAgentGoalController(options: {
  goalStore: AgentGoalStore;
  runtimeEngine: GoalRuntimeEngine;
  acceptance: Pick<AgentGoalAcceptance, "evaluate" | "evaluateGoal">;
  planner: Pick<AgentGoalPlanner, "replan">;
  trajectoryStore: Pick<
    AgentTrajectoryStore,
    "append" | "appendIfAbsent" | "list"
  >;
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
  onActiveGoalChange?: (goalId: string, active: boolean) => void;
  acceptanceRetry?: {
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    nowMs?: () => number;
  };
}): AgentGoalController {
  const stallThreshold = options.stallThreshold ?? 3;
  type InternalRunOptions = {
    signal?: AbortSignal;
    finalAcceptanceContinuation?: boolean;
  };
  type ActiveRunEntry = {
    promise: Promise<Goal>;
    signal?: AbortSignal;
  };
  const activeRuns = new Map<string, ActiveRunEntry>();
  const runOwnersByGoal = new Map<string, Set<ActiveRunEntry>>();
  const publishedTerminalVersions = new Map<string, string>();
  const recentActionSignatures = new Map<string, string[]>();
  const nonterminalPublications = new Map<string, Set<Promise<void>>>();
  const manualCompletionPublications = new Map<string, Promise<void>>();

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

  async function createRunAcceptanceContext(
    goal: Goal,
    runOptions?: { signal?: AbortSignal },
    milestone?: Milestone,
    runResult?: GoalRuntimeRunResult,
  ): Promise<AcceptanceContext | undefined> {
    const context = await options.createAcceptanceContext?.(
      goal,
      milestone,
      runResult,
    );
    if (!context) return undefined;
    return {
      ...context,
      ...(runOptions?.signal ? { signal: runOptions.signal } : {}),
    };
  }

  async function runLoop(goal: Goal, runOptions?: InternalRunOptions) {
    const existing = activeRuns.get(goal.id);
    if (existing && !existing.signal?.aborted) {
      return existing.promise;
    }

    const entry: ActiveRunEntry = {
      signal: runOptions?.signal,
      promise: Promise.resolve(goal),
    };
    entry.promise = runLoopInternal(goal, runOptions).then(async (result) => {
      const replacement = activeRuns.get(goal.id);
      if (runOptions?.signal?.aborted && replacement && replacement !== entry) {
        const canonical = await options.goalStore.get(goal.id);
        if (canonical && isTerminalGoalStatus(canonical.status)) {
          return canonical;
        }
      }
      return result;
    }).finally(() => {
      if (activeRuns.get(goal.id) === entry) {
        activeRuns.delete(goal.id);
      }
      const owners = runOwnersByGoal.get(goal.id);
      owners?.delete(entry);
      if (owners?.size === 0) runOwnersByGoal.delete(goal.id);
      clearGoalRuntimeStateIfIdle(goal.id);
      if (!activeRuns.has(goal.id)) {
        options.onActiveGoalChange?.(goal.id, false);
      }
    });
    const owners = runOwnersByGoal.get(goal.id) ?? new Set<ActiveRunEntry>();
    owners.add(entry);
    runOwnersByGoal.set(goal.id, owners);
    activeRuns.set(goal.id, entry);
    options.onActiveGoalChange?.(goal.id, true);
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
    if (!isTerminalGoalStatus(goal.status)) {
      return;
    }
    await waitForNonterminalPublications(goal.id);
    const canonical = (await options.goalStore.get(goal.id)) ?? goal;
    if (!isTerminalGoalStatus(canonical.status)) {
      return;
    }
    if (isManualCompletionGoal(canonical)) {
      await publishManualCompletionSequence(canonical);
      recentActionSignatures.delete(canonical.id);
      return;
    }
    await publishTerminalGoalEvent(canonical, terminalStatusMessage(canonical));
    recentActionSignatures.delete(canonical.id);
  }

  async function publishTerminalGoalEvent(
    canonical: Goal,
    summary: string,
  ): Promise<void> {
    const version = `${canonical.status}:${canonical.updatedAt}`;
    if (publishedTerminalVersions.get(canonical.id) === version) return;
    const ledger = await options.goalStore.readLedger(canonical.id);
    const terminalEvents = ledger.filter(
      (event) => event.kind === "goal_stopped",
    );
    const lastEvent = ledger.at(-1);
    const occurrence = lastEvent?.kind === "goal_stopped"
      ? terminalEvents.length
      : terminalEvents.length + 1;
    const publicationKey = lastEvent?.kind === "goal_stopped"
      ? lastEvent.publicationKey ??
        `goal_stopped:${canonical.id}:${version}:${occurrence}`
      : `goal_stopped:${canonical.id}:${version}:${occurrence}`;
    if (lastEvent?.kind !== "goal_stopped") {
      await options.goalStore.appendLedgerIfAbsent(
        canonical.id,
        publicationKey,
        {
          at: currentTime(),
          kind: "goal_stopped",
          summary,
        },
      );
    }
    const trajectoryAppended = await emitIfAbsent(
      canonical.id,
      "goal_stopped",
      {
        goalId: canonical.id,
        status: canonical.status,
        stopReason: canonical.stopReason,
        summary,
        terminalVersion: version,
      },
      publicationKey,
    );
    publishedTerminalVersions.set(canonical.id, version);
    if (trajectoryAppended) {
      notifyProgress("stopped", canonical, summary);
    }
  }

  function beginNonterminalPublication(goalId: string): () => void {
    let releasePromise: (() => void) | undefined;
    const publication = new Promise<void>((resolve) => {
      releasePromise = resolve;
    });
    const active = nonterminalPublications.get(goalId) ?? new Set<Promise<void>>();
    active.add(publication);
    nonterminalPublications.set(goalId, active);
    return () => {
      releasePromise?.();
      active.delete(publication);
      if (active.size === 0 && nonterminalPublications.get(goalId) === active) {
        nonterminalPublications.delete(goalId);
      }
    };
  }

  async function waitForNonterminalPublications(goalId: string): Promise<void> {
    while (true) {
      const active = nonterminalPublications.get(goalId);
      if (!active || active.size === 0) return;
      await Promise.allSettled([...active]);
    }
  }

  async function settleSuppressedPublication(goal: Goal): Promise<Goal> {
    const canonical = (await options.goalStore.get(goal.id)) ?? goal;
    if (isTerminalGoalStatus(canonical.status)) {
      await publishCanonicalTerminal(canonical);
    }
    return canonical;
  }

  async function publishNonterminalGoalEvent(input: {
    goal: Goal;
    allowedStatuses: GoalStatus[];
    ledger?: ProgressLedgerEvent;
    trajectory?: {
      type: AgentTrajectoryEventType;
      payload: Record<string, unknown>;
    };
    progress?: {
      event: GoalProgressEvent["event"];
      message: string;
      milestoneId?: string;
    };
    signal?: AbortSignal;
  }): Promise<Goal | null> {
    const release = beginNonterminalPublication(input.goal.id);
    const loadAllowed = async (): Promise<Goal | null> => {
      throwIfPublicationAborted(input.signal);
      const canonical = await options.goalStore.get(input.goal.id);
      return canonical && input.allowedStatuses.includes(canonical.status)
        ? canonical
        : null;
    };
    try {
      let canonical = await loadAllowed();
      if (!canonical) return null;
      if (input.ledger) {
        await options.goalStore.appendLedger(input.goal.id, input.ledger);
        canonical = await loadAllowed();
        if (!canonical) return null;
      }
      if (input.trajectory) {
        canonical = await loadAllowed();
        if (!canonical) return null;
        await emit(
          input.goal.id,
          input.trajectory.type,
          input.trajectory.payload,
          input.signal,
        );
        canonical = await loadAllowed();
        if (!canonical) return null;
      }
      if (input.progress) {
        notifyProgress(
          input.progress.event,
          canonical,
          input.progress.message,
          input.progress.milestoneId,
        );
      }
      return canonical;
    } finally {
      release();
    }
  }

  function clearGoalRuntimeStateIfIdle(goalId: string): void {
    if ((runOwnersByGoal.get(goalId)?.size ?? 0) > 0) return;
    recentActionSignatures.delete(goalId);
    publishedTerminalVersions.delete(goalId);
  }

  async function runLoopInternal(
    goal: Goal,
    runOptions?: InternalRunOptions,
  ) {
    let stalledIterations = 0;
    let finalAcceptanceCycleAttempt = 0;

    try {
      while (goal.status === "executing") {
        const abortedGoal = await latestGoalAfterAbort(goal, runOptions);
        if (abortedGoal) {
          return abortedGoal;
        }

        const nextMilestone = pickNextReadyMilestone(goal);
        if (!nextMilestone) {
          if (allMilestonesAccepted(goal)) {
            const finalBudgetExhaustion = runOptions?.finalAcceptanceContinuation
              ? null
              : describeGoalBudgetExhaustion(goal, false);
            if (finalBudgetExhaustion) {
              return stopForBudgetExhaustion(goal, finalBudgetExhaustion);
            }
            const validatingGoal = await persistAcceptancePhase(
              goal,
              "validating",
              true,
            );
            if (validatingGoal.status !== "executing") {
              return validatingGoal;
            }
            goal = validatingGoal;
            finalAcceptanceCycleAttempt += 1;
            const currentFinalAcceptanceAttempt = finalAcceptanceCycleAttempt;
            const result = await racePublicationWithAbort(
              options.acceptance.evaluateGoal(
                goal,
                (await createRunAcceptanceContext(goal, runOptions)) as never,
              ),
              runOptions?.signal,
            );
            const interruptedAfterGoalReview = await canonicalInterruption(
              goal,
              runOptions,
            );
            if (interruptedAfterGoalReview) {
              return interruptedAfterGoalReview;
            }
            if (!(await recordAcceptanceManifest(goal, null, result, runOptions))) {
              return settleSuppressedPublication(goal);
            }
            const interruptedAfterManifest = await canonicalInterruption(
              goal,
              runOptions,
            );
            if (interruptedAfterManifest) {
              return interruptedAfterManifest;
            }
            if (result.accepted) {
              const retryState = goal.acceptanceRetryState;
              const currentFingerprint = finalAcceptanceEvidenceFingerprint(
                goal,
                result,
              );
              if (
                retryState &&
                retryState.evidenceFingerprint !== currentFingerprint
              ) {
                return waitForChangedFinalAcceptanceEvidence(
                  goal,
                  result,
                  currentFingerprint,
                  runOptions,
                );
              }
              return certifyOrAchieveGoal(goal, result, runOptions);
            }
            const retryDecision = goal.acceptanceProtocolVersion === 2
              ? decideFinalAcceptanceRetry(
                  result,
                  currentFinalAcceptanceAttempt,
                  options.acceptanceRetry?.nowMs?.() ?? Date.now(),
                )
              : { action: "not_applicable" as const };
            if (retryDecision.action === "retry") {
              const retryingGoal = await scheduleFinalAcceptanceRetry(
                goal,
                result,
                retryDecision,
                currentFinalAcceptanceAttempt,
                runOptions,
              );
              if (retryingGoal.status !== "executing") {
                return retryingGoal;
              }
              goal = retryingGoal;
              await acceptanceRetryDelay(
                retryDecision.delayMs,
                runOptions?.signal,
              );
              const interruptedAfterRetryDelay = await canonicalInterruption(
                goal,
                runOptions,
              );
              if (interruptedAfterRetryDelay) {
                return interruptedAfterRetryDelay;
              }
              if (!(await appendFinalAcceptanceRetryEvent(
                goal,
                result,
                "acceptance_retry_started",
                retryDecision,
                runOptions,
              ))) {
                return settleSuppressedPublication(goal);
              }
              continue;
            }
            const decisionResult = await applyAcceptanceDecision(
              goal,
              null,
              result,
              recentActionSignatures.get(goal.id) ?? [],
              runOptions,
              { finalAcceptanceAttempt: currentFinalAcceptanceAttempt },
            );
            if (retryDecision.action === "not_applicable") {
              finalAcceptanceCycleAttempt = 0;
            }
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
        if (isTerminalGoalStatus(abortedGoal.status)) {
          await publishCanonicalTerminal(abortedGoal);
        }
        return abortedGoal;
      }
      const summary = error instanceof Error ? error.message : "目标运行时发生未知错误。";
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
      await publishCanonicalTerminal(startedGoal);
      return { goal: startedGoal, suspend: true };
    }
    if (!(await publishNonterminalGoalEvent({
      goal: startedGoal,
      allowedStatuses: ["executing"],
      ledger: {
        at: currentTime(),
        kind: "milestone_started",
        milestoneId: milestone.id,
        summary: `Started milestone "${milestone.id}".`,
      },
      trajectory: {
        type: "milestone_started",
        payload: { goalId: goal.id, milestoneId: milestone.id },
      },
      progress: {
        event: "milestone_started",
        message: `里程碑开始：${milestone.description}`,
        milestoneId: milestone.id,
      },
      signal: runOptions?.signal,
    }))) {
      return {
        goal: await settleSuppressedPublication(startedGoal),
        suspend: true,
      };
    }

    let checkpointedToolCalls = 0;
    let checkpointedWallClockMs = 0;
    let checkpointedTokens = 0;
    const checkpoint = goal.runtimeCheckpoint;
    const canResumeCheckpoint = Boolean(
      checkpoint &&
        (checkpoint.milestoneId === milestone.id || repairDirective),
    );
    const runResult = await options.runtimeEngine.runMilestone(
      goal,
      milestone,
      {
        ...(runOptions?.signal ? { signal: runOptions.signal } : {}),
        ...(canResumeCheckpoint && checkpoint
          ? {
              resumeMessages: checkpoint.transcriptMessages,
            }
          : {}),
        ...(repairDirective
          ? { repairDirective }
          : {}),
        async onCheckpoint(runtimeCheckpoint) {
          if (runOptions?.signal?.aborted) return;
          const canonical = await options.goalStore.get(goal.id);
          if (!canonical || canonical.status !== "executing") return;

          goal.runtimeCheckpoint = {
            milestoneId: milestone.id,
            transcriptMessages: boundRuntimeCheckpointMessages(
              runtimeCheckpoint.transcriptMessages,
            ),
            nextAction: runtimeCheckpoint.nextAction,
            updatedAt: currentTime(),
          };
          goal.budgetUsage.toolCalls += Math.max(
            0,
            runtimeCheckpoint.toolCallCount - checkpointedToolCalls,
          );
          goal.budgetUsage.wallClockMs += Math.max(
            0,
            runtimeCheckpoint.wallClockMs - checkpointedWallClockMs,
          );
          goal.budgetUsage.tokens += Math.max(
            0,
            runtimeCheckpoint.tokens - checkpointedTokens,
          );
          checkpointedToolCalls = runtimeCheckpoint.toolCallCount;
          checkpointedWallClockMs = runtimeCheckpoint.wallClockMs;
          checkpointedTokens = runtimeCheckpoint.tokens;
          touch(goal);
          const saved = await options.goalStore.save(goal);
          if (saved.status === "executing") {
            notifyProgress(
              "checkpoint",
              saved,
              `已保存里程碑运行检查点：${milestone.description}`,
              milestone.id,
            );
          }
        },
      },
    );
    const abortedAfterRuntime = await latestGoalAfterAbort(goal, runOptions);
    if (abortedAfterRuntime) {
      return { goal: abortedAfterRuntime, suspend: true };
    }
    recentActionSignatures.set(
      goal.id,
      sanitizeActionSignaturesForPersistence(runResult.actionSignatures ?? []),
    );
    milestone.runIds.push(runResult.runId);
    milestone.lastRunStatus = runResult.status ?? "succeeded";
    if (runResult.summary) {
      milestone.lastRunSummary = runResult.summary;
    }
    if (runResult.transcriptMessages?.length) {
      goal.runtimeCheckpoint = {
        milestoneId: milestone.id,
        transcriptMessages: boundRuntimeCheckpointMessages(
          runResult.transcriptMessages,
        ),
        nextAction:
          repairDirective?.summary ??
          `Continue milestone ${milestone.id} from the latest tool result.`,
        updatedAt: currentTime(),
      };
    }
    goal.budgetUsage.iterations += 1;
    goal.budgetUsage.toolCalls += Math.max(
      0,
      runResult.toolCallCount - checkpointedToolCalls,
    );
    goal.budgetUsage.wallClockMs += Math.max(
      0,
      (runResult.wallClockMs ?? 0) - checkpointedWallClockMs,
    );
    goal.budgetUsage.tokens += Math.max(
      0,
      (runResult.tokens ?? 0) - checkpointedTokens,
    );
    touch(goal);
    const usageGoal = await options.goalStore.save(goal);
    if (usageGoal.status !== goal.status) {
      await publishCanonicalTerminal(usageGoal);
      return { goal: usageGoal, suspend: true };
    }
    if (runResult.status === "paused") {
      milestone.state = "ready";
      touch(goal);
    }

    const acceptanceBudgetExhaustion = describeGoalBudgetExhaustion(
      usageGoal,
      false,
    );
    if (acceptanceBudgetExhaustion) {
      if (milestone.state === "running") {
        milestone.state = "ready";
        touch(usageGoal);
      }
      return {
        goal: await stopForBudgetExhaustion(
          usageGoal,
          acceptanceBudgetExhaustion,
        ),
        suspend: true,
      };
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
      (await createRunAcceptanceContext(
        goal,
        runOptions,
        milestone,
        runResult,
      )) as never,
    );
    const interruptedAfterAcceptance = await canonicalInterruption(goal, runOptions);
    if (interruptedAfterAcceptance) {
      return { goal: interruptedAfterAcceptance, suspend: true };
    }
    if (!(await recordAcceptanceManifest(goal, milestone, acceptance, runOptions))) {
      return {
        goal: await settleSuppressedPublication(goal),
        suspend: true,
      };
    }
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
      if (!(await publishNonterminalGoalEvent({
        goal,
        allowedStatuses: ["executing"],
        ledger: {
          at: currentTime(),
          kind: "milestone_accepted",
          milestoneId: milestone.id,
          summary: milestone.lastAcceptanceSummary,
        },
        signal: runOptions?.signal,
      }))) {
        return {
          goal: await settleSuppressedPublication(goal),
          suspend: true,
        };
      }
      const checkpoint = await writeGoalCheckpoint(
        goal,
        "milestone_accepted",
        runOptions,
      );
      if (checkpoint.status !== goal.status) {
        return { goal: checkpoint, suspend: true };
      }
      if (!(await publishNonterminalGoalEvent({
        goal: checkpoint,
        allowedStatuses: ["executing"],
        progress: {
          event: "milestone_accepted",
          message:
            milestone.lastAcceptanceSummary ??
            `里程碑已完成：${milestone.description}`,
          milestoneId: milestone.id,
        },
        signal: runOptions?.signal,
      }))) {
        return {
          goal: await settleSuppressedPublication(checkpoint),
          suspend: true,
        };
      }

      if (shouldRequestReview(goal, milestone)) {
        goal.status = "waiting_for_review";
        touch(goal);
        const reviewGoal = await options.goalStore.save(goal);
        if (reviewGoal.status !== goal.status) {
          await publishCanonicalTerminal(reviewGoal);
          return { goal: reviewGoal, suspend: true };
        }
        if (!(await publishNonterminalGoalEvent({
          goal: reviewGoal,
          allowedStatuses: ["waiting_for_review"],
          ledger: {
            at: currentTime(),
            kind: "review_requested",
            milestoneId: milestone.id,
            summary: `Review requested after milestone "${milestone.id}".`,
          },
          trajectory: {
            type: "goal_review_requested",
            payload: { goalId: goal.id, milestoneId: milestone.id },
          },
          progress: {
            event: "review_requested",
            message: "里程碑完成，等待你审核。",
            milestoneId: milestone.id,
          },
          signal: runOptions?.signal,
        }))) {
          return {
            goal: await settleSuppressedPublication(reviewGoal),
            suspend: true,
          };
        }
        return { goal: reviewGoal, suspend: true };
      }

      return { goal: checkpoint, suspend: false };
    }

    milestone.state = "rejected";
    milestone.lastAcceptanceSummary = summarizeAcceptanceFailure(acceptance);
    touch(goal);
    if (!(await publishNonterminalGoalEvent({
      goal,
      allowedStatuses: ["executing"],
      ledger: {
        at: currentTime(),
        kind: "milestone_rejected",
        milestoneId: milestone.id,
        summary: milestone.lastAcceptanceSummary,
      },
      progress: {
        event: "milestone_rejected",
        message:
          milestone.lastAcceptanceSummary ??
          `里程碑未通过：${milestone.description}`,
        milestoneId: milestone.id,
      },
      signal: runOptions?.signal,
    }))) {
      return {
        goal: await settleSuppressedPublication(goal),
        suspend: true,
      };
    }

    const decisionResult = await applyAcceptanceDecision(
      goal,
      milestone,
      acceptance,
      runResult.actionSignatures ?? [],
      runOptions,
      {
        pauseAfterRepair: runResult.status === "paused",
        ...(runResult.summary ? { pauseSummary: runResult.summary } : {}),
      },
    );
    return decisionResult;
  }

  async function applyAcceptanceDecision(
    goal: Goal,
    target: Milestone | null,
    result: AcceptanceResult,
    actionSignatures: string[],
    runOptions?: { signal?: AbortSignal },
    decisionOptions: {
      pauseAfterRepair?: boolean;
      pauseSummary?: string;
      finalAcceptanceAttempt?: number;
    } = {},
  ): Promise<{ goal: Goal; suspend: boolean }> {
    const safeActionSignatures = sanitizeActionSignaturesForPersistence(
      actionSignatures,
    );
    const targetIdentity = {
      targetKind: target ? ("milestone" as const) : ("goal" as const),
      targetId: target?.id ?? goal.id,
    };
    const state = ensureAcceptanceState(goal);
    const evidenceRefs = safeAcceptanceEvidenceRefs(result);
    const fingerprint = createAcceptanceLogicalFailureFingerprint({
      target: targetIdentity,
      failedChecks: result.checkResults,
      ...(result.evidenceManifest
        ? { evidenceManifest: result.evidenceManifest }
        : {}),
      evidenceRefs,
      actionSignatures: safeActionSignatures,
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
      actionSignatures: safeActionSignatures,
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
      targetKind: targetIdentity.targetKind,
      infrastructureFailure:
        goal.acceptanceProtocolVersion === 2 && Boolean(result.retry),
    });
    if (!(await appendAcceptanceEvent(
      persisted,
      "acceptance_failure_classified",
      target,
      decision,
      evidenceRefs,
      runOptions,
    ))) {
      return {
        goal: await settleSuppressedPublication(persisted),
        suspend: true,
      };
    }
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
      if (!(await appendAcceptanceEvent(
        persisted,
        decision.action === "retry_alternate_strategy"
          ? "acceptance_strategy_changed"
          : "acceptance_repair_scheduled",
        target,
        decision,
        evidenceRefs,
        runOptions,
      ))) {
        return {
          goal: await settleSuppressedPublication(persisted),
          suspend: true,
        };
      }
      const interruptedAfterRepair = await canonicalInterruption(
        persisted,
        runOptions,
      );
      if (interruptedAfterRepair) {
        return { goal: interruptedAfterRepair, suspend: true };
      }
      return { goal: persisted, suspend: false };
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

    if (decision.action === "wait_for_acceptance") {
      return {
        goal: await waitForFinalAcceptance(
          persisted,
          result,
          decision,
          finalAcceptanceEvidenceFingerprint(persisted, result),
          decisionOptions.finalAcceptanceAttempt ?? 1,
          runOptions,
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
      if (!(await appendAcceptanceEvent(
        persisted,
        "acceptance_blocked",
        target,
        decision,
        evidenceRefs,
        runOptions,
      ))) {
        return {
          goal: await settleSuppressedPublication(persisted),
          suspend: true,
        };
      }
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
    if (!(await publishNonterminalGoalEvent({
      goal: persisted,
      allowedStatuses: ["executing"],
      ledger: {
        at: currentTime(),
        kind: "goal_replanned",
        ...(target ? { milestoneId: target.id } : {}),
        summary: decision.summary,
        evidenceRefs,
      },
      trajectory: {
        type: "goal_replanned",
        payload: {
          goalId: persisted.id,
          targetId: target?.id ?? persisted.id,
          fingerprint,
          occurrence,
          failedCheckIds: decision.failedCheckIds,
          action: decision.action,
          evidenceRefs,
          planVersion: persisted.planVersion,
          replans: persisted.budgetUsage.replans,
        },
      },
      progress: {
        event: "replanned",
        message: "验收发现结构性问题，已重新规划。",
        ...(target ? { milestoneId: target.id } : {}),
      },
      signal: runOptions?.signal,
    }))) {
      return {
        goal: await settleSuppressedPublication(persisted),
        suspend: true,
      };
    }
    const interruptedAfterReplanEvent = await canonicalInterruption(
      persisted,
      runOptions,
    );
    if (interruptedAfterReplanEvent) {
      return { goal: interruptedAfterReplanEvent, suspend: true };
    }
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
    const certifiedGoal = persisted;
    const releaseCertificationPublication = beginNonterminalPublication(
      certifiedGoal.id,
    );
    const certificatePayload = {
      goalId: certifiedGoal.id,
      targetId: certifiedGoal.id,
      fingerprint: certifiedGoal.acceptanceCertificate?.certificateHash ?? "",
      occurrence: 1,
      failedCheckIds: [] as string[],
      action: "certify",
      evidenceRefs: certifiedGoal.acceptanceCertificate?.evidence.map(
        (entry) => entry.ref,
      ) ?? [],
      certificateHash: certifiedGoal.acceptanceCertificate?.certificateHash,
    };
    let certificatePublished = false;
    let certificatePublicationError: unknown;
    try {
      certificatePublished = Boolean(await publishNonterminalGoalEvent({
        goal: certifiedGoal,
        allowedStatuses: ["achieved"],
        ledger: {
          at: currentTime(),
          kind: "acceptance_certified",
          summary: "Goal acceptance certificate created.",
          evidenceRefs: certificatePayload.evidenceRefs,
        },
        trajectory: {
          type: "acceptance_certified",
          payload: certificatePayload,
        },
        progress: {
          event: "acceptance_certified",
          message: "目标已通过最终验收并生成证书。",
        },
        signal: runOptions?.signal,
      }));
    } catch (error) {
      certificatePublicationError = error;
    } finally {
      releaseCertificationPublication();
    }
    if (certificatePublicationError !== undefined) {
      if (!runOptions?.signal?.aborted) throw certificatePublicationError;
      await publishCanonicalTerminal(certifiedGoal);
      return certifiedGoal;
    }
    if (!certificatePublished) {
      return settleSuppressedPublication(certifiedGoal);
    }
    await publishTerminalGoalEvent(certifiedGoal, "Goal acceptance passed.");
    clearGoalRuntimeStateIfIdle(certifiedGoal.id);
    return certifiedGoal;
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
    runOptions?: { signal?: AbortSignal },
  ): Promise<boolean> {
    const evidenceRefs = safeAcceptanceEvidenceRefs(result);
    const targetIdentity = {
      targetKind: target ? ("milestone" as const) : ("goal" as const),
      targetId: target?.id ?? goal.id,
    };
    const fingerprint = createAcceptanceLogicalFailureFingerprint({
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
    return Boolean(await publishNonterminalGoalEvent({
      goal,
      allowedStatuses: ["executing"],
      ledger: {
        at: currentTime(),
        kind: "acceptance_manifest_created",
        summary: "Acceptance evidence manifest created.",
        evidenceRefs,
      },
      trajectory: {
        type: "acceptance_manifest_created",
        payload: {
          goalId: goal.id,
          targetId: targetIdentity.targetId,
          fingerprint,
          occurrence,
          failedCheckIds: failedCheckIds(result),
          action: "validate",
          evidenceRefs,
        },
      },
      progress: {
        event: "acceptance_manifest_created",
        message: "验收证据清单已生成。",
        ...(target ? { milestoneId: target.id } : {}),
      },
      signal: runOptions?.signal,
    }));
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
    runOptions?: { signal?: AbortSignal },
  ): Promise<boolean> {
    const payload = {
      goalId: goal.id,
      targetId: target?.id ?? goal.id,
      fingerprint: decision.fingerprint,
      occurrence: decision.occurrence,
      failedCheckIds: decision.failedCheckIds,
      action: decision.action,
      evidenceRefs,
    };
    const progressMessage = {
      acceptance_failure_classified: `验收失败已分类，涉及 ${decision.failedCheckIds.length} 项检查。`,
      acceptance_repair_scheduled: `已安排定向验收修复（${Math.min(decision.occurrence, 2)}/2）。`,
      acceptance_strategy_changed: "验收修复已切换策略（2/2）。",
      acceptance_blocked: "目标验收受阻，需要人工处理后再继续。",
    }[kind];
    return Boolean(await publishNonterminalGoalEvent({
      goal,
      allowedStatuses: ["executing"],
      ledger: {
        at: currentTime(),
        kind,
        summary: decision.summary,
        ...(target ? { milestoneId: target.id } : {}),
        evidenceRefs,
      },
      trajectory: { type: kind, payload },
      progress: {
        event: kind,
        message: progressMessage,
        ...(target ? { milestoneId: target.id } : {}),
      },
      signal: runOptions?.signal,
    }));
  }

  async function scheduleFinalAcceptanceRetry(
    goal: Goal,
    result: AcceptanceResult,
    decision: Extract<
      ReturnType<typeof decideFinalAcceptanceRetry>,
      { action: "retry" }
    >,
    attempt: number,
    runOptions?: { signal?: AbortSignal },
  ): Promise<Goal> {
    const maxAttempts = maxFinalAcceptanceAttempts(decision.code);
    const evidenceFingerprint = finalAcceptanceEvidenceFingerprint(goal, result);
    goal.acceptanceState = {
      ...ensureAcceptanceState(goal),
      phase: "retrying",
    };
    goal.acceptanceRetryState = {
      cycle: goal.acceptanceRetryState?.cycle ?? 1,
      attempt,
      maxAttempts,
      lastCode: decision.code,
      lastDetail: safeAcceptanceRetryDetail(result),
      nextRetryAt: decision.nextRetryAt,
      evidenceFingerprint,
      resumeFrom: "final_judge",
    };
    touch(goal);
    const persisted = await options.goalStore.save(goal);
    if (persisted.status !== "executing") {
      await publishCanonicalTerminal(persisted);
      return persisted;
    }
    if (!(await appendFinalAcceptanceRetryEvent(
      persisted,
      result,
      "acceptance_retry_scheduled",
      decision,
      runOptions,
    ))) {
      return settleSuppressedPublication(persisted);
    }
    return persisted;
  }

  async function waitForFinalAcceptance(
    goal: Goal,
    result: AcceptanceResult,
    decision: Extract<
      AcceptanceRepairDecision,
      { action: "wait_for_acceptance" }
    >,
    evidenceFingerprint: string,
    attempt: number,
    runOptions?: { signal?: AbortSignal },
  ): Promise<Goal> {
    const maxAttempts =
      goal.acceptanceRetryState?.maxAttempts ??
      maxFinalAcceptanceAttempts(result.retry?.code ?? "");
    assertGoalTransition(goal.status, "waiting_for_acceptance");
    goal.status = "waiting_for_acceptance";
    goal.stopReason = undefined;
    goal.acceptanceCertificate = undefined;
    goal.acceptanceState = {
      ...ensureAcceptanceState(goal),
      phase: "awaiting_user",
      lastDecision: toRepairDirective(decision),
    };
    goal.acceptanceRetryState = {
      cycle: goal.acceptanceRetryState?.cycle ?? 1,
      attempt,
      maxAttempts,
      lastCode: result.retry?.code ?? "acceptance_unavailable",
      lastDetail: safeAcceptanceRetryDetail(result),
      evidenceFingerprint,
      resumeFrom: "final_judge",
    };
    touch(goal);
    const persisted = await options.goalStore.save(goal);
    if (persisted.status !== "waiting_for_acceptance") {
      if (isTerminalGoalStatus(persisted.status)) {
        await publishCanonicalTerminal(persisted);
      }
      return persisted;
    }
    if (!(await appendFinalAcceptanceWaitingEvent(
      persisted,
      result,
      decision,
      "acceptance_retry_exhausted",
      runOptions,
    ))) {
      return settleSuppressedPublication(persisted);
    }
    if (!(await appendFinalAcceptanceWaitingEvent(
      persisted,
      result,
      decision,
      "acceptance_waiting_for_user",
      runOptions,
    ))) {
      return settleSuppressedPublication(persisted);
    }
    return persisted;
  }

  async function appendFinalAcceptanceWaitingEvent(
    goal: Goal,
    result: AcceptanceResult,
    decision: Extract<
      AcceptanceRepairDecision,
      { action: "wait_for_acceptance" }
    >,
    kind: "acceptance_retry_exhausted" | "acceptance_waiting_for_user",
    runOptions?: { signal?: AbortSignal },
  ): Promise<boolean> {
    const retryState = goal.acceptanceRetryState;
    const evidenceRefs = safeAcceptanceEvidenceRefs(result);
    const summary = kind === "acceptance_retry_exhausted"
      ? `Final acceptance retry attempts exhausted (${retryState?.attempt}/${retryState?.maxAttempts}).`
      : decision.summary;
    return Boolean(await publishNonterminalGoalEvent({
      goal,
      allowedStatuses: ["waiting_for_acceptance"],
      ledger: {
        at: currentTime(),
        kind,
        summary,
        evidenceRefs,
      },
      trajectory: {
        type: kind,
        payload: {
          goalId: goal.id,
          targetId: goal.id,
          fingerprint: retryState?.evidenceFingerprint ?? "",
          occurrence: retryState?.attempt ?? 0,
          failedCheckIds: decision.failedCheckIds,
          action: decision.action,
          evidenceRefs,
          code: retryState?.lastCode,
          attempt: retryState?.attempt,
          maxAttempts: retryState?.maxAttempts,
        },
      },
      progress: {
        event: kind,
        message: kind === "acceptance_retry_exhausted"
          ? "最终验收自动重试已耗尽。"
          : "任务工作已完成，等待你继续最终验收。",
      },
      signal: runOptions?.signal,
    }));
  }

  async function waitForChangedFinalAcceptanceEvidence(
    goal: Goal,
    result: AcceptanceResult,
    evidenceFingerprint: string,
    runOptions?: { signal?: AbortSignal },
  ): Promise<Goal> {
    const retryState = goal.acceptanceRetryState;
    assertGoalTransition(goal.status, "waiting_for_acceptance");
    goal.status = "waiting_for_acceptance";
    goal.stopReason = undefined;
    goal.acceptanceCertificate = undefined;
    goal.acceptanceState = {
      ...ensureAcceptanceState(goal),
      phase: "awaiting_user",
      lastDecision: undefined,
    };
    goal.acceptanceRetryState = {
      cycle: retryState?.cycle ?? 1,
      attempt: retryState?.attempt ?? 0,
      maxAttempts: retryState?.maxAttempts ?? FINAL_ACCEPTANCE_MAX_ATTEMPTS,
      lastCode: "evidence_fingerprint_mismatch",
      lastDetail:
        "Final acceptance evidence changed. Review the current artifacts before continuing.",
      evidenceFingerprint,
      resumeFrom: "final_judge",
    };
    touch(goal);
    const persisted = await options.goalStore.save(goal);
    if (persisted.status !== "waiting_for_acceptance") {
      if (isTerminalGoalStatus(persisted.status)) {
        await publishCanonicalTerminal(persisted);
      }
      return persisted;
    }
    const evidenceRefs = safeAcceptanceEvidenceRefs(result);
    const published = await publishNonterminalGoalEvent({
      goal: persisted,
      allowedStatuses: ["waiting_for_acceptance"],
      ledger: {
        at: currentTime(),
        kind: "acceptance_waiting_for_user",
        summary:
          "Final acceptance evidence changed; waiting for explicit user continuation.",
        evidenceRefs,
      },
      trajectory: {
        type: "acceptance_waiting_for_user",
        payload: {
          goalId: persisted.id,
          targetId: persisted.id,
          fingerprint: evidenceFingerprint,
          occurrence: retryState?.attempt ?? 0,
          failedCheckIds: [],
          action: "wait_for_acceptance",
          evidenceRefs,
          code: "evidence_fingerprint_mismatch",
          attempt: retryState?.attempt ?? 0,
          maxAttempts:
            retryState?.maxAttempts ?? FINAL_ACCEPTANCE_MAX_ATTEMPTS,
        },
      },
      progress: {
        event: "acceptance_waiting_for_user",
        message: "最终验收证据已变化，请确认后再次继续验收。",
      },
      signal: runOptions?.signal,
    });
    return published ? persisted : settleSuppressedPublication(persisted);
  }

  async function appendFinalAcceptanceRetryEvent(
    goal: Goal,
    result: AcceptanceResult,
    kind: "acceptance_retry_scheduled" | "acceptance_retry_started",
    decision: Extract<
      ReturnType<typeof decideFinalAcceptanceRetry>,
      { action: "retry" }
    >,
    runOptions?: { signal?: AbortSignal },
  ): Promise<boolean> {
    const retryState = goal.acceptanceRetryState;
    const nextAttempt = Math.min(
      (retryState?.attempt ?? 0) + 1,
      retryState?.maxAttempts ?? FINAL_ACCEPTANCE_MAX_ATTEMPTS,
    );
    const maxAttempts = retryState?.maxAttempts ?? FINAL_ACCEPTANCE_MAX_ATTEMPTS;
    const evidenceRefs = safeAcceptanceEvidenceRefs(result);
    const summary = kind === "acceptance_retry_scheduled"
      ? `Final acceptance retry ${nextAttempt}/${maxAttempts} scheduled.`
      : `Final acceptance retry ${nextAttempt}/${maxAttempts} started.`;
    return Boolean(await publishNonterminalGoalEvent({
      goal,
      allowedStatuses: ["executing"],
      ledger: {
        at: currentTime(),
        kind,
        summary,
        evidenceRefs,
      },
      trajectory: {
        type: kind,
        payload: {
          goalId: goal.id,
          targetId: goal.id,
          fingerprint: retryState?.evidenceFingerprint ?? "",
          occurrence: retryState?.attempt ?? 0,
          failedCheckIds: failedCheckIds(result),
          action: kind === "acceptance_retry_scheduled" ? "retry" : "retry_started",
          evidenceRefs,
          code: decision.code,
          attempt: retryState?.attempt,
          maxAttempts,
          delayMs: decision.delayMs,
          nextRetryAt: decision.nextRetryAt,
        },
      },
      progress: {
        event: kind,
        message: `正在重试最终验收（${nextAttempt}/${maxAttempts}）`,
      },
      signal: runOptions?.signal,
    }));
  }

  async function acceptanceRetryDelay(
    delayMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const sleep = options.acceptanceRetry?.sleep ?? defaultAbortableSleep;
    await racePublicationWithAbort(sleep(delayMs, signal), signal);
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
      if (persisted.status !== "executing" && persisted.status !== "planning") {
        await publishCanonicalTerminal(persisted);
      }
      clearGoalRuntimeStateIfIdle(persisted.id);
      return persisted;
    }
    await waitForNonterminalPublications(persisted.id);
    const canonical = (await options.goalStore.get(persisted.id)) ?? persisted;
    if (canonical.status === "executing" || canonical.status === "planning") {
      clearGoalRuntimeStateIfIdle(canonical.id);
      return canonical;
    }
    const canonicalSummary = canonical.status === status
      ? summary
      : terminalStatusMessage(canonical);
    await publishTerminalGoalEvent(canonical, canonicalSummary);
    clearGoalRuntimeStateIfIdle(canonical.id);
    return canonical;
  }

  async function writeGoalCheckpoint(
    goal: Goal,
    reason: string,
    runOptions?: { signal?: AbortSignal },
  ): Promise<Goal> {
    touch(goal);
    const saved = await options.goalStore.save(goal);
    const published = await publishNonterminalGoalEvent({
      goal: saved,
      allowedStatuses: [saved.status],
      trajectory: {
        type: "checkpoint_written",
        payload: {
          goalId: goal.id,
          status: saved.status,
          reason,
          planVersion: saved.planVersion,
          budgetUsage: saved.budgetUsage,
        },
      },
      progress: {
        event: "checkpoint",
        message: `目标状态已保存：${reason}`,
      },
      signal: runOptions?.signal,
    });
    if (!published) return settleSuppressedPublication(saved);
    const latest = await options.goalStore.get(goal.id);
    const persisted =
      latest && isIrreversibleGoalStatus(latest.status) ? latest : saved;
    return persisted;
  }

  async function emit(
    runId: string,
    type: AgentTrajectoryEventType,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
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
    throwIfPublicationAborted(signal);
    const append = options.trajectoryStore.append(runId, event, { signal });
    void append.catch(() => {
      // A canceled append may reject after the controller has moved on.
    });
    await racePublicationWithAbort(append, signal);
    throwIfPublicationAborted(signal);
  }

  async function emitIfAbsent(
    runId: string,
    type: AgentTrajectoryEventType,
    payload: Record<string, unknown>,
    publicationKey: string,
  ): Promise<boolean> {
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
    const result = await options.trajectoryStore.appendIfAbsent(
      runId,
      publicationKey,
      event,
    );
    return result.appended;
  }

  function racePublicationWithAbort<T>(
    operation: Promise<T>,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    if (!signal) return operation;
    throwIfPublicationAborted(signal);
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      };
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort, { once: true });
      operation.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
  }

  function throwIfPublicationAborted(signal: AbortSignal | undefined): void {
    if (!signal?.aborted) return;
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }

  function currentTime(): string {
    return options.now?.() ?? new Date().toISOString();
  }

  function touch(goal: Goal): void {
    goal.updatedAt = currentTime();
  }

  function createManualCompletionAttestation(
    goal: Goal,
  ): GoalManualCompletionAttestation {
    const retryState = goal.acceptanceRetryState;
    if (!retryState || !/^[a-f0-9]{64}$/.test(retryState.evidenceFingerprint)) {
      throw new Error(
        "Cannot manually complete goal without a canonical evidence fingerprint.",
      );
    }
    if (!Number.isSafeInteger(retryState.cycle) || retryState.cycle < 1) {
      throw new Error(
        "Cannot manually complete goal without a canonical retry cycle.",
      );
    }
    const latestFinalFailure = goal.acceptanceState?.recentFailures
      .filter(
        (failure) =>
          failure.targetKind === "goal" && failure.targetId === goal.id,
      )
      .at(-1);
    const lastFailureCode = redactAndBoundEvidenceRef(retryState.lastCode);
    if (!lastFailureCode) {
      throw new Error(
        "Cannot manually complete goal without a canonical failure code.",
      );
    }
    return {
      version: 1,
      goalId: goal.id,
      completedAt: currentTime(),
      reason: "user_marked_complete",
      failedCheckIds: boundManualCompletionStrings(
        latestFinalFailure?.failedCheckIds,
      ),
      evidenceRefs: boundManualCompletionStrings(
        latestFinalFailure?.evidenceRefs,
      ),
      evidenceFingerprint: retryState.evidenceFingerprint,
      lastFailureCode,
      retryCycles: retryState.cycle,
    };
  }

  function manualCompletionPayload(
    attestation: GoalManualCompletionAttestation,
  ): Record<string, unknown> {
    return {
      goalId: attestation.goalId,
      fingerprint: attestation.evidenceFingerprint,
      failedCheckIds: attestation.failedCheckIds,
      evidenceRefs: attestation.evidenceRefs,
      code: attestation.lastFailureCode,
      retryCycles: attestation.retryCycles,
      reason: attestation.reason,
    };
  }

  async function publishManualCompletionRecorded(goal: Goal): Promise<void> {
    const attestation = goal.manualCompletionAttestation;
    if (
      goal.status !== "completed_unverified" ||
      goal.stopReason !== "user_marked_complete" ||
      !attestation
    ) {
      return;
    }
    const publicationKey =
      `manual_completion_recorded:${goal.id}:${attestation.evidenceFingerprint}`;
    await options.goalStore.appendLedgerIfAbsent(
      goal.id,
      publicationKey,
      {
        at: currentTime(),
        kind: "acceptance_manual_completion_recorded",
        summary: "Manual completion recorded without certification.",
        evidenceRefs: attestation.evidenceRefs,
      },
    );
    const trajectoryAppended = await emitIfAbsent(
      goal.id,
      "acceptance_manual_completion_recorded",
      manualCompletionPayload(attestation),
      publicationKey,
    );
    if (trajectoryAppended) {
      notifyProgress(
        "acceptance_manual_completion_recorded",
        goal,
        "目标已手动标记为完成（未验证）。",
      );
    }
  }

  function publishManualCompletionSequence(goal: Goal): Promise<void> {
    const previous = manualCompletionPublications.get(goal.id) ??
      Promise.resolve();
    const publication = previous.catch(() => undefined).then(async () => {
      const canonical = (await options.goalStore.get(goal.id)) ?? goal;
      if (!isManualCompletionGoal(canonical)) return;
      const release = beginNonterminalPublication(canonical.id);
      try {
        await publishManualCompletionRecorded(canonical);
        await publishTerminalGoalEvent(
          canonical,
          terminalStatusMessage(canonical),
        );
      } finally {
        release();
      }
    });
    manualCompletionPublications.set(goal.id, publication);
    void publication.finally(() => {
      if (manualCompletionPublications.get(goal.id) === publication) {
        manualCompletionPublications.delete(goal.id);
      }
    }).catch(() => undefined);
    return publication;
  }

  async function recoverManualCompletion(goal: Goal): Promise<Goal> {
    await publishManualCompletionSequence(goal);
    return (await options.goalStore.get(goal.id)) ?? goal;
  }

  function assertManualCompletionStatus(goal: Goal): void {
    if (goal.status !== "waiting_for_acceptance") {
      throw new Error(`Cannot manually complete goal from "${goal.status}".`);
    }
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
        if (!(await publishNonterminalGoalEvent({
          goal: persisted,
          allowedStatuses: ["executing"],
          ledger: {
            at: currentTime(),
            kind: "goal_planned",
            summary: "Goal execution started.",
          },
          trajectory: {
            type: "goal_planned",
            payload: { goalId: goal.id },
          },
          progress: {
            event: "started",
            message: "目标已开始执行。",
          },
          signal: runOptions?.signal,
        }))) {
          return settleSuppressedPublication(persisted);
        }
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

    async continueAcceptance(goalId, runOptions) {
      const goal = await loadGoal(goalId);
      const waitingForAcceptance = goal.status === "waiting_for_acceptance";
      const eligibleLegacy =
        goal.status === "stopped_blocked" &&
        goal.stopReason === "acceptance_unavailable" &&
        allMilestonesAccepted(goal);
      if (!waitingForAcceptance && !eligibleLegacy) {
        return goal;
      }
      if (!allMilestonesAccepted(goal)) {
        return goal;
      }
      if (
        waitingForAcceptance &&
        goal.acceptanceRetryState?.resumeFrom !== "final_judge"
      ) {
        return goal;
      }

      assertGoalTransition(goal.status, "executing");
      const upgraded = upgradeGoalAcceptanceProtocol(goal);
      const previousRetryState = upgraded.acceptanceRetryState;
      const candidate: Goal = {
        ...upgraded,
        status: "executing",
        stopReason: undefined,
        acceptanceCertificate: undefined,
        acceptanceState: {
          ...ensureAcceptanceState(upgraded),
          phase: "retrying",
          lastDecision: undefined,
        },
        ...(previousRetryState
          ? {
              acceptanceRetryState: {
                cycle: previousRetryState.cycle + 1,
                attempt: 0,
                maxAttempts: previousRetryState.maxAttempts,
                lastCode: previousRetryState.lastCode,
                lastDetail: previousRetryState.lastDetail,
                evidenceFingerprint: previousRetryState.evidenceFingerprint,
                resumeFrom: "final_judge" as const,
              },
            }
          : {}),
      };
      touch(candidate);
      const persisted = await options.goalStore.save(candidate);
      if (persisted.status !== "executing") {
        if (isTerminalGoalStatus(persisted.status)) {
          await publishCanonicalTerminal(persisted);
        }
        return persisted;
      }
      return runLoop(persisted, {
        ...runOptions,
        finalAcceptanceContinuation: true,
      });
    },

    async markCompletedUnverified(goalId) {
      const loaded = await loadGoal(goalId);
      if (
        loaded.status === "completed_unverified" &&
        loaded.stopReason === "user_marked_complete" &&
        loaded.manualCompletionAttestation
      ) {
        return recoverManualCompletion(loaded);
      }
      assertManualCompletionStatus(loaded);
      createManualCompletionAttestation(loaded);

      const release = beginNonterminalPublication(goalId);
      let persisted: Goal | undefined;
      try {
        let canonical = await loadGoal(goalId);
        assertManualCompletionStatus(canonical);
        let attestation = createManualCompletionAttestation(canonical);
        await options.goalStore.appendLedger(goalId, {
          at: currentTime(),
          kind: "acceptance_manual_completion_requested",
          summary: "Manual completion requested.",
          evidenceRefs: attestation.evidenceRefs,
        });
        canonical = await loadGoal(goalId);
        assertManualCompletionStatus(canonical);
        await emit(
          goalId,
          "acceptance_manual_completion_requested",
          manualCompletionPayload(attestation),
        );
        notifyProgress(
          "acceptance_manual_completion_requested",
          canonical,
          "已请求手动标记完成。",
        );

        canonical = await loadGoal(goalId);
        assertManualCompletionStatus(canonical);
        attestation = createManualCompletionAttestation(canonical);
        const candidate: Goal = {
          ...canonical,
          status: "completed_unverified",
          stopReason: "user_marked_complete",
          acceptanceCertificate: undefined,
          manualCompletionAttestation: attestation,
          updatedAt: attestation.completedAt,
        };
        const transition = await options.goalStore.saveIfStatus(
          candidate,
          "waiting_for_acceptance",
        );
        persisted = transition.goal ?? (await loadGoal(goalId));
      } finally {
        release();
      }

      if (!persisted) {
        return loadGoal(goalId);
      }
      await publishCanonicalTerminal(persisted);
      return (await options.goalStore.get(goalId)) ?? persisted;
    },

    async resolveReview(goalId, decision) {
      const goal = await loadGoal(goalId);
      if (goal.status !== "waiting_for_review") {
        return goal;
      }

      if (!(await publishNonterminalGoalEvent({
        goal,
        allowedStatuses: ["waiting_for_review"],
        ledger: {
          at: currentTime(),
          kind: "review_resolved",
          summary: `Review resolved with "${decision.kind}".`,
        },
      }))) {
        return settleSuppressedPublication(goal);
      }

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

      if (!(await publishNonterminalGoalEvent({
        goal: persisted,
        allowedStatuses: ["executing"],
        ...(decision.kind === "modify_plan"
          ? {
              trajectory: {
                type: "goal_replanned" as const,
                payload: {
                  goalId: goal.id,
                  planVersion: persisted.planVersion,
                  replans: persisted.budgetUsage.replans,
                },
              },
            }
          : {}),
        progress: {
          event: "started",
          message: "审核已通过，目标继续执行。",
        },
      }))) {
        return settleSuppressedPublication(persisted);
      }
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
            candidate.id === dependencyId &&
            (candidate.state === "accepted" || candidate.state === "skipped"),
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
  return (
    status === "achieved" ||
    status === "completed_unverified" ||
    status === "canceled"
  );
}

function isManualCompletionGoal(goal: Goal): boolean {
  return (
    goal.status === "completed_unverified" &&
    goal.stopReason === "user_marked_complete" &&
    Boolean(goal.manualCompletionAttestation)
  );
}

function isTerminalGoalStatus(status: GoalStatus): boolean {
  return (
    status === "achieved" ||
    status === "completed_unverified" ||
    status === "stopped_budget" ||
    status === "stopped_stalled" ||
    status === "stopped_blocked" ||
    status === "failed" ||
    status === "canceled"
  );
}

function terminalStatusMessage(goal: Goal): string {
  if (goal.status === "achieved") {
    return "目标已达成。";
  }
  if (goal.status === "completed_unverified") {
    return "目标已手动标记为完成（未验证）。";
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
  const detail = result.checkResults.find((checkResult) => checkResult.detail)?.detail;
  return redactAndBoundAcceptanceSummary(detail ?? "Milestone accepted.") ||
    "Milestone accepted.";
}

function summarizeAcceptanceFailure(result: AcceptanceResult): string {
  const detail = result.checkResults.find((checkResult) => !checkResult.passed)?.detail;
  return redactAndBoundAcceptanceSummary(detail ?? "Acceptance rejected.") ||
    "Acceptance rejected.";
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
  return [...new Set(refs.map(redactAndBoundEvidenceRef).filter(Boolean))]
    .sort()
    .slice(0, 64);
}

function boundManualCompletionStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .map(redactAndBoundEvidenceRef)
        .filter((value): value is string => Boolean(value)),
    ),
  ]
    .sort()
    .slice(0, 64);
}

function finalAcceptanceEvidenceFingerprint(
  goal: Goal,
  result: AcceptanceResult,
): string {
  const evidenceRefs = safeAcceptanceEvidenceRefs(result);
  return createAcceptanceLogicalFailureFingerprint({
    target: {
      targetKind: "goal",
      targetId: goal.id,
    },
    failedChecks: [],
    ...(result.evidenceManifest
      ? { evidenceManifest: result.evidenceManifest }
      : {}),
    evidenceRefs,
    protocolVersion: goal.acceptanceProtocolVersion ?? 1,
    validatorVersions: { acceptance: "goal-acceptance-v2" },
  });
}

function safeAcceptanceRetryDetail(result: AcceptanceResult): string {
  return redactAndBoundAcceptanceSummary(
    result.retry?.detail ?? summarizeAcceptanceFailure(result),
  ) || "Final acceptance is unavailable.";
}

function defaultAbortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function maxFinalAcceptanceAttempts(code: string): number {
  return code === "judge_invalid_response"
    ? 2
    : FINAL_ACCEPTANCE_MAX_ATTEMPTS;
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

function boundRuntimeCheckpointMessages(
  messages: ChatMessage[],
): NonNullable<Goal["runtimeCheckpoint"]>["transcriptMessages"] {
  return boundRuntimeTranscript(messages).map((message) => ({
    role: message.role,
    content:
      message.content.length > 4_000
        ? `${message.content.slice(0, 4_000)}... [truncated]`
        : message.content,
    ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    ...(message.tool_call_id
      ? { tool_call_id: message.tool_call_id }
      : {}),
    ...(message.name ? { name: message.name } : {}),
  }));
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
