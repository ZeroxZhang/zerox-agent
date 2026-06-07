import { CronExpressionParser } from "cron-parser";
import {
  getDefaultTaskPermissionPolicy,
  normalizeTaskPermissionPolicy,
  validateTaskPermissionPolicy,
  type TaskPermissionPolicy,
} from "./toolPermissions";

export type ScheduleKind = "manual" | "daily" | "interval" | "cron";

export type IntervalScheduleUnit = "minutes" | "hours";

export type TaskSchedule =
  | { kind: "manual" }
  | { kind: "daily"; time: string }
  | { kind: "interval"; every: number; unit: IntervalScheduleUnit }
  | { kind: "cron"; expression: string };

export type ScheduledTaskInput = {
  name: string;
  skillName: string;
  enabled: boolean;
  schedule: TaskSchedule;
  input: Record<string, unknown>;
  permissions?: TaskPermissionPolicy;
};

export type NormalizedScheduledTaskInput = Omit<
  ScheduledTaskInput,
  "permissions"
> & {
  permissions: TaskPermissionPolicy;
};

export type ScheduledTask = NormalizedScheduledTaskInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
};

export type ScheduledTaskValidationErrors = Partial<
  Record<"name" | "skillName" | "schedule" | "input" | "permissions", string>
>;

export type ScheduledTaskValidationResult = {
  valid: boolean;
  errors: ScheduledTaskValidationErrors;
};

export type CreateScheduledTaskResult =
  | {
      ok: true;
      task: ScheduledTask;
    }
  | {
      ok: false;
      errors: ScheduledTaskValidationErrors;
      message: string;
    };

export type UpdateScheduledTaskEnabledResult =
  | { ok: true; task: ScheduledTask | null }
  | { ok: false; message: string };

export type DeleteScheduledTaskResult =
  | { ok: true; deleted: boolean }
  | { ok: false; message: string };

const dailyTimePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function describeSchedule(schedule: TaskSchedule): string {
  switch (schedule.kind) {
    case "manual":
      return "手动运行";
    case "daily":
      return `每天 ${schedule.time}`;
    case "interval":
      return `每 ${schedule.every} ${schedule.unit === "hours" ? "小时" : "分钟"}`;
    case "cron":
      return `Cron: ${schedule.expression}`;
  }
}

export function computeNextRunAt(
  schedule: TaskSchedule,
  from: Date = new Date(),
): string | null {
  const normalized = normalizeSchedule(schedule);

  switch (normalized.kind) {
    case "manual":
      return null;
    case "daily":
      return computeNextDailyRunAt(normalized.time, from).toISOString();
    case "interval": {
      const milliseconds =
        normalized.every * (normalized.unit === "hours" ? 60 : 1) * 60 * 1000;
      return new Date(from.getTime() + milliseconds).toISOString();
    }
    case "cron":
      return CronExpressionParser.parse(normalized.expression, {
        currentDate: from,
      })
        .next()
        .toDate()
        .toISOString();
  }
}

export function normalizeScheduledTaskInput(
  input: ScheduledTaskInput,
): NormalizedScheduledTaskInput {
  return {
    name: String(input.name ?? "").trim(),
    skillName: String(input.skillName ?? "").trim(),
    enabled: Boolean(input.enabled),
    schedule: normalizeSchedule(input.schedule),
    input: isPlainRecord(input.input) ? input.input : {},
    permissions: normalizeTaskPermissionPolicy(
      input.permissions ?? getDefaultTaskPermissionPolicy(),
    ),
  };
}

export function validateScheduledTaskInput(
  input: ScheduledTaskInput,
): ScheduledTaskValidationResult {
  const normalized = normalizeScheduledTaskInput(input);
  const errors: ScheduledTaskValidationErrors = {};

  if (!normalized.name) {
    errors.name = "任务名称必填。";
  }

  if (!normalized.skillName) {
    errors.skillName = "技能必填。";
  }

  const scheduleError = validateSchedule(normalized.schedule);
  if (scheduleError) {
    errors.schedule = scheduleError;
  }

  if (!isPlainRecord(normalized.input)) {
    errors.input = "任务输入必须是 JSON 对象。";
  }

  const permissionValidation = validateTaskPermissionPolicy(
    normalized.permissions,
  );
  if (!permissionValidation.valid) {
    errors.permissions = Object.values(permissionValidation.errors).join(" ");
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: {} };
}

