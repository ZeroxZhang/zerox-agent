import {
  draftScheduleFromText,
  type ScheduledTask,
  type ScheduledTaskInput,
  type TaskSchedule,
} from "./scheduledTasks";
import { resolveUserReferences } from "./agentTaskStrategy";
import { getDefaultTaskPermissionPolicy } from "./toolPermissions";

export type AgentIntentKind = "create_task" | "run_task" | "chat";
export type AgentIntentSlotName = "schedule" | "targetDir" | "taskName";

export type AgentIntentSlots = {
  schedule?: TaskSchedule;
  targetDir?: string;
  taskName?: string;
};

export type AgentIntentRoute = {
  kind: AgentIntentKind;
  confidence: number;
  slots: AgentIntentSlots;
  missingSlots: AgentIntentSlotName[];
  reason: string;
  clarification?: string;
};

export const missingTargetDirectoryClarification =
  "我可以创建这个定时任务。你想让我整理哪个文件夹？例如：下载、桌面、文档或项目。";

export function classifyAgentIntent(message: string): AgentIntentRoute {
  const schedule = draftScheduleFromText(message);
  const targetDir = detectTargetDirectory(message);
  const taskName = targetDir ? detectTaskName(message, targetDir) : undefined;

  if (schedule && hasFileTaskCreationCue(message)) {
    if (!targetDir) {
      return {
        kind: "create_task",
        confidence: 0.72,
        slots: { schedule },
        missingSlots: ["targetDir"],
        reason: "scheduled_file_task_missing_target",
        clarification: missingTargetDirectoryClarification,
      };
    }

    return {
      kind: "create_task",
      confidence: 0.95,
      slots: { schedule, targetDir, taskName },
      missingSlots: [],
      reason: "scheduled_file_task_with_target",
    };
  }

  if (isTaskRunRequest(message)) {
    return {
      kind: "run_task",
      confidence: 0.9,
      slots: {
        ...(targetDir ? { targetDir } : {}),
        ...(taskName ? { taskName } : {}),
      },
      missingSlots: [],
      reason: "explicit_task_run_request",
    };
  }

  return {
    kind: "chat",
    confidence: 0.4,
    slots: {},
    missingSlots: [],
    reason: "no_action_intent_detected",
  };
}

export function buildScheduledTaskInputFromIntent(
  route: AgentIntentRoute,
): ScheduledTaskInput | null {
  const { schedule, targetDir, taskName } = route.slots;
  if (route.kind !== "create_task" || !schedule || !targetDir) {
    return null;
  }

  return {
    name: taskName ?? detectTaskName("", targetDir),
    skillName: "",
    enabled: true,
    schedule,
    input: { targetDir, reportName: "agent-report.md" },
    permissions: {
      ...getDefaultTaskPermissionPolicy(),
      files: {
        read: [targetDir],
        write: [targetDir],
      },
    },
  };
}

export function detectTargetDirectory(message: string): string | null {
  const explicitPath = resolveUserReferences(message).find(
    (reference) => reference.kind === "path",
  );
  if (explicitPath) {
    return explicitPath.canonical;
  }

  const normalized = normalizeMatchText(message);

  if (normalized.includes("下载") || normalized.includes("downloads")) {
    return "~/Downloads";
  }
  if (normalized.includes("桌面") || normalized.includes("desktop")) {
    return "~/Desktop";
  }
  if (normalized.includes("文档") || normalized.includes("documents")) {
    return "~/Documents";
  }
  if (normalized.includes("项目") || normalized.includes("projects")) {
    return "~/Projects";
  }

  return null;
}

export function detectTaskName(
  message: string,
  targetDir: string | null,
): string {
  const normalized = normalizeMatchText(message);

  if (targetDir === "~/Desktop") return "整理桌面文件夹";
  if (targetDir === "~/Documents") return "整理文档文件夹";
  if (targetDir === "~/Projects") return "整理项目文件夹";

  if (normalized.includes("桌面")) return "整理桌面文件夹";
  if (normalized.includes("文档")) return "整理文档文件夹";
  if (normalized.includes("项目")) return "整理项目文件夹";

  return "整理下载文件夹";
}

export function isTaskRunRequest(message: string): boolean {
  return /(运行|执行|跑一下|跑一次|启动).{0,10}(任务|skill|技能|整理|抓取|调度)/i.test(
    message,
  );
}

export function matchTaskFromMessage(
  message: string,
  tasks: ScheduledTask[],
): ScheduledTask | null {
  if (!tasks.length) {
    return null;
  }

  const normalizedMessage = normalizeMatchText(message);
  const exactMatch = tasks.find((task) =>
    normalizedMessage.includes(normalizeMatchText(task.name)),
  );

  if (exactMatch) {
    return exactMatch;
  }

  if (tasks.length === 1) {
    return tasks[0];
  }

  return null;
}

function hasFileTaskCreationCue(message: string): boolean {
  const normalized = normalizeMatchText(message);
  return (
    /整理|组织|清理|归档|organize|clean|sort|archive/.test(normalized) ||
    detectTargetDirectory(message) !== null
  );
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}
