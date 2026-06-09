import type { AgentExecutionCheckpoint } from "../shared/agentExecution";
import type { AgentLearningCandidate } from "../shared/agentLearning";
import type { AgentRunRecord } from "../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";

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
  learningCandidates: AgentLearningCandidate[];
  verification: AgentEpisodeVerification;
  exportedAt: string;
}): AgentEpisodePackage {
  const metadata = {
    runId: input.run.id,
    exportedAt: input.exportedAt,
    fileCount: 6,
    redaction: summarizeRedaction(input.trajectory),
  };

  return {
    runId: input.run.id,
    exportedAt: input.exportedAt,
    files: {
      "run.json": `${JSON.stringify(input.run, null, 2)}\n`,
      "checkpoint.json": `${JSON.stringify(input.checkpoint, null, 2)}\n`,
      "trajectory.jsonl": formatJsonl(input.trajectory),
      "learning-candidates.json": `${JSON.stringify(
        input.learningCandidates,
        null,
        2,
      )}\n`,
      "verification.json": `${JSON.stringify(input.verification, null, 2)}\n`,
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
