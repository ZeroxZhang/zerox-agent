import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentBootstrapValidationSnapshot } from "../shared/agentBootstrap";
import type { AgentExecutionCheckpoint } from "../shared/agentExecution";
import type { AgentLearningCandidate } from "../shared/agentLearning";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import { createAgentEpisodePackage } from "./agentEpisodeExporter";

export type ExportAgentEpisodeFromConfigOptions = {
  configDir: string;
  outDir?: string;
  runId?: string;
  latestValidation?: boolean;
  exportedAt?: string;
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
  const runId =
    options.runId ??
    (options.latestValidation ? await readLatestValidationRunId(configDir) : null);
  if (!runId) {
    throw new Error("Provide --run-id or --latest-validation.");
  }

  const run = await readRun(configDir, runId);
  if (!run) {
    throw new Error(`Run "${runId}" was not found in ${configDir}.`);
  }

  const checkpoint = await readJsonOrNull<AgentExecutionCheckpoint>(
    path.join(configDir, "agent-executions", `${runId}.json`),
  );
  const trajectory = parseJsonl<AgentTrajectoryEvent>(
    await readTextOrEmpty(path.join(configDir, "agent-trajectories", `${runId}.jsonl`)),
  );
  const learningCandidates = await readLearningCandidates(configDir, runId);
  const verification = {
    passed: trajectory.some((event) => event.type === "final_summary"),
    checks: ["run_record", "trajectory_final_summary"],
  };
  const episode = createAgentEpisodePackage({
    run,
    checkpoint,
    trajectory,
    learningCandidates,
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
