import { describe, expect, it } from "vitest";
import {
  KERNEL_EVENT_VERSION,
  KERNEL_IPC,
  isTerminalKernelRunStatus,
  type KernelEvent,
  type PermissionRule,
  type RunView,
  type StopDecision,
} from "./kernelContract";

describe("kernel contract", () => {
  it("defines stable IPC channels and event versioning", () => {
    expect(KERNEL_EVENT_VERSION).toBe(1);
    expect(KERNEL_IPC).toEqual({
      event: "kernel:event",
      subscribe: "kernel:subscribe",
      resumeRun: "kernel:resumeRun",
      updatePermissionRules: "kernel:updatePermissionRules",
      respondPermission: "kernel:respondPermission",
    });
  });

  it("types kernel events used by long-task observability", () => {
    const events: KernelEvent[] = [
      {
        v: 1,
        type: "turn_start",
        runId: "run_1",
        turn: 1,
        maxTurns: 8,
        createdAt: "2026-06-16T00:00:00.000Z",
      },
      {
        v: 1,
        type: "tool_call",
        runId: "run_1",
        tool: "git_status",
        args: { short: true },
        createdAt: "2026-06-16T00:00:01.000Z",
      },
      {
        v: 1,
        type: "compaction",
        runId: "run_1",
        beforeTokens: 12000,
        afterTokens: 5400,
        prunedTurns: [2, 3],
        checkpointRef: "checkpoint_1",
        createdAt: "2026-06-16T00:00:02.000Z",
      },
      {
        v: 1,
        type: "checkpoint_written",
        runId: "run_1",
        ref: "checkpoint_2",
        turn: 4,
        createdAt: "2026-06-16T00:00:03.000Z",
      },
      {
        v: 1,
        type: "judge_verdict",
        runId: "run_1",
        decision: {
          stop: false,
          reason: "missing required file evidence",
          missing: ["src/main/kernel/runtimeKernel.ts"],
        },
        createdAt: "2026-06-16T00:00:04.000Z",
      },
      {
        v: 1,
        type: "retry",
        runId: "run_1",
        attempt: 1,
        maxRetries: 2,
        afterMs: 500,
        error: "status 429",
        createdAt: "2026-06-16T00:00:05.000Z",
      },
      {
        v: 1,
        type: "run_end",
        runId: "run_1",
        status: "succeeded",
        reason: "turn limit policy satisfied",
        createdAt: "2026-06-16T00:00:06.000Z",
      },
    ];

    expect(events.map((event) => event.type)).toEqual([
      "turn_start",
      "tool_call",
      "compaction",
      "checkpoint_written",
      "judge_verdict",
      "retry",
      "run_end",
    ]);
  });

  it("types stop decisions, run views, and permission rules", () => {
    const accepted: StopDecision = {
      stop: true,
      reason: "all acceptance evidence is present",
      evidence: ["npm run verify -> passed"],
    };
    const impossible: StopDecision = {
      stop: true,
      impossible: true,
      reason: "required local resource does not exist",
    };
    const runView: RunView = {
      runId: "run_1",
      mode: "goal",
      turn: 5,
      maxTurns: 30,
      status: "running",
      contextUsageRatio: 0.63,
      lastJudgeVerdict: accepted,
      pendingPermission: {
        id: "approval_1",
        runId: "run_1",
        toolName: "shell",
        command: "npm run verify",
      },
    };
    const rule: PermissionRule = {
      pattern: "npm run *",
      action: "allow",
    };

    expect(impossible.impossible).toBe(true);
    expect(runView.pendingPermission?.command).toBe("npm run verify");
    expect(rule.action).toBe("allow");
    expect(isTerminalKernelRunStatus("running")).toBe(false);
    expect(isTerminalKernelRunStatus("failed")).toBe(true);
  });
});
