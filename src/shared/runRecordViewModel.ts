import type {
  AgentExecutionCheckpoint,
  AgentExecutionStatus,
} from "./agentExecution";
import type { AgentRunEvent, AgentRunRecord } from "./agentRuns";
import type { AgentTrajectoryEvent } from "./agentTrajectory";

export type RunRecordTone = "attention" | "danger" | "info" | "success";

export type RunRecordStatusView = {
  label: string;
  tone: RunRecordTone;
  description: string;
  needsAttention: boolean;
};

export type RunRecordActionKind =
  | "continue"
  | "open_chat"
  | "open_settings"
  | "review_permission"
  | "retry"
  | "stop"
  | "view_details"
  | "view_result";

export type RunRecordAction = {
  kind: RunRecordActionKind;
  label: string;
};

export type RunRecordActionView = {
  primary: RunRecordAction;
  secondary: RunRecordAction[];
};

export type RunRecordListItem = {
  id: string;
  title: string;
  subtitle: string;
  updatedAt: string;
  status: RunRecordStatusView;
  source: "active" | "history";
};

export type RunRecordSimpleStep = {
  title: string;
  detail: string;
  tone: RunRecordTone;
  createdAt: string;
};

export type RunRecordSummary = {
  title: string;
  outcome: string;
  nextStep: string;
  producedArtifacts: boolean;
  wroteMemory: boolean;
  simpleSteps: RunRecordSimpleStep[];
  technicalEventCount: number;
  trajectoryEventCount: number;
};

const statusPriority: Record<AgentExecutionStatus, number> = {
  failed: 0,
  waiting_for_approval: 1,
  paused: 2,
  running: 3,
  canceled: 4,
  queued: 5,
  succeeded: 6,
};

const maxSubtitleLength = 72;
const technicalEventFallback = "已记录技术事件";
const eventTitleTranslations: Record<string, string> = {
  "agent loop canceled": "任务已停止",
  "agent loop canceled.": "任务已停止",
  "agent run canceled": "任务已停止",
  "agent run canceled.": "任务已停止",
  "agent run finished": "任务结束",
  "agent run finished.": "任务结束",
  "agent run paused": "任务已暂停",
  "agent run paused.": "任务已暂停",
  "agent run started": "任务开始",
  "agent run started.": "任务开始",
  "agent runtime started": "任务运行环境已启动",
  "agent runtime started.": "任务运行环境已启动",
  "checkpoint written": "已保存恢复点",
  "context compacted": "已整理上下文",
  "episodic memory written": "已写入任务记忆",
  "episodic memory written.": "已写入任务记忆",
  "unable to write episodic memory": "未能写入任务记忆",
  "unable to write episodic memory.": "未能写入任务记忆",
};
const exactTechnicalMessageTranslations: Record<string, string> = {
  ...eventTitleTranslations,
  "goal milestone started: list current desktop contents to identify files and folders.":
    "开始步骤：检查桌面内容",
};
const successfulMemoryWriteMessages = new Set([
  "episodic memory written",
  "episodic memory written.",
]);
const successfulMemoryWriteTrajectoryTypes = new Set<AgentTrajectoryEvent["type"]>([
  "dream_memory_written",
]);

export function getRunRecordStatus(
  record: AgentRunRecord | AgentExecutionCheckpoint,
): RunRecordStatusView {
  switch (record.status) {
    case "succeeded":
      return {
        label: "已完成",
        tone: "success",
        description: "任务已完成，可以查看结果和证据。",
        needsAttention: false,
      };
    case "failed":
      return {
        label: "需要处理",
        tone: "danger",
        description: "任务失败，需要修正后再试。",
        needsAttention: true,
      };
    case "canceled":
      return {
        label: "已停止",
        tone: "attention",
        description: "任务已停止，没有继续操作电脑。",
        needsAttention: true,
      };
    case "paused":
      if ("modelServiceNotice" in record && record.modelServiceNotice) {
        return {
          label:
            record.modelServiceNotice.kind === "output_limit"
              ? "等待继续生成"
              : "等待重试",
          tone: "attention",
          description: record.modelServiceNotice.message,
          needsAttention: true,
        };
      }
      return {
        label: "已暂停",
        tone: "info",
        description: "任务保存了检查点，可以继续。",
        needsAttention: true,
      };
    case "running":
      return {
        label: "正在运行",
        tone: "info",
        description: "任务正在执行，可以停止或打开会话。",
        needsAttention: false,
      };
    case "waiting_for_approval":
      return {
        label: "需要授权",
        tone: "attention",
        description: "任务等待你确认权限。",
        needsAttention: true,
      };
    case "queued":
      return {
        label: "排队中",
        tone: "info",
        description: "任务正在等待开始。",
        needsAttention: false,
      };
  }
}

