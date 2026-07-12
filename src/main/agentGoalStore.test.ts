import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Goal, GoalStatus, SuccessCriterion } from "../shared/agentGoal";
import {
  createAgentGoalStore,
  type ProgressLedgerEvent,
} from "./agentGoalStore";
import { createGoalAcceptanceCertificate } from "./agentGoalAcceptanceCertificate";

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

  it("serializes concurrent goal saves through atomic JSON replacement", async () => {
    const store = createAgentGoalStore({ configDir });
    const goalsDir = path.join(configDir, "agent-goals");
    const updates = Array.from({ length: 5 }, (_, index) => ({
      ...createGoal("goal_concurrent", "executing"),
      updatedAt: `2026-06-12T00:0${index}:00.000Z`,
      budgetUsage: {
        iterations: index,
        toolCalls: index,
        wallClockMs: 0,
        tokens: 0,
        replans: 0,
      },
    }));

    await Promise.all(updates.map((goal) => store.save(goal)));

    const loaded = await store.get("goal_concurrent");
    expect(loaded?.id).toBe("goal_concurrent");
    const files = await readdir(goalsDir);
    expect(files.some((file) => file.endsWith(".tmp"))).toBe(false);
    const raw = await readFile(
      path.join(goalsDir, "goal_concurrent.json"),
      "utf8",
    );
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it.each(["missing", "invalid"] as const)(
    "does not let a v2 achieved goal with a %s certificate replace executing state",
    async (certificateState) => {
      const store = createAgentGoalStore({ configDir });
      const executing = createProtocolV2Goal("goal_guarded", "executing");
      const achieved = createCertifiedGoal(executing);
      if (certificateState === "missing") {
        achieved.acceptanceCertificate = undefined;
      } else {
        achieved.acceptanceCertificate!.evidence[0]!.sha256 = "0".repeat(64);
      }

      await store.save(executing);

      await expect(store.save(achieved)).resolves.toEqual(executing);
      await expect(store.get(executing.id)).resolves.toEqual(executing);
    },
  );

  it.each([
    ["stop reason", (goal: Goal) => {
      goal.stopReason = "progress_stalled";
    }],
    ["acceptance phase", (goal: Goal) => {
      goal.acceptanceState!.phase = "judging";
    }],
  ] as const)(
    "rejects a v2 achieved goal with an incoherent %s",
    async (_field, mutate) => {
      const store = createAgentGoalStore({ configDir });
      const executing = createProtocolV2Goal("goal_incoherent", "executing");
      const achieved = createCertifiedGoal(executing);
      mutate(achieved);

      await store.save(executing);

      await expect(store.save(achieved)).resolves.toEqual(executing);
      await expect(store.get(executing.id)).resolves.toEqual(executing);
    },
  );

  it("rejects a new invalid v2 achievement instead of persisting it", async () => {
    const store = createAgentGoalStore({ configDir });
    const invalid = createProtocolV2Goal("goal_invalid_new", "achieved");
    invalid.stopReason = "goal_accepted";
    invalid.acceptanceState!.phase = "certified";

    await expect(store.save(invalid)).rejects.toThrow(/certificate/i);
    await expect(store.get(invalid.id)).resolves.toBeNull();
  });

  it("atomically reloads a valid v2 achievement with its certificate", async () => {
    const firstStore = createAgentGoalStore({ configDir });
    const executing = createProtocolV2Goal("goal_atomic_certificate", "executing");
    const achieved = createCertifiedGoal(executing);

    await firstStore.save(executing);
    await expect(firstStore.save(achieved)).resolves.toEqual(achieved);

    const reloadedStore = createAgentGoalStore({ configDir });
    await expect(reloadedStore.get(achieved.id)).resolves.toEqual(achieved);
    const raw = JSON.parse(
      await readFile(
        path.join(configDir, "agent-goals", `${achieved.id}.json`),
        "utf8",
      ),
    ) as Goal;
    expect(raw).toMatchObject({
      status: "achieved",
      stopReason: "goal_accepted",
      acceptanceState: { phase: "certified" },
      acceptanceCertificate: {
        certificateHash: achieved.acceptanceCertificate!.certificateHash,
      },
    });
  });

  it("fails closed on an invalid v2 achievement without rewriting its raw file", async () => {
    const store = createAgentGoalStore({ configDir });
    const goalsDir = path.join(configDir, "agent-goals");
    const filePath = path.join(goalsDir, "goal_tampered_read.json");
    const tampered = createCertifiedGoal(
      createProtocolV2Goal("goal_tampered_read", "executing"),
    );
    tampered.acceptanceCertificate!.evidence[0]!.sha256 = "0".repeat(64);
    const raw = `${JSON.stringify(tampered, null, 3)}\n`;
    await mkdir(goalsDir, { recursive: true });
    await writeFile(filePath, raw, "utf8");
    const before = await stat(filePath);

    const loaded = await store.get(tampered.id);

    expect(loaded).toMatchObject({
      id: tampered.id,
      status: "stopped_blocked",
      stopReason: "acceptance_integrity_failed",
      acceptanceProtocolVersion: 2,
      acceptanceState: {
        protocolVersion: 2,
        phase: "blocked",
      },
    });
    expect(loaded).not.toHaveProperty("acceptanceCertificate");
    await expect(store.listActive()).resolves.not.toContainEqual(
      expect.objectContaining({ id: tampered.id }),
    );
    await expect(
      store.save({
        ...loaded!,
        status: "executing",
        stopReason: undefined,
      }),
    ).resolves.toMatchObject({
      status: "stopped_blocked",
      stopReason: "acceptance_integrity_failed",
    });
    expect(await readFile(filePath, "utf8")).toBe(raw);
    expect((await stat(filePath)).mtimeMs).toBe(before.mtimeMs);
  });

  it("keeps legacy achieved JSON without a protocol marker readable and save-compatible", async () => {
    const store = createAgentGoalStore({ configDir });
    const legacy = createGoal("goal_legacy_achieved", "achieved");
    legacy.stopReason = "goal_accepted";

    await expect(store.save(legacy)).resolves.toEqual(legacy);
    await expect(store.get(legacy.id)).resolves.toEqual(legacy);

    const updatedLegacy = {
      ...legacy,
      updatedAt: "2026-06-12T00:05:00.000Z",
    };
    await expect(store.save(updatedLegacy)).resolves.toEqual(updatedLegacy);
    await expect(store.get(legacy.id)).resolves.toEqual(updatedLegacy);
  });

  it("reads and lists serialized legacy goals without rewriting or fabricating acceptance state", async () => {
    const store = createAgentGoalStore({ configDir });
    const goalsDir = path.join(configDir, "agent-goals");
    const filePath = path.join(goalsDir, "goal_legacy_read.json");
    const legacy = {
      ...createGoal("goal_legacy_read", "executing"),
      chatSessionId: "chat_legacy_read",
    };
    const raw = `${JSON.stringify(legacy, null, 4)}\n`;
    await mkdir(goalsDir, { recursive: true });
    await writeFile(filePath, raw, "utf8");
    const before = await stat(filePath);

    await expect(store.get(legacy.id)).resolves.toEqual(legacy);
    await expect(store.listActive()).resolves.toEqual([legacy]);
    await expect(store.listByChatSession("chat_legacy_read")).resolves.toEqual([
      legacy,
    ]);

    expect(await readFile(filePath, "utf8")).toBe(raw);
    expect((await stat(filePath)).mtimeMs).toBe(before.mtimeMs);
    expect(await store.get(legacy.id)).not.toHaveProperty(
      "acceptanceProtocolVersion",
    );
    expect(await store.get(legacy.id)).not.toHaveProperty("acceptanceState");
  });

  it("preserves canonical v2 acceptance state when a stale legacy save arrives", async () => {
    const store = createAgentGoalStore({ configDir });
    const protocolV2 = createProtocolV2Goal("goal_upgrade_monotonic", "executing");
    protocolV2.acceptanceState = {
      protocolVersion: 2,
      phase: "repairing",
      attempt: 2,
      recentFailures: [createFailureRecord()],
      lastDecision: createRepairDirective(),
    };
    const staleLegacy = {
      ...createGoal(protocolV2.id, "executing"),
      planVersion: 2,
      updatedAt: "2026-07-11T03:00:00.000Z",
    };

    await store.save(protocolV2);
    const persisted = await store.save(staleLegacy);

    expect(persisted).toMatchObject({
      planVersion: 2,
      acceptanceProtocolVersion: 2,
      acceptanceState: protocolV2.acceptanceState,
    });
    const shallowV2 = {
      ...createProtocolV2Goal(protocolV2.id, "executing"),
      planVersion: 3,
      updatedAt: "2026-07-11T03:01:00.000Z",
    };
    const merged = await store.save(shallowV2);
    expect(merged).toMatchObject({
      planVersion: 3,
      acceptanceProtocolVersion: 2,
      acceptanceState: {
        phase: "idle",
        attempt: 2,
        recentFailures: protocolV2.acceptanceState.recentFailures,
        lastDecision: protocolV2.acceptanceState.lastDecision,
      },
    });
    await expect(store.get(protocolV2.id)).resolves.toEqual(merged);
  });

  it("merges equal-length divergent acceptance histories without resetting occurrences", async () => {
    const store = createAgentGoalStore({ configDir });
    const canonical = createProtocolV2Goal("goal_equal_window", "executing");
    canonical.acceptanceState = {
      protocolVersion: 2,
      phase: "repairing",
      attempt: 3,
      recentFailures: [
        createFailureRecord({ occurrence: 2, at: "2026-07-11T03:02:00.000Z" }),
        createFailureRecord({ occurrence: 3, at: "2026-07-11T03:03:00.000Z" }),
      ],
      lastDecision: createRepairDirective({ occurrence: 3 }),
    };
    const stale = createProtocolV2Goal(canonical.id, "executing");
    stale.acceptanceState = {
      protocolVersion: 2,
      phase: "idle",
      attempt: 2,
      recentFailures: [
        createFailureRecord({ occurrence: 1, at: "2026-07-11T03:01:00.000Z" }),
        createFailureRecord({ occurrence: 2, at: "2026-07-11T03:02:00.000Z" }),
      ],
      lastDecision: createRepairDirective({ occurrence: 2 }),
    };

    await store.save(canonical);
    const merged = await store.save(stale);

    expect(merged.acceptanceState?.recentFailures.map((entry) => entry.occurrence)).toEqual([
      1,
      2,
      3,
    ]);
    expect(merged.acceptanceState?.attempt).toBe(3);
    expect(merged.acceptanceState?.lastDecision?.occurrence).toBe(3);
  });

  it("keeps the newest canonical 20-record acceptance window against a stale capped window", async () => {
    const store = createAgentGoalStore({ configDir });
    const canonical = createProtocolV2Goal("goal_capped_window", "executing");
    canonical.acceptanceState = {
      protocolVersion: 2,
      phase: "repairing",
      attempt: 40,
      recentFailures: Array.from({ length: 20 }, (_, index) =>
        createFailureRecord({
          occurrence: index + 21,
          at: `2026-07-11T04:${String(index + 20).padStart(2, "0")}:00.000Z`,
        }),
      ),
      lastDecision: createRepairDirective({ occurrence: 40 }),
    };
    const stale = createProtocolV2Goal(canonical.id, "executing");
    stale.acceptanceState = {
      protocolVersion: 2,
      phase: "idle",
      attempt: 20,
      recentFailures: Array.from({ length: 20 }, (_, index) =>
        createFailureRecord({
          occurrence: index + 1,
          at: `2026-07-11T03:${String(index).padStart(2, "0")}:00.000Z`,
        }),
      ),
      lastDecision: createRepairDirective({ occurrence: 20 }),
    };

    await store.save(canonical);
    const merged = await store.save(stale);

    expect(merged.acceptanceState?.recentFailures).toHaveLength(20);
    expect(merged.acceptanceState?.recentFailures.map((entry) => entry.occurrence)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 21),
    );
    expect(merged.acceptanceState?.attempt).toBe(40);
    expect(merged.acceptanceState?.lastDecision?.occurrence).toBe(40);
  });

  it("preserves a canonical certified achievement against stale and same-status saves", async () => {
    const store = createAgentGoalStore({ configDir });
    const executing = createProtocolV2Goal("goal_certificate_monotonic", "executing");
    const achieved = createCertifiedGoal(executing);
    const staleExecuting = {
      ...structuredClone(executing),
      updatedAt: "2026-07-11T02:00:00.000Z",
    };
    const certificateRemoved = {
      ...structuredClone(achieved),
      acceptanceCertificate: undefined,
      updatedAt: "2026-07-11T02:01:00.000Z",
    };
    const certificateTampered = structuredClone(achieved);
    certificateTampered.acceptanceCertificate!.judge!.model = "tampered";
    certificateTampered.updatedAt = "2026-07-11T02:02:00.000Z";

    await store.save(executing);
    await store.save(achieved);

    await expect(store.save(staleExecuting)).resolves.toEqual(achieved);
    await expect(store.save(certificateRemoved)).resolves.toEqual(achieved);
    await expect(store.save(certificateTampered)).resolves.toEqual(achieved);
    await expect(store.get(achieved.id)).resolves.toEqual(achieved);
  });

  it("deterministically arbitrates concurrent cancellation and certification by queue order", async () => {
    const store = createAgentGoalStore({ configDir });

    const cancelFirst = createProtocolV2Goal("goal_cancel_first", "executing");
    await store.save(cancelFirst);
    const canceled: Goal = {
      ...structuredClone(cancelFirst),
      status: "canceled",
      stopReason: "user_canceled",
    };
    const achievedAfterCancel = createCertifiedGoal(cancelFirst);
    const cancelResults = await Promise.all([
      store.save(canceled),
      store.save(achievedAfterCancel),
    ]);
    expect(cancelResults).toEqual([canceled, canceled]);
    await expect(store.get(cancelFirst.id)).resolves.toEqual(canceled);

    const achieveFirst = createProtocolV2Goal("goal_achieve_first", "executing");
    await store.save(achieveFirst);
    const achieved = createCertifiedGoal(achieveFirst);
    const canceledAfterAchieve: Goal = {
      ...structuredClone(achieveFirst),
      status: "canceled",
      stopReason: "user_canceled",
    };
    const achieveResults = await Promise.all([
      store.save(achieved),
      store.save(canceledAfterAchieve),
    ]);
    expect(achieveResults).toEqual([achieved, achieved]);
    await expect(store.get(achieveFirst.id)).resolves.toEqual(achieved);
  });

  it.each(["canceled", "achieved"] as const)(
    "does not let a stale executing save overwrite an irreversible %s goal",
    async (terminalStatus) => {
      const store = createAgentGoalStore({ configDir });
      const executing = createGoal("goal_terminal", "executing");
      const terminal: Goal = {
        ...executing,
        status: terminalStatus,
        stopReason:
          terminalStatus === "canceled" ? "user_canceled" : "goal_accepted",
        updatedAt: "2026-06-12T00:02:00.000Z",
      };
      const stale: Goal = {
        ...executing,
        planVersion: 9,
        updatedAt: "2026-06-12T00:03:00.000Z",
      };

      await store.save(executing);
      await store.save(terminal);
      await expect(store.save(stale)).resolves.toEqual(terminal);
      await expect(store.get("goal_terminal")).resolves.toEqual(terminal);
    },
  );

  it("keeps completed-unverified goals terminal and preserves the canonical attestation", async () => {
    const store = createAgentGoalStore({ configDir });
    const executing = createProtocolV2Goal("goal_manual_terminal", "executing");
    const completed: Goal = {
      ...executing,
      status: "completed_unverified",
      stopReason: "user_marked_complete",
      manualCompletionAttestation: {
        version: 1,
        goalId: executing.id,
        completedAt: "2026-07-11T05:00:00.000Z",
        reason: "user_marked_complete",
        failedCheckIds: ["check_file"],
        evidenceRefs: ["artifact:report"],
        evidenceFingerprint: "a".repeat(64),
        lastFailureCode: "judge_timeout",
        retryCycles: 2,
      },
      updatedAt: "2026-07-11T05:00:00.000Z",
    };

    await store.save(executing);
    await store.save(completed);

    await expect(store.listActive()).resolves.toEqual([]);
    await expect(
      store.save({
        ...executing,
        status: "executing",
        updatedAt: "2026-07-11T05:01:00.000Z",
      }),
    ).resolves.toEqual(completed);
    await expect(
      store.save({
        ...completed,
        manualCompletionAttestation: undefined,
        acceptanceCertificate: {
          forged: true,
        } as unknown as Goal["acceptanceCertificate"],
        updatedAt: "2026-07-11T05:02:00.000Z",
      }),
    ).resolves.toEqual(completed);
  });

  it("conditionally completes only a canonical waiting goal and clears its stale certificate", async () => {
    const store = createAgentGoalStore({ configDir });
    const waiting = createProtocolV2Goal(
      "goal_manual_cas",
      "waiting_for_acceptance",
    );
    waiting.acceptanceCertificate = {
      forged: true,
    } as unknown as Goal["acceptanceCertificate"];
    const completed = createManualCompletedGoal(waiting);

    await store.save(waiting);

    await expect(
      store.saveIfStatus(completed, "waiting_for_acceptance"),
    ).resolves.toEqual({ saved: true, goal: completed });
    await expect(store.get(waiting.id)).resolves.toEqual(completed);
  });

  it.each(["executing", "canceled"] as const)(
    "loses the manual completion CAS when canonical %s wins",
    async (winnerStatus) => {
      const store = createAgentGoalStore({ configDir });
      const waiting = createProtocolV2Goal(
        `goal_manual_cas_${winnerStatus}`,
        "waiting_for_acceptance",
      );
      const winner: Goal = {
        ...waiting,
        status: winnerStatus,
        ...(winnerStatus === "canceled"
          ? { stopReason: "user_canceled" as const }
          : {}),
        updatedAt: "2026-07-11T05:01:00.000Z",
      };
      const completed = createManualCompletedGoal(waiting);

      await store.save(waiting);
      await store.save(winner);

      await expect(
        store.saveIfStatus(completed, "waiting_for_acceptance"),
      ).resolves.toEqual({ saved: false, goal: winner });
      await expect(store.get(waiting.id)).resolves.toEqual(winner);
    },
  );

  it("still allows a budget-stopped goal to resume after an explicit recovery action", async () => {
    const store = createAgentGoalStore({ configDir });
    const stopped = createGoal("goal_recoverable", "stopped_budget");
    const resumed: Goal = {
      ...stopped,
      status: "executing",
      stopReason: undefined,
      updatedAt: "2026-06-12T00:03:00.000Z",
    };

    await store.save(stopped);
    await expect(store.save(resumed)).resolves.toEqual(resumed);
    await expect(store.get("goal_recoverable")).resolves.toEqual(resumed);
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
    const stoppedBlocked = createGoal("goal_stopped_blocked", "stopped_blocked");
    stoppedBlocked.stopReason = "external_blocked";
    const failed = createGoal("goal_failed", "failed");
    const canceled = createGoal("goal_canceled", "canceled");

    await Promise.all([
      store.save(planning),
      store.save(executing),
      store.save(waiting),
      store.save(achieved),
      store.save(stoppedBudget),
      store.save(stoppedStalled),
      store.save(stoppedBlocked),
      store.save(failed),
      store.save(canceled),
    ]);

    await expect(store.listActive()).resolves.toEqual([
      waiting,
      executing,
      planning,
    ]);
  });

  it("lists waiting-for-acceptance goals as active and preserves retry state", async () => {
    const store = createAgentGoalStore({ configDir });
    const waiting = createProtocolV2Goal(
      "goal_waiting_acceptance",
      "waiting_for_acceptance",
    );
    waiting.milestones[0]!.state = "accepted";
    waiting.acceptanceState = {
      protocolVersion: 2,
      phase: "awaiting_user",
      attempt: 3,
      recentFailures: [],
    };
    waiting.acceptanceRetryState = {
      cycle: 1,
      attempt: 3,
      maxAttempts: 3,
      lastCode: "judge_timeout",
      lastDetail: "Final judge timed out.",
      evidenceFingerprint: "a".repeat(64),
      resumeFrom: "final_judge",
    };

    await store.save(waiting);

    await expect(store.listActive()).resolves.toEqual([
      expect.objectContaining({
        id: waiting.id,
        status: "waiting_for_acceptance",
        acceptanceRetryState: expect.objectContaining({
          lastCode: "judge_timeout",
        }),
      }),
    ]);
  });

  it("keeps historical acceptance-unavailable JSON unchanged when optional recovery fields are absent", async () => {
    const store = createAgentGoalStore({ configDir });
    const goalsDir = path.join(configDir, "agent-goals");
    const legacy = createGoal("goal_legacy_acceptance", "stopped_blocked");
    legacy.stopReason = "acceptance_unavailable";
    const filePath = path.join(goalsDir, `${legacy.id}.json`);
    const raw = `${JSON.stringify(legacy, null, 4)}\n`;
    await mkdir(goalsDir, { recursive: true });
    await writeFile(filePath, raw, "utf8");

    await expect(store.get(legacy.id)).resolves.toEqual(legacy);
    await expect(store.listActive()).resolves.toEqual([]);
    expect(await readFile(filePath, "utf8")).toBe(raw);
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

  it("skips malformed JSONL lines while preserving valid progress ledger events", async () => {
    const store = createAgentGoalStore({ configDir });
    const goalsDir = path.join(configDir, "agent-goals");
    const planned: ProgressLedgerEvent = {
      at: "2026-06-12T00:00:00.000Z",
      kind: "goal_planned",
      summary: "Goal planned.",
    };
    const stopped: ProgressLedgerEvent = {
      at: "2026-06-12T00:01:00.000Z",
      kind: "goal_stopped",
      summary: "Goal stopped.",
    };
    await mkdir(goalsDir, { recursive: true });
    await writeFile(
      path.join(goalsDir, "goal_1.ledger.jsonl"),
      `${JSON.stringify(planned)}\n{"kind": "partial"\n${JSON.stringify(stopped)}\n`,
      "utf8",
    );

    await expect(store.readLedger("goal_1")).resolves.toEqual([planned, stopped]);
    const files = await readdir(goalsDir);
    expect(files.some((file) => file.startsWith("goal_1.ledger.jsonl.corrupt-lines-"))).toBe(true);
  });

  it("returns empty active and ledger results when the goal directory is missing", async () => {
    const store = createAgentGoalStore({ configDir });

    await expect(store.get("missing")).resolves.toBeNull();
    await expect(store.listActive()).resolves.toEqual([]);
    await expect(store.readLedger("missing")).resolves.toEqual([]);
  });

  it("quarantines corrupt goal JSON and skips it during recovery", async () => {
    const store = createAgentGoalStore({ configDir });
    const goalsDir = path.join(configDir, "agent-goals");
    await mkdir(goalsDir, { recursive: true });
    await writeFile(path.join(goalsDir, "goal_broken.json"), "", "utf8");

    await expect(store.get("goal_broken")).resolves.toBeNull();
    await expect(store.listActive()).resolves.toEqual([]);

    const files = await readdir(goalsDir);
    expect(
      files.some((file) => file.startsWith("goal_broken.json.corrupt-")),
    ).toBe(true);
  });

  it("handles concurrent corrupt goal recovery without surfacing rename errors", async () => {
    const store = createAgentGoalStore({ configDir });
    const goalsDir = path.join(configDir, "agent-goals");
    await mkdir(goalsDir, { recursive: true });
    await writeFile(path.join(goalsDir, "goal_broken.json"), "", "utf8");

    await expect(
      Promise.all([
        store.get("goal_broken"),
        store.get("goal_broken"),
        store.get("goal_broken"),
      ]),
    ).resolves.toEqual([null, null, null]);
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

  it("lists goals attached to a chat session newest first", async () => {
    const store = createAgentGoalStore({ configDir });
    const older = createGoal(
      "goal_older",
      "achieved",
      "2026-06-12T00:01:00.000Z",
    );
    const newer = createGoal(
      "goal_newer",
      "executing",
      "2026-06-12T00:02:00.000Z",
    );
    const other = createGoal(
      "goal_other",
      "executing",
      "2026-06-12T00:03:00.000Z",
    );

    await store.save({
      ...older,
      chatSessionId: "chat_release",
      originMessageId: "message_goal_1",
    });
    await store.save({
      ...newer,
      chatSessionId: "chat_release",
      originMessageId: "message_goal_2",
    });
    await store.save({
      ...other,
      chatSessionId: "chat_other",
    });

    await expect(store.listByChatSession("chat_release")).resolves.toMatchObject([
      {
        id: "goal_newer",
        chatSessionId: "chat_release",
        originMessageId: "message_goal_2",
      },
      {
        id: "goal_older",
        chatSessionId: "chat_release",
        originMessageId: "message_goal_1",
      },
    ]);
  });

  it("loads old goal JSON without taskContract for active and chat session queries", async () => {
    const store = createAgentGoalStore({ configDir });
    const goalsDir = path.join(configDir, "agent-goals");
    const legacyGoal = {
      ...createGoal(
        "goal_legacy",
        "executing",
        "2026-06-12T00:04:00.000Z",
      ),
      chatSessionId: "chat_legacy",
      originMessageId: "message_legacy",
    };
    const { taskContract: _taskContract, ...legacyGoalJson } =
      legacyGoal as Goal & { taskContract?: unknown };
    await mkdir(goalsDir, { recursive: true });
    await writeFile(
      path.join(goalsDir, "goal_legacy.json"),
      `${JSON.stringify(legacyGoalJson, null, 2)}\n`,
      "utf8",
    );

    await expect(store.get("goal_legacy")).resolves.toEqual(legacyGoalJson);
    await expect(store.listActive()).resolves.toEqual([legacyGoalJson]);
    await expect(store.listByChatSession("chat_legacy")).resolves.toEqual([
      legacyGoalJson,
    ]);
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

function createProtocolV2Goal(id: string, status: GoalStatus): Goal {
  return {
    ...createGoal(id, status),
    acceptanceProtocolVersion: 2,
    acceptanceState: {
      protocolVersion: 2,
      phase: status === "achieved" ? "certified" : "idle",
      attempt: 0,
      recentFailures: [],
    },
  };
}

function createManualCompletedGoal(waiting: Goal): Goal {
  return {
    ...waiting,
    status: "completed_unverified",
    stopReason: "user_marked_complete",
    acceptanceCertificate: undefined,
    manualCompletionAttestation: {
      version: 1,
      goalId: waiting.id,
      completedAt: "2026-07-11T05:02:00.000Z",
      reason: "user_marked_complete",
      failedCheckIds: ["check_file"],
      evidenceRefs: ["artifact:report"],
      evidenceFingerprint: "a".repeat(64),
      lastFailureCode: "judge_timeout",
      retryCycles: 1,
    },
    updatedAt: "2026-07-11T05:02:00.000Z",
  };
}

function createFailureRecord(
  overrides: Partial<
    NonNullable<Goal["acceptanceState"]>["recentFailures"][number]
  > = {},
): NonNullable<Goal["acceptanceState"]>["recentFailures"][number] {
  return {
    at: "2026-07-11T02:00:00.000Z",
    targetKind: "goal",
    targetId: "goal_upgrade_monotonic",
    fingerprint: "f".repeat(64),
    occurrence: 2,
    verdict: "rejected_repairable",
    failureClass: "artifact_missing",
    failedCheckIds: ["check_file"],
    evidenceRefs: ["artifact:report"],
    actionSignatures: ["file_write:abc"],
    ...overrides,
  };
}

function createRepairDirective(
  overrides: Partial<
    NonNullable<NonNullable<Goal["acceptanceState"]>["lastDecision"]>
  > = {},
): NonNullable<NonNullable<Goal["acceptanceState"]>["lastDecision"]> {
  return {
    action: "retry_alternate_strategy",
    summary: "Try a different artifact strategy.",
    failedCheckIds: ["check_file"],
    fingerprint: "f".repeat(64),
    occurrence: 2,
    instructions: ["Create the missing artifact with different arguments."],
    ...overrides,
  };
}

function createCertifiedGoal(executing: Goal): Goal {
  const checkResults = executing.successCriteria.flatMap((successCriterion) =>
    successCriterion.acceptanceChecks.map((check) => ({
      checkId: check.id,
      kind: check.kind,
      passed: true,
      code: "accepted",
      evidenceRefs: ["artifact:goal"],
      detail: "Accepted by the focused store fixture.",
    })),
  );
  const acceptanceCertificate = createGoalAcceptanceCertificate({
    goal: executing,
    acceptedAt: "2026-07-11T01:00:00.000Z",
    runIds: ["run_certificate"],
    checkResults,
    evidenceManifest: {
      version: 1,
      generatedAt: "2026-07-11T00:59:00.000Z",
      artifacts: [
        {
          ref: "artifact:goal",
          path: "/workspace/artifact.md",
          mediaType: "text/markdown",
          sizeBytes: 12,
          sha256: "a".repeat(64),
          excerpts: [],
        },
      ],
      totalRenderedChars: 10,
      truncated: false,
    },
    provenanceRefs: {
      "artifact:goal": ["trajectory_certificate"],
    },
    judge: {
      model: "local-model",
      promptVersion: "goal-acceptance-v2",
      evaluatedMessageIds: ["message_certificate"],
    },
  });

  return {
    ...structuredClone(executing),
    status: "achieved",
    stopReason: "goal_accepted",
    acceptanceState: {
      protocolVersion: 2,
      phase: "certified",
      attempt: 1,
      recentFailures: [],
    },
    acceptanceCertificate,
    updatedAt: "2026-07-11T01:00:00.000Z",
  };
}
