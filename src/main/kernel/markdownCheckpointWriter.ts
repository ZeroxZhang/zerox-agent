// Transition markdown checkpoint writer (contracts v1.4 §4.1, P2).
//
// The APPROVED temporary sole writer of markdown checkpoints before P5's
// checkpoint-writer fork agent lands (spec §3.5 / Patch 9). Produces the 11-
// segment markdown-v1 checkpoint by wrapping `buildGoalContinuityCheckpoint`
// with the `# Checkpoint — <runId>` header + frontmatter, and persists it via
// `CheckpointRepository.write(runId, "markdown", ...)`. P5 takes over and this
// module is deleted; the read side (`RebuildFromCheckpoint`) is unchanged.

import { buildGoalContinuityCheckpoint } from "../../shared/agentGoalContinuity";
import { NEVER_COMPACT_MARKER } from "../../shared/compactionMarkers";
import type { CheckpointRepository } from "../../shared/storageContract";
import type { Goal } from "../../shared/agentGoal";
import type { ProgressLedgerEvent } from "../../shared/agentGoal";

export interface MarkdownCheckpointWriterInput {
  runId: string;
  goal: Goal;
  ledgerEvents?: ProgressLedgerEvent[];
  checkpointRepository: CheckpointRepository;
  now?: string;
  liveToolResultRefs?: string[];
}

export interface MarkdownCheckpointData {
  format: "markdown-v1";
  content: string;
  goalId?: string;
  segmentCount: 11;
  source: "p2-transition" | "p5-writer";
  createdAt: string;
}

export function writeMarkdownCheckpoint(
  input: MarkdownCheckpointWriterInput,
): string {
  const createdAt = input.now ?? new Date().toISOString();
  const body = buildGoalContinuityCheckpoint({
    goal: input.goal,
    ...(input.ledgerEvents ? { ledgerEvents: input.ledgerEvents } : {}),
    now: createdAt,
  });

  const frontmatter = `<!-- zerox-checkpoint format=markdown-v1 createdAt=${createdAt} goalId=${input.goal.id} source=p2-transition -->`;
  const liveRefs = input.liveToolResultRefs?.length
    ? `\n\nTool result refs:\n${input.liveToolResultRefs.map((r) => `- ${r}`).join("\n")}`
    : "";
  const content = [`# Checkpoint — ${input.runId}`, frontmatter, "", body, liveRefs].join("\n");

  const data: MarkdownCheckpointData = {
    format: "markdown-v1",
    content,
    goalId: input.goal.id,
    segmentCount: 11,
    source: "p2-transition",
    createdAt,
  };

  return input.checkpointRepository.write(input.runId, "markdown", data);
}

/** Assert the produced content carries the never-compact anchor (format invariant). */
export function assertMarkdownCheckpointInvariants(content: string): void {
  if (!content.startsWith("# Checkpoint — ")) {
    throw new Error("markdown checkpoint must start with '# Checkpoint — <runId>'");
  }
  if (!content.includes("format=markdown-v1")) {
    throw new Error("markdown checkpoint missing format=markdown-v1 frontmatter");
  }
  if (!content.includes(NEVER_COMPACT_MARKER)) {
    throw new Error("markdown checkpoint missing NEVER_COMPACT_MARKER anchor");
  }
}
