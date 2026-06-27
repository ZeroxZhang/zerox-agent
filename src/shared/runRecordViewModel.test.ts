import { describe, expect, it } from "vitest";
import type { AgentExecutionCheckpoint } from "./agentExecution";
import type { AgentRunRecord } from "./agentRuns";
import {
  buildRunRecordSummary,
  compareRunRecordPriority,
  getRunRecordAction,
  getRunRecordStatus,
  translateRunRecordEventTitle,
} from "./runRecordViewModel";

const baseRun: AgentRunRecord = {
  id: "run_1",
  taskId: "task_1",
  taskName: "整理桌面，新建 ba'k 文件夹",
  skillName: "default",
  status: "canceled",
  summary: "Agent loop canceled.",
  events: [
    {
      level: "info",
      message:
        "Goal milestone started: List current desktop contents to identify files and folders.",
      createdAt: "2026-06-27T10:18:39.000Z",
    },
    {
      level: "warn",
      message: "Agent loop canceled.",
      createdAt: "2026-06-27T10:18:48.000Z",
    },
  ],
  startedAt: "2026-06-27T10:18:30.000Z",
  finishedAt: "2026-06-27T10:18:48.000Z",
};

function runWithStatus(
  status: AgentRunRecord["status"],
  overrides: Partial<AgentRunRecord> = {},
): AgentRunRecord {
  return {
    ...baseRun,
    ...overrides,
    id: `run_${status}`,
    status,
  };
}

function checkpointWithStatus(
  status: AgentExecutionCheckpoint["status"],
): AgentExecutionCheckpoint {
  return {
    id: `checkpoint_${status}`,
    runId: `run_${status}`,
    taskId: "task_1",
    status,
    steps: [],
    messages: [],
    toolCallCount: 0,
    createdAt: "2026-06-27T10:18:30.000Z",
    updatedAt: "2026-06-27T10:18:48.000Z",
  };
}

describe("runRecordViewModel", () => {
  it("maps terminal statuses to consumer labels and primary actions", () => {
    expect(getRunRecordStatus(runWithStatus("succeeded")).label).toBe("已完成");
    expect(getRunRecordAction(runWithStatus("succeeded")).primary.label).toBe(
      "查看结果",
    );

    expect(getRunRecordStatus(runWithStatus("failed")).label).toBe("需要处理");
    expect(getRunRecordAction(runWithStatus("failed")).primary.label).toBe(
      "修正后重试",
    );

    expect(getRunRecordStatus(runWithStatus("canceled")).label).toBe("已停止");
    expect(getRunRecordAction(runWithStatus("canceled")).primary.label).toBe(
      "重新运行",
    );
  });

  it("maps active checkpoints to continue or stop actions", () => {
    expect(getRunRecordStatus(checkpointWithStatus("running")).label).toBe(
      "正在运行",
    );
    expect(getRunRecordAction(checkpointWithStatus("running")).primary.label).toBe(
      "停止",
    );

    expect(getRunRecordStatus(checkpointWithStatus("paused")).label).toBe(
      "已暂停",
    );
    expect(getRunRecordAction(checkpointWithStatus("paused")).primary.label).toBe(
      "继续",
    );

    expect(
      getRunRecordStatus(checkpointWithStatus("waiting_for_approval")).label,
    ).toBe("需要授权");
    expect(
      getRunRecordAction(checkpointWithStatus("waiting_for_approval")).primary
        .label,
    ).toBe("查看授权");
  });

  it("prioritizes attention records before completed history", () => {
    const sorted = [
      runWithStatus("succeeded"),
      runWithStatus("failed"),
      runWithStatus("canceled"),
    ].sort(compareRunRecordPriority);

    expect(sorted.map((run) => run.status)).toEqual([
      "failed",
      "canceled",
      "succeeded",
    ]);
  });

  it("translates common internal event messages into readable Chinese", () => {
    expect(translateRunRecordEventTitle("Agent loop canceled.")).toBe("任务已停止");
    expect(
      translateRunRecordEventTitle(
        "Goal milestone started: List current desktop contents to identify files and folders.",
      ),
    ).toBe("开始步骤：检查桌面内容");
  });

  it("summarizes a stopped run without exposing raw English by default", () => {
    const summary = buildRunRecordSummary(baseRun, []);

    expect(summary.outcome).toContain("任务开始后被停止");
    expect(summary.simpleSteps.map((step) => step.title)).toEqual([
      "开始步骤：检查桌面内容",
      "任务已停止",
    ]);
    expect(JSON.stringify(summary)).not.toContain("Agent loop canceled");
    expect(JSON.stringify(summary)).not.toContain("Goal milestone started");
    expect(summary.technicalEventCount).toBe(2);
  });
});