export function getRunRecordAction(
  record: AgentRunRecord | AgentExecutionCheckpoint,
): RunRecordActionView {
  switch (record.status) {
    case "running":
      return {
        primary: { kind: "stop", label: "停止" },
        secondary: [
          { kind: "open_chat", label: "打开会话" },
          { kind: "view_details", label: "查看详情" },
        ],
      };
    case "paused":
      if ("modelServiceNotice" in record && record.modelServiceNotice) {
        return {
          primary: {
            kind: "continue",
            label:
              record.modelServiceNotice.kind === "output_limit"
                ? "继续生成"
                : "重试",
          },
          secondary: [
            { kind: "stop", label: "停止" },
            { kind: "open_chat", label: "打开会话" },
            { kind: "view_details", label: "查看详情" },
          ],
        };
      }
      return {
        primary: { kind: "continue", label: "继续" },
        secondary: [
          { kind: "stop", label: "停止" },
          { kind: "open_chat", label: "打开会话" },
          { kind: "view_details", label: "查看详情" },
        ],
      };
    case "waiting_for_approval":
      return {
        primary: { kind: "review_permission", label: "查看授权" },
        secondary: [
          { kind: "open_chat", label: "打开会话" },
          { kind: "stop", label: "停止" },
        ],
      };
    case "failed":
      return {
        primary: { kind: "retry", label: "修正后重试" },
        secondary: [
          { kind: "open_chat", label: "打开会话" },
          { kind: "view_details", label: "查看详情" },
        ],
      };
    case "succeeded":
      return {
        primary: { kind: "view_result", label: "查看结果" },
        secondary: [
          { kind: "retry", label: "再次运行" },
          { kind: "view_details", label: "查看详情" },
        ],
      };
    case "canceled":
      return {
        primary: { kind: "retry", label: "重新运行" },
        secondary: [
          { kind: "open_chat", label: "打开原会话" },
          { kind: "view_details", label: "查看详情" },
        ],
      };
    case "queued":
      return {
        primary: { kind: "view_details", label: "查看详情" },
        secondary: [{ kind: "open_chat", label: "打开会话" }],
      };
  }
}

export function toRunRecordListItem(
  record: AgentRunRecord | AgentExecutionCheckpoint,
): RunRecordListItem {
  const isRun = isRunRecord(record);
  const status = getRunRecordStatus(record);
  const subtitle = isRun
    ? buildListSubtitle(record, status)
    : buildCheckpointSubtitle(record, status);

  return {
    id: isRun ? record.id : record.runId,
    title: isRun ? record.taskName : `任务 ${record.taskId}`,
    subtitle,
    updatedAt: isRun ? record.finishedAt : record.updatedAt,
    status,
    source: isRun ? "history" : "active",
  };
}

export function compareRunRecordPriority(
  left: AgentRunRecord | AgentExecutionCheckpoint,
  right: AgentRunRecord | AgentExecutionCheckpoint,
): number {
  const statusDelta = statusPriority[left.status] - statusPriority[right.status];

  if (statusDelta !== 0) {
    return statusDelta;
  }

  return getUpdatedTime(right) - getUpdatedTime(left);
}

export function buildRunRecordSummary(
  run: AgentRunRecord,
  trajectoryEvents: AgentTrajectoryEvent[],
): RunRecordSummary {
  const status = getRunRecordStatus(run);
  const simpleSteps = run.events.slice(0, 6).map(toSimpleStep);

  return {
    title: run.taskName,
    outcome: buildOutcomeText(run, status),
    nextStep: buildNextStepText(run),
    producedArtifacts: Boolean(run.artifacts?.length),
    wroteMemory: didWriteMemory(run.events, trajectoryEvents),
    simpleSteps,
    technicalEventCount: run.events.length,
    trajectoryEventCount: trajectoryEvents.length,
  };
}

export function translateRunRecordEventTitle(message: string): string {
  const trimmed = message.trim();
  const normalized = trimmed.toLowerCase();
  const directTranslation = getExactTechnicalMessageTranslation(trimmed);

  if (directTranslation) {
    return directTranslation;
  }

  if (normalized.startsWith("goal milestone started")) {
    if (normalized.includes("desktop")) {
      return "开始步骤：检查桌面内容";
    }

    return "开始步骤";
  }

  if (normalized.startsWith("let me break down this milestone")) {
    return "生成执行计划";
  }

  if (normalized.includes("tool call denied") || normalized.includes("工具调用被拒绝")) {
    return "工具权限被拒绝";
  }

  if (normalized.includes("model response") || normalized.includes("模型响应")) {
    return "收到模型回复";
  }

  if (looksLikeEnglishTechnicalText(trimmed)) {
    return technicalEventFallback;
  }

  return trimmed.replace(/\.$/, "");
}

