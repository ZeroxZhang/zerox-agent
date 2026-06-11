import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentEvalCandidateStore } from "./agentEvalCandidateStore";
import type { AgentEvalCandidate } from "../shared/agentEvalCandidate";

describe("agent eval candidate store", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-eval-candidates-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("creates reviewable eval candidates and persists them", async () => {
    const store = createAgentEvalCandidateStore({ configDir });
    const candidate = await store.create(createCandidate("run_1"));

    expect(candidate).toMatchObject({
      id: "eval_candidate_run_1",
      status: "pending_review",
      sourceRunId: "run_1",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    });
    await expect(store.list({ status: "pending_review" })).resolves.toEqual([
      candidate,
    ]);

    const raw = await readFile(
      path.join(configDir, "agent-eval-candidates.json"),
      "utf8",
    );
    expect(JSON.parse(raw)).toEqual({
      schemaVersion: 1,
      candidates: [candidate],
    });
  });

  it("dedupes candidates by source run and fixture id", async () => {
    const store = createAgentEvalCandidateStore({ configDir });
    const first = await store.create(createCandidate("run_1"));
    const second = await store.create(createCandidate("run_1"));

    expect(second).toEqual(first);
    await expect(store.list()).resolves.toHaveLength(1);
  });

  it("dedupes candidates by candidate id", async () => {
    const store = createAgentEvalCandidateStore({ configDir });
    const first = await store.create(createCandidate("run_1"));
    const second = await store.create(createCandidate("run_1", "episode-run-1-revised"));

    expect(second).toEqual(first);
    await expect(store.list()).resolves.toEqual([first]);
  });

  it("updates status and preserves fixture evidence", async () => {
    const store = createAgentEvalCandidateStore({
      configDir,
      now: () => new Date("2026-06-10T00:01:00.000Z"),
    });
    const candidate = await store.create(createCandidate("run_1"));

    const accepted = await store.setStatus(candidate.id, "accepted");

    expect(accepted).toMatchObject({
      id: candidate.id,
      status: "accepted",
      updatedAt: "2026-06-10T00:01:00.000Z",
      fixture: {
        id: "episode-run-1",
        events: candidate.fixture.events,
      },
    });
    await expect(store.list({ status: "pending_review" })).resolves.toEqual([]);
    await expect(store.list({ status: "accepted" })).resolves.toEqual([accepted]);
  });

  it("transitions status only when the current status matches", async () => {
    const store = createAgentEvalCandidateStore({
      configDir,
      now: () => new Date("2026-06-10T00:01:00.000Z"),
    });
    const candidate = await store.create(createCandidate("run_1"));

    const accepted = await store.transitionStatus(
      candidate.id,
      "pending_review",
      "accepted",
    );
    const rejected = await store.transitionStatus(
      candidate.id,
      "pending_review",
      "rejected",
    );

    expect(accepted).toMatchObject({
      id: candidate.id,
      status: "accepted",
      updatedAt: "2026-06-10T00:01:00.000Z",
    });
    expect(rejected).toBeNull();
    await expect(store.list()).resolves.toEqual([accepted]);
  });

  it("serializes competing transitions so a pending candidate changes once", async () => {
    const store = createAgentEvalCandidateStore({
      configDir,
      now: () => new Date("2026-06-10T00:01:00.000Z"),
    });
    const candidate = await store.create(createCandidate("run_1"));

    const results = await Promise.all([
      store.transitionStatus(candidate.id, "pending_review", "accepted"),
      store.transitionStatus(candidate.id, "pending_review", "rejected"),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(store.list({ status: "pending_review" })).resolves.toEqual([]);
    const stored = await store.list();
    expect(["accepted", "rejected"]).toContain(stored[0]?.status);
  });

  it("returns null when updating a missing candidate", async () => {
    const store = createAgentEvalCandidateStore({ configDir });

    await expect(store.setStatus("missing", "rejected")).resolves.toBeNull();
    await expect(store.list()).resolves.toEqual([]);
  });
});

function createCandidate(
  runId: string,
  fixtureId = `episode-${runId.replace(/_/g, "-")}`,
): AgentEvalCandidate {
  return {
    id: `eval_candidate_${runId}`,
    sourceRunId: runId,
    status: "pending_review",
    rationale: "Generated from test evidence.",
    createdAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    fixture: {
      id: fixtureId,
      description: `Episode candidate from ${runId}`,
      events: [
        {
          id: `${runId}_summary`,
          runId,
          type: "final_summary",
          sequence: 1,
          payload: { summary: "Finished with reviewable evidence." },
          redaction: {
            containsApiKey: false,
            containsFileContent: false,
            containsUserText: false,
          },
          createdAt: "2026-06-10T00:00:00.000Z",
        },
      ],
      requiredEventTypes: ["final_summary"],
    },
  };
}
