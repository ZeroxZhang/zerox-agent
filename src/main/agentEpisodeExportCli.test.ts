import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportAgentEpisodeFromConfig } from "./agentEpisodeExportCli";
import type { AgentBootstrapValidationSnapshot } from "../shared/agentBootstrap";
import type { AgentExecutionCheckpoint } from "../shared/agentExecution";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import { createStorageImpl } from "./storage/storageDb";
import { createCheckpointRepository } from "./storage/repositories/checkpointRepository";
import {
  createLearningRepository,
  createValidationRepository,
} from "./storage/repositories";
import { createRunRepository } from "./storage/repositories/runRepository";

const timestamp = "2026-06-17T00:00:00.000Z";

describe("exportAgentEpisodeFromConfig", () => {
  let rootDir: string;
  let configDir: string;
  let outDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), "agent-episode-export-"));
    configDir = path.join(rootDir, "config");
    outDir = path.join(rootDir, "episode");
    await mkdir(configDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("exports the latest validation run through the typed episode package", async () => {
    const run = {
      ...createRun("run_1"),
      executionRevision: 2,
      summary: "Latest resumed owner.",
    };
    const previousOwner = {
      ...createRun("run_1"),
      executionRevision: 1,
      status: "paused" as const,
      summary: "Stale paused owner.",
    };
    await writeFile(
      path.join(configDir, "agent-runs.jsonl"),
      `${JSON.stringify(createRun("run_old"))}\n${JSON.stringify(previousOwner)}\n${JSON.stringify(run)}\n`,
    );
    await mkdir(path.join(configDir, "agent-executions"), { recursive: true });
    await writeFile(
      path.join(configDir, "agent-executions", "run_1.json"),
      `${JSON.stringify(createCheckpoint(), null, 2)}\n`,
    );
    await mkdir(path.join(configDir, "agent-trajectories"), { recursive: true });
    await writeFile(
      path.join(configDir, "agent-trajectories", "run_1.jsonl"),
      formatJsonl([
        trajectory("event_acceptance", 1, "acceptance_checked", {
          accepted: false,
          checkId: "check_release",
        }),
        trajectory("event_escape", 2, "workspace_escape_denied", {
          toolName: "file_write",
          path: "/tmp/outside/report.md",
        }),
        trajectory("event_summary", 3, "final_summary", {
          status: "failed",
          summary: "Workspace escape denied.",
        }),
      ]),
    );
    await writeFile(
      path.join(configDir, "agent-validation.json"),
      `${JSON.stringify(createValidationSnapshot(run), null, 2)}\n`,
    );

    const result = await exportAgentEpisodeFromConfig({
      configDir,
      outDir,
      latestValidation: true,
      backend: "json",
      exportedAt: timestamp,
    });

    expect(result.runId).toBe("run_1");
    await expect(readFile(path.join(outDir, "run.json"), "utf8"))
      .resolves.toContain('"executionRevision": 2');
    await expect(readFile(path.join(outDir, "eval-candidate.json"), "utf8"))
      .resolves.toContain("\"status\": \"pending_review\"");
    const runGraph = await readJson(path.join(outDir, "run-graph.json"));
    expect(runGraph.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "gate:acceptance:check_release" }),
        expect.objectContaining({ id: "gate:workspace_sandbox:event_escape" }),
      ]),
    );
    expect(runGraph.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: "trajectory:event_escape" }),
      ]),
    );
    await expect(readFile(path.join(outDir, "metadata.json"), "utf8"))
      .resolves.toContain("\"fileCount\": 8");
  });

  it("rejects an unsafe run id before reading run-scoped files or creating output", async () => {
    const unsafeRunId = "../outside";
    await writeFile(
      path.join(configDir, "agent-runs.jsonl"),
      `${JSON.stringify(createRun(unsafeRunId))}\n`,
    );

    await expect(
      exportAgentEpisodeFromConfig({
        configDir,
        outDir,
        runId: unsafeRunId,
        backend: "json",
        exportedAt: timestamp,
      }),
    ).rejects.toThrow("run id is invalid");
    await expect(readFile(path.join(rootDir, "outside.json"), "utf8")).rejects
      .toMatchObject({ code: "ENOENT" });
  });

  it("exports the authoritative SQLite run graph without JSON shadows", async () => {
    const storage = createStorageImpl({ dbPath: path.join(configDir, "zerox.db") });
    const run = createRun("run_1");
    const event = trajectory("event_summary", 1, "final_summary", {
      status: "failed",
      summary: "SQLite authority.",
    });
    createRunRepository(storage).create(run);
    createRunRepository(storage).appendTrajectory(run.id, event);
    createCheckpointRepository(storage).writeRuntime(createCheckpoint());
    createLearningRepository(storage).create({
      id: "learning_1",
      sourceRunId: run.id,
      type: "failure_lesson",
      sourceTrajectoryEventIds: [event.id],
      claim: "SQLite candidate",
      recommendedAction: "Keep authority aligned.",
      risk: "low",
      status: "pending_review",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    createValidationRepository(storage).save(
      createValidationSnapshot(run).latest,
    );
    storage.close();

    const result = await exportAgentEpisodeFromConfig({
      configDir,
      outDir,
      latestValidation: true,
      backend: "sqlite",
      exportedAt: timestamp,
    });

    expect(result.runId).toBe(run.id);
    await expect(readFile(path.join(outDir, "trajectory.jsonl"), "utf8"))
      .resolves.toContain("SQLite authority.");
    await expect(
      readFile(path.join(outDir, "learning-candidates.json"), "utf8"),
    ).resolves.toContain("SQLite candidate");
  });

  it("exports an exact SQLite trajectory authority without fabricating a stored run", async () => {
    const storage = createStorageImpl({ dbPath: path.join(configDir, "zerox.db") });
    const event = trajectory("event_summary", 1, "final_summary", {
      status: "succeeded",
      summary: "Chat trajectory completed.",
    });
    createRunRepository(storage).appendTrajectory(event.runId, event);
    storage.close();

    const result = await exportAgentEpisodeFromConfig({
      configDir,
      outDir,
      runId: event.runId,
      backend: "sqlite",
      exportedAt: timestamp,
    });

    expect(result.runId).toBe(event.runId);
    const metadata = await readJson(path.join(outDir, "metadata.json"));
    expect(metadata.sourceAuthority).toBe("trajectory_run");
    const run = await readJson(path.join(outDir, "run.json"));
    expect(run).toMatchObject({
      id: event.runId,
      taskName: "Chat trajectory episode",
      status: "succeeded",
    });
  });
});

