import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Goal, Milestone, SuccessCriterion } from "../shared/agentGoal";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import type { GoalProgressEvent } from "../shared/chat";
import { createAgentGoalStore, type AgentGoalStore } from "./agentGoalStore";
import {
  createAgentGoalController,
  type GoalRuntimeEngine,
} from "./agentGoalController";

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

  it("replans after acceptance failure and records replan usage", async () => {
    await store.save(createGoal([milestone("milestone_original")]));
    const runtime = createRuntime();
    const controller = createController({
      runtime,
      acceptance: createAcceptance({
        milestoneAccepted: [false, true],
        goalAccepted: [true],
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
      acceptance: createAcceptance({ milestoneAccepted: [false, false] }),
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
          return {
            accepted: false,
            inferentialUsed: false,
            checkResults: [],
          };
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
    expect(ledger.at(-1)?.kind).toBe("review_requested");
    expect(ledger.at(-1)?.summary).toContain("turn limit");
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
        milestoneAccepted: [false, true],
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
      budget: { ...stopped.budget, maxIterations: 2 },
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
      acceptance: createAcceptance({ milestoneAccepted: [false] }),
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
      acceptance: createAcceptance({ milestoneAccepted: [false] }),
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
      acceptance: createAcceptance({
        milestoneAccepted: [true, true],
        goalAccepted: [false, true],
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
    expect(replanReasons).toEqual(["Goal rejected."]);
    expect(runtime.runMilestoneIds).toEqual([
      "milestone_initial",
      "milestone_followup",
    ]);
    expect(trajectoryEvents.map((event) => event.type)).toContain("goal_replanned");
  });

  it("achieves covered model-review goals from accepted milestone evidence", async () => {
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
          return {
            accepted: false,
            inferentialUsed: true,
            checkResults: [
              {
                checkId: "check_goal_review",
                kind: "model_review",
                passed: false,
                evidenceRefs: ["artifact:goalEvidence"],
                detail: "Should not need a second model review.",
              },
            ],
          };
        },
      },
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("achieved");
    expect(result.stopReason).toBe("goal_accepted");
    expect(finalGoalReviewCalls).toBe(0);
  });

  it("achieves covered provenance artifact goals from accepted milestone evidence", async () => {
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
            accepted: false,
            inferentialUsed: false,
            checkResults: [
              {
                checkId: "check_bookmark_artifact",
                kind: "file_exists",
                passed: false,
                evidenceRefs: ["artifact:bookmark_list", "provenance:bookmark_list"],
                detail: "Should not need duplicate provenance validation.",
              },
            ],
          };
        },
      },
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("achieved");
    expect(result.stopReason).toBe("goal_accepted");
    expect(finalGoalAcceptanceCalls).toBe(0);
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

  function createController(options: {
    runtime: GoalRuntimeEngine;
    acceptance: ReturnType<typeof createAcceptance>;
    planner?: { replan(goal: Goal, reason: string): Promise<Milestone[]> };
    stallThreshold?: number;
    onProgress?: (event: GoalProgressEvent) => void;
    onTrajectoryAppend?: (event: AgentTrajectoryEvent) => Promise<void> | void;
  }) {
    return createAgentGoalController({
      goalStore: store,
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
