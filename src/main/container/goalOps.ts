import { AgentEvalReport } from "../../shared/agentEval";
import type { Goal, GoalBudget, SuccessCriterion } from "../../shared/agentGoal";
import { upgradeGoalAcceptanceProtocol } from "../../shared/agentGoal";
import { GoalReviewPolicy } from "../../shared/agentGoalReview";
import { ChatSessionGoalSummary } from "../../shared/chat";
import { GoalDraftConfirmResult, GoalDraftDiscardResult, GoalDraftEdit } from "../../shared/goalTranslation";
import type { MemoryEvalReport } from "../../shared/memoryEval";
import { createDefaultMemoryEvalCases, runMemoryEvals as evaluateMemory } from "../../shared/memoryEval";
import type { ReadToolResultRefOptions, ReadToolResultRefResult } from "../../shared/toolResultRefs";
import { extractToolResultRef, isSafeToolResultRef, summarizeToolResultContent } from "../../shared/toolResultRefs";
import { createAgentEvalFixtures } from "../eval/agentEvalFixtures";
import { runAgentEvals } from "../eval/agentEvalRunner";
import { createCombinedAgentEvalFixtures } from "../eval/agentPromotedEvalFixtures";
import type { ToolResultOffloadReadScope } from "../toolResultOffloadStore";
import { issueToolResultRefReadCapability } from "../toolResultOffloadStore";
import { randomUUID } from "node:crypto";
import { createPlanOpsRuntime } from "./planOps";
import { createGoalDraftService } from "../goalDraftService";
import { createAgentGoalStore } from "../agentGoalStore";
import { createAgentTrajectoryStore } from "../agentTrajectoryStore";
import { createToolResultOffloadStore } from "../toolResultOffloadStore";
import { createMemoryStore } from "../memoryStore";
import { createPromotedAgentEvalFixtureStore } from "../eval/agentPromotedEvalFixtures";

export type GoalOpsRuntime = {
  runtimeShuttingDown: () => boolean;
  trackRuntimeInvocation: <T>(operation: () => Promise<T>) => Promise<T>;
  planOps: () => ReturnType<typeof createPlanOpsRuntime>;
  goalDraftService: () => ReturnType<typeof createGoalDraftService>;
  agentGoalStore: () => ReturnType<typeof createAgentGoalStore>;
  agentTrajectoryStore: () => ReturnType<typeof createAgentTrajectoryStore>;
  toolResultOffloadStore: () => ReturnType<typeof createToolResultOffloadStore>;
  memoryStore: () => ReturnType<typeof createMemoryStore>;
  promotedAgentEvalFixtureStore: () => ReturnType<typeof createPromotedAgentEvalFixtureStore>;
};