export function draftScheduleFromText(text: string): TaskSchedule | null {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  const cronMatch = trimmed.match(/^cron:\s*(.+)$/i);
  if (cronMatch?.[1]) {
    return { kind: "cron", expression: cronMatch[1].trim() };
  }

  const dailyMatch = lower.match(/\bdaily\s+at\s+([0-2]\d:[0-5]\d)\b/);
  if (dailyMatch?.[1] && validateDailyTime(dailyMatch[1])) {
    return { kind: "daily", time: dailyMatch[1] };
  }

  const intervalMatch = lower.match(/\bevery\s+(\d+)\s+(minute|minutes|hour|hours)\b/);
  if (intervalMatch?.[1] && intervalMatch[2]) {
    const unit = intervalMatch[2].startsWith("hour") ? "hours" : "minutes";
    return {
      kind: "interval",
      every: Number(intervalMatch[1]),
      unit,
    };
  }

  const chineseIntervalMatch = trimmed.match(/每\s*(\d+)\s*(分钟|小時|小时)/);
  if (chineseIntervalMatch?.[1] && chineseIntervalMatch[2]) {
    return {
      kind: "interval",
      every: Number(chineseIntervalMatch[1]),
      unit: chineseIntervalMatch[2].includes("时") ||
        chineseIntervalMatch[2].includes("時")
        ? "hours"
        : "minutes",
    };
  }

  const chineseDailyMatch = trimmed.match(
    /(?:每天|每日|天天).{0,8}?(\d{1,2})\s*(?::|：|点|點)\s*(\d{1,2})?/,
  );
  if (chineseDailyMatch?.[1]) {
    const hour = Number(chineseDailyMatch[1]);
    const minute = chineseDailyMatch[2] ? Number(chineseDailyMatch[2]) : 0;
    const time = formatDailyTime(hour, minute);

    if (time) {
      return { kind: "daily", time };
    }
  }

  return null;
}

function formatDailyTime(hour: number, minute: number): string | null {
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeSchedule(schedule: TaskSchedule): TaskSchedule {
  switch (schedule.kind) {
    case "manual":
      return { kind: "manual" };
    case "daily":
      return { kind: "daily", time: String(schedule.time ?? "").trim() };
    case "interval":
      return {
        kind: "interval",
        every: Number(schedule.every),
        unit: schedule.unit === "hours" ? "hours" : "minutes",
      };
    case "cron":
      return {
        kind: "cron",
        expression: String(schedule.expression ?? "").trim(),
      };
  }
}

function validateSchedule(schedule: TaskSchedule): string | null {
  try {
    switch (schedule.kind) {
      case "manual":
        return null;
      case "daily":
        return validateDailyTime(schedule.time)
          ? null
          : "每天调度必须使用 HH:mm 时间。";
      case "interval":
        if (!Number.isInteger(schedule.every) || schedule.every <= 0) {
          return "间隔调度必须使用正整数。";
        }
        return null;
      case "cron":
        CronExpressionParser.parse(schedule.expression);
        return null;
    }
  } catch {
    return "Cron 调度必须是有效的 cron 表达式。";
  }
}

function computeNextDailyRunAt(time: string, from: Date): Date {
  const match = time.match(dailyTimePattern);
  if (!match) {
    throw new Error("Daily schedule time must use HH:mm.");
  }

  const next = new Date(from);
  next.setHours(Number(match[1]), Number(match[2]), 0, 0);

  if (next.getTime() <= from.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

function validateDailyTime(time: string): boolean {
  return dailyTimePattern.test(time);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
