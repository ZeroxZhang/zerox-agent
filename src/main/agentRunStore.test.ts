import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentRunStore } from "./agentRunStore";
import type { AgentRunRecord } from "../shared/agentRuns";

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
    summary: "Done",
    events: [],
    startedAt: timestamp,
    finishedAt: timestamp,
  };
}
