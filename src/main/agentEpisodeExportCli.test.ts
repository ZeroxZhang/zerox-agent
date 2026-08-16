import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportAgentEpisodeFromConfig } from "./agentEpisodeExportCli";
import type { AgentBootstrapValidationSnapshot } from "../shared/agentBootstrap";
import type { AgentExecutionCheckpoint } from "../shared/agentExecution";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";

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
    const run = createRun("run_1");
    await writeFile(
      path.join(configDir, "agent-runs.jsonl"),
      `${JSON.stringify(createRun("run_old"))}\n${JSON.stringify(run)}\n`,
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
      exportedAt: timestamp,
    });

    expect(result.runId).toBe("run_1");
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
