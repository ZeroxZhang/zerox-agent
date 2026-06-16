export const KERNEL_EVENT_VERSION = 1;

export type KernelEventVersion = typeof KERNEL_EVENT_VERSION;

export type KernelRunMode = "chat" | "goal";

export type KernelRunStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "paused"
  | "succeeded"
  | "failed"
  | "canceled";

export type StopDecision =
  | {
      stop: true;
      reason: string;
      evidence?: string[];
      impossible?: false;
    }
  | {
      stop: false;
      reason: string;
      missing?: string[];
    }
  | {
      stop: true;
      impossible: true;
      reason: string;
      evidence?: string[];
    };

export type PendingPermissionView = {
  id: string;
  runId: string;
  toolName: string;
  command: string;
  matchedRule?: string;
};

export type RunView = {
  runId: string;
  mode: KernelRunMode;
  turn: number;
  maxTurns: number;
  status: KernelRunStatus;
  contextUsageRatio: number;
  lastJudgeVerdict?: StopDecision;
  pendingPermission?: PendingPermissionView;
};

export type PermissionRule = {
  pattern: string;
  action: "allow" | "deny" | "ask";
};

export const KERNEL_IPC = {
  event: "kernel:event",
  subscribe: "kernel:subscribe",
  resumeRun: "kernel:resumeRun",
  updatePermissionRules: "kernel:updatePermissionRules",
  respondPermission: "kernel:respondPermission",
} as const;

type KernelEventBase<TType extends string> = {
  v: KernelEventVersion;
  type: TType;
  runId: string;
  createdAt: string;
};

export type KernelEvent =
  | (KernelEventBase<"turn_start"> & {
      turn: number;
      maxTurns: number;
    })
  | (KernelEventBase<"tool_call"> & {
      tool: string;
      args: unknown;
    })
  | (KernelEventBase<"compaction"> & {
      beforeTokens: number;
      afterTokens: number;
      prunedTurns: number[];
      checkpointRef: string;
    })
  | (KernelEventBase<"checkpoint_written"> & {
      ref: string;
      turn: number;
    })
  | (KernelEventBase<"judge_verdict"> & {
      decision: StopDecision;
    })
  | (KernelEventBase<"retry"> & {
      attempt: number;
      maxRetries: number;
      afterMs: number;
      error: string;
    })
  | (KernelEventBase<"run_end"> & {
      status: Extract<KernelRunStatus, "succeeded" | "failed" | "canceled" | "paused">;
      reason: string;
    });

const terminalKernelStatuses = new Set<KernelRunStatus>([
  "succeeded",
  "failed",
  "canceled",
]);

export function isTerminalKernelRunStatus(status: KernelRunStatus): boolean {
  return terminalKernelStatuses.has(status);
}