function createRun(id: string): AgentRunRecord {
  return {
    id,
    taskId: "task_1",
    taskName: "Export evidence",
    skillName: "local-file-organizer",
    status: id === "run_1" ? "failed" : "succeeded",
    summary: "Exported.",
    events: [],
    startedAt: timestamp,
    finishedAt: timestamp,
  };
}

function createCheckpoint(): AgentExecutionCheckpoint {
  return {
    id: "checkpoint_1",
    runId: "run_1",
    taskId: "task_1",
    status: "failed",
    steps: [],
    messages: [],
    toolCallCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createValidationSnapshot(
  run: AgentRunRecord,
): { schemaVersion: 1; latest: AgentBootstrapValidationSnapshot } {
  return {
    schemaVersion: 1,
    latest: {
      validatedAt: timestamp,
      report: {
        ready: false,
        model: { ready: true, message: "ready" },
        skill: { ready: true, message: "ready" },
        task: {
          ready: true,
          created: false,
          task: null,
          message: "ready",
        },
        connection: {
          ready: true,
          checked: true,
          latencyMs: 10,
          message: "ready",
        },
        run: {
          ready: false,
          ran: true,
          run,
          message: "failed",
        },
      },
    },
  };
}

function trajectory(
  id: string,
  sequence: number,
  type: AgentTrajectoryEvent["type"],
  payload: Record<string, unknown>,
): AgentTrajectoryEvent {
  return {
    id,
    runId: "run_1",
    type,
    sequence,
    payload,
    redaction: {
      containsApiKey: false,
      containsFileContent: false,
      containsUserText: false,
    },
    createdAt: timestamp,
  };
}

function formatJsonl(events: AgentTrajectoryEvent[]): string {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
}
