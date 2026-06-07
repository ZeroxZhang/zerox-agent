import { describe, expect, it } from "vitest";
import {
  buildRunTimeline,
  getRunGuidance,
  summarizeRunEventKinds,
} from "./agentRunInsights";
import type { AgentRunRecord } from "./agentRuns";

describe("agent run insights", () => {
  it("classifies run events into a product timeline", () => {
    const run = createRun({
      events: [
        createEvent("info", "Agent run started."),
        createEvent("info", "Model response received.", { turn: 0 }),
        createEvent("info", "Tool call authorized.", { toolName: "file_read" }),
        createEvent("info", "Tool call executed.", { toolName: "file_read" }),
        createEvent("info", "Episodic memory written.", {
          memoryKind: "episodic",
        }),
        createEvent("info", "Agent run finished."),
      ],
    });

    expect(buildRunTimeline(run)).toMatchObject([
      { kind: "system", title: "智能体运行开始" },
      { kind: "model", title: "收到模型响应" },
      { kind: "permission", title: "工具调用已授权", detail: "file_read" },
      { kind: "tool", title: "工具调用已执行", detail: "file_read" },
      { kind: "memory", title: "已写入情景记忆", detail: "episodic" },
      { kind: "system", title: "智能体运行结束" },
    ]);
    expect(summarizeRunEventKinds(run)).toEqual({
      model: 1,
      permission: 1,
      tool: 1,
      memory: 1,
      error: 0,
    });
  });

  it("classifies Chinese run events in localized demo data", () => {
    const run = createRun({
      events: [
        createEvent("info", "智能体运行开始"),
        createEvent("info", "收到模型响应", { turn: 0 }),
        createEvent("info", "工具调用已授权", { toolName: "file_read" }),
        createEvent("info", "工具调用已执行", { toolName: "file_read" }),
        createEvent("info", "已写入情景记忆", {
          memoryKind: "episodic",
        }),
        createEvent("info", "智能体运行结束"),
      ],
    });

    expect(summarizeRunEventKinds(run)).toEqual({
      model: 1,
      permission: 1,
      tool: 1,
      memory: 1,
      error: 0,
    });
  });

  it("returns actionable guidance for common failure modes", () => {
    expect(
      getRunGuidance(
        createRun({
          status: "failed",
          summary: "Model profile is incomplete.",
        }),
      ),
    ).toEqual({
      tone: "error",
      title: "模型配置不完整",
      action: "打开“设置”，保存 base URL、对话模型和 API Key。",
    });

    expect(
      getRunGuidance(
        createRun({
          status: "failed",
          summary: "Tool call denied: Path is outside allowed directories.",
        }),
      ),
    ).toEqual({
      tone: "error",
      title: "工具权限被拒绝",
      action:
        "打开任务权限或“工具”审计日志，允许确切的目录、域名或命令模板。",
    });

    expect(
      getRunGuidance(
        createRun({
          status: "failed",
          summary: "Model response must be valid JSON.",
        }),
      ),
    ).toEqual({
      tone: "warn",
      title: "模型响应格式问题",
      action: "降低 temperature，使用偏编程/工具调用的模型，或用更严格的技能提示词重试。",
    });
  });

  it("returns success guidance for completed runs", () => {
    expect(
      getRunGuidance(
        createRun({
          status: "succeeded",
          summary: "Report complete.",
        }),
      ),
    ).toEqual({
      tone: "success",
      title: "运行已完成",
      action: "再次调度前，检查时间线、输出摘要和记忆写入。",
    });
  });

  it("returns stop guidance for canceled runs", () => {
    expect(
      getRunGuidance(
        createRun({
          status: "canceled",
          summary: "运行已取消。",
        }),
      ),
    ).toEqual({
      tone: "warn",
      title: "运行已停止",
      action: "这是一次主动停止。调整任务输入、权限或模型设置后，可以重新运行。",
    });
  });
});

function createRun(partial: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: "run_1",
    taskId: "task_1",
    taskName: "Organize Downloads",
    skillName: "local-file-organizer",
    status: "succeeded",
    summary: "Report complete.",
    events: [],
    startedAt: "2026-06-05T08:00:00.000Z",
    finishedAt: "2026-06-05T08:01:00.000Z",
    ...partial,
  };
}

function createEvent(
  level: "info" | "warn" | "error",
  message: string,
  data?: Record<string, unknown>,
) {
  return {
    level,
    message,
    data,
    createdAt: "2026-06-05T08:00:00.000Z",
  };
}
