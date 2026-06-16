import type { KernelRunMode } from "../../shared/kernelContract";

export const DEFAULT_CHAT_MAX_TURNS = 8;
export const PER_MILESTONE_TURNS = 6;
export const ABSOLUTE_MAX_TURNS = 60;

export type RuntimeTurnBudgetInput = {
  mode: KernelRunMode;
  userOverride?: number;
  milestoneCount?: number;
  perMilestoneTurns?: number;
  absoluteMaxTurns?: number;
};

export function deriveRuntimeMaxTurns(input: RuntimeTurnBudgetInput): number {
  const absoluteMaxTurns = positiveIntegerOrDefault(
    input.absoluteMaxTurns,
    ABSOLUTE_MAX_TURNS,
  );

  if (input.userOverride !== undefined) {
    return clampTurnBudget(input.userOverride, absoluteMaxTurns);
  }

  if (input.mode === "chat") {
    return clampTurnBudget(DEFAULT_CHAT_MAX_TURNS, absoluteMaxTurns);
  }

  const perMilestoneTurns = positiveIntegerOrDefault(
    input.perMilestoneTurns,
    PER_MILESTONE_TURNS,
  );
  const milestoneCount = Math.max(1, Math.floor(input.milestoneCount ?? 1));
  return clampTurnBudget(milestoneCount * perMilestoneTurns, absoluteMaxTurns);
}

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function clampTurnBudget(value: number, absoluteMaxTurns: number): number {
  return Math.min(positiveIntegerOrDefault(value, 1), absoluteMaxTurns);
}
