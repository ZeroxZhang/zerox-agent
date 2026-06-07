import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentLearningStore } from "./agentLearningStore";
import type { AgentLearningCandidateInput } from "../shared/agentLearning";

describe("agent learning store", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-learning-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("creates reviewable learning candidates and persists them", async () => {
    const store = createAgentLearningStore({
      configDir,
      createId: () => "learn_1",
      now: () => new Date("2026-06-07T00:00:00.000Z"),
    });
    const candidate = await store.create(createCandidateInput());

    expect(candidate).toMatchObject({
      id: "learn_1",
      type: "procedural_memory",
      status: "pending_review",
      sourceRunId: "run_1",
      sourceTrajectoryEventIds: ["event_1", "event_2"],
      claim: "List directories before reading individual files.",
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    });
    await expect(store.list({ status: "pending_review" })).resolves.toEqual([
      candidate,
    ]);

    const raw = await readFile(
      path.join(configDir, "agent-learning-candidates.json"),
      "utf8",
    );
    expect(JSON.parse(raw)).toEqual({
      schemaVersion: 1,
      candidates: [candidate],
    });
  });

  it("updates candidate review status without losing evidence", async () => {
    const store = createAgentLearningStore({
      configDir,
      createId: () => "learn_1",
      now: createSteppedClock("2026-06-07T00:00:00.000Z"),
    });
    const candidate = await store.create(createCandidateInput());

    const accepted = await store.setStatus(candidate.id, "accepted");

    expect(accepted).toMatchObject({
      id: candidate.id,
      status: "accepted",
      sourceTrajectoryEventIds: ["event_1", "event_2"],
      updatedAt: "2026-06-07T00:01:00.000Z",
    });
    await expect(store.list({ status: "pending_review" })).resolves.toEqual([]);
    await expect(store.list({ status: "accepted" })).resolves.toEqual([accepted]);
  });

  it("returns null when updating a missing candidate", async () => {
    const store = createAgentLearningStore({ configDir });

    await expect(store.setStatus("missing", "rejected")).resolves.toBeNull();
    await expect(store.list()).resolves.toEqual([]);
  });
});

function createCandidateInput(): AgentLearningCandidateInput {
  return {
    type: "procedural_memory",
    sourceRunId: "run_1",
    sourceTrajectoryEventIds: ["event_1", "event_2"],
    claim: "List directories before reading individual files.",
    recommendedAction:
      "Create a procedural memory that tells future runs to inspect directory shape first.",
    risk: "Low: it only changes planning context for local file organization.",
  };
}

function createSteppedClock(start: string): () => Date {
  let offset = 0;
  const startMs = new Date(start).getTime();
  return () => {
    const value = new Date(startMs + offset * 60_000);
    offset += 1;
    return value;
  };
}
