import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentExecutionStore } from "./agentExecutionStore";
import type { AgentExecutionCheckpoint, AgentExecutionStatus } from "../shared/agentExecution";

describe("agent execution store", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-executions-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("saves a checkpoint under agent-executions by run id", async () => {
    const store = createAgentExecutionStore({ configDir });
    const checkpoint = createCheckpoint("run_1", "queued");

    await expect(store.save(checkpoint)).resolves.toEqual(checkpoint);

    const raw = await readFile(
      path.join(configDir, "agent-executions", "run_1.json"),
      "utf8",
    );
    expect(JSON.parse(raw)).toEqual(checkpoint);
    await expect(store.get("run_1")).resolves.toEqual(checkpoint);
  });

  it("updates an existing checkpoint for the same run", async () => {
    const store = createAgentExecutionStore({ configDir });
    const queued = createCheckpoint("run_1", "queued");
    const running = {
      ...queued,
      id: "checkpoint_running",
      status: "running" as const,
      toolCallCount: 1,
      updatedAt: "2026-06-07T00:01:00.000Z",
    };

    await store.save(queued);
    await store.save(running);

    await expect(store.get("run_1")).resolves.toEqual(running);
  });

  it("lists active checkpoints and excludes terminal statuses", async () => {
    const store = createAgentExecutionStore({ configDir });
    const queued = createCheckpoint("run_queued", "queued", "2026-06-07T00:00:00.000Z");
    const running = createCheckpoint("run_running", "running", "2026-06-07T00:01:00.000Z");
    const waiting = createCheckpoint(
      "run_waiting",
      "waiting_for_approval",
      "2026-06-07T00:02:00.000Z",
    );
    const paused = createCheckpoint("run_paused", "paused", "2026-06-07T00:03:00.000Z");
    const succeeded = createCheckpoint("run_succeeded", "succeeded");
    const failed = createCheckpoint("run_failed", "failed");
    const canceled = createCheckpoint("run_canceled", "canceled");

    await Promise.all([
      store.save(queued),
      store.save(running),
      store.save(waiting),
      store.save(paused),
      store.save(succeeded),
      store.save(failed),
      store.save(canceled),
    ]);

    await expect(store.listActive()).resolves.toEqual([
      paused,
      waiting,
      running,
      queued,
    ]);
  });

  it("deletes a checkpoint after final archival", async () => {
    const store = createAgentExecutionStore({ configDir });
    await store.save(createCheckpoint("run_delete", "running"));

    await expect(store.delete("missing")).resolves.toBe(false);
    await expect(store.delete("run_delete")).resolves.toBe(true);
    await expect(store.get("run_delete")).resolves.toBeNull();
    await expect(
      access(path.join(configDir, "agent-executions", "run_delete.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns empty results when the checkpoint directory is missing", async () => {
    const store = createAgentExecutionStore({ configDir });

    await expect(store.get("missing")).resolves.toBeNull();
    await expect(store.listActive()).resolves.toEqual([]);
  });

  it("serializes concurrent writes for the same run without leaving temp files", async () => {
    const store = createAgentExecutionStore({ configDir });
    const queued = createCheckpoint("run_serial", "queued");
    const running = {
      ...queued,
      id: "checkpoint_running",
      status: "running" as const,
      updatedAt: "2026-06-07T00:01:00.000Z",
    };

    await Promise.all([store.save(queued), store.save(running)]);

    await expect(store.get("run_serial")).resolves.toEqual(running);
    const files = await readdir(path.join(configDir, "agent-executions"));
    expect(files).toEqual(["run_serial.json"]);
  });

  it("quarantines a corrupt checkpoint without breaking active listing", async () => {
    const store = createAgentExecutionStore({ configDir });
    await store.save(createCheckpoint("run_valid", "running"));
    await writeFile(
      path.join(configDir, "agent-executions", "run_corrupt.json"),
      '{"runId":',
      "utf8",
    );

    await expect(store.listActive()).resolves.toEqual([
      createCheckpoint("run_valid", "running"),
    ]);
    const files = await readdir(path.join(configDir, "agent-executions"));
    expect(files).toEqual(
      expect.arrayContaining([
        "run_valid.json",
        expect.stringMatching(/^run_corrupt\.corrupt-.*\.json$/),
      ]),
    );
    expect(files).not.toContain("run_corrupt.json");
  });

  it("quarantines a checkpoint whose embedded owner differs from its file owner", async () => {
    const store = createAgentExecutionStore({ configDir });
    const executionsDir = path.join(configDir, "agent-executions");
    await mkdir(executionsDir, { recursive: true });
    await writeFile(
      path.join(executionsDir, "run_owner.json"),
      JSON.stringify(createCheckpoint("run_foreign", "running")),
      "utf8",
    );

    await expect(store.get("run_owner")).resolves.toBeNull();
    const files = await readdir(executionsDir);
    expect(files).toEqual([
      expect.stringMatching(/^run_owner\.corrupt-.*\.json$/),
    ]);
  });

  it("serializes corrupt quarantine with a concurrent valid save", async () => {
    const store = createAgentExecutionStore({ configDir });
    await mkdir(path.join(configDir, "agent-executions"), { recursive: true });
    await writeFile(
      path.join(configDir, "agent-executions", "run_race.json"),
      "{broken",
      "utf8",
    );
    const valid = createCheckpoint(
      "run_race",
      "running",
      "2026-07-12T12:00:00.000Z",
    );

    await Promise.all([store.get("run_race"), store.save(valid)]);

    await expect(store.get("run_race")).resolves.toEqual(valid);
  });
});

function createCheckpoint(
  runId: string,
  status: AgentExecutionStatus,
  updatedAt = `2026-06-07T00:00:${status.length.toString().padStart(2, "0")}.000Z`,
): AgentExecutionCheckpoint {
  return {
    id: `checkpoint_${runId}`,
    runId,
    taskId: `task_${runId}`,
    status,
    currentStepId: "step_1",
    steps: [
      {
        id: "step_1",
        description: "List files",
        expectedTool: "file_list",
        expectedOutcome: "Directory entries are known",
        state: status === "queued" ? "pending" : "running",
        attempts: status === "queued" ? 0 : 1,
      },
    ],
    messages: [
      {
        role: "user",
        content: "Organize Downloads",
      },
    ],
    toolCallCount: status === "queued" ? 0 : 1,
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt,
  };
}