export function createGoalOpsRuntime(rt: GoalOpsRuntime) {
  const goalOperationStates = new Map<string, {
    epoch: number;
    pending: number;
    tail: Promise<void>;
  }>();

  function createGoalDraft(input: {
    description: string;
    successCriteria: string[];
    /** @deprecated Ignored. Kept for IPC compatibility. */
    budget?: GoalBudget;
    reviewPolicy: GoalReviewPolicy;
  }): Goal {
    const now = new Date().toISOString();
    const goalCondition = input.description.trim() || "Goal must be accepted with evidence.";
    const criteria = input.successCriteria
      .filter((description) => description.trim())
      .map((description, index): SuccessCriterion => ({
        id: `criterion_${index + 1}`,
        description: description.trim(),
        acceptanceChecks: [
          {
            id: `criterion_${index + 1}_review`,
            kind: "model_review",
            description: "Evidence-backed review is required.",
            params: {
              condition: description.trim(),
              evidenceRefs: ["artifact:goalEvidence"],
            },
            requiresEvidence: true,
          },
        ],
      }));

    return upgradeGoalAcceptanceProtocol({
      id: `goal_${randomUUID()}`,
      description: input.description.trim(),
      successCriteria: criteria.length
        ? criteria
        : [
            {
              id: "criterion_1",
              description: "Goal must be accepted with evidence.",
              acceptanceChecks: [
                {
                  id: "criterion_1_review",
                  kind: "model_review",
                  description: "Evidence-backed review is required.",
                  params: {
                    condition: goalCondition,
                    evidenceRefs: ["artifact:goalEvidence"],
                  },
                  requiresEvidence: true,
                },
              ],
            },
          ],
      milestones: [],
      status: "planning",
      executionUsage: {
        iterations: 0,
        toolCalls: 0,
        wallClockMs: 0,
        tokens: 0,
        replans: 0,
      },
      reviewPolicy: input.reviewPolicy,
      planVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  function confirmGoalDraft(
    draftId: string,
    edit?: GoalDraftEdit,
  ): Promise<GoalDraftConfirmResult> {
    if (rt.runtimeShuttingDown()) {
      return Promise.resolve({ ok: false, message: "应用正在退出，未启动目标。" });
    }
    return rt.trackRuntimeInvocation(() => rt.planOps().confirmGoalDraftAccepted(draftId, edit));
  }

  function discardGoalDraft(draftId: string): GoalDraftDiscardResult {
    return rt.goalDraftService().discard(draftId);
  }

  function runGoalOperation(
    goalId: string,
    operation: () => Promise<ChatSessionGoalSummary>,
    options?: { preempt?: boolean },
  ): Promise<{ ok: boolean; goal?: Goal; message?: string }> {
    if (rt.runtimeShuttingDown()) {
      return Promise.resolve({ ok: false, message: "应用正在退出，未启动目标操作。" });
    }
    const state = goalOperationStates.get(goalId) ?? {
      epoch: 0,
      pending: 0,
      tail: Promise.resolve(),
    };
    if (!goalOperationStates.has(goalId)) {
      goalOperationStates.set(goalId, state);
    }
    state.pending += 1;
    if (options?.preempt) {
      // A preempting cancel runs immediately, invalidates older queued work,
      // and becomes the barrier that every later mutation must await.
      state.epoch += 1;
      const invocation = rt.trackRuntimeInvocation(() =>
        runGoalOperationAccepted(operation),
      );
      const tail = invocation.then(
        () => undefined,
        () => undefined,
      );
      state.tail = tail;
      finishGoalOperationState(goalId, state, tail);
      return invocation;
    }

    const operationEpoch = state.epoch;
    const previous = state.tail;
    const invocation = rt.trackRuntimeInvocation(async () => {
      await previous.catch(() => undefined);
      if (rt.runtimeShuttingDown()) {
        return { ok: false, message: "应用正在退出，目标操作已取消。" };
      }
      if (operationEpoch !== state.epoch) {
        return { ok: false, message: "目标操作已被更高优先级的取消请求取代。" };
      }
      return runGoalOperationAccepted(operation);
    });
    const tail = invocation.then(
      () => undefined,
      () => undefined,
    );
    state.tail = tail;
    finishGoalOperationState(goalId, state, tail);
    return invocation;
  }

  function finishGoalOperationState(
    goalId: string,
    state: { epoch: number; pending: number; tail: Promise<void> },
    completion: Promise<void>,
  ): void {
    void completion.finally(() => {
      state.pending -= 1;
      if (
        state.pending === 0 &&
        goalOperationStates.get(goalId) === state
      ) {
        goalOperationStates.delete(goalId);
      }
    });
  }

  async function runGoalOperationAccepted(
    operation: () => Promise<ChatSessionGoalSummary>,
  ): Promise<{ ok: boolean; goal?: Goal; message?: string }> {
    try {
      const summary = await operation();
      const goal = await rt.agentGoalStore().get(summary.id);
      if (!goal) {
        return { ok: false, message: "目标不存在。" };
      }

      return { ok: true, goal };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "无法更新目标状态。",
      };
    }
  }

  async function readToolResultRef(
    ref: string,
    options?: ReadToolResultRefOptions & Pick<ToolResultOffloadReadScope, "capability">,
  ): Promise<ReadToolResultRefResult> {
    if (!isSafeToolResultRef(ref)) {
      return {
        ok: false,
        message: "工具结果引用无效。",
      };
    }

    let readScope: ToolResultOffloadReadScope | undefined = options;
    if (options?.trajectoryEventId) {
      if (!options.runId) {
        return { ok: false, message: "工具结果引用缺少受信轨迹归属。" };
      }
      const event = (await rt.agentTrajectoryStore().list(options.runId)).find(
        (candidate) => candidate.id === options.trajectoryEventId,
      );
      if (
        !event
        || event.runId !== options.runId
        || extractToolResultRef(event.payload) !== ref
      ) {
        return { ok: false, message: "工具结果引用与轨迹证据不匹配。" };
      }
      readScope = {
        capability: issueToolResultRefReadCapability({
          ref,
          issuedByRunId: event.runId,
        }),
      };
    }

    const content = await rt.toolResultOffloadStore().read(ref, readScope);
    if (!content) {
      return {
        ok: false,
        message: "没有找到这个工具结果引用。",
      };
    }

    return {
      ok: true,
      ref,
      content,
      summary: summarizeToolResultContent(content),
    };
  }

  async function runMemoryEvals(): Promise<
    | { ok: true; report: MemoryEvalReport }
    | { ok: false; message: string }
  > {
    try {
      const records = await rt.memoryStore().list({
        kind: "all",
        includeArchived: false,
        limit: 500,
      });
      return {
        ok: true,
        report: evaluateMemory(records, createDefaultMemoryEvalCases(records)),
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "无法评估记忆检索质量。",
      };
    }
  }

  async function runAgentQualityEvals(): Promise<AgentEvalReport> {
    return runAgentEvals(
      createCombinedAgentEvalFixtures(
        createAgentEvalFixtures(),
        await rt.promotedAgentEvalFixtureStore().list(),
      ),
    );
  }

  return {
    createGoalDraft,
    confirmGoalDraft,
    discardGoalDraft,
    runGoalOperation,
    readToolResultRef,
    runMemoryEvals,
    runAgentQualityEvals,
  };
}