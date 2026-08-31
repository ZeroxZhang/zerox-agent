import Database from "better-sqlite3";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentBootstrapValidationSnapshot } from "../shared/agentBootstrap";
import type { AgentExecutionCheckpoint } from "../shared/agentExecution";
import type { AgentLearningCandidate } from "../shared/agentLearning";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import type { Storage, StorageBackend } from "../shared/storageContract";
import { createAgentEpisodePackage } from "./agentEpisodeExporter";
import { assertSafeStoreEntityId } from "./storeEntityId";
import { resolveStorageBackend } from "./storage/backendResolver";
import { createCheckpointRepository } from "./storage/repositories/checkpointRepository";
import {
  createLearningRepository,
  createValidationRepository,
} from "./storage/repositories";
import { createRunRepository } from "./storage/repositories/runRepository";

export type ExportAgentEpisodeFromConfigOptions = {
  configDir: string;
  outDir?: string;
  runId?: string;
  latestValidation?: boolean;
  exportedAt?: string;
  backend?: StorageBackend;
};

export type ExportAgentEpisodeFromConfigResult = {
  runId: string;
  outDir: string;
  files: string[];
};

export async function exportAgentEpisodeFromConfig(
  options: ExportAgentEpisodeFromConfigOptions,
): Promise<ExportAgentEpisodeFromConfigResult> {
  const configDir = path.resolve(options.configDir);
  const backend = options.backend ?? resolveStorageBackend();
  const source = backend === "json"
    ? await readJsonEpisodeSource(configDir, options)
    : await readSqliteEpisodeSource(configDir, options);
  const runId = source.runId;
  if (!runId) {
    throw new Error("Provide --run-id or --latest-validation.");
  }
  assertSafeStoreEntityId(runId, "Agent episode run id");
  const verification = {
    passed: source.trajectory.some((event) => event.type === "final_summary"),
    checks: ["run_record", "trajectory_final_summary"],
  };
  const episode = createAgentEpisodePackage({
    run: source.run,
    sourceAuthority: source.sourceAuthority,
    checkpoint: source.checkpoint,
    trajectory: source.trajectory,
    learningCandidates: source.learningCandidates,
    verification,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
  });
  const outDir = path.resolve(options.outDir ?? path.join("episode-exports", runId));

  await mkdir(outDir, { recursive: true });
  for (const [fileName, content] of Object.entries(episode.files)) {
    await writeFile(path.join(outDir, fileName), content, { encoding: "utf8" });
  }

  return {
    runId,
    outDir,
    files: Object.keys(episode.files).sort(),
  };
}

type EpisodeSource = {
  runId: string | null;
  run: AgentRunRecord;
  sourceAuthority: "agent_run" | "trajectory_run";
  checkpoint: AgentExecutionCheckpoint | null;
  trajectory: AgentTrajectoryEvent[];
  learningCandidates: AgentLearningCandidate[];
};

async function readJsonEpisodeSource(
  configDir: string,
  options: ExportAgentEpisodeFromConfigOptions,
): Promise<EpisodeSource> {
  const runId = options.runId ?? (
    options.latestValidation ? await readLatestValidationRunId(configDir) : null
  );
  if (!runId) {
    throw new Error("Provide --run-id or --latest-validation.");
  }
  assertSafeStoreEntityId(runId, "Agent episode run id");
  const run = await readRun(configDir, runId);
  if (!run) {
    throw new Error(`Run "${runId}" was not found in ${configDir}.`);
  }
  return {
    runId,
    run,
    sourceAuthority: "agent_run",
    checkpoint: await readJsonOrNull<AgentExecutionCheckpoint>(
      path.join(configDir, "agent-executions", `${runId}.json`),
    ),
    trajectory: parseJsonl<AgentTrajectoryEvent>(
      await readTextOrEmpty(
        path.join(configDir, "agent-trajectories", `${runId}.jsonl`),
      ),
    ),
    learningCandidates: await readLearningCandidates(configDir, runId),
  };
}

