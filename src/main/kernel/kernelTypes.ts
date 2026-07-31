import type {
  KernelRunMode,
  StopDecision,
} from "../../shared/kernelContract";

export type RunContext = {
  runId: string;
  mode: KernelRunMode;
  turn: number;
  maxTurns: number;
  signal?: AbortSignal;
  stopPolicy: StopPolicy;
  toolFailureStreak?: number;
  checkpointRef?: string;
};

export type TurnResult = {
  summary?: string;
  /** Explicit semantic completion; legacy maxTurns is only a checkpoint interval. */
  completed?: boolean;
};

export type StopPolicy = {
  kind: "checkpoint_interval" | "evidence_judge";
  shouldStop(ctx: RunContext, lastTurn: TurnResult): Promise<StopDecision>;
};

export type RuntimeKernelResult = {
  runId: string;
  status: "succeeded" | "failed" | "canceled" | "paused";
  turns: number;
  reason: string;
  summary: string;
};
