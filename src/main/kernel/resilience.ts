import type { KernelRunMode } from "../../shared/kernelContract";

export const DEFAULT_CHAT_CHECKPOINT_INTERVAL = 8;
export const PER_MILESTONE_CHECKPOINT_TURNS = 6;
export const MAX_CHECKPOINT_INTERVAL = 60;

export type RuntimeCheckpointIntervalInput = {
  mode: KernelRunMode;
  userOverride?: number;
  milestoneCount?: number;
  perMilestoneTurns?: number;
  maxCheckpointInterval?: number;
};

export function deriveRuntimeCheckpointInterval(
  input: RuntimeCheckpointIntervalInput,
): number {
  const maxCheckpointInterval = positiveIntegerOrDefault(
    input.maxCheckpointInterval,
    MAX_CHECKPOINT_INTERVAL,
  );

  if (input.userOverride !== undefined) {
    return clampCheckpointInterval(input.userOverride, maxCheckpointInterval);
  }

  if (input.mode === "chat") {
    return clampCheckpointInterval(
      DEFAULT_CHAT_CHECKPOINT_INTERVAL,
      maxCheckpointInterval,
    );
  }

  const perMilestoneTurns = positiveIntegerOrDefault(
    input.perMilestoneTurns,
    PER_MILESTONE_CHECKPOINT_TURNS,
  );
  const milestoneCount = Math.max(1, Math.floor(input.milestoneCount ?? 1));
  return clampCheckpointInterval(
    milestoneCount * perMilestoneTurns,
    maxCheckpointInterval,
  );
}

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function clampCheckpointInterval(
  value: number,
  maxCheckpointInterval: number,
): number {
  return Math.min(
    positiveIntegerOrDefault(value, 1),
    maxCheckpointInterval,
  );
}
