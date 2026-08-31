import { describe, expect, it } from "vitest";
import type { AgentRunRecord } from "../shared/agentRuns";
import {
  presentScheduledRun,
  translateRunStatus,
} from "./runStatusPresentation";

describe("run status presentation", () => {
  it.each([
    ["queued", "等待执行", false],
    ["running", "正在执行", false],
    ["waiting_for_approval", "等待授权", true],
    ["paused", "已暂停", true],
    ["succeeded", "最近成功", false],
    ["failed", "最近失败", true],
    ["canceled", "最近取消", true],
  ] as const)(
    "projects %s without collapsing it into a failure",
    (status, label, attentionRequired) => {
      const presentation = presentScheduledRun(createRun(status));
      expect(presentation).toMatchObject({ label, attentionRequired });
      expect(translateRunStatus(status)).not.toBe(
        status === "failed" ? "成功" : "失败",
      );
    },
  );
});

function createRun(status: AgentRunRecord["status"]): AgentRunRecord {
  return {
    id: `run_${status}`,
    taskId: "task_1",
    taskName: "Task",
    skillName: "skill",
    status,
    summary: "",
    events: [],
    startedAt: "2026-08-31T00:00:00.000Z",
    finishedAt: "",
  };
}