async function readSqliteEpisodeSource(
  configDir: string,
  options: ExportAgentEpisodeFromConfigOptions,
): Promise<EpisodeSource> {
  const dbPath = path.join(configDir, "zerox.db");
  const identity = await lstat(dbPath).catch(() => null);
  if (!identity?.isFile() || identity.isSymbolicLink()) {
    throw new Error(`SQLite authority was not found in ${configDir}.`);
  }
  const database = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
  });
  const storage: Storage = {
    db: database as unknown as Storage["db"],
    async migrate() {},
    async backup() {
      throw new Error("Read-only episode export storage cannot be backed up.");
    },
    close() {
      database.close();
    },
  };
  try {
    const validation = options.latestValidation
      ? createValidationRepository(storage).load()
      : null;
    const runId = options.runId ?? validation?.report.run.run?.id ?? null;
    if (!runId) {
      throw new Error("Provide --run-id or --latest-validation.");
    }
    assertSafeStoreEntityId(runId, "Agent episode run id");
    const runRepository = createRunRepository(storage);
    const trajectory = runRepository.getTrajectory(runId);
    const storedRun = runRepository.get(runId);
    const run = storedRun ?? deriveTrajectoryRun(runId, trajectory);
    if (!run) {
      throw new Error(`Run "${runId}" was not found in ${configDir}.`);
    }
    return {
      runId,
      run,
      sourceAuthority: storedRun ? "agent_run" : "trajectory_run",
      checkpoint: createCheckpointRepository(storage).latestRuntime(runId),
      trajectory,
      learningCandidates: createLearningRepository(storage)
        .list()
        .filter((candidate) => candidate.sourceRunId === runId),
    };
  } finally {
    storage.close();
  }
}

function deriveTrajectoryRun(
  runId: string,
  trajectory: AgentTrajectoryEvent[],
): AgentRunRecord | null {
  if (trajectory.length === 0) return null;
  const ordered = [...trajectory].sort(
    (left, right) => left.sequence - right.sequence,
  );
  if (ordered.some((event) => event.runId !== runId)) {
    throw new Error(`Trajectory authority for "${runId}" is inconsistent.`);
  }
  const contexts = ordered.flatMap((event) => event.runContext ? [event.runContext] : []);
  const runContext = contexts[0];
  if (
    runContext
    && contexts.some(
      (candidate) => JSON.stringify(candidate) !== JSON.stringify(runContext),
    )
  ) {
    throw new Error(`Trajectory authority for "${runId}" changed run context.`);
  }
  const terminal = [...ordered]
    .reverse()
    .find((event) => event.type === "final_summary");
  const terminalStatus = terminal?.payload.status;
  const status = isExportableTerminalStatus(terminalStatus)
    ? terminalStatus
    : "paused";
  const summary = typeof terminal?.payload.summary === "string"
    ? terminal.payload.summary
    : `Trajectory-backed ${status} run.`;
  return {
    id: runId,
    taskId: `trajectory:${runId}`,
    taskName: "Chat trajectory episode",
    skillName: "chat-runtime",
    status,
    ...(runContext ? { runContext } : {}),
    summary,
    events: [],
    startedAt: ordered[0]!.createdAt,
    finishedAt: ordered.at(-1)!.createdAt,
  };
}

function isExportableTerminalStatus(
  value: unknown,
): value is AgentRunRecord["status"] {
  return value === "succeeded"
    || value === "failed"
    || value === "canceled"
    || value === "paused";
}

async function readLatestValidationRunId(configDir: string): Promise<string | null> {
  const stored = await readJsonOrNull<{
    latest?: AgentBootstrapValidationSnapshot | null;
  }>(path.join(configDir, "agent-validation.json"));
  return stored?.latest?.report.run.run?.id ?? null;
}

async function readRun(
  configDir: string,
  runId: string,
): Promise<AgentRunRecord | null> {
  const runs = parseJsonl<AgentRunRecord>(
    await readTextOrEmpty(path.join(configDir, "agent-runs.jsonl")),
  );
  return runs.reverse().find((run) => run.id === runId) ?? null;
}

async function readLearningCandidates(
  configDir: string,
  runId: string,
): Promise<AgentLearningCandidate[]> {
  const stored = await readJsonOrNull<{
    candidates?: AgentLearningCandidate[];
  }>(path.join(configDir, "agent-learning-candidates.json"));
  const candidates = Array.isArray(stored?.candidates)
    ? stored.candidates
    : Array.isArray(stored)
      ? (stored as AgentLearningCandidate[])
      : [];
  return candidates.filter((candidate) => candidate.sourceRunId === runId);
}

async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  const raw = await readTextOrEmpty(filePath);
  return raw ? (JSON.parse(raw) as T) : null;
}

async function readTextOrEmpty(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function parseJsonl<T>(raw: string): T[] {
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}
