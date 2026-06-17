import type { AgentExecutionCheckpoint } from "../shared/agentExecution";
import type { AgentLearningCandidate } from "../shared/agentLearning";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import type { KernelEvent } from "../shared/kernelContract";
import { projectRunGraph } from "../shared/runGraph";
import { createEvalCandidateFromEpisode } from "./agentEvalCandidateGenerator";

export type AgentEpisodeVerification = {
  passed: boolean;
  checks: string[];
};

export type AgentEpisodePackage = {
  runId: string;
  exportedAt: string;
  files: Record<string, string>;
};

export function createAgentEpisodePackage(input: {
  run: AgentRunRecord;
  checkpoint: AgentExecutionCheckpoint | null;
  trajectory: AgentTrajectoryEvent[];
  kernelEvents?: KernelEvent[];
  learningCandidates: AgentLearningCandidate[];
  verification: AgentEpisodeVerification;
  exportedAt: string;
}): AgentEpisodePackage {
  const runGraph = projectRunGraph({
    run: input.run,
    trajectoryEvents: input.trajectory,
    kernelEvents: input.kernelEvents ?? [],
  });
  const metadata = {
    runId: input.run.id,
    exportedAt: input.exportedAt,
    fileCount: 8,
    redaction: summarizeRedaction(input.trajectory),
  };
  const evalCandidate = createEvalCandidateFromEpisode({
    run: input.run,
    trajectory: input.trajectory,
    createdAt: input.exportedAt,
  });

  return {
    runId: input.run.id,
    exportedAt: input.exportedAt,
    files: {
      "run.json": `${JSON.stringify(input.run, null, 2)}\n`,
      "checkpoint.json": `${JSON.stringify(input.checkpoint, null, 2)}\n`,
      "trajectory.jsonl": formatJsonl(input.trajectory),
      "run-graph.json": `${JSON.stringify(runGraph, null, 2)}\n`,
      "learning-candidates.json": `${JSON.stringify(
        input.learningCandidates,
        null,
        2,
      )}\n`,
      "verification.json": `${JSON.stringify(input.verification, null, 2)}\n`,
      "eval-candidate.json": `${JSON.stringify(evalCandidate, null, 2)}\n`,
      "metadata.json": `${JSON.stringify(metadata, null, 2)}\n`,
    },
  };
}

function formatJsonl(events: AgentTrajectoryEvent[]): string {
  if (!events.length) {
    return "";
  }

  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function summarizeRedaction(trajectory: AgentTrajectoryEvent[]) {
  return {
    containsApiKey: trajectory.some((event) => event.redaction.containsApiKey),
    containsFileContent: trajectory.some(
      (event) => event.redaction.containsFileContent,
    ),
    containsUserText: trajectory.some((event) => event.redaction.containsUserText),
  };
}
