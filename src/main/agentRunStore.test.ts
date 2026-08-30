import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentRunStore } from "./agentRunStore";
import type { AgentRunRecord } from "../shared/agentRuns";
import { createInMemoryStorage } from "./storage/storageDb";
import { createRunRepository } from "./storage/repositories/runRepository";
import { runStartupRecoverySequence } from "./startupRecoverySequence";

describe("agent run store", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-runs-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("appends runs and lists newest first", async () => {
    const store = createAgentRunStore({ configDir });
    const first = createRun("run_1", "task_1", "2026-06-05T08:00:00.000Z");
    const second = createRun("run_2", "task_2", "2026-06-05T08:01:00.000Z");

    await store.append(first);
    await store.append(second);

    await expect(store.list({ limit: 10 })).resolves.toEqual([second, first]);
  });

  it("filters runs by task id", async () => {
    const store = createAgentRunStore({ configDir });
    const first = createRun("run_1", "task_1", "2026-06-05T08:00:00.000Z");
    const second = createRun("run_2", "task_2", "2026-06-05T08:01:00.000Z");

    await store.append(first);
    await store.append(second);

    await expect(store.list({ taskId: "task_1" })).resolves.toEqual([first]);
  });

  it("gets one run by id for retry flows", async () => {
    const store = createAgentRunStore({ configDir });
    const first = createRun("run_1", "task_1", "2026-06-05T08:00:00.000Z");
    const second = createRun("run_2", "task_2", "2026-06-05T08:01:00.000Z");

    await store.append(first);
    await store.append(second);

    await expect(store.get("run_1")).resolves.toEqual(first);
    await expect(store.get("missing")).resolves.toBeNull();
  });

  it("sanitizes every newly durable and public AgentRun field", async () => {
    const canary = "durable-agent-run-canary";
    const store = createAgentRunStore({ configDir });
    const rawRun = {
      ...createRun("run_secret", "task_secret", "2026-08-24T00:00:00.000Z"),
      taskName: `API_KEY+=${canary}`,
      skillName: `api%255fkey=${canary}`,
      summary: `client_secret=${canary}`,
      events: [{
        level: "info" as const,
        message: `password=${canary}`,
        createdAt: "2026-08-24T00:00:00.000Z",
      }],
      modelServiceNotice: {
        kind: "output_limit" as const,
        message: `api_key=${canary}`,
      },
    };

    const appended = await store.append(rawRun);
    const listed = await store.list();
    const persisted = await readFile(
      path.join(configDir, "agent-runs.jsonl"),
      "utf8",
    );
    const serialized = JSON.stringify({ appended, listed, persisted });
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain(canary);
  });

  it("skips malformed JSONL lines while preserving valid run records", async () => {
    const first = createRun("run_1", "task_1", "2026-06-05T08:00:00.000Z");
    const second = createRun("run_2", "task_2", "2026-06-05T08:01:00.000Z");
    await writeFile(
      path.join(configDir, "agent-runs.jsonl"),
      `${JSON.stringify(first)}\n{"id": "partial"\n${JSON.stringify(second)}\n`,
      "utf8",
    );

    const store = createAgentRunStore({ configDir });

    await expect(store.list({ limit: 10 })).resolves.toEqual([second, first]);
    await expect(store.get("run_1")).resolves.toEqual(first);
    const files = await readdir(configDir);
    expect(files.some((file) => file.startsWith("agent-runs.jsonl.corrupt-lines-"))).toBe(true);
  });

  it.each(["json", "sqlite"] as const)(
    "fences %s owners by execution revision and permits only paused + 1",
    async (backend) => {
      const storage = backend === "sqlite"
        ? await createInMemoryStorage()
        : undefined;
      const store = createAgentRunStore({ configDir, backend, storage });
      const paused = {
        ...createRun("run_fenced", "task_1", "2026-06-05T08:00:00.000Z"),
        status: "paused" as const,
      };

      await expect(store.append(paused)).resolves.toEqual(paused);
      await expect(store.append(structuredClone(paused))).resolves.toEqual(paused);
      await expect(store.append({ ...paused, summary: "different" }))
        .rejects.toThrow("任务运行失败，已保留可审计的终态记录。");
      await expect(store.append({
        ...paused,
        executionRevision: 2,
        status: "succeeded",
        taskName: "different execution envelope",
      })).rejects.toThrow("任务运行失败，已保留可审计的终态记录。");

      const resumed = {
        ...paused,
        executionRevision: 2,
        status: "succeeded" as const,
        summary: "resumed",
      };
      await expect(store.append(resumed)).resolves.toEqual(resumed);
      await expect(store.append(paused))
        .rejects.toThrow("任务运行失败，已保留可审计的终态记录。");
      await expect(store.append({
        ...resumed,
        executionRevision: 3,
        summary: "illegal terminal upgrade",
      })).rejects.toThrow("任务运行失败，已保留可审计的终态记录。");
      await expect(store.get("run_fenced")).resolves.toEqual(resumed);
      await expect(store.list()).resolves.toEqual([resumed]);
      storage?.close();
    },
  );

  it.each(["json", "sqlite"] as const)(
    "allows exactly one concurrent %s resume owner across store instances",
    async (backend) => {
      const storage = backend === "sqlite"
        ? await createInMemoryStorage()
        : undefined;
      const firstStore = createAgentRunStore({ configDir, backend, storage });
      const secondStore = createAgentRunStore({ configDir, backend, storage });
      const paused = {
        ...createRun("run_double_resume", "task_1", "2026-06-05T08:00:00.000Z"),
        status: "paused" as const,
      };
      await firstStore.append(paused);

      const outcomes = await Promise.allSettled([
        firstStore.append({
          ...paused,
          executionRevision: 2,
          status: "succeeded",
          summary: "winner-a",
        }),
        secondStore.append({
          ...paused,
          executionRevision: 2,
          status: "failed",
          summary: "winner-b",
        }),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === "fulfilled"))
        .toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === "rejected"))
        .toHaveLength(1);
      expect((await firstStore.get("run_double_resume"))?.executionRevision)
        .toBe(2);
      storage?.close();
    },
  );

  it("converges missing and strictly stale dual shadows before list returns", async () => {
    const storage = await createInMemoryStorage();
    const repository = createRunRepository(storage);
    const staleAuthority = {
      ...createRun("run_stale", "task_1", "2026-08-24T00:00:00.000Z"),
      executionRevision: 2,
      summary: "authority revision two",
    };
    repository.importSnapshot(staleAuthority);
    const missingAuthority = createRun(
      "run_missing_shadow",
      "task_2",
      "2026-08-24T00:01:00.000Z",
    );
    repository.create(missingAuthority);
    await writeFile(
      path.join(configDir, "agent-runs.jsonl"),
      `${JSON.stringify({
        ...staleAuthority,
        executionRevision: 1,
        summary: "stale revision one",
      })}\n`,
      "utf8",
    );

    const store = createAgentRunStore({ configDir, backend: "dual", storage });
    await expect(store.list({ limit: 10 })).resolves.toEqual([
      missingAuthority,
      staleAuthority,
    ]);
    const durableLines = (await readFile(
      path.join(configDir, "agent-runs.jsonl"),
      "utf8",
    )).trim().split("\n").map((line) => JSON.parse(line));
    expect(durableLines.filter((run) => run.id === staleAuthority.id).at(-1))
      .toEqual(staleAuthority);
    expect(durableLines.find((run) => run.id === missingAuthority.id))
      .toEqual(missingAuthority);
    storage.close();
  });

  it.each([
    ["higher", 2, "higher shadow"],
    ["divergent", 1, "divergent same revision"],
  ] as const)(
    "fails a fresh startup on a %s JSON shadow before later recovery stages",
    async (_caseName, shadowRevision, shadowSummary) => {
      const storage = await createInMemoryStorage();
      const authority = createRun(
        "run_conflicting_shadow",
        "task_conflicting_shadow",
        "2026-08-24T00:00:00.000Z",
      );
      createRunRepository(storage).create(authority);
      await writeFile(
        path.join(configDir, "agent-runs.jsonl"),
        `${JSON.stringify({
          ...authority,
          executionRevision: shadowRevision,
          summary: shadowSummary,
        })}\n`,
        "utf8",
      );
      const store = createAgentRunStore({
        configDir,
        backend: "dual",
        storage,
      });
      const laterRecoveryStage = vi.fn(async () => undefined);

      await expect(runStartupRecoverySequence({
        initializeStorageConvergence: () => store.list({
          limit: Number.MAX_SAFE_INTEGER,
        }),
        reconcileRequiredConversationSettlements: laterRecoveryStage,
        reconcileAgentRunAdmissions: laterRecoveryStage,
        interruptPriorProcessApprovals: laterRecoveryStage,
        interruptActiveCausalAttempts: laterRecoveryStage,
      })).rejects.toThrow("任务运行失败，已保留可审计的终态记录。");
      expect(laterRecoveryStage).not.toHaveBeenCalled();
      storage.close();
    },
  );
});

function createRun(
  id: string,
  taskId: string,
  timestamp: string,
): AgentRunRecord {
  return {
    id,
    taskId,
    taskName: "Task",
    skillName: "local-file-organizer",
    status: "succeeded",
    executionRevision: 1,
    summary: "Done",
    events: [],
    startedAt: timestamp,
    finishedAt: timestamp,
  };
}
