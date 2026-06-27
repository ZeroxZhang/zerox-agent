import { CronExpressionParser } from "cron-parser";
import {
  getDefaultTaskPermissionPolicy,
  normalizeTaskPermissionPolicy,
  validateTaskPermissionPolicy,
  type TaskPermissionPolicy,
} from "./toolPermissions";

export type ScheduleKind =
  | "manual"
  | "daily"
  | "weekdays"
  | "weekly"
  | "interval"
  | "cron";

export type IntervalScheduleUnit = "minutes" | "hours";

export type TaskSchedule =
  | { kind: "manual" }
  | { kind: "daily"; time: string }
  | { kind: "weekdays"; time: string }
  | { kind: "weekly"; weekday: number; time: string }
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
const weeklyDayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function describeSchedule(schedule: TaskSchedule): string {
  switch (schedule.kind) {
    case "manual":
      return "手动运行";
    case "daily":
      return `每天 ${schedule.time}`;
    case "weekdays":
      return `工作日 ${schedule.time}`;
    case "weekly":
      return `每${formatWeeklyDay(schedule.weekday)} ${schedule.time}`;
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
    case "weekdays":
      return computeNextWeekdayRunAt(normalized.time, from).toISOString();
    case "weekly":
      return computeNextWeeklyRunAt(
        normalized.weekday,
        normalized.time,
        from,
      ).toISOString();
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

  const englishWeekdayMatch = lower.match(
    /\b(?:weekdays|workdays|business days)\s+(?:at\s+)?([0-2]?\d:[0-5]\d)\b/,
  );
  if (englishWeekdayMatch?.[1]) {
    const time = normalizeClockText(englishWeekdayMatch[1]);
    if (time) {
      return { kind: "weekdays", time };
    }
  }

  const chineseWeekdayMatch = trimmed.match(
    /(?:工作日|每个工作日|每個工作日|每工作日).{0,8}?(\d{1,2})\s*(?::|：|点|點)\s*(\d{1,2})?/,
  );
  if (chineseWeekdayMatch?.[1]) {
    const time = formatDailyTime(
      Number(chineseWeekdayMatch[1]),
      chineseWeekdayMatch[2] ? Number(chineseWeekdayMatch[2]) : 0,
    );
    if (time) {
      return { kind: "weekdays", time };
    }
  }

  const englishWeeklyMatch = lower.match(
    /\b(?:weekly\s+on\s+|every\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:at\s+)?([0-2]?\d:[0-5]\d)\b/,
  );
  if (englishWeeklyMatch?.[1] && englishWeeklyMatch[2]) {
    const weekday = parseEnglishWeekday(englishWeeklyMatch[1]);
    const time = normalizeClockText(englishWeeklyMatch[2]);
    if (weekday && time) {
      return { kind: "weekly", weekday, time };
    }
  }

  const chineseWeeklyMatch = trimmed.match(
    /(?:每周|每週|每星期|每礼拜|每禮拜|周|週)([一二三四五六日天1-7]).{0,8}?(\d{1,2})\s*(?::|：|点|點)\s*(\d{1,2})?/,
  );
  if (
    chineseWeeklyMatch?.[1] &&
    chineseWeeklyMatch[2] &&
    !trimmed.includes("工作日")
  ) {
    const weekday = parseChineseWeekday(chineseWeeklyMatch[1]);
    const time = formatDailyTime(
      Number(chineseWeeklyMatch[2]),
      chineseWeeklyMatch[3] ? Number(chineseWeeklyMatch[3]) : 0,
    );
    if (weekday && time) {
      return { kind: "weekly", weekday, time };
    }
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

function normalizeClockText(value: string): string | null {
  const [hourText, minuteText] = value.split(":");
  return formatDailyTime(Number(hourText), Number(minuteText));
}

function normalizeSchedule(schedule: TaskSchedule): TaskSchedule {
  switch (schedule.kind) {
    case "manual":
      return { kind: "manual" };
    case "daily":
      return { kind: "daily", time: String(schedule.time ?? "").trim() };
    case "weekdays":
      return { kind: "weekdays", time: String(schedule.time ?? "").trim() };
    case "weekly":
      return {
        kind: "weekly",
        weekday: Number(schedule.weekday),
        time: String(schedule.time ?? "").trim(),
      };
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
      case "weekdays":
        return validateDailyTime(schedule.time)
          ? null
          : "工作日调度必须使用 HH:mm 时间。";
      case "weekly":
        if (!isValidWeeklyDay(schedule.weekday)) {
          return "每周调度必须选择周一到周日。";
        }
        return validateDailyTime(schedule.time)
          ? null
          : "每周调度必须使用 HH:mm 时间。";
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

function computeNextWeekdayRunAt(time: string, from: Date): Date {
  const next = computeNextDailyRunAt(time, from);

  while (!isWorkday(next)) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

function computeNextWeeklyRunAt(
  weekday: number,
  time: string,
  from: Date,
): Date {
  const match = time.match(dailyTimePattern);
  if (!match) {
    throw new Error("Weekly schedule time must use HH:mm.");
  }

  if (!isValidWeeklyDay(weekday)) {
    throw new Error("Weekly schedule day must be 1-7.");
  }

  const targetDay = weekday === 7 ? 0 : weekday;
  const next = new Date(from);
  next.setHours(Number(match[1]), Number(match[2]), 0, 0);

  const currentDay = next.getDay();
  let daysUntilTarget = (targetDay - currentDay + 7) % 7;
  if (daysUntilTarget === 0 && next.getTime() <= from.getTime()) {
    daysUntilTarget = 7;
  }

  next.setDate(next.getDate() + daysUntilTarget);
  return next;
}

function validateDailyTime(time: string): boolean {
  return dailyTimePattern.test(time);
}

function isWorkday(date: Date): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function isValidWeeklyDay(weekday: number): boolean {
  return Number.isInteger(weekday) && weekday >= 1 && weekday <= 7;
}

function formatWeeklyDay(weekday: number): string {
  if (!isValidWeeklyDay(weekday)) {
    return "未设置";
  }

  return weeklyDayLabels[weekday === 7 ? 0 : weekday] ?? "未设置";
}

function parseEnglishWeekday(value: string): number | null {
  const weekdays: Record<string, number> = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 7,
  };

  return weekdays[value] ?? null;
}

function parseChineseWeekday(value: string): number | null {
  const weekdays: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    日: 7,
    天: 7,
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
  };

  return weekdays[value] ?? null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