function isRunRecord(
  record: AgentRunRecord | AgentExecutionCheckpoint,
): record is AgentRunRecord {
  return "taskName" in record;
}

function buildListSubtitle(
  run: AgentRunRecord,
  status: RunRecordStatusView,
): string {
  const summary = translateDefaultText(run.summary || status.description);
  const subtitle = summary || status.description;

  return `${status.label} · ${truncateSubtitle(subtitle)}`;
}

function buildCheckpointSubtitle(
  checkpoint: AgentExecutionCheckpoint,
  status: RunRecordStatusView,
): string {
  if (checkpoint.currentStepId) {
    return `${status.label} · 步骤 ${checkpoint.currentStepId}`;
  }

  return `${status.label} · ${status.description}`;
}

function getUpdatedTime(
  record: AgentRunRecord | AgentExecutionCheckpoint,
): number {
  const rawTime = isRunRecord(record) ? record.finishedAt : record.updatedAt;
  const parsedTime = Date.parse(rawTime);

  return Number.isNaN(parsedTime) ? 0 : parsedTime;
}

function toSimpleStep(event: AgentRunEvent): RunRecordSimpleStep {
  const title = translateRunRecordEventTitle(event.message);

  return {
    title,
    detail: buildEventDetail(event, title),
    tone: event.level === "error" ? "danger" : event.level === "warn" ? "attention" : "info",
    createdAt: event.createdAt,
  };
}

function buildOutcomeText(
  run: AgentRunRecord,
  status: RunRecordStatusView,
): string {
  if (run.status === "canceled") {
    return "任务开始后被停止。没有继续操作电脑。";
  }

  if (run.status === "failed") {
    if (run.failureClass === "permission_denied") {
      return translateDefaultText(run.failureMessage) || "任务需要新的授权后才能继续。";
    }

    if (run.failureClass === "model_error") {
      return translateDefaultText(run.failureMessage) || "模型设置需要检查后再试。";
    }

    return (
      translateDefaultText(run.failureMessage) ||
      translateDefaultText(run.summary) ||
      "任务失败，需要处理后再试。"
    );
  }

  if (run.status === "succeeded") {
    return translateDefaultText(run.summary) || "任务已完成。";
  }

  return status.description;
}

function buildNextStepText(run: AgentRunRecord): string {
  if (run.status === "failed") {
    if (run.failureClass === "permission_denied") {
      return "检查授权后再重试。";
    }

    if (run.failureClass === "model_error") {
      return "打开设置检查模型配置。";
    }

    return "修正问题后重试。";
  }

  if (run.status === "canceled") {
    return "确认任务描述没问题后重新运行。";
  }

  if (run.status === "succeeded") {
    return "查看结果和证据。";
  }

  return "查看任务详情。";
}

function buildEventDetail(event: AgentRunEvent, title: string): string {
  if (title === "任务已停止") {
    return "停止后没有继续执行后续步骤。";
  }

  if (title === "开始步骤：检查桌面内容") {
    return "智能体准备确认桌面路径和已有文件。";
  }

  if (title === "生成执行计划") {
    return "智能体拆分了后续操作步骤。";
  }

  if (event.data?.toolName && typeof event.data.toolName === "string") {
    return `工具：${event.data.toolName}`;
  }

  return event.phase ? `阶段：${event.phase}` : "已记录这个步骤。";
}

function didWriteMemory(
  runEvents: AgentRunEvent[],
  trajectoryEvents: AgentTrajectoryEvent[],
): boolean {
  return (
    runEvents.some((event) => isSuccessfulMemoryWriteMessage(event.message)) ||
    trajectoryEvents.some((event) =>
      successfulMemoryWriteTrajectoryTypes.has(event.type),
    )
  );
}

function translateDefaultText(message?: string): string {
  if (!message) {
    return "";
  }

  return getExactTechnicalMessageTranslation(message) || message.trim();
}

function truncateSubtitle(message: string): string {
  if (message.length <= maxSubtitleLength) {
    return message;
  }

  return `${message.slice(0, maxSubtitleLength - 1)}…`;
}

function isSuccessfulMemoryWriteMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();

  return (
    successfulMemoryWriteMessages.has(normalized) ||
    /^已写入.*记忆[。.]?$/.test(message.trim())
  );
}

function getExactTechnicalMessageTranslation(message: string): string {
  return exactTechnicalMessageTranslations[message.trim().toLowerCase()] ?? "";
}

function looksLikeEnglishTechnicalText(message: string): boolean {
  const withoutWhitespace = message.replace(/\s/g, "");

  if (!/[A-Za-z]/.test(message) || /[\u3400-\u9fff]/.test(message)) {
    return false;
  }

  return /^[A-Za-z0-9._:/()[\],'"!?-]+$/.test(withoutWhitespace);
}
