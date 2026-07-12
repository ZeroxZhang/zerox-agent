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
import {
  createAcceptanceLogicalFailureFingerprint,
  createToolActionSignature,
} from "./agentGoalFailureFingerprint";

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

  it("holds the authoritative active-goal lease for the full controller run", async () => {
    await store.save(createGoal([milestone("milestone_1")]));
    const changes: Array<[string, boolean]> = [];
    const controller = createController({
      runtime: createRuntime(),
      acceptance: createAcceptance({
        milestoneAccepted: [true],
        goalAccepted: [true],
      }),
      onActiveGoalChange(goalId, active) {
        changes.push([goalId, active]);
      },
    });

    await controller.start("goal_1");

    expect(changes).toEqual([
      ["goal_1", true],
      ["goal_1", false],
    ]);
  });

  it("persists a resumable checkpoint and incremental usage before a milestone finishes", async () => {
    await store.save(createGoal([milestone("milestone_1")]));
    let releaseRun: (() => void) | undefined;
    let checkpointSaved: (() => void) | undefined;
    const checkpointReached = new Promise<void>((resolve) => {
      checkpointSaved = resolve;
    });
    const runtime: GoalRuntimeEngine = {
      async runMilestone(_goal, milestone, runOptions) {
        await runOptions?.onCheckpoint?.({
          transcriptMessages: [
            { role: "assistant", content: "inspected repository" },
          ],
          toolCallCount: 2,
          wallClockMs: 500,
          tokens: 25,
          nextAction: "Run the focused tests.",
        });
        checkpointSaved?.();
        await new Promise<void>((resolve) => {
          releaseRun = resolve;
        });
        return {
          runId: `run_${milestone.id}`,
          toolCallCount: 2,
          wallClockMs: 500,
          tokens: 25,
          transcriptMessages: [
            { role: "assistant", content: "inspected repository" },
          ],
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

    const running = controller.start("goal_1");
    await checkpointReached;
    const checkpointed = await store.get("goal_1");

    expect(checkpointed?.runtimeCheckpoint).toMatchObject({
      milestoneId: "milestone_1",
      nextAction: "Run the focused tests.",
      transcriptMessages: [
        { role: "assistant", content: "inspected repository" },
      ],
    });
    expect(checkpointed?.budgetUsage).toMatchObject({
      toolCalls: 2,
      wallClockMs: 500,
      tokens: 25,
    });

    releaseRun?.();
    const result = await running;
    expect(result.budgetUsage).toMatchObject({
      toolCalls: 2,
      wallClockMs: 500,
      tokens: 25,
    });
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

  it("continues internally instead of requesting review for a turn-limited milestone", async () => {
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

    expect(result.status).not.toBe("waiting_for_review");
    expect(acceptanceCalls).toBeGreaterThan(1);
    expect(plannerCalls).toBe(0);
    expect(ledger.some((event) => event.kind === "review_requested")).toBe(false);
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
    const attemptedActions = [
      createToolActionSignature("test_run", {
        command: "npm test -- --runInBand",
        cwd: "/workspace",
      }),
      createToolActionSignature("test_run", {
        command: "npm run verify -- --reporter=dot",
        cwd: "/workspace",
      }),
      createToolActionSignature("file_read", {
        path: "/workspace/reports/verification.json",
        offset: 256,
      }),
    ];
    let plannerCalls = 0;
    const runtime: GoalRuntimeEngine = {
      async runMilestone(currentGoal, currentMilestone, runOptions) {
        goalDirectives.push(currentGoal.acceptanceState?.lastDecision);
        directives.push(runOptions?.repairDirective);
        return {
          runId: `run_${currentMilestone.id}_${directives.length}`,
          toolCallCount: 1,
          status: "succeeded",
          actionSignatures: [attemptedActions[directives.length - 1]!],
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
    expect(
      result.acceptanceState?.recentFailures.map((failure) => failure.actionSignatures),
    ).toEqual(attemptedActions.map((signature) => [signature]));
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
    for (const prompt of judgePrompts) {
      expectLateHeadingInStructuralEvidence(prompt, reportPath, report);
    }
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
    for (const prompt of judgePrompts) {
      expectLateHeadingInStructuralEvidence(prompt, reportPath, report);
    }
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

  it("leaves a successful hard-cap milestone ready and schedules it after budget recovery", async () => {
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
    let runtimeCalls = 0;
    let acceptanceCalls = 0;
    const controller = createController({
      runtime: {
        async runMilestone(_goal, currentMilestone) {
          runtimeCalls += 1;
          return {
            runId: `run_${currentMilestone.id}_${runtimeCalls}`,
            toolCallCount: 1,
            status: "succeeded",
          };
        },
      },
      acceptance: {
        async evaluate() {
          acceptanceCalls += 1;
          return acceptedResult("check_done");
        },
        async evaluateGoal() {
          return acceptedResult("check_done", { evidenceManifest: emptyManifest });
        },
      },
    });

    const stopped = await controller.start("goal_1");

    expect(stopped.status).toBe("stopped_budget");
    expect(stopped.milestones[0]).toMatchObject({
      state: "ready",
      lastRunStatus: "succeeded",
      runIds: ["run_milestone_1_1"],
    });
    expect(acceptanceCalls).toBe(0);

    await store.save({
      ...stopped,
      status: "executing",
      stopReason: undefined,
      budget: { ...stopped.budget, maxIterations: 3 },
    });
    const recovered = await controller.resume("goal_1");

    expect(recovered.status).toBe("achieved");
    expect(runtimeCalls).toBe(2);
    expect(acceptanceCalls).toBe(1);
    expect(recovered.milestones[0]?.runIds).toEqual([
      "run_milestone_1_1",
      "run_milestone_1_2",
    ]);
  });

  it("reuses one deterministic final repair milestone and never creates a repair chain", async () => {
    await store.save(createProtocolV2Goal([milestone("milestone_initial")]));
    const attemptedActions = [
      createToolActionSignature("file_write", {
        path: "/workspace/report.md",
        content: "first repair body",
      }),
      createToolActionSignature("test_run", {
        command: "npm test -- report",
        cwd: "/workspace",
      }),
      createToolActionSignature("file_read", {
        path: "/workspace/report.md",
        offset: 512,
      }),
    ];
    const runtime: GoalRuntimeEngine & { runMilestoneIds: string[] } = {
      runMilestoneIds: [],
      async runMilestone(_goal, currentMilestone) {
        runtime.runMilestoneIds.push(currentMilestone.id);
        const attempt = runtime.runMilestoneIds.length - 1;
        return {
          runId: `run_${currentMilestone.id}_${attempt + 1}`,
          toolCallCount: 1,
          status: "succeeded",
          actionSignatures: [attemptedActions[Math.min(attempt, attemptedActions.length - 1)]!],
        };
      },
    };
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
    expect(result.acceptanceState?.recentFailures.map((failure) => failure.occurrence)).toEqual([
      1,
      2,
      3,
    ]);
    expect(new Set(result.acceptanceState?.recentFailures.map((failure) => failure.fingerprint))).toHaveProperty("size", 1);
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

  it("retries only the final judge and certifies on the second attempt", async () => {
    await store.save(createProtocolV2Goal([milestone("milestone_1")]));
    const runtime = createRuntime();
    const acceptance = createAcceptanceResults({
      milestones: [acceptedResult("check_done")],
      goals: [
        timeoutResult(),
        acceptedResult("check_done", { evidenceManifest: emptyManifest }),
      ],
    });
    const controller = createController({
      runtime,
      acceptance,
      sleep: async () => undefined,
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("achieved");
    expect(acceptance.goalCalls).toBe(2);
    expect(runtime.runMilestoneIds).toEqual(["milestone_1"]);
    expect(result.budgetUsage.toolCalls).toBe(1);
    expect(trajectoryEvents.map((event) => event.type)).toContain(
      "acceptance_retry_scheduled",
    );
  });

  it("preserves a completed goal in acceptance waiting after three timeouts", async () => {
    await store.save(
      createProtocolV2Goal([
        milestone("milestone_1"),
        milestone("milestone_2", ["milestone_1"]),
      ]),
    );
    const runtime = createRuntime();
    const acceptance = createAcceptanceResults({
      milestones: [acceptedResult("check_done"), acceptedResult("check_done")],
      goals: [timeoutResult(), timeoutResult(), timeoutResult()],
    });
    const observedSleeps: number[] = [];
    const progressEvents: GoalProgressEvent[] = [];
    const controller = createController({
      runtime,
      acceptance,
      sleep: async (ms) => {
        observedSleeps.push(ms);
      },
      onProgress(event) {
        progressEvents.push(event);
      },
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("waiting_for_acceptance");
    expect(result.stopReason).toBeUndefined();
    expect(result.acceptanceState?.phase).toBe("awaiting_user");
    expect(result.acceptanceRetryState).toMatchObject({
      attempt: 3,
      maxAttempts: 3,
      lastCode: "judge_timeout",
      resumeFrom: "final_judge",
    });
    expect(acceptance.goalCalls).toBe(3);
    expect(observedSleeps).toEqual([1_000, 2_000]);
    expect(runtime.runMilestoneIds).toEqual(["milestone_1", "milestone_2"]);
    expect(result.acceptanceCertificate).toBeUndefined();
    expect(trajectoryEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "acceptance_retry_exhausted",
        "acceptance_waiting_for_user",
      ]),
    );
    expect(trajectoryEvents.map((event) => event.type)).not.toContain(
      "goal_stopped",
    );
    expect(
      trajectoryEvents
        .filter((event) => event.type === "acceptance_retry_scheduled")
        .map((event) => [event.payload.attempt, event.payload.delayMs]),
    ).toEqual([
      [1, 1_000],
      [2, 2_000],
    ]);
    expect(
      trajectoryEvents.find(
        (event) => event.type === "acceptance_retry_exhausted",
      )?.payload.attempt,
    ).toBe(3);
    expect(
      progressEvents
        .filter((event) => event.event === "acceptance_retry_scheduled")
        .map((event) => event.message),
    ).toEqual([
      "正在重试最终验收（2/3）",
      "正在重试最终验收（3/3）",
    ]);
  });

  it("records manual completion without creating a certificate", async () => {
    await store.save(
      waitingForAcceptanceGoal({
        acceptanceState: {
          protocolVersion: 2,
          phase: "awaiting_user",
          attempt: 3,
          recentFailures: [
            {
              at: "2026-06-12T00:00:00.000Z",
              targetKind: "goal",
              targetId: "goal_1",
              fingerprint: "f".repeat(64),
              occurrence: 1,
              verdict: "acceptance_unavailable",
              failureClass: "infrastructure",
              failedCheckIds: ["check_done", "check_done"],
              evidenceRefs: ["artifact:report", "artifact:report"],
              actionSignatures: [],
            },
          ],
        },
      }),
    );
    const atomicSaveInputs: Goal[] = [];
    const recordingStore: AgentGoalStore = {
      ...store,
      async save(goal) {
        if (goal.status === "completed_unverified") {
          atomicSaveInputs.push(structuredClone(goal));
        }
        return store.save(goal);
      },
    };
    const controller = createController({
      goalStore: recordingStore,
      runtime: createRuntime(),
      acceptance: createAcceptanceResults({ milestones: [], goals: [] }),
    });

    const result = await controller.markCompletedUnverified("goal_1");

    expect(result).toMatchObject({
      status: "completed_unverified",
      stopReason: "user_marked_complete",
      manualCompletionAttestation: {
        version: 1,
        goalId: "goal_1",
        completedAt: "2026-06-12T00:00:00.000Z",
        reason: "user_marked_complete",
        failedCheckIds: ["check_done"],
        evidenceRefs: ["artifact:report"],
        lastFailureCode: "judge_timeout",
        retryCycles: 1,
      },
    });
    expect(result.manualCompletionAttestation?.evidenceFingerprint).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(result.acceptanceCertificate).toBeUndefined();
    expect(atomicSaveInputs).toHaveLength(1);
    expect(atomicSaveInputs[0]).toMatchObject({
      status: "completed_unverified",
      stopReason: "user_marked_complete",
      manualCompletionAttestation: { reason: "user_marked_complete" },
    });
    expect(atomicSaveInputs[0]?.acceptanceCertificate).toBeUndefined();
    expect(verifyGoalAcceptanceCertificate(result)).not.toEqual({ ok: true });
    expect(
      trajectoryEvents
        .filter((event) => event.type.startsWith("acceptance_manual_completion"))
        .map((event) => event.type),
    ).toEqual([
      "acceptance_manual_completion_requested",
      "acceptance_manual_completion_recorded",
    ]);
    expect(
      (await store.readLedger("goal_1"))
        .filter((event) => event.kind.startsWith("acceptance_manual_completion"))
        .map((event) => event.kind),
    ).toEqual([
      "acceptance_manual_completion_requested",
      "acceptance_manual_completion_recorded",
    ]);
  });

  it("rejects manual completion outside acceptance waiting", async () => {
    await store.save(
      createProtocolV2Goal([milestone("milestone_1")], {
        status: "executing",
      }),
    );
    const controller = createController({
      runtime: createRuntime(),
      acceptance: createAcceptanceResults({ milestones: [], goals: [] }),
    });

    await expect(controller.markCompletedUnverified("goal_1")).rejects.toThrow(
      'Cannot manually complete goal from "executing".',
    );
  });

  it.each([undefined, ""])(
    "fails closed when the canonical evidence fingerprint is %s",
    async (evidenceFingerprint) => {
      await store.save(
        waitingForAcceptanceGoal({
          acceptanceRetryState: evidenceFingerprint === undefined
            ? undefined
            : {
                cycle: 1,
                attempt: 3,
                maxAttempts: 3,
                lastCode: "judge_timeout",
                lastDetail: "Final judge timed out.",
                evidenceFingerprint,
                resumeFrom: "final_judge",
              },
        }),
      );
      const controller = createController({
        runtime: createRuntime(),
        acceptance: createAcceptanceResults({ milestones: [], goals: [] }),
      });

      await expect(
        controller.markCompletedUnverified("goal_1"),
      ).rejects.toThrow(/evidence fingerprint/i);
      expect((await store.get("goal_1"))?.status).toBe(
        "waiting_for_acceptance",
      );
      expect(trajectoryEvents).toEqual([]);
    },
  );

  it("redacts and bounds manual completion attestation data", async () => {
    const rawSecret = "sk-proj-super-secret-value";
    const failedCheckIds = Array.from(
      { length: 80 },
      (_, index) => `check_${index}?api_key=${rawSecret}${"x".repeat(800)}`,
    );
    const evidenceRefs = Array.from(
      { length: 80 },
      (_, index) => `artifact:report_${index}?access_token=${rawSecret}${"y".repeat(800)}`,
    );
    await store.save(
      waitingForAcceptanceGoal({
        acceptanceState: {
          protocolVersion: 2,
          phase: "awaiting_user",
          attempt: 3,
          recentFailures: [
            {
              at: "2026-06-12T00:00:00.000Z",
              targetKind: "goal",
              targetId: "goal_1",
              fingerprint: "f".repeat(64),
              occurrence: 1,
              verdict: "acceptance_unavailable",
              failureClass: "infrastructure",
              failedCheckIds,
              evidenceRefs,
              actionSignatures: [],
            },
          ],
        },
      }),
    );
    const controller = createController({
      runtime: createRuntime(),
      acceptance: createAcceptanceResults({ milestones: [], goals: [] }),
    });

    const result = await controller.markCompletedUnverified("goal_1");
    const attestation = result.manualCompletionAttestation!;
    const serialized = JSON.stringify(attestation);

    expect(attestation.failedCheckIds).toHaveLength(64);
    expect(attestation.evidenceRefs).toHaveLength(64);
    expect(new Set(attestation.failedCheckIds).size).toBe(64);
    expect(new Set(attestation.evidenceRefs).size).toBe(64);
    expect(
      [...attestation.failedCheckIds, ...attestation.evidenceRefs].every(
        (value) => Buffer.byteLength(value) <= 512,
      ),
    ).toBe(true);
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain(rawSecret);
    expect(JSON.stringify(trajectoryEvents)).not.toContain(rawSecret);
    expect(JSON.stringify(await store.readLedger("goal_1"))).not.toContain(
      rawSecret,
    );
  });

  it("does not record manual completion when the atomic goal save fails", async () => {
    await store.save(waitingForAcceptanceGoal());
    const failingStore: AgentGoalStore = {
      ...store,
      async save(goal) {
        if (goal.status === "completed_unverified") {
          throw new Error("disk full");
        }
        return store.save(goal);
      },
    };
    const controller = createController({
      goalStore: failingStore,
      runtime: createRuntime(),
      acceptance: createAcceptanceResults({ milestones: [], goals: [] }),
    });

    await expect(
      controller.markCompletedUnverified("goal_1"),
    ).rejects.toThrow("disk full");
    expect(
      trajectoryEvents
        .filter((event) => event.type.startsWith("acceptance_manual_completion"))
        .map((event) => event.type),
    ).toEqual(["acceptance_manual_completion_requested"]);
    expect(
      (await store.readLedger("goal_1"))
        .filter((event) => event.kind.startsWith("acceptance_manual_completion"))
        .map((event) => event.kind),
    ).toEqual(["acceptance_manual_completion_requested"]);
  });

  it("continues from the final judge without rerunning accepted milestones", async () => {
    await store.save(waitingForAcceptanceGoal());
    const runtime = createRuntime();
    const acceptance = createAcceptanceResults({
      milestones: [],
      goals: [acceptedResult("check_done", { evidenceManifest: emptyManifest })],
    });
    const controller = createController({ runtime, acceptance });

    const result = await controller.continueAcceptance("goal_1");

    expect(result.status).toBe("achieved");
    expect(result.acceptanceCertificate).toBeDefined();
    expect(runtime.runMilestoneIds).toEqual([]);
    expect(acceptance.goalCalls).toBe(1);
  });

  it("uses the acceptance retry budget even when the task budget is exhausted", async () => {
    await store.save(
      waitingForAcceptanceGoal({
        budgetUsage: {
          iterations: 8,
          toolCalls: 99,
          wallClockMs: 600_000,
          tokens: 0,
          replans: 2,
        },
      }),
    );
    const runtime = createRuntime();
    const acceptance = createAcceptanceResults({
      milestones: [],
      goals: [acceptedResult("check_done", { evidenceManifest: emptyManifest })],
    });
    const controller = createController({ runtime, acceptance });

    const result = await controller.continueAcceptance("goal_1");

    expect(result.status).toBe("achieved");
    expect(runtime.runMilestoneIds).toEqual([]);
    expect(acceptance.goalCalls).toBe(1);
    expect(result.budgetUsage).toMatchObject({
      iterations: 8,
      toolCalls: 99,
      wallClockMs: 600_000,
      replans: 2,
    });
  });

  it("keeps the task budget gate for a generic retry-state resume", async () => {
    await store.save(
      waitingForAcceptanceGoal({
        status: "executing",
        acceptanceState: {
          protocolVersion: 2,
          phase: "retrying",
          attempt: 3,
          recentFailures: [],
        },
        budgetUsage: {
          iterations: 8,
          toolCalls: 99,
          wallClockMs: 600_000,
          tokens: 0,
          replans: 2,
        },
      }),
    );
    const runtime = createRuntime();
    const acceptance = createAcceptanceResults({
      milestones: [],
      goals: [acceptedResult("check_done", { evidenceManifest: emptyManifest })],
    });
    const controller = createController({ runtime, acceptance });

    const result = await controller.resume("goal_1");

    expect(result.status).toBe("stopped_budget");
    expect(runtime.runMilestoneIds).toEqual([]);
    expect(acceptance.goalCalls).toBe(0);
  });

  it("increments the acceptance cycle and resets its local attempt", async () => {
    await store.save(
      waitingForAcceptanceGoal({
        acceptanceRetryState: {
          cycle: 4,
          attempt: 3,
          maxAttempts: 3,
          lastCode: "judge_timeout",
          lastDetail: "Final judge timed out.",
          nextRetryAt: "2026-06-12T00:00:02.000Z",
          evidenceFingerprint: evidenceFingerprint(emptyManifest),
          resumeFrom: "final_judge",
        },
      }),
    );
    let resumedGoal: Goal | undefined;
    const controller = createController({
      runtime: createRuntime(),
      acceptance: {
        async evaluate() {
          throw new Error("accepted milestones must not be evaluated again");
        },
        async evaluateGoal(goal) {
          resumedGoal = structuredClone(goal);
          return acceptedResult("check_done", { evidenceManifest: emptyManifest });
        },
      },
    });

    const result = await controller.continueAcceptance("goal_1");

    expect(result.status).toBe("achieved");
    expect(resumedGoal?.acceptanceRetryState).toMatchObject({
      cycle: 5,
      attempt: 0,
      resumeFrom: "final_judge",
    });
    expect(resumedGoal?.acceptanceRetryState?.nextRetryAt).toBeUndefined();
  });

  it("does not continue a waiting goal without a final-judge resume state", async () => {
    await store.save(
      waitingForAcceptanceGoal({ acceptanceRetryState: undefined }),
    );
    const runtime = createRuntime();
    const acceptance = createAcceptanceResults({ milestones: [], goals: [] });
    const controller = createController({ runtime, acceptance });

    const result = await controller.continueAcceptance("goal_1");

    expect(result.status).toBe("waiting_for_acceptance");
    expect(runtime.runMilestoneIds).toEqual([]);
    expect(acceptance.goalCalls).toBe(0);
  });

  it("aborts a continued final judge when its parent is canceled", async () => {
    await store.save(waitingForAcceptanceGoal());
    const abortController = new AbortController();
    let judgeEnteredResolve: (() => void) | undefined;
    const judgeEntered = new Promise<void>((resolve) => {
      judgeEnteredResolve = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    const controller = createController({
      runtime: createRuntime(),
      acceptance: {
        async evaluate() {
          throw new Error("accepted milestones must not be evaluated again");
        },
        async evaluateGoal(_goal, context) {
          observedSignal = context.signal;
          judgeEnteredResolve?.();
          return new Promise<AcceptanceResult>(() => undefined);
        },
      },
      createAcceptanceContext() {
        return {} as AcceptanceContext;
      },
    });

    const continued = controller.continueAcceptance("goal_1", {
      signal: abortController.signal,
    });
    await judgeEntered;
    const canonical = await store.get("goal_1");
    await store.save({
      ...canonical!,
      status: "canceled",
      stopReason: "user_canceled",
    });
    abortController.abort();

    const result = await continued;

    expect(result.status).toBe("canceled");
    expect(result.acceptanceCertificate).toBeUndefined();
    expect(observedSignal?.aborted).toBe(true);
  });

  it("refuses stale certification when the evidence fingerprint changes", async () => {
    const originalManifest = manifestWithHash("a".repeat(64));
    const changedManifest = manifestWithHash("b".repeat(64));
    await store.save(
      waitingForAcceptanceGoal({
        acceptanceRetryState: {
          cycle: 1,
          attempt: 3,
          maxAttempts: 3,
          lastCode: "judge_timeout",
          lastDetail: "Final judge timed out.",
          evidenceFingerprint: evidenceFingerprint(originalManifest),
          resumeFrom: "final_judge",
        },
      }),
    );
    const controller = createController({
      runtime: createRuntime(),
      acceptance: createAcceptanceResults({
        milestones: [],
        goals: [
          acceptedResult("check_done", { evidenceManifest: changedManifest }),
        ],
      }),
    });

    const result = await controller.continueAcceptance("goal_1");

    expect(result.status).toBe("waiting_for_acceptance");
    expect(result.acceptanceCertificate).toBeUndefined();
    expect(result.acceptanceState?.phase).toBe("awaiting_user");
    expect(result.acceptanceRetryState).toMatchObject({
      cycle: 2,
      lastCode: "evidence_fingerprint_mismatch",
      evidenceFingerprint: evidenceFingerprint(changedManifest),
      resumeFrom: "final_judge",
    });
  });

  it("continues real final acceptance when timeout evidence is unchanged", async () => {
    const reportPath = path.join(configDir, "stable-final-evidence.md");
    await writeFile(reportPath, "# Stable final evidence\n", "utf8");
    const evidenceRef = `artifact:${reportPath}`;
    const semanticCriterion = lateReportCriterion(reportPath);
    await store.save(
      createProtocolV2Goal(
        [
          {
            ...milestone("milestone_1"),
            successCriteria: [semanticCriterion],
            state: "accepted",
            attempts: 1,
            runIds: ["run_done"],
          },
        ],
        {
          status: "executing",
          successCriteria: [semanticCriterion],
        },
      ),
    );
    let judgedAppends = 0;
    const acceptance = createRealAcceptance({
      workspacePath: configDir,
      finalJudgeTimeoutMs: 5,
      async complete() {
        return {
          content: JSON.stringify({
            verdict: "accepted",
            reason: "Stable evidence proves completion.",
            evidenceRefs: [evidenceRef],
          }),
          toolCalls: [],
          finishReason: "stop",
        };
      },
      onTrajectoryAppend(event, appendOptions) {
        if (event.type !== "goal_judged") return;
        judgedAppends += 1;
        if (judgedAppends > 3) return;
        return new Promise<void>((_resolve, reject) => {
          appendOptions?.signal?.addEventListener(
            "abort",
            () => reject(appendOptions.signal?.reason),
            { once: true },
          );
        });
      },
    });
    const controller = createController({
      runtime: createRuntime(),
      acceptance,
      sleep: async () => undefined,
    });

    const waiting = await controller.resume("goal_1");
    const result = await controller.continueAcceptance("goal_1");

    expect(waiting.status).toBe("waiting_for_acceptance");
    expect(waiting.acceptanceRetryState?.evidenceFingerprint).not.toBe("");
    expect(result.status).toBe("achieved");
    expect(result.acceptanceCertificate?.evidence).toEqual([
      expect.objectContaining({
        ref: evidenceRef,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
  });

  it("does not treat an empty persisted fingerprint as a certification bypass", async () => {
    await store.save(
      waitingForAcceptanceGoal({
        acceptanceRetryState: {
          cycle: 1,
          attempt: 3,
          maxAttempts: 3,
          lastCode: "judge_timeout",
          lastDetail: "Final judge timed out.",
          evidenceFingerprint: "",
          resumeFrom: "final_judge",
        },
      }),
    );
    const controller = createController({
      runtime: createRuntime(),
      acceptance: createAcceptanceResults({
        milestones: [],
        goals: [acceptedResult("check_done", { evidenceManifest: emptyManifest })],
      }),
    });

    const result = await controller.continueAcceptance("goal_1");

    expect(result.status).toBe("waiting_for_acceptance");
    expect(result.acceptanceCertificate).toBeUndefined();
    expect(result.acceptanceRetryState?.evidenceFingerprint).toBe(
      evidenceFingerprint(emptyManifest),
    );
  });

  it("upgrades an eligible legacy acceptance-unavailable goal into a final-only cycle", async () => {
    await store.save(
      createGoal(
        [
          {
            ...milestone("milestone_1"),
            state: "accepted",
            attempts: 1,
            runIds: ["run_done"],
          },
        ],
        {
          status: "stopped_blocked",
          stopReason: "acceptance_unavailable",
        },
      ),
    );
    const runtime = createRuntime();
    let observedRetryState: Goal["acceptanceRetryState"];
    const controller = createController({
      runtime,
      acceptance: {
        async evaluate() {
          throw new Error("accepted milestones must not be evaluated again");
        },
        async evaluateGoal(goal) {
          observedRetryState = goal.acceptanceRetryState;
          return acceptedResult("check_done", { evidenceManifest: emptyManifest });
        },
      },
    });

    const result = await controller.continueAcceptance("goal_1");

    expect(result.status).toBe("achieved");
    expect(result.acceptanceProtocolVersion).toBe(2);
    expect(observedRetryState).toBeUndefined();
    expect(result.acceptanceRetryState).toBeUndefined();
    expect(runtime.runMilestoneIds).toEqual([]);
  });

  it("leaves an incomplete legacy goal on the generic retry path", async () => {
    await store.save(
      createGoal([milestone("milestone_1")], {
        status: "stopped_blocked",
        stopReason: "acceptance_unavailable",
      }),
    );
    const runtime = createRuntime();
    const acceptance = createAcceptanceResults({ milestones: [], goals: [] });
    const controller = createController({ runtime, acceptance });

    const result = await controller.continueAcceptance("goal_1");

    expect(result).toMatchObject({
      status: "stopped_blocked",
      stopReason: "acceptance_unavailable",
    });
    expect(runtime.runMilestoneIds).toEqual([]);
    expect(acceptance.goalCalls).toBe(0);
  });

  it("starts a fresh final-only cycle after a second exhausted cycle", async () => {
    await store.save(waitingForAcceptanceGoal());
    const runtime = createRuntime();
    const acceptance = createAcceptanceResults({
      milestones: [],
      goals: Array.from({ length: 6 }, () =>
        timeoutResult({ evidenceManifest: emptyManifest }),
      ),
    });
    const controller = createController({
      runtime,
      acceptance,
      sleep: async () => undefined,
    });

    const secondCycle = await controller.continueAcceptance("goal_1");
    const thirdCycle = await controller.continueAcceptance("goal_1");

    expect(secondCycle).toMatchObject({
      status: "waiting_for_acceptance",
      acceptanceRetryState: { cycle: 2, attempt: 3 },
    });
    expect(thirdCycle).toMatchObject({
      status: "waiting_for_acceptance",
      acceptanceRetryState: { cycle: 3, attempt: 3 },
    });
    expect(runtime.runMilestoneIds).toEqual([]);
    expect(acceptance.goalCalls).toBe(6);
  });

  it("does not let a late continued judge overwrite manual completion", async () => {
    await store.save(waitingForAcceptanceGoal());
    let judgeEnteredResolve: (() => void) | undefined;
    const judgeEntered = new Promise<void>((resolve) => {
      judgeEnteredResolve = resolve;
    });
    let finishJudge: ((result: AcceptanceResult) => void) | undefined;
    const pendingJudge = new Promise<AcceptanceResult>((resolve) => {
      finishJudge = resolve;
    });
    const controller = createController({
      runtime: createRuntime(),
      acceptance: {
        async evaluate() {
          throw new Error("accepted milestones must not be evaluated again");
        },
        async evaluateGoal() {
          judgeEnteredResolve?.();
          return pendingJudge;
        },
      },
    });

    const continued = controller.continueAcceptance("goal_1");
    await judgeEntered;
    const canonical = await store.get("goal_1");
    await store.save({
      ...canonical!,
      status: "completed_unverified",
      stopReason: "user_marked_complete",
      acceptanceCertificate: undefined,
      manualCompletionAttestation: {
        version: 1,
        goalId: "goal_1",
        completedAt: "2026-06-12T00:00:00.000Z",
        reason: "user_marked_complete",
        failedCheckIds: ["check_done"],
        evidenceRefs: [],
        evidenceFingerprint: evidenceFingerprint(emptyManifest),
        lastFailureCode: "judge_timeout",
        retryCycles: 2,
      },
    });
    finishJudge?.(
      acceptedResult("check_done", { evidenceManifest: emptyManifest }),
    );

    const result = await continued;

    expect(result.status).toBe("completed_unverified");
    expect(result.acceptanceCertificate).toBeUndefined();
    expect(result.manualCompletionAttestation).toBeDefined();
  });

  it("keeps legacy final acceptance unavailable on the blocked path", async () => {
    await store.save(createGoal([milestone("milestone_1")]));
    let sleepCalls = 0;
    const controller = createController({
      runtime: createRuntime(),
      acceptance: createAcceptanceResults({
        milestones: [acceptedResult("check_done")],
        goals: [timeoutResult()],
      }),
      sleep: async () => {
        sleepCalls += 1;
        throw new Error("legacy goals must not enter final acceptance retry");
      },
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("stopped_blocked");
    expect(result.stopReason).toBe("acceptance_unavailable");
    expect(result.acceptanceRetryState).toBeUndefined();
    expect(sleepCalls).toBe(0);
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

  it.each([
    ["blocked_external", "external_dependency_missing", "external_blocked"],
    ["impossible", "goal_impossible", "goal_impossible"],
  ] as const)(
    "keeps final %s acceptance terminal instead of waiting",
    async (verdict, failureClass, stopReason) => {
      await store.save(createProtocolV2Goal([milestone("milestone_1")]));
      const controller = createController({
        runtime: createRuntime(),
        acceptance: createAcceptanceResults({
          milestones: [acceptedResult("check_done")],
          goals: [
            rejectedResult(`${verdict}_final`, { verdict, failureClass }),
          ],
        }),
      });

      const result = await controller.start("goal_1");

      expect(result.status).toBe("stopped_blocked");
      expect(result.stopReason).toBe(stopReason);
      expect(result.acceptanceState?.phase).toBe("blocked");
      expect(result.acceptanceRetryState).toBeUndefined();
    },
  );

  it("keeps certificate construction failure terminal instead of waiting", async () => {
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
    const controller = createController({
      runtime: createRuntime(),
      acceptance: createAcceptanceResults({
        milestones: [
          acceptedResult("check_goal_review", { kind: "model_review" }),
        ],
        goals: [
          acceptedResult("check_goal_review", {
            kind: "model_review",
            evidenceManifest: emptyManifest,
          }),
        ],
      }),
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("stopped_blocked");
    expect(result.stopReason).toBe("acceptance_unavailable");
    expect(result.acceptanceState?.phase).toBe("blocked");
    expect(result.acceptanceRetryState).toBeUndefined();
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

  it("aborts a pending final judge without waiting for it to settle", async () => {
    await store.save(createProtocolV2Goal([milestone("milestone_1")]));
    const abortController = new AbortController();
    let finalJudgeEnteredResolve: (() => void) | undefined;
    const finalJudgeEntered = new Promise<void>((resolve) => {
      finalJudgeEnteredResolve = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    const controller = createController({
      runtime: createRuntime(),
      acceptance: {
        async evaluate() {
          return acceptedResult("check_done");
        },
        async evaluateGoal(_goal, context) {
          observedSignal = context.signal;
          finalJudgeEnteredResolve?.();
          return new Promise<AcceptanceResult>(() => undefined);
        },
      },
      createAcceptanceContext() {
        return {} as AcceptanceContext;
      },
    });

    const running = controller.start("goal_1", {
      signal: abortController.signal,
    });
    await finalJudgeEntered;
    const canonical = await store.get("goal_1");
    await store.save({
      ...canonical!,
      status: "canceled",
      stopReason: "user_canceled",
    });
    abortController.abort();

    const result = await Promise.race([
      running,
      new Promise<"timed_out">((resolve) => {
        setTimeout(() => resolve("timed_out"), 50);
      }),
    ]);

    expect(result).not.toBe("timed_out");
    expect(result).toMatchObject({
      status: "canceled",
      stopReason: "user_canceled",
    });
    expect(observedSignal?.aborted).toBe(true);
  });

  it("aborts the final acceptance retry delay without another judge attempt", async () => {
    await store.save(createProtocolV2Goal([milestone("milestone_1")]));
    const abortController = new AbortController();
    let delayEnteredResolve: (() => void) | undefined;
    const delayEntered = new Promise<void>((resolve) => {
      delayEnteredResolve = resolve;
    });
    let delaySignal: AbortSignal | undefined;
    const acceptance = createAcceptanceResults({
      milestones: [acceptedResult("check_done")],
      goals: [timeoutResult(), acceptedResult("check_done")],
    });
    const runtime = createRuntime();
    const controller = createController({
      runtime,
      acceptance,
      sleep: async (_ms, signal) => {
        delaySignal = signal;
        delayEnteredResolve?.();
        return new Promise<void>(() => undefined);
      },
    });

    const running = controller.start("goal_1", {
      signal: abortController.signal,
    });
    await delayEntered;
    const canonical = await store.get("goal_1");
    await store.save({
      ...canonical!,
      status: "canceled",
      stopReason: "user_canceled",
    });
    abortController.abort();

    const result = await running;

    expect(result.status).toBe("canceled");
    expect(acceptance.goalCalls).toBe(1);
    expect(runtime.runMilestoneIds).toEqual(["milestone_1"]);
    expect(delaySignal).toBe(abortController.signal);
    expect(delaySignal?.aborted).toBe(true);
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

  it.each([
    {
      label: "accepted",
      milestoneResult: acceptedResult("check_done", {
        kind: "model_review",
        detail:
          "Cold judge accepted. session_token=accepted-session-secret; cookie: accepted-cookie-secret " +
          "x".repeat(4_000),
        evidenceRefs: [
          "artifact:report?session_token=accepted-ref-secret&cookie=accepted-ref-cookie",
        ],
      }),
      goalResults: [acceptedResult("check_done", { evidenceManifest: emptyManifest })],
      expectedStatus: "achieved" as const,
    },
    {
      label: "rejected",
      milestoneResult: rejectedResult("judge_rejected", {
        kind: "model_review",
        verdict: "blocked_external",
        failureClass: "external_dependency_missing",
        detail:
          "Cold judge rejected. session_token=rejected-session-secret; cookie: rejected-cookie-secret " +
          "x".repeat(4_000),
        evidenceRefs: [
          "artifact:report/session_token/rejected-ref-secret?cookie=rejected-ref-cookie",
        ],
      }),
      goalResults: [],
      expectedStatus: "stopped_blocked" as const,
    },
  ])(
    "persists and publishes only bounded redacted $label cold-judge details",
    async ({ milestoneResult, goalResults, expectedStatus }) => {
      const progressEvents: GoalProgressEvent[] = [];
      await store.save(createProtocolV2Goal([milestone("milestone_1")]));
      const controller = createController({
        runtime: createRuntime(),
        acceptance: createAcceptanceResults({
          milestones: [milestoneResult],
          goals: goalResults,
        }),
        onProgress(event) {
          progressEvents.push(event);
        },
      });

      const result = await controller.start("goal_1");
      const ledger = await store.readLedger("goal_1");
      const persisted = await store.get("goal_1");
      const serialized = JSON.stringify({ result, persisted, ledger, trajectoryEvents, progressEvents });

      expect(result.status).toBe(expectedStatus);
      expect(Buffer.byteLength(result.milestones[0]?.lastAcceptanceSummary ?? "")).toBeLessThanOrEqual(1_024);
      expect(result.milestones[0]?.lastAcceptanceSummary).toContain("[redacted]");
      expect(serialized).not.toMatch(
        /accepted-session-secret|accepted-cookie-secret|accepted-ref-secret|accepted-ref-cookie|rejected-session-secret|rejected-cookie-secret|rejected-ref-secret|rejected-ref-cookie/,
      );
    },
  );

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

  it("emits one achieved terminal event when a replacement run wins a stale acceptance race", async () => {
    await store.save(
      createProtocolV2Goal([milestone("milestone_1")], { status: "executing" }),
    );
    const staleAbort = new AbortController();
    let runtimeCalls = 0;
    let acceptanceCalls = 0;
    let staleAcceptanceEnteredResolve: (() => void) | undefined;
    const staleAcceptanceEntered = new Promise<void>((resolve) => {
      staleAcceptanceEnteredResolve = resolve;
    });
    let resolveStaleAcceptance: ((result: AcceptanceResult) => void) | undefined;
    const staleAcceptance = new Promise<AcceptanceResult>((resolve) => {
      resolveStaleAcceptance = resolve;
    });
    const controller = createController({
      runtime: {
        async runMilestone(_goal, currentMilestone) {
          runtimeCalls += 1;
          return {
            runId: `run_${currentMilestone.id}_${runtimeCalls}`,
            toolCallCount: 1,
            status: "succeeded",
          };
        },
      },
      acceptance: {
        async evaluate() {
          acceptanceCalls += 1;
          if (acceptanceCalls === 1) {
            staleAcceptanceEnteredResolve?.();
            return staleAcceptance;
          }
          return acceptedResult("check_done");
        },
        async evaluateGoal() {
          return acceptedResult("check_done", { evidenceManifest: emptyManifest });
        },
      },
    });

    const staleRun = controller.resume("goal_1", { signal: staleAbort.signal });
    await staleAcceptanceEntered;
    const inFlight = await store.get("goal_1");
    await store.save({
      ...inFlight!,
      milestones: inFlight!.milestones.map((item) => ({
        ...item,
        state: item.id === "milestone_1" ? "ready" : item.state,
      })),
    });
    staleAbort.abort();

    const replacement = await controller.resume("goal_1");
    expect(replacement.status).toBe("achieved");
    resolveStaleAcceptance?.(acceptedResult("check_done"));
    const staleResult = await staleRun;

    expect(staleResult.status).toBe("achieved");
    expect(runtimeCalls).toBe(2);
    expect(
      trajectoryEvents.filter(
        (event) =>
          event.type === "goal_stopped" && event.payload.status === "achieved",
      ),
    ).toHaveLength(1);
  });

  it("keeps terminal trajectory and progress last when a stale acceptance append is deferred", async () => {
    await store.save(
      createProtocolV2Goal([milestone("milestone_1")], { status: "executing" }),
    );
    const staleAbort = new AbortController();
    const progressEvents: GoalProgressEvent[] = [];
    let runtimeCalls = 0;
    let acceptanceCalls = 0;
    let staleAppendEnteredResolve: (() => void) | undefined;
    const staleAppendEntered = new Promise<void>((resolve) => {
      staleAppendEnteredResolve = resolve;
    });
    let releaseStaleAppend: (() => void) | undefined;
    const staleAppendGate = new Promise<void>((resolve) => {
      releaseStaleAppend = resolve;
    });
    let deferredOnce = false;
    const controller = createController({
      runtime: {
        async runMilestone(_goal, currentMilestone) {
          runtimeCalls += 1;
          return {
            runId: `run_${currentMilestone.id}_${runtimeCalls}`,
            toolCallCount: 1,
            status: "succeeded",
            actionSignatures: [
              createToolActionSignature("test_run", { attempt: runtimeCalls }),
            ],
          };
        },
      },
      acceptance: {
        async evaluate() {
          acceptanceCalls += 1;
          return acceptanceCalls === 1
            ? rejectedResult("same_logical_failure")
            : rejectedResult("external_missing", {
                verdict: "blocked_external",
                failureClass: "external_dependency_missing",
              });
        },
        async evaluateGoal() {
          throw new Error("blocked replacement must not reach final acceptance");
        },
      },
      onProgress(event) {
        progressEvents.push(event);
      },
      async onTrajectoryAppend(event) {
        if (!deferredOnce && event.type === "acceptance_failure_classified") {
          deferredOnce = true;
          staleAppendEnteredResolve?.();
          await staleAppendGate;
        }
      },
    });

    const staleRun = controller.resume("goal_1", { signal: staleAbort.signal });
    await staleAppendEntered;
    const canonical = await store.get("goal_1");
    await store.save({
      ...canonical!,
      milestones: canonical!.milestones.map((item) => ({
        ...item,
        state: item.id === "milestone_1" ? "ready" : item.state,
      })),
    });
    staleAbort.abort();
    const replacementRun = controller.resume("goal_1");
    const stopped = await waitForGoalStatus("stopped_blocked");
    expect(stopped.stopReason).toBe("external_blocked");
    releaseStaleAppend?.();

    const [staleResult, replacementResult] = await Promise.all([
      staleRun,
      replacementRun,
    ]);
    const terminalTrajectoryIndex = trajectoryEvents.findLastIndex(
      (event) => event.type === "goal_stopped",
    );
    const terminalProgressIndex = progressEvents.findLastIndex(
      (event) => event.event === "stopped",
    );
    const terminalTrajectoryEvents = trajectoryEvents.filter(
      (event) => event.type === "goal_stopped",
    );
    const terminalProgressEvents = progressEvents.filter(
      (event) => event.event === "stopped",
    );

    const finalCanonical = await store.get("goal_1");
    expect(staleResult.status).toBe("executing");
    expect(replacementResult.status).toBe("stopped_blocked");
    expect(finalCanonical?.status).toBe("stopped_blocked");
    expect(terminalTrajectoryEvents).toHaveLength(1);
    expect(terminalProgressEvents).toHaveLength(1);
    expect(terminalTrajectoryIndex).toBe(trajectoryEvents.length - 1);
    expect(terminalProgressIndex).toBe(progressEvents.length - 1);
    expect(
      trajectoryEvents
        .map((event, index) => ({ event, index }))
        .filter(({ event }) => event.type.startsWith("acceptance_"))
        .every(({ index }) => index < terminalTrajectoryIndex),
    ).toBe(true);
    expect(
      trajectoryEvents.slice(terminalTrajectoryIndex + 1).filter((event) =>
        event.type.startsWith("acceptance_"),
      ),
    ).toEqual([]);
    expect(
      progressEvents.slice(terminalProgressIndex + 1).filter((event) =>
        event.event.startsWith("acceptance_"),
      ),
    ).toEqual([]);
  });

  it("aborts a never-resolving stale acceptance append and lets replacement terminal publication finish", async () => {
    await store.save(
      createProtocolV2Goal([milestone("milestone_1")], { status: "executing" }),
    );
    const staleAbort = new AbortController();
    const progressEvents: GoalProgressEvent[] = [];
    let runtimeCalls = 0;
    let acceptanceCalls = 0;
    let staleAppendEnteredResolve: (() => void) | undefined;
    const staleAppendEntered = new Promise<void>((resolve) => {
      staleAppendEnteredResolve = resolve;
    });
    let trapped = false;
    const controller = createController({
      runtime: {
        async runMilestone(_goal, currentMilestone) {
          runtimeCalls += 1;
          return {
            runId: `run_${currentMilestone.id}_${runtimeCalls}`,
            toolCallCount: 1,
            status: "succeeded",
          };
        },
      },
      acceptance: {
        async evaluate() {
          acceptanceCalls += 1;
          return acceptanceCalls === 1
            ? rejectedResult("same_failure")
            : rejectedResult("external_missing", {
                verdict: "blocked_external",
                failureClass: "external_dependency_missing",
              });
        },
        async evaluateGoal() {
          throw new Error("blocked replacement must not reach final acceptance");
        },
      },
      onProgress(event) {
        progressEvents.push(event);
      },
      onTrajectoryAppend(event, appendOptions) {
        if (trapped || event.type !== "acceptance_failure_classified") return;
        trapped = true;
        staleAppendEnteredResolve?.();
        return new Promise<void>((_resolve, reject) => {
          appendOptions?.signal?.addEventListener(
            "abort",
            () => reject(appendOptions.signal?.reason),
            { once: true },
          );
        });
      },
    });

    const staleRun = controller.resume("goal_1", { signal: staleAbort.signal });
    await staleAppendEntered;
    const canonical = await store.get("goal_1");
    await store.save({
      ...canonical!,
      milestones: canonical!.milestones.map((item) => ({
        ...item,
        state: item.id === "milestone_1" ? "ready" : item.state,
      })),
    });
    staleAbort.abort(new DOMException("Stale run replaced", "AbortError"));
    const replacementRun = controller.resume("goal_1");

    const [staleResult, replacementResult] = await Promise.race([
      Promise.all([staleRun, replacementRun]),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("terminal publication deadlocked")), 500),
      ),
    ]);

    const finalCanonical = await store.get("goal_1");
    expect(staleResult.status).toBe("executing");
    expect(replacementResult.status).toBe("stopped_blocked");
    expect(finalCanonical?.status).toBe("stopped_blocked");
    expect(trajectoryEvents.at(-1)?.type).toBe("goal_stopped");
    expect(progressEvents.at(-1)?.event).toBe("stopped");
    expect(
      trajectoryEvents.filter((event) => event.type === "goal_stopped"),
    ).toHaveLength(1);
  });

  it("publishes exactly one stopped progress event when the controller catches an exception", async () => {
    const progressEvents: GoalProgressEvent[] = [];
    await store.save(createProtocolV2Goal([milestone("milestone_1")]));
    const controller = createController({
      runtime: {
        async runMilestone() {
          throw new Error("runtime exploded");
        },
      },
      acceptance: createAcceptanceResults({ milestones: [] }),
      onProgress(event) {
        progressEvents.push(event);
      },
    });

    const result = await controller.start("goal_1");

    expect(result.status).toBe("failed");
    expect(progressEvents.filter((event) => event.event === "stopped")).toHaveLength(1);
    expect(trajectoryEvents.filter((event) => event.type === "goal_stopped")).toHaveLength(1);
  });

  it.each([
    "milestone_started",
    "checkpoint_written",
    "goal_review_requested",
    "acceptance_certified",
  ] as const)(
    "cancels stale %s publication and keeps terminal ledger/trajectory/progress last",
    async (targetType) => {
      const abortController = new AbortController();
      const progressEvents: GoalProgressEvent[] = [];
      await store.save(
        createProtocolV2Goal([milestone("milestone_1")], {
          ...(targetType === "goal_review_requested"
            ? { reviewPolicy: "review_each_milestone" as const }
            : {}),
        }),
      );
      let intercepted = false;
      const controller = createController({
        runtime: createRuntime(),
        acceptance: createAcceptanceResults({
          milestones: [acceptedResult("check_done")],
          goals: [acceptedResult("check_done", { evidenceManifest: emptyManifest })],
        }),
        onProgress(event) {
          progressEvents.push(event);
        },
        async onTrajectoryAppend(event) {
          if (intercepted || event.type !== targetType) return;
          intercepted = true;
          if (targetType !== "acceptance_certified") {
            const canonical = await store.get("goal_1");
            await store.save({
              ...canonical!,
              status: "canceled",
              stopReason: "user_canceled",
            });
          }
          abortController.abort(new DOMException("Publication canceled", "AbortError"));
        },
      });

      const result = await controller.start("goal_1", {
        signal: abortController.signal,
      });
      const ledger = await store.readLedger("goal_1");

      expect(intercepted).toBe(true);
      expect(result.status).toBe(
        targetType === "acceptance_certified" ? "achieved" : "canceled",
      );
      expect(trajectoryEvents.some((event) => event.type === targetType)).toBe(false);
      expect(trajectoryEvents.at(-1)?.type).toBe("goal_stopped");
      expect(progressEvents.at(-1)?.event).toBe("stopped");
      expect(ledger.at(-1)?.kind).toBe("goal_stopped");
    },
  );

  it("suppresses rejected milestone progress when terminal state wins during its ledger append", async () => {
    const progressEvents: GoalProgressEvent[] = [];
    await store.save(createProtocolV2Goal([milestone("milestone_1")]));
    let injected = false;
    const racingStore: AgentGoalStore = {
      ...store,
      async appendLedger(goalId, event) {
        if (!injected && event.kind === "milestone_rejected") {
          injected = true;
          const canonical = await store.get(goalId);
          await store.save({
            ...canonical!,
            status: "canceled",
            stopReason: "user_canceled",
          });
        }
        return store.appendLedger(goalId, event);
      },
    };
    const controller = createController({
      goalStore: racingStore,
      runtime: createRuntime(),
      acceptance: createAcceptanceResults({
        milestones: [rejectedResult("assertion_mismatch")],
      }),
      onProgress(event) {
        progressEvents.push(event);
      },
    });

    const result = await controller.start("goal_1");
    const ledger = await store.readLedger("goal_1");

    expect(result.status).toBe("canceled");
    expect(progressEvents.some((event) => event.event === "milestone_rejected")).toBe(false);
    expect(progressEvents.at(-1)?.event).toBe("stopped");
    expect(ledger.map((event) => event.kind).slice(-2)).toEqual([
      "milestone_rejected",
      "goal_stopped",
    ]);
  });

  it.each(["milestone", "final"] as const)(
    "propagates controller abort to a cloned %s acceptance context and emits no late acceptance events",
    async (phase) => {
      const abortController = new AbortController();
      const sharedContext = { marker: "caller-owned" } as unknown as AcceptanceContext;
      let receivedContext: AcceptanceContext | undefined;
      let acceptanceEnteredResolve: (() => void) | undefined;
      const acceptanceEntered = new Promise<void>((resolve) => {
        acceptanceEnteredResolve = resolve;
      });
      const awaitAbort = async (context: AcceptanceContext): Promise<AcceptanceResult> => {
        receivedContext = context;
        acceptanceEnteredResolve?.();
        return new Promise<AcceptanceResult>((_resolve, reject) => {
          if (!context.signal) {
            reject(new Error("controller acceptance context is missing its signal"));
            return;
          }
          context.signal.addEventListener(
            "abort",
            () => reject(context.signal?.reason ?? new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      };
      await store.save(
        phase === "milestone"
          ? createProtocolV2Goal([milestone("milestone_1")])
          : createProtocolV2Goal(
              [
                {
                  ...milestone("milestone_1"),
                  state: "accepted",
                  attempts: 1,
                  runIds: ["run_done"],
                },
              ],
              { status: "executing" },
            ),
      );
      const controller = createController({
        runtime: createRuntime(),
        acceptance: {
          async evaluate(_milestone, context) {
            return phase === "milestone"
              ? awaitAbort(context)
              : acceptedResult("check_done");
          },
          async evaluateGoal(_goal, context) {
            return phase === "final"
              ? awaitAbort(context)
              : acceptedResult("check_done", { evidenceManifest: emptyManifest });
          },
        },
        createAcceptanceContext() {
          return sharedContext;
        },
      });

      const running = controller.resume("goal_1", { signal: abortController.signal });
      await acceptanceEntered;
      const contextWasCloned = receivedContext !== sharedContext;
      const receivedSignal = receivedContext?.signal;
      const callerSignal = sharedContext.signal;
      abortController.abort(new DOMException("Canceled", "AbortError"));
      const result = await running;

      expect(contextWasCloned).toBe(true);
      expect(receivedSignal).toBe(abortController.signal);
      expect(callerSignal).toBeUndefined();
      expect(result.status).toBe("executing");
      expect(
        trajectoryEvents.filter((event) => event.type.startsWith("acceptance_")),
      ).toEqual([]);
    },
  );

  it("keeps replacement action signatures when the stale owner exits first", async () => {
    await store.save(
      createProtocolV2Goal([milestone("milestone_1")], { status: "executing" }),
    );
    const staleAbort = new AbortController();
    const replacementSignature = createToolActionSignature("test_run", {
      path: "replacement-suite",
    });
    let runtimeCalls = 0;
    let acceptanceCalls = 0;
    let staleAcceptanceEnteredResolve: (() => void) | undefined;
    const staleAcceptanceEntered = new Promise<void>((resolve) => {
      staleAcceptanceEnteredResolve = resolve;
    });
    let resolveStaleAcceptance: ((result: AcceptanceResult) => void) | undefined;
    const staleAcceptance = new Promise<AcceptanceResult>((resolve) => {
      resolveStaleAcceptance = resolve;
    });
    let finalAcceptanceEnteredResolve: (() => void) | undefined;
    const finalAcceptanceEntered = new Promise<void>((resolve) => {
      finalAcceptanceEnteredResolve = resolve;
    });
    let resolveFinalAcceptance: ((result: AcceptanceResult) => void) | undefined;
    const finalAcceptance = new Promise<AcceptanceResult>((resolve) => {
      resolveFinalAcceptance = resolve;
    });
    const controller = createController({
      runtime: {
        async runMilestone(_goal, currentMilestone) {
          runtimeCalls += 1;
          return {
            runId: `run_${currentMilestone.id}_${runtimeCalls}`,
            toolCallCount: 1,
            status: "succeeded",
            actionSignatures:
              runtimeCalls === 2 ? [replacementSignature] : [],
          };
        },
      },
      acceptance: {
        async evaluate() {
          acceptanceCalls += 1;
          if (acceptanceCalls === 1) {
            staleAcceptanceEnteredResolve?.();
            return staleAcceptance;
          }
          return acceptedResult("check_done");
        },
        async evaluateGoal() {
          finalAcceptanceEnteredResolve?.();
          return finalAcceptance;
        },
      },
    });

    const staleRun = controller.resume("goal_1", { signal: staleAbort.signal });
    await staleAcceptanceEntered;
    const inFlight = await store.get("goal_1");
    await store.save({
      ...inFlight!,
      milestones: inFlight!.milestones.map((item) => ({
        ...item,
        state: item.id === "milestone_1" ? "ready" : item.state,
      })),
    });
    staleAbort.abort();
    const replacementRun = controller.resume("goal_1");
    await finalAcceptanceEntered;

    resolveStaleAcceptance?.(acceptedResult("check_done"));
    await staleRun;
    resolveFinalAcceptance?.(
      rejectedResult("external_missing", {
        verdict: "blocked_external",
        failureClass: "external_dependency_missing",
      }),
    );
    const replacementResult = await replacementRun;

    expect(replacementResult.status).toBe("stopped_blocked");
    expect(
      replacementResult.acceptanceState?.recentFailures.at(-1)?.actionSignatures,
    ).toEqual([replacementSignature]);
  });

  function createController(options: {
    runtime: GoalRuntimeEngine;
    acceptance: ReturnType<typeof createAcceptance>;
    goalStore?: AgentGoalStore;
    planner?: { replan(goal: Goal, reason: string): Promise<Milestone[]> };
    stallThreshold?: number;
    onProgress?: (event: GoalProgressEvent) => void;
    onActiveGoalChange?: (goalId: string, active: boolean) => void;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    onTrajectoryAppend?: (
      event: AgentTrajectoryEvent,
      options?: { signal?: AbortSignal },
    ) => Promise<void> | void;
    createAcceptanceContext?: (
      goal: Goal,
      milestone?: Milestone,
      runResult?: Awaited<ReturnType<GoalRuntimeEngine["runMilestone"]>>,
    ) => AcceptanceContext | Promise<AcceptanceContext>;
  }) {
    return createAgentGoalController({
      goalStore: options.goalStore ?? store,
      runtimeEngine: options.runtime,
      acceptance: options.acceptance,
      createAcceptanceContext: options.createAcceptanceContext,
      planner:
        options.planner ?? {
          async replan(goal) {
            goal.planVersion += 1;
            goal.budgetUsage.replans += 1;
            return goal.milestones;
          },
        },
      trajectoryStore: {
        async append(_runId, event, appendOptions) {
          await options.onTrajectoryAppend?.(event, appendOptions);
          if (appendOptions?.signal?.aborted) {
            throw appendOptions.signal.reason;
          }
          trajectoryEvents.push(event);
          return event;
        },
      },
      onProgress: options.onProgress,
      onActiveGoalChange: options.onActiveGoalChange,
      acceptanceRetry: {
        sleep: options.sleep,
        nowMs: () => Date.parse("2026-06-12T00:00:00.000Z"),
      },
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
    finalJudgeTimeoutMs?: number;
    onTrajectoryAppend?: (
      event: AgentTrajectoryEvent,
      options?: { signal?: AbortSignal },
    ) => Promise<void> | void;
  }) {
    const acceptance = createAgentGoalAcceptance({
      judgeProviderId: "test-provider",
      ...(options.finalJudgeTimeoutMs !== undefined
        ? { finalJudgeTimeoutMs: options.finalJudgeTimeoutMs }
        : {}),
    });
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
        async append(_runId, event, appendOptions) {
          await options.onTrajectoryAppend?.(event, appendOptions);
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

function expectLateHeadingInStructuralEvidence(
  prompt: string,
  reportPath: string,
  report: string,
): void {
  const quotedBlock = extractStructuralEvidenceBlock(prompt);
  const manifest = quotedBlock
    .split("\n")
    .map((line) => {
      if (!line.startsWith("| ")) {
        throw new Error("structural evidence line is not quoted data");
      }
      return line.slice(2);
    })
    .join("\n");
  expect(manifest).toContain(`| Artifact 1: artifact:${reportPath}`);
  expect(manifest).toContain(`|   Size bytes: ${Buffer.byteLength(report)}`);
  const heading = manifest.match(
    /^\|   Heading L(\d+) H1: Section 10 Final Conclusion$/m,
  );
  expect(heading).not.toBeNull();
  expect(Number(heading?.[1])).toBeGreaterThan(70_000);
}

function extractStructuralEvidenceBlock(prompt: string): string {
  const match = prompt.match(
    /BEGIN QUOTED STRUCTURAL EVIDENCE DATA\n([\s\S]*?)\nEND QUOTED STRUCTURAL EVIDENCE DATA/,
  );
  if (!match?.[1]) {
    throw new Error("cold-judge prompt is missing its structural evidence block");
  }
  return match[1];
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

function manifestWithHash(sha256: string): GoalEvidenceManifest {
  return {
    ...emptyManifest,
    artifacts: [
      {
        ref: "artifact:goalEvidence",
        mediaType: "text/markdown",
        sha256,
        excerpts: [],
      },
    ],
  };
}

function evidenceFingerprint(manifest: GoalEvidenceManifest): string {
  return createAcceptanceLogicalFailureFingerprint({
    target: { targetKind: "goal", targetId: "goal_1" },
    failedChecks: [],
    evidenceManifest: manifest,
    evidenceRefs: manifest.artifacts.map((artifact) => artifact.ref),
    protocolVersion: 2,
    validatorVersions: { acceptance: "goal-acceptance-v2" },
  });
}

function acceptedResult(
  checkId: string,
  overrides: {
    kind?: "assertion" | "model_review";
    detail?: string;
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
        detail: overrides.detail ?? "Accepted.",
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
    kind?: "assertion" | "model_review";
    detail?: string;
    verdict?: Exclude<AcceptanceResult["verdict"], "accepted">;
    failureClass?: NonNullable<AcceptanceResult["failureClass"]>;
    evidenceRefs?: string[];
    evidenceManifest?: GoalEvidenceManifest;
    retry?: AcceptanceResult["retry"];
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
        kind: overrides.kind ?? "assertion",
        passed: false,
        code,
        failureClass,
        evidenceRefs: overrides.evidenceRefs ?? [],
        detail: overrides.detail ?? "Free-form wording must not drive policy.",
      },
    ],
    ...(overrides.evidenceManifest
      ? { evidenceManifest: overrides.evidenceManifest }
      : {}),
    ...(overrides.retry ? { retry: overrides.retry } : {}),
  };
}

function timeoutResult(
  overrides: { evidenceManifest?: GoalEvidenceManifest } = {},
): AcceptanceResult {
  return rejectedResult("judge_timeout", {
    verdict: "acceptance_unavailable",
    failureClass: "judge_unavailable",
    ...(overrides.evidenceManifest
      ? { evidenceManifest: overrides.evidenceManifest }
      : {}),
    retry: {
      code: "judge_timeout",
      retryable: true,
      detail: "Final judge timed out.",
    },
  });
}

function createAcceptanceResults(options: {
  milestones: AcceptanceResult[];
  goals?: AcceptanceResult[];
}) {
  const milestones = [...options.milestones];
  const goals = [...(options.goals ?? [])];
  let goalCalls = 0;
  return {
    get goalCalls() {
      return goalCalls;
    },
    async evaluate() {
      return milestones.shift() ?? rejectedResult("missing_test_result");
    },
    async evaluateGoal() {
      goalCalls += 1;
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

function waitingForAcceptanceGoal(overrides: Partial<Goal> = {}): Goal {
  return createProtocolV2Goal(
    [
      {
        ...milestone("milestone_1"),
        state: "accepted",
        attempts: 1,
        runIds: ["run_done"],
      },
    ],
    {
      status: "waiting_for_acceptance",
      acceptanceState: {
        protocolVersion: 2,
        phase: "awaiting_user",
        attempt: 3,
        recentFailures: [],
      },
      acceptanceRetryState: {
        cycle: 1,
        attempt: 3,
        maxAttempts: 3,
        lastCode: "judge_timeout",
        lastDetail: "Final judge timed out.",
        evidenceFingerprint: evidenceFingerprint(emptyManifest),
        resumeFrom: "final_judge",
      },
      ...overrides,
    },
  );
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
