import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AcceptanceRepairDirective,
  Goal,
  GoalEvidenceManifest,
  Milestone,
  SuccessCriterion,
} from "../shared/agentGoal";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import type { GoalProgressEvent } from "../shared/chat";
import { createAgentGoalStore, type AgentGoalStore } from "./agentGoalStore";
import {
  createAgentGoalController,
  type GoalRuntimeEngine,
} from "./agentGoalController";
import type { AcceptanceResult } from "./agentGoalAcceptance";
import {
  createAgentGoalAcceptance,
  type AcceptanceContext,
} from "./agentGoalAcceptance";
import { verifyGoalAcceptanceCertificate } from "./agentGoalAcceptanceCertificate";

describe("agent goal controller", () => {
  let configDir: string;
  let store: AgentGoalStore;
  let trajectoryEvents: AgentTrajectoryEvent[];
  let sequence: number;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-controller-"));
    store = createAgentGoalStore({ configDir });
    trajectoryEvents = [];
    sequence = 0;
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("accepts three milestones in order and achieves the goal", async () => {
    await store.save(
      createGoal([
        milestone("milestone_1"),
        milestone("milestone_2", ["milestone_1"]),
        milestone("milestone_3", ["milestone_2"]),
      ]),
    );
    const runtime = createRuntime();
    const controller = createController({
      runtime,
      acceptance: createAcceptance({
        milestoneAccepted: [true, true, true],
        goalAccepted: [true],
      }),
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("achieved");
    expect(result.stopReason).toBe("goal_accepted");
    expect(runtime.runMilestoneIds).toEqual([
      "milestone_1",
      "milestone_2",
      "milestone_3",
    ]);
    expect(result.milestones.map((item) => item.state)).toEqual([
      "accepted",
      "accepted",
      "accepted",
    ]);
    expect(
      trajectoryEvents.filter((event) => event.type === "checkpoint_written"),
    ).toHaveLength(3);
  });

  it("stops before dispatching another milestone when the iteration budget is exhausted", async () => {
    await store.save(
      createGoal(
        [milestone("milestone_1"), milestone("milestone_2", ["milestone_1"])],
        {
          budget: {
            maxIterations: 1,
            maxToolCalls: 99,
            maxWallClockMs: 600_000,
            maxReplans: 1,
          },
        },
      ),
    );
    const runtime = createRuntime();
    const controller = createController({
      runtime,
      acceptance: createAcceptance({
        milestoneAccepted: [true, true],
        goalAccepted: [true],
      }),
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("stopped_budget");
    expect(result.stopReason).toBe("budget_exhausted");
    expect(runtime.runMilestoneIds).toEqual(["milestone_1"]);
    const ledger = await store.readLedger("goal_1");
    expect(ledger.at(-1)?.summary).toContain("iterations 1/1");
  });

  it.each([
    {
      label: "tool calls",
      budget: { maxToolCalls: 4 },
      budgetUsage: { toolCalls: 4 },
      expected: "tool calls 4/4",
    },
    {
      label: "wall clock",
      budget: { maxWallClockMs: 2_000 },
      budgetUsage: { wallClockMs: 2_000 },
      expected: "wall clock 2000/2000ms",
    },
    {
      label: "tokens",
      budget: { maxTokens: 50 },
      budgetUsage: { tokens: 50 },
      expected: "tokens 50/50",
    },
  ])("stops before dispatch when the $label budget is exhausted", async ({
    budget,
    budgetUsage,
    expected,
  }) => {
    const base = createGoal([milestone("milestone_1")], { status: "executing" });
    await store.save({
      ...base,
      budget: { ...base.budget, ...budget },
      budgetUsage: { ...base.budgetUsage, ...budgetUsage },
    });
    const runtime = createRuntime();
    const controller = createController({
      runtime,
      acceptance: createAcceptance({ milestoneAccepted: [true] }),
    });

    const result = await controller.resume("goal_1");
    const ledger = await store.readLedger("goal_1");

    expect(result.status).toBe("stopped_budget");
    expect(result.stopReason).toBe("budget_exhausted");
    expect(runtime.runMilestoneIds).toEqual([]);
    expect(ledger.at(-1)?.summary).toContain(expected);
  });

  it("stops stalled goals after consecutive iterations without ledger progress", async () => {
    await store.save(
      createGoal([milestone("blocked", ["missing_dependency"])], {
        status: "executing",
      }),
    );
    const controller = createController({
      stallThreshold: 2,
      runtime: createRuntime(),
      acceptance: createAcceptance({ milestoneAccepted: [] }),
    });

    const result = await controller.resume("goal_1");
    const ledger = await store.readLedger("goal_1");

    expect(result.status).toBe("stopped_stalled");
    expect(result.stopReason).toBe("progress_stalled");
    expect(ledger.at(-1)?.summary).toContain("No ready milestones");
  });

  it("replans after structural acceptance failure and records replan usage", async () => {
    await store.save(createGoal([milestone("milestone_original")]));
    const runtime = createRuntime();
    const controller = createController({
      runtime,
      acceptance: createAcceptanceResults({
        milestones: [
          rejectedResult("plan_invalid", {
            verdict: "replan_required",
            failureClass: "plan_structure_invalid",
          }),
          acceptedResult("check_done"),
        ],
        goals: [acceptedResult("check_done")],
      }),
      planner: {
        async replan(goal) {
          goal.planVersion += 1;
          goal.budgetUsage.replans += 1;
          return [milestone("milestone_replanned")];
        },
      },
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("achieved");
    expect(result.planVersion).toBe(2);
    expect(result.budgetUsage.replans).toBe(1);
    expect(runtime.runMilestoneIds).toEqual([
      "milestone_original",
      "milestone_replanned",
    ]);
    expect(trajectoryEvents.map((event) => event.type)).toContain("goal_replanned");
  });

  it("stops after the configured replan limit instead of replanning forever", async () => {
    await store.save(
      createGoal([milestone("milestone_original")], {
        budget: {
          maxIterations: 8,
          maxToolCalls: 99,
          maxWallClockMs: 600_000,
          maxReplans: 1,
        },
      }),
    );
    const runtime = createRuntime();
    let plannerCalls = 0;
    const controller = createController({
      runtime,
      acceptance: createAcceptanceResults({
        milestones: [
          rejectedResult("plan_invalid", {
            verdict: "replan_required",
            failureClass: "plan_structure_invalid",
          }),
          rejectedResult("plan_still_invalid", {
            verdict: "replan_required",
            failureClass: "plan_structure_invalid",
          }),
        ],
      }),
      planner: {
        async replan(goal) {
          plannerCalls += 1;
          if (plannerCalls > 1) {
            throw new Error("unexpected second replan");
          }
          goal.planVersion += 1;
          goal.budgetUsage.replans += 1;
          return [milestone("milestone_replanned")];
        },
      },
    });

    const result = await controller.start("goal_1");
    const ledger = await store.readLedger("goal_1");

    expect(result.status).toBe("stopped_budget");
    expect(result.stopReason).toBe("budget_exhausted");
    expect(result.budgetUsage.replans).toBe(1);
    expect(plannerCalls).toBe(1);
    expect(runtime.runMilestoneIds).toEqual([
      "milestone_original",
      "milestone_replanned",
    ]);
    expect(ledger.at(-1)?.summary).toContain("replans 1/1");
  });

  it("pauses for review instead of replanning a turn-limited milestone", async () => {
    await store.save(createGoal([milestone("milestone_1")]));
    let acceptanceCalls = 0;
    let plannerCalls = 0;
    const runtime: GoalRuntimeEngine = {
      async runMilestone() {
        return {
          runId: "run_turn_limit",
          toolCallCount: 8,
          status: "paused",
          summary: "工具调用轮次已达到上限（8 轮）。",
          wallClockMs: 1_000,
          tokens: 20,
        };
      },
    };
    const controller = createController({
      runtime,
      acceptance: {
        async evaluate() {
          acceptanceCalls += 1;
          return rejectedResult("turn_limit_repairable");
        },
        async evaluateGoal() {
          throw new Error("unexpected goal acceptance");
        },
      },
      planner: {
        async replan() {
          plannerCalls += 1;
          throw new Error("unexpected replan");
        },
      },
    });

    const result = await controller.start("goal_1");
    const ledger = await store.readLedger("goal_1");

    expect(result.status).toBe("waiting_for_review");
    expect(result.milestones[0]).toMatchObject({
      state: "ready",
      lastRunStatus: "paused",
    });
    expect(acceptanceCalls).toBe(1);
    expect(plannerCalls).toBe(0);
    expect(result.acceptanceState?.recentFailures).toHaveLength(1);
    expect(result.acceptanceState?.lastDecision).toMatchObject({
      action: "repair_same_milestone",
      occurrence: 1,
    });
    expect(ledger.at(-1)?.kind).toBe("review_requested");
    expect(ledger.at(-1)?.summary).toContain("turn limit");
  });

  it.each([
    ["blocked_external", "external_dependency_missing", "external_blocked"],
    ["impossible", "goal_impossible", "goal_impossible"],
    ["acceptance_unavailable", "judge_unavailable", "acceptance_unavailable"],
  ] as const)(
    "maps paused %s acceptance through the typed blocked policy",
    async (verdict, failureClass, stopReason) => {
      await store.save(createProtocolV2Goal([milestone("milestone_1")]));
      const controller = createController({
        runtime: {
          async runMilestone() {
            return {
              runId: "run_paused",
              toolCallCount: 1,
              status: "paused",
              summary: "Turn limit reached.",
            };
          },
        },
        acceptance: createAcceptanceResults({
          milestones: [
            rejectedResult(`${verdict}_paused`, { verdict, failureClass }),
          ],
        }),
      });

      const result = await controller.start("goal_1");

      expect(result.status).toBe("stopped_blocked");
      expect(result.stopReason).toBe(stopReason);
      expect(result.milestones[0]?.lastRunStatus).toBe("paused");
      expect(result.acceptanceState?.recentFailures.at(-1)).toMatchObject({
        verdict,
        failureClass,
      });
    },
  );

  it("routes a paused structural rejection through the one replan policy", async () => {
    await store.save(createProtocolV2Goal([milestone("milestone_original")]));
    let runtimeCalls = 0;
    let plannerCalls = 0;
    const controller = createController({
      runtime: {
        async runMilestone(_goal, currentMilestone) {
          runtimeCalls += 1;
          return {
            runId: `run_${currentMilestone.id}`,
            toolCallCount: 1,
            status: runtimeCalls === 1 ? "paused" : "succeeded",
          };
        },
      },
      acceptance: createAcceptanceResults({
        milestones: [
          rejectedResult("plan_invalid", {
            verdict: "replan_required",
            failureClass: "plan_structure_invalid",
          }),
          acceptedResult("check_done"),
        ],
        goals: [acceptedResult("check_done", { evidenceManifest: emptyManifest })],
      }),
      planner: {
        async replan(goal) {
          plannerCalls += 1;
          goal.planVersion += 1;
          goal.budgetUsage.replans += 1;
          return [milestone("milestone_replanned")];
        },
      },
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("achieved");
    expect(plannerCalls).toBe(1);
    expect(runtimeCalls).toBe(2);
    expect(result.budgetUsage.replans).toBe(1);
  });

  it("keeps a turn-limited milestone ready when the same run exhausts its budget", async () => {
    await store.save(
      createGoal([milestone("milestone_1")], {
        budget: {
          maxIterations: 1,
          maxToolCalls: 99,
          maxWallClockMs: 600_000,
          maxReplans: 2,
        },
      }),
    );
    const runMilestoneIds: string[] = [];
    const runtime: GoalRuntimeEngine = {
      async runMilestone(_goal, currentMilestone) {
        runMilestoneIds.push(currentMilestone.id);
        return {
          runId: `run_${runMilestoneIds.length}`,
          toolCallCount: 1,
          status: runMilestoneIds.length === 1 ? "paused" : "succeeded",
          summary:
            runMilestoneIds.length === 1
              ? "工具调用轮次已达到上限（8 轮）。"
              : "里程碑已完成。",
          wallClockMs: 100,
          tokens: 10,
        };
      },
    };
    const controller = createController({
      runtime,
      acceptance: createAcceptance({
        milestoneAccepted: [true],
        goalAccepted: [true],
      }),
      planner: {
        async replan() {
          throw new Error("unexpected replan");
        },
      },
    });

    const stopped = await controller.start("goal_1");
    expect(stopped.status).toBe("stopped_budget");
    expect(stopped.milestones[0]).toMatchObject({
      state: "ready",
      lastRunStatus: "paused",
    });

    await store.save({
      ...stopped,
      status: "executing",
      stopReason: undefined,
      budget: { ...stopped.budget, maxIterations: 3 },
    });
    const recovered = await controller.resume("goal_1");

    expect(recovered.status).toBe("achieved");
    expect(runMilestoneIds).toEqual(["milestone_1", "milestone_1"]);
  });

  it("does not let a replan that resolves after cancellation overwrite the terminal goal", async () => {
    await store.save(createGoal([milestone("milestone_1")]));
    const abortController = new AbortController();
    let deferredResolve: ((milestones: Milestone[]) => void) | undefined;
    const plannerPromise = new Promise<Milestone[]>((resolve) => {
      deferredResolve = resolve;
    });
    let plannerEnteredResolve: (() => void) | undefined;
    const plannerEntered = new Promise<void>((resolve) => {
      plannerEnteredResolve = resolve;
    });
    const controller = createController({
      runtime: createRuntime(),
      acceptance: createAcceptanceResults({
        milestones: [
          rejectedResult("plan_invalid", {
            verdict: "replan_required",
            failureClass: "plan_structure_invalid",
          }),
        ],
      }),
      planner: {
        async replan(goal) {
          plannerEnteredResolve?.();
          const milestones = await plannerPromise;
          goal.planVersion += 1;
          goal.budgetUsage.replans += 1;
          return milestones;
        },
      },
    });

    const running = controller.start("goal_1", {
      signal: abortController.signal,
    });
    await plannerEntered;
    const persisted = await store.get("goal_1");
    await store.save({
      ...persisted!,
      status: "canceled",
      stopReason: "user_canceled",
    });
    await store.appendLedger("goal_1", {
      at: "2026-06-12T00:00:00.000Z",
      kind: "goal_stopped",
      summary: "Goal canceled from test.",
    });
    abortController.abort();
    deferredResolve?.([milestone("milestone_replanned")]);

    const result = await running;
    const ledger = await store.readLedger("goal_1");

    expect(result.status).toBe("canceled");
    expect(result.stopReason).toBe("user_canceled");
    expect(ledger.at(-1)?.summary).toBe("Goal canceled from test.");
    expect(ledger.map((event) => event.kind)).not.toContain("goal_replanned");
  });

  it("publishes the persisted canceled status when cancellation lands during replan bookkeeping", async () => {
    await store.save(createGoal([milestone("milestone_1")]));
    const abortController = new AbortController();
    const progressEvents: GoalProgressEvent[] = [];
    let canceled = false;
    const controller = createController({
      runtime: createRuntime(),
      acceptance: createAcceptanceResults({
        milestones: [
          rejectedResult("plan_invalid", {
            verdict: "replan_required",
            failureClass: "plan_structure_invalid",
          }),
        ],
      }),
      planner: {
        async replan(goal) {
          goal.planVersion += 1;
          goal.budgetUsage.replans += 1;
          return [milestone("milestone_replanned")];
        },
      },
      async onTrajectoryAppend(event) {
        if (event.type !== "goal_replanned" || canceled) {
          return;
        }
        canceled = true;
        const persisted = await store.get("goal_1");
        await store.save({
          ...persisted!,
          status: "canceled",
          stopReason: "user_canceled",
        });
        abortController.abort();
      },
      onProgress(event) {
        progressEvents.push(event);
      },
    });

    const result = await controller.start("goal_1", {
      signal: abortController.signal,
    });

    expect(result.status).toBe("canceled");
    await expect(store.get("goal_1")).resolves.toMatchObject({
      status: "canceled",
      stopReason: "user_canceled",
    });
    expect(progressEvents.at(-1)?.status).toBe("canceled");
  });

  it("does not publish stale review progress when cancellation lands during milestone acceptance", async () => {
    await store.save(
      createGoal([milestone("milestone_1")], {
        reviewPolicy: "review_each_milestone",
      }),
    );
    const progressEvents: GoalProgressEvent[] = [];
    let canceled = false;
    const controller = createController({
      runtime: createRuntime(),
      acceptance: createAcceptance({ milestoneAccepted: [true] }),
      async onTrajectoryAppend(event) {
        if (event.type !== "checkpoint_written" || canceled) {
          return;
        }
        canceled = true;
        const persisted = await store.get("goal_1");
        await store.save({
          ...persisted!,
          status: "canceled",
          stopReason: "user_canceled",
        });
      },
      onProgress(event) {
        progressEvents.push(event);
      },
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("canceled");
    expect(progressEvents.at(-1)).toMatchObject({ status: "canceled" });
    expect(
      progressEvents.some(
        (event) =>
          event.event === "review_requested" &&
          event.status === "waiting_for_review",
      ),
    ).toBe(false);
  });

  it("continues with replanned work when final goal acceptance needs more evidence", async () => {
    await store.save(createGoal([milestone("milestone_initial")]));
    const runtime = createRuntime();
    const replanReasons: string[] = [];
    const controller = createController({
      runtime,
      acceptance: createAcceptanceResults({
        milestones: [acceptedResult("check_done"), acceptedResult("check_done")],
        goals: [
          rejectedResult("plan_invalid", {
            verdict: "replan_required",
            failureClass: "plan_structure_invalid",
          }),
          acceptedResult("check_done"),
        ],
      }),
      planner: {
        async replan(goal, reason) {
          replanReasons.push(reason);
          goal.planVersion += 1;
          goal.budgetUsage.replans += 1;
          return [
            ...goal.milestones,
            milestone("milestone_followup", ["milestone_initial"]),
          ];
        },
      },
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("achieved");
    expect(result.stopReason).toBe("goal_accepted");
    expect(result.planVersion).toBe(2);
    expect(result.budgetUsage.replans).toBe(1);
    expect(replanReasons[0]).toContain("structural replanning");
    expect(runtime.runMilestoneIds).toEqual([
      "milestone_initial",
      "milestone_followup",
    ]);
    expect(trajectoryEvents.map((event) => event.type)).toContain("goal_replanned");
  });

  it("rechecks covered model-review goals with fresh final acceptance", async () => {
    let finalGoalReviewCalls = 0;
    await store.save(
      createGoal([milestone("milestone_bookmarks")], {
        successCriteria: [modelReviewCriterion],
        milestones: [
          {
            ...milestone("milestone_bookmarks"),
            successCriteria: [modelReviewCriterion],
          },
        ],
      }),
    );
    const runtime = createRuntime();
    const controller = createController({
      runtime,
      acceptance: {
        async evaluate() {
          return {
            accepted: true,
            inferentialUsed: true,
            checkResults: [
              {
                checkId: "check_goal_review",
                kind: "model_review",
                passed: true,
                evidenceRefs: ["artifact:goalEvidence"],
                detail: "Chrome bookmark evidence was accepted.",
              },
            ],
          };
        },
        async evaluateGoal() {
          finalGoalReviewCalls += 1;
          return acceptedResult("check_goal_review", {
            kind: "model_review",
            evidenceRefs: ["artifact:goalEvidence"],
          });
        },
      },
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("achieved");
    expect(result.stopReason).toBe("goal_accepted");
    expect(finalGoalReviewCalls).toBe(1);
  });

  it("rechecks covered provenance artifact goals with fresh final acceptance", async () => {
    let finalGoalAcceptanceCalls = 0;
    await store.save(
      createGoal([milestone("milestone_bookmarks")], {
        successCriteria: [artifactCriterion],
        milestones: [
          {
            ...milestone("milestone_bookmarks"),
            successCriteria: [artifactCriterion],
          },
        ],
      }),
    );
    const runtime = createRuntime();
    const controller = createController({
      runtime,
      acceptance: {
        async evaluate() {
          return {
            accepted: true,
            inferentialUsed: false,
            checkResults: [
              {
                checkId: "check_bookmark_artifact",
                kind: "file_exists",
                passed: true,
                evidenceRefs: ["artifact:bookmark_list", "provenance:bookmark_list"],
                detail: "File exists with valid provenance: bookmark_list.md",
              },
            ],
          };
        },
        async evaluateGoal() {
          finalGoalAcceptanceCalls += 1;
          return {
            ...acceptedResult("check_bookmark_artifact"),
            checkResults: [
              {
                checkId: "check_bookmark_artifact",
                kind: "file_exists" as const,
                passed: true,
                code: "file_exists",
                evidenceRefs: ["artifact:bookmark_list", "provenance:bookmark_list"],
                detail: "Fresh provenance validation passed.",
              },
            ],
          };
        },
      },
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("achieved");
    expect(result.stopReason).toBe("goal_accepted");
    expect(finalGoalAcceptanceCalls).toBe(1);
  });

  it("suspends at review gates and does not advance until review is resolved", async () => {
    await store.save(
      createGoal(
        [milestone("milestone_1"), milestone("milestone_2", ["milestone_1"])],
        { reviewPolicy: "review_each_milestone" },
      ),
    );
    const runtime = createRuntime();
    const controller = createController({
      runtime,
      acceptance: createAcceptance({
        milestoneAccepted: [true, true],
        goalAccepted: [true],
      }),
    });

    const waiting = await controller.start("goal_1");
    await controller.resume("goal_1");
    const stillWaiting = await store.get("goal_1");

    expect(waiting.status).toBe("waiting_for_review");
    expect(stillWaiting?.status).toBe("waiting_for_review");
    expect(runtime.runMilestoneIds).toEqual(["milestone_1"]);

    const afterApproval = await controller.resolveReview("goal_1", {
      kind: "approve_continue",
    });
    expect(afterApproval.status).toBe("executing");

    const resumed = await waitForGoalStatus("waiting_for_review");
    expect(resumed.status).toBe("waiting_for_review");
    expect(runtime.runMilestoneIds).toEqual(["milestone_1", "milestone_2"]);
    expect(trajectoryEvents.map((event) => event.type)).toContain(
      "goal_review_requested",
    );
  });

  it("uses the shared review policy instead of reviewing only every milestone", async () => {
    await store.save(
      createGoal(
        [milestone("milestone_1"), milestone("milestone_2", ["milestone_1"])],
        { reviewPolicy: "review_final_only" },
      ),
    );
    const runtime = createRuntime();
    const controller = createController({
      runtime,
      acceptance: createAcceptance({
        milestoneAccepted: [true, true],
        goalAccepted: [true],
      }),
    });

    const waiting = await controller.start("goal_1");

    expect(waiting.status).toBe("waiting_for_review");
    expect(runtime.runMilestoneIds).toEqual(["milestone_1", "milestone_2"]);
    expect(
      trajectoryEvents.filter((event) => event.type === "goal_review_requested"),
    ).toHaveLength(1);

    const afterApproval = await controller.resolveReview("goal_1", {
      kind: "approve_continue",
    });
    expect(afterApproval.status).toBe("executing");

    const achieved = await waitForGoalStatus("achieved");
    expect(achieved.status).toBe("achieved");
    expect(achieved.stopReason).toBe("goal_accepted");
    expect(runtime.runMilestoneIds).toEqual(["milestone_1", "milestone_2"]);
  });

  it("replaces aborted active runs when a paused goal is approved", async () => {
    await store.save(
      createGoal([milestone("milestone_1")], {
        status: "executing",
      }),
    );
    const abortController = new AbortController();
    const runtime = createDeferredRuntime();
    const controller = createController({
      runtime,
      acceptance: createAcceptance({
        milestoneAccepted: [true],
        goalAccepted: [true],
      }),
    });

    const staleRun = controller.resume("goal_1", {
      signal: abortController.signal,
    });
    await waitFor(() => runtime.calls.length === 1);

    const paused = await store.get("goal_1");
    await store.save({
      ...paused!,
      status: "waiting_for_review",
      milestones: paused!.milestones.map((item) =>
        item.state === "running" ? { ...item, state: "ready" } : item,
      ),
    });
    abortController.abort();

    const approved = await controller.resolveReview("goal_1", {
      kind: "approve_continue",
    });
    expect(approved.status).toBe("executing");

    await waitFor(() => runtime.calls.length === 2);

    runtime.calls[0]!.resolve({
      runId: "run_stale",
      toolCallCount: 1,
      status: "canceled",
    });
    runtime.calls[1]!.resolve({
      runId: "run_fresh",
      toolCallCount: 1,
      status: "succeeded",
    });
    await staleRun;
    const finalGoal = await waitForGoalStatus("achieved");
    const ledger = await store.readLedger("goal_1");

    expect(finalGoal.status).toBe("achieved");
    expect(ledger.map((event) => event.summary)).not.toContain("Goal canceled.");
  });

  it("does not resume when cancellation wins a modify-plan review race", async () => {
    await store.save(
      createGoal([milestone("milestone_1")], {
        status: "waiting_for_review",
      }),
    );
    const runtime = createRuntime();
    const controller = createController({
      runtime,
      acceptance: createAcceptance({ milestoneAccepted: [true] }),
      planner: {
        async replan(goal) {
          const persisted = await store.get(goal.id);
          await store.save({
            ...persisted!,
            status: "canceled",
            stopReason: "user_canceled",
          });
          goal.planVersion += 1;
          goal.budgetUsage.replans += 1;
          return [milestone("milestone_replanned")];
        },
      },
    });

    const result = await controller.resolveReview("goal_1", {
      kind: "modify_plan",
      instructions: "调整剩余计划",
    });

    expect(result.status).toBe("canceled");
    expect(result.stopReason).toBe("user_canceled");
    expect(runtime.runMilestoneIds).toEqual([]);
  });

  it("resumes without re-dispatching accepted milestones", async () => {
    await store.save(
      createGoal([
        { ...milestone("milestone_done"), state: "accepted", runIds: ["run_done"], attempts: 1 },
        milestone("milestone_next", ["milestone_done"]),
      ], {
        status: "executing",
      }),
    );
    const runtime = createRuntime();
    const controller = createController({
      runtime,
      acceptance: createAcceptance({
        milestoneAccepted: [true],
        goalAccepted: [true],
      }),
    });

    const result = await controller.resume("goal_1");

    expect(result.status).toBe("achieved");
    expect(runtime.runMilestoneIds).toEqual(["milestone_next"]);
  });

  it("persists a running milestone before dispatching the runtime loop", async () => {
    await store.save(createGoal([milestone("milestone_1")]));
    const observedPersistedStates: string[] = [];
    const runtime: GoalRuntimeEngine & { runMilestoneIds: string[] } = {
      runMilestoneIds: [],
      async runMilestone(_goal, currentMilestone) {
        runtime.runMilestoneIds.push(currentMilestone.id);
        const persisted = await store.get("goal_1");
        observedPersistedStates.push(
          persisted?.milestones.find((item) => item.id === currentMilestone.id)
            ?.state ?? "missing",
        );
        return {
          runId: `run_${currentMilestone.id}_1`,
          toolCallCount: 1,
          wallClockMs: 100,
          tokens: 10,
        };
      },
    };
    const controller = createController({
      runtime,
      acceptance: createAcceptance({
        milestoneAccepted: [true],
        goalAccepted: [true],
      }),
    });

    await controller.start("goal_1");

    expect(observedPersistedStates).toEqual(["running"]);
    expect(runtime.runMilestoneIds).toEqual(["milestone_1"]);
  });

  it("repairs the same milestone twice then stalls on the third identical failure without replanning", async () => {
    await store.save(createProtocolV2Goal([milestone("milestone_1")]));
    const directives: Array<AcceptanceRepairDirective | undefined> = [];
    const goalDirectives: Array<AcceptanceRepairDirective | undefined> = [];
    let plannerCalls = 0;
    const runtime: GoalRuntimeEngine = {
      async runMilestone(currentGoal, currentMilestone, runOptions) {
        goalDirectives.push(currentGoal.acceptanceState?.lastDecision);
        directives.push(runOptions?.repairDirective);
        return {
          runId: `run_${currentMilestone.id}_${directives.length}`,
          toolCallCount: 1,
          status: "succeeded",
          actionSignatures: ["test_run:[redacted]"],
        };
      },
    };
    const controller = createController({
      runtime,
      acceptance: createAcceptanceResults({
        milestones: [
          rejectedResult("assertion_mismatch"),
          rejectedResult("assertion_mismatch"),
          rejectedResult("assertion_mismatch"),
        ],
      }),
      planner: {
        async replan() {
          plannerCalls += 1;
          throw new Error("ordinary acceptance failure must not replan");
        },
      },
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("stopped_stalled");
    expect(result.stopReason).toBe("progress_stalled");
    expect(result.planVersion).toBe(1);
    expect(result.budgetUsage.replans).toBe(0);
    expect(plannerCalls).toBe(0);
    expect(result.acceptanceState?.recentFailures.map((failure) => failure.occurrence)).toEqual([
      1,
      2,
      3,
    ]);
    expect(goalDirectives).toEqual([
      undefined,
      expect.objectContaining({ action: "repair_same_milestone", occurrence: 1 }),
      expect.objectContaining({ action: "retry_alternate_strategy", occurrence: 2 }),
    ]);
    expect(directives).toEqual(goalDirectives);
    expect(trajectoryEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "acceptance_failure_classified",
        "acceptance_repair_scheduled",
        "acceptance_strategy_changed",
      ]),
    );
  });

  it("reproduces the large-report incident and stops after three identical cold-judge rejections without replanning", async () => {
    const workspacePath = path.join(configDir, "authorized-workspace");
    const reportPath = path.join(workspacePath, "docs", "tech_report.md");
    await mkdir(path.dirname(reportPath), { recursive: true });
    const report = largeTenSectionReport();
    expect(Buffer.byteLength(report)).toBeGreaterThan(4 * 1024 * 1024);
    await writeFile(reportPath, report, "utf8");

    const semanticCriterion = lateReportCriterion(reportPath);
    await store.save(
      createProtocolV2Goal(
        [{ ...milestone("milestone_report"), successCriteria: [semanticCriterion] }],
        {
          description: "Produce a complete ten-section technical report.",
          successCriteria: [semanticCriterion],
        },
      ),
    );
    const runtime = createRuntime();
    const judgePrompts: string[] = [];
    const acceptance = createRealAcceptance({
      workspacePath,
      complete(request) {
        judgePrompts.push(
          request.messages.map((message) => message.content).join("\n"),
        );
        if (judgePrompts.length > 3) {
          throw new Error("controller repeated the incident after the stall threshold");
        }
        return {
          content: JSON.stringify({
            verdict: "rejected",
            reason: "The report does not yet establish the requested conclusion.",
            evidenceRefs: [`artifact:${reportPath}`],
          }),
          toolCalls: [],
          finishReason: "stop",
        };
      },
    });
    let plannerCalls = 0;
    const controller = createController({
      runtime,
      acceptance,
      planner: {
        async replan() {
          plannerCalls += 1;
          throw new Error("semantic rejection must use bounded repair, not replan");
        },
      },
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("stopped_stalled");
    expect(result.planVersion).toBe(1);
    expect(result.budgetUsage.replans).toBe(0);
    expect(runtime.runMilestoneIds).toHaveLength(3);
    expect(result.acceptanceState?.recentFailures.at(-1)?.occurrence).toBe(3);
    expect(plannerCalls).toBe(0);
    expect(judgePrompts).toHaveLength(3);
    expect(judgePrompts.every((prompt) => prompt.includes("Section 10 Final Conclusion"))).toBe(
      true,
    );
  });

  it("certifies a large ten-section report when the late final heading passes both cold judges", async () => {
    const workspacePath = path.join(configDir, "authorized-workspace");
    const reportPath = path.join(workspacePath, "docs", "tech_report.md");
    await mkdir(path.dirname(reportPath), { recursive: true });
    const report = largeTenSectionReport();
    expect(Buffer.byteLength(report)).toBeGreaterThan(4 * 1024 * 1024);
    await writeFile(reportPath, report, "utf8");

    const semanticCriterion = lateReportCriterion(reportPath);
    await store.save(
      createProtocolV2Goal(
        [{ ...milestone("milestone_report"), successCriteria: [semanticCriterion] }],
        {
          description: "Produce a complete ten-section technical report.",
          successCriteria: [semanticCriterion],
        },
      ),
    );
    const runtime = createRuntime();
    const judgePrompts: string[] = [];
    const acceptance = createRealAcceptance({
      workspacePath,
      complete(request) {
        judgePrompts.push(
          request.messages.map((message) => message.content).join("\n"),
        );
        return {
          content: JSON.stringify({
            verdict: "accepted",
            reason: "The late tenth heading and report evidence prove completion.",
            evidenceRefs: [`artifact:${reportPath}`],
          }),
          toolCalls: [],
          finishReason: "stop",
        };
      },
    });
    const controller = createController({ runtime, acceptance });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("achieved");
    expect(runtime.runMilestoneIds).toEqual(["milestone_report"]);
    expect(judgePrompts).toHaveLength(2);
    expect(judgePrompts.every((prompt) => prompt.includes("Section 10 Final Conclusion"))).toBe(
      true,
    );
    expect(result.acceptanceCertificate).toBeDefined();
    expect(verifyGoalAcceptanceCertificate(result)).toEqual({ ok: true });
  });

  it("resets the occurrence when the same target has a changed failure fingerprint", async () => {
    await store.save(createProtocolV2Goal([milestone("milestone_1")]));
    const controller = createController({
      runtime: createRuntime(),
      acceptance: createAcceptanceResults({
        milestones: [
          rejectedResult("assertion_mismatch"),
          rejectedResult("artifact_changed"),
          rejectedResult("artifact_changed"),
          rejectedResult("artifact_changed"),
        ],
      }),
      planner: {
        async replan() {
          throw new Error("repairable failure must not replan");
        },
      },
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("stopped_stalled");
    expect(result.acceptanceState?.recentFailures.map((failure) => failure.occurrence)).toEqual([
      1,
      1,
      2,
      3,
    ]);
  });

  it("calls the planner only for a structural verdict and consumes exactly one existing replan increment", async () => {
    await store.save(createGoal([milestone("milestone_original")]));
    let plannerCalls = 0;
    const runtime = createRuntime();
    const controller = createController({
      runtime,
      acceptance: createAcceptanceResults({
        milestones: [
          rejectedResult("plan_invalid", {
            verdict: "replan_required",
            failureClass: "plan_structure_invalid",
          }),
          acceptedResult("check_done"),
        ],
        goals: [acceptedResult("check_done")],
      }),
      planner: {
        async replan(goal) {
          plannerCalls += 1;
          goal.planVersion += 1;
          goal.budgetUsage.replans += 1;
          return [milestone("milestone_replanned")];
        },
      },
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("achieved");
    expect(plannerCalls).toBe(1);
    expect(result.planVersion).toBe(2);
    expect(result.budgetUsage.replans).toBe(1);
    expect(runtime.runMilestoneIds).toEqual(["milestone_original", "milestone_replanned"]);
  });

  it.each([
    ["blocked_external", "external_dependency_missing", "external_blocked"],
    ["impossible", "goal_impossible", "goal_impossible"],
    ["acceptance_unavailable", "judge_unavailable", "acceptance_unavailable"],
  ] as const)(
    "maps %s to stopped_blocked / %s",
    async (verdict, failureClass, stopReason) => {
      await store.save(createProtocolV2Goal([milestone("milestone_1")]));
      const controller = createController({
        runtime: createRuntime(),
        acceptance: createAcceptanceResults({
          milestones: [
            rejectedResult(`${verdict}_code`, { verdict, failureClass }),
          ],
        }),
      });

      const result = await controller.start("goal_1");

      expect(result.status).toBe("stopped_blocked");
      expect(result.stopReason).toBe(stopReason);
      expect(result.acceptanceState?.phase).toBe("blocked");
      expect(result.acceptanceState?.recentFailures.at(-1)).toMatchObject({
        verdict,
        failureClass,
      });
      expect(trajectoryEvents.map((event) => event.type)).toContain("acceptance_blocked");
    },
  );

  it("lets operational budget exhaustion win before scheduling a repair", async () => {
    await store.save(
      createProtocolV2Goal([milestone("milestone_1")], {
        budget: {
          maxIterations: 1,
          maxToolCalls: 99,
          maxWallClockMs: 600_000,
          maxReplans: 2,
        },
      }),
    );
    let acceptanceCalls = 0;
    const controller = createController({
      runtime: createRuntime(),
      acceptance: {
        async evaluate() {
          acceptanceCalls += 1;
          return rejectedResult("assertion_mismatch");
        },
        async evaluateGoal() {
          throw new Error("budget stop must not reach final acceptance");
        },
      },
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("stopped_budget");
    expect(acceptanceCalls).toBe(0);
    expect(result.acceptanceState?.lastDecision).toBeUndefined();
    expect(result.acceptanceState?.recentFailures).toHaveLength(0);
    expect(trajectoryEvents.map((event) => event.type)).not.toContain(
      "acceptance_repair_scheduled",
    );
  });

  it("reuses one deterministic final repair milestone and never creates a repair chain", async () => {
    await store.save(createProtocolV2Goal([milestone("milestone_initial")]));
    const runtime = createRuntime();
    const controller = createController({
      runtime,
      acceptance: createAcceptanceResults({
        milestones: [
          acceptedResult("check_done"),
          acceptedResult("check_done"),
          acceptedResult("check_done"),
        ],
        goals: [
          rejectedResult("goal_assertion_mismatch", { checkId: "check_done" }),
          rejectedResult("goal_assertion_mismatch", { checkId: "check_done" }),
          rejectedResult("goal_assertion_mismatch", { checkId: "check_done" }),
        ],
      }),
      planner: {
        async replan() {
          throw new Error("final repairable failure must not replan");
        },
      },
    });

    const result = await controller.start("goal_1");
    const repairMilestones = result.milestones.filter((item) =>
      item.id.startsWith("repair_"),
    );

    expect(result.status).toBe("stopped_stalled");
    expect(repairMilestones).toHaveLength(1);
    expect(repairMilestones[0]?.dependsOn).toContain("milestone_initial");
    expect(repairMilestones[0]?.successCriteria).toEqual(result.successCriteria);
    expect(runtime.runMilestoneIds.filter((id) => id.startsWith("repair_"))).toHaveLength(2);
  });

  it.each([
    ["iterations", { maxIterations: 1 }, { iterations: 1 }],
    ["tool calls", { maxToolCalls: 2 }, { toolCalls: 2 }],
    ["wall clock", { maxWallClockMs: 50 }, { wallClockMs: 50 }],
    ["tokens", { maxTokens: 10 }, { tokens: 10 }],
  ] as const)(
    "enforces the final %s hard budget before evaluateGoal",
    async (_label, budgetOverride, usageOverride) => {
      const base = createProtocolV2Goal(
        [
          {
            ...milestone("milestone_done"),
            state: "accepted",
            runIds: ["run_done"],
            attempts: 1,
          },
        ],
        { status: "executing" },
      );
      await store.save({
        ...base,
        budget: { ...base.budget, ...budgetOverride },
        budgetUsage: { ...base.budgetUsage, ...usageOverride },
      });
      let goalAcceptanceCalls = 0;
      const controller = createController({
        runtime: {
          async runMilestone() {
            throw new Error("final budget must stop before runtime");
          },
        },
        acceptance: {
          async evaluate() {
            throw new Error("final budget must stop before milestone acceptance");
          },
          async evaluateGoal() {
            goalAcceptanceCalls += 1;
            return acceptedResult("check_done", { evidenceManifest: emptyManifest });
          },
        },
      });

      const result = await controller.resume("goal_1");

      expect(result.status).toBe("stopped_budget");
      expect(result.stopReason).toBe("budget_exhausted");
      expect(goalAcceptanceCalls).toBe(0);
    },
  );

  it("runs a pending final repair whose predecessor was skipped", async () => {
    const skipped = {
      ...milestone("milestone_skipped"),
      state: "skipped" as const,
    };
    const accepted = {
      ...milestone("milestone_accepted"),
      state: "accepted" as const,
      runIds: ["run_accepted"],
      attempts: 1,
    };
    const repair = {
      ...milestone("repair_abcdef123456", [skipped.id, accepted.id]),
      state: "pending" as const,
    };
    await store.save(
      createProtocolV2Goal([skipped, accepted, repair], { status: "executing" }),
    );
    const runtime = createRuntime();
    const controller = createController({
      runtime,
      acceptance: createAcceptanceResults({
        milestones: [acceptedResult("check_done")],
        goals: [acceptedResult("check_done", { evidenceManifest: emptyManifest })],
      }),
    });

    const result = await controller.resume("goal_1");

    expect(runtime.runMilestoneIds).toEqual(["repair_abcdef123456"]);
    expect(result.status).toBe("achieved");
  });

  it("always performs fresh final goal acceptance instead of using covered milestone checks", async () => {
    let finalGoalReviewCalls = 0;
    await store.save(
      createGoal([milestone("milestone_bookmarks")], {
        successCriteria: [modelReviewCriterion],
        milestones: [
          {
            ...milestone("milestone_bookmarks"),
            successCriteria: [modelReviewCriterion],
          },
        ],
      }),
    );
    const controller = createController({
      runtime: createRuntime(),
      acceptance: {
        async evaluate() {
          return acceptedResult("check_goal_review", {
            kind: "model_review",
            evidenceRefs: ["artifact:goalEvidence"],
          });
        },
        async evaluateGoal() {
          finalGoalReviewCalls += 1;
          return acceptedResult("check_goal_review", {
            kind: "model_review",
            evidenceRefs: ["artifact:goalEvidence"],
          });
        },
      },
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("achieved");
    expect(finalGoalReviewCalls).toBe(1);
  });

  it("atomically achieves a protocol-v2 deterministic goal with a valid certificate", async () => {
    await store.save(createProtocolV2Goal([milestone("milestone_1")]));
    const controller = createController({
      runtime: createRuntime(),
      acceptance: createAcceptanceResults({
        milestones: [acceptedResult("check_done")],
        goals: [acceptedResult("check_done", { evidenceManifest: emptyManifest })],
      }),
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("achieved");
    expect(result.acceptanceState?.phase).toBe("certified");
    expect(result.acceptanceCertificate).toMatchObject({
      goalId: "goal_1",
      protocolVersion: 2,
      runIds: ["run_milestone_1_1"],
    });
    expect(verifyGoalAcceptanceCertificate(result)).toEqual({ ok: true });
    expect(trajectoryEvents.map((event) => event.type)).toContain(
      "acceptance_certified",
    );
  });

  it("never certifies when final acceptance is unavailable", async () => {
    await store.save(createProtocolV2Goal([milestone("milestone_1")]));
    const controller = createController({
      runtime: createRuntime(),
      acceptance: createAcceptanceResults({
        milestones: [acceptedResult("check_done")],
        goals: [
          rejectedResult("judge_invalid_response", {
            verdict: "acceptance_unavailable",
            failureClass: "judge_unavailable",
          }),
        ],
      }),
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("stopped_blocked");
    expect(result.stopReason).toBe("acceptance_unavailable");
    expect(result.acceptanceCertificate).toBeUndefined();
  });

  it("atomically certifies a protocol-v2 semantic goal with cold-judge metadata", async () => {
    const semanticManifest: GoalEvidenceManifest = {
      version: 1,
      generatedAt: "2026-06-12T00:00:00.000Z",
      artifacts: [
        {
          ref: "artifact:goalEvidence",
          mediaType: "text/markdown",
          sizeBytes: 64,
          sha256: "a".repeat(64),
          excerpts: [],
        },
      ],
      totalRenderedChars: 64,
      truncated: false,
    };
    await store.save(
      createProtocolV2Goal(
        [
          {
            ...milestone("milestone_1"),
            successCriteria: [modelReviewCriterion],
          },
        ],
        { successCriteria: [modelReviewCriterion] },
      ),
    );
    const semanticAccepted = acceptedResult("check_goal_review", {
      kind: "model_review",
      evidenceRefs: ["artifact:goalEvidence"],
      evidenceManifest: semanticManifest,
      judge: {
        providerId: "local-provider",
        model: "cold-judge",
        promptVersion: "goal-acceptance-v2",
        evaluatedMessageIds: ["judge:system", "judge:user"],
        runIds: ["run_milestone_1_1"],
      },
    });
    const controller = createController({
      runtime: createRuntime(),
      acceptance: createAcceptanceResults({
        milestones: [semanticAccepted],
        goals: [semanticAccepted],
      }),
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("achieved");
    expect(result.acceptanceCertificate?.judge).toEqual({
      providerId: "local-provider",
      model: "cold-judge",
      promptVersion: "goal-acceptance-v2",
      evaluatedMessageIds: ["judge:system", "judge:user"],
    });
    expect(result.acceptanceCertificate?.evidence).toEqual([
      expect.objectContaining({
        ref: "artifact:goalEvidence",
        sha256: "a".repeat(64),
      }),
    ]);
    expect(verifyGoalAcceptanceCertificate(result)).toEqual({ ok: true });
  });

  it("keeps cancellation canonical when it wins during final validation", async () => {
    await store.save(createProtocolV2Goal([milestone("milestone_1")]));
    const abortController = new AbortController();
    let finalValidationEnteredResolve: (() => void) | undefined;
    const finalValidationEntered = new Promise<void>((resolve) => {
      finalValidationEnteredResolve = resolve;
    });
    let finishValidation: ((result: AcceptanceResult) => void) | undefined;
    const pendingValidation = new Promise<AcceptanceResult>((resolve) => {
      finishValidation = resolve;
    });
    const controller = createController({
      runtime: createRuntime(),
      acceptance: {
        async evaluate() {
          return acceptedResult("check_done");
        },
        async evaluateGoal() {
          finalValidationEnteredResolve?.();
          return pendingValidation;
        },
      },
    });

    const running = controller.start("goal_1", { signal: abortController.signal });
    await finalValidationEntered;
    const canonical = await store.get("goal_1");
    await store.save({
      ...canonical!,
      status: "canceled",
      stopReason: "user_canceled",
    });
    abortController.abort();
    finishValidation?.(acceptedResult("check_done", { evidenceManifest: emptyManifest }));

    const result = await running;

    expect(result.status).toBe("canceled");
    expect(result.acceptanceCertificate).toBeUndefined();
    expect(trajectoryEvents.at(-1)).toMatchObject({
      type: "goal_stopped",
      payload: expect.objectContaining({ status: "canceled" }),
    });
  });

  it("keeps cancellation canonical when it wins at the repair persistence boundary", async () => {
    await store.save(createProtocolV2Goal([milestone("milestone_1")]));
    let cancellationInjected = false;
    const racingStore: AgentGoalStore = {
      ...store,
      async save(goal) {
        if (
          !cancellationInjected &&
          goal.acceptanceState?.phase === "repairing"
        ) {
          cancellationInjected = true;
          const canonical = await store.get(goal.id);
          await store.save({
            ...canonical!,
            status: "canceled",
            stopReason: "user_canceled",
          });
        }
        return store.save(goal);
      },
    };
    const controller = createController({
      goalStore: racingStore,
      runtime: createRuntime(),
      acceptance: createAcceptanceResults({
        milestones: [rejectedResult("assertion_mismatch")],
      }),
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("canceled");
    expect(result.stopReason).toBe("user_canceled");
    expect(result.milestones[0]?.state).not.toBe("ready");
    expect(trajectoryEvents.at(-1)).toMatchObject({
      type: "goal_stopped",
      payload: expect.objectContaining({ status: "canceled" }),
    });
  });

  it("keeps cancellation canonical when it wins before certificate persistence", async () => {
    await store.save(createProtocolV2Goal([milestone("milestone_1")]));
    let cancellationInjected = false;
    const racingStore: AgentGoalStore = {
      ...store,
      async save(goal) {
        if (!cancellationInjected && goal.status === "achieved") {
          cancellationInjected = true;
          const canonical = await store.get(goal.id);
          await store.save({
            ...canonical!,
            status: "canceled",
            stopReason: "user_canceled",
          });
        }
        return store.save(goal);
      },
    };
    const controller = createController({
      goalStore: racingStore,
      runtime: createRuntime(),
      acceptance: createAcceptanceResults({
        milestones: [acceptedResult("check_done")],
        goals: [acceptedResult("check_done", { evidenceManifest: emptyManifest })],
      }),
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("canceled");
    expect(result.acceptanceCertificate).toBeUndefined();
    expect(trajectoryEvents.map((event) => event.type)).not.toContain(
      "acceptance_certified",
    );
    expect(trajectoryEvents.at(-1)).toMatchObject({
      type: "goal_stopped",
      payload: expect.objectContaining({ status: "canceled" }),
    });
  });

  it("emits all six acceptance events with typed redacted payloads and ordered progress", async () => {
    const progressEvents: GoalProgressEvent[] = [];
    await store.save(createProtocolV2Goal([milestone("milestone_1")]));
    const blockedController = createController({
      runtime: createRuntime(),
      acceptance: createAcceptanceResults({
        milestones: [
          rejectedResult("same_failure"),
          rejectedResult("same_failure"),
          rejectedResult("judge_unavailable", {
            verdict: "acceptance_unavailable",
            failureClass: "judge_unavailable",
            evidenceRefs: ["artifact:report?api_key=raw-secret"],
          }),
        ],
      }),
      onProgress(event) {
        progressEvents.push(event);
      },
    });
    await blockedController.start("goal_1");

    await store.save(
      createProtocolV2Goal([milestone("milestone_2")], { id: "goal_2" }),
    );
    const certifiedController = createController({
      runtime: createRuntime(),
      acceptance: createAcceptanceResults({
        milestones: [acceptedResult("check_done")],
        goals: [acceptedResult("check_done", { evidenceManifest: emptyManifest })],
      }),
      onProgress(event) {
        progressEvents.push(event);
      },
    });
    await certifiedController.start("goal_2");

    const expectedKinds = [
      "acceptance_manifest_created",
      "acceptance_failure_classified",
      "acceptance_repair_scheduled",
      "acceptance_strategy_changed",
      "acceptance_blocked",
      "acceptance_certified",
    ] as const;
    const eventTypes = trajectoryEvents.map((event) => event.type);
    const firstIndexes = expectedKinds.map((kind) => eventTypes.indexOf(kind));
    for (const kind of expectedKinds) {
      const events = trajectoryEvents.filter((event) => event.type === kind);
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.redaction).toMatchObject({
          containsApiKey: false,
          containsFileContent: false,
        });
        expect(event.payload).not.toHaveProperty("detail");
        expect(JSON.stringify(event.payload)).not.toContain("raw-secret");
      }
      expect(progressEvents.map((event) => event.event)).toContain(kind);
    }
    expect(firstIndexes).toEqual([...firstIndexes].sort((left, right) => left - right));

    const blockedLedger = await store.readLedger("goal_1");
    const certifiedLedger = await store.readLedger("goal_2");
    const ledgerKinds = [...blockedLedger, ...certifiedLedger].map((event) => event.kind);
    expect(ledgerKinds).toEqual(expect.arrayContaining(expectedKinds));
  });

  it("clears recent runtime action signatures when a run suspends for review", async () => {
    await store.save(
      createProtocolV2Goal([milestone("milestone_1")], {
        reviewPolicy: "review_final_only",
      }),
    );
    const controller = createController({
      runtime: {
        async runMilestone() {
          return {
            runId: "run_with_actions",
            toolCallCount: 1,
            status: "succeeded",
            actionSignatures: ["file_write:stale-cross-run-signature"],
          };
        },
      },
      acceptance: createAcceptanceResults({
        milestones: [acceptedResult("check_done")],
        goals: [
          rejectedResult("external_missing", {
            verdict: "blocked_external",
            failureClass: "external_dependency_missing",
          }),
        ],
      }),
    });

    const waiting = await controller.start("goal_1");
    expect(waiting.status).toBe("waiting_for_review");
    await controller.resolveReview("goal_1", { kind: "approve_continue" });
    const blocked = await waitForGoalStatus("stopped_blocked");

    expect(blocked.acceptanceState?.recentFailures.at(-1)?.actionSignatures).toEqual([]);
  });

  it("persists only byte-bounded redacted action signatures from a hostile runtime", async () => {
    const rawSecret = "RAW_PRIVATE_ACTION".repeat(4_000);
    await store.save(createProtocolV2Goal([milestone("milestone_1")]));
    const controller = createController({
      runtime: {
        async runMilestone() {
          return {
            runId: "run_hostile_actions",
            toolCallCount: 2,
            status: "succeeded",
            actionSignatures: [
              `file_write:${rawSecret}`,
              "shell_exec:curl https://secret.invalid/run?api_key=query-secret -H 'Authorization: Bearer bearer-secret'",
            ],
          };
        },
      },
      acceptance: createAcceptanceResults({
        milestones: [
          rejectedResult("external_missing", {
            verdict: "blocked_external",
            failureClass: "external_dependency_missing",
          }),
        ],
      }),
    });

    const result = await controller.start("goal_1");
    const persisted = result.acceptanceState?.recentFailures.at(-1)?.actionSignatures ?? [];
    const serialized = JSON.stringify(persisted);

    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(8_192);
    expect(serialized).not.toContain("RAW_PRIVATE_ACTION");
    expect(serialized).not.toContain("secret.invalid");
    expect(serialized).not.toContain("query-secret");
    expect(serialized).not.toContain("bearer-secret");
  });

  it("clears terminal publication keys between completed runs of the same goal", async () => {
    await store.save(createProtocolV2Goal([milestone("milestone_1")]));
    let acceptanceCalls = 0;
    const controller = createController({
      runtime: createRuntime(),
      acceptance: {
        async evaluate() {
          acceptanceCalls += 1;
          const canonical = await store.get("goal_1");
          await store.save({
            ...canonical!,
            status: "stopped_blocked",
            stopReason: "external_blocked",
          });
          return acceptedResult("check_done");
        },
        async evaluateGoal() {
          throw new Error("interrupted milestone must not reach final acceptance");
        },
      },
    });

    const first = await controller.start("goal_1");
    expect(first.status).toBe("stopped_blocked");
    await store.save({
      ...first,
      status: "executing",
      stopReason: undefined,
      milestones: first.milestones.map((item) => ({ ...item, state: "ready" })),
    });
    const second = await controller.resume("goal_1");

    expect(second.status).toBe("stopped_blocked");
    expect(acceptanceCalls).toBe(2);
    expect(
      trajectoryEvents.filter(
        (event) =>
          event.type === "goal_stopped" &&
          event.payload.status === "stopped_blocked",
      ),
    ).toHaveLength(2);
  });

  function createController(options: {
    runtime: GoalRuntimeEngine;
    acceptance: ReturnType<typeof createAcceptance>;
    goalStore?: AgentGoalStore;
    planner?: { replan(goal: Goal, reason: string): Promise<Milestone[]> };
    stallThreshold?: number;
    onProgress?: (event: GoalProgressEvent) => void;
    onTrajectoryAppend?: (event: AgentTrajectoryEvent) => Promise<void> | void;
  }) {
    return createAgentGoalController({
      goalStore: options.goalStore ?? store,
      runtimeEngine: options.runtime,
      acceptance: options.acceptance,
      planner:
        options.planner ?? {
          async replan(goal) {
            goal.planVersion += 1;
            goal.budgetUsage.replans += 1;
            return goal.milestones;
          },
        },
      trajectoryStore: {
        async append(_runId, event) {
          await options.onTrajectoryAppend?.(event);
          trajectoryEvents.push(event);
          return event;
        },
      },
      onProgress: options.onProgress,
      stallThreshold: options.stallThreshold,
      createId: () => `goal_event_${trajectoryEvents.length + 1}`,
      nextSequence: () => {
        sequence += 1;
        return sequence;
      },
      now: () => "2026-06-12T00:00:00.000Z",
    });
  }

  function createRealAcceptance(options: {
    workspacePath: string;
    complete: NonNullable<AcceptanceContext["chatClient"]>["complete"];
  }) {
    const acceptance = createAgentGoalAcceptance({ judgeProviderId: "test-provider" });
    let acceptanceSequence = 0;
    const context = (
      runId: string,
      milestoneId?: string,
    ): AcceptanceContext => ({
      runId,
      goalId: "goal_1",
      ...(milestoneId ? { milestoneId } : {}),
      workspacePath: options.workspacePath,
      extraReadRoots: [],
      extraWriteRoots: [],
      locationEnv: {
        homeDir: configDir,
        platform: "darwin",
      },
      artifacts: {},
      modelProfile: {
        baseUrl: "https://judge.invalid",
        apiKey: "test-secret",
        model: "cold-judge-test",
        temperature: 0.7,
        maxTokens: 512,
      },
      chatClient: { complete: options.complete },
      toolExecutor: {
        async execute(request) {
          throw new Error(`unexpected acceptance tool call: ${request.toolName}`);
        },
      },
      trajectoryStore: {
        async append(_runId, event) {
          trajectoryEvents.push(event);
          return event;
        },
      },
      createId: () => `acceptance_event_${acceptanceSequence + 1}`,
      nextSequence: () => {
        acceptanceSequence += 1;
        return acceptanceSequence;
      },
      now: () => "2026-06-12T00:00:00.000Z",
    });

    return {
      async evaluate(currentMilestone: Milestone) {
        const runId = currentMilestone.runIds.at(-1) ?? "run_acceptance";
        return acceptance.evaluate(
          currentMilestone,
          context(runId, currentMilestone.id),
        );
      },
      async evaluateGoal(goal: Goal) {
        return acceptance.evaluateGoal(goal, context("run_final_acceptance"));
      },
    };
  }

  async function waitForGoalStatus(status: Goal["status"]): Promise<Goal> {
    return waitFor(async () => {
      const goal = await store.get("goal_1");
      return goal?.status === status ? goal : null;
    });
  }

  async function waitFor<T>(
    predicate: () => T | null | false | Promise<T | null | false>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const value = await predicate();
      if (value) {
        return value;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error("Timed out waiting for goal controller test condition.");
  }
});

const criterion: SuccessCriterion = {
  id: "criterion_done",
  description: "Accepted.",
  acceptanceChecks: [
    {
      id: "check_done",
      kind: "assertion",
      description: "Accepted.",
      params: { artifactRef: "summary", path: "accepted", equals: true },
      requiresEvidence: false,
    },
  ],
};

const modelReviewCriterion: SuccessCriterion = {
  id: "criterion_goal_review",
  description: "Chrome bookmarks are visible.",
  acceptanceChecks: [
    {
      id: "check_goal_review",
      kind: "model_review",
      description: "The goal result is supported by artifact evidence.",
      params: {
        condition: "帮我看一下我chrome浏览器的书签都有哪些",
        evidenceRefs: ["artifact:goalEvidence"],
      },
      requiresEvidence: true,
    },
  ],
};

function lateReportCriterion(reportPath: string): SuccessCriterion {
  return {
    id: "criterion_late_tenth_section",
    description: "The technical report contains all ten required sections.",
    acceptanceChecks: [
      {
        id: "check_late_tenth_section",
        kind: "model_review",
        description: "The late tenth section establishes the final conclusion.",
        params: {
          condition:
            "Verify that Section 10 Final Conclusion is present and supports completion.",
          evidenceRefs: [`artifact:${reportPath}`],
        },
        requiresEvidence: true,
      },
    ],
  };
}

function largeTenSectionReport(): string {
  return [
    ...Array.from(
      { length: 9 },
      (_, index) => `# Section ${index + 1}\nEvidence for section ${index + 1}.\n`,
    ),
    "ordinary analysis before the final section\n".repeat(70_000),
    "# Section 10 Final Conclusion\nAll ten required sections are present.\n",
    "ordinary appendix after the final section\n".repeat(70_000),
  ].join("");
}

const artifactCriterion: SuccessCriterion = {
  id: "criterion_chrome_bookmark_artifacts",
  description: "Chrome bookmark artifacts are written.",
  acceptanceChecks: [
    {
      id: "check_bookmark_artifact",
      kind: "file_exists",
      description: "Complete Chrome bookmark list artifact exists.",
      params: {
        path: "bookmark_list.md",
        artifactRef: "artifact:bookmark_list",
        destination: { kind: "desktop", filename: "bookmark_list.md" },
        requireProvenance: true,
      },
      requiresEvidence: false,
    },
  ],
};

const emptyManifest: GoalEvidenceManifest = {
  version: 1,
  generatedAt: "2026-06-12T00:00:00.000Z",
  artifacts: [],
  totalRenderedChars: 0,
  truncated: false,
};

function acceptedResult(
  checkId: string,
  overrides: {
    kind?: "assertion" | "model_review";
    evidenceRefs?: string[];
    evidenceManifest?: GoalEvidenceManifest;
    judge?: AcceptanceResult["judge"];
  } = {},
): AcceptanceResult {
  return {
    accepted: true,
    verdict: "accepted",
    inferentialUsed: overrides.kind === "model_review",
    checkResults: [
      {
        checkId,
        kind: overrides.kind ?? "assertion",
        passed: true,
        code: "accepted",
        evidenceRefs: overrides.evidenceRefs ?? [],
        detail: "Accepted.",
      },
    ],
    ...(overrides.evidenceManifest
      ? { evidenceManifest: overrides.evidenceManifest }
      : {}),
    ...(overrides.judge ? { judge: overrides.judge } : {}),
  };
}

function rejectedResult(
  code: string,
  overrides: {
    checkId?: string;
    verdict?: Exclude<AcceptanceResult["verdict"], "accepted">;
    failureClass?: NonNullable<AcceptanceResult["failureClass"]>;
    evidenceRefs?: string[];
    evidenceManifest?: GoalEvidenceManifest;
  } = {},
): AcceptanceResult {
  const failureClass = overrides.failureClass ?? "assertion_failed";
  return {
    accepted: false,
    verdict: overrides.verdict ?? "rejected_repairable",
    failureClass,
    inferentialUsed: failureClass === "judge_unavailable",
    checkResults: [
      {
        checkId: overrides.checkId ?? "check_done",
        kind: "assertion",
        passed: false,
        code,
        failureClass,
        evidenceRefs: overrides.evidenceRefs ?? [],
        detail: "Free-form wording must not drive policy.",
      },
    ],
    ...(overrides.evidenceManifest
      ? { evidenceManifest: overrides.evidenceManifest }
      : {}),
  };
}

function createAcceptanceResults(options: {
  milestones: AcceptanceResult[];
  goals?: AcceptanceResult[];
}) {
  const milestones = [...options.milestones];
  const goals = [...(options.goals ?? [])];
  return {
    async evaluate() {
      return milestones.shift() ?? rejectedResult("missing_test_result");
    },
    async evaluateGoal() {
      return goals.shift() ?? rejectedResult("missing_goal_test_result");
    },
  };
}

function createGoal(
  milestones: Milestone[],
  overrides: Partial<Goal> = {},
): Goal {
  return {
    id: "goal_1",
    description: "Complete bounded goal.",
    successCriteria: [criterion],
    milestones,
    status: "planning",
    budget: {
      maxIterations: 8,
      maxToolCalls: 99,
      maxWallClockMs: 600_000,
      maxReplans: 2,
    },
    budgetUsage: {
      iterations: 0,
      toolCalls: 0,
      wallClockMs: 0,
      tokens: 0,
      replans: 0,
    },
    reviewPolicy: "review_high_risk_only",
    planVersion: 1,
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    ...overrides,
  };
}

function createProtocolV2Goal(
  milestones: Milestone[],
  overrides: Partial<Goal> = {},
): Goal {
  return createGoal(milestones, {
    acceptanceProtocolVersion: 2,
    acceptanceState: {
      protocolVersion: 2,
      phase: "idle",
      attempt: 0,
      recentFailures: [],
    },
    ...overrides,
  });
}

function milestone(id: string, dependsOn: string[] = []): Milestone {
  return {
    id,
    description: `Milestone ${id}`,
    dependsOn,
    successCriteria: [criterion],
    state: dependsOn.length === 0 ? "ready" : "pending",
    runIds: [],
    attempts: 0,
  };
}

function createRuntime(): GoalRuntimeEngine & { runMilestoneIds: string[] } {
  const runMilestoneIds: string[] = [];
  return {
    runMilestoneIds,
    async runMilestone(_goal, milestone) {
      runMilestoneIds.push(milestone.id);
      return {
        runId: `run_${milestone.id}_${runMilestoneIds.length}`,
        toolCallCount: 1,
        wallClockMs: 100,
        tokens: 10,
      };
    },
  };
}

function createDeferredRuntime(): GoalRuntimeEngine & {
  calls: Array<{
    milestoneId: string;
    resolve: (result: Awaited<ReturnType<GoalRuntimeEngine["runMilestone"]>>) => void;
  }>;
} {
  const calls: Array<{
    milestoneId: string;
    resolve: (result: Awaited<ReturnType<GoalRuntimeEngine["runMilestone"]>>) => void;
  }> = [];
  return {
    calls,
    async runMilestone(_goal, milestone) {
      return new Promise((resolve) => {
        calls.push({ milestoneId: milestone.id, resolve });
      });
    },
  };
}

function createAcceptance(options: {
  milestoneAccepted: boolean[];
  goalAccepted?: boolean[];
}) {
  const milestoneAccepted = [...options.milestoneAccepted];
  const goalAccepted = [...(options.goalAccepted ?? [true])];
  return {
    async evaluate() {
      const accepted = milestoneAccepted.shift() ?? false;
      return {
        accepted,
        inferentialUsed: false,
        checkResults: [
          {
            checkId: "check_done",
            kind: "assertion" as const,
            passed: accepted,
            evidenceRefs: [],
            detail: accepted ? "Accepted." : "Rejected.",
          },
        ],
      };
    },
    async evaluateGoal() {
      const accepted = goalAccepted.shift() ?? false;
      return {
        accepted,
        inferentialUsed: false,
        checkResults: [
          {
            checkId: "check_goal",
            kind: "assertion" as const,
            passed: accepted,
            evidenceRefs: [],
            detail: accepted ? "Goal accepted." : "Goal rejected.",
          },
        ],
      };
    },
  };
}
