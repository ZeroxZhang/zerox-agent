import type { AgentRunRecord } from "../shared/agentRuns";

export function translateRunStatus(status: AgentRunRecord["status"]): string {
  const labels: Record<AgentRunRecord["status"], string> = {
    queued: "排队中",
    running: "运行中",
    waiting_for_approval: "等待授权",
    paused: "可恢复",
    succeeded: "成功",
    failed: "失败",
    canceled: "已取消",
  };
  return labels[status];
}

export type ScheduledRunPresentation = {
  label: string;
  fallback: string;
  tone: "neutral" | "success" | "warning" | "error";
  attentionRequired: boolean;
};

export function presentScheduledRun(
  run: AgentRunRecord,
): ScheduledRunPresentation {
  switch (run.status) {
    case "queued":
      return {
        label: "等待执行",
        fallback: "任务已进入执行队列",
        tone: "neutral",
        attentionRequired: false,
      };
    case "running":
      return {
        label: "正在执行",
        fallback: "任务正在运行",
        tone: "neutral",
        attentionRequired: false,
      };
    case "waiting_for_approval":
      return {
        label: "等待授权",
        fallback: "需要确认工具授权后才能继续",
        tone: "warning",
        attentionRequired: true,
      };
    case "paused":
      return {
        label: "已暂停",
        fallback: "运行可恢复",
        tone: "warning",
        attentionRequired: true,
      };
    case "succeeded":
      return {
        label: "最近成功",
        fallback: "任务已完成",
        tone: "success",
        attentionRequired: false,
      };
    case "canceled":
      return {
        label: "最近取消",
        fallback: "运行已取消",
        tone: "warning",
        attentionRequired: true,
      };
    case "failed":
      return {
        label: "最近失败",
        fallback: run.failureMessage || "运行失败",
        tone: "error",
        attentionRequired: true,
      };
  }
}
