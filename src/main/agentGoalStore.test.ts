import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Goal, GoalStatus, SuccessCriterion } from "../shared/agentGoal";
import {
  createAgentGoalStore,
  type ProgressLedgerEvent,
} from "./agentGoalStore";

describe("agent goal store", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-goals-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("saves a goal under agent-goals by goal id", async () => {
    const store = createAgentGoalStore({ configDir });
    const goal = createGoal("goal_1", "planning");

    await expect(store.save(goal)).resolves.toEqual(goal);

    const raw = await readFile(
      path.join(configDir, "agent-goals", "goal_1.json"),
      "utf8",
    );
    expect(JSON.parse(raw)).toEqual(goal);
    await expect(store.get("goal_1")).resolves.toEqual(goal);
  });

  it("updates an existing goal for status, milestones, and budget usage", async () => {
    const store = createAgentGoalStore({ configDir });
    const planning = createGoal("goal_1", "planning");
    const executing: Goal = {
      ...planning,
      status: "executing",
      milestones: [
        {
          ...planning.milestones[0],
          state: "running",
          runIds: ["run_1"],
          attempts: 1,
        },
      ],
      budgetUsage: {
        ...planning.budgetUsage,
        iterations: 1,
        toolCalls: 3,
      },
      updatedAt: "2026-06-12T00:01:00.000Z",
    };

    await store.save(planning);
    await store.save(executing);

    await expect(store.get("goal_1")).resolves.toEqual(executing);
  });

  it("lists active goals and excludes terminal statuses", async () => {
    const store = createAgentGoalStore({ configDir });
    const planning = createGoal("goal_planning", "planning", "2026-06-12T00:00:00.000Z");
    const executing = createGoal("goal_executing", "executing", "2026-06-12T00:01:00.000Z");
    const waiting = createGoal(
      "goal_waiting",
      "waiting_for_review",
      "2026-06-12T00:02:00.000Z",
    );
    const achieved = createGoal("goal_achieved", "achieved");
    const stoppedBudget = createGoal("goal_stopped_budget", "stopped_budget");
    const stoppedStalled = createGoal("goal_stopped_stalled", "stopped_stalled");
    const failed = createGoal("goal_failed", "failed");
    const canceled = createGoal("goal_canceled", "canceled");

    await Promise.all([
      store.save(planning),
      store.save(executing),
      store.save(waiting),
      store.save(achieved),
      store.save(stoppedBudget),
      store.save(stoppedStalled),
      store.save(failed),
      store.save(canceled),
    ]);

    await expect(store.listActive()).resolves.toEqual([
      waiting,
      executing,
      planning,
    ]);
  });

  it("appends and reads progress ledger events in order", async () => {
    const store = createAgentGoalStore({ configDir });
    const planned: ProgressLedgerEvent = {
      at: "2026-06-12T00:00:00.000Z",
      kind: "goal_planned",
      summary: "Goal planned with one milestone.",
      evidenceRefs: ["trajectory_1"],
    };
    const started: ProgressLedgerEvent = {
      at: "2026-06-12T00:01:00.000Z",
      kind: "milestone_started",
      milestoneId: "milestone_1",
      summary: "Started milestone.",
    };

    await store.appendLedger("goal_1", planned);
    await store.appendLedger("goal_1", started);

    const raw = await readFile(
      path.join(configDir, "agent-goals", "goal_1.ledger.jsonl"),
      "utf8",
    );
    expect(raw.trim().split("\n")).toHaveLength(2);
    await expect(store.readLedger("goal_1")).resolves.toEqual([planned, started]);
  });

  it("returns empty active and ledger results when the goal directory is missing", async () => {
    const store = createAgentGoalStore({ configDir });

    await expect(store.get("missing")).resolves.toBeNull();
    await expect(store.listActive()).resolves.toEqual([]);
    await expect(store.readLedger("missing")).resolves.toEqual([]);
  });

  it("reloads in-progress goals after restart without losing state", async () => {
    const firstStore = createAgentGoalStore({ configDir });
    const running = createGoal("goal_restart", "executing", "2026-06-12T00:03:00.000Z");
    running.milestones[0].state = "running";
    running.milestones[0].runIds = ["run_restart"];
    running.milestones[0].attempts = 1;
    running.budgetUsage.iterations = 2;
    running.budgetUsage.toolCalls = 7;

    await firstStore.save(running);

    const reloadedStore = createAgentGoalStore({ configDir });

    await expect(reloadedStore.get("goal_restart")).resolves.toEqual(running);
    await expect(reloadedStore.listActive()).resolves.toEqual([running]);
  });

  it("deletes a goal state file without deleting its ledger", async () => {
    const store = createAgentGoalStore({ configDir });
    await store.save(createGoal("goal_delete", "executing"));
    await store.appendLedger("goal_delete", {
      at: "2026-06-12T00:00:00.000Z",
      kind: "goal_stopped",
      summary: "Stopped.",
    });

    await expect(store.delete("missing")).resolves.toBe(false);
    await expect(store.delete("goal_delete")).resolves.toBe(true);
    await expect(store.get("goal_delete")).resolves.toBeNull();
    await expect(store.readLedger("goal_delete")).resolves.toHaveLength(1);
    await expect(
      access(path.join(configDir, "agent-goals", "goal_delete.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

const criterion: SuccessCriterion = {
  id: "criterion_done",
  description: "Goal is accepted.",
  acceptanceChecks: [
    {
      id: "check_file",
      kind: "file_exists",
      description: "Expected file exists.",
      params: { path: "artifact.md" },
      requiresEvidence: false,
    },
  ],
};

function createGoal(
  id: string,
  status: GoalStatus,
  updatedAt = `2026-06-12T00:00:${status.length.toString().padStart(2, "0")}.000Z`,
): Goal {
  return {
    id,
    description: "Complete a bounded local goal.",
    successCriteria: [criterion],
    milestones: [
      {
        id: "milestone_1",
        description: "Create the artifact.",
        dependsOn: [],
        successCriteria: [criterion],
        state: status === "planning" ? "pending" : "ready",
        runIds: [],
        attempts: 0,
      },
    ],
    status,
    budget: {
      maxIterations: 8,
      maxToolCalls: 24,
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
    reviewPolicy: "review_final_only",
    planVersion: 1,
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt,
  };
}
